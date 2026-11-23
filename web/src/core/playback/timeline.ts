import { instrumentOfPart } from '../instruments/instruments.ts'
import type { Instrument, InstrumentId } from '../instruments/instruments.ts'
import { endingsOf } from '../score/endings.ts'
import type { Barline, Measure, Note, Pitch, Score, TimeSignature, VoiceRef, VoiceScore, WedgeItem } from '../score/model.ts'
import { isNote, isWedge, voiceView, voices } from '../score/model.ts'
import type { Frac } from '../score/rational.ts'
import { ZERO, add, cmp, div, frac, mul, sub } from '../score/rational.ts'
import { barQuarters, meterBeatUnit } from './tempo.ts'

/*
 * Timeline expansion (tasks 10.1 and 10.2, design D8).
 *
 * Turns the score model into the list of sounding events a player would
 * produce: repeats and first/second endings unrolled, ties merged, articulation
 * and dynamics applied, written pitch turned into the instrument's sounding pitch.
 * Only the sound is transposed (by the instrument in use); the score's written notes never are.
 *
 * Parts (change parts-and-accompaniment, design D6): every voice of every part is built on its own and the events are
 * merged in time order, each with its voice, its sound (the instrument that plays it), whether it is part of your line
 * (`own`) and the next event of its voice. The bars are shared, and so is the fermata map: a fermata stretches the note
 * to twice its value for all parts at once.
 *
 * Expression (practice-app design D10): a fermata stretches its note to twice its value (so the
 * bar, the cursor and everything after it move with it), tenuto takes away the staccato shortening,
 * an accent carries an attack gain above the note's level, and hairpins move the gain from note to
 * note. The metronome's beats are laid out here too (`Timeline.clicks`), and so is the silence
 * between the repeats of a loop (`loopSpanOf`).
 *
 * All positions are exact fractions of a BEAT (a quarter note, see BEAT_WHOLE).
 * Seconds appear only when the scheduler converts a beat with the tempo.
 */

/** One beat is a quarter note: a tempo of N bpm means N quarter notes per minute. */
export const BEAT_WHOLE: Frac = frac(1, 4)

/** A breath mark leaves a gap of 1/8 beat before the next note. */
export const BREATH_GAP: Frac = frac(1, 8)

/** A caesura leaves a longer gap than a breath mark: 1/4 beat before the next note. */
export const CAESURA_GAP: Frac = frac(1, 4)

/** Staccato notes sound for about half of their written value. */
export const STACCATO_FRACTION: Frac = frac(1, 2)

/** Staccatissimo notes sound for a quarter of their written value (tenuto does not take that away). */
export const STACCATISSIMO_FRACTION: Frac = frac(1, 4)

/** One note of a turn, a mordent or a trill: a thirty-second note, 1/8 beat (at most a quarter of the note it ornaments). */
export const ORNAMENT_NOTE: Frac = frac(1, 8)

/** Each note of an arpeggio enters this long after the one below it (1/16 beat). */
export const ARPEGGIO_STEP: Frac = frac(1, 16)

/** One grace note sounds this long, ending on the beat of the note it belongs to (1/8 beat). */
export const GRACE_NOTE: Frac = frac(1, 8)

/** The note of a tremolo with `strokes` strokes is 1/2^(strokes + 2) of a whole note, that is 1/2^strokes beat (3 strokes: a thirty-second note). */
const MAX_TREMOLO_STROKES = 6

/** Gain (0..1 of full scale) per printed dynamic mark; mf is the default. */
export const DYNAMIC_GAIN: Readonly<Record<string, number>> = {
  ppp: 0.12,
  pp: 0.2,
  p: 0.3,
  mp: 0.45,
  mf: 0.6,
  f: 0.78,
  ff: 0.92,
  fff: 1,
  // Accented marks are sounded as their nearest steady level; the accent itself is not modelled.
  sf: 0.85,
  sfz: 0.85,
  sfp: 0.85,
  fz: 0.85,
  rf: 0.85,
  rfz: 0.85,
}
export const DEFAULT_DYNAMIC = 'mf'

/** The steady levels, softest first: a hairpin without a following dynamic goes one step along this ladder. */
export const DYNAMIC_STEPS: readonly string[] = ['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff']

/** A note under a fermata is held for twice its value. */
export const FERMATA_STRETCH: Frac = frac(2)

/**
 * An accented note starts this many dB louder than its level (and falls back, see `PLAYBACK_TUNING.accentDecay`),
 * as far as the full scale allows: the attack gain never exceeds `MAX_ATTACK_GAIN`, so from f up (0.78 * 1.58 is
 * above 1) the accent is smaller, and at fff, which is full scale already, there is none.
 */
export const ACCENT_DB = 4
const ACCENT_FACTOR = 10 ** (ACCENT_DB / 20)
/** A strong accent (marcato) starts this many dB louder than its level, under the same cap. */
export const STRONG_ACCENT_DB = 7
const STRONG_ACCENT_FACTOR = 10 ** (STRONG_ACCENT_DB / 20)
/** The largest gain any note reaches, accents included (full scale). */
export const MAX_ATTACK_GAIN = 1

/**
 * One note of its own inside an event (ornaments, tremolo, arpeggio, grace notes). `offset` and `length` are
 * in beats, like the other fields of an event, `offset` from the event's `start` (negative for a grace note).
 */
export interface Sound {
  /** Sounding MIDI note. */
  midi: number
  offset: Frac
  length: Frac
  gain: number
}

export interface PlaybackEvent {
  /** Index in `Timeline.events`. */
  index: number
  /** Start, in beats from the start of the played score. */
  start: Frac
  /** Length in beats: the written value (ties merged), doubled for a note under a fermata. */
  length: Frac
  /** How long the note sounds in beats: `length`, shortened by staccato or a breath mark. 0 for rests. */
  sounding: Frac
  rest: boolean
  /** Sounding MIDI notes (written pitch plus the instrument's transposition); empty for rests. */
  pitches: number[]
  /** Written MIDI notes, for reference and display. */
  written: number[]
  /** Model note ids covered by this event (several when ties were merged); the first is the head. */
  noteIds: string[]
  /** Index of the measure in score.measures, and its printed number. */
  barIndex: number
  bar: string
  /** Which time through the music this bar was played (1-based; 2 on the repeat). */
  pass: number
  staccato: boolean
  /** Gain 0..1 from the dynamic in force, moved along a hairpin that covers the note. */
  gain: number
  /** The dynamic mark in force (under a hairpin: the one it started from; after it: the one it reached). */
  dynamic: string
  /** The note carries an accent or a strong accent. */
  accent: boolean
  /** The accent is a strong accent: `STRONG_ACCENT_DB` instead of `ACCENT_DB`. */
  strongAccent?: boolean
  /** Gain at the very start of the note: `gain` raised by `ACCENT_DB` for an accent (at most `MAX_ATTACK_GAIN`), `gain` otherwise. */
  attackGain: number
  /** False when the note is slurred from the previous one: no new attack, start in the sustain (not in a set that always strikes, see samples.ts). */
  attack: boolean
  /** True when this note connects into the next event without a gap (slur). */
  legatoNext: boolean
  /**
   * The notes this event sounds, when it is more than its `pitches` for `sounding` (ornaments, tremolo,
   * arpeggio, grace notes): the scheduler plays these instead, each as its own note. Absent: `pitches` start at
   * `start` and sound for `sounding`. `start`, `length`, `noteIds` and `index` are those of the written note(s) either way.
   */
  sounds?: Sound[]
  /** The voice (part, staff, voice) this event is of. */
  voice: VoiceRef
  /** The instrument that plays it: its id, which is also its sample folder (`Instrument.sound`). */
  sound: InstrumentId
  /** Part of your line: the cursor follows it, and it sounds only while your line is on. */
  own: boolean
  /** Index (in `Timeline.events`) of the next event of the same voice; absent for the last. Legato and ties never look at `index + 1`. */
  nextInVoice?: number
}

