import { useRef } from 'preact/hooks'

/**
 * A choice of one among a few (frames 02.3 "Rest between repeats" and 06.1's Note / Marks / Score).
 * It is a radio group of buttons: one is selected, the arrow keys move the selection, and only the
 * selected one is in the tab order. Two looks, both in Figma:
 *  - `pills`: separate equal pills, the selected one filled green (02.3);
 *  - `track`: one grey track holding the options, the selected one a white pill (06.1).
 */
export interface SegmentedOption<T extends string> {
  value: T
  label: string
}

export interface SegmentedControlProps<T extends string> {
  /** The name of the group ("Rest between repeats"). */
  label: string
  options: readonly SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  look?: 'pills' | 'track'
}

export function SegmentedControl<T extends string>({ label, options, value, onChange, look = 'pills' }: SegmentedControlProps<T>) {
  const group = useRef<HTMLDivElement>(null)
  const move = (from: number, step: number): void => {
    const next = options[(from + step + options.length) % options.length]
    if (!next) return
    onChange(next.value)
    // The new selection takes the focus, as in a native radio group.
    queueMicrotask(() => group.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus())
  }
  return (
    <div ref={group} class={`segmented segmented--${look}`} role="radiogroup" aria-label={label}>
      {options.map((option, index) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            class="segmented-option"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                event.preventDefault()
                move(index, 1)
              } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                event.preventDefault()
                move(index, -1)
              }
            }}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
