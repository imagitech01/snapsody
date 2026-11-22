import type { Bar, Clef, KeySignature, Note, Part, PartBar, Score, TimeSignature } from '../score/model.ts'
import { allItemLists } from '../score/model.ts'
import { isDirection, isNote, isWedge } from '../score/model.ts'
import { dropLooseSlurEnds, parseMusicXml, serializeMusicXml } from '../score/musicxml.ts'
import { prepareScore, repairVoices } from '../score/prepare.ts'
import type { PreparedScore } from '../score/prepare.ts'
import type { Frac } from '../score/rational.ts'
import { cmp, frac } from '../score/rational.ts'
import { barLength } from '../score/repairs.ts'

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

/** A prepared score, and where each page it was made from sits in it. */
export interface PreparedPages extends PreparedScore {
  /** One range per page given, in order; bar numbers of the combined score. */
  pages: PageRange[]
  /** What the first reading found and kept, per part (design D4); for an added page, the piece's own, unchanged. */
  partsRead: PartRead[]
  /** What the merge had to leave out or invent, in words (a part only on a later page, ...). Not stored. */
  warnings: string[]
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
  /** What the merge left out (a part only on a later page), in words. */
  warnings: string[]
}

/**
 * What the first reading of a piece found, one entry per part in reading order: how many staves it has and
 * whether the piece keeps it. Pages added later are matched against it (design D4).
 */
export interface PartRead {
  staves: 1 | 2
  kept: boolean
}

/** What is in force in one part: its clef per staff, its key, and (for the whole score) the time. */
interface PartForce {
  clefs: (Clef | undefined)[]
  key?: KeySignature
}

/** The clef, key and time signature in force after the last bar of `score`, for every staff of every part. */
function forceAtEnd(score: Score): { time?: TimeSignature; parts: PartForce[] } {
  const parts: PartForce[] = score.parts.map((p) => ({ clefs: Array.from({ length: p.staves }, () => undefined) }))
  let time: TimeSignature | undefined
  for (const bar of score.bars) {
    if (bar.time) time = bar.time
    bar.parts.forEach((pb, pi) => {
      const force = parts[pi]
      if (!force) return
      if (pb.key) force.key = pb.key
      pb.staves.forEach((sb, si) => {
        if (sb.clef) force.clefs[si] = sb.clef
      })
    })
  }
  return time ? { time, parts } : { parts }
}

/**
 * The page part each part of `reference` is read from: in order, by number of staves (design D4). A part
 * that is not on the page is `undefined`.
 */
function matchParts(pageParts: readonly Part[], reference: readonly PartRead[]): (number | undefined)[] {
  let next = 0
  return reference.map((r) => {
    for (let j = next; j < pageParts.length; j++) {
      if (pageParts[j]!.staves === r.staves) {
        next = j + 1
        return j
      }
    }
    return undefined
  })
}

/** Gives every staff of the score as many voices in every bar as it has in its busiest bar (an empty voice is an empty list). */
export function padVoices(score: Score): void {
  score.parts.forEach((part, pi) => {
    for (let si = 0; si < part.staves; si++) {
      const count = Math.max(1, ...score.bars.map((b) => b.parts[pi]?.staves[si]?.voices.length ?? 0))
      for (const bar of score.bars) {
        const voicesOfStaff = bar.parts[pi]?.staves[si]?.voices
        while (voicesOfStaff && voicesOfStaff.length < count) voicesOfStaff.push([])
      }
    }
  })
}