/** One bar as played; a repeated bar appears once per pass. */
export interface BarSpan {
  barIndex: number
  bar: string
  pass: number
  start: Frac
  end: Frac
  /** Index of the first event that starts in this bar, any part (or events.length when none). */
  firstEvent: number
  /** The beat grid of the time signature in force: the metronome's beat and the nominal length of a bar, in beats. */
  meter: Meter
}

/** The beats of a time signature, in quarter-note beats: 3/4 clicks every 1, 6/8 (compound time) every 3/2. */
export interface Meter {
  /** Distance between two metronome clicks. */
  beatUnit: Frac
  /** The length of a full bar. */
  barLength: Frac
}

/** One metronome click, on the beat grid of the bar it falls in. */
export interface BeatClick {
  /** Beats from the start of the played score. */
  start: Frac
  /** The first beat of a bar. */
  accent: boolean
  barIndex: number
}

/** A loop of bars as beats of a timeline, with the silence that follows each pass. */
export interface LoopSpan {
  start: Frac
  end: Frac
  /** Silence after each pass, in beats (absent: none). */
  rest?: Frac
  /** The metronome's clicks in that silence, as offsets from `end` (the beat grid of the loop's last bar). */
  restClicks?: { offset: Frac; accent: boolean }[]
}

/** Bars of silence the user can put between two passes of a loop. */
export type LoopRest = 0 | 1 | 2

export interface Timeline {
  events: PlaybackEvent[]
  bars: BarSpan[]
  /** End of the last sounding or resting event, in beats. */
  end: Frac
  /** The metronome's beats over the whole played score: every beat of each bar's time signature, the first of the bar accented. */
  clicks: BeatClick[]
  /** The first event of a model note (the head of a tie group), for tap-to-seek. */
  eventOfNote(noteId: string): PlaybackEvent | undefined
  /**
   * The event sounding at `beat` (or the next one that starts after it); undefined past the end. Of several sounding
   * ones, a line of yours comes first, and of those the one that began last.
   */
  eventAtBeat(beat: Frac | number): PlaybackEvent | undefined
  /** Every `own` event sounding at `beat` (its whole `length`, rests too), the one that began last first; empty when none. */
  ownAt(beat: Frac | number): PlaybackEvent[]
  /** The bar being played at `beat`: the last one that has started. */
  barAt(beat: Frac | number): BarSpan | undefined
}

// --- pitch ---

const STEP_SEMITONES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

/** MIDI note number of a written pitch (middle C = C4 = 60). */
export function midiOf(p: Pitch): number {
  return (p.octave + 1) * 12 + (STEP_SEMITONES[p.step] ?? 0) + Math.round(p.alter ?? 0)
}

/** The sounding MIDI note of a written one on this instrument (tenor saxophone: a major ninth lower). */
export function concertMidi(written: number, instrument: Pick<Instrument, 'transpose'>): number {
  return written + instrument.transpose
}

// --- measure order: repeats and endings ---

// Which bars lie in which ending is a view of the bar lines (`core/score/endings.ts`), shared with the editor.
export { parseEndingNumbers } from '../score/endings.ts'

export interface PlayedBar {
  barIndex: number
  /** 1-based time through the music for this occurrence of the bar. */
  pass: number
}

const DOUBLE_BAR_STYLES = new Set(['light-light', 'light-heavy', 'heavy-light', 'heavy-heavy'])

const isDoubleBar = (b: Barline | undefined): boolean => !!b && !b.repeat && !!b.style && DOUBLE_BAR_STYLES.has(b.style)

/**
 * The order in which the bars are played. A backward repeat sends playback back to the last forward
 * repeat until it has been played `times` times (default 2); without a forward repeat it goes back to
 * the last double bar line, or else the start. A backward repeat is not itself a place to go back to.
 * A repeat that was already played in full is not taken again when a later repeat goes back over it.
 * A measure inside a numbered ending is played only on the passes it names.
 * D.C./D.S./coda are not followed.
 */
export function expandMeasureOrder(measures: Measure[]): PlayedBar[] {
  const endings = endingsOf(measures)
  const order: PlayedBar[] = []
  const guard = measures.length * 200 + 1000
  let sectionStart = 0
  let sectionPass = 1
  // A forward repeat in the current section: a double bar line inside it (a key change, say) does
  // not move the place the repeat goes back to.
  let forwardSign = false
  // The furthest bar reached: a backward repeat before it was already played in full.
  let furthest = 0
  let i = 0
  let jumped = false
  while (i < measures.length && order.length < guard) {
    const m = measures[i]!
    if (!jumped && m.leftBarline?.repeat === 'forward') {
      sectionStart = i
      sectionPass = 1
      forwardSign = true
    } else if (!jumped && !forwardSign && sectionPass === 1 && i > 0 && (isDoubleBar(m.leftBarline) || isDoubleBar(measures[i - 1]!.rightBarline))) {
      sectionStart = i
    }
    jumped = false
    const ending = endings[i]
    if (ending && !ending.includes(sectionPass)) {
      i++
      continue
    }
    order.push({ barIndex: i, pass: sectionPass })
    const replaying = i < furthest
    furthest = Math.max(furthest, i)
    if (m.rightBarline?.repeat === 'backward' && !replaying) {
      const times = Math.max(1, m.rightBarline.times ?? 2)
      if (sectionPass < times) {
        sectionPass++
        i = sectionStart
        jumped = true
        continue
      }
      // The section is over; the next repeat without a forward sign goes back to where this one did,
      // unless a forward repeat or a double bar line comes first.
      sectionPass = 1
      forwardSign = false
    } else if (ending && m.rightBarline?.ending && m.rightBarline.ending.type !== 'start') {
      // The last ending of a section was played without a repeat sign: the section is over.
      sectionStart = i + 1
      sectionPass = 1
      forwardSign = false
    }
    i++
  }
  return order
}

