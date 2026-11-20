import assert from 'node:assert/strict'
import { test } from 'node:test'
import { effect } from '@preact/signals'
import { createI18n } from '../src/app/i18n/index.ts'
import { DEFAULT_PRACTICE, LibraryError, createLibrary } from '../src/app/library.ts'
import { partsHintOf, partsHintText } from '../src/app/parts.ts'
import type { PiecePatch, PracticeState } from '../src/app/library.ts'
import { PracticeSession, SAVE_DELAY_MS } from '../src/app/practiceSession.ts'
import type { PracticeLibrary } from '../src/app/practiceSession.ts'
import { loadSettings } from '../src/app/settings.ts'
import { INSTRUMENTS, PIANO, TENOR_SAX } from '../src/core/instruments/instruments.ts'
import type { Instrument } from '../src/core/instruments/instruments.ts'
import type { AudioBackend } from '../src/core/playback/player.ts'
import { PLAYBACK_TUNING } from '../src/core/playback/scheduler.ts'
import type { ClickSpec, NoteOnSpec, TimerApi, VoiceHandle } from '../src/core/playback/scheduler.ts'
import { notesOf } from '../src/core/score/model.ts'
import type { Score } from '../src/core/score/model.ts'
import { createFakePlatform } from '../src/platform/fake/index.ts'
import { n, partsXml, scoreXml } from './playbackHelpers.ts'
import { MELODY_PIANO_FIXTURE, firstLine, read } from './helpers.ts'

// The practice session (practice-app task 9.3, design D8 and D11 to D12, specs `practice-controls`,
// `score-playback` "Cursor follows playback" and `instruments` "Instrument for one session") against
// the fake platform and a fake audio backend, on a controlled clock. One virtual clock (`Rig`) drives
// the audio time, the scheduler's timer, the bar poll and the debounce, so the tests run in no time and
// see exactly when things happen. What the player did is read from the backend's note and click log;
// what was saved is read from a spy around the library's calls.

const T0 = Date.parse('2026-11-18T14:05:00.000Z')
const START = PLAYBACK_TUNING.startDelay
/** The latency the session assumes for a backend that reports none (`outputLatency`). */
const LATENCY = 0.04

/** The score: bar k has one whole note, with a pitch no other bar has (tenor saxophone: written C4 sounds as 46). */
const STEPS = ['C', 'D', 'E', 'F', 'G', 'A', 'B']
const WRITTEN: Record<string, number> = { C: 60, D: 62, E: 64, F: 65, G: 67, A: 69, B: 71 }
const writtenOfBar = (bar: number): number => WRITTEN[STEPS[(bar - 1) % 7]!]! + 12 * Math.floor((bar - 1) / 7)
const concertOfBar = (bar: number): number => writtenOfBar(bar) + TENOR_SAX.transpose
const barOfConcert = (midi: number): number => {
  for (let bar = 1; bar <= 20; bar++) if (concertOfBar(bar) === midi) return bar
  throw new Error(`no bar plays ${midi}`)
}
const wholeBar = (bar: number) => ({ body: n({ step: STEPS[(bar - 1) % 7]!, octave: 4 + Math.floor((bar - 1) / 7), type: 'whole' }) })
const piecesXml = (bars: number, directions = ''): string => scoreXml(Array.from({ length: bars }, (_, i) => wholeBar(i + 1)), [4, 4], directions)
const MODERATO = '<direction placement="above"><direction-type><words>Moderato</words></direction-type></direction>'

/** The virtual clock and the fake audio backend that goes with it. */
class Rig {
  ms = 0
  notes: { spec: NoteOnSpec; calledAt: number; cancelled: boolean }[] = []
  clicks: ClickSpec[] = []
  sounds: string[] = []
  references: number[] = []
  closed = 0
  private readonly timers = new Map<number, { fn: () => void; every: number; next: number }>()
  private counter = 0

  get seconds(): number {
    return this.ms / 1000
  }

  readonly timer: TimerApi = {
    set: (fn, ms) => {
      const handle = ++this.counter
      this.timers.set(handle, { fn, every: ms, next: this.ms + ms })
      return handle
    },
    clear: (handle) => {
      this.timers.delete(handle as number)
    },
  }

  readonly audio: AudioBackend = {
    get currentTime(): number {
      return rig.seconds
    },
    output: {
      noteOn: (spec): VoiceHandle => {
        const note = { spec, calledAt: this.seconds, cancelled: false }
        this.notes.push(note)
        return { release() {}, cancel: () => void (note.cancelled = true) }
      },
      click: (spec) => {
        this.clicks.push(spec)
      },
    },
    useSound: async (sound) => {
      this.sounds.push(sound)
    },
    setPitchReference: (hz) => {
      this.references.push(hz)
    },
    close: () => {
      this.closed++
    },
  }

  /** Runs the clock on, firing every timer that falls due, in order. */
  advance(ms: number): void {
    const end = this.ms + ms
    for (;;) {
      let due: { next: number; run: () => void } | undefined
      for (const timer of this.timers.values()) {
        if (timer.next <= end && (!due || timer.next < due.next)) {
          const t = timer
          due = { next: t.next, run: () => {
            t.next += t.every
            t.fn()
          } }
        }
      }
      if (!due) break
      this.ms = Math.max(this.ms, due.next)
      due.run()
    }
    this.ms = end
  }

  /** The bars of the notes that have started sounding, in order, without the ones that were cancelled. */
  heard(): number[] {
    return this.notes.filter((x) => !x.cancelled && x.spec.when <= this.seconds + 1e-9).map((x) => barOfConcert(x.spec.midi[0]!))
  }
}
let rig: Rig

/** Lets the in-memory files finish what was started. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

const close = (a: number, b: number, message?: string): void => assert.ok(Math.abs(a - b) < 1e-6, message ?? `${a} vs ${b}`)

interface SetupOptions {
  bars?: number
  directions?: string
  /** The practice.json the piece has; the default is a tempo of 120 (a whole-note bar lasts 2 s). `null`: none. */
  practice?: Partial<PracticeState> | null
  /** The settings' default instrument. */
  instrument?: string
  /** The settings' count-in. */
  countIn?: boolean
  /** The piece's MusicXML (with `bars`), instead of the whole-note exercise. */
  xml?: string
  /** Makes the backend; the default is the rig's. */
  backend?: (instrument: Instrument) => Promise<AudioBackend>
}

async function setup(options: SetupOptions = {}) {
  const r = (rig = new Rig())
  const platform = createFakePlatform()
  const { files, device } = platform
  files.seed('scans/1/page-1.jpg', Uint8Array.of(0xff, 0xd8, 0xff))
  const library = createLibrary(files, { newId: () => 'piece-1', now: () => new Date(T0 - 86_400_000) })
  const bars = options.bars ?? 12
  const info = await library.create({
    name: 'Ode to Joy',
    musicxml: options.xml ?? piecesXml(bars, options.directions),
    bars,
    repairs: [],
    pages: [{ source: 'scans/1/page-1.jpg', recognised: '<score-partwise/>', firstBar: 1, lastBar: bars }],
  })
  if (options.practice !== null) await library.writePractice(info.id, { ...DEFAULT_PRACTICE, tempo: 120, ...options.practice })
  const settings = await loadSettings(files)
  if (options.instrument) await settings.setDefaultInstrument(options.instrument)
  if (options.countIn) await settings.setCountIn(true)

  /** What the session asked the library to save, and when. */
  const log = { writes: [] as { at: number; state: PracticeState }[], updates: [] as { at: number; id: string; patch: PiecePatch }[] }
  const spied: PracticeLibrary = {
    load: (id) => library.load(id),
    readPractice: (id) => library.readPractice(id),
    writePractice: (id, state) => {
      log.writes.push({ at: r.ms, state: structuredClone(state) })
      return library.writePractice(id, state)
    },
    update: (id, patch) => {
      log.updates.push({ at: r.ms, id, patch })
      return library.update(id, patch)
    },
  }
  const deps = {
    library: spied,
    settings,
    device,
    backend: options.backend ?? (async () => r.audio),
    timer: r.timer,
    now: () => new Date(T0 + r.ms),
  }
  const session = await PracticeSession.open(info.id, deps)
  return { rig: r, files, device, library, settings, info, session, log, deps }
}

