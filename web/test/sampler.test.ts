import assert from 'node:assert/strict'
import { test } from 'node:test'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PITCH_REFERENCE_DEFAULT, clampPitchReference, parseSampleMap, pickSample, pitchFactor, soundFolder } from '../src/core/playback/samples.ts'
import { MIN_RELEASE_FADE, OUTPUT_LATENCY_FALLBACK, Sampler, SoundLibrary, loadSampleBank, outputLatency } from '../src/core/playback/webaudio.ts'
import type { AudioContextLike, GainLike, ParamLike, SampleBank, SourceLike } from '../src/core/playback/webaudio.ts'

const SAMPLES_DIR = fileURLToPath(new URL('./fixtures/samples/placeholder', import.meta.url))

// --- the committed placeholder set ---

test('placeholder samples: every concert semitone A-flat2..E5 (44..76) is present and the map validates', () => {
  const map = parseSampleMap(JSON.parse(readFileSync(`${SAMPLES_DIR}/map.json`, 'utf8')))
  assert.deepEqual(
    map.notes.map((e) => e.midi),
    Array.from({ length: 33 }, (_, i) => 44 + i),
  )
  let total = 0
  for (const e of map.notes) {
    assert.ok(existsSync(`${SAMPLES_DIR}/${e.file}`), `${e.file} exists`)
    const bytes = readFileSync(`${SAMPLES_DIR}/${e.file}`)
    total += bytes.length
    assert.equal(bytes.toString('latin1', 0, 4), 'RIFF')
    const rate = bytes.readUInt32LE(24)
    const seconds = (bytes.length - 44) / 2 / rate
    assert.ok(e.sustainEnd! <= seconds + 1e-6, `${e.file}: sustain end inside the file`)
    assert.ok(e.sustainStart! >= 0.1, 'attack section is not empty')
  }
  total += statSync(`${SAMPLES_DIR}/map.json`).size
  assert.ok(total < 1_500_000, `placeholder set is ${total} bytes`)
  assert.equal(readdirSync(SAMPLES_DIR).length, 34)
})

test('sample map: validation errors name the problem', () => {
  assert.throws(() => parseSampleMap(null), /not an object/)
  assert.throws(() => parseSampleMap({ format: 2, notes: {} }), /unsupported format/)
  assert.throws(() => parseSampleMap({ format: 1, notes: {} }), /no notes/)
  assert.throws(() => parseSampleMap({ format: 1, notes: { x: {} } }), /bad note key/)
  assert.throws(() => parseSampleMap({ format: 1, notes: { 60: { file: '../a.wav', sustainStart: 0, sustainEnd: 1 } } }), /bad file name/)
  assert.throws(() => parseSampleMap({ format: 1, notes: { 60: { file: 'a.wav', sustainStart: 1, sustainEnd: 1 } } }), /sustainStart < sustainEnd/)
})

test('sample map: "attack": "always" is the one set that may have notes without a loop', () => {
  const once = { file: 'a.ogg', gain: 0.5 }
  const looped = { file: 'b.ogg', sustainStart: 0.2, sustainEnd: 0.6 }
  assert.equal(parseSampleMap({ format: 1, notes: { 60: looped } }).attack, 'normal', 'no flag: a slurred note enters the sustain')
  const map = parseSampleMap({ format: 1, attack: 'always', notes: { 60: once, 62: looped } })
  assert.equal(map.attack, 'always')
  assert.deepEqual(map.notes[0], { midi: 60, file: 'a.ogg', gain: 0.5 }, 'a note played once has no loop points')
  assert.equal(map.notes[1]!.sustainStart, 0.2)
  assert.throws(() => parseSampleMap({ format: 1, notes: { 60: once } }), /only a set with "attack": "always" has notes without a loop/)
  // a loop is both points or none
  assert.throws(() => parseSampleMap({ format: 1, attack: 'always', notes: { 60: { file: 'a.ogg', sustainStart: 0.2 } } }), /sustainStart < sustainEnd/)
  assert.throws(() => parseSampleMap({ format: 1, attack: 'sometimes', notes: { 60: looped } }), /"attack" is "always" or left out/)
})

