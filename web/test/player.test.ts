import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ALTO_SAX, PIANO, TENOR_SAX } from '../src/core/instruments/instruments.ts'
import type { Instrument } from '../src/core/instruments/instruments.ts'
import { Player } from '../src/core/playback/player.ts'
import type { AudioBackend } from '../src/core/playback/player.ts'
import { DYNAMIC_GAIN } from '../src/core/playback/timeline.ts'
import { PLAYBACK_TUNING } from '../src/core/playback/scheduler.ts'
import type { ClickSpec, NoteOnSpec, TimerApi, VoiceHandle } from '../src/core/playback/scheduler.ts'
import { parseMusicXml } from '../src/core/score/musicxml.ts'
import { notesOf } from '../src/core/score/model.ts'
import { frac } from '../src/core/score/rational.ts'
import type { Score } from '../src/core/score/model.ts'
import { dyn, n, scoreOf, scoreXml, wedge } from './playbackHelpers.ts'
import { MELODY_PIANO_FIXTURE, firstLine, read } from './helpers.ts'

function backend() {
  const clock = { currentTime: 0 }
  const played: NoteOnSpec[] = []
  const audio: AudioBackend = {
    get currentTime() {
      return clock.currentTime
    },
    output: {
      noteOn(spec): VoiceHandle {
        played.push(spec)
        return { release() {}, cancel() {} }
      },
    },
  }
  const timer: TimerApi = { set: () => 1, clear() {} }
  return { audio, played, clock, timer }
}

// 10.5: playback reads the current score at the moment Play is pressed

test('player: a note changed in the model is heard changed on the next play', async () => {
  const b = backend()
  const score = scoreOf([{ body: n({ step: 'G', octave: 4, id: 'n1' }) + n({ step: 'A', octave: 4, id: 'n2' }) }])
  let loads = 0
  const player = new Player({
    instrument: TENOR_SAX,
    loadScore: () => {
      loads++
      return score
    },
    backend: async () => b.audio,
    timer: b.timer,
  })
  await player.play()
  assert.deepEqual(b.played[0]!.midi, [53], 'written G4 sounds as concert F3')
  player.stop()

  // The user corrects the first note to B4; the next play must use it.
  const first = notesOf(firstLine(score).measures[0]!)[0]!
  first.pitch = { step: 'B', octave: 4 }
  b.played.length = 0
  b.clock.currentTime = 10
  await player.play()
  assert.deepEqual(b.played[0]!.midi, [57], 'written B4 sounds as concert A3')
  assert.equal(loads, 2, 'the score is loaded again on every play, not cached')
})

test('player: the instrument in use decides the sounding pitch; the score stays as written', async () => {
  const score = scoreOf([{ body: n({ step: 'G', octave: 4, id: 'n1' }) }])
  const written = structuredClone(score)
  const heard: Record<string, number[]> = {}
  for (const instrument of [TENOR_SAX, ALTO_SAX, PIANO]) {
    const b = backend()
    const player = new Player({ instrument, loadScore: () => score, backend: async () => b.audio, timer: b.timer })
    await player.play()
    heard[instrument.id] = b.played[0]!.midi
    player.stop()
  }
  assert.deepEqual(heard, { 'tenor-sax': [53], 'alto-sax': [58], piano: [67] })
  assert.deepEqual(score, written)
})

test('player: the score is re-read from the stored MusicXML (the way the app loads it)', async () => {
  const b = backend()
  let stored = scoreXml([{ body: n({ step: 'C', octave: 5 }) }])
  const player = new Player({ instrument: TENOR_SAX, loadScore: () => parseMusicXml(stored), backend: async () => b.audio, timer: b.timer })
  await player.play()
  assert.deepEqual(b.played[0]!.midi, [72 - 14]) // written C5 = 72, minus 14
  player.stop()
  stored = scoreXml([{ body: n({ step: 'D', octave: 5 }) }])
  b.played.length = 0
  await player.play()
  assert.deepEqual(b.played[0]!.midi, [74 - 14])
})

test('player: states, tempo kept across plays, and tap-to-seek start', async () => {
  const b = backend()
  const states: string[] = []
  const player = new Player({
    instrument: TENOR_SAX,
    loadScore: () => scoreOf([{ body: n({ step: 'C', id: 'a' }) + n({ step: 'D', id: 'b' }) }]),
    backend: async () => b.audio,
    timer: b.timer,
    onState: (s) => states.push(s),
  })
  player.setTempo(500)
  assert.equal(player.bpm, 200)
  player.setTempo(96)
  await player.play({ fromNoteId: 'b' })
  assert.deepEqual(states, ['loading', 'playing'])
  assert.equal(player.currentScheduler?.bpm, 96)
  assert.deepEqual(b.played[0]!.midi, [62 - 14]) // D4 written, concert C3 (48)
  player.stop()
  assert.equal(player.state, 'stopped')
})

// --- a player on a ticking fake clock (task group 5) ---

const START = PLAYBACK_TUNING.startDelay
const close = (a: number, b: number, msg?: string): void => assert.ok(Math.abs(a - b) < 1e-6, msg ?? `${a} vs ${b}`)
/** Lets pending promises settle (a turn of the event loop). */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

