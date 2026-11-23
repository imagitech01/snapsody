import type { ComponentChildren } from 'preact'
import type { EditorSession } from '../../../app/editorSession.ts'
import type { Score } from '../../../core/score/model.ts'
import { Icon } from '../../components/index.ts'

/*
 * The small controls of the editor's tools that no other screen has: a choice from a list (a clef, the key and the time
 * signature, the Grid's voice: a native `<select>` drawn as a "Treble ⌄" box, so the phone's own picker opens and the list
 * is read by screen readers), and a chip, a button that is on or off ("Dotted", "Staccato") or just does something
 * ("+ Note after"). And what the trays that change the score through the editor's `run` are given.
 */

/** What to say when an edit of a tray cannot be done (none of these texts has a parameter). */
export type Failure = 'editor.error.edit' | 'note.error.otherHand'

/** What the Notes tray and the Score tray are given. */
export interface ToolProps {
  session: EditorSession
  /**
   * Runs an edit of the score as one undo step, or with `amend` as part of the last one (the steps of a
   * held button); when it cannot be done, the reason is shown instead.
   */
  run: (edit: (score: Score) => unknown, failure?: Failure, options?: { amend?: boolean }) => void
}

export interface SelectFieldProps<T extends string> {
  /** The name of the field ("Accidental"). */
  label: string
  value: T
  options: readonly { value: T; label: string; disabled?: boolean }[]
  onChange: (value: T) => void
  disabled?: boolean
}

export function SelectField<T extends string>({ label, value, options, onChange, disabled }: SelectFieldProps<T>) {
  return (
    <label class="editor-select">
      <select aria-label={label} value={value} disabled={disabled} onChange={(event) => onChange(event.currentTarget.value as T)}>
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
      <Icon name="chevron-down" size={14} class="editor-select-chevron" />
    </label>
  )
}

export interface ChipProps {
  /** `danger` is the red "Delete note". */
  tone?: 'plain' | 'danger'
  /** A chip that switches something says whether it is on. */
  pressed?: boolean
  /** The chip's mark is armed: it goes on every note tapped (the Marks tray, spec "Ways to add a mark"). */
  armed?: boolean
  /** The name of a chip whose face is a sign ("♯", a note value) or shorter than its name ("Delete" for "Delete note"). */
  label?: string
  disabled?: boolean
  /**
   * Shown off but still tappable (`aria-disabled`): for a change that is not offered here, whose tap lets the session say
   * why on the message line ("This is the last bar read on its page, so it cannot be deleted.").
   */
  off?: boolean
  onPress: () => void
  children: ComponentChildren
}

export function Chip({ tone = 'plain', pressed, armed, label, disabled, off, onPress, children }: ChipProps) {
  const classes = ['editor-chip']
  if (tone === 'danger') classes.push('editor-chip--danger')
  if (pressed) classes.push('is-on')
  if (armed) classes.push('is-armed')
  if (off) classes.push('is-off')
  return (
    <button
      type="button"
      class={classes.join(' ')}
      aria-label={label}
      aria-pressed={pressed === undefined ? undefined : pressed}
      aria-disabled={off ? 'true' : undefined}
      disabled={disabled}
      onClick={onPress}
    >
      {children}
    </button>
  )
}
