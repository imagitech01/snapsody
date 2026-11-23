import type { Measure, Note, Pitch, TimeSignature, VoiceScore } from './model.ts'
import { isNote } from './model.ts'
import { noteDuration } from './musicxml.ts'
import type { Frac } from './rational.ts'
import { ZERO, add, eq, frac, mul, sub, toString } from './rational.ts'

/** A repair the pipeline applied, reported so the UI can say what changed. */
export interface Repair {
  bar: string
  message: string
}

/*
 * The automatic repairs of the recognition pipeline: they change the score and report what they
 * changed. Whatever is left for the user to check is not recorded anywhere: it is computed from the
 * score and the instrument in use whenever it is needed (warnings.ts, design D4).
 */

const STEP_SEMITONES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

export function midiNumber(p: Pitch): number {
  return 12 * (p.octave + 1) + (STEP_SEMITONES[p.step] ?? 0) + (p.alter ?? 0)
}

/** Total time of a bar: grace notes and chord members do not advance time. */
export function barLength(measure: Measure): Frac {
  let total = ZERO
  for (const item of measure.items) {
    if (isNote(item) && !item.grace && !item.chord) total = add(total, item.duration)
  }
  return total
}

const VULGAR: Record<string, string> = { '1/2': '½', '1/3': '⅓', '2/3': '⅔', '1/4': '¼', '3/4': '¾', '1/6': '⅙', '5/6': '⅚', '1/8': '⅛', '3/8': '⅜', '5/8': '⅝', '7/8': '⅞' }

/** A count of beats as a person reads it: 3, 2½, 2⅔, or "2 5/12" when there is no single character. */
export function beatsText(beats: Frac): string {
  const whole = Math.floor(beats.n / beats.d)
  const rest = beats.n - whole * beats.d
  if (rest === 0) return `${whole}`
  const part = VULGAR[`${rest}/${beats.d}`]
  if (part) return whole === 0 ? part : `${whole}${part}`
  return whole === 0 ? `${rest}/${beats.d}` : `${whole} ${rest}/${beats.d}`
}

export function expectedLength(time: TimeSignature): Frac {
  return frac(time.beats, time.beatType)
}

/** The time signature in force for each measure (undefined before the first one). */
export function effectiveTimes(score: VoiceScore): (TimeSignature | undefined)[] {
  let current: TimeSignature | undefined
  return score.measures.map((m) => {
    if (m.time) current = m.time
    return current
  })
}

export function hasNotes(m: Measure): boolean {
  return m.items.some(isNote)
}

function timeSignatureFor(length: Frac): TimeSignature | undefined {
  const quarters = mul(length, frac(4))
  if (quarters.d === 1 && quarters.n > 0) return { beats: quarters.n, beatType: 4 }
  const eighths = mul(length, frac(8))
  if (eighths.d === 1 && eighths.n > 0) return { beats: eighths.n, beatType: 8 }
  return undefined
}

/**
 * When the score has no time signature at all, infers one if most bars add up
 * to the same length, and puts it on the first bar marked `inferred` (the mark is kept in the saved
 * MusicXML, which is how the warning to check it survives). Lengths that are whole
 * quarter notes become n/4 (so a 6/8 exercise reads as 3/4: the two are the
 * same length and cannot be told apart from durations alone). Returns whether one was set; when the
 * bars do not agree, the score is left without a time signature.
 */
export function inferTimeSignature(score: VoiceScore): boolean {
  if (score.measures.some((m) => m.time)) return false
  const first = score.measures[0]
  if (!first) return false
  const counted = score.measures.filter(hasNotes)
  const tally = new Map<string, { length: Frac; count: number }>()
  for (const m of counted) {
    const length = barLength(m)
    const key = toString(length)
    const entry = tally.get(key)
    if (entry) entry.count++
    else tally.set(key, { length, count: 1 })
  }
  let best: { length: Frac; count: number } | undefined
  for (const entry of tally.values()) {
    if (!best || entry.count > best.count) best = entry
  }
  const signature = best && best.count * 2 > counted.length ? timeSignatureFor(best.length) : undefined
  if (!signature) return false
  first.time = { ...signature, inferred: true }
  // The view's attributes are copies; the time signature lives on the bar of the score it was made from (design D2).
  if (score.of) {
    const bar = score.of.score.bars[0]
    if (bar) bar.time = first.time
  }
  return true
}

const EIGHTH_PLAIN = (n: Note): boolean =>
  n.type === 'eighth' && n.dots === 0 && n.timeMod === undefined && !n.grace && !n.chord

/**
 * Conservative triplet repair: reads plain eighth notes as eighth-note
 * triplets, but only when (a) every run of consecutive plain eighths in the bar
 * is a multiple of three long, and (b) converting every such group of three
 * makes the bar add up exactly. Anything else is left alone for the caller to flag.
 */
function repairTriplets(measure: Measure, expected: Frac): string | undefined {
  const notes = measure.items.filter(isNote)
  if (notes.some((n) => n.chord || n.grace)) return undefined
  const surplus = sub(barLength(measure), expected)
  // Each group of three eighths (3/8) becomes 3/12 = 1/4... i.e. shrinks by 1/8.
  const groupsNeeded = mul(surplus, frac(8))
  if (groupsNeeded.d !== 1 || groupsNeeded.n <= 0) return undefined

  const groups: Note[][] = []
  let run: Note[] = []
  const closeRun = (): boolean => {
    if (run.length % 3 !== 0) {
      if (run.length > 0) return false
    } else {
      for (let i = 0; i < run.length; i += 3) groups.push(run.slice(i, i + 3))
    }
    run = []
    return true
  }
  for (const n of notes) {
    if (EIGHTH_PLAIN(n)) {
      run.push(n)
    } else if (!closeRun()) {
      return undefined
    }
  }
  if (!closeRun()) return undefined
  if (groups.length !== groupsNeeded.n) return undefined

  const timeMod = { actual: 3, normal: 2 }
  for (const group of groups) {
    group.forEach((n, i) => {
      n.timeMod = { ...timeMod }
      n.duration = noteDuration('eighth', 0, n.timeMod)
      if (i === 0) n.tuplets.push({ type: 'start', number: 1 })
      if (i === 2) n.tuplets.push({ type: 'stop', number: 1 })
    })
  }
  return `${groups.length} group${groups.length === 1 ? '' : 's'} of three eighth notes read as triplets`
}

/**
 * Repairs missing triplet marks in the bars that do not add up to the time signature in force, where
 * the rule above applies, and leaves every other bar alone (warnings.ts flags those). Bars before any
 * time signature are skipped. Only the bars from index [from] on are repaired, still against the time
 * signature in force there: this is how pages added to a piece are prepared without touching the
 * bars the piece already has (core/pages).
 */
export function repairBarLengths(score: VoiceScore, from = 0): Repair[] {
  const repairs: Repair[] = []
  const times = effectiveTimes(score)
  score.measures.forEach((m, index) => {
    const time = times[index]
    if (index < from || !time || !hasNotes(m)) return
    const expected = expectedLength(time)
    if (eq(barLength(m), expected)) return
    const done = repairTriplets(m, expected)
    if (done !== undefined) repairs.push({ bar: m.number, message: `Bar ${m.number}: ${done}` })
  })
  return repairs
}