/** An audio backend whose clock the test advances in 25 ms steps, and whose sound loads when the test says so. */
function ticking(options: { gateSounds?: boolean } = {}) {
  const clock = { currentTime: 0 }
  let tick: (() => void) | undefined
  const timer: TimerApi = { set: (fn) => ((tick = fn), 1), clear: () => (tick = undefined) }
  const notes: NoteOnSpec[] = []
  const clicks: ClickSpec[] = []
  /** The clicks that were taken back before they sounded. */
  const cancelled = new Set<ClickSpec>()
  const sounds: string[] = []
  const pitchReferences: number[] = []
  const gates: { sound: string; open: () => void; fail: (e: Error) => void }[] = []
  const made: Instrument[] = []
  const audio: AudioBackend = {
    get currentTime() {
      return clock.currentTime
    },
    output: {
      noteOn(spec): VoiceHandle {
        notes.push(spec)
        return { release() {}, cancel() {} }
      },
      click: (spec) => {
        clicks.push(spec)
        return { cancel: () => void cancelled.add(spec) }
      },
    },
    useSound(sound) {
      sounds.push(sound)
      if (!options.gateSounds) return Promise.resolve()
      return new Promise<void>((resolve, reject) => gates.push({ sound, open: resolve, fail: reject }))
    },
    setPitchReference: (hz) => void pitchReferences.push(hz),
  }
  const run = (seconds: number): void => {
    for (let i = 0; i < Math.round(seconds / 0.025); i++) {
      clock.currentTime = Math.round((clock.currentTime + 0.025) * 1e6) / 1e6
      tick?.()
    }
  }
  const player = (instrument: Instrument, score: Score | (() => Score), extra: Partial<ConstructorParameters<typeof Player>[0]> = {}) =>
    new Player({
      instrument,
      loadScore: typeof score === 'function' ? score : () => score,
      backend: async (i) => (made.push(i), audio),
      timer,
      bpm: 120,
      ...extra,
    })
  /** The clicks that have sounded: their time has come and they were not taken back. */
  const heardClicks = (): ClickSpec[] => clicks.filter((c) => !cancelled.has(c) && c.when <= clock.currentTime + 1e-9)
  return { clock, notes, clicks, cancelled, heardClicks, sounds, pitchReferences, gates, made, audio, run, player, timerRunning: () => tick !== undefined }
}

const melody = (): Score => scoreOf([{ body: ['C', 'D', 'E', 'F'].map((step) => n({ step })).join('') }, { body: ['G', 'A', 'B', 'C'].map((step) => n({ step, octave: step === 'C' ? 5 : 4 })).join('') }])

// 5.3: fermata, accent, crescendo through the player

test('player: a quarter note with a fermata at 60 bpm sounds for about two seconds, and the next note follows after it', async () => {
  const t = ticking()
  const score = scoreOf([{ body: n({ step: 'C', id: 'a' }) + n({ step: 'D', fermata: true, id: 'b' }) + n({ step: 'E', id: 'c' }) }])
  const player = t.player(TENOR_SAX, score, { bpm: 60 })
  await player.play()
  t.run(3.6)
  assert.equal(t.notes.length, 3)
  const [a, b, c] = t.notes.map((x) => x.when)
  close(b! - a!, 1, 'the quarter before it: 1 s')
  close(c! - b!, 2, 'the held quarter: 2 s, then the next note')
  // The cursor is in sync with that: the held note is the one heard for 2 s.
  const p = (at: number) => {
    t.clock.currentTime = at
    return player.positionNow(0)?.event?.noteIds[0]
  }
  assert.equal(p(START + 1.1), 'b')
  assert.equal(p(START + 2.9), 'b', 'still the held note 1.9 s into it')
  assert.equal(p(START + 3.1), 'c')
})

test('player: an accented note is louder than the notes next to it at the same dynamic', async () => {
  const t = ticking()
  const score = scoreOf([{ body: n({ step: 'C' }) + n({ step: 'D', accent: true }) + n({ step: 'E' }) + n({ step: 'F' }) }])
  await t.player(TENOR_SAX, score).play()
  t.run(3)
  const [a, b, c, d] = t.notes
  const attack = (x: NoteOnSpec): number => x.accent?.gain ?? x.gain
  assert.equal(a!.gain, b!.gain, 'the same dynamic')
  assert.ok(attack(b!) > attack(a!) * 1.4 && attack(b!) > attack(c!) * 1.4, 'the attack of the accent is clearly louder (about 4 dB)')
  assert.equal(attack(c!), attack(d!))
  assert.equal(b!.accent!.decay, 0.15, 'back to the level within 150 ms')
})

test('player: an accent at f, ff and fff never pushes the attack gain above full scale', async () => {
  const t = ticking()
  const score = scoreOf([
    { body: dyn('mf') + n({ step: 'C', accent: true }) + dyn('f') + n({ step: 'D', accent: true }) + dyn('ff') + n({ step: 'E', accent: true }) + dyn('fff') + n({ step: 'F', accent: true }) },
    { body: dyn('sfz') + n({ step: 'G', accent: true }) + n({ step: 'A' }) + n({ step: 'B' }) + n({ step: 'C' }) },
  ])
  await t.player(TENOR_SAX, score).play()
  t.run(6)
  assert.equal(t.notes.length, 8)
  const attacks = t.notes.map((x) => x.accent?.gain ?? x.gain)
  assert.ok(attacks.every((a) => a <= 1), `no attack above 1: ${attacks.join(', ')}`)
  const [mf, f, ff, fff, sfz] = t.notes
  assert.ok(Math.abs(mf!.accent!.gain - 0.6 * 10 ** (4 / 20)) < 1e-9, 'at mf the accent is still +4 dB')
  assert.equal(f!.accent!.gain, 1, 'f: 0.78 raised by 4 dB would be 1.24, so it stops at 1')
  assert.equal(ff!.accent!.gain, 1)
  assert.equal(fff!.accent!.gain, 1, 'fff is full scale already: the accent has no room left')
  assert.ok(f!.accent!.gain >= f!.gain && ff!.accent!.gain >= ff!.gain && fff!.accent!.gain >= fff!.gain, 'and never below the level')
  assert.equal(sfz!.accent!.gain, 1)
})

