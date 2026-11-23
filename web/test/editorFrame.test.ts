import assert from 'node:assert/strict'
import { test } from 'node:test'
import { barForEditing } from '../src/app/editorSession.ts'
import { describeElement } from '../src/core/score/elements.ts'
import { parseMusicXml } from '../src/core/score/musicxml.ts'
import { barAtPoint } from '../src/ui/barHit.ts'
import { MIN_SURFACE_PX, frameLayout, fromExcerpt, toExcerpt } from '../src/ui/screens/editor/frame.ts'
import { elementsScore } from './ui/scores.ts'

// The editor's frame (change redesign-score-editor, group 6; design D1, D2, D13): how it fits the screen, which bar a tap
// in the overview or the full score is in, and how an element of the large bar (a score of one bar) is named in the score.

test('frame: the overview is a line of music while the large bar keeps its 170 px, else a row of bar numbers; too low a screen scrolls', () => {
  assert.equal(MIN_SURFACE_PX, 170)
  // A one-line piece at 360 x 780 with its photo as a key: room for the line, the bar gets the rest.
  const key = { overview: 'line', photo: 'key', scroll: false } as const
  assert.deepEqual(frameLayout({ screen: 780, fixed: 520, line: 60, numbers: 44, photo: null }), key)
  // Exactly the minimum still fits; a pixel less does not.
  assert.deepEqual(frameLayout({ screen: 780, fixed: 520, line: 90, numbers: 44, photo: null }), key)
  assert.deepEqual(frameLayout({ screen: 780, fixed: 520, line: 91, numbers: 44, photo: null }), { ...key, overview: 'numbers' })
  // A piano line with the part switch: the overview gives way first.
  assert.deepEqual(frameLayout({ screen: 780, fixed: 540, line: 160, numbers: 44, photo: null }), { ...key, overview: 'numbers' })
  // On its side, not even the bar numbers leave 170 px: the screen scrolls, with the line.
  assert.deepEqual(frameLayout({ screen: 360, fixed: 420, line: 90, numbers: 44, photo: null }), { ...key, scroll: true })
})

test('frame: the photo line (44 px and its gap) is above the overview; the overview gives way first, then the photo line becomes the key (design D13, task 11.2)', () => {
  // A one-line piece at 360 x 780, as measured: the large bar is 241 px with no photo line, 191 with it.
  assert.deepEqual(frameLayout({ screen: 780, fixed: 457, line: 82, numbers: 44, photo: 50 }), { overview: 'line', photo: 'line', scroll: false })
  // The melody of a duet, with the part switch: the large bar would be 133 px; with the bar numbers it is 171.
  assert.deepEqual(frameLayout({ screen: 780, fixed: 509, line: 88, numbers: 50, photo: 50 }), { overview: 'numbers', photo: 'line', scroll: false })
  // Exactly the minimum with both lines; a pixel more needs the numbers; with them a pixel too many needs the key.
  assert.deepEqual(frameLayout({ screen: 780, fixed: 478, line: 82, numbers: 44, photo: 50 }), { overview: 'line', photo: 'line', scroll: false })
  assert.deepEqual(frameLayout({ screen: 780, fixed: 479, line: 82, numbers: 44, photo: 50 }), { overview: 'numbers', photo: 'line', scroll: false })
  assert.deepEqual(frameLayout({ screen: 780, fixed: 516, line: 82, numbers: 44, photo: 50 }), { overview: 'numbers', photo: 'line', scroll: false })
  assert.deepEqual(frameLayout({ screen: 780, fixed: 517, line: 82, numbers: 44, photo: 50 }), { overview: 'numbers', photo: 'key', scroll: false })
  assert.deepEqual(frameLayout({ screen: 780, fixed: 566, line: 82, numbers: 44, photo: 50 }), { overview: 'numbers', photo: 'key', scroll: false })
  // On its side: it scrolls, with the overview and the photo as lines.
  assert.deepEqual(frameLayout({ screen: 360, fixed: 420, line: 82, numbers: 44, photo: 50 }), { overview: 'line', photo: 'line', scroll: true })
})

