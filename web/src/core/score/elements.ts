import type { Clef, Measure, Note, Score } from './model.ts'
import { isDirection, isNote, isWedge } from './model.ts'

/*
 * The elements of a score other than notes and rests, as the editor selects them (change
 * select-and-delete-elements, design D1 and D2).
 *
 * An `ElementRef` names an element in model terms, so a selection does not depend on what Verovio drew:
 * it survives a new layout, and an edit and its undo. `describeElement` says what a reference is now, or
 * that it is gone.
 *
 * `mapElements` traces what Verovio drew back to `ElementRef`s. Verovio keeps the drawing ids the
 * serializer writes (`drawingIds`: clef changes, slurs, ties, hairpins), and makes up its own for the
 * rest, new on every render, so those are found by their place in the drawing:
 *
 * - Dynamics, tempo marks and words are drawn per bar, in the order of the source, as `g.dynam`,
 *   `g.tempo` (a tempo mark with a metronome mark) and `g.dir` (words, and a tempo mark of words only).
 *   The nth of them in the nth bar is the nth such model item of that bar that is drawn.
 * - Staccato, tenuto and accent are a `g.artic` inside their note, told apart by their SMuFL glyph.
 *   Fermatas and breath marks are drawn per bar, after the notes: the nth `g.fermata` of a bar is the
 *   fermata of the nth note of that bar that has one, and likewise for `g.breath`.
 * - A key, time signature or clef in a bar's staff before its notes is the one in force at that bar (the
 *   one at the start of a system, or a change). One after the notes is the courtesy one at the end of a
 *   system, so it is the one in force at the next bar. A clef change keeps its drawing id.
 * - A slur, tie or hairpin that runs onto the next system is drawn twice; the second piece has the
 *   drawing id as a class `id-<id>`.
 * - A bar line drawn in a bar selects that bar, whether it is the bar's start (a start-repeat) or its end.
 *
 * Bars in an `ElementRef` are indexes into `score.measures`, from 0; the editor shows them from 1.
 */

export type ArticulationMark = 'staccato' | 'tenuto' | 'accent' | 'fermata' | 'breath'

export type ElementRef =
  /** The clef, key or time signature at that bar: a change, or the first one at bar 0. */
  | { kind: 'clef' | 'key' | 'time'; bar: number }
  | { kind: 'dynamic' | 'tempo' | 'words'; id: string }
  /** The slur that starts on that note, with that number. */
  | { kind: 'slur'; noteId: string; number: number }
  /** The tie that starts on that note. */
  | { kind: 'tie'; noteId: string }
  /** The hairpin that starts on that note. */
  | { kind: 'wedge'; startId: string }
  | { kind: 'articulation'; noteId: string; mark: ArticulationMark }
  /** A bar line of that bar: selecting it selects the bar (change edit-bar-lines). */
  | { kind: 'barline'; bar: number }

export type ElementKind = ElementRef['kind']

export interface ElementInfo {
  kind: ElementKind
  /** The bar the element is in (index from 0): a slur, tie or hairpin is in the bar it starts in. */
  bar: number
  /** For a clef: the clef (treble when the score gives none at its start). */
  clef?: Clef
  /** For an articulation: which mark. */
  mark?: ArticulationMark
  /** For a dynamic: the mark, e.g. "mf". */
  text?: string
  /** False for the first clef, key and time signature, which are changed instead (spec "Delete an element"). */
  deletable: boolean
}

/** The clef a score has when it gives none at its start. */
export const DEFAULT_CLEF: Clef = { sign: 'G', line: 2 }

export function sameElement(a: ElementRef, b: ElementRef): boolean {
  if (a.kind !== b.kind) return false
  switch (a.kind) {
    case 'clef':
    case 'key':
    case 'time':
    case 'barline':
      return a.bar === (b as typeof a).bar
    case 'dynamic':
    case 'tempo':
    case 'words':
      return a.id === (b as typeof a).id
    case 'slur':
      return a.noteId === (b as typeof a).noteId && a.number === (b as typeof a).number
    case 'tie':
      return a.noteId === (b as typeof a).noteId
    case 'wedge':
      return a.startId === (b as typeof a).startId
    case 'articulation':
      return a.noteId === (b as typeof a).noteId && a.mark === (b as typeof a).mark
  }
}

/** Where the note with this id is: its bar (from 0), or undefined. */
function noteAt(score: Score, id: string): { note: Note; bar: number } | undefined {
  for (const [bar, m] of score.measures.entries()) {
    for (const item of m.items) if (isNote(item) && item.id === id) return { note: item, bar }
  }
  return undefined
}

