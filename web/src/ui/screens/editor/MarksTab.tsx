import { removeWedge, toggleAccent, toggleFermata, toggleSlur, toggleStaccato, toggleTenuto, toggleTie, wedgeAt } from '../../../core/score/edit.ts'
import type { Score } from '../../../core/score/model.ts'
import { useShell } from '../../ShellContext.ts'
import { Chip } from './controls.tsx'
import type { ToolProps } from './NoteTab.tsx'

/**
 * The Marks tab (frame 06.2, spec `score-editing` "Articulation marks" and "Crescendo and diminuendo").
 *
 * Staccato, tenuto, accent and fermata are on or off for the selected note; tapping an active one takes it
 * off. A slur, a tie, a crescendo and a diminuendo join two notes, so they are chosen by their first and
 * last note (design D14, the frame's own hint): the chip starts the choice, the editor waits for the two
 * taps on the score (`Editor.tsx`), and tapping the chip of a mark that the selected note already has
 * removes it.
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
  { key: 'tenuto', toggle: toggleTenuto },
  { key: 'accent', toggle: toggleAccent },
  { key: 'fermata', toggle: toggleFermata },
] as const satisfies readonly { key: string; toggle: (score: Score, id: string) => void }[]

export function MarksTab({ session, run, pick, onPick }: MarksTabProps) {
  const { i18n } = useShell()
  const { t } = i18n
  const note = session.selectedNote.value
  const score = session.score.value
  const id = note?.id
  const wedge = id ? wedgeAt(score, id)?.type : undefined

  const joined: readonly { kind: PickKind; on: boolean; remove: (score: Score, id: string) => void }[] = [
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