type Setup = Awaited<ReturnType<typeof setup>>

/** The practice.json as it is stored now. */
const stored = (s: Setup): Promise<PracticeState | null> => s.library.readPractice(s.info.id)

// ---- Opening a piece: what was remembered ---------------------------------------------------------

test('opening restores bar, tempo, loop, rest and metronome, and plays from there (spec "Reopen a piece")', async () => {
  // An older practice.json may still say follow: false; the view follows all the same (design D17).
  const { rig: r, session } = await setup({ practice: { bar: 10, tempo: 60, loop: { start: 9, end: 12 }, loopRest: 1, metronome: true, ...{ follow: false } } })
  assert.equal(session.piece.name, 'Ode to Joy')
  assert.equal(session.bars, 12)
  assert.equal(session.bar.value, 10)
  assert.equal(session.tempo.value, 60)
  assert.deepEqual(session.loop.value, { start: 9, end: 12 })
  assert.equal(session.loopRest.value, 1)
  assert.equal(session.metronome.value, true)
  assert.equal(session.countIn.value, false)
  assert.equal(session.following.value, true)
  assert.equal(session.state.value, 'stopped')
  assert.equal(session.instrument.id, 'tenor-sax')
  // The player has the same: the loop as indices into the score.
  assert.deepEqual(session.player.loop, { start: 8, end: 11 })
  assert.equal(session.player.bpm, 60)
  assert.equal(session.player.loopRest, 1)

  await session.play()
  r.advance(17_000)
  // At 60 bpm a bar lasts 4 s: bars 10, 11, 12, then one bar of rest, then bar 9 (no count-in before the first pass only; none is on).
  assert.deepEqual(r.heard(), [10, 11, 12, 9])
  const bar9 = r.notes.find((x) => barOfConcert(x.spec.midi[0]!) === 9)!
  close(bar9.spec.when, START + 3 * 4 + 4, 'the rest is one bar long, after the loop ends')
  const inRest = r.clicks.filter((c) => c.when >= START + 12 && c.when < START + 16)
  assert.equal(inRest.length, 4, 'the metronome clicks through the rest')
})

test('a piece that was never practised opens at bar 1, at its marking, and reports no tempo chosen', async () => {
  const marked = await setup({ practice: null, directions: MODERATO })
  assert.equal(marked.session.bar.value, 1)
  assert.equal(marked.session.tempo.value, 108, 'a typical Moderato')
  assert.equal(marked.session.tempoSetup.source, 'words')
  const plain = await setup({ practice: null })
  assert.equal(plain.session.tempo.value, 80)
  assert.equal(plain.session.loop.value, null)
  assert.equal(plain.session.loopRest.value, 0)
  assert.equal(plain.session.countIn.value, false)
  assert.equal(plain.session.metronome.value, false)
  assert.equal(plain.session.following.value, true)
  assert.equal(plain.session.shownBar.value, null)
  assert.deepEqual(plain.session.snapshot(), { ...DEFAULT_PRACTICE })
})

test('the tempo is saved only once the user has chosen one: toggling the metronome keeps "not chosen yet"', async () => {
  const s = await setup({ practice: null, directions: MODERATO })
  s.session.toggleMetronome()
  await s.session.save()
  assert.equal((await stored(s))!.tempo, null, 'the marking decides again at the next opening')
  assert.equal((await stored(s))!.metronome, true)
  assert.equal(s.session.tempo.value, 108)

  s.session.setTempo(70)
  assert.equal(s.session.tempo.value, 70)
  await s.session.save()
  assert.equal((await stored(s))!.tempo, 70)
  const again = await PracticeSession.open(s.info.id, s.deps)
  assert.equal(again.tempo.value, 70, 'a remembered tempo (spec "Remembered tempo")')
})

test('what practice.json says is held to the score: a loop past the end goes, a bar after its loop is put back into it', async () => {
  const past = await setup({ bars: 6, practice: { bar: 40, loop: { start: 9, end: 12 } } })
  assert.equal(past.session.loop.value, null, 'a loop that starts after the end')
  assert.equal(past.session.bar.value, 6)
  const cut = await setup({ bars: 6, practice: { bar: 6, loop: { start: 2, end: 9 } } })
  assert.deepEqual(cut.session.loop.value, { start: 2, end: 6 }, 'cut at the end of the piece')
  assert.deepEqual(cut.session.player.loop, { start: 1, end: 5 })
  assert.equal(cut.session.bar.value, 6, 'inside the loop: kept')
  const after = await setup({ practice: { bar: 11, loop: { start: 2, end: 4 } } })
  assert.equal(after.session.bar.value, 2, 'after the loop the scheduler would drop it, so Play starts at its first bar')
})

test('a bar before the loop is kept: Play runs up to the loop from there', async () => {
  const { rig: r, session } = await setup({ practice: { bar: 2, loop: { start: 4, end: 5 } } })
  assert.equal(session.bar.value, 2)
  await session.play()
  r.advance(START * 1000 + 10_500)
  assert.deepEqual(r.heard(), [2, 3, 4, 5, 4, 5], 'bar 2 and 3, then the loop')
})

test('a practice.json that cannot be read opens the piece with the defaults; a missing or damaged piece rejects', async () => {
  const s = await setup({ practice: null })
  const broken: PracticeLibrary = { ...s.deps.library, readPractice: () => Promise.reject(new Error('disk')) }
  const session = await PracticeSession.open(s.info.id, { ...s.deps, library: broken })
  assert.deepEqual(session.snapshot(), { ...DEFAULT_PRACTICE })

  await assert.rejects(PracticeSession.open('nope', s.deps), (e: unknown) => e instanceof LibraryError && e.code === 'not-found')
  const garbled: PracticeLibrary = { ...s.deps.library, load: async (id) => ({ info: (await s.library.load(id)).info, musicxml: '<not-music/>' }) }
  await assert.rejects(PracticeSession.open(s.info.id, { ...s.deps, library: garbled }), (e: unknown) => e instanceof LibraryError && e.code === 'damaged')
})

// ---- Counting in 6/8 ----------------------------------------------------------------------------------

test('6/8: the count-in and the metronome count the same beat (the dotted quarter), so their clicks are evenly spaced', async () => {
  const r = (rig = new Rig())
  const platform = createFakePlatform()
  platform.files.seed('scans/1/page-1.jpg', Uint8Array.of(0xff))
  const library = createLibrary(platform.files, { newId: () => 'six-eight' })
  const eighths = { body: n({ step: 'C', type: 'eighth' }).repeat(6) }
  const info = await library.create({
    name: 'Jig',
    musicxml: scoreXml([eighths, eighths, eighths], [6, 8]),
    bars: 3,
    repairs: [],
    pages: [{ source: 'scans/1/page-1.jpg', recognised: '<score-partwise/>', firstBar: 1, lastBar: 3 }],
  })
  await library.writePractice(info.id, { ...DEFAULT_PRACTICE, tempo: 60, metronome: true })
  const settings = await loadSettings(platform.files)
  await settings.setCountIn(true)
  const session = await PracticeSession.open(info.id, { library, settings, device: platform.device, backend: async () => r.audio, timer: r.timer })
  assert.deepEqual(session.tempoSetup.unit, { n: 3, d: 2 }, 'a dotted quarter')
  assert.deepEqual(session.player.beatUnit, { n: 3, d: 2 }, 'the player counts in the same unit')

  await session.play()
  r.advance(9_000)
  // 60 bpm of a dotted quarter: one click a second. Two count-in clicks, then two metronome beats in each of the three bars.
  const times = r.clicks.map((c) => c.when)
  assert.equal(times.length, 2 + 6)
  times.forEach((t, k) => close(t, START + k, `click ${k}`))
  assert.deepEqual(r.clicks.map((c) => c.accent), [true, false, true, false, true, false, true, false])
  close(r.notes[0]!.spec.when, START + 2, 'the first note comes after the two count-in clicks')
})

