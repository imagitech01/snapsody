/*
 * Sample set format (design D9): one audio file per note plus a JSON map, so
 * a licensed set and an own recording plug in the same way.
 *
 *   map.json
 *   {
 *     "format": 1,
 *     "name": "…", "license": "…", "source": "…",
 *     "notes": {
 *       "44": { "file": "44.wav", "sustainStart": 0.15, "sustainEnd": 0.40 },
 *       …
 *     }
 *   }
 *
 * - The key is the CONCERT (sounding) MIDI note number, 44 = A-flat 2 … 76 = E5
 *   (written B-flat 3 … F-sharp 6 on a B-flat tenor).
 * - `sustainStart`/`sustainEnd` (seconds in the file) bound a loopable sustain
 *   section. A normal note plays the file from 0, runs through the attack and
 *   loops the sustain section for as long as the note lasts. A slurred note
 *   starts at `sustainStart`, skipping the attack.
 * - `"attack": "always"` (top level, optional) is for instruments whose sound
 *   decays (piano, guitar): every note starts at 0 with its attack, a slurred
 *   one too. Such a set may leave `sustainStart`/`sustainEnd` out of a note (both
 *   or neither); the note is then played once, without looping, and the file has
 *   to end in silence (a held note that outlasts the file just ends).
 * - `gain` (optional, default 1) evens out loudness between files.
 * - Files are in the same folder as map.json (no sub-folders) and are decoded
 *   by the browser (WAV, OGG, MP3 or whatever the WebView decodes).
 */

export const SAMPLE_FORMAT = 1

export interface SampleEntry {
  midi: number
  file: string
  /** The loop (seconds in the file); both are undefined for a note that plays once (only in a set with `attack: 'always'`). */
  sustainStart?: number
  sustainEnd?: number
  gain: number
}

/** `'normal'`: a slurred note enters at the sustain section. `'always'`: every note starts at 0 (a set of a decaying instrument). */
export type AttackMode = 'normal' | 'always'

export interface SampleMap {
  format: number
  attack: AttackMode
  name: string
  license: string
  source: string
  notes: SampleEntry[]
}

/** Validates a parsed map.json; throws an Error saying what is wrong. */
export function parseSampleMap(json: unknown): SampleMap {
  if (typeof json !== 'object' || json === null) throw new Error('sample map: not an object')
  const o = json as Record<string, unknown>
  if (o.format !== SAMPLE_FORMAT) throw new Error(`sample map: unsupported format ${String(o.format)}`)
  if (typeof o.notes !== 'object' || o.notes === null) throw new Error('sample map: no "notes"')
  if (o.attack !== undefined && o.attack !== 'always') throw new Error(`sample map: "attack" is "always" or left out, not ${JSON.stringify(o.attack)}`)
  const attack: AttackMode = o.attack === 'always' ? 'always' : 'normal'
  const notes: SampleEntry[] = []
  for (const [key, value] of Object.entries(o.notes as Record<string, unknown>)) {
    const midi = Number(key)
    if (!Number.isInteger(midi) || midi < 0 || midi > 127) throw new Error(`sample map: bad note key "${key}"`)
    const e = value as Record<string, unknown> | null
    if (typeof e !== 'object' || e === null) throw new Error(`sample map: note ${key} is not an object`)
    const { file, sustainStart, sustainEnd } = e
    if (typeof file !== 'string' || file === '' || /[\\/]|^\.\./.test(file)) throw new Error(`sample map: note ${key} has a bad file name`)
    const gain = e.gain === undefined ? 1 : e.gain
    if (typeof gain !== 'number' || !(gain > 0)) throw new Error(`sample map: note ${key} has a bad gain`)
    if (sustainStart === undefined && sustainEnd === undefined) {
      // A note that plays once: a slurred note of a normal set would have nowhere to enter.
      if (attack !== 'always') throw new Error(`sample map: note ${key} needs 0 <= sustainStart < sustainEnd (only a set with "attack": "always" has notes without a loop)`)
      notes.push({ midi, file, gain })
      continue
    }
    if (typeof sustainStart !== 'number' || typeof sustainEnd !== 'number' || !(sustainStart >= 0) || !(sustainEnd > sustainStart)) {
      throw new Error(`sample map: note ${key} needs 0 <= sustainStart < sustainEnd`)
    }
    notes.push({ midi, file, sustainStart, sustainEnd, gain })
  }
  if (notes.length === 0) throw new Error('sample map: no notes')
  notes.sort((a, b) => a.midi - b.midi)
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  return { format: SAMPLE_FORMAT, attack, name: str(o.name), license: str(o.license), source: str(o.source), notes }
}

/** The pitch the recorded samples are tuned to: A4 = 440 Hz. */
export const PITCH_REFERENCE_DEFAULT = 440
/** The range the user can tune A4 to, in steps of 1 Hz (spec `instruments`, "Pitch reference"). */
export const PITCH_REFERENCE_MIN = 430
export const PITCH_REFERENCE_MAX = 450

/** The pitch reference as the user can set it: a whole number of Hz from 430 to 450 (440 for anything that is not a number). */
export function clampPitchReference(hz: number): number {
  if (!Number.isFinite(hz)) return PITCH_REFERENCE_DEFAULT
  return Math.min(PITCH_REFERENCE_MAX, Math.max(PITCH_REFERENCE_MIN, Math.round(hz)))
}

/** The playback-rate factor that tunes samples recorded at A4 = 440 Hz to a pitch reference (442 Hz: 442/440). */
export function pitchFactor(pitchReference: number): number {
  return pitchReference / PITCH_REFERENCE_DEFAULT
}

/** The sample folder of an instrument's sound (`Instrument.sound`), relative to the page: `samples/<sound>/`. */
export function soundFolder(sound: string): string {
  return `samples/${sound}/`
}

export interface Pick {
  entry: SampleEntry
  /** Playback-rate factor to reach the wanted pitch from the entry's own pitch (1 when exact, at 440 Hz). */
  rate: number
}

/**
 * The entry closest to `midi` (ties go to the lower sample, which is repitched upwards), and the rate for the gap.
 * The rate includes `pitchFactor(pitchReference)`, so every note follows the pitch reference.
 */
export function pickSample(map: SampleMap, midi: number, pitchReference = PITCH_REFERENCE_DEFAULT): Pick {
  let best = map.notes[0]!
  for (const e of map.notes) {
    if (Math.abs(e.midi - midi) < Math.abs(best.midi - midi)) best = e
  }
  return { entry: best, rate: 2 ** ((midi - best.midi) / 12) * pitchFactor(pitchReference) }
}
