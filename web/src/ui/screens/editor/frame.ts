import { describeElement, sameElement } from '../../../core/score/elements.ts'
import type { ElementRef } from '../../../core/score/elements.ts'
import type { Score } from '../../../core/score/model.ts'

/*
 * The rules of the editor's frame that are not drawing (change redesign-score-editor, design D1, D2 and D13), as plain
 * functions a quick test can prove: how the frame fits the screen, and how an element drawn in the large bar (a score of
 * one bar, `barForEditing`) is named in the score and back.
 */

/** The large bar's smallest height (design D13). */
export const MIN_SURFACE_PX = 170

/** What the frame measured, in CSS pixels. */
export interface FrameSizes {
  /** The height of the screen. */
  screen: number
  /** Everything but the photo line, the overview and the large bar: the header, the part switch, the bar row, the message row, the tools and Save & practice, with the gaps between them. */
  fixed: number
  /** The overview as one line of music (both staves of a two-staff part). */
  line: number
  /** The overview as a row of bar numbers. */
  numbers: number
  /** The photo line with the gap under it, or null where the photo is a key anyway: a two-staff part, or no photo. */
  photo: number | null
}

/** How the frame is laid out: the overview as a line of music or as bar numbers, the photo as a line or a key, and whether the screen has to scroll. */
export interface FrameLayout {
  overview: 'line' | 'numbers'
  photo: 'line' | 'key'
  /** The screen is too low for even the smallest frame (a phone on its side): it scrolls as a whole, the overview a line. */
  scroll: boolean
}

/**
 * How many pixels more than its minimum the large bar needs before the frame goes back to a fuller layout than the one it
 * has. The sizes are measured in whole pixels, and a fraction rounded one way in one layout and the other way in the next
 * would otherwise flip the frame between the two without end.
 */
export const SLACK_PX = 2

/**
 * Design D13: the screen does not scroll, every row but the large bar has its own height, and the large bar gets what is
 * left, at least `MIN_SURFACE_PX`. The photo line is 44 px high above the overview; in a two-staff part it is a key
 * instead (`photo` null). When the large bar does not get its minimum, the overview gives way first and becomes a row of
 * bar numbers; when that is not enough either, the photo line gives way next and becomes the key. When not even that
 * fits, the screen scrolls (outside D13, which is about a phone held upright), with the overview and the photo as lines.
 * `now` is the layout the frame has: going back to a fuller one needs `SLACK_PX` more.
 *
 *   frameLayout({ screen: 780, fixed: 457, line: 82, numbers: 44, photo: 50 }) // { overview: 'line', photo: 'line', scroll: false }
 *   frameLayout({ screen: 780, fixed: 509, line: 88, numbers: 50, photo: 50 }) // { overview: 'numbers', photo: 'line', scroll: false }
 */
export function frameLayout(sizes: FrameSizes, now?: FrameLayout, minSurface = MIN_SURFACE_PX): FrameLayout {
  const room = sizes.screen - sizes.fixed
  const photo = sizes.photo ?? 0
  const asLine = sizes.photo === null ? 'key' : 'line'
  // From the fullest to the barest, with the room each leaves the large bar.
  const options: [FrameLayout, number][] = [
    [{ overview: 'line', photo: asLine, scroll: false }, room - photo - sizes.line],
    [{ overview: 'numbers', photo: asLine, scroll: false }, room - photo - sizes.numbers],
    [{ overview: 'numbers', photo: 'key', scroll: false }, room - sizes.numbers],
  ]
  const at = now ? options.findIndex(([option]) => sameLayout(option, now)) : -1
  const current = now && at < 0 ? options.length : at
  for (const [k, [option, left]] of options.entries()) {
    if (left >= minSurface + (now && k < current ? SLACK_PX : 0)) return option
  }
  return { overview: 'line', photo: asLine, scroll: true }
}

/** Whether two layouts are the same. */
export function sameLayout(a: FrameLayout, b: FrameLayout): boolean {
  return a.overview === b.overview && a.photo === b.photo && a.scroll === b.scroll
}

/** The element references that name a bar: a clef, a key, a time signature or a bar line. */
type BarRef = Extract<ElementRef, { bar: number }>

const hasBar = (ref: ElementRef): ref is BarRef => 'bar' in ref

/**
 * An element tapped in the large bar of bar `index` (from 0) as the score names it. The large bar is the bar as a score of
 * its own, so what names a bar names bar 0 there: a bar line is bar `index`'s. A clef, key or time signature is drawn at
 * its start also where it does not change, as the one in force: it is the one of bar `index` when the bar has its own,
 * else the last one before it. Notes, marks and directions keep their ids in the excerpt and are the same. Undefined when
 * the score has no such element.
 */
export function fromExcerpt(score: Score, index: number, ref: ElementRef): ElementRef | undefined {
  if (!hasBar(ref)) return ref
  const shifted: BarRef = { ...ref, bar: index + ref.bar }
  if (shifted.kind === 'barline') return shifted
  for (let bar = shifted.bar; bar >= 0; bar--) {
    const candidate: BarRef = { ...shifted, bar }
    if (describeElement(score, candidate)) return candidate
  }
  return undefined
}

/**
 * A reference into the score as the large bar of bar `index` draws it (the selected element, to light it up there), or
 * undefined when that bar does not draw it: the reverse of `fromExcerpt`.
 */
export function toExcerpt(score: Score, index: number, ref: ElementRef): ElementRef | undefined {
  if (!hasBar(ref)) return ref
  const local: BarRef = { ...ref, bar: 0 }
  const back = fromExcerpt(score, index, local)
  return back && sameElement(back, ref) ? local : undefined
}
