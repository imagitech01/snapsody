import type { EditorSession } from '../../../app/editorSession.ts'
import { DURATION_TYPES, addChordNote, insertNote, moveToOtherStaff, setAccidental, setDuration, stepPitch } from '../../../core/score/edit.ts'
import type { AccidentalChoice } from '../../../core/score/edit.ts'
import type { Note, NoteType } from '../../../core/score/model.ts'
import { Stepper } from '../../components/index.ts'
import { useShell } from '../../ShellContext.ts'
import { Chip } from './controls.tsx'
import type { ToolProps } from './NoteTab.tsx'

/**
 * The Notes tray (change redesign-score-editor, task 6.3; spec `score-editing` "Notes tools", "Notes view"): with a note
 * or rest selected, its keys change it; with nothing selected, the lengths, Dotted and Rest set what the next tap on the
 * staff adds (`tapChoice`), and the keys that need a note are off. From the top:
 *
 * 1. With a note or rest selected: its name with Pitch down and Pitch up, and its length with Shorter and Longer (design
 *    D2's "name and length, Shorter and Longer"; the pitch keys are the drag's way for a keyboard and a screen reader).
 * 2. The lengths whole to sixteenth, and Dotted.
 * 3. Rest (a note becomes a rest and back), flat, sharp and natural (a tap on the one the note has takes it off),
 *    Triplet, and Delete.
 * 4. A note or rest before and after the selected one (of its kind and length), a chord note, and in a part of two
 *    staves the move to the other hand.
 *
 * The tray is three rows of keys high and scrolls inside itself (design D13), so with a note selected the last row is
 * reached by scrolling. Every edit is one undo step; a refused one says why on the message line.
 */
export interface NotesTrayProps extends ToolProps {
  /** Before an action: what the editor says goes. */
  onQuiet: () => void
}

const ACCIDENTALS = ['flat', 'sharp', 'natural'] as const satisfies readonly AccidentalChoice[]
const GLYPH: Readonly<Record<(typeof ACCIDENTALS)[number], string>> = { flat: '♭', sharp: '♯', natural: '♮' }

/** The lengths of the tray, with their names. */
type Value = 'whole' | 'half' | 'quarter' | 'eighth' | '16th'
const VALUES = DURATION_TYPES as readonly Value[]

const isTriplet = (note: Note | undefined): boolean => note?.timeMod?.actual === 3 && note.timeMod.normal === 2

/** A note value drawn small: a head, and a stem and flags as the value has. */
function ValueIcon({ value }: { value: Value }) {
  const hollow = value === 'whole' || value === 'half'
  const flags = value === 'eighth' ? 1 : value === '16th' ? 2 : 0
  return (
    <svg class="editor-value-icon" width="20" height="28" viewBox="0 0 20 28" aria-hidden="true">
      <ellipse cx="8" cy="22" rx="5" ry="3.6" transform="rotate(-20 8 22)" fill={hollow ? 'none' : 'currentColor'} stroke="currentColor" stroke-width="1.6" />
      {value === 'whole' ? null : <line x1="12.4" y1="21" x2="12.4" y2="3" stroke="currentColor" stroke-width="1.6" />}
      {Array.from({ length: flags }, (_, k) => (
        <path key={k} d={`M12.4 ${3 + k * 5} q1 4 5.6 6.5`} fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
      ))}
    </svg>
  )
}

