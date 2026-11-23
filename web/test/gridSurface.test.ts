import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { GridBlock } from '../src/core/score/grid.ts'
import { frac } from '../src/core/score/rational.ts'
import {
  GRID_GUTTER_PX,
  cutXs,
  GRID_ROW_MAX_PX,
  GRID_ROW_MIN_PX,
  GROW_STEPS,
  blockRect,
  columnAt,
  columnAtX,
  endHandle,
  gridGeometry,
  growFor,
  hairpinPath,
  hitRows,
  moveCols,
  moveSteps,
  resizeCols,
  rowAt,
  snapLength,
  staccatoWidth,
  stripNoteAt,
  stripTarget,
  xOfColumn,
} from '../src/ui/gridSurface.ts'

// The geometry of the Grid (change redesign-score-editor, design D3, D4, task 8.1): how big a cell is, where a block is
// drawn, what a touch is on, and how far a drag has gone.

/** A block on `row` from column `col`, `cols` sixteenths long. */
const block = (id: string, col: number, cols: number, row: number, extra: Partial<GridBlock> = {}): GridBlock => ({
  id,
  voice: 0,
  start: frac(Math.round(col * 3), 48),
  length: frac(Math.round(cols * 3), 48),
  col,
  cols,
  row,
  pitch: { step: 'C', octave: 5 },
  staccato: false,
  accent: false,
  ...extra,
})

/** A phone's Grid: 16 columns of 18 px after the row names (326 px wide), ten rows in 193 px. */
const PHONE = gridGeometry({ rows: 10, columns: 16 }, GRID_GUTTER_PX + 16 * 18, 193)

test('cells: the columns share the width after the row names; the rows the height, between the smallest and the largest, and scroll below the smallest', () => {
  assert.equal(PHONE.colW, 18)
  assert.equal(PHONE.rowH, 19.3)
  assert.equal(PHONE.scroll, false)
  assert.equal(PHONE.rowsHeight, 193)
  const sixEight = gridGeometry({ rows: 10, columns: 12 }, GRID_GUTTER_PX + 288, 193)
  assert.equal(sixEight.colW, 24, '12 columns in 6/8 are wider')
  const few = gridGeometry({ rows: 8, columns: 16 }, 326, 400)
  assert.equal(few.rowH, GRID_ROW_MAX_PX, 'no taller than the largest')
  assert.equal(few.scroll, false)
  const piano = gridGeometry({ rows: 14, columns: 16 }, 326, 110)
  assert.equal(piano.rowH, GRID_ROW_MIN_PX, 'no smaller than the smallest')
  assert.equal(piano.scroll, true, 'and then the rows scroll')
  assert.equal(piano.rowsHeight, 14 * GRID_ROW_MIN_PX)
})

test('cells: the column and the row under a point; the row names and outside are none', () => {
  assert.equal(columnAt(PHONE, GRID_GUTTER_PX - 1), -1)
  assert.equal(columnAt(PHONE, GRID_GUTTER_PX), 0)
  assert.equal(columnAt(PHONE, xOfColumn(PHONE, 8) + 17), 8)
  assert.equal(columnAt(PHONE, 400), 16)
  assert.equal(rowAt(PHONE, -1), -1)
  assert.equal(rowAt(PHONE, 0), 0)
  assert.equal(rowAt(PHONE, 19.3 * 3 + 1), 3)
  assert.equal(columnAtX(PHONE, xOfColumn(PHONE, 4) + 9), 4.5)
})

test('blocks: from the start to the end of the note, one row high; a triplet eighth is 4/3 of a column; a grace note a thin mark before its note; staccato half drawn', () => {
  const quarter = blockRect(PHONE, block('q', 4, 4, 2))
  assert.deepEqual(quarter, { x: GRID_GUTTER_PX + 72 + 1, y: 19.3 * 2 + 1.5, w: 70, h: 19.3 - 3 })
  const triplet = blockRect(PHONE, block('t', 4 / 3, 4 / 3, 0))
  assert.ok(Math.abs(triplet.x - (GRID_GUTTER_PX + 24 + 1)) < 1e-9 && Math.abs(triplet.w - 22) < 1e-9)
  const grace = blockRect(PHONE, block('g', 8, 0, 0))
  assert.ok(grace.x + grace.w < xOfColumn(PHONE, 8), 'before the note it leads to')
  assert.equal(grace.w, 4)
  assert.equal(staccatoWidth(quarter), 35)
  assert.equal(endHandle(quarter), 14)
  assert.equal(endHandle(blockRect(PHONE, block('s', 0, 1, 0))), 6.4, 'a sixteenth keeps most of its body')
})

