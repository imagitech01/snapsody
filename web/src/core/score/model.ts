import type { Frac } from './rational.ts'

/**
 * The score model (design D6). Scope: one part, one voice, one staff, which is
 * what an exercise for a single instrument needs. Durations are exact
 * fractions of a whole note.
 */

export type NoteType =
  | 'maxima'
  | 'long'
  | 'breve'
  | 'whole'
  | 'half'
  | 'quarter'
  | 'eighth'
  | '16th'
  | '32nd'
  | '64th'
  | '128th'

export type Step = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G'

export interface Pitch {
  step: Step
  /** Semitones: -1 flat, 1 sharp; may be fractional for microtones. */
  alter?: number
  octave: number
}

export interface SlurMark {
  type: 'start' | 'stop' | 'continue'
  number: number
}

export interface TupletMark {
  type: 'start' | 'stop'
  number: number
}

export interface TimeModification {
  actual: number
  normal: number
}

export interface Note {
  kind: 'note'
  /** Stable id, unique within the score; written as the `id` attribute of `<note>`. */
  id: string
  /** Absent for rests. */
  pitch?: Pitch
  rest?: boolean
  /** A whole-measure rest (`<rest measure="yes"/>`). */
  measureRest?: boolean
  /** Written accidental text as in `<accidental>`, e.g. "sharp", "natural". */
  accidental?: string
  /** Printed note value; absent when the source gave only a duration. */
  type?: NoteType
  dots: number
  timeMod?: TimeModification
  /** Sounding length as a fraction of a whole note. Zero for grace notes. */
  duration: Frac
  grace?: boolean
  /** Sounds together with the previous note (does not advance time). */
  chord?: boolean
  tieStart?: boolean
  tieStop?: boolean
  slurs: SlurMark[]
  tuplets: TupletMark[]
  staccato?: boolean
  /** Held for its full value (`<tenuto/>`). */
  tenuto?: boolean
  /** Played with a stronger attack (`<accent/>`). */
  accent?: boolean
  /** Held about twice its written length (`<fermata/>`); a rest can carry one too. */
  fermata?: boolean
  breath?: boolean
  /** An even stronger attack than an accent (`<strong-accent/>`; change more-marks, design D1). */
  strongAccent?: boolean
  /** Shorter than staccato (`<staccatissimo/>`). */
  staccatissimo?: boolean
  /** A short break before the next note (`<caesura/>`). */
  caesura?: boolean
  /** At most one per note: a trill (`<trill-mark/>`), a turn (`<turn/>` or `<inverted-turn/>`) or a mordent. */
  ornament?: 'trill' | 'turn' | 'mordent'
  /**
   * A tremolo (`<tremolo>`): `single` repeats the note; `start` and `stop` are the two notes of one
   * alternating pair (adjacent in a bar). `strokes` is the number of beams across the stem.
   */
  tremolo?: { kind: 'single' | 'start' | 'stop'; strokes: number }
  /** Rolled upwards (`<arpeggiate/>`); kept on the first note of the chord, written on every chord note. */
  arpeggio?: boolean
}

/**
 * Dynamics, tempo marks and words have a stable id, unique among them within the score (change
 * select-and-delete-elements, design D1), so that a selection of one survives edits. It is written as
 * the `id` attribute of its `<direction>`, and a score read without one gets a fresh one.
 */
export interface DynamicItem {
  kind: 'dynamic'
  id: string
  mark: string
}

/** A tempo marking: words, a metronome mark, or both. */
export interface TempoItem {
  kind: 'tempo'
  /** See `DynamicItem.id`. */
  id: string
  words?: string
  beatUnit?: NoteType
  beatUnitDots?: number
  perMinute?: number
  /** `<sound tempo>` in quarter notes per minute, when present. */
  soundTempo?: number
}

/** Other direction words (e.g. "dolce", "rit."); kept, not interpreted. */
export interface WordsItem {
  kind: 'words'
  /** See `DynamicItem.id`. */
  id: string
  text: string
}

/**
 * A hairpin: a crescendo or diminuendo from one note to another (MusicXML `<wedge>`).
 *
 * It is tied to its notes by id, like a slur, so it follows them through edits. It is kept in the
 * measure of its first note, directly before that note. The notes under it are the ones from `start`
 * to `stop` in score order, both included; `start` and `stop` may be the same note. In MusicXML it is
 * a pair of directions: the start before the first note and the stop after the last one.
 */
export interface WedgeItem {
  kind: 'wedge'
  type: 'crescendo' | 'diminuendo'
  /** Id of the first note under the hairpin. */
  start: string
  /** Id of the last note under the hairpin. */
  stop: string
}