/**
 * Merges the parsed raw readings of pages, in order, into one score. The pages are not changed.
 *
 * - Bars are concatenated and numbered by position, continuing after the bars of `after` (the piece
 *   the pages are added to; none for a new piece).
 * - Parts are matched across pages (design D4): each page's parts are matched, in order and by number of
 *   staves, to the parts of the first page (for a new piece), or to the parts of `partsRead` (for pages
 *   added to a piece: what its first reading found, and which parts it kept); without `partsRead` the
 *   reference is the parts the piece has. A part that is not on a page gets whole-bar rests there (per
 *   staff, in the first voice). A part only on a later page, or one that is not in the reference, is dropped
 *   with a warning. Parts that `partsRead` says were not kept are dropped without one.
 * - A clef, key or time signature at the start of a page that repeats the one in force is dropped;
 *   one that differs is kept, as a change. Mid-page attributes are never touched. Equal means the
 *   same music: a clef's default line is filled in, a key's mode counts only when both sides have
 *   one, and a time signature's symbol and `inferred` mark do not count. The clef is per staff and the
 *   key per part; the time signature is shared.
 * - Every note gets a new id, unique in the merged score and, with `after`, in the piece. Ids are
 *   unique per page only (the parser numbers each page from `n1`), so a hairpin's `start` and `stop`
 *   go through the id map of its own page. A hairpin whose ends are not both on its page is dropped.
 *   Dynamics, tempo marks and words get new direction ids the same way (change
 *   select-and-delete-elements, design D1). Slurs, ties and tuplets carry no ids and stay as they are.
 *
 * Throws when a page has no bars.
 */
export function mergePages(pagesRead: readonly Score[], after?: Score, partsRead?: readonly PartRead[]): MergedPages {
  let pages = pagesRead
  const warnings: string[] = []
  // The reference parts, and the parts of the result (one per kept reference part, in order).
  let reference: PartRead[]
  let targets: Part[]
  if (!after) {
    targets = (pages[0]?.parts ?? []).map((p) => ({ ...p }))
    reference = targets.map((p) => ({ staves: p.staves, kept: true }))
  } else if (partsRead && partsRead.filter((p) => p.kept).length === after.parts.length) {
    reference = partsRead.map((p) => ({ ...p }))
    targets = after.parts.map((p) => ({ ...p }))
  } else {
    targets = after.parts.map((p) => ({ ...p }))
    reference = targets.map((p) => ({ staves: p.staves, kept: true }))
    // A piece from before parts is one one-staff part: each page is cut down to its first part, first staff
    // and first voice, as the reader did then, whatever its staves.
    if (targets.length === 1 && targets[0]!.staves === 1) pages = pages.map(firstLineOnly)
  }
  const keptRefs = reference.map((r, index) => ({ r, index })).filter((x) => x.r.kept)

  const force = after ? forceAtEnd(after) : { parts: targets.map((p): PartForce => ({ clefs: Array.from({ length: p.staves }, () => undefined) })) }
  let time = force.time
  const used = new Set<string>()
  // Ids are unique in the whole piece, every voice of every part included (design D2).
  const afterItems = after ? allItemLists(after) : []
  for (const items of afterItems) for (const item of items) if (isNote(item)) used.add(item.id)
  let counter = used.size
  // Direction ids (d1, d2, ...) are made fresh too, as each page numbers its own from d1.
  for (const items of afterItems) for (const item of items) if (isDirection(item)) used.add(item.id)
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

  const bars: Bar[] = []
  const ranges: PageRange[] = []
  let number = (after?.bars.length ?? 0) + 1
  pages.forEach((page, index) => {
    if (page.bars.length === 0) throw new Error(`Page ${index + 1} has no bars`)
    const firstBar = number
    const ids = new Map<string, string>()
    const own: Bar[] = []
    const matched = matchParts(page.parts, reference)
    const taken = new Set(matched.filter((j): j is number => j !== undefined))
    page.parts.forEach((p, j) => {
      if (!taken.has(j)) warnings.push(`Page ${index + 1}: part ${p.name || p.id} is not on the first page, so it was dropped`)
    })
    page.bars.forEach((source, i) => {
      const bar: Bar = { number: String(number++), parts: [] }
      if (source.time) bar.time = structuredClone(source.time)
      if (source.leftBarline) bar.leftBarline = structuredClone(source.leftBarline)
      if (source.rightBarline) bar.rightBarline = structuredClone(source.rightBarline)
      if (source.newSystem) bar.newSystem = true
      if (i === 0 && bar.time && time && sameTime(bar.time, time)) delete bar.time
      if (bar.time) time = bar.time
      keptRefs.forEach(({ index: refIndex }, k) => {
        const pagePart = matched[refIndex]
        const partForce = force.parts[k]!
        const pb: PartBar = { staves: [] }
        const sourceBar = pagePart === undefined ? undefined : source.parts[pagePart]
        if (sourceBar) {
          const copy = structuredClone(sourceBar)
          if (i === 0 && copy.key && partForce.key && sameKey(copy.key, partForce.key)) delete copy.key
          if (copy.key) partForce.key = copy.key
          if (copy.multiRest !== undefined) pb.multiRest = copy.multiRest
          if (copy.key) pb.key = copy.key
          copy.staves.forEach((sb, si) => {
            const prior = partForce.clefs[si]
            if (i === 0 && sb.clef && prior && sameClef(sb.clef, prior)) delete sb.clef
            if (sb.clef) partForce.clefs[si] = sb.clef
            for (const items of sb.voices) {
              for (const item of items) {
                if (isDirection(item)) item.id = freshDirectionId()
                if (!isNote(item)) continue
                const id = freshId()
                ids.set(item.id, id)
                item.id = id
              }
            }
          })
          pb.staves = copy.staves
        } else {
          // A part that is not on this page rests: one whole-bar rest per staff, in the first voice.
          const length = time ? frac(time.beats, time.beatType) : longestFirstVoice(source)
          for (let si = 0; si < targets[k]!.staves; si++) {
            const rest: Note = { kind: 'note', id: freshId(), rest: true, measureRest: true, dots: 0, duration: length, slurs: [], tuplets: [] }
            pb.staves.push({ voices: [[rest]] })
          }
        }
        bar.parts.push(pb)
      })
      own.push(bar)
    })
    for (const bar of own) {
      for (const pb of bar.parts) {
        for (const sb of pb.staves) {
          for (let v = 0; v < sb.voices.length; v++) {
            sb.voices[v] = sb.voices[v]!.filter((item) => {
              if (!isWedge(item)) return true
              const start = ids.get(item.start)
              const stop = ids.get(item.stop)
              if (start === undefined || stop === undefined) return false
              item.start = start
              item.stop = stop
              return true
            })
          }
        }
      }
    }
    bars.push(...own)
    ranges.push({ firstBar, lastBar: number - 1 })
  })

  const first = pages[0]
  const score: Score = { parts: keptRefs.map((_, k) => targets[k]!), bars }
  if (first?.title !== undefined) score.title = first.title
  padVoices(score)
  return { score, ranges, warnings }
}

