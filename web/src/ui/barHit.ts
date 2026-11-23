/*
 * Which bar a tap is in (change redesign-score-editor, D1): the editor's overview line and its full score make a bar current
 * by a tap anywhere in it, also above or below the staff and between the notes, where no note is in reach. Plain geometry
 * of the drawing, so a quick test can prove it; `scoreView.ts` measures the boxes.
 */

/** A drawn line (Verovio's `g.system`) and the bars in it, in screen coordinates; `bar` is from 0. */
export interface LineBox {
  top: number
  bottom: number
  bars: readonly { bar: number; left: number; right: number }[]
}

/**
 * The bar (from 0) at a point: first the line nearest to it from above or below (0 inside it), then in that line the bar
 * whose left and right hold `x`, else the nearest one sideways. Undefined when nothing is drawn.
 *
 *   barAtPoint([{ top: 0, bottom: 80, bars: [{ bar: 0, left: 0, right: 100 }, { bar: 1, left: 100, right: 200 }] }], 150, 95) // 1
 */
export function barAtPoint(lines: readonly LineBox[], x: number, y: number): number | undefined {
  let line: LineBox | undefined
  let lineDistance = Infinity
  for (const l of lines) {
    if (l.bars.length === 0) continue
    const d = Math.max(l.top - y, 0, y - l.bottom)
    if (d < lineDistance) {
      line = l
      lineDistance = d
    }
  }
  if (!line) return undefined
  let bar: number | undefined
  let barDistance = Infinity
  for (const b of line.bars) {
    const d = Math.max(b.left - x, 0, x - b.right)
    if (d < barDistance) {
      bar = b.bar
      barDistance = d
    }
  }
  return bar
}
