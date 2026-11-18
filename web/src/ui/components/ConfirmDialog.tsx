import { useId, useRef } from 'preact/hooks'
import type { ConfirmOptions } from '../../app/router.ts'
import { useDialogFocus } from './dialogFocus.ts'

/**
 * The question the router asks with `Router.confirm` (delete a piece, throw away edits): a centred
 * dialog over a scrim, a title, an optional message and two buttons. The props are the router's
 * `ConfirmOptions` as they are (the texts are already in the user's language) plus the answer, so a
 * screen passes `overlay.options` through and calls `router.answerDialog` from `onAnswer`.
 *
 * Cancel is the safe button: it comes first, and a tap on the scrim answers "no" too. A destructive
 * confirm is drawn in the danger colour.
 */
export interface ConfirmDialogProps extends ConfirmOptions {
  onAnswer: (accepted: boolean) => void
}

export function ConfirmDialog({ title, message, confirmLabel, cancelLabel, destructive, onAnswer }: ConfirmDialogProps) {
  const titleId = useId()
  const messageId = useId()
  const dialog = useRef<HTMLDivElement>(null)
  useDialogFocus(dialog)
  return (
    <div
      class="dialog-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onAnswer(false)
      }}
    >
      <div
        ref={dialog}
        class="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={message ? messageId : undefined}
        tabIndex={-1}
      >
        <h2 id={titleId} class="dialog-title">
          {title}
        </h2>
        {message ? (
          <p id={messageId} class="dialog-message">
            {message}
          </p>
        ) : null}
        <div class="dialog-actions">
          <button type="button" class="button button--secondary button--large" onClick={() => onAnswer(false)}>
            <span>{cancelLabel}</span>
          </button>
          <button
            type="button"
            class={`button button--large ${destructive ? 'button--danger-solid' : 'button--primary'}`}
            onClick={() => onAnswer(true)}
          >
            <span>{confirmLabel}</span>
          </button>
        </div>
      </div>
    </div>
  )
}