test('sample map: the nearest sample is repitched by the gap', () => {
  const map = parseSampleMap({
    format: 1,
    notes: { 50: { file: 'a.wav', sustainStart: 0.1, sustainEnd: 0.3 }, 60: { file: 'b.wav', sustainStart: 0.1, sustainEnd: 0.3 } },
  })
  assert.deepEqual(pickSample(map, 50).rate, 1)
  assert.equal(pickSample(map, 52).entry.midi, 50)
  assert.ok(Math.abs(pickSample(map, 52).rate - 2 ** (2 / 12)) < 1e-12)
  assert.equal(pickSample(map, 58).entry.midi, 60)
  assert.ok(pickSample(map, 58).rate < 1)
})

// --- the sampler on a fake context ---

class FakeParam implements ParamLike {
  value = 0
  calls: [string, number, number?][] = []
  setValueAtTime(v: number, t: number): void {
    this.calls.push(['set', v, t])
  }
  linearRampToValueAtTime(v: number, t: number): void {
    this.calls.push(['ramp', v, t])
  }
  cancelScheduledValues(t: number): void {
    this.calls.push(['cancel', t])
  }
}
class FakeGain implements GainLike {
  gain = new FakeParam()
  connected: unknown
  connect(d: unknown): void {
    this.connected = d
  }
  disconnect(): void {}
}
class FakeSource implements SourceLike {
  buffer: unknown = null
  loop = false
  loopStart = 0
  loopEnd = 0
  playbackRate = { value: 1 }
  startedWith: [number | undefined, number | undefined] | undefined
  stops: (number | undefined)[] = []
  onended: (() => void) | null = null
  connect(): void {}
  disconnect(): void {}
  start(when?: number, offset?: number): void {
    this.startedWith = [when, offset]
  }
  stop(when?: number): void {
    this.stops.push(when)
  }
}
class FakeContext implements AudioContextLike {
  currentTime = 0
  destination = { name: 'destination' }
  gains: FakeGain[] = []
  sources: FakeSource[] = []
  createGain(): GainLike {
    const g = new FakeGain()
    this.gains.push(g)
    return g
  }
  createBufferSource(): SourceLike {
    const s = new FakeSource()
    this.sources.push(s)
    return s
  }
}

async function makeSampler() {
  const ctx = new FakeContext()
  const map = parseSampleMap(JSON.parse(readFileSync(`${SAMPLES_DIR}/map.json`, 'utf8')))
  const bank = await loadSampleBank(
    { decodeAudioData: async (data) => ({ decoded: data.byteLength }) },
    'samples/placeholder/',
    async (url) => {
      const file = url.replace('samples/placeholder/', '')
      const bytes = readFileSync(`${SAMPLES_DIR}/${file}`)
      return {
        ok: true,
        status: 200,
        json: async () => JSON.parse(readFileSync(`${SAMPLES_DIR}/${file}`, 'utf8')),
        arrayBuffer: async () => bytes.buffer as unknown as ArrayBuffer,
      }
    },
  )
  assert.equal(bank.buffers.size, map.notes.length)
  return { ctx, sampler: new Sampler(ctx, bank), map }
}

test('sampler: a normal note plays from the start with the attack and loops its sustain', async () => {
  const { ctx, sampler, map } = await makeSampler()
  sampler.noteOn({ when: 1, midi: [53], gain: 0.6, attack: true, fade: 0.005 })
  const src = ctx.sources[0]!
  const entry = map.notes.find((e) => e.midi === 53)!
  assert.deepEqual(src.startedWith, [1, 0])
  assert.equal(src.loop, true)
  assert.equal(src.loopStart, entry.sustainStart)
  assert.equal(src.loopEnd, entry.sustainEnd)
  assert.equal(src.playbackRate.value, 1)
})

