import type { Clef, KeySignature, Measure, Score, TimeSignature } from '../score/model.ts'
import { isDirection, isNote, isWedge } from '../score/model.ts'
import { parseMusicXml, serializeMusicXml } from '../score/musicxml.ts'
import { prepareScore } from '../score/prepare.ts'
import type { PreparedScore } from '../score/prepare.ts'
import { repairBarLengths } from '../score/repairs.ts'

/*
 * Pages of a piece (practice-app design D6, specs `score-recognition` "Pages combined into one
 * score" and `score-capture` "Add pages to a piece").
 *
 * Each page is read on its own, so each reading is a complete score: it starts at bar 1, carries its
 * own clef, key and often time signature, and numbers its notes from the start. This module turns
 * the readings into one score. It is pure: strings and scores in, strings and scores out, nothing
 * read or written.
 *
 * - `mergePages` is the merge on the score model.
 * - `preparePages` makes a new piece: merge the raw pages first, then run the same pipeline a single
 *   page goes through (`prepareScore`: time-signature inference and bar-length repair) on the
 *   merged score. Page 2 is thereby checked against the 3/4 that page 1 declared.
 * - `appendPages` adds pages to a corrected score: the new pages are merged with the clef, key and
 *   time in force at its end, and only the new bars are repaired. The bars the piece has keep their
 *   content and note ids.
 * - Both take what the reader said about each page (`PageOptions`, design D7). A time signature the
 *   reader estimated at the start of a page, rather than read, counts as absent: on a later page the
 *   time in force carries on, and on the first page of a new piece the time signature is inferred
 *   (and marked inferred) as for a page without one.
 */

/** The bars a page gave to the piece, as bar numbers: first and last included. */
export interface PageRange {
  firstBar: number
  lastBar: number
}

/** What the reader said about one page next to its MusicXML (design D7). */
export interface PageOptions {
  /**
   * The time signature at the start of the page was not read but estimated by the reader (homr
   * writes n/4 from the median bar length when none is printed). It counts as absent.
   */
  timeEstimated?: boolean
}

/** The clef, key and time signature in force: the last ones set at or before a point in a score. */
export interface InForce {
  clef?: Clef
  key?: KeySignature
  time?: TimeSignature
}

/** A prepared score, and where each page it was made from sits in it. */
export interface PreparedPages extends PreparedScore {
  /** One range per page given, in order; bar numbers of the combined score. */
  pages: PageRange[]
}

export interface MergedPages {
  /**
   * The pages as one score: title and part name of the first page, and every bar numbered by its
   * position in the piece (after the bars of `after`, when given). Only the bars of the pages are in
   * it, not those of `after`.
   */
  score: Score
  /** One range per page, in order. */
  ranges: PageRange[]
}

/** The clef, key and time signature in force after the last bar of `score`. */
export function inForceAtEnd(score: Score): InForce {
  const inForce: InForce = {}
  for (const m of score.measures) track(m, inForce)
  return inForce
}

/**
 * Merges the parsed raw readings of pages, in order, into one score. The pages are not changed.
 *
 * - Bars are concatenated and numbered by position, continuing after the bars of `after` (the piece
 *   the pages are added to; none for a new piece).
 * - A clef, key or time signature at the start of a page that repeats the one in force is dropped;
 *   one that differs is kept, as a change. Mid-page attributes are never touched. Equal means the
 *   same music: a clef's default line is filled in, a key's mode counts only when both sides have
 *   one, and a time signature's symbol and `inferred` mark do not count.
 * - Every note gets a new id, unique in the merged score and, with `after`, in the piece. Ids are
 *   unique per page only (the parser numbers each page from `n1`), so a hairpin's `start` and `stop`
 *   go through the id map of its own page. A hairpin whose ends are not both on its page is dropped.
 *   Dynamics, tempo marks and words get new direction ids the same way (change
 *   select-and-delete-elements, design D1). Slurs, ties and tuplets carry no ids and stay as they are.
 *
 * Throws when a page has no bars.
 */
export function mergePages(pages: readonly Score[], after?: Score): MergedPages {
  const inForce = after ? inForceAtEnd(after) : {}
  const used = new Set<string>()
  for (const m of after?.measures ?? []) for (const item of m.items) if (isNote(item)) used.add(item.id)
  let counter = used.size
  // Direction ids (d1, d2, ...) are made fresh too, as each page numbers its own from d1.
  for (const m of after?.measures ?? []) for (const item of m.items) if (isDirection(item)) used.add(item.id)
  const freshId = (): string => {
    let id: string
    do id = `n${++counter}`
    while (used.has(id))
    used.add(id)
    return id
  }
  let directionCounter = 0
  const freshDirectionId = (): string => {
    let id: string
    do id = `d${++directionCounter}`
    while (used.has(id))
    used.add(id)
    return id
  }

  const measures: Measure[] = []
  const ranges: PageRange[] = []
  let bar = (after?.measures.length ?? 0) + 1
  pages.forEach((page, index) => {
    if (page.measures.length === 0) throw new Error(`Page ${index + 1} has no bars`)
    const firstBar = bar
    const ids = new Map<string, string>()
    const own: Measure[] = []
    page.measures.forEach((source, i) => {
      const m = structuredClone(source)
      m.number = String(bar++)
      if (i === 0) dropRepeated(m, inForce)
      track(m, inForce)
      for (const item of m.items) {
        if (isDirection(item)) item.id = freshDirectionId()
        if (!isNote(item)) continue
        const id = freshId()
        ids.set(item.id, id)
        item.id = id
      }
      own.push(m)
    })
    for (const m of own) {
      m.items = m.items.filter((item) => {
        if (!isWedge(item)) return true
        const start = ids.get(item.start)
        const stop = ids.get(item.stop)
        if (start === undefined || stop === undefined) return false
        item.start = start
        item.stop = stop
        return true
      })
    }
    measures.push(...own)
    ranges.push({ firstBar, lastBar: bar - 1 })
  })

  const first = pages[0]
  const score: Score = { measures }
  if (first?.title !== undefined) score.title = first.title
  if (first?.partName !== undefined) score.partName = first.partName
  return { score, ranges }
}