// ---- Restart ------------------------------------------------------------------------------------------

test('restart while a loop 9-12 plays in bar 11 continues from the start of bar 9 (spec "Restart a loop")', async () => {
  const { rig: r, session } = await setup({ practice: { bar: 9, loop: { start: 9, end: 12 } } })
  await session.play()
  r.advance(START * 1000 + 4_000 + 200) // bar 9 (0-2 s), bar 10 (2-4 s), now in bar 11
  assert.equal(session.bar.value, 11)
  const before = r.notes.length
  const at = r.seconds
  session.restart()
  assert.equal(session.bar.value, 9)
  assert.equal(session.state.value, 'playing', 'it keeps playing')
  r.advance(300)
  const fresh = r.notes.slice(before).filter((x) => !x.cancelled)
  assert.equal(barOfConcert(fresh[0]!.spec.midi[0]!), 9, 'the first note after the restart is bar 9')
  close(fresh[0]!.spec.when, at + 0.02, 'at once')
  r.advance(2_000)
  assert.equal(session.bar.value, 10, 'and on from there')
  assert.equal(session.loop.value!.start, 9)
})

test('restart without a loop goes to bar 1; paused or stopped it only moves the place Play starts from', async () => {
  const { rig: r, session } = await setup()
  await session.play()
  r.advance(START * 1000 + 6_500) // in bar 4
  assert.equal(session.bar.value, 4)
  session.pause()
  assert.equal(session.bar.value, 4, 'paused in bar 4')
  r.notes.length = 0
  session.restart()
  assert.equal(session.state.value, 'paused')
  assert.equal(session.bar.value, 1)
  assert.deepEqual(r.notes, [], 'a restart while paused plays nothing')
  await session.play()
  r.advance(500)
  assert.equal(barOfConcert(r.notes[0]!.spec.midi[0]!), 1, 'Play then starts at bar 1')

  session.pause()
  session.goToBar(7)
  session.setLoop({ start: 5, end: 6 })
  session.restart()
  assert.equal(session.bar.value, 5, 'with a loop: its first bar')
})

// ---- The instrument and the count-in: general settings (design D17) -----------------------------------------

test('a session plays with the default instrument, which is never saved with the piece (spec "Default instrument")', async () => {
  const s = await setup({ instrument: 'clarinet' })
  const { session, rig: r } = s
  assert.equal(session.instrument.id, 'clarinet', 'the settings decide')
  session.setTempo(100)
  session.toggleMetronome()
  await session.save()
  const written = s.log.writes.at(-1)!.state
  assert.ok(!/instrument|piano|clarinet/i.test(JSON.stringify(written)), 'what is written has no instrument')
  assert.deepEqual(Object.keys(written).sort(), ['bar', 'loop', 'loopRest', 'metronome', 'tempo'])
  assert.equal((await stored(s))!.tempo, 100)

  // The next session uses the default as it is then.
  await s.settings.setDefaultInstrument('piano')
  const next = await PracticeSession.open(s.info.id, s.deps)
  assert.equal(next.instrument, PIANO)
  assert.equal(next.tempo.value, 100, 'the rest is remembered')
  await next.play()
  assert.deepEqual(r.sounds, ['piano'])
})

test('the count-in is the general setting: the session follows it while open, and nothing of it goes to practice.json', async () => {
  const s = await setup({ countIn: true })
  const { session, settings, log, rig: r } = s
  assert.equal(session.countIn.value, true)
  assert.equal(session.player.countIn, true)
  await settings.setCountIn(false)
  assert.equal(session.countIn.value, false)
  assert.equal(session.player.countIn, false, 'the player follows the setting')
  await settings.setCountIn(true)
  assert.equal(session.countIn.value, true)
  assert.equal(session.player.countIn, true)
  r.advance(SAVE_DELAY_MS * 2)
  assert.equal(log.writes.length, 0, 'nothing for practice.json')
})

test('playback is always tuned to 440 Hz: the session passes no other pitch reference (design D19)', async () => {
  const { rig: r, session } = await setup()
  await session.play()
  assert.deepEqual(r.references, [440])
  assert.equal(session.player.pitchReference, 440)
})

// ---- Saving --------------------------------------------------------------------------------------------------

test('changes are saved after a quiet moment, all in one write', async () => {
  const { rig: r, session, log } = await setup({ practice: null })
  r.advance(1_000)
  session.setTempo(90)
  r.advance(300)
  session.toggleMetronome()
  r.advance(300)
  session.setLoop({ start: 3, end: 4 })
  r.advance(300)
  session.setLoopRest(2)
  assert.equal(log.writes.length, 0, 'nothing is written while changes keep coming')
  r.advance(SAVE_DELAY_MS - 1)
  assert.equal(log.writes.length, 0, 'not before the quiet moment is over')
  r.advance(1)
  assert.equal(log.writes.length, 1)
  assert.deepEqual(log.writes[0]!.state, { bar: 3, tempo: 90, loop: { start: 3, end: 4 }, loopRest: 2, metronome: true })
  assert.equal(log.writes[0]!.at, 1_000 + 900 + SAVE_DELAY_MS, 'one delay after the last change')
  r.advance(10_000)
  assert.equal(log.writes.length, 1, 'and nothing again while nothing changes')
})

test('pausing saves at once, with the bar; the bar moving on while playing does not schedule a save', async () => {
  const s = await setup()
  const { rig: r, session, log } = s
  await session.play()
  r.advance(START * 1000 + 10_500) // bars go by: 1 to 6
  assert.equal(session.bar.value, 6)
  assert.equal(log.writes.length, 0, 'playing alone writes nothing, however far it goes')
  session.pause()
  assert.equal(log.writes.length, 1, 'at once, not after the delay')
  assert.equal(log.writes[0]!.at, r.ms)
  assert.equal(log.writes[0]!.state.bar, 6)
  await settle()
  assert.equal((await stored(s))!.bar, 6)
})

test('the app going to the background pauses and saves at once; paused with something unsaved it saves at once', async () => {
  const { rig: r, session, log, device } = await setup()
  await session.play()
  r.advance(START * 1000 + 4_500)
  device.pause()
  assert.equal(session.state.value, 'paused')
  assert.equal(log.writes.length, 1)
  assert.equal(log.writes[0]!.state.bar, 3)
  assert.equal(device.keepAwake, false)

  session.setTempo(75) // a change waiting for its quiet moment
  r.advance(100)
  assert.equal(log.writes.length, 1)
  device.pause()
  assert.equal(log.writes.length, 2, 'saved at once, the delay not waited for')
  assert.equal(log.writes[1]!.state.tempo, 75)
  r.advance(5_000)
  assert.equal(log.writes.length, 2, 'the timer that was waiting is gone')
  device.pause()
  assert.equal(log.writes.length, 2, 'nothing unsaved, nothing written')
  device.resume()
  assert.equal(session.state.value, 'paused', 'coming back does not start the music')
})