test('sampler: a slurred note starts in the sustain section and crossfades with the previous note', async () => {
  const { ctx, sampler, map } = await makeSampler()
  const first = sampler.noteOn({ when: 1, midi: [53], gain: 0.6, attack: true, fade: 0.005 })
  sampler.noteOn({ when: 2, midi: [55], gain: 0.6, attack: false, fade: 0.04, join: first })
  const entry = map.notes.find((e) => e.midi === 55)!
  const second = ctx.sources[1]!
  assert.deepEqual(second.startedWith, [2, entry.sustainStart], 'no attack: enters at the sustain start')
  const fadeIn = ctx.gains[2]!.gain.calls // gains[0] is master, [1] first note, [2] second note
  assert.deepEqual(fadeIn[0], ['set', 0, 2])
  assert.deepEqual(fadeIn[1], ['ramp', 0.6 * 1, 2.04])
  const fadeOut = ctx.gains[1]!.gain.calls
  assert.deepEqual(fadeOut.at(-1), ['ramp', 0, 2.04], 'the previous note fades out over the same 40 ms')
  assert.equal(ctx.sources[0]!.stops.length, 1)
})

/** A bank that always strikes: note 60 plays once (no loop points), note 62 has a loop. The buffers are stand-ins. */
function strikeBank(): SampleBank {
  const map = parseSampleMap({
    format: 1,
    attack: 'always',
    notes: { 60: { file: '60.ogg', gain: 0.5 }, 62: { file: '62.ogg', sustainStart: 0.5, sustainEnd: 0.9 } },
  })
  return { map, buffers: new Map<number, unknown>([[60, { note: 60 }], [62, { note: 62 }]]) }
}

test('sampler: on a set with "attack": "always" a slurred note starts at 0 like any other, with a short fade-in; on a normal set it still starts at the sustain', async () => {
  const ctx = new FakeContext()
  const sampler = new Sampler(ctx, strikeBank())
  const first = sampler.noteOn({ when: 1, midi: [60], gain: 0.6, attack: true, fade: 0.005 })
  sampler.noteOn({ when: 2, midi: [62], gain: 0.6, attack: false, fade: 0.04, join: first }) // slurred: the scheduler's legato fade is 40 ms
  assert.deepEqual(ctx.sources[1]!.startedWith, [2, 0], 'the strike is played, not skipped')
  assert.deepEqual(ctx.gains[2]!.gain.calls.slice(0, 2), [['set', 0, 2], ['ramp', 0.6 * 1, 2.005]], 'in 5 ms, so the 40 ms crossfade does not bury the strike')
  assert.deepEqual(ctx.gains[1]!.gain.calls.at(-1), ['ramp', 0, 2.04], 'the note before it still fades out over the 40 ms')
  // The normal set: the same slurred note enters at its sustain start with the whole fade.
  const normal = await makeSampler()
  const before = normal.sampler.noteOn({ when: 1, midi: [53], gain: 0.6, attack: true, fade: 0.005 })
  normal.sampler.noteOn({ when: 2, midi: [55], gain: 0.6, attack: false, fade: 0.04, join: before })
  assert.deepEqual(normal.ctx.sources[1]!.startedWith, [2, normal.map.notes.find((e) => e.midi === 55)!.sustainStart])
  assert.deepEqual(normal.ctx.gains[2]!.gain.calls[1], ['ramp', 0.6 * 1, 2.04])
})

test('sampler: a note without loop points plays once, is not looped, and a release after the file has ended is harmless', async () => {
  const ctx = new FakeContext()
  const sampler = new Sampler(ctx, strikeBank())
  const once = sampler.noteOn({ when: 0, midi: [60], gain: 1, attack: true, fade: 0.005 })
  sampler.noteOn({ when: 1, midi: [62], gain: 1, attack: true, fade: 0.005 })
  assert.equal(ctx.sources[0]!.loop, false, 'plays to the end of the file and stops')
  assert.equal(ctx.sources[1]!.loop, true)
  assert.equal(ctx.sources[1]!.loopStart, 0.5)
  assert.equal(ctx.sources[1]!.loopEnd, 0.9)
  assert.equal(ctx.sources[0]!.playbackRate.value, 1)
  once.release(30, 0.06) // a held note outlasts a 4 s sample: the source has ended, and the release only schedules the stop
  assert.deepEqual(ctx.gains[1]!.gain.calls.at(-1), ['ramp', 0, 30.06])
  assert.ok(ctx.sources[0]!.stops[0]! > 30.06)
})