/**
 * A new piece from the raw readings of its pages (MusicXML, in page order): the pages are merged,
 * then the time signature is inferred when none was recognised and bar lengths are repaired on the
 * merged score. `bars` and the repairs' bar numbers are those of the whole piece. Throws when there
 * is no page, when a reading is not partwise MusicXML, or when a page has no bars; the message
 * names the page. `options` go with the pages by index (`PageOptions`); a page without is as read.
 */
export function preparePages(rawPages: readonly string[], options: ReadonlyArray<PageOptions | undefined> = []): PreparedPages {
  if (rawPages.length === 0) throw new Error('No pages to combine')
  const { score, ranges } = mergePages(parseAll(rawPages, options))
  return { ...prepareScore(score), pages: ranges }
}

/**
 * Adds the raw readings of more pages to a piece's current, corrected score (MusicXML), after its
 * last bar. The new pages are merged with the clef, key and time in force at the end of the piece,
 * and the new bars are repaired against that time signature. The bars the piece has are not
 * prepared again: they keep their content and note ids, and the repairs returned are only those of
 * the new bars. When no time signature is in force at the end of the piece and the new pages bring
 * none, nothing is inferred: that would put an inferred signature in the middle of the piece.
 *
 * `musicxml` and `bars` are those of the whole piece; `pages` are the new pages' bar numbers, which
 * continue after the existing bars. Throws as `preparePages` does, and when `current` is not partwise
 * MusicXML. `options` are as for `preparePages`.
 */
export function appendPages(current: string, rawPages: readonly string[], options: ReadonlyArray<PageOptions | undefined> = []): PreparedPages {
  if (rawPages.length === 0) throw new Error('No pages to combine')
  const existing = parseMusicXml(current)
  if (existing.measures.length === 0) return preparePages(rawPages, options)
  const { score: added, ranges } = mergePages(parseAll(rawPages, options), existing)
  const firstNew = existing.measures.length
  existing.measures.push(...added.measures)
  const repairs = repairBarLengths(existing, firstNew)
  return { musicxml: serializeMusicXml(existing), repairs, bars: existing.measures.length, pages: ranges }
}

/** Parses the readings; a time signature the reader estimated at the start of a page is taken out (`PageOptions`). */
function parseAll(rawPages: readonly string[], options: ReadonlyArray<PageOptions | undefined>): Score[] {
  return rawPages.map((raw, index) => {
    let score: Score
    try {
      score = parseMusicXml(raw)
    } catch (error) {
      throw new Error(`Page ${index + 1}: ${error instanceof Error ? error.message : String(error)}`)
    }
    const first = score.measures[0]
    if (options[index]?.timeEstimated && first) delete first.time
    return score
  })
}

/** Takes the clef, key and time signature a bar sets into `inForce`. */
function track(m: Measure, inForce: InForce): void {
  if (m.clef) inForce.clef = m.clef
  if (m.key) inForce.key = m.key
  if (m.time) inForce.time = m.time
}

/** Removes from the first bar of a page what repeats the clef, key or time signature in force. */
function dropRepeated(m: Measure, inForce: InForce): void {
  if (m.clef && inForce.clef && sameClef(m.clef, inForce.clef)) delete m.clef
  if (m.key && inForce.key && sameKey(m.key, inForce.key)) delete m.key
  if (m.time && inForce.time && sameTime(m.time, inForce.time)) delete m.time
}

const DEFAULT_CLEF_LINE: Record<string, number> = { G: 2, F: 4, C: 3 }

function sameClef(a: Clef, b: Clef): boolean {
  return (
    a.sign === b.sign &&
    (a.line ?? DEFAULT_CLEF_LINE[a.sign]) === (b.line ?? DEFAULT_CLEF_LINE[b.sign]) &&
    (a.octaveChange ?? 0) === (b.octaveChange ?? 0)
  )
}

function sameKey(a: KeySignature, b: KeySignature): boolean {
  return a.fifths === b.fifths && (a.mode === undefined || b.mode === undefined || a.mode === b.mode)
}

function sameTime(a: TimeSignature, b: TimeSignature): boolean {
  return a.beats === b.beats && a.beatType === b.beatType
}
