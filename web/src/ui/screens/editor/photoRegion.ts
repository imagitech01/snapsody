import type { StaffBox } from '../../../app/library.ts'

/*
 * The part of a page photo the editor's photo strip shows for the selected bar (practice-app design D7, D14).
 *
 * The reader reports where each staff is, as fractions of the photo, and its box covers the staff lines
 * only: notes above and below the staff, ledger lines, tempo words and slurs sit outside it. The strip
 * therefore shows the box with a margin, more above and below (a staff is wide and low) than at the sides.
 * It shows the staff that holds the bar, not the bar itself (homr gives no bar positions).
 */

/** The margin above and below the box, as a share of the box's height. */
export const MARGIN_VERTICAL = 0.5
/** The margin left and right of the box, as a share of the photo's width. */
export const MARGIN_HORIZONTAL = 0.02

/** The box with its margin, kept inside the photo. All values are fractions of the photo's width and height. */
export function stripRegion(box: StaffBox): StaffBox {
  const x0 = Math.max(0, box.x - MARGIN_HORIZONTAL)
  const x1 = Math.min(1, box.x + box.width + MARGIN_HORIZONTAL)
  const y0 = Math.max(0, box.y - box.height * MARGIN_VERTICAL)
  const y1 = Math.min(1, box.y + box.height * (1 + MARGIN_VERTICAL))
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

/**
 * How to lay the photo out in a frame that shows only `region`: the photo is as many frames wide and high
 * as the region is small, and moved up and left by where the region starts (all in percent of the frame).
 * The frame's own proportions are those of the region on the photo (`aspect`, width over height, for a
 * photo of `photoWidth` by `photoHeight` pixels), so the crop is not stretched.
 */
export function stripLayout(
  region: StaffBox,
  photoWidth: number,
  photoHeight: number,
): { aspect: number; width: number; height: number; left: number; top: number } {
  return {
    aspect: (region.width * photoWidth) / (region.height * photoHeight),
    width: 100 / region.width,
    height: 100 / region.height,
    left: (-region.x / region.width) * 100,
    top: (-region.y / region.height) * 100,
  }
}