export type MeasureItem = Note | DynamicItem | TempoItem | WordsItem | WedgeItem

/** A measure item drawn from a `<direction>` that carries an id: a dynamic, a tempo mark or words. */
export type DirectionItem = DynamicItem | TempoItem | WordsItem

export interface Clef {
  sign: string
  line?: number
  octaveChange?: number
}

export interface KeySignature {
  fifths: number
  mode?: string
}

export interface TimeSignature {
  beats: number
  beatType: number
  symbol?: 'common' | 'cut'
  /** True when the app inferred this time signature (none was recognised). */
  inferred?: boolean
}

export interface Ending {
  /** e.g. "1" or "1, 2". */
  number: string
  type: 'start' | 'stop' | 'discontinue'
}

export interface Barline {
  style?: string
  repeat?: 'forward' | 'backward'
  times?: number
  ending?: Ending
}

export interface Measure {
  /** Printed measure number (kept as a string, as in MusicXML). */
  number: string
  clef?: Clef
  key?: KeySignature
  time?: TimeSignature
  leftBarline?: Barline
  rightBarline?: Barline
  newSystem?: boolean
  /**
   * On the first bar of a multi-measure rest: how many bars (this one included) were printed as one
   * symbol. The bars stay as they are, one whole-bar rest each; whether the run still holds is
   * `multiRestRuns`.
   */
  multiRest?: number
  items: MeasureItem[]
}

export interface Score {
  title?: string
  partName?: string
  measures: Measure[]
}

export function isNote(item: MeasureItem): item is Note {
  return item.kind === 'note'
}

export function isWedge(item: MeasureItem): item is WedgeItem {
  return item.kind === 'wedge'
}

export function isDirection(item: MeasureItem): item is DirectionItem {
  return item.kind === 'dynamic' || item.kind === 'tempo' || item.kind === 'words'
}

/**
 * A direction id that no note or direction of the score uses: `d1`, `d2`, ... For items made by an edit
 * or a merge; the parser keeps the ids it reads.
 */
export function freshDirectionId(score: Score, taken: ReadonlySet<string> = new Set()): string {
  const used = new Set(taken)
  for (const m of score.measures) for (const item of m.items) if (isNote(item) || isDirection(item)) used.add(item.id)
  let n = 1
  while (used.has(`d${n}`)) n++
  return `d${n}`
}

export function notesOf(measure: Measure): Note[] {
  return measure.items.filter(isNote)
}

/** A multi-measure rest that still holds: `length` bars from the bar at index `start`. */
export interface MultiRestRun {
  start: number
  length: number
}

/**
 * A bar that is nothing but one whole-bar rest: no barline, direction, other note or mark, and no clef,
 * key or time, except on the first bar of the run (`first`), where they are drawn before the symbol.
 */
function isPlainRestBar(m: Measure, first: boolean): boolean {
  if (!first && (m.clef || m.key || m.time)) return false
  if (m.leftBarline || m.rightBarline) return false
  const [only, ...more] = m.items
  if (!only || more.length > 0 || !isNote(only)) return false
  return only.rest === true && only.measureRest === true && !only.grace && !only.chord && !only.fermata
}

/**
 * The multi-measure rests that still hold (change more-marks, design D2): a bar with `multiRest` n >= 2
 * whose n bars, itself included, are all plain whole-bar rests (see `isPlainRestBar`; the first may carry a clef, key or time) and exist in the
 * score. The one place that says it: the serializer writes `<multiple-rest>` for these and no others,
 * and whatever maps bars to drawn measures or clears `multiRest` after an edit asks it too. Runs come
 * in score order and never overlap; a `multiRest` inside a run that holds is ignored.
 */
export function multiRestRuns(score: Score): MultiRestRun[] {
  const runs: MultiRestRun[] = []
  let covered = 0
  score.measures.forEach((m, index) => {
    if (index < covered) return
    const n = m.multiRest
    if (n === undefined || n < 2 || index + n > score.measures.length) return
    for (let k = 0; k < n; k++) {
      const bar = score.measures[index + k]
      if (!bar || !isPlainRestBar(bar, k === 0)) return
    }
    runs.push({ start: index, length: n })
    covered = index + n
  })
  return runs
}

/** Whether the bar at `barIndex` starts a multi-measure rest that still holds. */
export function multiRestHolds(score: Score, barIndex: number): boolean {
  return multiRestRuns(score).some((r) => r.start === barIndex)
}
