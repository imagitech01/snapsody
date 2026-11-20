import type { Clef } from '../score/model.ts'

/*
 * The instruments a piece can be played with (practice-app design D8, spec `instruments`).
 *
 * An instrument decides three things and nothing else:
 *  - how its sound is transposed (`transpose`: semitones from the written pitch to the sounding
 *    pitch, applied by the playback timeline only);
 *  - which written notes it cannot play (`writtenRange`, used by the range warning);
 *  - which recorded sound plays it (`sound`).
 *
 * Written notes are NEVER transposed: the score is always as printed in the book. Nothing in this
 * module (or anywhere) rewrites a note for an instrument.
 */

export type InstrumentId = 'tenor-sax' | 'alto-sax' | 'clarinet' | 'piano' | 'guitar' | 'violin' | 'trumpet'

export type InstrumentFamily = 'woodwind' | 'keyboard' | 'string' | 'brass'

export interface Instrument {
  readonly id: InstrumentId
  /** The name as the user sees it. */
  readonly name: string
  readonly family: InstrumentFamily
  /** Semitones from written to sounding pitch (tenor saxophone: -14, a major ninth lower). */
  readonly transpose: number
  /** The written range as MIDI note numbers, both ends included (middle C = C4 = 60). */
  readonly writtenRange: { readonly low: number; readonly high: number }
  /** The clef to use when a page has none. */
  readonly clef: Clef
  /**
   * The sample folder under `samples/` that holds this instrument's recorded sound. It is the
   * instrument's id, so every folder is found the same way (task 5.4 picks the folder).
   */
  readonly sound: string
  /** Defined, but not offered to the user until its sound passes the listening check (task 7.3). */
  readonly hidden?: boolean
}

const TREBLE: Clef = { sign: 'G', line: 2 }

export const TENOR_SAX: Instrument = {
  id: 'tenor-sax',
  name: 'Tenor saxophone',
  family: 'woodwind',
  transpose: -14,
  writtenRange: { low: 58, high: 90 }, // B♭3–F♯6
  clef: TREBLE,
  sound: 'tenor-sax',
}

export const ALTO_SAX: Instrument = {
  id: 'alto-sax',
  name: 'Alto saxophone',
  family: 'woodwind',
  transpose: -9,
  writtenRange: { low: 58, high: 90 }, // B♭3–F♯6
  clef: TREBLE,
  sound: 'alto-sax',
}

export const CLARINET: Instrument = {
  id: 'clarinet',
  name: 'B♭ clarinet',
  family: 'woodwind',
  transpose: -2,
  writtenRange: { low: 52, high: 96 }, // E3–C7
  clef: TREBLE,
  sound: 'clarinet',
}

export const PIANO: Instrument = {
  id: 'piano',
  name: 'Piano',
  family: 'keyboard',
  transpose: 0,
  writtenRange: { low: 21, high: 108 }, // A0–C8
  clef: TREBLE,
  sound: 'piano',
}

export const GUITAR: Instrument = {
  id: 'guitar',
  name: 'Guitar',
  family: 'string',
  transpose: -12,
  writtenRange: { low: 52, high: 83 }, // E3–B5
  clef: TREBLE,
  sound: 'guitar',
}

export const VIOLIN: Instrument = {
  id: 'violin',
  name: 'Violin',
  family: 'string',
  transpose: 0,
  writtenRange: { low: 55, high: 100 }, // G3–E7
  clef: TREBLE,
  sound: 'violin',
}

export const TRUMPET: Instrument = {
  id: 'trumpet',
  name: 'Trumpet',
  family: 'brass',
  transpose: -2,
  writtenRange: { low: 54, high: 86 }, // F♯3–D6
  clef: TREBLE,
  sound: 'trumpet',
}

/** Every defined instrument, in the order they are offered. */
export const INSTRUMENTS: readonly Instrument[] = [TENOR_SAX, ALTO_SAX, CLARINET, PIANO, GUITAR, VIOLIN, TRUMPET]

/** What the app plays with until the user chooses another (spec `instruments`, "Default instrument"). */
export const DEFAULT_INSTRUMENT: Instrument = TENOR_SAX

/** The instruments the user can choose from: all but the hidden ones. */
export function visibleInstruments(): Instrument[] {
  return INSTRUMENTS.filter((i) => !i.hidden)
}

/** An instrument by id, hidden ones included; undefined for an id that does not exist. */
export function instrumentById(id: string): Instrument | undefined {
  return INSTRUMENTS.find((i) => i.id === id)
}

/** The instrument with this id, or the default one when the id is missing or unknown (a stale setting). */
export function instrumentOrDefault(id: string | undefined): Instrument {
  return (id === undefined ? undefined : instrumentById(id)) ?? DEFAULT_INSTRUMENT
}
