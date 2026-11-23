import { gridValue } from '../core/score/edit.ts'
import type { GridBlock, GridDescription } from '../core/score/grid.ts'
import { frac } from '../core/score/rational.ts'

/*
 * The geometry of the Grid (change redesign-score-editor, design D3, D4; spec `score-editing` "Grid view", "Edit notes in
 * Grid", "Grid keeps the bar in order", "Loudness strip in Grid"): how big a cell is, where a block is drawn, what a touch
 * on the rows or the strip is on, and how far a drag has gone in columns and rows. Plain arithmetic on the description
 * `grid.ts` gives, so a quick test can prove it; `GridSurface.tsx` draws the description with it and turns the answers into
 * the session's actions.
 *
 * Coordinates are those of the drawing of the rows (x from the left edge of the surface, y from the top of the first
 * row): the strip shares the x of the rows, and has its own y. A column is a sixteenth of the bar and a row a staff step
 * (D3): a cell is as wide as the surface allows (about 18 px for 16 columns on a phone) and as high as the rows that fit,
 * between `GRID_ROW_MIN_PX` and `GRID_ROW_MAX_PX`. When the rows do not fit at the smallest height, they scroll inside the
 * Grid (by the row names at the left, design D13), and the beat numbers and the strip stay where they are.
 */

/** The width of the row names at the left. */
export const GRID_GUTTER_PX = 38
/** The row of beat numbers above the rows. */
export const GRID_HEAD_PX = 16
/** The loudness strip under the rows. */
export const GRID_STRIP_PX = 30
/** The lowest and the highest a row is drawn. */
export const GRID_ROW_MIN_PX = 16
export const GRID_ROW_MAX_PX = 26
/** How far past the end of a block a touch still takes its end, and how much of the block's end is its end at most. */
export const END_REACH_PX = 8
export const END_HANDLE_PX = 14
/** How many staff steps a block can be dragged past the rows drawn at the start of the drag (the rows grow with it). */
export const GROW_STEPS = 7

export interface GridGeometry {
  /** The width of the drawing (the surface's inner width). */
  width: number
  gutter: number
  colW: number
  rowH: number
  rows: number
  columns: number
  /** The height of the rows' drawing. */
  rowsHeight: number
  /** The rows do not fit at the smallest height: they scroll. */
  scroll: boolean
}

/** A rectangle in the drawing's coordinates. */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * The Grid's cells for a description, a drawing `width` wide with `room` px of height for the rows: the columns share the
 * width after the row names; the rows share the room, at least `GRID_ROW_MIN_PX` (then they scroll) and at most
 * `GRID_ROW_MAX_PX`.
 *
 *   gridGeometry({ rows: 10, columns: 16 }, 326, 193) // colW 18, rowH 19.3, scroll false
 */
export function gridGeometry(desc: { rows: number; columns: number }, width: number, room: number): GridGeometry {
  const rows = Math.max(1, desc.rows)
  const columns = Math.max(1, desc.columns)
  const gutter = GRID_GUTTER_PX
  const colW = Math.max(1, width - gutter) / columns
  const fit = room / rows
  const rowH = Math.min(GRID_ROW_MAX_PX, Math.max(GRID_ROW_MIN_PX, fit))
  return { width, gutter, colW, rowH, rows, columns, rowsHeight: rowH * rows, scroll: fit < GRID_ROW_MIN_PX }
}

export const xOfColumn = (geo: GridGeometry, col: number): number => geo.gutter + col * geo.colW
export const yOfRow = (geo: GridGeometry, row: number): number => row * geo.rowH

/** The column under `x` (a fractional column is the one it is in); -1 over the row names, `columns` past the last. */
export function columnAt(geo: GridGeometry, x: number): number {
  if (x < geo.gutter) return -1
  return Math.min(geo.columns, Math.floor((x - geo.gutter) / geo.colW))
}

/** The row under `y`, or -1 above the first and `rows` below the last. */
export function rowAt(geo: GridGeometry, y: number): number {
  if (y < 0) return -1
  return Math.min(geo.rows, Math.floor(y / geo.rowH))
}

/**
 * Where a block is drawn: from its start to its end, one row high, a little inside its cells. A grace note (no length) is
 * a thin mark just before the note it leads to.
 */
export function blockRect(geo: GridGeometry, b: Pick<GridBlock, 'col' | 'cols' | 'row'>): Rect {
  const y = yOfRow(geo, b.row) + 1.5
  const h = Math.max(4, geo.rowH - 3)
  if (b.cols <= 0) return { x: xOfColumn(geo, b.col) - 6, y, w: 4, h }
  return { x: xOfColumn(geo, b.col) + 1, y, w: Math.max(3, b.cols * geo.colW - 2), h }
}

/** The part of a staccato block drawn solid (spec "A staccato block": shorter than the note, which keeps its length). */
export const staccatoWidth = (rect: Rect): number => Math.max(6, rect.w * 0.5)

/** How much of a block's end is its end: less on a short block, so its body can still be taken. */
export const endHandle = (rect: Rect): number => Math.max(6, Math.min(END_HANDLE_PX, rect.w * 0.4))

/** What a touch on the rows is on. */
export type GridHit =
  /** A block of the shown voice: its body (to move it or change its pitch) or its end (to change its length). */
  | { kind: 'block'; id: string; part: 'body' | 'end' }
  /** A cell with no block of the shown voice (a faint block of another voice does not count). */
  | { kind: 'cell'; col: number; row: number }
  /** The row names, or outside the rows. */
  | { kind: 'none' }