/** A page cut down to its first part, first staff and first voice (what a piece from before parts takes from an added page). */
function firstLineOnly(page: Score): Score {
  const first = page.parts[0]
  if (!first) return page
  return {
    ...page,
    parts: [{ ...first, staves: 1 }],
    bars: page.bars.map((bar) => {
      const pb = bar.parts[0]
      const sb = pb?.staves[0]
      const copy: PartBar = { staves: [{ voices: [sb?.voices[0] ?? []], ...(sb?.clef ? { clef: sb.clef } : {}) }] }
      if (pb?.key) copy.key = pb.key
      if (pb?.multiRest !== undefined) copy.multiRest = pb.multiRest
      return { ...bar, parts: [copy] }
    }),
  }
}

/** The length of the longest first voice in a page bar: what a resting part's whole-bar rest takes when no time signature is known. */
function longestFirstVoice(bar: Bar): Frac {
  let longest = frac(1)
  let found = false
  for (const pb of bar.parts) {
    const length = barLength({ number: bar.number, items: pb.staves[0]?.voices[0] ?? [] })
    if (length.n > 0 && (!found || cmp(length, longest) > 0)) {
      longest = length
      found = true
    }
  }
  return longest
}

/**
 * Keeps the parts of a merged score that `keep` says (by position; absent means kept). Throws when none is kept.
 * The way the parts step of the add-music flow passes what the user chose (design D4).
 */
export function keepParts(score: Score, keep: readonly boolean[]): Score {
  const kept = score.parts.map((_, i) => keep[i] !== false)
  if (!kept.some(Boolean)) throw new Error('No part is kept')
  return {
    ...score,
    parts: score.parts.filter((_, i) => kept[i]),
    bars: score.bars.map((bar) => ({ ...bar, parts: bar.parts.filter((_, i) => kept[i]) })),
  }
}

