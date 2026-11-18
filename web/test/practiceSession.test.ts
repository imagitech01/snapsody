import assert from 'node:assert/strict'
import { test } from 'node:test'
import { effect } from '@preact/signals'
import { DEFAULT_PRACTICE, LibraryError, createLibrary } from '../src/app/library.ts'
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
import { createFakePlatform } from '../src/platform/fake/index.ts'
import { n, scoreXml } from './playbackHelpers.ts'

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
    musicxml: piecesXml(bars, options.directions),
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
  const noteOfBar = (bar: number): string => notesOf(session.score.measures[bar - 1]!)[0]!.id
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
  assert.equal(session.score.measures.length, 12)
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
