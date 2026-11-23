import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MAX_SCALE, MAX_ZOOM, START_ZOOM, clampView, gestureView, lineRegion, startView, stripLayout, zoomAt, zoomLimits } from '../src/ui/screens/editor/photoView.ts'
import type { View } from '../src/ui/screens/editor/photoView.ts'

// The photo line and the photo shown large (change redesign-score-editor, task 11.2, design D10): the crop of a line of
// music, and how the large view opens, zooms and moves.

/** A page photo as the reader gives it: 1240 x 1754 pixels (A4 at 150 dpi). */
const PHOTO = { width: 1240, height: 1754 }
/** The large view at 360 x 780, under its title row. */
const VIEW = { width: 360, height: 640 }
/** The second line of the page: its staff lines from y 390 to 447 pixels, from x 90 to 1152. */
const LINE_2 = { x: 90 / 1240, y: 390 / 1754, width: 1062 / 1240, height: 57 / 1754 }

const close = (actual: number, expected: number, what: string): void => assert.ok(Math.abs(actual - expected) < 1e-6, `${what}: ${actual} is not ${expected}`)

/** Where a point of the photo (pixels) is drawn in the view. */
const drawn = (view: View, x: number, y: number) => ({ x: view.x + view.scale * x, y: view.y + view.scale * y })

test('photo line: the line is shown with a margin, half its height above and below and a little at the sides, kept inside the photo', () => {
  const region = lineRegion(LINE_2)
  close(region.x, LINE_2.x - 0.02, 'left')
  close(region.width, LINE_2.width + 0.04, 'width')
  close(region.y, LINE_2.y - LINE_2.height / 2, 'top')
  close(region.height, LINE_2.height * 2, 'height')
  // A line at the edge of the photo is not cut past it.
  const edge = lineRegion({ x: 0, y: 0.98, width: 1, height: 0.02 })
  close(edge.x, 0, 'left')
  close(edge.width, 1, 'width')
  close(edge.y, 0.97, 'top')
  close(edge.y + edge.height, 1, 'bottom')
})

test('photo line: the region spans the width of the line, with its middle at the line\'s middle, without the size of the photo', () => {
  assert.deepEqual(stripLayout({ x: 0.1, y: 0.2, width: 0.8, height: 0.1 }), { width: 125, left: -12.5, up: 25 })
  // The second line at 360 px wide: the region's left edge at the line's left edge, its right edge at the right edge.
  const region = lineRegion(LINE_2)
  const layout = stripLayout(region)
  const imageWidth = (360 * layout.width) / 100
  close((360 * layout.left) / 100 + region.x * imageWidth, 0, 'the region starts at the left edge')
  close((360 * layout.left) / 100 + (region.x + region.width) * imageWidth, 360, 'and ends at the right edge')
  // 44 px high: the middle of the staff is at 22 px, and the staff is about 15 px high, readable as a reminder.
  const imageHeight = imageWidth * (PHOTO.height / PHOTO.width)
  const top = 22 - (layout.up / 100) * imageHeight
  close(top + (LINE_2.y + LINE_2.height / 2) * imageHeight, 22, 'the staff\'s middle at the line\'s middle')
  assert.ok(LINE_2.height * imageHeight > 14 && LINE_2.height * imageHeight < 44, `the staff is ${LINE_2.height * imageHeight} px high`)
})

test('large view: it opens on the line, larger than across the width, from its left edge and in the middle; the whole page when the line is not known', () => {
  const region = lineRegion(LINE_2)
  const view = startView(VIEW, PHOTO, region)
  close(view.scale, (VIEW.width / (region.width * PHOTO.width)) * START_ZOOM, 'two and a half times the line across the width')
  const left = drawn(view, region.x * PHOTO.width, (region.y + region.height / 2) * PHOTO.height)
  close(left.x, 0, 'the line\'s left edge at the view\'s left edge')
  close(left.y, VIEW.height / 2, 'its middle at the view\'s middle')
  const staff = LINE_2.height * PHOTO.height * view.scale
  assert.ok(staff > 40, `the staff is ${staff} px high, against about 17 in the photo line`)

  // No line: the whole page, as large as fits, in the middle.
  const page = startView(VIEW, PHOTO, null)
  close(page.scale, VIEW.width / PHOTO.width, 'the page fits the width')
  close(page.x, 0, 'left')
  close(page.y, (VIEW.height - PHOTO.height * page.scale) / 2, 'centred down')

  // A line near the top of the page is not moved past the page's top edge: the view shows the page from its top.
  const first = startView(VIEW, PHOTO, lineRegion({ ...LINE_2, y: 0.02 }))
  close(first.y, 0, 'the top of the page at the top of the view')

  // A line that is high for its width is no higher than the view.
  const high = startView({ width: 360, height: 100 }, PHOTO, { x: 0.1, y: 0.1, width: 0.8, height: 0.2 })
  close(high.scale, 100 / (0.2 * PHOTO.height), 'fits the height')
})