test('a save that fails is tried again with the next one and does not break the session', async () => {
  const s = await setup({ practice: null })
  let failures = 1
  const flaky: PracticeLibrary = {
    ...s.deps.library,
    writePractice: (id, state) => {
      if (failures-- > 0) return Promise.reject(new Error('disk full'))
      return s.deps.library.writePractice(id, state)
    },
  }
  const session = await PracticeSession.open(s.info.id, { ...s.deps, library: flaky })
  session.setTempo(65)
  await assert.rejects(session.save(), /disk full/)
  session.toggleMetronome()
  s.rig.advance(SAVE_DELAY_MS)
  await settle()
  assert.deepEqual(await stored(s), { ...DEFAULT_PRACTICE, tempo: 65, metronome: true })
  // And a debounced save that fails does not throw from the timer.
  failures = 1
  session.setTempo(66)
  s.rig.advance(SAVE_DELAY_MS)
  await settle()
  assert.equal((await stored(s))!.tempo, 65)
})

test('a piece deleted while a save waits does not come back, and nothing throws', async () => {
  const s = await setup({ practice: null })
  s.session.setTempo(65)
  await s.library.remove(s.info.id)
  s.rig.advance(SAVE_DELAY_MS)
  await settle()
  assert.deepEqual(s.files.paths().filter((p) => p.startsWith('pieces/')), [], 'no folder was recreated')
})

// ---- lastPracticed and keeping the screen awake -------------------------------------------------------------------

test('lastPracticed is set when playback first starts, once per session', async () => {
  const { rig: r, session, log, library, info, deps } = await setup()
  r.advance(5_000)
  assert.equal(log.updates.length, 0, 'opening is not practising')
  await session.play()
  assert.equal(log.updates.length, 1)
  assert.deepEqual(log.updates[0]!.patch, { lastPracticed: new Date(T0 + 5_000).toISOString() })
  r.advance(2_000)
  session.pause()
  r.advance(1_000)
  await session.play()
  r.advance(1_000)
  session.pause()
  session.goToBar(1)
  await session.play()
  assert.equal(log.updates.length, 1, 'once')
  await settle()
  assert.equal((await library.info(info.id)).lastPracticed, new Date(T0 + 5_000).toISOString())

  // A new session is a new practice.
  r.advance(60_000)
  const next = await PracticeSession.open(info.id, deps)
  await next.play()
  assert.equal(log.updates.length, 2)
})

test('a Play that fails to load its sound neither counts as practising nor keeps the screen on', async () => {
  const s = await setup({ backend: async () => Promise.reject(new Error('no audio')) })
  await assert.rejects(s.session.play(), /no audio/)
  assert.equal(s.session.state.value, 'stopped')
  assert.equal(s.log.updates.length, 0)
  assert.deepEqual(s.device.keepAwakeLog, [])
  assert.equal(s.session.player.state, 'stopped')
})

test('the screen is kept on exactly while playing', async () => {
  const { rig: r, session, device } = await setup({ bars: 3 })
  assert.deepEqual(device.keepAwakeLog, [])
  await session.play()
  assert.deepEqual(device.keepAwakeLog, [true])
  r.advance(1_000)
  session.pause()
  assert.deepEqual(device.keepAwakeLog, [true, false])
  await session.play()
  assert.deepEqual(device.keepAwakeLog, [true, false, true])
  r.advance(10_000) // past the end of three bars of 2 s
  assert.equal(session.state.value, 'stopped')
  assert.deepEqual(device.keepAwakeLog, [true, false, true, false], 'released when the piece ends')
  assert.equal(device.keepAwake, false)
})

test('at the end of the piece the bar is where Play starts again, and it is saved after the quiet moment', async () => {
  const { rig: r, session, log } = await setup({ bars: 3, practice: { bar: 2 } })
  await session.play()
  r.advance(START * 1000 + 4_500) // bars 2 and 3 take 4 s
  assert.equal(session.state.value, 'stopped')
  assert.equal(session.bar.value, 2, 'back at the bar Play started from')
  assert.equal(log.writes.length, 0)
  r.advance(SAVE_DELAY_MS)
  assert.equal(log.writes.length, 1)
  assert.equal(log.writes[0]!.state.bar, 2)
  assert.equal(session.resting.value, false)
})

// ---- Where the player is ----------------------------------------------------------------------------------------------

test('the bar follows the music while playing, and resting is true in the silence between two passes', async () => {
  const { rig: r, session } = await setup({ practice: { bar: 2, loop: { start: 2, end: 3 }, loopRest: 1 } })
  const seen: number[] = []
  const stop = effect(() => {
    seen.push(session.bar.value)
  })
  await session.play()
  assert.equal(session.bar.value, 2, 'before the first note')
  r.advance(START * 1000 + LATENCY * 1000 + 1_000) // in bar 2
  assert.equal(session.bar.value, 2)
  r.advance(2_000) // in bar 3
  assert.equal(session.bar.value, 3)
  assert.equal(session.resting.value, false)
  r.advance(2_000) // loop over; one bar (2 s) of rest
  assert.equal(session.resting.value, true)
  assert.equal(session.bar.value, 3, 'the bar stays at the last one in the silence')
  r.advance(2_000) // back in bar 2
  assert.equal(session.resting.value, false)
  assert.equal(session.bar.value, 2)
  assert.equal(session.heard()?.loopPass, 1)
  stop()
  assert.deepEqual(seen, [2, 3, 2])
  session.pause()
  assert.equal(session.heard(), undefined, 'nothing is heard once paused')
  assert.equal(session.resting.value, false)
})

test('goToBar jumps while playing, moves the start while paused, and clears a bar that was only being shown', async () => {
  const { rig: r, session } = await setup()
  await session.play()
  r.advance(START * 1000 + 500)
  session.showBar(9)
  assert.equal(session.shownBar.value, 9)
  const before = r.notes.length
  session.goToBar(7)
  assert.equal(session.bar.value, 7)
  assert.equal(session.shownBar.value, null)
  assert.equal(session.following.value, true)
  r.advance(300)
  assert.equal(barOfConcert(r.notes.slice(before).filter((x) => !x.cancelled)[0]!.spec.midi[0]!), 7)
  r.advance(2_000)
  assert.equal(session.bar.value, 8)

  session.pause()
  session.goToBar(100)
  assert.equal(session.bar.value, 12, 'held to the last bar')
  session.goToBar(-3)
  assert.equal(session.bar.value, 1, 'and to the first')
  session.goToBar(5)
  r.notes.length = 0
  await session.play()
  r.advance(200)
  assert.equal(barOfConcert(r.notes[0]!.spec.midi[0]!), 5, 'Play starts there')
})

test('goToNote (tap to start from a note) moves the start while stopped and jumps while playing, and an unknown note changes nothing', async () => {
  const { rig: r, session } = await setup()
  const noteOfBar = (bar: number): string => notesOf(firstLine(session.score).measures[bar - 1]!)[0]!.id
  session.goToNote(noteOfBar(9))
  assert.equal(session.bar.value, 9)
  assert.equal(session.shownBar.value, null)
  await session.play()
  r.advance(START * 1000 + LATENCY * 1000 + 300)
  assert.equal(r.heard()[0], 9, 'Play starts at the tapped note')

  session.showBar(2) // looking elsewhere: a tap is a seek, and the view follows it again
  session.goToNote(noteOfBar(4))
  assert.equal(session.shownBar.value, null)
  assert.equal(session.following.value, true)
  r.advance(START * 1000 + 600)
  assert.equal(r.heard().at(-1), 4, 'playing it jumps and carries on')

  session.pause()
  session.goToNote('no-such-note')
  assert.equal(session.bar.value, 4)
})