test('player: under a crescendo each of four notes is louder than the one before, and f sounds as f', async () => {
  const t = ticking()
  const score = scoreOf([
    { body: dyn('mf') + wedge('crescendo') + ['C', 'D', 'E', 'F'].map((step) => n({ step })).join('') + wedge('stop') },
    { body: dyn('f') + n({ step: 'G', type: 'whole' }) },
  ])
  await t.player(TENOR_SAX, score).play()
  t.run(4)
  const g = t.notes.map((x) => x.gain)
  assert.equal(g.length, 5)
  assert.ok(g.slice(0, 4).every((x, i) => i === 0 || x > g[i - 1]!), `rising note by note: ${g}`)
  assert.equal(g[0], DYNAMIC_GAIN.mf)
  assert.equal(g[4], DYNAMIC_GAIN.f)
})

// 5.1 and 5.2 through the player

test('player: the metronome is an option, switched on while playing from the next beat, and off again', async () => {
  const t = ticking()
  const player = t.player(TENOR_SAX, melody())
  assert.equal(player.metronome, false)
  await player.play()
  t.run(0.7)
  assert.equal(t.clicks.length, 0)
  const notes = t.notes.length
  player.setMetronome(true)
  assert.equal(player.metronome, true)
  assert.equal(player.state, 'playing')
  assert.equal(t.notes.length, notes, 'the music was not restarted')
  t.run(1)
  assert.deepEqual(
    t.clicks.map((c) => Math.round((c.when - START) * 1000) / 1000),
    [1, 1.5],
    'from the next beat on (the beat at 0.56 s had gone)',
  )
  player.setMetronome(false)
  t.run(0.2)
  const sounded = t.clicks.length
  t.run(2)
  assert.equal(t.clicks.length, sounded, 'off: no more clicks')
  assert.equal(t.notes.length, 8, 'and the notes were never touched')

  const on = ticking()
  await on.player(TENOR_SAX, melody(), { metronome: true }).play()
  on.run(0.3)
  assert.equal(on.clicks.length, 1, 'a metronome that was on at the start clicks from the first beat')
  assert.equal(on.clicks[0]!.accent, true)
})

test('player: the rest between loop passes is an option, 0, 1 or 2 bars; the count-in is before the first pass only', async () => {
  const t = ticking()
  const bars = scoreOf(['C', 'D', 'E', 'F'].map((step) => ({ body: n({ step, type: 'whole' }) })))
  const player = t.player(TENOR_SAX, bars, { bpm: 60, loop: { start: 1, end: 2 }, loopRest: 1, countIn: true })
  assert.equal(player.loopRest, 1)
  await player.play()
  t.run(40)
  assert.equal(t.clicks.length, 4, 'one bar of count-in, once')
  const d = t.notes.filter((x) => x.midi[0] === 62 - 14).map((x) => x.when)
  const e = t.notes.filter((x) => x.midi[0] === 64 - 14).map((x) => x.when)
  close(d[1]! - (e[0]! + 4), 4, '4 s of silence between bar 3 and bar 2 again')
  assert.equal(player.setLoopRest(7), 2)
  assert.equal(player.setLoopRest(-3), 0)
  assert.equal(player.loopRest, 0)
})

test('player: changing the rest while a loop plays carries on from the note being played', async () => {
  const t = ticking()
  const bars = scoreOf(['C', 'D', 'E', 'F'].map((step) => ({ body: n({ step, type: 'whole' }) })))
  const player = t.player(TENOR_SAX, bars, { bpm: 60, loop: { start: 1, end: 2 } })
  await player.play()
  t.run(5) // in bar 3
  const before = t.notes.length
  player.setLoopRest(1)
  t.run(0.2)
  assert.equal(t.notes[before]!.midi[0], 64 - 14, 'bar 3 (E) goes on')
  t.run(12)
  const d = t.notes.slice(before).filter((x) => x.midi[0] === 62 - 14).map((x) => x.when)
  const e = t.notes.slice(before).filter((x) => x.midi[0] === 64 - 14).map((x) => x.when)
  close(d[0]! - (e[0]! + 4), 4, 'with the rest now in the loop')
})

test('player: in the silence between two passes, pause resumes at the next pass; a changed rest or a cleared loop carries on sensibly', async () => {
  const bars = scoreOf(['C', 'D', 'E', 'F'].map((step) => ({ body: n({ step, type: 'whole' }) })))
  const concertOf = (step: string): number => ({ C: 60, D: 62, E: 64, F: 65 })[step]! - 14

  // Pause in the rest, resume: the next pass starts with bar 2, with no count-in.
  const a = ticking()
  const player = a.player(TENOR_SAX, bars, { bpm: 60, loop: { start: 1, end: 1 }, loopRest: 1, countIn: true })
  await player.play()
  a.run(4 + 4 + 2) // count-in, bar 2, then 2 s into the rest
  assert.equal(player.positionNow(0)?.resting, true)
  player.pause()
  assert.equal(player.state, 'paused')
  const clicks = a.clicks.length
  a.notes.length = 0
  await player.play()
  a.run(1)
  assert.equal(a.notes[0]!.midi[0], concertOf('D'), 'bar 2 sounds first on resume')
  assert.equal(a.clicks.length, clicks, 'no count-in on resume')

  // A longer rest chosen in the silence starts the loop again from its first bar, with the new rest.
  const b = ticking()
  const p2 = b.player(TENOR_SAX, bars, { bpm: 60, loop: { start: 1, end: 1 }, loopRest: 1 })
  await p2.play()
  b.run(6) // bar 2 ended at 4 s: 2 s into the rest
  const before = b.notes.length
  p2.setLoopRest(2)
  b.run(0.2)
  assert.equal(b.notes[before]!.midi[0], concertOf('D'), 'the loop starts again at bar 2')
  b.run(20)
  const d = b.notes.slice(before).map((x) => x.when)
  close(d[1]! - d[0]!, 4 + 8, 'a pass is now one bar of music and two of rest')

  // The loop cleared in the silence: the music goes on after the loop (bar 3).
  const c = ticking()
  const p3 = c.player(TENOR_SAX, bars, { bpm: 60, loop: { start: 1, end: 1 }, loopRest: 1 })
  await p3.play()
  c.run(6)
  const seen = c.notes.length
  p3.setLoop(undefined)
  c.run(10)
  assert.deepEqual(
    c.notes.slice(seen).map((x) => x.midi[0]),
    [concertOf('E'), concertOf('F')],
    'bars 3 and 4 follow, then the end',
  )
  assert.equal(p3.state, 'stopped')
})

