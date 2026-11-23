import type { ComponentChildren } from 'preact'
import type { EditorSession } from '../../../app/editorSession.ts'
import type { MarkKind, NoteMark, SpanMark } from '../../../app/editorRules.ts'
import { LOUDNESS_MARKS, chordOf } from '../../../core/score/edit.ts'
import type { BarSpan, LoudnessMark } from '../../../core/score/edit.ts'
import { placeOfNote } from '../../../core/score/model.ts'
import { useShell } from '../../ShellContext.ts'
import { Chip } from './controls.tsx'

/**
 * The Marks tray (change redesign-score-editor, task 7.1; spec `score-editing` "Ways to add a mark", "Articulation
 * marks", "Loudness marks", "Slurs and hairpins of the bar"). What a key does is `EditorSession.tapMark`'s:
 *
 * - Note first: with a note selected, the marks it has are lit, and a key turns its mark on or off on that note (a
 *   loudness mark replaces the one it has; a lit slur, tie or hairpin key removes that one).
 * - Mark first: with nothing selected, a key arms its mark (lit, with a dashed edge). Every note tapped then gets it or
 *   loses it, until the key is tapped again or the Notes or Bars tools are opened. A slur, tie, crescendo or diminuendo
 *   takes the first note tapped and waits for the last, in any bar (the notice above the bar, design D14).
 *
 * From the top: the marks of a note (five across: articulations, ornaments, tremolo, arpeggio, breath and caesura), the
 * marks that join two notes, the loudness marks *pp* to *ff*, and the list of the slurs, ties and hairpins that touch the
 * current bar, each with the bars it runs over, Remove, and for one that reaches another bar a key to each end. The
 * tray is three rows of keys high and scrolls inside itself (design D13). Each key's name is the mark's full name; its
 * face is a sign with the name, on two lines or shortened where five keys across leave no room ("Staccatiss.", "Cresc.").
 */
export interface MarksTrayProps {
  session: EditorSession
  /** Before an action: what the editor says goes. */
  onQuiet: () => void
}

/** The marks of a note, in the tray's order, with the sign on their key (the mock's). */
const NOTE_KEYS: readonly { kind: NoteMark; sign: string }[] = [
  { kind: 'staccato', sign: '•' },
  { kind: 'staccatissimo', sign: '▾' },
  { kind: 'tenuto', sign: '–' },
  { kind: 'accent', sign: '>' },
  { kind: 'strongAccent', sign: '^' },
  { kind: 'fermata', sign: '◠' },
  { kind: 'trill', sign: 'tr' },
  { kind: 'turn', sign: '∾' },
  { kind: 'mordent', sign: '〰' },
  { kind: 'tremolo', sign: '≡' },
  { kind: 'arpeggio', sign: '≀' },
  { kind: 'breath', sign: '’' },
  { kind: 'caesura', sign: '//' },
]

const SPAN_KEYS: readonly { kind: SpanMark; sign: string }[] = [
  { kind: 'slur', sign: '⌒' },
  { kind: 'tie', sign: '‿' },
  { kind: 'crescendo', sign: '<' },
  { kind: 'diminuendo', sign: '>' },
]

/** The names shortened on the face of a key. */
const SHORT: Partial<Record<MarkKind, 'marks.short.staccatissimo' | 'marks.short.crescendo' | 'marks.short.diminuendo'>> = {
  staccatissimo: 'marks.short.staccatissimo',
  crescendo: 'marks.short.crescendo',
  diminuendo: 'marks.short.diminuendo',
}

