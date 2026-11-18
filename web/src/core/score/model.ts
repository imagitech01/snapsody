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
}

export interface DynamicItem {
  kind: 'dynamic'
  mark: string
}

/** A tempo marking: words, a metronome mark, or both. */
export interface TempoItem {
  kind: 'tempo'
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

export function notesOf(measure: Measure): Note[] {
  return measure.items.filter(isNote)
}