test('player: tempo changes in the silence between passes (several in a row, metronome on) keep the rest; a pause after them resumes at the next pass', async () => {
  const t = ticking()
  const bars = scoreOf(['C', 'D', 'E', 'F'].map((step) => ({ body: n({ step, type: 'whole' }) })))
  const player = t.player(TENOR_SAX, bars, { bpm: 60, loop: { start: 1, end: 1 }, loopRest: 1, metronome: true })
  await player.play()
  t.run(4 + 2) // from bar 2 (4 s), then 2 s into its rest
  assert.equal(player.positionNow(0)?.resting, true)
  const notes = t.notes.length
  player.setTempo(80)
  player.setTempo(100)
  player.setTempo(60)
  assert.equal(player.state, 'playing')
  assert.equal(player.positionNow(0)?.resting, true, 'still in the rest')
  assert.equal(t.notes.length, notes, 'nothing started again')
  t.run(0.5)
  player.pause()
  assert.equal(player.state, 'paused')
  t.notes.length = 0
  await player.play()
  t.run(0.5)
  assert.equal(t.notes[0]!.midi[0], 62 - 14, 'the next pass: bar 2')
})

// 5.4 pitch reference and instrument

test('player: the pitch reference is 430-450 Hz, 440 by default, and the backend gets it before the first note and when it changes', async () => {
  const t = ticking()
  const player = t.player(TENOR_SAX, melody(), { pitchReference: 442 })
  assert.equal(player.pitchReference, 442)
  assert.equal(ticking().player(TENOR_SAX, melody()).pitchReference, 440)
  await player.play()
  assert.deepEqual(t.pitchReferences, [442])
  assert.equal(player.setPitchReference(444), 444)
  assert.deepEqual(t.pitchReferences, [442, 444])
  assert.equal(player.setPitchReference(420), 430)
  assert.equal(player.setPitchReference(460), 450)
  assert.equal(player.setPitchReference(441.6), 442)
  assert.equal(player.state, 'playing', 'tuning does not stop the music')
})

test('player: the backend is made for the instrument in use, and the sample folder of an instrument is asked for by its sound', async () => {
  const t = ticking()
  const player = t.player(PIANO, melody())
  await player.play()
  assert.deepEqual(t.made, [PIANO])
  assert.deepEqual(t.sounds, ['piano'])
})

test('player: switching instrument while playing keeps playing and keeps the position; the notes to come are the new instrument\'s', async () => {
  const t = ticking({ gateSounds: true })
  const score = melody()
  const written = structuredClone(score)
  const player = t.player(TENOR_SAX, score)
  const started = player.play()
  await flush()
  t.gates[0]!.open() // the first sound loads
  await started
  assert.deepEqual(t.sounds, ['tenor-sax'])
  t.run(1.2) // notes C D E have started, at 0.06, 0.56 and 1.06 s
  assert.equal(t.notes.length, 3)
  const where = player.positionNow(0)!
  assert.equal(where.event?.index, 2)
  const states: string[] = []
  const timelineBefore = player.timeline

  const switched = player.setInstrument(PIANO)
  assert.deepEqual(t.sounds, ['tenor-sax', 'piano'], 'the piano set is asked for')
  assert.equal(player.instrument, PIANO)
  t.run(0.1) // the piano set is still loading: the music goes on in the old sound
  assert.equal(player.state, 'playing')
  assert.equal(player.timeline, timelineBefore, 'the old timeline is still the one playing')
  t.gates[1]!.open()
  await switched
  states.push(player.state)
  assert.deepEqual(states, ['playing'], 'still playing, not stopped or loading')
  assert.equal(t.notes.length, 3, 'no note was started again by the switch')
  const here = player.positionNow(0)!
  assert.equal(here.event?.index, 2, 'the same note is sounding')
  assert.ok(Math.abs(here.beat - (where.beat + (0.1 / 0.5))) < 1e-9, 'and the position went on by the time that passed, as if nothing happened')

  t.run(3)
  assert.equal(t.notes.length, 8)
  assert.deepEqual(
    t.notes.map((x) => x.midi[0]),
    [60 - 14, 62 - 14, 64 - 14, 65, 67, 69, 71, 72],
    'C D E from the tenor; F G A B C from the piano (concert = written)',
  )
  t.notes.forEach((x, k) => close(x.when, START + k * 0.5, `note ${k} at its original time`))
  assert.equal(player.timeline?.events[0]?.pitches[0], 60, 'the timeline is the piano\'s now')
  assert.deepEqual(score, written, 'the written notes did not change')
})