/**
 * A new piece from the raw readings of its pages (MusicXML, in page order): the pages are merged,
 * then the time signature is inferred when none was recognised and bar lengths are repaired on the
 * merged score. `bars` and the repairs' bar numbers are those of the whole piece. Throws when there
 * is no page, when a reading is not partwise MusicXML, or when a page has no bars; the message
 * names the page. `options` go with the pages by index (`PageOptions`); a page without is as read.
 * `keep` says which parts of the first page's reading the piece keeps, by position (default: all; the parts
 * step of the add-music flow passes it). The result's `partsRead` records what was read and kept.
 */
export function preparePages(rawPages: readonly string[], options: ReadonlyArray<PageOptions | undefined> = [], keep: readonly boolean[] = []): PreparedPages {
  if (rawPages.length === 0) throw new Error('No pages to combine')
  const merged = mergePages(parseAll(rawPages, options))
  const partsRead: PartRead[] = merged.score.parts.map((p, i) => ({ staves: p.staves, kept: keep[i] !== false }))
  const score = keepParts(merged.score, keep)
  // The pages were read with their loose slur ends (`parseAll`): a slur over a page break is whole now.
  dropLooseSlurEnds(score)
  return { ...prepareScore(score), pages: merged.ranges, partsRead, warnings: merged.warnings }
}

/**
 * Adds the raw readings of more pages to a piece's current, corrected score (MusicXML), after its
 * last bar. The new pages are merged with the clef, key and time in force at the end of the piece,
 * and the new bars are repaired against that time signature. The bars the piece has are not
 * prepared again: they keep their content and note ids, and the repairs returned are only those of
 * the new bars. When no time signature is in force at the end of the piece and the new pages bring
 * none, nothing is inferred: that would put an inferred signature in the middle of the piece.
 *
 * `partsRead` is what the piece's first reading found and kept (`PieceInfo.partsRead`): the new pages' parts
 * are matched against it and the parts it did not keep are dropped again, without asking. Without it (a piece
 * saved before parts) only the piece's own first part is taken from the new pages.
 *
 * `musicxml` and `bars` are those of the whole piece; `pages` are the new pages' bar numbers, which
 * continue after the existing bars. Throws as `preparePages` does, and when `current` is not partwise
 * MusicXML. `options` are as for `preparePages`.
 */
export function appendPages(current: string, rawPages: readonly string[], options: ReadonlyArray<PageOptions | undefined> = [], partsRead?: readonly PartRead[]): PreparedPages {
  if (rawPages.length === 0) throw new Error('No pages to combine')
  const existing = parseMusicXml(current, [], { keepLooseSlurs: true })
  if (existing.bars.length === 0) return preparePages(rawPages, options)
  const { score: added, ranges, warnings } = mergePages(parseAll(rawPages, options), existing, partsRead)
  const firstNew = existing.bars.length
  existing.bars.push(...added.bars)
  padVoices(existing)
  dropLooseSlurEnds(existing)
  const repairs = repairVoices(existing, firstNew)
  const result: PreparedPages = { musicxml: serializeMusicXml(existing), repairs, bars: existing.bars.length, pages: ranges, partsRead: partsRead ? partsRead.map((p) => ({ ...p })) : existing.parts.map((p) => ({ staves: p.staves, kept: true })), warnings }
  return result
}

/** Parses the readings, loose slur ends kept for after the merge; a time signature the reader estimated at the start of a page is taken out (`PageOptions`). */
function parseAll(rawPages: readonly string[], options: ReadonlyArray<PageOptions | undefined>): Score[] {
  return rawPages.map((raw, index) => {
    let score: Score
    try {
      score = parseMusicXml(raw, [], { keepLooseSlurs: true })
    } catch (error) {
      throw new Error(`Page ${index + 1}: ${error instanceof Error ? error.message : String(error)}`)
    }
    const first = score.bars[0]
    if (options[index]?.timeEstimated && first) delete first.time
    return score
  })
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