test('frame: going back to a fuller layout needs 2 px to spare, so a size rounded differently in each layout cannot flip the frame back and forth', () => {
  const line = { overview: 'line', photo: 'line', scroll: false } as const
  const numbers = { overview: 'numbers', photo: 'line', scroll: false } as const
  const key = { overview: 'numbers', photo: 'key', scroll: false } as const
  // As a new piece measured it: 169 px for the large bar with the line (so the numbers), then 170 with the numbers.
  assert.deepEqual(frameLayout({ screen: 780, fixed: 473, line: 88, numbers: 50, photo: 50 }, line), numbers)
  assert.deepEqual(frameLayout({ screen: 780, fixed: 472, line: 88, numbers: 50, photo: 50 }, numbers), numbers, 'stays: 170 is not 172')
  assert.deepEqual(frameLayout({ screen: 780, fixed: 470, line: 88, numbers: 50, photo: 50 }, numbers), line, 'back with 172')
  assert.deepEqual(frameLayout({ screen: 780, fixed: 472, line: 88, numbers: 50, photo: 50 }), line, 'without a layout yet, 170 is enough')
  // The same for the photo line, and from scrolling.
  assert.deepEqual(frameLayout({ screen: 780, fixed: 520, line: 82, numbers: 44, photo: 50 }, key), key, '166 + 50 is not 172 + 50')
  assert.deepEqual(frameLayout({ screen: 780, fixed: 514, line: 82, numbers: 44, photo: 50 }, key), numbers)
  assert.deepEqual(frameLayout({ screen: 780, fixed: 565, line: 82, numbers: 44, photo: 50 }, { ...line, scroll: true }), { ...line, scroll: true })
  assert.deepEqual(frameLayout({ screen: 780, fixed: 564, line: 82, numbers: 44, photo: 50 }, { ...line, scroll: true }), key)
})

test('frame: a tap is in the bar of the nearest line whose sides hold it, else the nearest bar of that line', () => {
  const lines = [
    { top: 0, bottom: 80, bars: [{ bar: 0, left: 0, right: 120 }, { bar: 1, left: 120, right: 200 }, { bar: 2, left: 200, right: 300 }] },
    { top: 100, bottom: 180, bars: [{ bar: 3, left: 0, right: 150 }, { bar: 4, left: 150, right: 300 }] },
  ]
  assert.equal(barAtPoint(lines, 150, 40), 1, 'inside bar 2')
  assert.equal(barAtPoint(lines, 150, -20), 1, 'above the staff, between the notes: still bar 2')
  assert.equal(barAtPoint(lines, 160, 85), 1, 'just under the first line')
  assert.equal(barAtPoint(lines, 160, 96), 4, 'nearer to the second line')
  assert.equal(barAtPoint(lines, 320, 140), 4, 'right of the last bar: the nearest one')
  assert.equal(barAtPoint([], 10, 10), undefined)
})

test('frame: an element of the large bar is named in the score: a bar line and a clef change by their bar, the clef in force at the bar start by its own bar', () => {
  const score = parseMusicXml(elementsScore()) // a bass clef change at bar 3 (index 2), none at bar 4
  // Bar 3's large bar draws its own clef change.
  assert.deepEqual(fromExcerpt(score, 2, { kind: 'clef', bar: 0, part: 'P1', staff: 0 }), { kind: 'clef', bar: 2, part: 'P1', staff: 0 })
  assert.equal(describeElement(score, fromExcerpt(score, 2, { kind: 'clef', bar: 0, part: 'P1', staff: 0 })!)?.clef?.sign, 'F')
  // Bar 4's draws the bass clef in force: that is bar 3's change; bar 2's is the first clef, at bar 1.
  assert.deepEqual(fromExcerpt(score, 3, { kind: 'clef', bar: 0, part: 'P1', staff: 0 }), { kind: 'clef', bar: 2, part: 'P1', staff: 0 })
  assert.deepEqual(fromExcerpt(score, 1, { kind: 'clef', bar: 0, part: 'P1', staff: 0 }), { kind: 'clef', bar: 0, part: 'P1', staff: 0 })
  // The time signature in force at bar 2 is bar 1's; a bar line is the bar's own.
  assert.deepEqual(fromExcerpt(score, 1, { kind: 'time', bar: 0 }), { kind: 'time', bar: 0 })
  assert.deepEqual(fromExcerpt(score, 3, { kind: 'barline', bar: 0 }), { kind: 'barline', bar: 3 })
  // Marks keep their ids.
  const slur = { kind: 'slur', noteId: 'x', number: 1 } as const
  assert.equal(fromExcerpt(score, 3, slur), slur)

  // And back, to light up the selected element in the large bar: only where that bar draws it.
  assert.deepEqual(toExcerpt(score, 2, { kind: 'clef', bar: 2, part: 'P1', staff: 0 }), { kind: 'clef', bar: 0, part: 'P1', staff: 0 })
  assert.deepEqual(toExcerpt(score, 3, { kind: 'clef', bar: 2, part: 'P1', staff: 0 }), { kind: 'clef', bar: 0, part: 'P1', staff: 0 }, 'in force at bar 4')
  assert.equal(toExcerpt(score, 1, { kind: 'clef', bar: 2, part: 'P1', staff: 0 }), undefined, 'bar 2 does not draw the change of bar 3')
  assert.equal(toExcerpt(score, 0, slur), slur)

  // The large bar of bar 3 is that bar alone, with its clef: what the references are made on.
  const bar3 = barForEditing(score, 2)
  assert.equal(bar3.bars.length, 1)
  assert.equal(describeElement(bar3, { kind: 'clef', bar: 0, part: 'P1', staff: 0 })?.clef?.sign, 'F')
})