// --- slurs ---

/**
 * For each note id: does its sound connect into the following note of the score (it lies inside a
 * slur and is not the slur's last note)? Rests and staccato notes never connect. Every slur in the model has
 * both ends: the reader drops loose ones (musicxml.ts `dropLooseSlurEnds`), as the drawing ignores them.
 */
function slurJoins(measures: Measure[]): { joins: Set<string>; successor: Map<string, string> } {
  const joins = new Set<string>()
  const successor = new Map<string, string>()
  const open = new Set<number>()
  let previous: Note | undefined
  // The note a chord member belongs to: a slur that ends or starts on any note of a chord does so on the chord.
  let head: Note | undefined
  const decide = (): void => {
    if (head && open.size > 0 && !head.rest && !head.staccato && !head.staccatissimo) joins.add(head.id)
    else if (head) joins.delete(head.id)
  }
  const mark = (note: Note): void => {
    // Stops first: a slur may end on the note the next one starts on.
    for (const s of note.slurs) if (s.type === 'stop') open.delete(s.number)
    for (const s of note.slurs) if (s.type === 'start') open.add(s.number)
  }
  for (const m of measures) {
    for (const item of m.items) {
      if (!isNote(item)) continue
      // A grace note's slur marks count (a slur may start on it), but it is not an event of its own.
      if (item.grace) {
        mark(item)
        continue
      }
      if (item.chord) {
        mark(item)
        decide()
        continue
      }
      if (previous) successor.set(previous.id, item.id)
      previous = item
      head = item
      mark(item)
      decide()
    }
  }
  return { joins, successor }
}

// --- events ---

const dynamicGain = (mark: string): number | undefined => DYNAMIC_GAIN[mark]

const num = (f: Frac): number => f.n / f.d

const samePitch = (a: Pitch | undefined, b: Pitch | undefined): boolean =>
  !!a && !!b && a.step === b.step && a.octave === b.octave && Math.round(a.alter ?? 0) === Math.round(b.alter ?? 0)

const toBeats = (whole: Frac): Frac => mul(whole, frac(4))

/**
 * Sounding length of an event of length `length` beats. Tenuto takes the staccato shortening away (not the
 * staccatissimo one); a breath mark or a caesura still leaves its gap, taken from the note's sound.
 */
function soundingLength(length: Frac, staccato: boolean, staccatissimo: boolean, gapOf: Frac | undefined): Frac {
  let s = length
  if (staccato) s = mul(length, STACCATO_FRACTION)
  if (staccatissimo) s = mul(length, STACCATISSIMO_FRACTION)
  if (gapOf) {
    const gap = cmp(gapOf, mul(length, frac(1, 2))) > 0 ? mul(length, frac(1, 2)) : gapOf
    const shortened = sub(length, gap)
    if (cmp(shortened, s) < 0) s = shortened
  }
  return s
}

// --- the beat grid ---

/** The meter in force at each measure: the last time signature stated at or before it, 4/4 when none is. */
function meterTable(measures: Measure[]): Meter[] {
  let time: TimeSignature | undefined
  return measures.map((m) => {
    if (m.time) time = m.time
    return { beatUnit: meterBeatUnit(time), barLength: barQuarters(time) }
  })
}

/** The key signature in force at each measure: the last one stated at or before it, C major (0) when none is. */
function keyTable(measures: Measure[]): number[] {
  let fifths = 0
  return measures.map((m) => {
    if (m.key) fifths = m.key.fifths
    return fifths
  })
}

const STEPS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const
const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B']
const FLAT_ORDER = ['B', 'E', 'A', 'D', 'G', 'C', 'F']

/** The alteration a key signature gives a step. */
function keyAlter(fifths: number, step: string): number {
  if (fifths > 0) return SHARP_ORDER.slice(0, fifths).includes(step) ? 1 : 0
  if (fifths < 0) return FLAT_ORDER.slice(0, -fifths).includes(step) ? -1 : 0
  return 0
}

/**
 * The note `by` steps above (or, negative, below) a pitch on the scale of the key in force: the alteration is
 * the one an earlier note of the same step and octave in the bar had (`barAlters`), else the key signature's.
 */
function scaleNeighbour(p: Pitch, by: number, fifths: number, barAlters: Map<string, number>): Pitch {
  const at = STEPS.indexOf(p.step as (typeof STEPS)[number]) + by
  const step = STEPS[((at % 7) + 7) % 7]!
  const octave = p.octave + Math.floor(at / 7)
  return { step, octave, alter: barAlters.get(`${step}${octave}`) ?? keyAlter(fifths, step) }
}

/** What an event needs to sound its marks once its final length is known. */
interface EventMarks {
  head: Note
  fifths: number
  /** The alterations of the notes before it in its bar, only kept for an ornament. */
  barAlters: Map<string, number>
  /**
   * The note that carries the event's ornament (the first one read, as the parser keeps one per note) and its place
   * in `pitches`: the head, or a chord member, whose ornament is played while the other notes of the chord are held.
   */
  ornamented?: { note: Note; index: number }
  /** Its tremolo: the head's, or else the single tremolo of the first chord member that has one (it repeats the whole chord). */
  tremolo?: Note['tremolo']
  /** The grace notes before it, in order; each is the sounding MIDI notes of one grace note or chord. */
  graces: number[][]
  /** A two-note tremolo: how many of the event's `pitches` belong to the first note (the rest are the second's). */
  pairSplit?: number
}

// --- dynamics and hairpins ---

interface DynamicChange {
  /** The index of the first event it applies to. */
  index: number
  mark: string
}

interface Hairpin {
  type: WedgeItem['type']
  /** The first and the last event under it. */
  first: number
  last: number
}

/** The mark one step softer or louder than a gain, along `DYNAMIC_STEPS` (the same mark when the ladder ends). */
function stepFrom(gain: number, mark: string, type: WedgeItem['type']): string {
  if (type === 'crescendo') return DYNAMIC_STEPS.find((m) => DYNAMIC_GAIN[m]! > gain + 1e-9) ?? mark
  return [...DYNAMIC_STEPS].reverse().find((m) => DYNAMIC_GAIN[m]! < gain - 1e-9) ?? mark
}

/**
 * Sets the gain and dynamic of every event from the marks and hairpins (and then the accent's attack gain).
 *
 * The level starts at mf and follows the printed marks. A hairpin moves the gain from the level at
 * its first note to the next dynamic mark after that note, or one step along `DYNAMIC_STEPS` when
 * there is none or when the mark goes the wrong way. It is linear in time: each note gets the level
 * of its start, so the notes under a crescendo rise one by one and the target is reached where the
 * hairpin ends. From there the target is the level in force until the next mark.
 */
