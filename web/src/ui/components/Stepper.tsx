/**
 * A value with a minus and a plus (frames 02.3 and 06.1): the tempo control (`large`: white square
 * buttons around a big number with its unit under it) and the pitch control of the editor (`compact`:
 * "−  E5  +" in one pill). The value is text the caller formats ("60", "E5"); the names of the two
 * buttons and of the group come from the caller too ("Slower", "Faster", "Tempo"). A button whose end
 * is reached is disabled.
 */
export interface StepperProps {
  /** The name of the group ("Tempo"). */
  label: string
  value: string
  /** What the value counts, shown under a large value ("BPM"). */
  unit?: string
  decrementLabel: string
  incrementLabel: string
  onDecrement: () => void
  onIncrement: () => void
  decrementDisabled?: boolean
  incrementDisabled?: boolean
  size?: 'large' | 'compact'
}

export function Stepper({
  label,
  value,
  unit,
  decrementLabel,
  incrementLabel,
  onDecrement,
  onIncrement,
  decrementDisabled,
  incrementDisabled,
  size = 'large',
}: StepperProps) {
  return (
    <div class={`stepper stepper--${size}`} role="group" aria-label={label}>
      <button type="button" class="stepper-button" aria-label={decrementLabel} disabled={decrementDisabled} onClick={onDecrement}>
        <span aria-hidden="true">−</span>
      </button>
      <div class="stepper-value">
        {/* The number is announced when it changes, without taking the focus. */}
        <span class="stepper-number" role="status">
          {value}
        </span>
        {unit ? <span class="stepper-unit">{unit}</span> : null}
      </div>
      <button type="button" class="stepper-button" aria-label={incrementLabel} disabled={incrementDisabled} onClick={onIncrement}>
        <span aria-hidden="true">+</span>
      </button>
    </div>
  )
}