/** What the element is now, or undefined when it is gone from the score. */
export function describeElement(score: Score, ref: ElementRef): ElementInfo | undefined {
  const inRange = (bar: number): boolean => Number.isInteger(bar) && bar >= 0 && bar < score.measures.length
  switch (ref.kind) {
    case 'clef': {
      if (!inRange(ref.bar)) return undefined
      const clef = score.measures[ref.bar]!.clef ?? (ref.bar === 0 ? DEFAULT_CLEF : undefined)
      return clef ? { kind: 'clef', bar: ref.bar, clef: { ...clef }, deletable: ref.bar > 0 } : undefined
    }
    case 'key':
    case 'time':
      if (!inRange(ref.bar) || !score.measures[ref.bar]![ref.kind]) return undefined
      return { kind: ref.kind, bar: ref.bar, deletable: ref.bar > 0 }
    case 'barline':
      return inRange(ref.bar) ? { kind: 'barline', bar: ref.bar, deletable: false } : undefined
    case 'dynamic':
    case 'tempo':
    case 'words':
      for (const [bar, m] of score.measures.entries()) {
        const item = m.items.find((i) => isDirection(i) && i.kind === ref.kind && i.id === ref.id)
        if (item) return { kind: ref.kind, bar, ...(item.kind === 'dynamic' ? { text: item.mark } : {}), deletable: true }
      }
      return undefined
    case 'slur': {
      const at = noteAt(score, ref.noteId)
      return at?.note.slurs.some((s) => s.type === 'start' && s.number === ref.number) ? { kind: 'slur', bar: at.bar, deletable: true } : undefined
    }
    case 'tie': {
      const at = noteAt(score, ref.noteId)
      return at?.note.tieStart ? { kind: 'tie', bar: at.bar, deletable: true } : undefined
    }
    case 'wedge':
      for (const [bar, m] of score.measures.entries()) {
        if (m.items.some((i) => isWedge(i) && i.start === ref.startId)) return { kind: 'wedge', bar, deletable: true }
      }
      return undefined
    case 'articulation': {
      const at = noteAt(score, ref.noteId)
      return at?.note[ref.mark] ? { kind: 'articulation', bar: at.bar, mark: ref.mark, deletable: true } : undefined
    }
  }
}

// ---------------------------------------------------------------- from the drawing to the model

/** How `mapElements` reads a drawing: a DOM `Element`, or a parsed SVG in tests. */
export interface SvgTree<N> {
  classes(node: N): readonly string[]
  id(node: N): string
  children(node: N): readonly N[]
  /** The SMuFL code point of the first glyph drawn inside the node (`<use xlink:href="#E4A2-…">` gives "E4A2"). */
  glyph(node: N): string | undefined
}

/** SMuFL glyphs of the articulations Verovio draws as `g.artic` (above and below the note). */
const ARTIC_GLYPHS: Readonly<Record<string, 'staccato' | 'tenuto' | 'accent'>> = {
  E4A0: 'accent',
  E4A1: 'accent',
  E4A2: 'staccato',
  E4A3: 'staccato',
  E4A4: 'tenuto',
  E4A5: 'tenuto',
}

/** The kinds of the clef, key and time signature drawn in a staff, by class. */
const SIGNATURE_CLASSES: Readonly<Record<string, 'clef' | 'key' | 'time'>> = { clef: 'clef', keySig: 'key', meterSig: 'time' }

/** The bar (from 0) where the clef, key or time in force at `bar` was set; for a clef, 0 when none was. */
function inForce(measures: readonly Measure[], kind: 'clef' | 'key' | 'time', bar: number): number | undefined {
  for (let b = Math.min(bar, measures.length - 1); b >= 0; b--) if (measures[b]![kind]) return b
  return kind === 'clef' ? 0 : undefined
}

/** Whether Verovio draws the item: a tempo mark with neither words nor a metronome mark is not drawn. */
function drawn(item: Measure['items'][number]): boolean {
  if (item.kind === 'dynamic' || item.kind === 'words') return true
  if (item.kind === 'tempo') return !!item.words || item.perMinute !== undefined || item.beatUnit !== undefined
  return false
}

/** Reads a drawing id (`clef-3`, `slur-n4-1`, `tie-n7`, `wedge-a1`) back into a reference. */
function fromDrawingId(id: string): ElementRef | undefined {
  let m = /^clef-(\d+)$/.exec(id)
  if (m) return { kind: 'clef', bar: Number(m[1]) }
  m = /^slur-(.+)-(\d+)$/.exec(id)
  if (m) return { kind: 'slur', noteId: m[1]!, number: Number(m[2]) }
  m = /^tie-(.+)$/.exec(id)
  if (m) return { kind: 'tie', noteId: m[1]! }
  m = /^wedge-(.+)$/.exec(id)
  if (m) return { kind: 'wedge', startId: m[1]! }
  return undefined
}

/**
 * Every element of the drawing at `root` (a Verovio SVG of `score`) that the editor can select, with
 * the element it draws. Notes and rests are not in it: they are found by their own ids (noteMap.ts).
 * A node maps to one element; one element can be drawn by several nodes (a slur over a system break, a
 * key at the start of each system).
 */