test('the session holds the score it plays, and says which count-in click sounds (spec "Count-in in 3/4")', async () => {
  const { rig: r, session } = await setup({ countIn: true, practice: { tempo: 120, bar: 1 } })
  assert.equal(firstLine(session.score).measures.length, 12)
  assert.equal(session.counting.value, null)
  await session.play()
  const clicks: string[] = []
  const stop = effect(() => {
    clicks.push(JSON.stringify(session.counting.value))
  })
  r.advance(START * 1000 + LATENCY * 1000 + 100)
  r.advance(500)
  r.advance(500)
  r.advance(500)
  r.advance(500) // the four clicks of one 4/4 bar at 120 bpm are over: the music starts
  stop()
  assert.deepEqual(clicks, ['null', '{"n":1,"of":4}', '{"n":2,"of":4}', '{"n":3,"of":4}', '{"n":4,"of":4}', 'null'])
  session.pause()
  assert.equal(session.counting.value, null)
})

test('a loop set while stopped makes Play start at its first bar; clearing it lets the music run on', async () => {
  const { rig: r, session } = await setup({ bars: 6 })
  session.goToBar(2)
  session.setLoop({ start: 4, end: 3 }) // put in order
  assert.deepEqual(session.loop.value, { start: 3, end: 4 })
  assert.equal(session.bar.value, 3)
  await session.play()
  r.advance(7_000)
  assert.deepEqual(r.heard(), [3, 4, 3, 4])
  session.clearLoop()
  assert.equal(session.loop.value, null)
  assert.equal(session.player.loop, undefined)
  r.advance(7_000)
  assert.equal(session.state.value, 'stopped', 'played through the rest of the piece and ended')
  assert.deepEqual(r.heard().slice(-3), [4, 5, 6])
})

// ---- Show a bar and return -------------------------------------------------------------------------------------------

test('showing a bar and returning to the playing bar never touch the player (spec "Look at bar 7 while playing")', async () => {
  const { rig: r, session, log } = await setup()
  await session.play()
  r.advance(START * 1000 + 2_500) // in bar 2
  assert.equal(session.bar.value, 2)

  // Every method of the player that would change something is watched.
  const touched: string[] = []
  const player = session.player as unknown as Record<string, unknown>
  for (const name of ['play', 'pause', 'stop', 'toggle', 'seek', 'setTempo', 'setBeatUnit', 'setCountIn', 'setLoop', 'setLoopRest', 'setMetronome', 'setPitchReference', 'setInstrument']) {
    const original = (player[name] as (...args: unknown[]) => unknown).bind(player)
    player[name] = (...args: unknown[]) => {
      touched.push(name)
      return original(...args)
    }
  }
  const notesBefore = r.notes.length
  const cancelsBefore = r.notes.filter((x) => x.cancelled).length

  session.showBar(7)
  assert.equal(session.shownBar.value, 7)
  assert.equal(session.following.value, false, 'the view stays where the user put it')
  r.advance(4_000)
  assert.equal(session.bar.value, 4, 'the music plays on from bar 2')
  assert.equal(session.shownBar.value, 7)
  assert.equal(session.state.value, 'playing')

  session.returnToPlaying()
  assert.equal(session.shownBar.value, null)
  assert.equal(session.following.value, true)
  r.advance(2_000)
  assert.equal(session.bar.value, 5)

  assert.deepEqual(touched, [], 'the player was not asked to do anything')
  assert.deepEqual(r.heard(), [1, 2, 3, 4, 5, 6].slice(0, r.heard().length), 'one note after the other, no jump')
  assert.equal(r.notes.filter((x) => x.cancelled).length, cancelsBefore, 'no note was dropped')
  assert.ok(r.notes.length > notesBefore)
  r.advance(SAVE_DELAY_MS * 2)
  assert.equal(log.writes.length, 0, 'and nothing to save')

  session.showBar(99)
  assert.equal(session.shownBar.value, 12, 'held to the last bar')
})

test('following: always on, paused only while another bar is shown, and Return to playing brings it back (design D17)', async () => {
  const { session, log, rig: r } = await setup()
  assert.equal(session.following.value, true)
  const seen: boolean[] = []
  const stop = effect(() => {
    seen.push(session.following.value)
  })
  session.showBar(5)
  assert.equal(session.following.value, false)
  session.returnToPlaying()
  assert.equal(session.following.value, true)
  assert.equal(session.shownBar.value, null)
  stop()
  assert.deepEqual(seen, [true, false, true])
  r.advance(SAVE_DELAY_MS)
  assert.equal(log.writes.length, 0, 'the view is not something to save')
})

// ---- Closing -----------------------------------------------------------------------------------------------------------

test('closing while playing saves the bar, stops, closes the audio and lets the screen go', async () => {
  const s = await setup()
  const { rig: r, session, log, device } = s
  await session.play()
  r.advance(START * 1000 + 6_500) // bar 4
  session.setMetronome(true)
  const closing = session.close()
  assert.equal(session.state.value, 'paused', 'it pauses first')
  await closing
  await settle()
  assert.equal(log.writes.length, 1, 'one write, with both the bar and the change')
  assert.equal(log.writes[0]!.state.bar, 4)
  assert.equal(log.writes[0]!.state.metronome, true)
  assert.equal(session.player.state, 'stopped')
  assert.equal(r.closed, 1)
  assert.equal(device.keepAwake, false)
  r.advance(10_000)
  assert.equal(log.writes.length, 1, 'no timer is left')
  const notes = r.notes.length
  r.advance(5_000)
  assert.equal(r.notes.length, notes, 'and no sound')
  assert.equal((await stored(s))!.bar, 4)

  // Closing again, and asking a closed session for anything, does nothing.
  await session.close()
  await session.play()
  session.goToBar(2)
  session.setTempo(50)
  assert.equal(r.closed, 1)
  assert.equal(log.writes.length, 1)
  assert.equal(session.tempo.value, 120)
  device.pause()
  assert.equal(log.writes.length, 1, 'the app going to the background is not heard any more')
})

test('closing with nothing changed writes nothing; a change waiting for its quiet moment is saved at once', async () => {
  const quiet = await setup()
  await quiet.session.close()
  assert.equal(quiet.log.writes.length, 0)
  assert.equal(quiet.log.updates.length, 0)

  const busy = await setup()
  busy.session.setTempo(95)
  await busy.session.close()
  assert.equal(busy.log.writes.length, 1)
  assert.equal(busy.log.writes[0]!.state.tempo, 95)
  busy.rig.advance(5_000)
  assert.equal(busy.log.writes.length, 1)
})

test('closing while the sound is still loading closes the audio when it arrives', async () => {
  let arrive: (audio: AudioBackend) => void = () => undefined
  const s = await setup({ backend: () => new Promise<AudioBackend>((resolve) => (arrive = resolve)) })
  const playing = s.session.play()
  assert.equal(s.session.state.value, 'loading')
  await s.session.close()
  assert.equal(s.session.state.value, 'stopped')
  assert.equal(s.rig.closed, 0, 'not there yet')
  arrive(s.rig.audio)
  await playing
  await settle()
  assert.equal(s.rig.closed, 1, 'closed as soon as it came')
  assert.deepEqual(s.rig.notes, [], 'and nothing was played')
  assert.deepEqual(s.device.keepAwakeLog, [])
  assert.equal(s.log.updates.length, 0, 'not practising')
})

// ---- The metronome on its own (change steady-notes-and-free-metronome, task 1.3) ----------------------------------------

