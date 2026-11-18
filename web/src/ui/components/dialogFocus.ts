import { useLayoutEffect } from 'preact/hooks'
import type { RefObject } from 'preact'

/**
 * Moves the focus into a sheet or a dialog when it opens and puts it back where it was when it
 * closes, so a keyboard or a screen reader lands in the layer and returns to the screen under it.
 */
export function useDialogFocus(ref: RefObject<HTMLElement | null>): void {
  // Layout effect: the focus is in the layer as soon as it is on screen, not a frame later.
  useLayoutEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null
    ref.current?.focus({ preventScroll: true })
    return () => {
      if (before?.isConnected) before.focus({ preventScroll: true })
    }
  }, [])
}
