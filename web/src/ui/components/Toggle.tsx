import { useId } from 'preact/hooks'

/**
 * A switch (frame 02.4's Favorite): a 36 x 22 track with a knob in a 44 x 44 touch box. It is a button
 * with `role="switch"` and `aria-checked`. Alone it needs a `label`; inside a ToggleRow the row's
 * title names it.
 */
export interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  /** The accessible name, when no visible text names the switch. */
  label?: string
  /** The id of the element that names the switch (a ToggleRow's title). */
  labelledBy?: string
  describedBy?: string
  disabled?: boolean
}

export function Toggle({ checked, onChange, label, labelledBy, describedBy, disabled }: ToggleProps) {
  return (
    <button
      type="button"
      class="toggle"
      role="switch"
      aria-checked={checked}
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span class="toggle-knob" />
    </button>
  )
}

/** A row of a sheet or a list with a title, a line under it and a switch (the whole row is not a button, the switch is). */
export interface ToggleRowProps {
  title: string
  description?: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}

export function ToggleRow({ title, description, checked, onChange, disabled }: ToggleRowProps) {
  const titleId = useId()
  const descriptionId = useId()
  return (
    <div class="list-row list-row--static">
      <div class="list-row-text">
        <span id={titleId} class="list-row-title">
          {title}
        </span>
        {description ? (
          <span id={descriptionId} class="list-row-subtitle">
            {description}
          </span>
        ) : null}
      </div>
      <div class="list-row-trailing">
        <Toggle checked={checked} onChange={onChange} labelledBy={titleId} describedBy={description ? descriptionId : undefined} disabled={disabled} />
      </div>
    </div>
  )
}
