import { barLineText } from './barLineText.ts'
import { MAX_REPEAT_TIMES, joinBars, MIN_REPEAT_TIMES, barLinesOf, chordOf, removeWedge, setBarEnd, setBarStart, setRepeatTimes, splitBar, toggleAccent, toggleArpeggio, toggleFermata, toggleOrnament, toggleSlur, toggleStaccatissimo, toggleStaccato, toggleStrongAccent, toggleTenuto, toggleTie, toggleTremolo, wedgeAt } from '../../../core/score/edit.ts'
import type { BarEnd, BarStart } from '../../../core/score/edit.ts'
import type { Score, VoiceScore } from '../../../core/score/model.ts'
import { Stepper } from '../../components/index.ts'
import { useShell } from '../../ShellContext.ts'
import { Chip, SelectField } from './controls.tsx'
import type { ToolProps } from './NoteTab.tsx'

/**
 * The Marks tab (frame 06.2, spec `score-editing` "Articulation marks" and "Crescendo and diminuendo").
 *
 * Staccato, staccatissimo, tenuto, accent, strong accent, fermata, trill, turn, mordent and tremolo are on or
 * off for the selected note (trill, turn and mordent replace each other, a tremolo is a single one with 3
 * strokes), and Arpeggio for its chord (disabled on a note that is not in one); tapping an active one takes it
 * off. A caesura has no chip: it is selected on the score and deleted, like a breath mark (change more-marks, D4). A slur, a tie, a crescendo and a diminuendo join two notes, so they are chosen by their first and
 * last note (design D14, the frame's own hint): the chip starts the choice, the editor waits for the two
 * taps on the score (`Editor.tsx`), and tapping the chip of a mark that the selected note already has
 * removes it.
 *
 * The "Bar N" group sets how the current bar starts and ends (change edit-bar-lines, design D2): a start-repeat, a
 * double bar line or an end-repeat, and for an end-repeat how many times the section is played, with a held button as
 * one undo step; "Remove bar line" joins it with the next bar, and "Bar line before" splits it before the selected note.
 *
 * Both are temporary trays of the editor's frame (change redesign-score-editor, task 6.1): the marks are the Marks tray
 * and the group is the Bars tray, until the new Marks and Bars trays replace them (tasks 7.1 and 9.1).
 */

/** The marks that join two notes. */
export type PickKind = 'slur' | 'tie' | 'crescendo' | 'diminuendo'

/** The choice in progress: which mark, and the first note once it is tapped. */
export interface PickState {
  kind: PickKind
  first: string | null
}

export interface MarksTabProps extends ToolProps {
  pick: PickState | null
  /** Starts the choice of the notes of a mark, or (null) stops it. */
  onPick: (kind: PickKind | null) => void
}

const SINGLE_NOTE_MARKS = [
  { key: 'staccato', toggle: toggleStaccato },
  { key: 'staccatissimo', toggle: toggleStaccatissimo },
  { key: 'tenuto', toggle: toggleTenuto },
  { key: 'accent', toggle: toggleAccent },
  { key: 'strongAccent', toggle: toggleStrongAccent },
  { key: 'fermata', toggle: toggleFermata },
] as const satisfies readonly { key: string; toggle: (score: Score | VoiceScore, id: string) => void }[]

/** Trill, turn and mordent replace each other, so each chip is on when the note has that ornament. */
const ORNAMENTS = ['trill', 'turn', 'mordent'] as const

