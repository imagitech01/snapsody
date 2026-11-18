import type { EditorSession } from '../../../app/editorSession.ts'
import { DURATION_TYPES, deleteNote, insertNote, noteToRest, restToNote, setAccidental, setDuration, stepPitch } from '../../../core/score/edit.ts'
import type { AccidentalChoice } from '../../../core/score/edit.ts'
import type { NoteType, Score } from '../../../core/score/model.ts'
import { pitchName } from '../../../core/score/repairs.ts'
import { Stepper } from '../../components/index.ts'
import { useShell } from '../../ShellContext.ts'
import { Chip, SelectField } from './controls.tsx'

/**
 * The Note tab (frame 06.1, spec `score-editing` "Edit a note"): the pitch, its accidental, its length with
 * a dot or as a triplet, turning it into a rest and back, a note or a rest before or after it, and delete.
 * Everything acts on the selected note; with none selected the controls are there but off.
 */
export interface ToolProps {
  session: EditorSession
  /**
   * Runs an edit of the score as one undo step, or with `amend` as part of the last one (the steps of a
   * held button); when it cannot be done, the reason is shown instead.
   */
  run: (edit: (score: Score) => unknown, failure?: FailureKey, options?: { amend?: boolean }) => void
}

/** The texts that say why a change did not happen (none of them has a parameter). */
export type FailureKey = 'editor.error.edit' | 'mark.error.slur' | 'mark.error.tie' | 'mark.error.wedge' | 'practice.error.sound'

const ACCIDENTALS: readonly AccidentalChoice[] = ['sharp', 'flat', 'natural', 'none']

export function NoteTab({ session, run }: ToolProps) {
  const { i18n } = useShell()
  const { t } = i18n
  const note = session.selectedNote.value
  const id = note?.id
  const rest = note?.rest === true
  const off = note === undefined

  const accidental: AccidentalChoice = note?.accidental && (ACCIDENTALS as readonly string[]).includes(note.accidental) ? (note.accidental as AccidentalChoice) : 'none'
  const type: NoteType | undefined = note?.type
  const dotted = (note?.dots ?? 0) > 0
  const triplet = note?.timeMod?.actual === 3 && note.timeMod.normal === 2
  const lengthKnown = type !== undefined && (DURATION_TYPES as readonly string[]).includes(type)

  const length = (change: { type?: NoteType; dots?: number; triplet?: boolean }): void => {
    if (!id) return
    run((s) => setDuration(s, id, { type: change.type ?? type ?? 'quarter', dots: change.dots ?? note?.dots ?? 0, triplet: change.triplet ?? triplet }))
  }

  return (
    <div class="editor-grid">
      <span class="editor-field-label">{t('note.pitch')}</span>
      <div class="editor-row-pitch">
        <Stepper
          size="compact"
          label={t('note.pitch')}
          value={note?.pitch ? pitchName(note.pitch) : rest ? t('note.rest') : '–'}
          decrementLabel={t('note.pitch.down')}
          incrementLabel={t('note.pitch.up')}
          decrementDisabled={off || rest}
          incrementDisabled={off || rest}
          onDecrement={() => id && run((s) => stepPitch(s, id, -1))}
          onIncrement={() => id && run((s) => stepPitch(s, id, 1))}
        />
        <SelectField
          label={t('note.accidental')}
          value={accidental}
          disabled={off || rest}
          options={ACCIDENTALS.map((choice) => ({ value: choice, label: t(`accidental.${choice}`) }))}
          onChange={(choice) => id && run((s) => setAccidental(s, id, choice))}
        />
      </div>

      <span class="editor-field-label">{t('note.length')}</span>
      <div class="editor-row-length">
        <SelectField
          label={t('note.length')}
          value={lengthKnown && type ? type : ''}
          disabled={off}
          options={[
            ...(lengthKnown || off ? [] : [{ value: '', label: '–', disabled: true }]),
            ...DURATION_TYPES.map((choice) => ({ value: choice as string, label: t(`length.${choice as 'whole' | 'half' | 'quarter' | 'eighth' | '16th'}`) })),
          ]}
          onChange={(choice) => length({ type: choice as NoteType })}
        />
        <Chip pressed={dotted} disabled={off} onPress={() => length({ dots: dotted ? 0 : 1 })}>
          <span class="editor-chip-dot" aria-hidden="true" />
          {t('note.dotted')}
        </Chip>
        <Chip pressed={triplet} disabled={off} onPress={() => length({ triplet: !triplet })}>
          <span class="editor-chip-dot" aria-hidden="true" />
          {t('note.triplet')}
        </Chip>
      </div>

      <div class="editor-row-actions">
        <Chip disabled={off} onPress={() => id && run((s) => insertNote(s, id, 'before', 'note'))}>
          {t('note.before')}
        </Chip>
        <Chip disabled={off} onPress={() => id && run((s) => insertNote(s, id, 'after', 'note'))}>
          {t('note.after')}
        </Chip>
        <Chip tone="danger" disabled={off} onPress={() => id && run((s) => deleteNote(s, id))}>
          {t('note.delete')}
        </Chip>
      </div>
      <div class="editor-row-actions">
        <Chip disabled={off} onPress={() => id && run((s) => (rest ? restToNote(s, id) : noteToRest(s, id)))}>
          {rest ? t('note.toNote') : t('note.toRest')}
        </Chip>
        <Chip disabled={off} onPress={() => id && run((s) => insertNote(s, id, 'before', 'rest'))}>
          {t('note.restBefore')}
        </Chip>
        <Chip disabled={off} onPress={() => id && run((s) => insertNote(s, id, 'after', 'rest'))}>
          {t('note.restAfter')}
        </Chip>
      </div>
    </div>
  )
}
