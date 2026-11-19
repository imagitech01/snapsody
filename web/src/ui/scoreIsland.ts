import { effect } from '@preact/signals'
import type { ReadonlySignal } from '@preact/signals'
import { CursorDriver, CursorTracker, scrollDelta } from '../core/playback/cursor.ts'
import type { HighlightTarget } from '../core/playback/cursor.ts'
import type { Position } from '../core/playback/scheduler.ts'
import type { Score } from '../core/score/model.ts'
import type { ElementRef } from '../core/score/elements.ts'
import type { NoteInfo } from '../core/score/noteMap.ts'
import { createScoreView } from './scoreView.ts'
import type { ScoreView } from './scoreView.ts'

/*
 * The score island (practice-app task 11.3, design D3): the engraved score and everything that moves on it
 * while music plays, drawn and updated by plain DOM code. Preact (`ScoreIsland.tsx`) mounts it once and
 * never touches what is inside; playback never re-renders it. Nothing here knows the session or the
 * router: it takes signals to read and callbacks to call, which `PracticeSession` fits as it is
 * (`bar`, `following`, `shownBar`, `state`, `heard()`, `showBar`).
 *
 * What it draws:
 *  - the score, laid out for the width it has (the whole island is the width of the phone in portrait and
 *    wider in landscape, so a rotation lays the bars out again: more of them in a line);
 *  - the bar the music is in, as a tinted box behind the staff, and a cursor line at the note that
 *    sounds, with the note itself in the accent colour (`hl`);
 *  - while the music is not playing, the bar the user is at (`bar`), with the cursor at its start; when that bar
 *    changes (Restart, a tap) and the view follows, it is brought into view.
 *
 * Following. The island is its own scroller. While `following` is on and the music plays, it scrolls so
 * that the sounding bar stays in view (`scrollDelta`, the same rule as before). A drag, a wheel turn or a
 * key press that moves the score ends that: it calls `onScrollAway(bar)` with the bar at the top of the
 * view (the session turns that into `showBar`), the island stops scrolling by itself, and the music and
 * the highlight go on. It is the user's input that is looked for, not the scroll event: the island's own
 * scrolls would otherwise stop the following they serve. Following that comes back (`following` goes from
 * false to true: "Return to playing") scrolls to the sounding bar at once; `shownBar` set from elsewhere
 * ("Go to bar") scrolls to that bar.
 *
 * A re-layout (rotation, another score) drops the drawing and with it the highlight and the position. The
 * island keeps the bar that matters in view: the sounding bar while it follows, else the bar that was at
 * the top.
 */

export interface ScoreIslandOptions {
  score: Score
  /** The bar the user is at, from 1 (`PracticeSession.bar`). */
  bar: ReadonlySignal<number>
  /** Whether the view scrolls along with the sounding bar (`PracticeSession.following`). */
  following: ReadonlySignal<boolean>
  /** The bar the user asked to see while the music plays elsewhere, or null (`PracticeSession.shownBar`). */
  shownBar: ReadonlySignal<number | null>
  /** Whether the music is playing, which is when the cursor follows `heard()`. */
  playing: ReadonlySignal<boolean>
  /** The position being heard (`PracticeSession.heard`), looked at once per frame while `playing`. */
  heard: () => Position | undefined
  /** Notes to show as selected (the editor), by id. */
  selected?: ReadonlySignal<readonly string[]>
  /** Notes to show as flagged (the editor's warnings about a note), by id, and the notes of the bars that are flagged. */
  flagged?: ReadonlySignal<readonly string[]>
  flaggedBars?: ReadonlySignal<readonly string[]>
  /** The user moved the score while it followed: the bar now at the top, from 1. */
  onScrollAway: (bar: number) => void
  /** The user tapped a note or rest. */
  onTapNote: (noteId: string, info: NoteInfo) => void
  /**
   * Opt-in (the editor): taps first look for the element under the finger (a clef, a dynamic, a slur, a bar
   * line, ...), then for a note; a tap on neither calls this with undefined. Without it, taps are notes only.
   */
  onTapElement?: (ref: ElementRef | undefined) => void
  /** The element to show as selected (the editor), by reference. */
  selectedElement?: ReadonlySignal<ElementRef | undefined>
}