function applyDynamics(events: PlaybackEvent[], changes: DynamicChange[], hairpins: Hairpin[]): void {
  const at = new Map<number, string>()
  for (const c of changes) at.set(c.index, c.mark)
  const startsAt = new Map<number, Hairpin>()
  for (const h of hairpins) startsAt.set(h.first, h)
  const markIndexes = [...at.keys()].sort((a, b) => a - b)

  let mark = DEFAULT_DYNAMIC
  let level = DYNAMIC_GAIN[mark]!
  let active: { end: number; from: number; to: number; target: string; t0: number; t1: number } | undefined
  for (const ev of events) {
    const i = ev.index
    if (active && i >= active.end) {
      mark = active.target
      level = active.to
      active = undefined
    }
    const printed = at.get(i)
    if (printed !== undefined) {
      mark = printed
      level = DYNAMIC_GAIN[printed]!
    }
    const hairpin = startsAt.get(i)
    if (hairpin) {
      const next = markIndexes.find((k) => k > i)
      const printedAhead = next === undefined ? undefined : at.get(next)
      const goesRight =
        printedAhead !== undefined && (hairpin.type === 'crescendo' ? DYNAMIC_GAIN[printedAhead]! > level : DYNAMIC_GAIN[printedAhead]! < level)
      const target = goesRight ? printedAhead! : stepFrom(level, mark, hairpin.type)
      const end = next !== undefined && next <= hairpin.last ? next : hairpin.last + 1
      // The ramp runs to where the event before `end` stops, which is where event `end` starts.
      const last = events[end - 1]!
      active = { end, from: level, to: DYNAMIC_GAIN[target]!, target, t0: num(ev.start), t1: num(last.start) + num(last.length) }
    }
    if (active && i < active.end) {
      const span = active.t1 - active.t0
      const along = span > 0 ? (num(ev.start) - active.t0) / span : 0
      ev.gain = active.from + (active.to - active.from) * Math.min(1, Math.max(0, along))
      ev.dynamic = mark
    } else {
      ev.gain = level
      ev.dynamic = mark
    }
    const factor = ev.strongAccent ? STRONG_ACCENT_FACTOR : ACCENT_FACTOR
    ev.attackGain = ev.accent ? Math.max(ev.gain, Math.min(MAX_ATTACK_GAIN, ev.gain * factor)) : ev.gain
  }
}

const sound = (midi: number, offset: Frac, length: Frac, gain: number): Sound => ({ midi, offset, length, gain })

/** `count` notes of `each` beats from 0, the last one cut to end at `end`. */
function repeated(each: Frac, end: Frac, make: (k: number, offset: Frac, length: Frac) => void): void {
  const count = Math.max(1, Math.ceil(num(end) / num(each) - 1e-9))
  for (let k = 0; k < count; k++) {
    const offset = mul(each, frac(k))
    const length = cmp(add(offset, each), end) > 0 ? sub(end, offset) : each
    make(k, offset, length)
  }
}

/**
 * The sounds of an event that is more than its `pitches` held for `sounding` (design D3): an ornament on a single
 * note, a tremolo, an arpeggio, and the grace notes before it. Undefined for a plain event.
 */
function soundsOf(ev: PlaybackEvent, info: EventMarks | undefined, graceEach: Frac | undefined, instrument: Pick<Instrument, 'transpose'>): Sound[] | undefined {
  if (!info || ev.rest) return undefined
  const { head } = info
  const gain = ev.gain
  const end = ev.sounding
  const out: Sound[] = []
  const graces = info.graces
  if (graceEach && graces.length > 0) {
    graces.forEach((group, j) => {
      const offset = mul(graceEach, frac(j - graces.length))
      for (const midi of group) out.push(sound(midi, offset, graceEach, gain))
    })
  }
  const graced = out.length > 0
  const pitches = ev.pitches
  const split = info.pairSplit
  const note = (written: Pitch): number => concertMidi(midiOf(written), instrument)
  const ornamented = info.ornamented
  if (ornamented && ornamented.note.ornament && ornamented.note.pitch && split === undefined && cmp(end, ZERO) > 0) {
    const { note: carrier, index } = ornamented
    const ornament = carrier.ornament!
    const main = pitches[index]!
    const upper = note(scaleNeighbour(carrier.pitch!, 1, info.fifths, info.barAlters))
    const lower = note(scaleNeighbour(carrier.pitch!, -1, info.fifths, info.barAlters))
    // In a chord, the other notes are held for the chord's length under the ornament.
    pitches.forEach((midi, k) => {
      if (k !== index) out.push(sound(midi, ZERO, end, gain))
    })
    if (ornament === 'trill') {
      // Main and upper note alternate and the trill ends on the main note, which takes up what is left.
      const each = cmp(ORNAMENT_NOTE, div(end, frac(3))) < 0 ? ORNAMENT_NOTE : div(end, frac(3))
      let count = Math.floor(num(end) / num(each) + 1e-9)
      if (count % 2 === 0) count--
      for (let k = 0; k < count; k++) {
        const offset = mul(each, frac(k))
        out.push(sound(k % 2 === 0 ? main : upper, offset, k === count - 1 ? sub(end, offset) : each, gain))
      }
    } else {
      // Turn: upper, main, lower, then the main note held. Mordent: main, lower, then the main note held.
      const lead = ornament === 'turn' ? [upper, main, lower] : [main, lower]
      const quarter = div(end, frac(4))
      const each = cmp(ORNAMENT_NOTE, quarter) < 0 ? ORNAMENT_NOTE : quarter
      lead.forEach((midi, k) => out.push(sound(midi, mul(each, frac(k)), each, gain)))
      const at = mul(each, frac(lead.length))
      out.push(sound(main, at, sub(end, at), gain))
    }
  } else if (info.tremolo && (info.tremolo.kind === 'single' || (info.tremolo.kind === 'start' && split !== undefined))) {
    const strokes = Math.min(MAX_TREMOLO_STROKES, Math.max(1, Math.round(info.tremolo.strokes)))
    const each = frac(1, 2 ** strokes)
    // One note, or one chord, repeated; or the two notes of a pair in turn over the pair's combined value.
    const sets = split === undefined ? [pitches] : [pitches.slice(0, split), pitches.slice(split)]
    repeated(each, end, (k, offset, length) => {
      for (const midi of sets[k % sets.length]!) out.push(sound(midi, offset, length, gain))
    })
  } else if (head.arpeggio && pitches.length > 1 && cmp(end, ZERO) > 0) {
    // From the lowest note up; the roll takes at most half of the chord.
    const room = div(end, frac(2 * (pitches.length - 1)))
    const step = cmp(ARPEGGIO_STEP, room) < 0 ? ARPEGGIO_STEP : room
    ;[...pitches]
      .sort((a, b) => a - b)
      .forEach((midi, k) => {
        const offset = mul(step, frac(k))
        out.push(sound(midi, offset, sub(end, offset), gain))
      })
  } else if (graced) {
    for (const midi of pitches) out.push(sound(midi, ZERO, end, gain))
  }
  return out.length > 0 ? out : undefined
}

