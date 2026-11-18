import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MARGIN_HORIZONTAL, MARGIN_VERTICAL, stripLayout, stripRegion } from '../src/ui/screens/editor/photoRegion.ts'

// The part of a page photo the editor's strip shows (practice-app design D7, D14): the staff box with a margin.

const near = (actual: number, expected: number): void => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`)

test('strip region: the staff box grows by a margin above and below and at the sides, inside the photo', () => {
  const region = stripRegion({ x: 0.1, y: 0.4, width: 0.8, height: 0.1 })
  near(region.x, 0.1 - MARGIN_HORIZONTAL)
  near(region.width, 0.8 + 2 * MARGIN_HORIZONTAL)
  near(region.y, 0.4 - 0.1 * MARGIN_VERTICAL)
  near(region.height, 0.1 * (1 + 2 * MARGIN_VERTICAL))
})

test('strip region: a box at the edge of the photo is cut off at the edge, not past it', () => {
  const region = stripRegion({ x: 0.01, y: 0.02, width: 0.99, height: 0.1 })
  assert.deepEqual([region.x, region.y], [0, 0])
  near(region.x + region.width, 1)
  near(region.y + region.height, 0.02 + 0.1 * (1 + MARGIN_VERTICAL))
  const low = stripRegion({ x: 0, y: 0.95, width: 1, height: 0.05 })
  near(low.y + low.height, 1)
})

test('strip layout: the photo is laid out so that only the region shows, in the proportions of the region on the photo', () => {
  const layout = stripLayout({ x: 0.1, y: 0.25, width: 0.5, height: 0.2 }, 3000, 4000)
  near(layout.aspect, (0.5 * 3000) / (0.2 * 4000))
  near(layout.width, 200) // the photo is twice as wide as the frame
  near(layout.height, 500) // and five times as high
  near(layout.left, -20) // moved left by the region's start, a fifth of the frame
  near(layout.top, -125)
  // The region's own corner is where the frame's corner is: top-left of the region is x * width = 20% of the photo's width into it.
  near((layout.width * 0.1) / 100, -layout.left / 100)
})