test('player: a switch while playing is dropped when the music is paused meanwhile, and the next play uses the instrument in use', async () => {
  const t = ticking({ gateSounds: true })
  const player = t.player(TENOR_SAX, melody())
  const started = player.play()
  await flush()
  t.gates[0]!.open()
  await started
  t.run(0.7)
  const switched = player.setInstrument(ALTO_SAX)
  player.pause()
  t.gates[1]!.open()
  await switched
  assert.equal(player.state, 'paused')
  t.notes.length = 0
  const resumed = player.play()
  await flush()
  t.gates[2]?.open()
  await resumed
  t.run(1)
  assert.deepEqual(t.sounds.slice(-1), ['alto-sax'], 'the alto set is asked for on Play')
  assert.equal(t.notes[0]!.midi[0], 62 - 9, 'the note heard when paused (D) sounds on resume, as an alto')
})

test('player: of two quick switches the last one wins, even when the first sound arrives last', async () => {
  const t = ticking({ gateSounds: true })
  const player = t.player(TENOR_SAX, melody())
  const started = player.play()
  await flush()
  t.gates[0]!.open()
  await started
  t.run(0.7)
  const a = player.setInstrument(ALTO_SAX)
  const b = player.setInstrument(PIANO)
  t.gates[2]!.open() // the piano set is here first
  await b
  t.gates[1]!.open() // then the alto set
  await a
  assert.equal(player.instrument, PIANO)
  t.run(3)
  assert.equal(t.notes.at(-1)!.midi[0], 72, 'the music ends as the piano (written C5 = 72)')
  assert.deepEqual(
    t.notes.slice(2).map((x) => x.midi[0]),
    [64, 65, 67, 69, 71, 72],
    'every note after the switch is the piano (concert = written), none the alto',
  )
})

test('player: a sound that cannot be loaded leaves the instrument and the music as they were', async () => {
  const t = ticking({ gateSounds: true })
  const player = t.player(TENOR_SAX, melody())
  const started = player.play()
  await flush()
  t.gates[0]!.open()
  await started
  t.run(0.7)
  const switched = player.setInstrument(PIANO)
  t.gates[1]!.fail(new Error('sample map not found (404)'))
  await assert.rejects(switched, /sample map not found/)
  assert.equal(player.instrument, TENOR_SAX)
  assert.equal(player.state, 'playing')
  t.run(3)
  assert.equal(t.notes.length, 8)
  assert.ok(t.notes.every((x, k) => x.midi[0] === [60, 62, 64, 65, 67, 69, 71, 72][k]! - 14), 'still the tenor')
})

test('player: switching instrument while stopped changes the next Play only', async () => {
  const t = ticking()
  const player = t.player(TENOR_SAX, melody())
  await player.setInstrument(PIANO)
  assert.equal(player.instrument, PIANO)
  assert.deepEqual(t.sounds, [], 'nothing is loaded before Play')
  await player.play()
  t.run(0.3)
  assert.deepEqual(t.made, [PIANO], 'the backend is made for the piano')
  assert.equal(t.notes[0]!.midi[0], 60)
  await player.setInstrument(PIANO) // the same instrument: nothing to do
  assert.deepEqual(t.sounds, ['piano'])
})

// --- the metronome on its own (change steady-notes-and-free-metronome, task 1.2) ---

/** Seconds from START, to the millisecond, for reading click times. */
const at = (c: ClickSpec): number => Math.round((c.when - START) * 1000) / 1000

/** Bar 1 in 4/4, bar 2 in 3/4 (its first note is `b2`), bar 3 in 3/4 again. */
const changingMeter = (): Score =>
  parseMusicXml(
    scoreXml([
      { body: ['C', 'D', 'E', 'F'].map((step, k) => n({ step, id: `a${k}` })).join('') },
      { body: '<attributes><time><beats>3</beats><beat-type>4</beat-type></time></attributes>' + n({ step: 'G', id: 'b2' }) + n({ step: 'A' }) + n({ step: 'B' }) },
      { body: ['C', 'D', 'E'].map((step) => n({ step })).join('') },
    ]),
  )

test('player: the metronome switched on while stopped clicks on its own at the tempo, every fourth accented in 4/4, and plays no notes (spec "Metronome without the music")', async () => {
  const t = ticking()
  const sounding: boolean[] = []
  const states: string[] = []
  const player = t.player(TENOR_SAX, melody(), { bpm: 80, onMetronomeAlone: (on) => sounding.push(on), onState: (s) => states.push(s) })
  const switched = player.setMetronome(true)
  assert.equal(t.made.length, 1, 'the backend is asked for in the press itself (it can be the first gesture)')
  await switched
  assert.equal(player.metronomeAlone, true)
  assert.deepEqual(sounding, [true])
  assert.equal(player.state, 'stopped', 'not a state of its own: the Play button stays Play')
  t.run(6)
  const heard = t.heardClicks()
  assert.equal(heard.length, 8, '80 bpm: a click every 0.75 s')
  heard.forEach((c, k) => close(c.when, START + k * 0.75, `click ${k}`))
  assert.deepEqual(
    heard.map((c) => c.accent),
    [true, false, false, false, true, false, false, false],
  )
  assert.equal(t.notes.length, 0, 'no notes')
  assert.deepEqual(t.sounds, [], 'and no instrument sound is asked for')

  await player.setMetronome(false)
  assert.equal(player.metronomeAlone, false)
  assert.deepEqual(sounding, [true, false])
  const handed = t.clicks.length
  t.run(3)
  assert.equal(t.clicks.length, handed, 'off: no more clicks')
  assert.equal(t.timerRunning(), false, 'and its timer is gone')
  assert.deepEqual(states, [], 'the state never changed: no loading, no playing')
})

