import type { NoteType, Score, TempoItem, TimeSignature } from '../score/model.ts'
import type { Frac } from '../score/rational.ts'
import { add, frac, mul } from '../score/rational.ts'

/*
 * Tempo units and defaults (task 12.3, design D8).
 *
 * The user sets the tempo in the beat the player naturally counts: a quarter note in x/4, a half
 * note in x/2, a dotted quarter in compound x/8 (6/8, 9/8, 12/8) and an eighth in other x/8. A
 * metronome mark's own beat unit wins when the score has one. The timeline counts quarter-note
 * beats, so the unit is carried as a number of quarters (a fraction) and converted at the edges.
 */

/** Beat units are fractions of a quarter note (1 = quarter, 3/2 = dotted quarter). */
export type Quarters = Frac

export const TEMPO_MIN = 30
export const TEMPO_MAX = 200
export const DEFAULT_TEMPO = 80

export const clampTempo = (bpm: number): number => Math.min(TEMPO_MAX, Math.max(TEMPO_MIN, Math.round(bpm)))

/** Typical tempo for each tempo word, in beats per minute of the beat unit (longest phrases first when matching). */
export const TEMPO_WORDS: Readonly<Record<string, number>> = {
  grave: 40,
  largo: 50,
  lento: 56,
  larghetto: 63,
  adagio: 70,
  adagietto: 74,
  andante: 88,
  'andante moderato': 96,
  andantino: 96,
  moderato: 108,
  'allegro moderato': 116,
  allegretto: 116,
  allegro: 132,
  'allegro vivace': 144,
  vivace: 160,
  presto: 180,
  prestissimo: 200,
}

const WORD_KEYS = Object.keys(TEMPO_WORDS).sort((a, b) => b.length - a.length)

/** The typical bpm for the first tempo word found in `text` ("Allegro con brio", "Moderato (swing)"), or undefined. */
export function tempoFromWords(text: string | undefined): number | undefined {
  if (!text) return undefined
  const lower = text.toLowerCase()
  for (const key of WORD_KEYS) {
    if (new RegExp(`(^|[^a-z])${key}([^a-z]|$)`).test(lower)) return TEMPO_WORDS[key]
  }
  return undefined
}

const NOTE_QUARTERS: Partial<Record<NoteType, Frac>> = {
  long: frac(16),
  breve: frac(8),
  whole: frac(4),
  half: frac(2),
  quarter: frac(1),
  eighth: frac(1, 2),
  '16th': frac(1, 4),
  '32nd': frac(1, 8),
  '64th': frac(1, 16),
}

/** Quarter notes in a note value with dots ("dotted quarter" = 3/2). */
export function quartersOf(type: NoteType, dots = 0): Quarters | undefined {
  const base = NOTE_QUARTERS[type]
  if (!base) return undefined
  let total = base
  let part = base
  for (let k = 0; k < dots; k++) {
    part = mul(part, frac(1, 2))
    total = add(total, part)
  }
  return total
}

/** The beat unit of a time signature, in quarters. */
export function meterBeatUnit(time: TimeSignature | undefined): Quarters {
  if (!time) return frac(1)
  const compound = time.beatType === 8 && time.beats > 3 && time.beats % 3 === 0
  if (compound) return frac(3, 2)
  return frac(4, time.beatType)
}

/** Length of one bar in quarters. */
export function barQuarters(time: TimeSignature | undefined): Quarters {
  return time ? frac(4 * time.beats, time.beatType) : frac(4)
}

/** The time signature in force at a bar (the last one stated at or before it), 4/4 when none is. */
export function timeSignatureAt(score: Score, barIndex: number): TimeSignature | undefined {
  let found: TimeSignature | undefined
  for (let i = 0; i <= barIndex && i < score.measures.length; i++) {
    const t = score.measures[i]!.time
    if (t) found = t
  }
  return found
}

const QUARTER_NAMES: [number, string][] = [
  [4, 'whole'],
  [3, 'dotted half'],
  [2, 'half'],
  [1.5, 'dotted quarter'],
  [1, 'quarter'],
  [0.75, 'dotted eighth'],
  [0.5, 'eighth'],
  [0.25, '16th'],
]

/** "quarter", "dotted quarter", ... for display. */
export function unitName(quarters: Quarters): string {
  const q = quarters.n / quarters.d
  return QUARTER_NAMES.find(([v]) => v === q)?.[1] ?? `${q} quarters`
}

export interface TempoSetup {
  /** The beat unit tempo is counted in. */
  unit: Quarters
  unitName: string
  /** Where the default came from. */
  source: 'metronome' | 'words' | 'default'
  /** The tempo an exercise starts at, 30-200 in `unit`. */
  defaultBpm: number
}

function firstTempoItem(score: Score, accept: (t: TempoItem) => boolean): TempoItem | undefined {
  for (const m of score.measures) {
    for (const item of m.items) if (item.kind === 'tempo' && accept(item)) return item
  }
  return undefined
}

/**
 * The tempo unit and the default tempo of a score: a metronome mark (in its own beat unit), else a
 * tempo word through the table (in the metre's unit), else 80 in the metre's unit.
 */
export function tempoSetup(score: Score): TempoSetup {
  const meter = meterBeatUnit(timeSignatureAt(score, 0))
  const mark = firstTempoItem(score, (t) => t.perMinute !== undefined && t.perMinute > 0)
  if (mark) {
    const unit = (mark.beatUnit && quartersOf(mark.beatUnit, mark.beatUnitDots ?? 0)) || meter
    return { unit, unitName: unitName(unit), source: 'metronome', defaultBpm: clampTempo(mark.perMinute!) }
  }
  const sound = firstTempoItem(score, (t) => t.soundTempo !== undefined && t.soundTempo > 0)
  if (sound) {
    // <sound tempo> counts quarter notes per minute.
    const bpm = (sound.soundTempo! * 1) / (meter.n / meter.d)
    return { unit: meter, unitName: unitName(meter), source: 'metronome', defaultBpm: clampTempo(bpm) }
  }
  const word = firstTempoItem(score, (t) => tempoFromWords(t.words) !== undefined)
  if (word) return { unit: meter, unitName: unitName(meter), source: 'words', defaultBpm: clampTempo(tempoFromWords(word.words)!) }
  return { unit: meter, unitName: unitName(meter), source: 'default', defaultBpm: DEFAULT_TEMPO }
}

/** How many clicks make one bar of count-in at `bar`, counted in `unit` (3/4 in quarters: 3; 6/8 in dotted quarters: 2). */
export function countInClicks(score: Score, barIndex: number, unit: Quarters): number {
  const bar = barQuarters(timeSignatureAt(score, barIndex))
  return Math.max(1, Math.round((bar.n / bar.d) / (unit.n / unit.d)))
}

/** The tempo an exercise opens at: the one the user last chose, else the score's default. */
export function startingTempo(lastTempo: number | null | undefined, setup: TempoSetup): number {
  return typeof lastTempo === 'number' && Number.isFinite(lastTempo) ? clampTempo(lastTempo) : setup.defaultBpm
}
