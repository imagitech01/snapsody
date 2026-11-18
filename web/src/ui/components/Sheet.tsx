import type { ComponentChildren } from 'preact'
import { useId, useRef } from 'preact/hooks'
import { useDialogFocus } from './dialogFocus.ts'

/**
 * A sheet that slides over the screen (frames 02.3 and 02.4): a scrim behind it, a handle, a title with
 * an optional line under it, a Close button, and the content. The router keeps the sheets
 * (`Router.overlays`); the screen shows this component for each one and calls `closeSheet` from
 * `onClose`. It has no open state of its own: mounted is open.
 *
 * It closes on a tap on the scrim (and only on the scrim, not on a tap that reaches it from inside
 * the sheet), on Close, and on a drag down that starts on the handle. A drag anywhere else in the
 * sheet is the content's own (scrolling). The system back button is the router's, not handled here.
 */
export interface SheetProps {
  title: string
  subtitle?: string
  /** The text of the Close button, in the user's language. */
  closeLabel: string
  onClose: () => void
  children: ComponentChildren
}

/** How far down the handle must be dragged, or how fast, to close the sheet. */
const CLOSE_DISTANCE = 96
const CLOSE_SPEED = 0.6 // px per ms

export function Sheet({ title, subtitle, closeLabel, onClose, children }: SheetProps) {
  const titleId = useId()
  const subtitleId = useId()
  const sheet = useRef<HTMLDivElement>(null)
  const drag = useRef<{ pointer: number; startY: number; startAt: number; dy: number } | null>(null)
  const moved = useRef(false)
  useDialogFocus(sheet)

  const move = (dy: number): void => {
    const element = sheet.current
    if (!element) return
    element.style.transform = dy > 0 ? `translateY(${dy}px)` : ''
  }

  return (
    <div
      class="sheet-backdrop"
      // A touch drag ends in no click, so the flag cannot wait for one: every new press starts afresh.
      onPointerDown={() => {
        moved.current = false
      }}
      onClick={(event) => {
        // A drag that began on the handle and ended on the scrim is not a tap on the scrim.
        if (moved.current) {
          moved.current = false
          return
        }
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={sheet}
        class="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitle ? subtitleId : undefined}
        tabIndex={-1}
      >
        {/* The handle is a gesture, not a control: Close is the control, so it is hidden from screen readers. */}
        <div
          class="sheet-handle-area"
          data-part="handle"
          aria-hidden="true"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId)
            drag.current = { pointer: event.pointerId, startY: event.clientY, startAt: event.timeStamp, dy: 0 }
            moved.current = false
            sheet.current?.classList.add('sheet--dragging')
          }}
          onPointerMove={(event) => {
            const d = drag.current
            if (!d || d.pointer !== event.pointerId) return
            d.dy = Math.max(0, event.clientY - d.startY)
            if (d.dy > 4) moved.current = true
            move(d.dy)
          }}
          onPointerUp={(event) => {
            const d = drag.current
            if (!d || d.pointer !== event.pointerId) return
            drag.current = null
            sheet.current?.classList.remove('sheet--dragging')
            const speed = d.dy / Math.max(1, event.timeStamp - d.startAt)
            if (d.dy >= CLOSE_DISTANCE || (d.dy > 24 && speed >= CLOSE_SPEED)) onClose()
            else move(0)
          }}
          onPointerCancel={() => {
            drag.current = null
            sheet.current?.classList.remove('sheet--dragging')
            move(0)
          }}
        >
          <div class="sheet-handle" />
        </div>
        <header class="sheet-header">
          <h2 id={titleId} class="sheet-title">
            {title}
          </h2>
          <button type="button" class="sheet-close" onClick={onClose}>
            {closeLabel}
          </button>
        </header>
        {subtitle ? (
          <p id={subtitleId} class="sheet-subtitle">
            {subtitle}
          </p>
        ) : null}
        <div class="sheet-content">{children}</div>
      </div>
    </div>
  )
}