// --- the fermata map ---

/** A stretch of written time (in beats of the played order, repeats unrolled) under a fermata. */
interface Interval {
  from: Frac
  to: Frac
}

/**
 * The map from written to played time (design D6.2). Every fermata of every voice is an interval of written
 * time; the intervals are joined where they touch or overlap (a fermata in two parts at once is one hold, not
 * two) and each joined interval is stretched by `FERMATA_STRETCH`. The map is piecewise linear and is the
 * identity when there is no fermata.
 */
function fermataMap(intervals: Interval[]): (written: Frac) => Frac {
  const sorted = intervals.filter((i) => cmp(i.to, i.from) > 0).sort((a, b) => cmp(a.from, b.from))
  const joined: Interval[] = []
  for (const iv of sorted) {
    const last = joined[joined.length - 1]
    if (last && cmp(iv.from, last.to) <= 0) {
      if (cmp(iv.to, last.to) > 0) last.to = iv.to
    } else joined.push({ ...iv })
  }
  if (joined.length === 0) return (w) => w
  const extra = sub(FERMATA_STRETCH, frac(1))
  return (w) => {
    let covered = ZERO
    for (const iv of joined) {
      if (cmp(w, iv.from) <= 0) break
      covered = add(covered, sub(cmp(w, iv.to) < 0 ? w : iv.to, iv.from))
    }
    return add(w, mul(extra, covered))
  }
}

// --- what the builder needs of one voice ---

/** The instrument of a timeline: what its notes are transposed by, and (when known) which sound plays them. */
export type TimelineInstrument = Pick<Instrument, 'transpose'> & { readonly id?: InstrumentId }

/** What a timeline is built for (design D5, D6): your part and hand, and what is switched off under "Plays along". */
export interface TimelineOptions {
  /** Your line: a part, and for a two-staff part possibly one hand (right is its first staff, left its second). Absent: the first part, both hands. */
  part?: { id: string; hand?: 'right' | 'left' }
  /** Parts and hands that do not sound: 'P1', 'P2:left', 'P2:right' ... Your own line is never left out by this. */
  silent?: readonly string[]
}

/** A note as it was placed in a voice, for the hairpins (which are tied to notes by id). */
interface Placement {
  id: string
  /** The note's own written position. */
  pos: Frac
  event: PlaybackEvent
}

/** One voice on its way to events. */
interface VoiceRun {
  ref: VoiceRef
  partIndex: number
  view: VoiceScore
  instrument: TimelineInstrument
  sound: InstrumentId
  own: boolean
  silent: boolean
  events: PlaybackEvent[]
  /** The written position of each dynamic mark and hairpin start of the voice, and of every note placed. */
  dynamics: { at: Frac; mark: string }[]
  wedges: { item: WedgeItem; at: Frac }[]
  placed: Placement[]
  /** Plays one bar of the voice; returns how far into the bar its notes came (written beats). */
  playBar(played: PlayedBar, barStart: Frac): Frac
  /** The next event of the same voice, by event. */
  next: Map<PlaybackEvent, PlaybackEvent>
  flags: Map<PlaybackEvent, EventFlags>
  marks: Map<PlaybackEvent, EventMarks>
  lastId: Map<PlaybackEvent, string>
  joins: Set<string>
  successor: Map<string, string>
}

interface EventFlags {
  staccato: boolean
  staccatissimo: boolean
  tenuto: boolean
  breath: boolean
  caesura: boolean
}

/**
 * Starts one voice: everything about it that lasts from bar to bar (a tie, grace notes waiting for their note), and
 * `playBar`, which places the notes of one played bar. Times are WRITTEN beats here (a fermata does not count);
 * `buildTimeline` puts them through the fermata map when every voice is placed.
 */