test('the metronome switched on while stopped clicks on its own at once, with no notes; switched off it stops (spec "Metronome without the music")', async () => {
  const made: Instrument[] = []
  const s = await setup({ practice: { tempo: 80 }, backend: async (i) => (made.push(i), rig.audio) })
  const { rig: r, session } = s
  assert.equal(session.metronomeAlone.value, false)
  const switched = session.toggleMetronome()
  assert.equal(made.length, 1, 'the toggle can be the first gesture: the audio is asked for in the press')
  assert.equal(session.metronome.value, true)
  await switched
  assert.equal(session.metronomeAlone.value, true)
  assert.equal(session.state.value, 'stopped', 'the Play button stays Play')
  assert.deepEqual(s.device.keepAwakeLog, [true], 'the screen stays on while it clicks')
  r.advance(6_000)
  const heard = r.clicks.filter((c) => c.when <= r.seconds)
  assert.equal(heard.length, 8, '80 bpm in 4/4')
  heard.forEach((c, k) => close(c.when, START + k * 0.75, `click ${k}`))
  assert.deepEqual(
    heard.map((c) => c.accent),
    [true, false, false, false, true, false, false, false],
  )
  assert.deepEqual(r.notes, [], 'no notes')

  session.setTempo(100)
  r.advance(3_000)
  const later = r.clicks.filter((c) => c.when <= r.seconds).slice(-3)
  close(later[2]!.when - later[1]!.when, 0.6, 'the tempo reaches it at once (spec "Change the tempo of the metronome on its own")')

  await session.toggleMetronome()
  assert.equal(session.metronomeAlone.value, false)
  const handed = r.clicks.length
  r.advance(3_000)
  assert.equal(r.clicks.length, handed)
  await session.save()
  assert.equal((await stored(s))!.metronome, false)
})

test('a piece left with the metronome on opens silent; Play brings the clicks with the music (spec "Reopen with the metronome on")', async () => {
  const made: Instrument[] = []
  const { rig: r, session } = await setup({ practice: { metronome: true }, backend: async (i) => (made.push(i), rig.audio) })
  assert.equal(session.metronome.value, true, 'it shows as on')
  r.advance(5_000)
  assert.deepEqual(r.clicks, [], 'and nothing sounds')
  assert.deepEqual(made, [], 'no audio is made before a gesture')
  assert.equal(session.metronomeAlone.value, false)
  const pressed = r.seconds
  await session.play()
  r.advance(1_100)
  assert.deepEqual(
    r.clicks.filter((c) => c.when <= r.seconds).map((c) => Math.round((c.when - pressed - START) * 1000) / 1000 + 0),
    [0, 0.5, 1],
    'Play: the metronome with the music (120 bpm)',
  )
  assert.equal(session.metronomeAlone.value, false)
})

test('Play takes over from the metronome on its own: its clicks stop and the music starts with its count-in, on one grid (spec "Play takes over")', async () => {
  const { rig: r, session } = await setup({ countIn: true })
  await session.setMetronome(true)
  r.advance(1_234)
  const pressed = r.seconds
  await session.play()
  assert.equal(session.metronomeAlone.value, false)
  assert.equal(session.state.value, 'playing')
  r.advance(4_000)
  const after = r.clicks.filter((c) => c.when > pressed && c.when <= r.seconds)
  close(after[0]!.when, pressed + START, 'the count-in starts one start delay after Play')
  after.forEach((c, k) => close(c.when, pressed + START + k * 0.5, `click ${k} on the grid of the music`))
  close(r.notes[0]!.spec.when, pressed + START + 2, 'the music after one bar of count-in')
})

test('a sound that cannot be loaded for the metronome on its own is told as a failed Play; nothing is stuck', async () => {
  const s = await setup({ backend: async () => Promise.reject(new Error('no audio')) })
  await assert.rejects(s.session.toggleMetronome(), /no audio/)
  assert.equal(s.session.state.value, 'stopped')
  assert.equal(s.session.metronomeAlone.value, false)
  assert.equal(s.session.metronome.value, true, 'the switch stays on')
  assert.deepEqual(s.device.keepAwakeLog, [])
  await assert.rejects(s.session.play(), /no audio/) // the next press tries again
})

test('leaving the piece, or the app going to the background, silences the metronome on its own and keeps it switched on', async () => {
  const away = await setup()
  await away.session.setMetronome(true)
  away.rig.advance(1_000)
  away.device.pause()
  assert.equal(away.session.metronomeAlone.value, false)
  assert.equal(away.session.metronome.value, true)
  const handed = away.rig.clicks.length
  away.rig.advance(3_000)
  away.device.resume()
  away.rig.advance(3_000)
  assert.equal(away.rig.clicks.length, handed, 'silent, also after coming back')
  await settle()
  assert.equal((await stored(away))!.metronome, true, 'the switch is saved as on')

  const left = await setup()
  await left.session.setMetronome(true)
  left.rig.advance(1_000)
  await left.session.close()
  assert.equal(left.session.metronomeAlone.value, false)
  const sounded = left.rig.clicks.length
  left.rig.advance(3_000)
  assert.equal(left.rig.clicks.length, sounded, 'no click after the screen is left')
  await settle()
  assert.equal(left.rig.closed, 1, 'and the audio is closed')
  assert.equal((await stored(left))!.metronome, true)
})

test('leaving the piece while the audio for the metronome is still loading: nothing clicks when it arrives', async () => {
  let arrive: (audio: AudioBackend) => void = () => undefined
  const s = await setup({ backend: () => new Promise<AudioBackend>((resolve) => (arrive = resolve)) })
  const switched = s.session.toggleMetronome()
  await s.session.close()
  arrive(s.rig.audio)
  await switched
  await settle()
  s.rig.advance(3_000)
  assert.deepEqual(s.rig.clicks, [])
  assert.equal(s.session.metronomeAlone.value, false)
  assert.equal(s.rig.closed, 1, 'the audio is closed when it comes')
})

// ---- Parts and accompaniment (change parts-and-accompaniment, group 6) -------------------------------------------

/** A melody and a piano part, 8 bars: the melody on one staff, the piano on two. At 120 bpm a bar lasts 2 s. */
const melodyPiano = (options: SetupOptions = {}) => setup({ xml: read(MELODY_PIANO_FIXTURE), bars: 8, ...options })
const soundsOf = (r: Rig, from = 0): string[] => [...new Set(r.notes.slice(from).map((x) => x.spec.sound))].sort() as string[]

const hintScore = (...parts: [string, 1 | 2][]): Score => ({ parts: parts.map(([name, staves], i) => ({ id: `P${i + 1}`, name, staves })), bars: [] })

test('parts hint: shown the first time a piece with the Your part row is opened, never again (spec "Parts hint")', async () => {
  const s = await melodyPiano({ practice: null })
  assert.equal(s.session.hasPartsRow, true)
  assert.equal(s.session.hint.value?.kind, 'melodyPiano')
  assert.equal(partsHintText(createI18n().t, s.session.hint.value!), 'Melody with a piano accompaniment. Try ⋯ › Your part.')
  await s.session.close()
  assert.equal((await stored(s))!.partsHintSeen, true, 'saved when the piece closes')
  const second = await PracticeSession.open(s.info.id, s.deps)
  assert.equal(second.hint.value, null, 'the second time: no hint')

  // Playing takes it away too, and it is marked seen at once (it is saved with the next write).
  const third = await melodyPiano({ practice: null })
  await third.session.play()
  assert.equal(third.session.hint.value, null)
  await third.session.save()
  assert.equal((await stored(third))!.partsHintSeen, true)

  // Closed by the user (the x): gone for this session.
  const fourth = await melodyPiano({ practice: null })
  fourth.session.dismissHint()
  assert.equal(fourth.session.hint.value, null)
})