export function mapElements<N>(root: N, tree: SvgTree<N>, score: Score): Map<N, ElementRef> {
  const found = new Map<N, ElementRef>()
  const has = (node: N, cls: string): boolean => tree.classes(node).includes(cls)
  const notesById = new Map<string, Note>()
  for (const m of score.measures) for (const item of m.items) if (isNote(item)) notesById.set(item.id, item)

  /** The drawing id of a node: its own id, or the `id-…` class of the second piece of a split slur, tie or hairpin. */
  const drawingIdOf = (node: N): string | undefined => {
    const own = tree.id(node)
    if (own && fromDrawingId(own)) return own
    return tree.classes(node).find((c) => c.startsWith('id-'))?.slice(3)
  }

  const spanner = (node: N): void => {
    const id = drawingIdOf(node)
    const ref = id ? fromDrawingId(id) : undefined
    if (ref) found.set(node, ref)
  }

  // The bars in drawing order; the second piece of a split slur, tie or hairpin is drawn in the system, outside any bar.
  const measures: N[] = []
  const collect = (node: N): void => {
    if (has(node, 'measure')) {
      measures.push(node)
      return
    }
    if (has(node, 'slur') || has(node, 'tie') || has(node, 'hairpin')) {
      spanner(node)
      return
    }
    for (const c of tree.children(node)) collect(c)
  }
  collect(root)

  /** Articulations inside a note (or a chord): the first of its notes that has the mark. */
  const visitLayer = (node: N, owner: string[]): void => {
    let own = owner
    if (has(node, 'note') || has(node, 'chord')) {
      const ids: string[] = []
      const gather = (n: N): void => {
        if (has(n, 'note') && notesById.has(tree.id(n))) ids.push(tree.id(n))
        for (const c of tree.children(n)) gather(c)
      }
      if (has(node, 'note') && notesById.has(tree.id(node))) ids.push(tree.id(node))
      else gather(node)
      if (ids.length > 0) own = ids
    }
    if (has(node, 'artic')) {
      const mark = ARTIC_GLYPHS[tree.glyph(node) ?? '']
      const noteId = mark ? (own.find((id) => notesById.get(id)?.[mark]) ?? own[0]) : undefined
      if (mark && noteId) found.set(node, { kind: 'articulation', noteId, mark })
      return
    }
    if (has(node, 'clef')) {
      const ref = fromDrawingId(tree.id(node))
      if (ref) found.set(node, ref)
      return
    }
    for (const c of tree.children(node)) visitLayer(c, own)
  }

  measures.forEach((measureNode, bar) => {
    const model = score.measures[bar]
    if (!model) return
    const directions = model.items.filter((i) => isDirection(i) && drawn(i))
    const drawnDirections: N[] = []
    const fermatas: N[] = []
    const breaths: N[] = []

    for (const child of tree.children(measureNode)) {
      if (has(child, 'staff')) {
        let afterNotes = false
        for (const part of tree.children(child)) {
          if (has(part, 'layer')) {
            afterNotes = true
            visitLayer(part, [])
            continue
          }
          const kind = tree.classes(part).map((c) => SIGNATURE_CLASSES[c]).find((k) => k !== undefined)
          if (!kind) continue
          const byId = fromDrawingId(tree.id(part))
          if (byId) {
            found.set(part, byId)
            continue
          }
          const at = inForce(score.measures, kind, afterNotes ? bar + 1 : bar)
          if (at !== undefined) found.set(part, { kind, bar: at })
        }
        continue
      }
      if (has(child, 'dynam') || has(child, 'tempo') || has(child, 'dir')) drawnDirections.push(child)
      else if (has(child, 'fermata')) fermatas.push(child)
      else if (has(child, 'breath')) breaths.push(child)
      else if (has(child, 'barLine')) found.set(child, { kind: 'barline', bar })
      else if (has(child, 'slur') || has(child, 'tie') || has(child, 'hairpin')) spanner(child)
    }

    // Dynamics, tempo marks and words in source order. Should the counts ever differ, they are matched by
    // kind instead: `g.dynam` to dynamics, `g.tempo` and `g.dir` to tempo marks and words.
    if (drawnDirections.length === directions.length) {
      drawnDirections.forEach((node, i) => {
        const item = directions[i]!
        if (isDirection(item)) found.set(node, { kind: item.kind, id: item.id })
      })
    } else {
      const dynamics = directions.filter((i) => i.kind === 'dynamic')
      const others = directions.filter((i) => i.kind !== 'dynamic')
      for (const [nodes, items] of [
        [drawnDirections.filter((n) => has(n, 'dynam')), dynamics],
        [drawnDirections.filter((n) => !has(n, 'dynam')), others],
      ] as const) {
        nodes.forEach((node, i) => {
          const item = items[i]
          if (item && isDirection(item)) found.set(node, { kind: item.kind, id: item.id })
        })
      }
    }

    const notes = model.items.filter(isNote).filter((n) => !n.chord)
    for (const [nodes, mark] of [
      [fermatas, 'fermata'],
      [breaths, 'breath'],
    ] as const) {
      const owners = notes.filter((n) => n[mark])
      nodes.forEach((node, i) => {
        const note = owners[i]
        if (note) found.set(node, { kind: 'articulation', noteId: note.id, mark })
      })
    }
  })
  return found
}
