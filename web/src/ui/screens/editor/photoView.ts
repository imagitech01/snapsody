import type { StaffBox } from '../../../app/library.ts'

/*
 * The maths of the photo line and of the photo shown large (change redesign-score-editor, design D10, spec "Line from the
 * photo"), as plain functions a quick test can prove; `PhotoLine.tsx` draws with them.
 *
 * The reader reports where each line of music (staff) is, as fractions of the photo, and its box covers the staff lines
 * only: notes above and below, ledger lines, tempo words and slurs sit outside it. So the line is shown with a margin,
 * more above and below (a staff is wide and low) than at the sides. It is the line that holds the bar, not the bar
 * itself: the reader gives no bar positions. (The margins and the crop are those of the photo strip removed on
 * 2026-11-19, `photoRegion.ts`.)
 *
 * The large view places the photo by a `View`: a point of the photo at (px, py), in pixels of the photo, is drawn at
 * (x + scale * px, y + scale * py) in CSS pixels of the view. A pinch zooms about the fingers and a drag moves; both are
 * kept so that the photo never leaves a gap at an edge it could fill, and is centred where it is smaller than the view.
 */

/**
 * The height of the photo line above the overview, in CSS pixels: design D13 says 40, but the line is a control, and
 * every control of the app is at least 44 x 44.
 */
export const PHOTO_LINE_PX = 44

/** The margin above and below the line's box, as a share of the box's height. */
export const MARGIN_VERTICAL = 0.5
/** The margin left and right of the line's box, as a share of the photo's width. */
export const MARGIN_HORIZONTAL = 0.02

/** How much larger the large view opens on the line than the line is when it spans the width of the view (as the mock does). */
export const START_ZOOM = 2.5

/** How far the large view zooms in past the whole page, at least: 8 times. */
export const MAX_ZOOM = 8
/** And at least as far as this many CSS pixels per pixel of the photo, for a photo of many pixels. */
export const MAX_SCALE = 2

export interface Size {
  width: number
  height: number
}

export interface Point {
  x: number
  y: number
}

/** Where the photo is in the large view: its scale (CSS pixels per pixel of the photo) and where its top left corner is. */
export interface View {
  scale: number
  x: number
  y: number
}

/** The line's box with its margin, kept inside the photo. All values are fractions of the photo's width and height. */
export function lineRegion(box: StaffBox): StaffBox {
  const x0 = Math.max(0, box.x - MARGIN_HORIZONTAL)
  const x1 = Math.min(1, box.x + box.width + MARGIN_HORIZONTAL)
  const y0 = Math.max(0, box.y - box.height * MARGIN_VERTICAL)
  const y1 = Math.min(1, box.y + box.height * (1 + MARGIN_VERTICAL))
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

/**
 * How the photo lies in the photo line so that `region` spans its width, with the middle of the region at the line's
 * middle (the line's height is fixed, so a region that is relatively high is cut above and below, and a low one shows
 * more of the page around it). In percent: the image's width and left edge of the line's width, and how far up it is
 * moved of its own height, from the line's middle. This needs no size of the photo, so it holds before it has loaded.
 *
 *   stripLayout({ x: 0.1, y: 0.2, width: 0.8, height: 0.1 }) // { width: 125, left: -12.5, up: 25 }
 */
export function stripLayout(region: StaffBox): { width: number; left: number; up: number } {
  return {
    width: 100 / region.width,
    left: (-region.x / region.width) * 100,
    up: (region.y + region.height / 2) * 100,
  }
}

/** The scales of the large view: from the whole photo in view to `MAX_ZOOM` times that, and at least `MAX_SCALE`. */
export function zoomLimits(viewport: Size, photo: Size): { min: number; max: number } {
  const min = Math.min(viewport.width / photo.width, viewport.height / photo.height)
  return { min, max: Math.max(min * MAX_ZOOM, MAX_SCALE) }
}

/** `view` kept within its limits: the scale in range, and the photo covering the view where it is larger, centred where it is smaller. */
export function clampView(view: View, viewport: Size, photo: Size): View {
  const { min, max } = zoomLimits(viewport, photo)
  const scale = Math.min(max, Math.max(min, view.scale))
  const place = (at: number, shown: number, room: number): number => (shown <= room ? (room - shown) / 2 : Math.min(0, Math.max(room - shown, at)))
  return { scale, x: place(view.x, photo.width * scale, viewport.width), y: place(view.y, photo.height * scale, viewport.height) }
}

/**
 * How the large view opens: on the line (`region`, fractions of the photo), `START_ZOOM` times as large as it is when it
 * spans the width of the view, but no higher than the view, from its left edge (the clef and the first bar) and with its
 * middle at the view's middle; it is dragged sideways to read on. The whole photo when the line is not known.
 */
export function startView(viewport: Size, photo: Size, region: StaffBox | null): View {
  if (!region) return clampView({ scale: 0, x: 0, y: 0 }, viewport, photo)
  const width = region.width * photo.width
  const height = region.height * photo.height
  const scale = Math.min((viewport.width / width) * START_ZOOM, viewport.height / height)
  const middle = (region.y + region.height / 2) * photo.height
  return clampView({ scale, x: -region.x * photo.width * scale, y: viewport.height / 2 - middle * scale }, viewport, photo)
}

const middleOf = (points: readonly Point[]): Point => ({
  x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
  y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
})

const spreadOf = (points: readonly Point[]): number => (points.length < 2 ? 0 : Math.hypot(points[1]!.x - points[0]!.x, points[1]!.y - points[0]!.y))

/**
 * The view after a gesture that began at `start` with the fingers at `from` and has them now at `to` (one finger: a drag;
 * two: a pinch, which also moves with the fingers). The point of the photo that was between the fingers stays between
 * them, and the scale follows how far apart they are; then it is kept within its limits (`clampView`).
 */
export function gestureView(start: View, from: readonly Point[], to: readonly Point[], viewport: Size, photo: Size): View {
  if (from.length === 0 || to.length !== from.length) return clampView(start, viewport, photo)
  const was = middleOf(from)
  const now = middleOf(to)
  const spread = spreadOf(from)
  const wanted = spread > 0 ? start.scale * (spreadOf(to) / spread) : start.scale
  const { min, max } = zoomLimits(viewport, photo)
  const scale = Math.min(max, Math.max(min, wanted))
  // The point of the photo under the fingers' middle when the gesture began.
  const held = { x: (was.x - start.x) / start.scale, y: (was.y - start.y) / start.scale }
  return clampView({ scale, x: now.x - held.x * scale, y: now.y - held.y * scale }, viewport, photo)
}

/** The view zoomed by `factor` about `at` (a point of the view): the mouse wheel in a browser. */
export function zoomAt(view: View, at: Point, factor: number, viewport: Size, photo: Size): View {
  const { min, max } = zoomLimits(viewport, photo)
  const scale = Math.min(max, Math.max(min, view.scale * factor))
  const held = { x: (at.x - view.x) / view.scale, y: (at.y - view.y) / view.scale }
  return clampView({ scale, x: at.x - held.x * scale, y: at.y - held.y * scale }, viewport, photo)
}