export function MarksTray({ session, onQuiet }: MarksTrayProps) {
  const { i18n } = useShell()
  const { t } = i18n
  const note = session.selectedNote.value
  const armed = session.armed.value
  const active = session.activeMarks.value
  const score = session.score.value
  const spans = session.spans.value
  const rest = note?.rest === true
  const single = note !== undefined && !rest && !chordOf(score, note.id).inChord

  const tap = (kind: MarkKind) => () => {
    onQuiet()
    session.tapMark(kind)
  }

  /** A key of the tray: lit when the selected note has the mark or it is armed. */
  const key = (kind: MarkKind, face: ComponentChildren, disabled: boolean, extra = '') => (
    <Chip key={kind} label={kind in LOUDNESS_LABEL ? t(LOUDNESS_LABEL[kind as LoudnessMark]) : t(`mark.${kind as NoteMark | SpanMark}`)} pressed={active.has(kind) || armed === kind} armed={armed === kind} disabled={disabled} onPress={tap(kind)}>
      <span class={`editor-mark-face${extra}`}>{face}</span>
    </Chip>
  )

  const face = (kind: NoteMark | SpanMark, sign: string) => (
    <>
      <b class="editor-mark-sign" aria-hidden="true">
        {sign}
      </b>
      <span class="editor-mark-name">{t(SHORT[kind] ?? `mark.${kind}`)}</span>
    </>
  )

  return (
    <div class="editor-marks-tray">
      <div class="editor-marks-keys editor-marks-keys--note" role="group" aria-label={t('marks.onNote')}>
        {/* A rest takes only a fermata; Arpeggio needs a chord (spec "Arpeggio needs a chord"). */}
        {NOTE_KEYS.map(({ kind, sign }) => key(kind, face(kind, sign), (rest && kind !== 'fermata') || (kind === 'arpeggio' && single)))}
      </div>
      <div class="editor-marks-keys editor-marks-keys--span" role="group" aria-label={t('marks.joining')}>
        {SPAN_KEYS.map(({ kind, sign }) => key(kind, face(kind, sign), false))}
      </div>
      <div class="editor-marks-keys editor-marks-keys--loudness" role="group" aria-label={t('marks.loudness')}>
        {LOUDNESS_MARKS.map((kind) => key(kind, kind, rest, ' editor-mark-face--loudness'))}
      </div>
      {spans.length > 0 ? <SpanList session={session} spans={spans} onQuiet={onQuiet} /> : null}
    </div>
  )
}

const LOUDNESS_LABEL: Readonly<Record<LoudnessMark, `marks.loudness.${LoudnessMark}`>> = {
  pp: 'marks.loudness.pp',
  p: 'marks.loudness.p',
  mp: 'marks.loudness.mp',
  mf: 'marks.loudness.mf',
  f: 'marks.loudness.f',
  ff: 'marks.loudness.ff',
}

/**
 * The slurs, ties and hairpins that begin, end or pass in the current bar (spec "Slurs and hairpins of the bar"): "Slur
 * C5–F5" for one inside the bar, "Slur, bars 2 to 5" for one that reaches another, with keys to its first and last bar
 * (the note there is selected) and Remove, which takes it off both its notes (one undo step).
 */
function SpanList({ session, spans, onQuiet }: { session: EditorSession; spans: readonly BarSpan[]; onQuiet: () => void }) {
  const { i18n } = useShell()
  const { t } = i18n
  const score = session.score.value
  const nameOf = (id: string): string => {
    const pitch = placeOfNote(score, id)?.note.pitch
    return pitch ? i18n.noteName(pitch) : '–'
  }
  return (
    <section class="editor-spans" aria-label={t('marks.spans')}>
      {spans.map((span) => {
        const mark = t(`mark.${span.kind}`)
        const inBar = span.first === span.last
        const label = inBar ? t('marks.span.inBar', { mark, from: nameOf(span.fromId), to: nameOf(span.toId) }) : t('marks.span.bars', { mark, first: span.first + 1, last: span.last + 1 })
        const act = (action: () => unknown) => () => {
          onQuiet()
          action()
        }
        return (
          <div key={`${span.kind}:${span.fromId}:${span.toId}`} class="editor-span" role="group" aria-label={label}>
            <span class="editor-span-name">{label}</span>
            {inBar ? null : (
              <>
                <button type="button" class="editor-span-key" aria-label={t('marks.span.first')} onClick={act(() => session.goToSpanEnd(span, 'first'))}>
                  ‹ {span.first + 1}
                </button>
                <button type="button" class="editor-span-key" aria-label={t('marks.span.last')} onClick={act(() => session.goToSpanEnd(span, 'last'))}>
                  {span.last + 1} ›
                </button>
              </>
            )}
            <button type="button" class="editor-span-key editor-span-key--remove" aria-label={t('marks.span.remove')} onClick={act(() => session.removeSpan(span))}>
              ✕
            </button>
          </div>
        )
      })}
    </section>
  )
}
