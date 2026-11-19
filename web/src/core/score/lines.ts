import type { SvgTree } from './elements.ts'

/*
 * The lines of a drawn score (change simplify-editor-and-name-new-pieces, design D2): Verovio lays the score
 * out for the width it is given and draws each line as a `g.system`, holding its bars as `g.measure`. The
 * editor shows one line at a time while something is selected, and steps from line to line.
 *
 * Bars are counted as `mapElements` counts them: the measures in drawing order are the score's bars, from 0.
 */

/** The first and last bar (from 0) of one line. */
export interface LineBars {
  firstBar: number
  lastBar: number
}

/**
 * The lines of the drawing at `root` (a Verovio SVG, or several pages of them under one root), in order, with
 * the bars each one holds. A system without a bar is left out.
 *
 *   linesOf(parseXml(svg), xmlTree) // [{ firstBar: 0, lastBar: 3 }, { firstBar: 4, lastBar: 6 }, ...]
 */
export function linesOf<N>(root: N, tree: Pick<SvgTree<N>, 'classes' | 'children'>): LineBars[] {
  const lines: LineBars[] = []
  const has = (node: N, cls: string): boolean => tree.classes(node).includes(cls)
  let bar = 0
  const countMeasures = (node: N): number => {
    if (has(node, 'measure')) return 1
    let count = 0
    for (const child of tree.children(node)) count += countMeasures(child)
    return count
  }
  const walk = (node: N): void => {
    if (has(node, 'system')) {
      const count = countMeasures(node)
      if (count > 0) lines.push({ firstBar: bar, lastBar: bar + count - 1 })
      bar += count
      return
    }
    if (has(node, 'measure')) {
      bar++ // a bar outside any system (not drawn by Verovio, but counted to keep the numbering)
      return
    }
    for (const child of tree.children(node)) walk(child)
  }
  walk(root)
  return lines
}

/** The line (from 0) that holds a bar (from 0), or -1 when no line does. */
export function lineOfBar(lines: readonly LineBars[], bar: number): number {
  return lines.findIndex((line) => line.firstBar <= bar && bar <= line.lastBar)
}
