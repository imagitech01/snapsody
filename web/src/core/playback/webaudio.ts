import type { ClickHandle, ClickSpec, NoteOnSpec, NoteOutput, VoiceHandle } from './scheduler.ts'
import type { SampleMap } from './samples.ts'
import { PITCH_REFERENCE_DEFAULT, clampPitchReference, parseSampleMap, pickSample, soundFolder } from './samples.ts'
import { PLAYBACK_TUNING } from './scheduler.ts'

/*
 * The Web Audio side of playback (task 10.3): decodes a sample set and plays
 * notes from it. Typed against small structural interfaces so tests can run it
 * on a fake context; a real AudioContext satisfies them.
 */

export interface ParamLike {
  value: number
  setValueAtTime(value: number, time: number): unknown
  linearRampToValueAtTime(value: number, time: number): unknown
  cancelScheduledValues(time: number): unknown
}
export interface NodeLike {
  connect(destination: unknown): unknown
  disconnect(): void
}
export interface GainLike extends NodeLike {
  gain: ParamLike
}
export interface SourceLike extends NodeLike {
  buffer: unknown
  loop: boolean
  loopStart: number
  loopEnd: number
  playbackRate: { value: number }
  start(when?: number, offset?: number): void
  stop(when?: number): void
  onended: (() => void) | null
}
export interface OscillatorLike extends NodeLike {
  type: string
  frequency: ParamLike
  start(when?: number): void
  stop(when?: number): void
  onended: (() => void) | null
}
export interface AudioContextLike {
  readonly currentTime: number
  readonly destination: unknown
  /** Seconds between rendering and sound leaving the device; 0 or undefined where not reported. */
  readonly outputLatency?: number
  readonly baseLatency?: number
  createGain(): GainLike
  createBufferSource(): SourceLike
  /** Present on a real AudioContext; the count-in click is made with it (no sound file needed). */
  createOscillator?(): OscillatorLike
}

/** The count-in and metronome click: a short sine blip, higher and louder on the first beat of the bar. */
export const CLICK = { accentHz: 1760, beatHz: 1175, accentGain: 0.5, beatGain: 0.35, length: 0.05 } as const

/** Decoded samples by concert MIDI note. */
export interface SampleBank {
  map: SampleMap
  buffers: Map<number, unknown>
}

export async function loadSampleBank(
  ctx: { decodeAudioData(data: ArrayBuffer): Promise<unknown> },
  baseUrl: string,
  fetchFn: (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; arrayBuffer(): Promise<ArrayBuffer> }>,
): Promise<SampleBank> {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  const mapResponse = await fetchFn(`${base}map.json`)
  if (!mapResponse.ok) throw new Error(`sample map not found (${mapResponse.status})`)
  const map = parseSampleMap(await mapResponse.json())
  const buffers = new Map<number, unknown>()
  await Promise.all(
    map.notes.map(async (entry) => {
      const response = await fetchFn(`${base}${entry.file}`)
      if (!response.ok) throw new Error(`sample ${entry.file} not found (${response.status})`)
      const data = await response.arrayBuffer()
      try {
        buffers.set(entry.midi, await ctx.decodeAudioData(data))
      } catch (e) {
        // decodeAudioData's own error does not say which file it was (or that the format may be the problem).
        throw new Error(`sample ${entry.file} could not be decoded (${e instanceof Error ? e.message : String(e)})`)
      }
    }),
  )
  return { map, buffers }
}

/**
 * The sample sets of the instruments, loaded when first wanted and then kept, so going back to an
 * instrument is instant. `urlOf` turns an instrument's sound (`Instrument.sound`) into the folder's
 * URL; by default it is the bundled `samples/<sound>/`.
 */
export class SoundLibrary {
  private readonly ctx: { decodeAudioData(data: ArrayBuffer): Promise<unknown> }
  private readonly fetchFn: Parameters<typeof loadSampleBank>[2]
  private readonly urlOf: (sound: string) => string
  private readonly banks = new Map<string, Promise<SampleBank>>()

  constructor(ctx: SoundLibrary['ctx'], fetchFn: SoundLibrary['fetchFn'], urlOf: (sound: string) => string = soundFolder) {
    this.ctx = ctx
    this.fetchFn = fetchFn
    this.urlOf = urlOf
  }