test('sampler: release fades to silence and stops the source after the fade', async () => {
  const { ctx, sampler } = await makeSampler()
  const h = sampler.noteOn({ when: 0, midi: [60], gain: 1, attack: true, fade: 0.005 })
  h.release(1, 0.02)
  assert.deepEqual(ctx.gains[1]!.gain.calls.at(-1), ['ramp', 0, 1.02])
  assert.ok(ctx.sources[0]!.stops[0]! > 1.02)
})

test('sampler: a pitch outside the set uses the nearest sample, repitched', async () => {
  const { ctx, sampler } = await makeSampler()
  sampler.noteOn({ when: 0, midi: [78], gain: 1, attack: true, fade: 0.005 })
  assert.ok(Math.abs(ctx.sources[0]!.playbackRate.value - 2 ** (2 / 12)) < 1e-12)
})

test('latency: outputLatency when reported, else baseLatency plus a fallback', () => {
  assert.equal(outputLatency({ outputLatency: 0.08, baseLatency: 0.01 }), 0.08)
  assert.equal(outputLatency({ outputLatency: 0, baseLatency: 0.01 }), 0.01 + OUTPUT_LATENCY_FALLBACK)
  assert.equal(outputLatency({}), OUTPUT_LATENCY_FALLBACK)
})

// --- click-free envelopes ---

/** The gain a FakeParam's event list would produce at time t (linear ramps between events, cancel removes events at or after its time). */
function gainCurve(calls: [string, number, number?][]): (t: number) => number {
  let events: { t: number; v: number; ramp: boolean }[] = []
  for (const [kind, a, b] of calls) {
    if (kind === 'cancel') events = events.filter((e) => e.t < a)
    else if (kind === 'set') events.push({ t: b!, v: a, ramp: false })
    else events.push({ t: b!, v: a, ramp: true })
    events.sort((x, y) => x.t - y.t)
  }
  return (t) => {
    let value = 0
    let prev: { t: number; v: number } = { t: 0, v: 0 }
    for (const e of events) {
      if (e.t <= t) {
        value = e.v
        prev = e
        continue
      }
      // the first event after t: a ramp interpolates from the previous event, a set holds
      return e.ramp ? prev.v + ((e.v - prev.v) * (t - prev.t)) / (e.t - prev.t) : value
    }
    return value
  }
}

/** Largest jump of the gain between two instants 0.1 ms apart over [from, to]. */
function maxStep(curve: (t: number) => number, from: number, to: number): number {
  let max = 0
  for (let t = from; t < to; t += 0.0001) max = Math.max(max, Math.abs(curve(t + 0.0001) - curve(t)))
  return max
}

test('sampler: releasing a note in the middle of its fade-in continues smoothly (no jump to full level)', async () => {
  const { ctx, sampler } = await makeSampler()
  const h = sampler.noteOn({ when: 1, midi: [60], gain: 0.5, attack: false, fade: 0.04 })
  h.release(1.02, 0.03) // half way through the 40 ms fade-in
  const curve = gainCurve(ctx.gains[1]!.gain.calls)
  assert.ok(Math.abs(curve(1.02) - 0.25) < 1e-9, `gain at the release is the fade-in value, got ${curve(1.02)}`)
  assert.ok(maxStep(curve, 0.99, 1.08) < 0.5 / 0.04 * 0.0001 * 1.5, 'no sudden step anywhere')
  assert.ok(curve(1.06) < 1e-9, 'silent at the end of the fade-out')
})