test('parts hint: a one-line piece has none, and its practice.json gets no new field', async () => {
  const s = await setup({ practice: null })
  assert.equal(s.session.hasPartsRow, false)
  assert.equal(s.session.hasInstrumentRow, true)
  assert.equal(s.session.hint.value, null)
  s.session.setTempo(100)
  await s.session.save()
  assert.deepEqual(Object.keys((await stored(s))!).sort(), ['bar', 'loop', 'loopRest', 'metronome', 'tempo'])
})

test('parts hint: the wording per combination of parts', () => {
  const { t } = createI18n()
  const text = (score: Score): string => partsHintText(t, partsHintOf(score)!)
  assert.equal(text(hintScore(['Melody', 1], ['Piano', 2])), 'Melody with a piano accompaniment. Try ⋯ › Your part.')
  assert.equal(text(hintScore(['Melody 2', 1], ['Piano', 2])), 'Melody 2 with a piano accompaniment. Try ⋯ › Your part.', 'the one-staff part\'s own name')
  assert.equal(text(hintScore(['Piano', 2])), 'A piano piece. Take one hand in ⋯ › Your part, and the app plays the other.')
  assert.equal(text(hintScore(['Melody 1', 1], ['Melody 2', 1])), '2 parts: Melody 1, Melody 2. Choose yours in ⋯ › Your part.')
  assert.equal(text(hintScore(['Melody 1', 1], ['Melody 2', 1], ['Melody 3', 1])), '3 parts: Melody 1, Melody 2, Melody 3. Choose yours in ⋯ › Your part.')
  assert.equal(text(hintScore(['Melody 1', 1], ['Melody 2', 1], ['Piano', 2])), 'Melody 1, Melody 2, Piano. Choose your part in ⋯ › Your part.')
  assert.equal(text(hintScore(['Piano', 2], ['Piano', 2])), 'Piano, Piano. Choose your part in ⋯ › Your part.')
  assert.equal(partsHintOf(hintScore(['Melody', 1])), null, 'one line: no hint')
})

test('instrument for this piece: a clarinet piece in a sax player\'s library (spec "A clarinet piece in a sax player\'s library")', async () => {
  const s = await setup({ instrument: 'tenor-sax' })
  assert.equal(s.session.instrument.id, 'tenor-sax')
  assert.equal(s.session.instrumentChoice.value, null)
  await s.session.setPieceInstrument('clarinet')
  assert.equal(s.session.instrument.id, 'clarinet')
  await s.session.play()
  s.rig.advance(1_000)
  assert.deepEqual(soundsOf(s.rig), ['clarinet'])
  assert.equal(s.rig.notes[0]!.spec.midi[0], writtenOfBar(1) + CLARINET_TRANSPOSE, 'transposed as a B flat clarinet')
  await s.session.close()
  assert.equal((await stored(s))!.instrument, 'clarinet', 'the piece remembers it')
  assert.equal((await s.settings.defaultInstrument.value), 'tenor-sax', 'the default is untouched')

  const again = await PracticeSession.open(s.info.id, s.deps)
  assert.equal(again.instrument.id, 'clarinet', 'opened again: still the clarinet')
  assert.equal(again.instrumentChoice.value, 'clarinet')

  // Another piece, without an instrument of its own: the tenor saxophone.
  const other = await setup({ instrument: 'tenor-sax' })
  await other.session.play()
  other.rig.advance(1_000)
  assert.deepEqual(soundsOf(other.rig), ['tenor-sax'])
  assert.equal(other.rig.notes[0]!.spec.midi[0], concertOfBar(1))
})

const CLARINET_TRANSPOSE = -2

test('instrument for this piece: the default is followed until the user chooses (spec "Default changed later")', async () => {
  const s = await setup({ instrument: 'tenor-sax' })
  await s.settings.setDefaultInstrument('alto-sax')
  assert.equal(s.session.instrument.id, 'alto-sax', 'a session that is open follows it')
  const next = await PracticeSession.open(s.info.id, s.deps)
  assert.equal(next.instrument.id, 'alto-sax', 'and the next one')
  await next.play()
  s.rig.advance(1_000)
  assert.deepEqual(soundsOf(s.rig), ['alto-sax'])

  // Once chosen, the piece keeps its own, whatever the default does; "Your default" goes back to following it.
  await next.setPieceInstrument('clarinet')
  await s.settings.setDefaultInstrument('tenor-sax')
  assert.equal(next.instrument.id, 'clarinet')
  await next.setPieceInstrument(null)
  assert.equal(next.instrument.id, 'tenor-sax')
  assert.equal(next.instrumentChoice.value, null)
  await next.save()
  assert.equal((await stored(s))!.instrument, null)
  await s.settings.setDefaultInstrument('alto-sax')
  assert.equal(next.instrument.id, 'alto-sax')
})

test('instrument for this piece: the melody sounds as the instrument, the piano part as piano, at once, also while playing', async () => {
  const s = await melodyPiano({ instrument: 'tenor-sax' })
  await s.session.play()
  s.rig.advance(500)
  assert.deepEqual(soundsOf(s.rig), ['piano', 'tenor-sax'])
  const heard = s.rig.notes.length
  await s.session.setPieceInstrument('clarinet')
  s.rig.advance(10_000)
  assert.deepEqual(soundsOf(s.rig, heard), ['clarinet', 'piano'], 'what comes after it is the clarinet and the piano')
  const piano = s.rig.notes.find((x) => x.spec.sound === 'piano')!
  assert.ok(piano.spec.midi.every((m) => m >= 36), 'the piano at written pitch (C3 and up), not transposed')
})

test('your part: another part is drawn and played, what plays along is cleared and your line is on (spec "Switch to the piano")', async () => {
  const s = await melodyPiano({ practice: { part: { id: 'P1' }, silent: ['P2'], ownLine: false } })
  assert.deepEqual(s.session.part.value, { id: 'P1' })
  assert.deepEqual(s.session.silent.value, ['P2'])
  assert.equal(s.session.ownLine.value, false)

  s.session.setPart({ id: 'P2' })
  assert.deepEqual(s.session.part.value, { id: 'P2' })
  assert.deepEqual(s.session.silent.value, [], 'what was switched off plays along again')
  assert.equal(s.session.ownLine.value, true)
  assert.equal(s.session.player.ownLine, true)
  await s.session.play()
  s.rig.advance(500)
  assert.deepEqual(soundsOf(s.rig), ['piano', 'tenor-sax'], 'the melody plays along now')
  const events = s.session.player.timeline!.events
  assert.ok(events.filter((e) => e.own).every((e) => e.voice.part === 'P2'), 'the cursor follows the piano')

  s.session.setPart({ id: 'P2', hand: 'left' })
  await settle()
  assert.ok(s.session.player.timeline!.events.filter((e) => e.own).every((e) => e.voice.part === 'P2' && e.voice.staff === 1), 'the left hand only')
  await s.session.save()
  assert.deepEqual(await stored(s), { ...DEFAULT_PRACTICE, tempo: 120, part: { id: 'P2', hand: 'left' }, silent: [], ownLine: true, partsHintSeen: true })
  s.session.setPart({ id: 'P2', hand: 'left' })
  assert.equal(s.log.writes.length, 1, 'the same part again changes nothing')
})

test('your part: a hand is only for a two-staff part, and a part the score does not have is the first part', async () => {
  const s = await melodyPiano({ practice: { part: { id: 'P9' } } })
  assert.deepEqual(s.session.part.value, { id: 'P1' })
  s.session.setPart({ id: 'P1', hand: 'left' })
  assert.deepEqual(s.session.part.value, { id: 'P1' }, 'a melody has no hands')
})