test('player: a player made with the metronome on stays silent until it is switched on, and does not make a backend (spec "Reopen with the metronome on")', async () => {
  const t = ticking()
  const player = t.player(TENOR_SAX, melody(), { metronome: true })
  assert.equal(player.metronome, true)
  t.run(3)
  assert.equal(player.metronomeAlone, false)
  assert.deepEqual(t.clicks, [])
  assert.deepEqual(t.made, [], 'nothing is made before a gesture')
  await player.setMetronome(true) // on again (the switch was already on): it sounds now
  t.run(1)
  assert.equal(player.metronomeAlone, true)
  assert.ok(t.heardClicks().length > 0)
  await player.setMetronome(true)
  t.run(1)
  const times = t.heardClicks().map(at)
  assert.deepEqual(times, [...new Set(times)], 'switched on twice: one metronome, not two on top of each other')
})

test('player: the beats of the bar on its own come from the bar Play would start from: the tapped note, else the loop, else the first bar', async () => {
  const accents = async (setup: (player: Player) => void): Promise<boolean[]> => {
    const t = ticking()
    const player = t.player(TENOR_SAX, changingMeter(), { bpm: 120 })
    setup(player)
    await player.setMetronome(true)
    t.run(3)
    return t.heardClicks().map((c) => c.accent)
  }
  assert.deepEqual(await accents(() => undefined), [true, false, false, false, true, false], 'bar 1: 4/4')
  assert.deepEqual(await accents((p) => p.seek('b2')), [true, false, false, true, false, false], 'the tapped note is in bar 2: 3/4')
  assert.deepEqual(await accents((p) => p.setLoop({ start: 2, end: 2 })), [true, false, false, true, false, false], 'the loop starts in bar 3: 3/4')
})

test('player: a tempo change reaches the metronome on its own at once (spec "Change the tempo of the metronome on its own")', async () => {
  const t = ticking()
  const player = t.player(TENOR_SAX, melody(), { bpm: 80 })
  await player.setMetronome(true)
  t.run(1.7) // clicks at 0, 0.75, 1.5
  player.setTempo(100)
  t.run(3)
  const heard = t.heardClicks()
  const gaps = heard.slice(1).map((c, k) => Math.round((c.when - heard[k]!.when) * 1000) / 1000)
  assert.deepEqual(gaps.slice(0, 2), [0.75, 0.75])
  assert.ok(gaps.slice(2).every((g) => g === 0.6), `then 100 bpm: ${gaps.join(', ')}`)

  // A new beat unit counts the beat (and the bar) in it: 4/4 in half notes is two clicks a bar.
  player.setBeatUnit(frac(2))
  t.run(0.1)
  const from = t.heardClicks().length
  t.run(5)
  const halves = t.heardClicks().slice(from)
  halves.slice(1).forEach((c, k) => close(c.when - halves[k]!.when, 0.6, `100 half notes a minute: ${k}`))
  assert.deepEqual(
    halves.map((c) => c.accent).slice(0, 4),
    [true, false, true, false],
  )
})

test('player: Play takes over from the metronome on its own, and no click sounds off the grid of the count-in (spec "Play takes over")', async () => {
  const t = ticking()
  const sounding: boolean[] = []
  const player = t.player(TENOR_SAX, melody(), { bpm: 120, countIn: true, onMetronomeAlone: (on) => sounding.push(on) })
  await player.setMetronome(true)
  // Clicks at 0.06, 0.56, 1.06; at 0.975 the one at 1.06 has been handed to the output and has not sounded.
  t.run(0.975)
  const waiting = t.clicks.filter((c) => c.when > t.clock.currentTime)
  assert.equal(waiting.length, 1, 'one click is waiting in the output')
  const pressed = t.clock.currentTime
  await player.play()
  assert.equal(player.metronomeAlone, false)
  assert.deepEqual(sounding, [true, false])
  assert.equal(t.cancelled.has(waiting[0]!), true, 'the waiting click is taken back')
  t.run(4)
  const after = t.heardClicks().filter((c) => c.when >= pressed)
  // A count-in bar (4 clicks), then the metronome with the music: all on one grid, 0.5 s apart.
  const anchor = after[0]!.when
  close(anchor, pressed + START, 'the first click after Play is the count-in, one start delay after the press')
  after.forEach((c, k) => close(c.when, anchor + k * 0.5, `click ${k} on the grid`))
  close(t.notes[0]!.when, anchor + 4 * 0.5, 'the music starts after one bar of count-in')
  assert.deepEqual(
    after.map((c) => c.accent).slice(0, 8),
    [true, false, false, false, true, false, false, false],
  )
})

test('player: pause, stop and the end of the piece stay silent; switched on while paused it sounds, and Play resumes the music', async () => {
  const t = ticking()
  const player = t.player(TENOR_SAX, melody(), { metronome: true })
  await player.play()
  t.run(1.2)
  player.pause()
  assert.equal(player.metronomeAlone, false, 'pausing does not start it')
  let handed = t.clicks.length
  t.run(2)
  assert.equal(t.clicks.length, handed, 'paused: silent')

  await player.setMetronome(true)
  assert.equal(player.state, 'paused')
  assert.equal(player.metronomeAlone, true)
  t.run(1)
  assert.ok(t.clicks.length > handed, 'switched on while paused: it clicks')
  t.notes.length = 0
  await player.play()
  assert.equal(player.metronomeAlone, false)
  t.run(0.2)
  assert.equal(t.notes[0]!.midi[0], 64 - 14, 'the music resumes at the note heard when paused (E)')

  t.run(5)
  assert.equal(player.state, 'stopped', 'the end of the piece')
  assert.equal(player.metronomeAlone, false)
  handed = t.clicks.length
  t.run(2)
  assert.equal(t.clicks.length, handed, 'the end is silent')

  // Stop silences the metronome on its own too.
  await player.setMetronome(false)
  await player.setMetronome(true)
  player.stop()
  assert.equal(player.metronomeAlone, false)
  assert.equal(player.metronome, true, 'the switch stays on')
})

