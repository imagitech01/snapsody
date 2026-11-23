import type { Barline } from './model.ts'

/*
 * First and second endings as a view of the bar lines (change redesign-score-editor, design D7): for each bar, the
 * ending numbers it lies in. Playback (`expandMeasureOrder` in `timeline.ts`) plays a bar of an ending only on the
 * passes it names; the editor sets and shows endings bar by bar on the same view.
 *
 * In the model an ending is written on the left bar line of its first bar (`start`) and the right bar line of its
 * last (`stop`, or `discontinue` for a last ending with no hook).
 */

/** Ending numbers of an `<ending number="1, 2">` (also "1-3"). */
export function parseEndingNumbers(text: string): number[] {
  const out: number[] = []
  for (const part of text.split(/[,\s]+/)) {
    if (!part) continue
    const range = /^(\d+)\s*[-–]\s*(\d+)$/.exec(part)
    if (range) {
      for (let k = Number(range[1]); k <= Number(range[2]); k++) out.push(k)
    } else if (/^\d+$/.test(part)) {
      out.push(Number(part))
    }
  }
  return out
}

/** The bar lines of a bar: a measure of a voice view and a bar of the score both have them. */
export interface BarLinesOfBar {
  leftBarline?: Barline
  rightBarline?: Barline
}

/**
 * For each bar, the ending numbers it belongs to, or null when it is in no ending. An ending runs from its start to
 * its stop or discontinue; a forward repeat before the stop also ends it.
 */
export function endingsOf(bars: readonly BarLinesOfBar[]): (number[] | null)[] {
  const result: (number[] | null)[] = []
  let current: number[] | null = null
  bars.forEach((m) => {
    const starts = m.leftBarline?.ending ?? (m.rightBarline?.ending?.type === 'start' ? m.rightBarline.ending : undefined)
    if (starts?.type === 'start') current = parseEndingNumbers(starts.number)
    else if (current && m.leftBarline?.repeat === 'forward') current = null
    result.push(current)
    const closes = m.rightBarline?.ending
    if (closes && (closes.type === 'stop' || closes.type === 'discontinue')) current = null
  })
  return result
}