test('sampler: a slurred note shorter than the crossfade is handed over without a jump', async () => {
  const { ctx, sampler } = await makeSampler()
  const a = sampler.noteOn({ when: 0, midi: [60], gain: 0.5, attack: true, fade: 0.005 })
  const b = sampler.noteOn({ when: 1, midi: [62], gain: 0.5, attack: false, fade: 0.04, join: a })
  sampler.noteOn({ when: 1.01, midi: [64], gain: 0.5, attack: false, fade: 0.04, join: b }) // b lasts only 10 ms
  const curve = gainCurve(ctx.gains[2]!.gain.calls) // gains: master, a, b, c
  assert.ok(maxStep(curve, 0.99, 1.1) < 0.5 / 0.04 * 0.0001 * 1.5, 'b rises and falls without a step')
})

test('sampler: a release that starts after its note began never drops the gain in zero time', async () => {
  const { ctx, sampler } = await makeSampler()
  const h = sampler.noteOn({ when: 0, midi: [60], gain: 1, attack: true, fade: 0.005 })
  h.release(1, 0) // late scheduler action: no fade at all
  const ramp = ctx.gains[1]!.gain.calls.at(-1)!
  assert.equal(ramp[0], 'ramp')
  assert.ok(ramp[2]! >= 1 + MIN_RELEASE_FADE, `fade-out lasts at least ${MIN_RELEASE_FADE} s, ends at ${ramp[2]}`)
})

test('sampler: releasing a note that has not started silences it before its start', async () => {
  const { ctx, sampler } = await makeSampler()
  const h = sampler.noteOn({ when: 2, midi: [60], gain: 1, attack: true, fade: 0.005 })
  h.release(1.5, 0.03) // stop pressed while the note was scheduled ahead
  const curve = gainCurve(ctx.gains[1]!.gain.calls)
  assert.equal(maxStep(curve, 1.4, 2.5), 0, 'the gain stays 0')
  assert.ok(ctx.sources[0]!.stops[0]! <= 2, 'the source stops no later than its start')
})

test('sampler: a sample that cannot be decoded is named in the error', async () => {
  await assert.rejects(
    loadSampleBank(
      {
        decodeAudioData: async () => {
          throw new Error('Unable to decode audio data')
        },
      },
      'samples/x/',
      async (url) => ({
        ok: true,
        status: 200,
        json: async () => ({ format: 1, notes: { 60: { file: '60.ogg', sustainStart: 0.1, sustainEnd: 0.5 } } }),
        arrayBuffer: async () => new ArrayBuffer(4),
      }),
    ),
    /sample 60\.ogg could not be decoded \(Unable to decode audio data\)/,
  )
})

// --- the whole chain: scheduler -> sampler -> gain envelopes ---

