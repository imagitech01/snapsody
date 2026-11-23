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
  /** Everything but the overview and the large bar: the header, the part switch, the bar row, the message row, the tools and Save & practice, with the gaps between them. */
  fixed: number
  /** The overview as one line of music (both staves of a two-staff part). */
  line: number
  /** The overview as a row of bar numbers. */
  numbers: number
}

/** How the frame is laid out: the overview as a line of music or as bar numbers, and whether the screen has to scroll. */
export interface FrameLayout {
  overview: 'line' | 'numbers'
  /** The screen is too low for even the smallest frame (a phone on its side): it scrolls as a whole, the overview a line. */
  scroll: boolean
}

/**
 * Design D13: the screen does not scroll, every row but the large bar has its own height, and the large bar gets what is
 * left, at least `MIN_SURFACE_PX`. When that does not fit with the overview as a line, the overview gives way first and
 * becomes a row of bar numbers. When not even that fits, the screen scrolls (outside D13, which is about a phone held
 * upright), with the overview as a line.
 *
 *   frameLayout({ screen: 780, fixed: 520, line: 100, numbers: 44 }) // { overview: 'line', scroll: false }
 *   frameLayout({ screen: 780, fixed: 520, line: 160, numbers: 44 }) // { overview: 'numbers', scroll: false }
 */
export function frameLayout(sizes: FrameSizes, minSurface = MIN_SURFACE_PX): FrameLayout {
  const room = sizes.screen - sizes.fixed
  if (room - sizes.line >= minSurface) return { overview: 'line', scroll: false }
  if (room - sizes.numbers >= minSurface) return { overview: 'numbers', scroll: false }
  return { overview: 'line', scroll: true }
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