export function MarksTab({ session, run, pick, onPick }: MarksTabProps) {
  const { i18n } = useShell()
  const { t } = i18n
  const note = session.selectedNote.value
  const score = session.score.value
  const id = note?.id
  const wedge = id ? wedgeAt(score, id)?.type : undefined
  const chord = id ? chordOf(score, id) : undefined
  const off = !note || note.rest === true

  const joined: readonly { kind: PickKind; on: boolean; remove: (score: Score | VoiceScore, id: string) => void }[] = [
    { kind: 'slur', on: (note?.slurs.length ?? 0) > 0, remove: toggleSlur },
    { kind: 'tie', on: note?.tieStart === true || note?.tieStop === true, remove: toggleTie },
    { kind: 'crescendo', on: wedge === 'crescendo', remove: removeWedge },
    { kind: 'diminuendo', on: wedge === 'diminuendo', remove: removeWedge },
  ]

  return (
    <div class="editor-marks">
      <div class="editor-marks-grid">
        {SINGLE_NOTE_MARKS.map(({ key, toggle }) => (
          <Chip key={key} pressed={note?.[key] === true} disabled={!note || (note.rest === true && key !== 'fermata')} onPress={() => id && run((s) => toggle(s, id))}>
            {t(`mark.${key}`)}
          </Chip>
        ))}
        {ORNAMENTS.map((kind) => (
          <Chip key={kind} pressed={note?.ornament === kind} disabled={off} onPress={() => id && run((s) => toggleOrnament(s, id, kind))}>
            {t(`mark.${kind}`)}
          </Chip>
        ))}
        <Chip pressed={note?.tremolo !== undefined} disabled={off} onPress={() => id && run((s) => toggleTremolo(s, id))}>
          {t('mark.tremolo')}
        </Chip>
        <Chip pressed={chord?.first.arpeggio === true} disabled={off || !chord?.inChord} onPress={() => id && run((s) => toggleArpeggio(s, id))}>
          {t('mark.arpeggio')}
        </Chip>
        {joined.map(({ kind, on, remove }) => (
          <Chip
            key={kind}
            pressed={on}
            picking={pick?.kind === kind}
            onPress={() => {
              if (on && id) run((s) => remove(s, id))
              else onPick(pick?.kind === kind ? null : kind)
            }}
          >
            {t(`mark.${kind}`)}
          </Chip>
        ))}
      </div>
      <p class="editor-hint editor-hint--pick" role="status">
        {pick ? (pick.first === null ? t('mark.pickFirst') : t('mark.pickLast')) : t('mark.hint.pair')}
      </p>
      <p class="editor-hint">{t('mark.hint.remove')}</p>
    </div>
  )
}

const STARTS: readonly BarStart[] = ['normal', 'repeat']
const ENDS: readonly BarEnd[] = ['normal', 'double', 'repeat']

export function BarLineGroup({ session, run }: ToolProps) {
  const { t } = useShell().i18n
  const bar = session.currentBar.value
  const lines = session.barLines.value
  const off = lines === undefined
  const index = bar - 1
  const id = session.selectedNote.value?.id

  /** One step more or fewer passes; the steps of a held button (`repeated`) are one undo step with the first. */
  const step = (direction: 1 | -1, repeated: boolean): void => {
    const now = barLinesOf(session.score.value, index).times
    const times = now + direction
    if (times < MIN_REPEAT_TIMES || times > MAX_REPEAT_TIMES) return
    run((s) => setRepeatTimes(s, index, times), undefined, { amend: repeated })
  }

  return (
    <section class="editor-grid editor-grid--score editor-barlines" aria-label={t('barline.group')}>
      <h3 class="editor-barlines-title">{t('bar.label', { bar })}</h3>
      <span class="editor-field-label">{t('barline.start')}</span>
      <SelectField
        label={t('barline.start')}
        value={lines?.start ?? 'normal'}
        disabled={off}
        options={STARTS.map((value) => ({ value, label: t(`barline.start.${value}`) }))}
        onChange={(value) => run((s) => setBarStart(s, index, value))}
      />
      <span class="editor-field-label">{t('barline.end')}</span>
      <SelectField
        label={t('barline.end')}
        value={lines?.end ?? 'normal'}
        disabled={off}
        options={ENDS.map((value) => ({ value, label: t(`barline.end.${value}`) }))}
        onChange={(value) => run((s) => setBarEnd(s, index, value))}
      />
      {/* Not offered after the last bar, nor where a page or a line of its photo ends (change edit-parts, D9). */}
      {!off && session.canRemoveBarLineAfter(index) ? (
        <div class="editor-barline-remove">
          <Chip onPress={() => run((s) => joinBars(s, index), (error) => barLineText(t, session.score.peek(), error))}>{t('barline.remove')}</Chip>
        </div>
      ) : null}
      {/* Not offered for the first note of a bar, which would leave an empty bar (change edit-parts, D9). */}
      {id && session.canAddBarLineBefore(id) ? (
        <div class="editor-barline-remove">
          <Chip onPress={() => run((s) => splitBar(s, id), (error) => barLineText(t, session.score.peek(), error))}>{t('note.barLine')}</Chip>
        </div>
      ) : null}
      {lines?.end === 'repeat' && (
        <>
          <span class="editor-field-label">{t('barline.times')}</span>
          <Stepper
            size="compact"
            label={t('barline.times')}
            value={t('barline.timesValue', { count: lines.times })}
            decrementLabel={t('barline.fewer')}
            incrementLabel={t('barline.more')}
            decrementDisabled={lines.times <= MIN_REPEAT_TIMES}
            incrementDisabled={lines.times >= MAX_REPEAT_TIMES}
            onDecrement={(repeated) => step(-1, repeated)}
            onIncrement={(repeated) => step(1, repeated)}
            repeat
          />
        </>
      )}
    </section>
  )
}