test('playback chain: fast slurs, staccato notes, a tempo change and a stop leave no click in any envelope', async () => {
  const { Scheduler } = await import('../src/core/playback/scheduler.ts')
  const { barOf, n, scoreOf, tenorTimeline } = await import('./playbackHelpers.ts')
  const { ctx, sampler } = await makeSampler()
  // Bar 1: eight slurred eighths; bar 2: four staccato quarters; bar 3: sixteenths slurred in pairs, then plain notes.
  const bar = (body: string) => ({ body })
  const slurred = (steps: string[], type: string) => steps.map((step, i) => n({ step, type, slur: i === 0 ? 'start' : i === steps.length - 1 ? 'stop' : undefined })).join('')
  const score = scoreOf([
    bar(slurred(['C', 'D', 'E', 'F', 'G', 'A', 'B', 'C'], 'eighth')),
    bar(['C', 'E', 'G', 'E'].map((step) => n({ step, stac: true })).join('')),
    bar(slurred(['C', 'D'], '16th') + slurred(['E', 'F'], '16th') + slurred(['G', 'A', 'B'], '16th') + n({ step: 'C', type: 'eighth' }) + n({ type: 'quarter' }) + n({ step: 'E', type: 'half' })),
    barOf('G'),
  ])
  const timeline = tenorTimeline(score)
  for (const bpm of [200, 96, 50]) {
    ctx.currentTime = 0
    ctx.gains.length = 0
    ctx.sources.length = 0
    const sampler2 = new Sampler(ctx, (sampler as unknown as { bank: never }).bank)
    let timer: (() => void) | undefined
    const scheduler = new Scheduler(timeline, {
      clock: ctx,
      output: sampler2,
      bpm,
      timer: { set: (fn) => ((timer = fn), 1), clear: () => (timer = undefined) },
    })
    scheduler.start(0)
    const tick = (seconds: number) => {
      for (let t = 0; t < seconds; t += 0.025) {
        ctx.currentTime = Math.round((ctx.currentTime + 0.025) * 1e6) / 1e6
        timer?.()
      }
    }
    tick(60 / bpm * 6) // into bar 2
    scheduler.setBpm(bpm * 0.8) // a tempo change reschedules from the current note
    tick(60 / bpm * 3)
    scheduler.stop() // stopped in the middle of a note, with releases still scheduled ahead
    tick(0.5)
    const voices = ctx.gains.slice(1) // [0] is the master gain
    assert.ok(voices.length > 10, `${bpm} bpm: notes were played`)
    const worst = Math.max(...voices.map((g) => maxStep(gainCurve(g.gain.calls), 0, ctx.currentTime + 0.2)))
    assert.ok(worst < 0.04, `${bpm} bpm: largest 0.1 ms step in any voice gain is ${worst}`)
    // Every voice is silent in the end.
    for (const g of voices) assert.ok(gainCurve(g.gain.calls)(ctx.currentTime + 0.5) < 1e-9, `${bpm} bpm: a voice is still open after stop`)
    // Slurs crossfade: while two voices overlap their gains add up to at most the louder one's level.
    let peak = 0
    const curves = voices.map((g) => gainCurve(g.gain.calls))
    for (let t = 0; t < ctx.currentTime; t += 0.001) peak = Math.max(peak, curves.reduce((sum, c) => sum + c(t), 0))
    assert.ok(peak <= 1.0, `${bpm} bpm: the voice gains add up to ${peak}`)
  }
})

// --- 5.4 pitch reference and one sample folder per instrument ---

test('pitch reference: 442 Hz gives a playback-rate factor of 442/440, at the default 440 it is 1', () => {
  assert.equal(PITCH_REFERENCE_DEFAULT, 440)
  assert.equal(pitchFactor(440), 1)
  assert.equal(pitchFactor(442), 442 / 440)
  assert.equal(pitchFactor(430), 430 / 440)
  const map = parseSampleMap({
    format: 1,
    notes: { 50: { file: 'a.wav', sustainStart: 0.1, sustainEnd: 0.3 }, 60: { file: 'b.wav', sustainStart: 0.1, sustainEnd: 0.3 } },
  })
  assert.equal(pickSample(map, 50, 442).rate, 442 / 440, 'a note that is a sample: just the factor')
  assert.equal(pickSample(map, 50).rate, 1, 'no reference given: 440')
  assert.ok(Math.abs(pickSample(map, 52, 442).rate - 2 ** (2 / 12) * (442 / 440)) < 1e-12, 'a repitched note: the gap and the factor')
  assert.equal(pickSample(map, 52, 442).entry.midi, 50, 'the reference does not change which sample is chosen')
})

test('pitch reference: from 430 to 450 Hz in whole Hz', () => {
  assert.equal(clampPitchReference(442), 442)
  assert.equal(clampPitchReference(442.4), 442)
  assert.equal(clampPitchReference(420), 430)
  assert.equal(clampPitchReference(500), 450)
  assert.equal(clampPitchReference(Number.NaN), 440)
})

