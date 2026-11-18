import type { Position } from './scheduler.ts'
import type { PlaybackEvent } from './timeline.ts'

/*
 * The cursor (task 10.4, design D8): which event the listener hears now, and
 * when the view must scroll. The pure parts live here and are unit-tested; the
 * DOM driver at the bottom is verified on the phone.
 */

/** The audio-clock time of what the listener hears now: the clock minus the output latency. */
export function heardTime(clock: { currentTime: number }, latency: number): number {
  return clock.currentTime - latency
}

export interface CursorUpdate {
  /** The event to highlight changed (or playback ended: `event` undefined). */
  changed: boolean
  event: PlaybackEvent | undefined
  finished: boolean
}

/** Remembers the highlighted event so the view is touched only when it changes. */
export class CursorTracker {
  private shown: PlaybackEvent | undefined
  private readonly where: (audioTime: number) => Position
  private readonly now: () => number

  /** `where` resolves a time to a position (Scheduler.positionAt); `now` gives the heard time. */
  constructor(where: (audioTime: number) => Position, now: () => number) {
    this.where = where
    this.now = now
  }

  poll(): CursorUpdate {
    const p = this.where(this.now())
    // Between a restart (tempo change, tap) and its first note the heard position lags the new run by the
    // output latency: keep the note that is shown instead of blinking it off.
    if (!p.event && !p.finished && this.shown) return { changed: false, event: this.shown, finished: false }
    const changed = p.event !== this.shown
    this.shown = p.event
    return { changed, event: p.event, finished: p.finished }
  }

  reset(): void {
    this.shown = undefined
  }
}

export interface ScrollInput {
  /** Top and bottom of the current line, in viewport coordinates. */
  top: number
  bottom: number
  viewportHeight: number
  /** Space kept free above (a sticky header) and below the line. */
  marginTop?: number
  marginBottom?: number
}

/**
 * How far to scroll (positive = down) so the line is visible, or 0 when it already is.
 * A line that is off screen is brought to about a third of the viewport height, so the
 * following line is visible too.
 */
export function scrollDelta(input: ScrollInput): number {
  const marginTop = input.marginTop ?? 16
  const marginBottom = input.marginBottom ?? 16
  const visible = input.top >= marginTop && input.bottom <= input.viewportHeight - marginBottom
  if (visible) return 0
  return input.top - input.viewportHeight / 3
}

/** The score view as the cursor needs it. */
export interface HighlightTarget {
  elementsFor(noteId: string): { getBoundingClientRect(): { top: number; bottom: number } }[]
  highlight(noteIds: string[]): void
  clearHighlight(): void
}

export interface CursorDriverOptions {
  view: HighlightTarget
  tracker: CursorTracker
  /** Frame scheduling, `requestAnimationFrame` in the page. */
  frame?: (fn: () => void) => number
  cancelFrame?: (id: number) => void
  viewportHeight?: () => number
  /** Space at the bottom of the viewport taken by a fixed control bar. */
  marginBottom?: () => number
  scrollBy?: (dy: number) => void
}

/** Runs the tracker every animation frame, highlights the current note and keeps its line in view. */
export class CursorDriver {
  private id: number | undefined
  private readonly o: CursorDriverOptions

  constructor(options: CursorDriverOptions) {
    this.o = options
  }

  start(): void {
    this.o.tracker.reset()
    const frame = this.o.frame ?? ((fn) => globalThis.requestAnimationFrame(fn))
    const loop = (): void => {
      this.step()
      this.id = frame(loop)
    }
    this.id = frame(loop)
  }

  step(): void {
    const update = this.o.tracker.poll()
    if (!update.changed) return
    if (!update.event) {
      this.o.view.clearHighlight()
      return
    }
    this.o.view.highlight(update.event.noteIds)
    const el = this.o.view.elementsFor(update.event.noteIds[0]!)[0]
    if (!el) return
    const rect = el.getBoundingClientRect()
    const height = this.o.viewportHeight?.() ?? globalThis.innerHeight
    const bottom = this.o.marginBottom?.()
    const dy = scrollDelta({ top: rect.top, bottom: rect.bottom, viewportHeight: height, ...(bottom === undefined ? {} : { marginBottom: bottom }) })
    if (dy !== 0) (this.o.scrollBy ?? ((d) => globalThis.scrollBy({ top: d, behavior: 'smooth' })))(dy)
  }

  stop(): void {
    if (this.id !== undefined) (this.o.cancelFrame ?? ((id) => globalThis.cancelAnimationFrame(id)))(this.id)
    this.id = undefined
    this.o.view.clearHighlight()
  }
}