/**
 * What a touch at (`x`, `y`) on the rows is on: a block of the shown voice in that row (its end within `END_REACH_PX`
 * past it or `endHandle` inside it, the end of the nearest block first; else its body), else the cell. The faint blocks
 * of the other voices do not react (spec "Grid shows one staff and voice").
 */
export function hitRows(desc: Pick<GridDescription, 'blocks'>, geo: GridGeometry, x: number, y: number): GridHit {
  const row = rowAt(geo, y)
  const col = columnAt(geo, x)
  if (row < 0 || row >= geo.rows || col < 0 || col >= geo.columns) return { kind: 'none' }
  const inRow = desc.blocks.filter((b) => b.row === row)
  let end: { id: string; d: number } | undefined
  for (const b of inRow) {
    if (b.cols <= 0) continue
    const r = blockRect(geo, b)
    const right = r.x + r.w
    if (x >= right - endHandle(r) && x <= right + END_REACH_PX) {
      const d = Math.abs(x - right)
      if (!end || d < end.d) end = { id: b.id, d }
    }
  }
  if (end) return { kind: 'block', id: end.id, part: 'end' }
  for (const b of inRow) {
    const r = blockRect(geo, b)
    const reach = b.cols <= 0 ? 4 : 0
    if (x >= r.x - reach && x < r.x + r.w + reach) return { kind: 'block', id: b.id, part: 'body' }
  }
  return { kind: 'cell', col, row }
}

/** The lengths a block can take, in sixteenths (the Grid values: whole to sixteenth, plain or dotted). */
const LENGTHS = Array.from({ length: 24 }, (_, k) => 24 - k).filter((n) => gridValue(frac(n, 16)) !== undefined)

/** The longest length a block can take that is not longer than `cols` sixteenths; a sixteenth at least. */
export function snapLength(cols: number): number {
  return LENGTHS.find((n) => n <= cols) ?? 1
}

/**
 * The length, in sixteenths, of a block whose end is dragged to `x` (spec "Lengthen by dragging the end"): to the column
 * boundary nearest the finger, then the longest length a note can have that is not longer.
 */
export function resizeCols(geo: GridGeometry, block: Pick<GridBlock, 'col'>, x: number): number {
  const end = Math.round((x - geo.gutter) / geo.colW)
  return snapLength(end - block.col)
}

/** The whole columns a sideways drag of `dx` px has gone. */
export const moveCols = (geo: GridGeometry, dx: number): number => Math.round(dx / geo.colW)

/** The staff steps an up or down drag of `dy` px has gone (up is positive), at most `GROW_STEPS` past the rows drawn. */
export function moveSteps(geo: GridGeometry, row: number, dy: number): number {
  const steps = -Math.round(dy / geo.rowH)
  return Math.max(row - (geo.rows - 1) - GROW_STEPS, Math.min(row + GROW_STEPS, steps))
}

/** The rows to add above and below so that a block on row `row` moved by `steps` has a row (`gridOf`'s `grow`). */
export function growFor(rows: number, row: number, steps: number): { up: number; down: number } {
  const target = row - steps
  return { up: Math.max(0, -target), down: Math.max(0, target - (rows - 1)) }
}

/** The block of the strip under a column: the note of the shown voice that sounds there, a chord by its first note; grace notes do not count. */
function stripBlocks(desc: Pick<GridDescription, 'blocks'>): GridBlock[] {
  return desc.blocks.filter((b) => b.cols > 0 && (!b.chord || b.chord[0] === b.id))
}

/**
 * The note under the column `col` of the strip (spec "Tap the strip"): the note of the shown voice that sounds in that
 * column, a chord's first note for a chord, or undefined under a rest.
 */
export function stripNoteAt(desc: Pick<GridDescription, 'blocks'>, col: number): string | undefined {
  return stripBlocks(desc).find((b) => b.col <= col + 0.0001 && col < b.col + b.cols - 0.0001)?.id
}

/** Where a slide along the strip ends (spec "Slide forward"): the note under the finger, else the nearest one. */
export function stripTarget(desc: Pick<GridDescription, 'blocks'>, col: number): string | undefined {
  const under = stripNoteAt(desc, col)
  if (under) return under
  let best: { id: string; d: number } | undefined
  for (const b of stripBlocks(desc)) {
    const d = col < b.col ? b.col - col : col - (b.col + b.cols)
    if (!best || d < best.d) best = { id: b.id, d }
  }
  return best?.id
}

/** The column, with its fraction, under `x`: for a slide along the strip, which may end between two cells. */
export const columnAtX = (geo: GridGeometry, x: number): number => (x - geo.gutter) / geo.colW

/**
 * The hairpin a slide along the strip draws while the finger is down: from the note it started under to the finger, open
 * at its end for a crescendo (forward) and at its start for a diminuendo (back). Two lines as an SVG path, in the strip's
 * coordinates (y from its top).
 */
export function hairpinPath(x1: number, x2: number, mid: number, half: number): string {
  const [from, to] = [Math.min(x1, x2), Math.max(x1, x2)]
  return x2 >= x1 ? `M${to} ${mid - half} L${from} ${mid} L${to} ${mid + half}` : `M${from} ${mid - half} L${to} ${mid} L${from} ${mid + half}`
}