test('sampler: at 442 Hz every note plays at the rate of 442/440 on top of its own; a change reaches the notes that start after it', async () => {
  const { ctx, sampler } = await makeSampler()
  sampler.noteOn({ when: 0, midi: [53], gain: 0.6, attack: true, fade: 0.005 })
  assert.equal(ctx.sources[0]!.playbackRate.value, 1, 'default 440 Hz')
  sampler.pitchReference = 442
  assert.equal(sampler.pitchReference, 442)
  sampler.noteOn({ when: 1, midi: [53], gain: 0.6, attack: true, fade: 0.005 }) // a sample of the set: rate 1 * 442/440
  assert.equal(ctx.sources[1]!.playbackRate.value, 442 / 440)
  sampler.noteOn({ when: 2, midi: [78], gain: 0.6, attack: true, fade: 0.005 }) // outside the set: repitched, and tuned
  assert.ok(Math.abs(ctx.sources[2]!.playbackRate.value - 2 ** (2 / 12) * (442 / 440)) < 1e-12)
  assert.equal(ctx.sources[0]!.playbackRate.value, 1, 'a note that already started is not touched')
  sampler.pitchReference = 1000
  assert.equal(sampler.pitchReference, 450, 'kept inside the range')
  // A chord: every note follows it.
  sampler.pitchReference = 438
  sampler.noteOn({ when: 3, midi: [53, 55], gain: 0.6, attack: true, fade: 0.005 })
  assert.deepEqual(ctx.sources.slice(3).map((x) => x.playbackRate.value), [438 / 440, 438 / 440])
})

test('sample folders: an instrument\'s sound is the folder samples/<sound>/', () => {
  assert.equal(soundFolder('tenor-sax'), 'samples/tenor-sax/')
  assert.equal(soundFolder('piano'), 'samples/piano/')
})

/** A fetch that serves the placeholder fixture for any sound and records which folders were asked for. */
function fixtureFetch(asked: string[]) {
  return async (url: string) => {
    asked.push(url)
    const file = url.slice(url.lastIndexOf('/') + 1)
    if (url.includes('/missing/')) return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) }
    const bytes = readFileSync(`${SAMPLES_DIR}/${file}`)
    return {
      ok: true,
      status: 200,
      json: async () => JSON.parse(readFileSync(`${SAMPLES_DIR}/${file}`, 'utf8')),
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    }
  }
}

test('sound library: each instrument loads its own folder, once; going back to one is instant; a failed load is tried again', async () => {
  const asked: string[] = []
  let decoded = 0
  const library = new SoundLibrary({ decodeAudioData: async () => ({ id: ++decoded }) }, fixtureFetch(asked))
  const tenor = await library.load('tenor-sax')
  assert.ok(asked.includes('samples/tenor-sax/map.json'))
  assert.ok(asked.every((u) => u.startsWith('samples/tenor-sax/')), 'only the tenor folder so far')
  const piano = await library.load('piano')
  assert.ok(asked.includes('samples/piano/map.json'))
  assert.notEqual(piano, tenor)
  const count = asked.length
  assert.equal(await library.load('tenor-sax'), tenor, 'kept')
  assert.equal(asked.length, count, 'no second download')
  assert.deepEqual(await Promise.all([library.load('piano'), library.load('piano')]), [piano, piano], 'two asks at once share the load')

  await assert.rejects(library.load('missing'), /sample map not found \(404\)/)
  await assert.rejects(library.load('missing'), /sample map not found \(404\)/)
  assert.equal(asked.filter((u) => u === 'samples/missing/map.json').length, 2, 'a failure is not kept')
})

test('sampler: switching to another sound plays the next notes from its samples; the sound already playing is not cut', async () => {
  const asked: string[] = []
  let decoded = 0
  const library = new SoundLibrary({ decodeAudioData: async () => ({ set: decoded }) }, fixtureFetch(asked), (sound) => `samples/${sound}/`)
  decoded = 1
  const tenor = await library.load('tenor-sax')
  decoded = 2
  const piano = await library.load('piano')
  const ctx = new FakeContext()
  const sampler = new Sampler(ctx, tenor)
  const first = sampler.noteOn({ when: 0, midi: [53], gain: 0.6, attack: true, fade: 0.005 })
  sampler.useBank(piano)
  sampler.noteOn({ when: 1, midi: [53], gain: 0.6, attack: true, fade: 0.005 })
  assert.deepEqual(ctx.sources[0]!.buffer, { set: 1 }, 'the note that began in the tenor sound keeps its buffer')
  assert.deepEqual(ctx.sources[1]!.buffer, { set: 2 }, 'the next note comes from the piano set')
  assert.equal(ctx.sources[0]!.stops.length, 0)
  first.release(2, 0.05)
  assert.equal(ctx.sources[0]!.stops.length, 1, 'and releases normally')
})