function startVoice(run: VoiceRun, keys: number[], fermatas: Interval[]): void {
  const { instrument } = run
  const { events, flags, marks, lastId } = run
  /** The event a following tied note of the same pitch would extend. */
  let tieOpen: { event: PlaybackEvent; pitch: Pitch } | undefined
  /** Grace notes met, waiting for the note they belong to. */
  let pendingGraces: number[][] = []

  run.playBar = (played, barStart) => {
    const m = run.view.measures[played.barIndex]!
    /** The alteration of each step and octave as last written in this bar. */
    const barAlters = new Map<string, number>()
    /** The event of a two-note tremolo's first note, waiting for the second. */
    let tremoloOpen: PlaybackEvent | undefined
    /** How far into the bar the written notes have come. */
    let inBar: Frac = ZERO
    /** Where the note being placed begins (a chord member shares the place of the first note). */
    let noteAt: Frac = barStart
    /** Moves on by a note of written length `len`; a note under a fermata is an interval of the shared map. */
    const advance = (len: Frac, held: boolean): Frac => {
      if (held) fermatas.push({ from: add(barStart, inBar), to: add(add(barStart, inBar), len) })
      inBar = add(inBar, len)
      return len
    }
    const placedIn = (id: string, event: PlaybackEvent): void => {
      run.placed.push({ id, pos: noteAt, event })
    }

    for (const [at, item] of m.items.entries()) {
      if (item.kind === 'dynamic') {
        if (dynamicGain(item.mark) !== undefined) run.dynamics.push({ at: add(barStart, inBar), mark: item.mark })
        continue
      }
      if (isWedge(item)) {
        run.wedges.push({ item, at: add(barStart, inBar) })
        continue
      }
      if (isNote(item) && item.grace) {
        // A grace note has no event and no cursor of its own: its sound is built on the note that follows.
        if (item.pitch) {
          const midi = concertMidi(midiOf(item.pitch), instrument)
          if (item.chord && pendingGraces.length > 0) pendingGraces[pendingGraces.length - 1]!.push(midi)
          else pendingGraces.push([midi])
          barAlters.set(`${item.pitch.step}${item.pitch.octave}`, Math.round(item.pitch.alter ?? 0))
        }
        continue
      }
      if (!isNote(item)) continue
      const len = toBeats(item.duration)
      // A fermata on any note of a chord holds the whole chord.
      let fermata = !!item.fermata
      if (!item.chord) {
        for (let j = at + 1; j < m.items.length; j++) {
          const next = m.items[j]!
          if (!isNote(next) || next.grace || !next.chord) break
          if (next.fermata) fermata = true
        }
        noteAt = add(barStart, inBar)
      }

      if (item.chord && events.length > 0 && item.pitch) {
        const last = events[events.length - 1]!
        last.pitches.push(concertMidi(midiOf(item.pitch), instrument))
        last.written.push(midiOf(item.pitch))
        last.noteIds.push(item.id)
        last.accent ||= !!item.accent || !!item.strongAccent
        last.strongAccent ||= !!item.strongAccent
        // The other marks of any chord note are the chord's, as those of its first note are (one event, one length).
        const f = flags.get(last)!
        f.staccato ||= !!item.staccato
        f.staccatissimo ||= !!item.staccatissimo
        f.tenuto ||= !!item.tenuto
        f.breath ||= !!item.breath
        f.caesura ||= !!item.caesura
        const info = marks.get(last)
        if (info && item.ornament && !info.ornamented) {
          info.ornamented = { note: item, index: last.pitches.length - 1 }
          info.barAlters = new Map(barAlters)
        }
        // A two-note tremolo is paired on the first notes only; a single tremolo on any note repeats the chord.
        if (info && item.tremolo?.kind === 'single' && !info.tremolo) info.tremolo = item.tremolo
        barAlters.set(`${item.pitch.step}${item.pitch.octave}`, Math.round(item.pitch.alter ?? 0))
        placedIn(item.id, last)
        continue
      }

      const pitched = !item.rest && !!item.pitch
      // A tie continues the previous event when that was the tie's start in the played order.
      if (pitched && item.tieStop && tieOpen && samePitch(tieOpen.pitch, item.pitch)) {
        const ev = tieOpen.event
        ev.length = add(ev.length, advance(len, fermata))
        ev.noteIds.push(item.id)
        pendingGraces = []
        const f = flags.get(ev)!
        f.staccato ||= !!item.staccato
        f.staccatissimo ||= !!item.staccatissimo
        f.tenuto ||= !!item.tenuto
        f.breath = !!item.breath
        f.caesura = !!item.caesura
        lastId.set(ev, item.id)
        tieOpen = item.tieStart ? { event: ev, pitch: item.pitch! } : undefined
        placedIn(item.id, ev)
        continue
      }

      // The second note of a two-note tremolo joins the event of the first, like a tied note: one event for the pair.
      if (pitched && tremoloOpen && item.tremolo?.kind === 'stop') {
        const ev = tremoloOpen
        tremoloOpen = undefined
        const info = marks.get(ev)!
        info.pairSplit = ev.pitches.length
        ev.length = add(ev.length, advance(len, fermata))
        ev.pitches.push(concertMidi(midiOf(item.pitch!), instrument))
        ev.written.push(midiOf(item.pitch!))
        ev.noteIds.push(item.id)
        pendingGraces = []
        const f = flags.get(ev)!
        f.staccato ||= !!item.staccato
        f.staccatissimo ||= !!item.staccatissimo
        f.tenuto ||= !!item.tenuto
        f.breath = !!item.breath
        f.caesura = !!item.caesura
        lastId.set(ev, item.id)
        tieOpen = item.tieStart ? { event: ev, pitch: item.pitch! } : undefined
        barAlters.set(`${item.pitch!.step}${item.pitch!.octave}`, Math.round(item.pitch!.alter ?? 0))
        placedIn(item.id, ev)
        continue
      }

      const writtenMidi = pitched ? midiOf(item.pitch!) : undefined
      const start = add(barStart, inBar)
      const ev: PlaybackEvent = {
        index: events.length,
        start,
        length: advance(len, fermata),
        sounding: ZERO,
        rest: !pitched,
        pitches: writtenMidi === undefined ? [] : [concertMidi(writtenMidi, instrument)],
        written: writtenMidi === undefined ? [] : [writtenMidi],
        noteIds: [item.id],
        barIndex: played.barIndex,
        bar: m.number,
        pass: played.pass,
        staccato: !!item.staccato,
        gain: DYNAMIC_GAIN[DEFAULT_DYNAMIC]!,
        dynamic: DEFAULT_DYNAMIC,
        accent: (!!item.accent || !!item.strongAccent) && pitched,
        ...(item.strongAccent && pitched ? { strongAccent: true } : {}),
        attackGain: DYNAMIC_GAIN[DEFAULT_DYNAMIC]!,
        attack: true,
        legatoNext: false,
        voice: run.ref,
        sound: run.sound,
        own: run.own,
      }
      flags.set(ev, { staccato: !!item.staccato, staccatissimo: !!item.staccatissimo, tenuto: !!item.tenuto, breath: !!item.breath, caesura: !!item.caesura })
      lastId.set(ev, item.id)
      events.push(ev)
      if (pitched) {
        marks.set(ev, {
          head: item,
          fifths: keys[played.barIndex]!,
          barAlters: item.ornament ? new Map(barAlters) : new Map(),
          graces: pendingGraces,
          ...(item.ornament ? { ornamented: { note: item, index: 0 } } : {}),
          ...(item.tremolo ? { tremolo: item.tremolo } : {}),
        })
        if (item.tremolo?.kind === 'start') tremoloOpen = ev
        barAlters.set(`${item.pitch!.step}${item.pitch!.octave}`, Math.round(item.pitch!.alter ?? 0))
      }
      pendingGraces = []
      tieOpen = pitched && item.tieStart ? { event: ev, pitch: item.pitch! } : undefined
      placedIn(item.id, ev)
    }
    return inBar
  }
}

/**
 * The hairpins of a staff as events of each of its voices (design D6.3). A hairpin is tied to notes by id, and its
 * start and stop notes may lie in different voices of the staff; it runs in time from the event of its start note
 * to the event of its stop note, and covers the events of every voice of the staff that start within that time.
 * Written times are compared, so this is done before the events are placed on the played axis.
 */
function staffMarks(runs: VoiceRun[]): { changes: DynamicChange[]; hairpins: Hairpin[] }[] {
  const spans: { type: WedgeItem['type']; from: Frac; to: Frac }[] = []
  for (const run of runs) {
    for (const { item, at } of run.wedges) {
      const start = run.placed.find((p) => p.id === item.start && cmp(p.pos, at) >= 0)
      if (!start) continue
      let stop: PlaybackEvent | undefined
      for (const other of runs) {
        const p = other.placed.find((q) => q.id === item.stop && cmp(q.pos, start.pos) >= 0)
        if (p && (!stop || cmp(p.event.start, stop.start) < 0)) stop = p.event
      }
      if (stop) spans.push({ type: item.type, from: start.event.start, to: stop.start })
    }
  }
  const dynamics = runs.flatMap((r) => r.dynamics).sort((a, b) => cmp(a.at, b.at))
  return runs.map((run) => {
    const evs = run.events
    const changes: DynamicChange[] = dynamics.map((d) => {
      const at = evs.findIndex((e) => cmp(e.start, d.at) >= 0)
      return { index: at < 0 ? evs.length : at, mark: d.mark }
    })
    const hairpins: Hairpin[] = []
    for (const s of spans) {
      const first = evs.findIndex((e) => cmp(e.start, s.from) >= 0)
      let last = -1
      for (let k = evs.length - 1; k >= 0; k--) {
        if (cmp(evs[k]!.start, s.to) <= 0) {
          last = k
          break
        }
      }
      if (first >= 0 && last >= first) hairpins.push({ type: s.type, first, last })
    }
    return { changes, hairpins }
  })
}