test('large view: a pinch zooms about the fingers, which keep the point between them, and a drag moves; both stay within the page and the limits', () => {
  const limits = zoomLimits(VIEW, PHOTO)
  close(limits.min, VIEW.width / PHOTO.width, 'out to the whole page')
  close(limits.max, Math.max(limits.min * MAX_ZOOM, MAX_SCALE), 'in to 8 times that, at least 2 CSS px per pixel')

  const start = startView(VIEW, PHOTO, lineRegion(LINE_2))
  // Two fingers 100 px apart around (180, 320) spread to 200 px: twice the scale, the same point of the photo between them.
  const from = [{ x: 130, y: 320 }, { x: 230, y: 320 }]
  const to = [{ x: 80, y: 320 }, { x: 280, y: 320 }]
  const zoomed = gestureView(start, from, to, VIEW, PHOTO)
  close(zoomed.scale, start.scale * 2, 'twice as large')
  const held = { x: (180 - start.x) / start.scale, y: (320 - start.y) / start.scale }
  const now = drawn(zoomed, held.x, held.y)
  close(now.x, 180, 'the point between the fingers stays there')
  close(now.y, 320, 'also down')

  // A drag of one finger moves the photo with it.
  const moved = gestureView(zoomed, [{ x: 200, y: 300 }], [{ x: 150, y: 260 }], VIEW, PHOTO)
  close(moved.scale, zoomed.scale, 'a drag does not zoom')
  close(moved.x, zoomed.x - 50, 'left with the finger')
  close(moved.y, zoomed.y - 40, 'and up')

  // Not past the page's edges: a drag far to the right stops with the page's left edge at the view's left edge.
  const far = gestureView(zoomed, [{ x: 100, y: 300 }], [{ x: 2000, y: 300 }], VIEW, PHOTO)
  close(far.x, 0, 'the left edge')
  // Not past the limits: a pinch far in stops at the largest scale, far out at the whole page, centred.
  close(gestureView(start, from, [{ x: 0, y: 320 }, { x: 5000, y: 320 }], VIEW, PHOTO).scale, limits.max, 'in')
  const out = gestureView(start, from, [{ x: 179, y: 320 }, { x: 181, y: 320 }], VIEW, PHOTO)
  close(out.scale, limits.min, 'out')
  close(out.y, (VIEW.height - PHOTO.height * out.scale) / 2, 'the whole page is centred')

  // A finger added or lifted starts a new gesture: fingers that do not match leave the view as it was.
  assert.deepEqual(gestureView(zoomed, from, [{ x: 1, y: 1 }], VIEW, PHOTO), clampView(zoomed, VIEW, PHOTO))
})

test('large view: the wheel zooms about the pointer, within the limits', () => {
  const start = startView(VIEW, PHOTO, lineRegion(LINE_2))
  const at = { x: 100, y: 300 }
  const held = { x: (at.x - start.x) / start.scale, y: (at.y - start.y) / start.scale }
  const zoomed = zoomAt(start, at, 1.5, VIEW, PHOTO)
  close(zoomed.scale, start.scale * 1.5, 'one and a half times')
  close(drawn(zoomed, held.x, held.y).x, at.x, 'the point under the pointer stays')
  close(drawn(zoomed, held.x, held.y).y, at.y, 'also down')
  close(zoomAt(start, at, 0.01, VIEW, PHOTO).scale, zoomLimits(VIEW, PHOTO).min, 'not smaller than the whole page')
})
