import { useEffect, useRef } from 'preact/hooks'

/**
 * A value with a minus and a plus (frames 02.3 and 06.1): the tempo control (`large`: white square
 * buttons around a big number with its unit under it) and the pitch control of the editor (`compact`:
 * "−  E5  +" in one pill). The value is text the caller formats ("60", "E5"); the names of the two
 * buttons and of the group come from the caller too ("Slower", "Faster", "Tempo"). A button whose end
 * is reached is disabled.
 *
 * With `repeat`, holding a button down keeps stepping, faster the longer it is held, until it is let
 * go or its end is reached. A press steps at once (on the way down, not on release); the keyboard and
 * a screen reader still step once per activation. The steps after the first of a hold are called with
 * `repeated` true, so an editor can make the whole hold one undo step.
 */
export interface StepperProps {
  /** The name of the group ("Tempo"). */
  label: string
  value: string
  /** What the value counts, shown under a large value ("BPM"). */
  unit?: string
  decrementLabel: string
  incrementLabel: string
  onDecrement: (repeated: boolean) => void
  onIncrement: (repeated: boolean) => void
  decrementDisabled?: boolean
  incrementDisabled?: boolean
  size?: 'large' | 'compact'
  /** Holding a button keeps stepping. */
  repeat?: boolean
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
  repeat = false,
}: StepperProps) {
  return (
    <div class={`stepper stepper--${size}`} role="group" aria-label={label}>
      <StepButton label={decrementLabel} disabled={decrementDisabled} onStep={onDecrement} repeat={repeat}>
        −
      </StepButton>
      <div class="stepper-value">
        {/* The number is announced when it changes, without taking the focus. */}
        <span class="stepper-number" role="status">
          {value}
        </span>
        {unit ? <span class="stepper-unit">{unit}</span> : null}
      </div>
      <StepButton label={incrementLabel} disabled={incrementDisabled} onStep={onIncrement} repeat={repeat}>
        +
      </StepButton>
    </div>
  )
}

/** How long a button is held before it starts repeating, in ms. */
const REPEAT_DELAY = 400
/** The first pause between repeats, in ms; each next one is shorter, down to REPEAT_FASTEST. */
const REPEAT_FIRST = 150
const REPEAT_FASTEST = 30
const REPEAT_SPEEDUP = 0.9

interface StepButtonProps {
  label: string
  disabled?: boolean
  onStep: (repeated: boolean) => void
  repeat: boolean
  children: string
}

function StepButton({ label, disabled, onStep, repeat, children }: StepButtonProps) {
  // The latest handler: the value it steps from changes with every step while the button is held.
  const step = useRef(onStep)
  step.current = onStep
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // Set when a press already stepped, so the click that follows it does not step again.
  const pressed = useRef(false)

  const stop = (): void => {
    clearTimeout(timer.current)
    timer.current = undefined
  }

  // Let go anywhere (the finger may have slid off), or the end of the range was reached.
  useEffect(() => {
    if (!repeat) return
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
    window.addEventListener('blur', stop)
    return () => {
      stop()
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
      window.removeEventListener('blur', stop)
    }
  }, [repeat])
  useEffect(() => {
    if (disabled) stop()
  }, [disabled])

  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return
    stop()
    pressed.current = true
    step.current(false)
    const next = (pause: number): void => {
      timer.current = setTimeout(() => {
        step.current(true)
        next(Math.max(REPEAT_FASTEST, pause * REPEAT_SPEEDUP))
      }, pause)
    }
    timer.current = setTimeout(() => {
      step.current(true)
      next(REPEAT_FIRST)
    }, REPEAT_DELAY)
  }

  const onClick = (event: MouseEvent): void => {
    // A click from the keyboard (detail 0) always steps; one from a pointer only if its press did not.
    if (event.detail !== 0 && pressed.current) {
      pressed.current = false
      return
    }
    step.current(false)
  }

  return (
    <button
      type="button"
      class="stepper-button"
      aria-label={label}
      disabled={disabled}
      onClick={repeat ? onClick : () => onStep(false)}
      onPointerDown={repeat ? onPointerDown : undefined}
      onPointerLeave={repeat ? stop : undefined}
      onContextMenu={repeat ? (event) => event.preventDefault() : undefined}
    >
      <span aria-hidden="true">{children}</span>
    </button>
  )
}