/**
 * Expands the score into playback events (design D6). Each voice is built by the one-line builder, the bars
 * (repeats and endings) are worked out once, a fermata anywhere holds every voice, and the events of all the
 * voices are merged in time order.
 *
 * `input` is a whole score, or one voice view (one line, which is your line). `instrument` is the piece's
 * instrument: every part but a two-staff (piano) part sounds as it, and decides the sounding pitch (`pitches`);
 * `written` keeps the printed pitch, and the score itself is left as it is. `options` says which line is yours
 * (`own`) and which parts do not sound; absent, the first part with both hands is yours and all else sounds.
 */
export function buildTimeline(input: Score | VoiceScore, instrument: TimelineInstrument, options: TimelineOptions = {}): Timeline {
  const runs: VoiceRun[] = []
  const makeRun = (view: VoiceScore, ref: VoiceRef, partIndex: number, voiceInstrument: TimelineInstrument, own: boolean, silent: boolean): void => {
    const { joins, successor } = slurJoins(view.measures)
    runs.push({
      ref,
      partIndex,
      view,
      instrument: voiceInstrument,
      sound: voiceInstrument.id ?? 'tenor-sax',
      own,
      silent,
      events: [],
      dynamics: [],
      wedges: [],
      placed: [],
      playBar: () => ZERO,
      next: new Map(),
      flags: new Map(),
      marks: new Map(),
      lastId: new Map(),
      joins,
      successor,
    })
  }
  if ('bars' in input) {
    const score = input
    const yours = options.part?.id ?? score.parts[0]?.id
    const silent = options.silent ?? []
    score.parts.forEach((part, pi) => {
      for (const ref of voices(score).filter((r) => r.part === part.id)) {
        const own = part.id === yours && (part.staves < 2 || options.part?.hand === undefined || ref.staff === (options.part.hand === 'right' ? 0 : 1))
        const hand = ref.staff === 0 ? 'right' : 'left'
        const off = !own && (silent.includes(part.id) || silent.includes(`${part.id}:${hand}`))
        makeRun(voiceView(score, ref), ref, pi, instrumentOfPart(part, instrument), own, off)
      }
    })
  } else {
    makeRun(input, input.of?.ref ?? { part: 'P1', staff: 0, voice: 0 }, 0, instrument, true, false)
  }
  const base = runs[0]!.view.measures
  const meters = meterTable(base)
  const keyTables = new Map<number, number[]>()
  const fermatas: Interval[] = []
  for (const run of runs) {
    let keys = keyTables.get(run.partIndex)
    if (!keys) keyTables.set(run.partIndex, (keys = keyTable(run.view.measures)))
    startVoice(run, keys, fermatas)
  }

  // First pass, in written time: every bar once per time it is played, every voice from the bar's start.
  const playedBars: { played: PlayedBar; start: Frac; length: Frac }[] = []
  let written: Frac = ZERO
  for (const played of expandMeasureOrder(base)) {
    let length = ZERO
    for (const run of runs) {
      const took = run.playBar(played, written)
      if (cmp(took, length) > 0) length = took
    }
    playedBars.push({ played, start: written, length })
    written = add(written, length)
  }

  // The hairpins and dynamics of each staff, as indices of each voice's events (still in written time).
  const staves = new Map<string, VoiceRun[]>()
  for (const run of runs) {
    const key = `${run.partIndex}/${run.ref.staff}`
    staves.set(key, [...(staves.get(key) ?? []), run])
  }
  const marksOf = new Map<VoiceRun, { changes: DynamicChange[]; hairpins: Hairpin[] }>()
  for (const group of staves.values()) staffMarks(group).forEach((m, k) => marksOf.set(group[k]!, m))

  // One map from written to played time for every voice.
  const played = fermataMap(fermatas)
  for (const run of runs) {
    for (const ev of run.events) {
      const from = ev.start
      const to = add(from, ev.length)
      ev.start = played(from)
      ev.length = sub(played(to), ev.start)
    }
  }

  const bars: BarSpan[] = []
  const clicks: BeatClick[] = []
  for (const bar of playedBars) {
    const span: BarSpan = {
      barIndex: bar.played.barIndex,
      bar: base[bar.played.barIndex]!.number,
      pass: bar.played.pass,
      start: played(bar.start),
      end: played(add(bar.start, bar.length)),
      firstEvent: 0,
      meter: meters[bar.played.barIndex]!,
    }
    bars.push(span)
    barClicks(span, bar.start, bar.length, played, fermatas, clicks)
  }

  // Each voice on its own: dynamics, articulation, grace notes, ornaments and slurs.
  for (const run of runs) {
    const { changes, hairpins } = marksOf.get(run)!
    finishVoice(run, changes, hairpins)
  }

  const merged = runs
    .filter((r) => !r.silent)
    .flatMap((r) => r.events.map((ev, k) => ({ ev, k, run: r })))
    .sort((a, b) => cmp(a.ev.start, b.ev.start) || a.run.partIndex - b.run.partIndex || a.run.ref.staff - b.run.ref.staff || a.run.ref.voice - b.run.ref.voice || a.k - b.k)
  const events = merged.map((m) => m.ev)
  events.forEach((ev, i) => {
    ev.index = i
  })
  for (const run of runs) {
    for (const [ev, after] of run.next) if (!run.silent) ev.nextInVoice = after.index
  }
  // The first event of each bar: the first that starts in it, or events.length when none does.
  let at = 0
  for (const span of bars) {
    while (at < events.length && cmp(events[at]!.start, span.start) < 0) at++
    span.firstEvent = at
  }

  const byNote = new Map<string, PlaybackEvent>()
  for (const ev of events) for (const id of ev.noteIds) if (!byNote.has(id)) byNote.set(id, ev)

  // What sounds at a time. Events overlap (a held note in one voice under moving notes in another), so a search
  // by start finds the last event that began and then looks back for the ones still going.
  const starts = events.map((e) => num(e.start))
  const ends = events.map((e) => num(e.start) + num(e.length))
  const reach: number[] = []
  ends.forEach((e, i) => reach.push(Math.max(e, reach[i - 1] ?? Number.NEGATIVE_INFINITY)))
  const lastStarted = (t: number): number => {
    let lo = 0
    let hi = events.length - 1
    let last = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (starts[mid]! <= t) {
        last = mid
        lo = mid + 1
      } else hi = mid - 1
    }
    return last
  }
  /** The events sounding at a time, the one that began last first (the first of the merged order among those beginning together). */
  const soundingAt = (beat: Frac | number): PlaybackEvent[] => {
    const t = typeof beat === 'number' ? beat : beat.n / beat.d
    const out: PlaybackEvent[] = []
    for (let j = lastStarted(t); j >= 0 && reach[j]! > t; j--) if (ends[j]! > t) out.push(events[j]!)
    return out.sort((a, b) => cmp(b.start, a.start) || a.index - b.index)
  }
  const eventAtBeat = (beat: Frac | number): PlaybackEvent | undefined => {
    const sounding = soundingAt(beat)
    const found = sounding.find((e) => e.own) ?? sounding[0]
    if (found) return found
    return events[lastStarted(typeof beat === 'number' ? beat : beat.n / beat.d) + 1]
  }
  const ownAt = (beat: Frac | number): PlaybackEvent[] => soundingAt(beat).filter((e) => e.own)
  const barAt = (beat: Frac | number): BarSpan | undefined => {
    const t = typeof beat === 'number' ? beat : beat.n / beat.d
    let found: BarSpan | undefined
    for (const b of bars) {
      if (num(b.start) <= t) found = b
      else break
    }
    return found
  }

  const end = bars.length > 0 ? bars[bars.length - 1]!.end : ZERO
  return { events, bars, end, clicks, eventOfNote: (id) => byNote.get(id), eventAtBeat, ownAt, barAt }
}