test('player: a backend that cannot be made rejects the switch as a failed Play does; nothing is stuck and the next press tries again', async () => {
  const t = ticking()
  let attempts = 0
  const player = t.player(TENOR_SAX, melody(), {
    backend: async () => {
      attempts++
      if (attempts === 1) throw new Error('no audio')
      return t.audio
    },
  })
  await assert.rejects(player.setMetronome(true), /no audio/)
  assert.equal(player.state, 'stopped')
  assert.equal(player.metronomeAlone, false)
  assert.equal(player.metronome, true, 'the switch stays on; nothing sounds')
  t.run(1)
  assert.deepEqual(t.clicks, [])

  // The next gesture makes a backend again: here Play, which then plays with the metronome.
  await player.play()
  assert.equal(attempts, 2)
  assert.equal(player.state, 'playing')
  t.run(0.3)
  assert.equal(t.clicks.length, 1)
})

test('player: while the backend loads, switching off or pressing Play wins over the switch on', async () => {
  const gated = () => {
    const t = ticking()
    let arrive: (audio: AudioBackend) => void = () => undefined
    let fail: (e: Error) => void = () => undefined
    const player = t.player(TENOR_SAX, melody(), {
      backend: () =>
        new Promise<AudioBackend>((resolve, reject) => {
          arrive = resolve
          fail = reject
        }),
    })
    return { t, player, arrive: () => arrive(t.audio), fail: (e: Error) => fail(e) }
  }

  // Off before it arrived: nothing sounds when it arrives.
  const off = gated()
  const on = off.player.setMetronome(true)
  await off.player.setMetronome(false)
  off.arrive()
  await on
  off.t.run(2)
  assert.deepEqual(off.t.clicks, [])
  assert.equal(off.player.metronomeAlone, false)

  // Play while it loads: the music starts (with its metronome), the metronome on its own never does.
  const play = ticking()
  const sounding: boolean[] = []
  const p = play.player(TENOR_SAX, melody(), {
    onMetronomeAlone: (s) => sounding.push(s),
    backend: () => new Promise<AudioBackend>((resolve) => setTimeout(() => resolve(play.audio), 0)),
  })
  const switched = p.setMetronome(true)
  const playing = p.play()
  assert.equal(p.state, 'loading')
  await Promise.all([switched, playing])
  assert.equal(p.state, 'playing')
  assert.deepEqual(sounding, [], 'never on its own')
  play.run(2)
  const heard = play.heardClicks()
  heard.forEach((c, k) => close(c.when, START + k * 0.5, `click ${k}: with the music`))
  assert.equal(heard.length, 4)

  // A load that fails after the switch was turned off rejects nobody.
  const late = gated()
  const pending = late.player.setMetronome(true)
  await late.player.setMetronome(false)
  late.fail(new Error('no audio'))
  await pending
  assert.equal(late.player.state, 'stopped')
})

test('player: a beat unit made shorter while the metronome sounds on its own gives no stray click, and the next click starts a bar', async () => {
  const t = ticking()
  const player = t.player(TENOR_SAX, melody(), { bpm: 100, beatUnit: frac(2) }) // 100 half notes a minute: 0.6 s, two a bar
  await player.setMetronome(true)
  t.run(1.5) // clicks at 0, 0.6, 1.2 (beats 0, 1, 2: accented, not, accented)
  t.run(0.35) // 0.35 s after the last click: more than half of a quarter at 100
  const from = t.clicks.length
  player.setBeatUnit(frac(1)) // 100 quarters a minute: 0.6 s again, four a bar
  t.run(3)
  const next = t.heardClicks().filter((c) => t.clicks.indexOf(c) >= from)
  close(next[0]!.when, START + 1.2 + 0.6, 'the next click one new beat after the last one, no click in between')
  next.slice(1).forEach((c, k) => close(c.when - next[k]!.when, 0.6, `gap ${k}`))
  assert.deepEqual(
    next.map((c) => c.accent).slice(0, 5),
    [true, false, false, false, true],
    'a new bar: four quarters, the first accented',
  )
})

// A run that sounds is one the player owns: the music never plays on while the screen cannot follow it.

test('player: a note the output cannot start is left out; the loop plays on and the heard position follows it', async () => {
  const t = ticking()
  const bars = scoreOf(['C', 'D', 'E', 'F'].map((step) => ({ body: n({ step, type: 'whole' }) })))
  const output = t.audio.output
  let failed = 0
  const noteOn = output.noteOn.bind(output)
  output.noteOn = (spec) => {
    if (failed++ === 0) throw new Error('the output could not start this note')
    return noteOn(spec)
  }
  const errors: unknown[] = []
  const consoleError = console.error
  console.error = (...args: unknown[]) => void errors.push(args)
  try {
    const player = t.player(TENOR_SAX, bars, { bpm: 60, loop: { start: 1, end: 2 } })
    await player.play() // the first note of the run (bar 2) fails, on the first tick
    assert.equal(player.state, 'playing')
    t.run(2)
    assert.equal(player.positionNow(0)?.event?.barIndex, 1, 'bar 2 is heard (its note left out)')
    t.run(4)
    assert.equal(player.positionNow(0)?.event?.barIndex, 2, 'then bar 3')
    t.run(4)
    assert.equal(player.positionNow(0)?.event?.barIndex, 1, 'the second pass: bar 2 again')
    assert.deepEqual(t.notes.map((x) => x.midi[0]! + 14), [64, 62], 'bar 3, then the next pass sounds')
    assert.equal(errors.length, 1, 'the failure is logged once')
  } finally {
    console.error = consoleError
  }
})