export function NotesTray({ session, run, onQuiet }: NotesTrayProps) {
  const { i18n } = useShell()
  const { t } = i18n
  const note = session.selectedNote.value
  const choice = session.tapChoice.value
  const id = note?.id
  const selected = note !== undefined
  const rest = selected ? note.rest === true : choice.rest
  const tone = selected && !note.rest && note.pitch !== undefined
  const type = selected ? note.type : choice.type
  const dots = selected ? note.dots : choice.dots
  const triplet = isTriplet(note)
  const at = type ? VALUES.indexOf(type as Value) : -1
  // "To other hand" is there only in a part with two staves (the piano).
  const twoStaves = session.score.value.parts.find((p) => p.id === session.part.value)?.staves === 2

  /** Runs an action after the editor's message goes. */
  const act = (action: () => unknown) => () => {
    onQuiet()
    action()
  }

  const valueName = at >= 0 ? t(`notes.kind.${VALUES[at]!}`) : '–'
  const lengthText = !selected ? '' : triplet ? t(dots > 0 ? 'notes.length.dottedTriplet' : 'notes.length.triplet', { value: valueName }) : dots > 0 ? t('notes.length.dotted', { value: valueName }) : valueName

  return (
    <div class="editor-notes">
      {selected ? (
        <div class="editor-notes-row editor-notes-selected">
          <Stepper
            size="compact"
            label={t('note.pitch')}
            value={tone ? session.selectedNoteName.value : t('note.rest')}
            decrementLabel={t('note.pitch.down')}
            incrementLabel={t('note.pitch.up')}
            decrementDisabled={!tone}
            incrementDisabled={!tone}
            onDecrement={() => id && (onQuiet(), run((s) => stepPitch(s, id, -1)))}
            onIncrement={() => id && (onQuiet(), run((s) => stepPitch(s, id, 1)))}
          />
          <Stepper
            size="compact"
            label={t('note.length')}
            value={lengthText}
            decrementLabel={t('notes.shorter')}
            incrementLabel={t('notes.longer')}
            decrementDisabled={at < 0 || at === VALUES.length - 1}
            incrementDisabled={at <= 0}
            onDecrement={act(() => session.changeLength(-1))}
            onIncrement={act(() => session.changeLength(1))}
          />
        </div>
      ) : null}

      <div class="editor-notes-row editor-notes-keys" role="group" aria-label={t('notes.values')}>
        {VALUES.map((value) => (
          <Chip key={value} label={t(`notes.value.${value}`)} pressed={type === value} onPress={act(() => session.chooseLength(value))}>
            <ValueIcon value={value} />
          </Chip>
        ))}
        <Chip pressed={dots > 0} disabled={selected && at < 0} onPress={act(() => session.toggleDotted())}>
          {t('note.dotted')}
        </Chip>
      </div>

      <div class="editor-notes-row editor-notes-keys">
        <Chip pressed={rest} onPress={act(() => session.chooseRest(!rest))}>
          {t('note.rest')}
        </Chip>
        {ACCIDENTALS.map((accidental) => (
          <Chip
            key={accidental}
            label={t(`accidental.${accidental}`)}
            pressed={tone && note.accidental === accidental}
            disabled={!tone}
            onPress={() => id && (onQuiet(), run((s) => setAccidental(s, id, note?.accidental === accidental ? 'none' : accidental)))}
          >
            <span class="editor-notes-glyph">{GLYPH[accidental]}</span>
          </Chip>
        ))}
        <Chip
          pressed={triplet}
          disabled={!selected || at < 0}
          onPress={() => id && type && (onQuiet(), run((s) => setDuration(s, id, { type: type as NoteType, dots, triplet: !triplet })))}
        >
          {t('note.triplet')}
        </Chip>
        <Chip tone="danger" label={t('note.delete')} disabled={!selected} onPress={act(() => id && session.deleteNote(id))}>
          {t('notes.delete')}
        </Chip>
      </div>

      <div class="editor-notes-row editor-notes-actions">
        <Chip disabled={!selected} onPress={() => id && (onQuiet(), run((s) => insertNote(s, id, 'before', rest ? 'rest' : 'note')))}>
          {t('notes.before')}
        </Chip>
        <Chip disabled={!selected} onPress={() => id && (onQuiet(), run((s) => insertNote(s, id, 'after', rest ? 'rest' : 'note')))}>
          {t('notes.after')}
        </Chip>
        <Chip disabled={!tone} onPress={() => id && (onQuiet(), run((s) => addChordNote(s, id)))}>
          {t('note.chordNote')}
        </Chip>
        {twoStaves ? (
          <Chip disabled={!tone || note?.grace === true} onPress={() => id && (onQuiet(), run((s) => moveToOtherStaff(s, id), 'note.error.otherHand'))}>
            {t('note.otherHand')}
          </Chip>
        ) : null}
      </div>
    </div>
  )
}