test('a touch on the rows: the end of a block (a little past it too), its body, an empty cell, a faint block of another voice is a cell, the row names nothing', () => {
  const half = block('h', 0, 8, 3)
  const next = block('n', 8, 4, 3)
  const desc = { blocks: [half, next] }
  const y = 19.3 * 3 + 9
  const right = xOfColumn(PHONE, 8) - 1
  assert.deepEqual(hitRows(desc, PHONE, xOfColumn(PHONE, 2), y), { kind: 'block', id: 'h', part: 'body' })
  assert.deepEqual(hitRows(desc, PHONE, right - 4, y), { kind: 'block', id: 'h', part: 'end' })
  assert.deepEqual(hitRows(desc, PHONE, xOfColumn(PHONE, 12) + 4, y), { kind: 'block', id: 'n', part: 'end' }, 'past the end of the last block')
  assert.deepEqual(hitRows(desc, PHONE, xOfColumn(PHONE, 13) + 9, y), { kind: 'cell', col: 13, row: 3 })
  assert.deepEqual(hitRows(desc, PHONE, xOfColumn(PHONE, 2), 19.3 * 4 + 9), { kind: 'cell', col: 2, row: 4 }, 'another row')
  assert.deepEqual(hitRows({ blocks: [] }, PHONE, xOfColumn(PHONE, 2), y), { kind: 'cell', col: 2, row: 3 }, 'the other voices are not in the blocks')
  assert.deepEqual(hitRows(desc, PHONE, 10, y), { kind: 'none' })
  assert.deepEqual(hitRows(desc, PHONE, xOfColumn(PHONE, 2), -2), { kind: 'none' })
})

test('lengths: a dragged end snaps to the column boundary nearest the finger, then to the longest length a note can have that is not longer', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 15, 16, 20, 24, 30].map(snapLength), [1, 2, 3, 4, 4, 6, 6, 8, 8, 8, 12, 12, 16, 16, 24, 24])
  assert.equal(snapLength(0), 1, 'a sixteenth at least')
  // Spec "Lengthen by dragging the end": a quarter on beat 1 dragged to the end of beat 2 is a half note.
  assert.equal(resizeCols(PHONE, { col: 0 }, xOfColumn(PHONE, 8) + 5), 8)
  assert.equal(resizeCols(PHONE, { col: 0 }, xOfColumn(PHONE, 10) - 5), 8, 'ten sixteenths is no length: a half')
  assert.equal(resizeCols(PHONE, { col: 4 }, xOfColumn(PHONE, 4)), 1)
})

test('drags: whole columns sideways, staff steps up and down (up is positive), at most a few steps past the rows; the rows grow to hold the block', () => {
  assert.equal(moveCols(PHONE, 18 * 4 + 5), 4)
  assert.equal(moveCols(PHONE, -10), -1)
  assert.equal(moveSteps(PHONE, 5, -19.3 * 2), 2)
  assert.equal(moveSteps(PHONE, 5, 19.3), -1)
  assert.equal(moveSteps(PHONE, 5, -1000), 5 + GROW_STEPS)
  assert.equal(moveSteps(PHONE, 5, 1000), 5 - 9 - GROW_STEPS)
  assert.deepEqual(growFor(10, 1, 3), { up: 2, down: 0 })
  assert.deepEqual(growFor(10, 8, -3), { up: 0, down: 2 })
  assert.deepEqual(growFor(10, 5, 1), { up: 0, down: 0 })
})

test('the strip: the note that sounds in a column, a chord by its first note, none under a rest or for a grace note; a slide ends on the nearest note', () => {
  const desc = {
    blocks: [
      block('g', 0, 0, 0),
      block('c', 0, 4, 4, { chord: ['c', 'e'] }),
      block('e', 0, 4, 2, { chord: ['c', 'e'] }),
      block('t', 8, 4 / 3, 3),
    ],
  }
  assert.equal(stripNoteAt(desc, 0), 'c')
  assert.equal(stripNoteAt(desc, 3), 'c')
  assert.equal(stripNoteAt(desc, 5), undefined, 'a rest')
  assert.equal(stripNoteAt(desc, 8), 't')
  assert.equal(stripTarget(desc, 6), 'c')
  assert.equal(stripTarget(desc, 7), 't')
  assert.equal(stripTarget(desc, 15), 't')
  assert.equal(stripTarget({ blocks: [] }, 3), undefined)
})

test('the strip: a slide draws a crescendo open at the finger going forward, a diminuendo open at the start going back', () => {
  assert.equal(hairpinPath(10, 50, 15, 6), 'M50 9 L10 15 L50 21')
  assert.equal(hairpinPath(50, 10, 15, 6), 'M10 9 L50 15 L10 21')
})

test('scissors (task 9.2): above the grid at the column line where each place starts, also off the sixteenths', () => {
  const geo = gridGeometry({ rows: 10, columns: 16 }, 326, 193)
  assert.deepEqual(cutXs(geo, [{ noteId: 'a', start: frac(1, 4) }, { noteId: 'b', start: frac(1, 6) }]), [
    { noteId: 'a', x: GRID_GUTTER_PX + 4 * geo.colW },
    { noteId: 'b', x: GRID_GUTTER_PX + (8 / 3) * geo.colW },
  ])
})
