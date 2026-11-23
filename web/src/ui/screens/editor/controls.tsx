import type { ComponentChildren } from 'preact'
import { Icon } from '../../components/index.ts'

/*
 * The small controls of the editor's tools (frames 06.1 to 06.3) that no other screen has: a choice from
 * a list (the accidental, the length, the key and the time signature: a native `<select>` drawn as the
 * frames' "Natural ⌄" box, so the phone's own picker opens and the list is read by screen readers), and
 * a chip, a button that is on or off ("Dotted", "Staccato") or just does something ("+ Note after").
 */

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
  /** The chip waits for the notes to be chosen (slur, tie, crescendo, diminuendo). */
  picking?: boolean
  /** The chip's mark is armed: it goes on every note tapped (the Marks tray, spec "Ways to add a mark"). */
  armed?: boolean
  /** The name of a chip whose face is a sign ("♯", a note value) or shorter than its name ("Delete" for "Delete note"). */
  label?: string
  disabled?: boolean
  onPress: () => void
  children: ComponentChildren
}

export function Chip({ tone = 'plain', pressed, picking, armed, label, disabled, onPress, children }: ChipProps) {
  const classes = ['editor-chip']
  if (tone === 'danger') classes.push('editor-chip--danger')
  if (pressed) classes.push('is-on')
  if (picking) classes.push('is-picking')
  if (armed) classes.push('is-armed')
  return (
    <button type="button" class={classes.join(' ')} aria-label={label} aria-pressed={pressed === undefined ? undefined : pressed} disabled={disabled} onClick={onPress}>
      {children}
    </button>
  )
}