export interface ScoreIslandHandle {
  /** Shows another score (after an edit). The same score again does nothing. */
  setScore(score: Score): Promise<void>
  /** Settles when the first layout is drawn. */
  readonly ready: Promise<void>
  /** The view, once there is one (for tests and the editor's needs); the island owns it. */
  readonly view: ScoreView
  dispose(): void
}

/** Space between the top of the island and a bar that is shown at the top. */
const EDGE_PX = 8
/** How long after the last touch, wheel or key press a scroll still counts as the user's (a fling goes on after the finger). */
const INPUT_WINDOW_MS = 1500
/** Quiet time before the bar at the top is reported again while the user keeps scrolling. */
const REPORT_DELAY_MS = 120
/** The bar box reaches this far past the drawing of the bar, above and below. */
const BAR_PAD_PX = 4

const NOT_PLAYING: Position = { beat: 0, event: undefined, finished: false }

/** The events that tell the island the user is moving the score (a tap does not: a tap is a seek). */
const SCROLL_INPUT = ['touchmove', 'wheel', 'keydown'] as const

export function mountScoreIsland(root: HTMLElement, options: ScoreIslandOptions): ScoreIslandHandle {
  const surface = document.createElement('div')
  surface.className = 'score-surface'
  const barBox = document.createElement('div')
  barBox.className = 'score-bar'
  const cursorLine = document.createElement('div')
  cursorLine.className = 'score-cursor'
  const host = document.createElement('div')
  host.className = 'score-host'
  barBox.hidden = true
  cursorLine.hidden = true
  surface.append(barBox, cursorLine, host)
  root.replaceChildren(surface)

  let score = options.score
  let disposed = false
  /** The note under the cursor while playing: what `heard()` last gave. */
  let shown: { noteIds: string[]; barIndex: number } | undefined
  let firstLayout = true
  let anchor: { barIndex: number; how: 'top' | 'visible' } | undefined
  let lastInput = Number.NEGATIVE_INFINITY
  let programmaticAt = Number.NEGATIVE_INFINITY
  /** The bar this island itself last reported or scrolled to, so that `shownBar` coming back round does not scroll again. */
  let lastReported: number | undefined
  let reportTimer: number | undefined
  const stops: (() => void)[] = []

  const now = (): number => performance.now()

  // ---- Geometry ---------------------------------------------------------------------------------

  /** The top and bottom of a bar in the island's own coordinates (0 is the top of what is visible). */
  const barRect = (barIndex: number): { top: number; bottom: number } | undefined => {
    const element = view.barElement(barIndex)
    if (!element) return undefined
    const rect = element.getBoundingClientRect()
    const top = root.getBoundingClientRect().top
    return { top: rect.top - top, bottom: rect.bottom - top }
  }

  /** The bar at the top of what is visible: the first one that is not scrolled out above. */
  const topBar = (): number => {
    const top = root.getBoundingClientRect().top + EDGE_PX
    for (let index = 0; index < view.barCount; index++) {
      const rect = view.barElement(index)?.getBoundingClientRect()
      if (rect && rect.bottom > top) return index
    }
    return 0
  }

  const scrollBy = (dy: number, smooth: boolean): void => {
    if (Math.abs(dy) < 1) return
    programmaticAt = now()
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
    root.scrollBy({ top: dy, behavior: smooth && !reduced ? 'smooth' : 'auto' })
  }

  /** `top` puts the bar at the top of the island; `visible` scrolls only when it is not in view (and then by the cursor's rule). */
  const scrollToBar = (barIndex: number, how: 'top' | 'visible', smooth = true): void => {
    const rect = barRect(barIndex)
    if (!rect) return
    const dy = how === 'top' ? rect.top - EDGE_PX : scrollDelta({ top: rect.top, bottom: rect.bottom, viewportHeight: root.clientHeight })
    scrollBy(dy, smooth)
  }

  // ---- The bar and the cursor -------------------------------------------------------------------

  const hideCursor = (): void => {
    barBox.hidden = true
    cursorLine.hidden = true
  }

  /** Puts the bar box on a bar, and the cursor line at a note of it (or at its start). */
  const showAt = (barIndex: number | undefined, noteId: string | undefined): void => {
    const element = barIndex === undefined ? undefined : view.barElement(barIndex)
    if (!element) return hideCursor()
    const rect = element.getBoundingClientRect()
    const origin = surface.getBoundingClientRect()
    barBox.hidden = false
    barBox.style.left = `${Math.round(rect.left - origin.left)}px`
    barBox.style.top = `${Math.round(rect.top - origin.top - BAR_PAD_PX)}px`
    barBox.style.width = `${Math.round(rect.width)}px`
    barBox.style.height = `${Math.round(rect.height + BAR_PAD_PX * 2)}px`
    const note = noteId === undefined ? undefined : view.elementsFor(noteId)[0]
    const head = note?.querySelector('.notehead') ?? note
    if (!head) {
      cursorLine.hidden = true
      return
    }
    const headRect = head.getBoundingClientRect()
    cursorLine.hidden = false
    cursorLine.style.left = `${Math.round(headRect.left - origin.left) - 2}px`
    cursorLine.style.top = `${Math.round(rect.top - origin.top)}px`
    cursorLine.style.height = `${Math.round(rect.height)}px`
  }

  /** Draws what the island should show now: the sounding note while playing, else the bar the user is at. */
  const applyHighlight = (): void => {
    if (disposed) return
    if (options.playing.value && shown) {
      view.highlight(shown.noteIds)
      showAt(shown.barIndex, shown.noteIds[0])
    } else {
      view.clearHighlight()
      const barIndex = options.bar.value - 1
      showAt(barIndex, view.firstNoteOf(barIndex))
    }
  }

  // ---- The score --------------------------------------------------------------------------------

  const view: ScoreView = createScoreView(host, score, {
    onTap: (info) => options.onTapNote(info.note.id, info),
    ...(options.onTapElement ? { onTapElement: (ref: ElementRef | undefined) => options.onTapElement?.(ref) } : {}),
    // The old drawing is still there: remember what to bring back into view once the new one is.
    onBeforeRender: () => {
      if (firstLayout) return
      const sounding = options.playing.peek() && shown ? shown.barIndex : undefined
      anchor = options.following.peek() && sounding !== undefined ? { barIndex: sounding, how: 'visible' } : { barIndex: topBar(), how: 'top' }
    },
    onRender: () => {
      if (disposed) return
      const wanted = firstLayout ? { barIndex: options.bar.peek() - 1, how: 'visible' as const } : anchor
      firstLayout = false
      anchor = undefined
      if (wanted) scrollToBar(wanted.barIndex, wanted.how, false)
      applyHighlight()
    },
  })

  // ---- The cursor follows playback --------------------------------------------------------------

  const target: HighlightTarget = {
    // The cursor decides whether to scroll from where the line is: the line of the note is the bar's.
    elementsFor: (noteId) => {
      const barIndex = view.barOf(noteId)
      const rect = barIndex === undefined ? undefined : barRect(barIndex)
      return rect ? [{ getBoundingClientRect: () => rect }] : []
    },
    highlight: (noteIds) => {
      const barIndex = view.barOf(noteIds[0] ?? '')
      shown = barIndex === undefined ? undefined : { noteIds: [...noteIds], barIndex }
      applyHighlight()
    },
    clearHighlight: () => {
      shown = undefined
      applyHighlight()
    },
  }
  const driver = new CursorDriver({
    view: target,
    tracker: new CursorTracker(
      () => options.heard() ?? NOT_PLAYING,
      () => 0,
    ),
    viewportHeight: () => root.clientHeight,
    scrollBy: (dy) => {
      if (options.following.peek()) scrollBy(dy, true)
    },
  })
  let running = false
  stops.push(
    effect(() => {
      const playing = options.playing.value
      if (playing === running) return
      running = playing
      if (playing) driver.start()
      else driver.stop()
    }),
  )
  // The bar the user is at is shown while the music does not play (and when playing has nothing to show).
  stops.push(
    effect(() => {
      void options.playing.value
      void options.bar.value
      applyHighlight()
    }),
  )
  // The bar the user is at moves while the music is not playing (Restart, a tap, "Go to bar" on the loop): bring it into view,
  // unless the view is not following (the user looked elsewhere on purpose). While playing, the cursor does the scrolling.
  let lastBar = options.bar.peek()
  stops.push(
    effect(() => {
      const bar = options.bar.value
      if (bar === lastBar) return
      lastBar = bar
      if (options.playing.peek() || !options.following.peek()) return
      scrollToBar(bar - 1, 'visible')
    }),
  )
  stops.push(
    effect(() => {
      const ids = options.selected?.value ?? []
      view.mark('sel', [...ids])
    }),
  )
  stops.push(
    effect(() => {
      view.markElement(options.selectedElement?.value)
    }),
  )
  stops.push(
    effect(() => {
      view.mark('flag', [...(options.flagged?.value ?? [])])
      view.mark('flagbar', [...(options.flaggedBars?.value ?? [])])
    }),
  )

  // Following comes back: show the sounding bar at once (the driver scrolls only when the note changes).
  let wasFollowing = options.following.peek()
  stops.push(
    effect(() => {
      const following = options.following.value
      if (following && !wasFollowing) {
        lastReported = undefined
        const barIndex = options.playing.peek() && shown ? shown.barIndex : options.bar.peek() - 1
        scrollToBar(barIndex, 'visible')
      }
      wasFollowing = following
    }),
  )
  // A bar to look at that did not come from this island's own scrolling ("Go to bar"): show it.
  stops.push(
    effect(() => {
      const bar = options.shownBar.value
      if (bar === null || bar === lastReported) return
      lastReported = bar
      scrollToBar(bar - 1, 'top')
    }),
  )

  // ---- The user moves the score -----------------------------------------------------------------

  const noteInput = (event: Event): void => {
    // A mouse press may be on the scroll bar; a touch press is a tap or the start of a drag, told by touchmove.
    if (event.type === 'pointerdown' && (event as PointerEvent).pointerType !== 'mouse') return
    lastInput = now()
  }
  const inputEvents = [...SCROLL_INPUT, 'pointerdown'] as const
  for (const type of inputEvents) root.addEventListener(type, noteInput, { passive: true })

  const report = (): void => {
    const bar = topBar() + 1
    lastReported = bar
    options.onScrollAway(bar)
  }
  const onScroll = (): void => {
    if (disposed) return
    // Ours (a follow scroll, "Go to bar", a layout) comes after the last input; the user's comes after our last scroll.
    if (!(lastInput > programmaticAt && now() - lastInput < INPUT_WINDOW_MS)) return
    // Scrolling matters while the view follows, and, to keep "Showing bar N" true, once it has stopped.
    if (!options.following.peek() && options.shownBar.peek() === null) return
    window.clearTimeout(reportTimer)
    if (options.shownBar.peek() === null) report()
    else reportTimer = window.setTimeout(report, REPORT_DELAY_MS)
  }
  root.addEventListener('scroll', onScroll, { passive: true })

  const ready = view.rendered.then(
    () => undefined,
    (error: unknown) => {
      // The drawing failed (Verovio could not read the score): say so in the page, never throw into the app.
      console.error('score island: the score could not be drawn', error)
      root.dataset.error = error instanceof Error ? error.message : String(error)
    },
  )

  return {
    ready,
    view,
    async setScore(next) {
      if (next === score) return
      score = next
      await view.setScore(next)
    },
    dispose() {
      if (disposed) return
      disposed = true
      for (const stop of stops) stop()
      driver.stop()
      for (const type of inputEvents) root.removeEventListener(type, noteInput)
      root.removeEventListener('scroll', onScroll)
      window.clearTimeout(reportTimer)
      view.dispose()
    },
  }
}