test('plays along: switching the piano off leaves only your line; heard at once while playing, and on again from the next note (spec "Practise without the accompaniment")', async () => {
  const s = await melodyPiano()
  await s.session.play()
  s.rig.advance(500)
  assert.deepEqual(soundsOf(s.rig), ['piano', 'tenor-sax'])
  s.session.setPlaysAlong('P2', false)
  await settle()
  s.rig.advance(0)
  assert.deepEqual(s.session.silent.value, ['P2'])
  assert.ok(s.session.player.timeline!.events.every((e) => e.voice.part === 'P1'), 'only the melody is in the scheduled notes')
  const heard = s.rig.notes.length
  s.rig.advance(14_000)
  assert.deepEqual(soundsOf(s.rig, heard), ['tenor-sax'], 'no piano from then on')

  // Remembered for the piece, and switched on again, also while playing: the piano is back with the next notes.
  await s.session.save()
  await settle()
  assert.deepEqual((await stored(s))!.silent, ['P2'])
  const quiet = s.rig.notes.length
  s.session.setPlaysAlong('P2', true)
  await settle()
  s.rig.advance(3_000)
  assert.deepEqual(soundsOf(s.rig, quiet), ['piano', 'tenor-sax'], 'the piano plays along again')
  assert.deepEqual(s.session.silent.value, [])
})

test('your line on or off: the melody is no longer heard, the piano goes on, the cursor keeps following it, and it comes back from the next note (spec "Play it yourself")', async () => {
  const s = await melodyPiano()
  await s.session.play()
  s.rig.advance(1_000)
  s.session.toggleOwnLine()
  assert.equal(s.session.ownLine.value, false)
  const off = s.rig.ms / 1000
  const before = s.rig.notes.length
  s.rig.advance(5_000)
  const during = s.rig.notes.slice(before).filter((x) => x.spec.when > off + PLAYBACK_TUNING.lookahead + 1e-9 && !x.cancelled)
  assert.ok(during.length > 0)
  assert.deepEqual([...new Set(during.map((x) => x.spec.sound))], ['piano'], 'only the piano')
  const position = s.session.heard()!
  assert.ok(position.events.length > 0 && position.events.every((e) => e.voice.part === 'P1'), 'the cursor still follows the melody')

  s.session.toggleOwnLine()
  const on = s.rig.ms / 1000
  s.rig.advance(5_000)
  assert.ok(s.rig.notes.some((x) => x.spec.sound === 'tenor-sax' && x.spec.when > on), 'heard again')
  await s.session.save()
  await settle()
  assert.equal((await stored(s))!.ownLine, true)
})

test('reopen a piano piece: the left hand, the melody off, your line off and the clarinet are all back (spec "Reopen a piano piece")', async () => {
  const s = await melodyPiano({ practice: { part: { id: 'P2', hand: 'left' }, silent: ['P1'], ownLine: false, instrument: 'clarinet' } })
  const { session } = s
  assert.deepEqual(session.part.value, { id: 'P2', hand: 'left' })
  assert.deepEqual(session.silent.value, ['P1'])
  assert.equal(session.ownLine.value, false)
  assert.equal(session.instrument.id, 'clarinet')
  assert.equal(session.player.ownLine, false)
  await session.play()
  s.rig.advance(2_000)
  assert.deepEqual(soundsOf(s.rig), ['piano'], 'your line off and the melody off: only the right hand is heard')
  assert.ok(session.player.timeline!.events.every((e) => e.voice.part === 'P2'))
  assert.ok(session.player.timeline!.events.filter((e) => e.own).every((e) => e.voice.staff === 1))
})

// ---- Changes while playing, and while the sound loads (review of group 6) -------------------------------------------

/** P1 holds C5 for the bar, P2 plays D5 E5 F5 G5: at 120 bpm a quarter lasts 0.5 s. Pitches tell the notes apart (tenor saxophone, -14). */
const wholeAndQuarters = () =>
  partsXml([
    { id: 'P1', bars: [n({ step: 'C', octave: 5, type: 'whole' })] },
    { id: 'P2', bars: [['D', 'E', 'F', 'G'].map((step) => n({ step, octave: 5 })).join('')] },
  ])
const C5 = 72 - 14
const D5 = 74 - 14
const E5 = 76 - 14
const F5 = 77 - 14
const G5 = 79 - 14

test('switching part while playing carries on from the time reached: no rewind, the sounding notes struck again for what is left', async () => {
  const s = await setup({ xml: wholeAndQuarters(), bars: 1 })
  await s.session.play()
  s.rig.advance(START * 1000 + 1_550) // beat 3.1: the G is sounding
  const mark = s.rig.notes.length
  const swappedAt = s.rig.seconds
  s.session.setPart({ id: 'P2' })
  await settle()
  s.rig.advance(400)
  const after = s.rig.notes.slice(mark).filter((x) => !x.cancelled && x.spec.when >= swappedAt).map((x) => x.spec.midi[0])
  assert.ok(after.includes(G5), 'the G that sounds is struck again')
  assert.ok(after.includes(C5), 'and the whole note still held, for what is left of it')
  for (const old of [D5, E5, F5]) assert.ok(!after.includes(old), 'nothing before the time reached is played again')
  const heard = s.session.heard()!
  assert.ok(heard.beat > 3 && heard.events.every((e) => e.voice.part === 'P2'), 'the cursor is on the new part, at the same place')
})

test('your line on or off while playing does not restart anything', async () => {
  const s = await setup({ xml: wholeAndQuarters(), bars: 1 })
  await s.session.play()
  s.rig.advance(START * 1000 + 1_550)
  const mark = s.rig.notes.length
  s.session.toggleOwnLine()
  await settle()
  s.rig.advance(300)
  assert.equal(s.rig.notes.length, mark, 'no note struck again')
  s.session.toggleOwnLine()
  s.rig.advance(100)
  assert.equal(s.rig.notes.length, mark)
})

test('a part or Plays along change while the sound is loading is not lost', async () => {
  let release: () => void = () => undefined
  const gate = new Promise<void>((resolve) => (release = resolve))
  const s = await setup({
    xml: wholeAndQuarters(),
    bars: 1,
    backend: async () => Object.create(rig.audio, { useSound: { value: async () => gate } }) as AudioBackend,
  })
  const playing = s.session.play()
  await settle()
  assert.equal(s.session.state.value, 'loading')
  s.session.setPart({ id: 'P2' })
  s.session.setPlaysAlong('P1', false)
  release()
  await playing
  const events = s.session.player.timeline!.events
  assert.ok(events.every((e) => e.voice.part === 'P2' && e.own), 'the timeline is for P2, with P1 silent')
  s.rig.advance(START * 1000 + 100)
  assert.ok(s.rig.notes.every((x) => x.spec.midi[0] !== C5), 'the silent part is not heard')
})

test('the default instrument followed while playing: when its sound fails, the old instrument stays in the signal and the player, and the problem is told', async () => {
  const s = await setup({
    instrument: 'tenor-sax',
    backend: async () => Object.create(rig.audio, { useSound: { value: async (sound: string) => { if (sound === 'alto-sax') throw new Error('no sound') } } }) as AudioBackend,
  })
  await s.session.play()
  s.rig.advance(500)
  await s.settings.setDefaultInstrument('alto-sax')
  await settle()
  assert.equal(s.session.instrument.id, 'tenor-sax')
  assert.equal(s.session.player.instrument.id, 'tenor-sax')
  assert.equal(s.session.instrumentProblem.value, true)
})