  /** The sample set of a sound; a load that failed is not kept, so asking again tries again. */
  load(sound: string): Promise<SampleBank> {
    let bank = this.banks.get(sound)
    if (!bank) {
      bank = loadSampleBank(this.ctx, this.urlOf(sound), this.fetchFn)
      this.banks.set(sound, bank)
      bank.catch(() => this.banks.delete(sound))
    }
    return bank
  }
}

interface Voice {
  source: SourceLike
  gain: GainLike
  /** The steady gain of the note. */
  level: number
  /** The gain at the end of the fade-in: `level`, or above it for an accent. */
  peak: number
  /** When the note starts and how long its fade-in takes (the gain is 0 at `start`, `peak` from `start + fadeIn`). */
  start: number
  fadeIn: number
  /** Seconds after `start` at which the gain has come down to `level`: `fadeIn`, or the accent's decay. */
  settle: number
}

/** No fade-out is shorter than this: a gain that drops to 0 in no time is a click (a late or zero-length release). */
export const MIN_RELEASE_FADE = 0.003

/** The gain a voice has at `when` on its envelope: the fade-in, then (for an accent) the fall back to `level`. */
function gainAt(v: Voice, when: number): number {
  if (when <= v.start) return 0
  if (when < v.start + v.fadeIn) return (v.peak * (when - v.start)) / v.fadeIn
  if (when < v.start + v.settle) return v.peak + ((v.level - v.peak) * (when - v.start - v.fadeIn)) / (v.settle - v.fadeIn)
  return v.level
}

class SampleVoice implements VoiceHandle {
  private readonly voices: Voice[]
  private released = false

  constructor(voices: Voice[]) {
    this.voices = voices
  }

  release(when: number, fade: number): void {
    if (this.released) return
    this.released = true
    const length = Math.max(fade, MIN_RELEASE_FADE)
    for (const v of this.voices) {
      const param = v.gain.gain
      if (when <= v.start) {
        // Not started yet: it never sounds (the source is stopped before its start).
        param.cancelScheduledValues(0)
        param.setValueAtTime(0, 0)
      } else if (when < v.start + v.settle) {
        // Released while still fading in (or falling back from an accent). cancelScheduledValues(when)
        // would drop the end of the ramp and the gain would sit at the earlier value until `when`, then
        // jump. Rebuild the envelope up to `when` instead and fade out from the value it has reached there.
        param.cancelScheduledValues(v.start)
        param.setValueAtTime(0, v.start)
        if (when > v.start + v.fadeIn) param.linearRampToValueAtTime(v.peak, v.start + v.fadeIn)
        param.linearRampToValueAtTime(gainAt(v, when), when)
      } else {
        param.cancelScheduledValues(when)
        param.setValueAtTime(v.level, when)
      }
      param.linearRampToValueAtTime(0, when + length)
      v.source.stop(when + length + 0.02)
    }
  }

  cancel(): void {
    this.released = true
    for (const v of this.voices) {
      try {
        v.source.stop(0)
      } catch {
        // already stopped
      }
      v.gain.gain.cancelScheduledValues(0)
      v.gain.gain.value = 0
    }
  }
}

export class Sampler implements NoteOutput {
  private readonly ctx: AudioContextLike
  /** The set notes play from when they name no sound, or a sound that was not added. */
  private bank: SampleBank
  /** The sample sets by sound (`Instrument.sound`), for notes that name theirs (`NoteOnSpec.sound`): several instruments at once. */
  private readonly banks = new Map<string, SampleBank>()
  private readonly master: GainLike
  private reference = PITCH_REFERENCE_DEFAULT

  constructor(ctx: AudioContextLike, bank: SampleBank, masterGain = 0.8) {
    this.ctx = ctx
    this.bank = bank
    this.master = ctx.createGain()
    this.master.gain.value = masterGain
    this.master.connect(ctx.destination)
  }

  /** A4 in Hz (the samples are tuned to 440). Notes that start after a change follow it; every note's playback rate gets the factor `reference / 440`. */
  get pitchReference(): number {
    return this.reference
  }

  set pitchReference(hz: number) {
    this.reference = clampPitchReference(hz)
  }

  /**
   * Plays the next notes that name no sound from another sample set (another instrument); notes already sounding
   * keep their own buffers. With `sound` the set is also the one notes naming that sound play from.
   */
  useBank(bank: SampleBank, sound?: string): void {
    this.bank = bank
    if (sound !== undefined) this.banks.set(sound, bank)
  }