test('player: a listener that pauses as Play starts leaves nothing sounding', async () => {
  const t = ticking()
  let player!: Player
  player = t.player(TENOR_SAX, melody(), {
    onState: (state) => {
      if (state === 'playing') player.pause()
    },
  })
  await player.play()
  assert.equal(player.state, 'paused')
  t.run(5)
  assert.equal(t.notes.length, 0, 'the run that was paused never sounds')
  assert.equal(t.timerRunning(), false)
})

// ---------------------------------------------------------------------------------------------------
// Parts and accompaniment (change parts-and-accompaniment, group 4)
// ---------------------------------------------------------------------------------------------------

const melodyPianoScore = (): Score => parseMusicXml(read(MELODY_PIANO_FIXTURE))

test('player (parts): the sound of the other instruments is loaded once, the instrument in use last, and every note is played with its own', async () => {
  const t = ticking()
  const player = t.player(TENOR_SAX, melodyPianoScore())
  await player.play()
  assert.deepEqual(t.made, [TENOR_SAX], 'one backend, made for the instrument in use')
  assert.deepEqual(t.sounds, ['piano', 'tenor-sax'], 'the piano part needs the piano; the instrument in use is last, so it is what plain notes play from')
  t.run(2)
  const bySound = (sound: string) => t.notes.filter((x) => x.sound === sound)
  assert.deepEqual(bySound('tenor-sax')[0]!.midi, [53])
  assert.deepEqual(bySound('piano')[0]!.midi, [60, 64, 67])
  player.stop()
  // The next Play does not ask for anything twice in one press, and a one-line piece asks for its own sound only.
  const one = ticking()
  await one.player(TENOR_SAX, scoreOf([{ body: n({}) }])).play()
  assert.deepEqual(one.sounds, ['tenor-sax'])
})

test('player (parts): a silent part is not loaded and not played', async () => {
  const t = ticking()
  const player = t.player(TENOR_SAX, melodyPianoScore(), { silent: ['P2'] })
  await player.play()
  t.run(2)
  assert.deepEqual(t.sounds, ['tenor-sax'])
  assert.deepEqual([...new Set(t.notes.map((x) => x.sound))], ['tenor-sax'])
})

test('player (parts): turning your line off while playing stops its notes from the next event and leaves the piano; on again brings it back', async () => {
  const t = ticking()
  const player = t.player(TENOR_SAX, melodyPianoScore(), { ownLine: true })
  await player.play()
  t.run(1.2)
  const before = t.notes.length
  player.setOwnLine(false)
  assert.equal(player.ownLine, false)
  t.run(2.2)
  const meanwhile = t.notes.slice(before)
  assert.ok(meanwhile.some((x) => x.sound === 'piano'), 'the piano goes on')
  // Only what was handed out within the lookahead window when it was switched off can still sound.
  assert.ok(meanwhile.filter((x) => x.sound === 'tenor-sax' && x.when > t.clock.currentTime - 2.2 + PLAYBACK_TUNING.lookahead + 1e-6).length === 0)
  player.setOwnLine(true)
  const resumed = t.notes.length
  t.run(2)
  assert.ok(t.notes.slice(resumed).some((x) => x.sound === 'tenor-sax'), 'heard again from the next event')
  // The cursor followed the melody all through, sound or not.
  assert.equal(player.positionNow(0)?.events.every((e) => e.own && e.voice.part === 'P1'), true)
})

test('player (parts): a player made with your line off plays only the other parts, and your part and hand are taken from the options', async () => {
  const t = ticking()
  const player = t.player(TENOR_SAX, melodyPianoScore(), { ownLine: false })
  await player.play()
  t.run(2)
  assert.deepEqual([...new Set(t.notes.map((x) => x.sound))], ['piano'])
  player.stop()

  const right = ticking()
  const hand = right.player(TENOR_SAX, melodyPianoScore(), { part: { id: 'P2', hand: 'right' } })
  await hand.play()
  right.run(0.5)
  const events = hand.positionNow(0)!.events
  assert.deepEqual(events.map((e) => [e.voice.part, e.voice.staff]), [['P2', 0]], 'the cursor follows the right hand only')
  assert.ok(hand.timeline!.events.some((e) => e.voice.staff === 1 && !e.own), 'the left hand plays along')
  assert.ok(right.notes.some((x) => x.midi[0] === 48), 'and is heard (C3, the left hand)')
})

test('player (parts): an instrument switch after a part was switched off still takes effect', async () => {
  const t = ticking()
  const player = t.player(TENOR_SAX, melodyPianoScore())
  await player.play()
  t.run(0.6)
  player.setSilent(['P2'])
  await player.setInstrument(ALTO_SAX)
  assert.equal(player.instrument, ALTO_SAX)
  const before = t.notes.length
  t.run(2)
  const after = t.notes.slice(before)
  assert.ok(after.length > 0, 'the melody goes on')
  const events = player.timeline!.events
  for (const x of after) {
    assert.equal(x.sound, 'alto-sax', 'the melody is played with the alto saxophone')
    const e = events.find((ev) => ev.pitches.join() === x.midi.join())!
    assert.ok(e, 'a note of the new timeline')
    assert.equal(x.midi[0], e.written[0]! - 9, 'sounding a major sixth below written, as the alto saxophone, not the tenor (a ninth)')
  }
})