/**
 * The metronome clicks of one played bar. They lie on the written beats of the bar and are carried onto the
 * timeline through the fermata map, so a fermata does not throw them off: the clicks inside a held note stop (a
 * beat strictly inside a fermata of any voice), and the beat after it comes with the next note. A first bar
 * shorter than a full bar is a pickup: its beats are counted back from its end, so beat 1 falls on the bar line
 * that follows.
 */
function barClicks(span: BarSpan, barStart: Frac, length: Frac, played: (w: Frac) => Frac, fermatas: Interval[], out: BeatClick[]): void {
  const { beatUnit, barLength } = span.meter
  const pickup = span.barIndex === 0 && cmp(length, ZERO) > 0 && cmp(length, barLength) < 0
  const origin = pickup ? sub(length, barLength) : ZERO
  for (let j = 0; j < 1000; j++) {
    const m = add(origin, mul(beatUnit, frac(j)))
    if (cmp(m, length) >= 0) break
    if (cmp(m, ZERO) < 0) continue
    const at = add(barStart, m)
    if (fermatas.some((f) => cmp(f.from, at) < 0 && cmp(at, f.to) < 0)) continue
    out.push({ start: played(at), accent: j === 0, barIndex: span.barIndex })
  }
}

/** What follows once the voice's events are placed in played time: the rest of what the one-line builder did. */
function finishVoice(run: VoiceRun, changes: DynamicChange[], hairpins: Hairpin[]): void {
  const { events, flags, marks, lastId, instrument } = run
  applyDynamics(events, changes, hairpins)

  // Final lengths are known: articulation timing and slur connections.
  for (const ev of events) {
    const f = flags.get(ev)!
    const staccato = f.staccato && !f.tenuto
    const gap = f.caesura ? (f.breath && cmp(BREATH_GAP, CAESURA_GAP) > 0 ? BREATH_GAP : CAESURA_GAP) : f.breath ? BREATH_GAP : undefined
    ev.sounding = ev.rest ? ZERO : soundingLength(ev.length, staccato, f.staccatissimo, gap)
    ev.staccato = staccato || f.staccatissimo
  }
  // Grace notes take their time from the sound of the event before them in the voice, which stays on the beat grid.
  const graceLength = new Map<PlaybackEvent, Frac>()
  for (const ev of events) {
    const graces = marks.get(ev)?.graces ?? []
    if (ev.rest || graces.length === 0) continue
    const before = events[ev.index - 1]
    let each = GRACE_NOTE
    if (before) {
      const room = div(mul(before.length, frac(1, 2)), frac(graces.length))
      if (cmp(room, each) < 0) each = room
      const latest = sub(before.length, mul(each, frac(graces.length)))
      if (cmp(latest, before.sounding) < 0) before.sounding = latest
    }
    graceLength.set(ev, each)
  }
  for (const ev of events) {
    const sounds = soundsOf(ev, marks.get(ev), graceLength.get(ev), instrument)
    if (sounds) ev.sounds = sounds
  }
  for (let k = 0; k + 1 < events.length; k++) {
    const a = events[k]!
    const b = events[k + 1]!
    run.next.set(a, b)
    const lastIdOfA = lastId.get(a)!
    if (a.rest || b.rest || !run.joins.has(lastIdOfA) || run.successor.get(lastIdOfA) !== b.noteIds[0]) continue
    if (flags.get(a)!.staccato || flags.get(a)!.staccatissimo || flags.get(a)!.breath || flags.get(a)!.caesura) continue
    // An event that carries its own sounds (ornament, grace notes...) is played as separate notes: no slur into or out of it.
    if (a.sounds || b.sounds) continue
    a.legatoNext = true
    b.attack = false
  }
}

// --- loops ---

/**
 * The loop over bars `range` (indices into score.measures, both included) as beats of `timeline`, or
 * undefined when the range is not in the score. After each pass comes `restBars` bars of silence, as
 * long as the loop's last bar (its time signature's full bar): the next pass starts that much later,
 * and the metronome, when it is on, clicks through the silence on the same beat grid.
 */
export function loopSpanOf(timeline: Timeline, range: { start: number; end: number }, restBars: number = 0): LoopSpan | undefined {
  const from = timeline.bars.find((b) => b.barIndex === range.start)
  if (!from) return undefined
  const to = timeline.bars.find((b) => b.barIndex === range.end && cmp(b.start, from.start) >= 0)
  if (!to) return undefined
  const span: LoopSpan = { start: from.start, end: to.end }
  const bars = Math.max(0, Math.min(2, Math.round(restBars)))
  if (bars === 0) return span
  const { beatUnit, barLength } = to.meter
  const restClicks: NonNullable<LoopSpan['restClicks']> = []
  for (let r = 0; r < bars; r++) {
    const barStart = mul(barLength, frac(r))
    for (let j = 0; j < 1000; j++) {
      const into = mul(beatUnit, frac(j))
      if (cmp(into, barLength) >= 0) break
      restClicks.push({ offset: add(barStart, into), accent: j === 0 })
    }
  }
  span.rest = mul(barLength, frac(bars))
  span.restClicks = restClicks
  return span
}
