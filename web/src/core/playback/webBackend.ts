import type { AudioBackend } from './player.ts'
import { PITCH_REFERENCE_DEFAULT, soundFolder } from './samples.ts'
import { Sampler, SoundLibrary } from './webaudio.ts'
import type { AudioContextLike } from './webaudio.ts'

/** The sound that plays when no instrument says otherwise: the tenor saxophone, the app's default instrument. */
export const DEFAULT_SOUND = 'tenor-sax'

export interface WebAudioOptions {
  /** The sample folder to start with (`Instrument.sound`): `samples/<sound>/`, next to the page. Default: the tenor saxophone. */
  sound?: string
  /** A4 in Hz; default 440. */
  pitchReference?: number
}

/**
 * Creates the AudioContext, resumes it and loads the sample set of a sound. Call from a user gesture
 * (Play). The sets are served next to the page (the CSP allows 'self' only; the app works offline), one
 * folder per instrument: `samples/<instrument.sound>/`. `useSound` loads an instrument's set, once, the first
 * time it is wanted; every set loaded stays available to the notes that name their sound (parts with different
 * instruments play at once), and the last one asked for is what notes that name none play from.
 */
export async function createWebAudioBackend(options: WebAudioOptions = {}): Promise<AudioBackend> {
  const ctx = new AudioContext({ latencyHint: 'interactive' })
  try {
    await ctx.resume()
    const library = new SoundLibrary(ctx, (url) => fetch(url), (sound) => new URL(soundFolder(sound), document.baseURI).href)
    let current = options.sound ?? DEFAULT_SOUND
    const first = await library.load(current)
    const sampler = new Sampler(ctx as unknown as AudioContextLike, first)
    sampler.addBank(current, first)
    sampler.pitchReference = options.pitchReference ?? PITCH_REFERENCE_DEFAULT
    /** The sound asked for last: of two switches that overlap, the later one wins whichever loads first. */
    let wanted = current
    return {
      output: sampler,
      get currentTime() {
        return ctx.currentTime
      },
      get outputLatency() {
        return ctx.outputLatency
      },
      get baseLatency() {
        return ctx.baseLatency
      },
      async useSound(sound) {
        wanted = sound
        if (sound === current) return
        const bank = await library.load(sound)
        // Notes naming this sound (another part's instrument) play from it from now on, whatever is asked for next.
        sampler.addBank(sound, bank)
        if (wanted !== sound) return
        sampler.useBank(bank)
        current = sound
      },
      setPitchReference(hz) {
        sampler.pitchReference = hz
      },
      close: () => void ctx.close().catch(() => undefined),
    }
  } catch (e) {
    void ctx.close().catch(() => undefined)
    throw e
  }
}