  /** Makes a sample set available to the notes that name its sound, without changing the default one. */
  addBank(sound: string, bank: SampleBank): void {
    this.banks.set(sound, bank)
  }

  /**
   * A click on its own gain node, so it can be taken back: cancelling one that has not started silences
   * that node and stops its oscillator before its start, and it never sounds. One that has started is
   * left alone (cutting a 50 ms blip short would only add a click of its own).
   */
  click(spec: ClickSpec): ClickHandle | void {
    const osc = this.ctx.createOscillator?.()
    if (!osc) return
    const level = spec.accent ? CLICK.accentGain : CLICK.beatGain
    const gain = this.ctx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(spec.accent ? CLICK.accentHz : CLICK.beatHz, spec.when)
    gain.gain.setValueAtTime(0, spec.when)
    gain.gain.linearRampToValueAtTime(level, spec.when + 0.002)
    gain.gain.linearRampToValueAtTime(0, spec.when + CLICK.length)
    osc.connect(gain)
    gain.connect(this.master)
    osc.start(spec.when)
    osc.stop(spec.when + CLICK.length + 0.02)
    osc.onended = () => {
      osc.disconnect()
      gain.disconnect()
    }
    return {
      cancel: () => {
        if (this.ctx.currentTime >= spec.when) return
        gain.gain.cancelScheduledValues(0)
        gain.gain.value = 0
        try {
          osc.stop(0)
        } catch {
          // already stopped
        }
      },
    }
  }

  noteOn(spec: NoteOnSpec): VoiceHandle {
    const voices: Voice[] = []
    const bank = (spec.sound === undefined ? undefined : this.banks.get(spec.sound)) ?? this.bank
    for (const midi of spec.midi) {
      const { entry, rate } = pickSample(bank.map, midi, this.reference)
      const buffer = bank.buffers.get(entry.midi)
      if (buffer === undefined) continue
      const source = this.ctx.createBufferSource()
      source.buffer = buffer
      const looped = entry.sustainStart !== undefined && entry.sustainEnd !== undefined
      if (looped) {
        source.loop = true
        // Looping a repitched sample keeps its loop points in the file's own time.
        source.loopStart = entry.sustainStart!
        source.loopEnd = entry.sustainEnd!
      }
      source.playbackRate.value = rate
      const level = spec.gain * entry.gain
      const gain = this.ctx.createGain()
      // A set of a decaying instrument (`attack: 'always'`, see samples.ts) strikes every note, a slurred one
      // too, and fades it in as quickly as a fresh attack: the 40 ms of a crossfade would bury the strike.
      const always = bank.map.attack === 'always'
      const fadeIn = Math.max(always && !spec.attack ? Math.min(spec.fade, PLAYBACK_TUNING.attackFade) : spec.fade, 0.001)
      // An accent comes in above its level and falls back to it.
      const peak = spec.accent ? Math.max(level, spec.accent.gain * entry.gain) : level
      const settle = peak > level ? Math.max(spec.accent!.decay, fadeIn) : fadeIn
      gain.gain.setValueAtTime(0, spec.when)
      gain.gain.linearRampToValueAtTime(peak, spec.when + fadeIn)
      if (peak > level) gain.gain.linearRampToValueAtTime(level, spec.when + settle)
      source.connect(gain)
      gain.connect(this.master)
      // Slurred: skip the attack and enter at the sustain section (not in a set that always strikes).
      source.start(spec.when, spec.attack || always || !looped ? 0 : entry.sustainStart)
      source.onended = () => {
        source.disconnect()
        gain.disconnect()
      }
      voices.push({ source, gain, level, peak, start: spec.when, fadeIn, settle })
    }
    // Crossfade: the previous slurred note fades out as this one fades in.
    spec.join?.release(spec.when, spec.fade)
    return new SampleVoice(voices)
  }
}

/** Seconds between the audio clock and what the listener hears. */
export const OUTPUT_LATENCY_FALLBACK = 0.04

export function outputLatency(ctx: { outputLatency?: number; baseLatency?: number }): number {
  const out = ctx.outputLatency
  if (typeof out === 'number' && out > 0) return out
  const base = ctx.baseLatency
  return (typeof base === 'number' && base > 0 ? base : 0) + OUTPUT_LATENCY_FALLBACK
}