// --- 5.3 the accent envelope ---

test('sampler: an accent comes in above the level and is back at the level within 150 ms', async () => {
  const { ctx, sampler } = await makeSampler()
  sampler.noteOn({ when: 1, midi: [60], gain: 0.5, attack: true, fade: 0.005, accent: { gain: 0.5 * 10 ** (4 / 20), decay: 0.15 } })
  sampler.noteOn({ when: 3, midi: [60], gain: 0.5, attack: true, fade: 0.005 })
  const curve = gainCurve(ctx.gains[1]!.gain.calls)
  const plain = gainCurve(ctx.gains[2]!.gain.calls)
  const peak = 0.5 * 10 ** (4 / 20)
  assert.ok(Math.abs(curve(1.005) - peak) < 1e-9, 'the attack is at the boosted gain')
  assert.ok(curve(1.005) > plain(3.005) * 1.5, 'clearly above the same note unaccented')
  assert.ok(curve(1.08) < curve(1.005) && curve(1.08) > 0.5, 'falling back')
  assert.ok(Math.abs(curve(1.15) - 0.5) < 1e-9, 'at the dynamic level 150 ms after the start')
  assert.ok(Math.abs(curve(1.4) - 0.5) < 1e-9, 'and it stays there')
  assert.ok(maxStep(curve, 0.99, 1.4) < (peak / 0.005) * 0.0001 * 1.5, 'no step in the envelope')
})

test('sampler: releasing an accented note inside its 150 ms continues from where the envelope is (no step)', async () => {
  const { ctx, sampler } = await makeSampler()
  const peak = 0.6 * 10 ** (4 / 20)
  const h = sampler.noteOn({ when: 1, midi: [60], gain: 0.6, attack: true, fade: 0.005, accent: { gain: peak, decay: 0.15 } })
  h.release(1.08, 0.02) // a short note: released half way down the fall-back
  const curve = gainCurve(ctx.gains[1]!.gain.calls)
  const expected = peak + ((0.6 - peak) * (1.08 - 1.005)) / (0.15 - 0.005)
  assert.ok(Math.abs(curve(1.08) - expected) < 1e-9, `the gain at the release is the envelope's value, ${curve(1.08)} vs ${expected}`)
  assert.ok(maxStep(curve, 0.99, 1.2) < (peak / 0.005) * 0.0001 * 1.5, 'no step anywhere, release included')
  assert.ok(curve(1.11) < 1e-9, 'silent at the end of the fade-out')
  // Released after the fall-back: unchanged behaviour, from the level.
  const h2 = sampler.noteOn({ when: 5, midi: [60], gain: 0.6, attack: true, fade: 0.005, accent: { gain: peak, decay: 0.15 } })
  h2.release(6, 0.03)
  const c2 = gainCurve(ctx.gains[2]!.gain.calls)
  assert.ok(Math.abs(c2(5.99) - 0.6) < 1e-9)
  assert.ok(c2(6.04) < 1e-9)
})

test('sampler: an accent that is not above the level is a plain note', async () => {
  const { ctx, sampler } = await makeSampler()
  sampler.noteOn({ when: 0, midi: [60], gain: 0.5, attack: true, fade: 0.005, accent: { gain: 0.4, decay: 0.15 } })
  const calls = ctx.gains[1]!.gain.calls
  assert.deepEqual(calls, [['set', 0, 0], ['ramp', 0.5, 0.005]])
})
