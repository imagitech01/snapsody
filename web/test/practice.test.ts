import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CursorTracker } from '../src/core/playback/cursor.ts'
import { TENOR_SAX } from '../src/core/instruments/instruments.ts'
import { Player } from '../src/core/playback/player.ts'
import type { AudioBackend } from '../src/core/playback/player.ts'
import { Scheduler } from '../src/core/playback/scheduler.ts'
import type { ClickSpec, NoteOnSpec, TimerApi, VoiceHandle } from '../src/core/playback/scheduler.ts'
import { PLAYBACK_TUNING } from '../src/core/playback/scheduler.ts'
import { frac } from '../src/core/score/rational.ts'
import type { Score } from '../src/core/score/model.ts'
import { barOf, n, scoreOf, tenorTimeline } from './playbackHelpers.ts'

class Rig {
  time = 0
  timer: (() => void) | undefined
  notes: { spec: NoteOnSpec; calledAt: number; handle: { releases: { when: number; fade: number }[] } }[] = []
  clicks: ClickSpec[] = []
  readonly timerApi: TimerApi = {
    set: (fn) => {
      this.timer = fn
      return 1
    },
    clear: () => {
      this.timer = undefined
    },
  }
  readonly audio: AudioBackend = {
    get currentTime(): number {
      return rig.time
    },
    output: {
      noteOn: (spec): VoiceHandle => {
        const handle = { releases: [] as { when: number; fade: number }[], release(when: number, fade: number) { this.releases.push({ when, fade }) }, cancel() {} }
        this.notes.push({ spec, calledAt: this.time, handle })
        return handle
      },
      click: (spec) => {
        this.clicks.push(spec)
      },
    },
  }
  /** Advances the audio clock in 25 ms timer steps. */
  run(seconds: number): void {
    const steps = Math.round(seconds / 0.025)
    for (let i = 0; i < steps; i++) {
      this.time = Math.round((this.time + 0.025) * 1e6) / 1e6
      this.timer?.()
    }
  }
}
let rig: Rig
const fresh = (): Rig => (rig = new Rig())

const close = (a: number, b: number, msg?: string): void => assert.ok(Math.abs(a - b) < 1e-6, msg ?? `${a} vs ${b}`)

/** N one-bar, one-note (whole) bars in 4/4; bar k (1-based) has the pitch STEPS[(k-1) % 7]. */
const STEPS = ['C', 'D', 'E', 'F', 'G', 'A', 'B']
const wholeBars = (count: number): Score => scoreOf(Array.from({ length: count }, (_, i) => barOf(STEPS[i % 7]!)))
/** Written C4 = 60 -> concert 46. */
const concert = (step: string): number => ({ C: 60, D: 62, E: 64, F: 65, G: 67, A: 69, B: 71 })[step]! - 14
const barOfNote = (spec: NoteOnSpec): number => {
  const step = Object.entries({ C: 60, D: 62, E: 64, F: 65, G: 67, A: 69, B: 71 }).find(([, m]) => m - 14 === spec.midi[0])![0]
  return STEPS.indexOf(step)
}

// ---- 12.4 count-in ----

test('count-in 3/4: three clicks at the beat, the first note one bar after the first click', () => {
  const r = fresh()
  const score = scoreOf([{ body: n({ step: 'C' }) + n({ step: 'D' }) + n({ step: 'E' }) }, { body: n({ step: 'F' }) + n({ step: 'G' }) + n({ step: 'A' }) }], [3, 4])
  const player = new Player({ instrument: TENOR_SAX, loadScore: () => score, backend: async () => r.audio, timer: r.timerApi, bpm: 120, countIn: true })
  return player.play().then(() => {
    r.run(5)
    assert.equal(r.clicks.length, 3, 'three clicks in 3/4')
    assert.deepEqual(r.clicks.map((c) => c.accent), [true, false, false])
    const d = PLAYBACK_TUNING.startDelay
    r.clicks.forEach((c, k) => close(c.when, d + k * 0.5, `click ${k}`))
    assert.equal(r.notes.length, 6)
    close(r.notes[0]!.spec.when, d + 3 * 0.5, 'the first note is one beat after the third click')
    assert.ok(r.clicks.every((c) => c.when < r.notes[0]!.spec.when), 'all clicks are before the first note')
  })
})

test('count-in 6/8: two clicks, dotted-quarter apart', async () => {
  const r = fresh()
  const score = scoreOf([{ body: n({ step: 'C', type: 'eighth' }).repeat(6) }], [6, 8])
  const player = new Player({ instrument: TENOR_SAX, loadScore: () => score, backend: async () => r.audio, timer: r.timerApi, bpm: 60, beatUnit: frac(3, 2), countIn: true })
  await player.play()
  r.run(6)
  assert.equal(r.clicks.length, 2)
  close(r.clicks[1]!.when - r.clicks[0]!.when, 1, 'a dotted quarter at 60 bpm = 1.5 quarter beats at 90 quarter-bpm = 1 second')
  assert.equal(player.bpm, 60)
  assert.equal(player.currentScheduler!.bpm, 90, 'the scheduler counts quarters')
})

test('count-in off: no clicks; the position reports the visible count while it runs', async () => {
  const r = fresh()
  const score = scoreOf([{ body: n({ step: 'C' }) + n({ step: 'D' }) + n({ step: 'E' }) }], [3, 4])
  const player = new Player({ instrument: TENOR_SAX, loadScore: () => score, backend: async () => r.audio, timer: r.timerApi, bpm: 120, countIn: true })
  await player.play()
  const d = PLAYBACK_TUNING.startDelay
  const counts: (number | undefined)[] = []
  for (const t of [0.1, 0.6, 1.1, 1.6]) {
    r.time = t + d
    counts.push(player.positionNow(0)?.count?.n)
  }
  assert.deepEqual(counts, [1, 2, 3, undefined], 'counted 1, 2, 3 and then the notes')
  player.stop()
  player.setCountIn(false)
  r.clicks.length = 0
  await player.play()
  r.run(3)
  assert.equal(r.clicks.length, 0)
})

// ---- 12.5 looping ----

/** 12 whole-note bars at 120 bpm: a bar lasts 2 s, bars 9-12 (indices 8..11) 8 s. */
async function loopRun(options: { countIn?: boolean; from?: string } = {}) {
  const r = fresh()
  const score = wholeBars(12)
  const player = new Player({ instrument: TENOR_SAX, loadScore: () => score, backend: async () => r.audio, timer: r.timerApi, bpm: 120, countIn: options.countIn ?? false, loop: { start: 8, end: 11 } })
  await player.play(options.from ? { fromNoteId: options.from } : {})
  return { r, player, score }
}

test('loop bars 9-12: the first note of bar 9 on the second pass is exactly one loop length after the first', async () => {
  const { r } = await loopRun()
  r.run(8 * 3 + 1)
  const bar9 = r.notes.filter((x) => barOfNote(x.spec) === STEPS.indexOf(STEPS[8 % 7]!) && x.spec.midi[0] === concert('D'))
  // Bars 9..12 carry pitches D E F G; the first note of bar 9 is the only D in the loop.
  assert.ok(bar9.length >= 3, 'three passes heard')
  close(bar9[1]!.spec.when - bar9[0]!.spec.when, 8, 'second pass starts one loop length (16 beats = 8 s) later')
  close(bar9[2]!.spec.when - bar9[1]!.spec.when, 8)
  close(bar9[0]!.spec.when, PLAYBACK_TUNING.startDelay, 'playback started at bar 9')
})

test('loop: no gap between passes - every note follows the previous one by exactly one bar, across the wrap', async () => {
  const { r } = await loopRun()
  r.run(30)
  const times = r.notes.map((x) => x.spec.when)
  assert.ok(times.length >= 14)
  for (let k = 1; k < times.length; k++) close(times[k]! - times[k - 1]!, 2, `gap before note ${k}`)
  assert.deepEqual(
    r.notes.slice(0, 9).map((x) => x.spec.midi[0]),
    ['D', 'E', 'F', 'G', 'D', 'E', 'F', 'G', 'D'].map(concert),
  )
  for (const x of r.notes) assert.ok(x.spec.when >= x.calledAt - 1e-9, 'never scheduled in the past')
})

test('loop: it goes on until stopped and never reports the end', async () => {
  let ended = 0
  const r = fresh()
  const player = new Player({ instrument: TENOR_SAX, loadScore: () => wholeBars(12), backend: async () => r.audio, timer: r.timerApi, bpm: 120, loop: { start: 8, end: 11 }, onState: (s) => s === 'stopped' && ended++ })
  await player.play()
  r.run(100)
  assert.equal(player.state, 'playing')
  assert.equal(ended, 0)
  assert.ok(r.notes.length > 40)
  player.stop()
  assert.equal(player.state, 'stopped')
  const count = r.notes.length
  r.run(5)
  assert.equal(r.notes.length, count, 'nothing more after stop')
})

test('loop: the count-in plays only before the first pass', async () => {
  const { r } = await loopRun({ countIn: true })
  r.run(40)
  assert.equal(r.clicks.length, 4, 'four clicks in 4/4, once')
  const firstNote = r.notes[0]!.spec.when
  assert.ok(r.clicks.every((c) => c.when < firstNote))
  close(firstNote - r.clicks[0]!.when, 4 * 0.5)
  // After the first pass the loop continues without more clicks (several passes ran).
  assert.ok(r.notes.length > 8)
})

test('loop: the position reports the pass and stays inside the loop range', async () => {
  const { r, player } = await loopRun()
  const d = PLAYBACK_TUNING.startDelay
  r.time = d + 1
  assert.equal(player.positionNow(0)?.event?.bar, '9')
  r.time = d + 8 + 1
  const p = player.positionNow(0)!
  assert.equal(p.event?.bar, '9', 'the second pass is back in bar 9')
  assert.equal(p.loopPass, 1)
  r.time = d + 8 + 7
  assert.equal(player.positionNow(0)?.event?.bar, '12')
})

test('loop: starting before the loop plays up to it; starting after it ignores the loop', async () => {
  const before = await loopRun({ from: undefined })
  before.player.stop()
  const r = fresh()
  const score = wholeBars(12)
  const player = new Player({ instrument: TENOR_SAX, loadScore: () => score, backend: async () => r.audio, timer: r.timerApi, bpm: 120, loop: { start: 8, end: 11 } })
  const first = tenorTimeline(score).events[2]!.noteIds[0]!
  await player.play({ fromNoteId: first })
  r.run(40)
  assert.deepEqual(
    r.notes.slice(0, 11).map((x) => x.spec.midi[0]),
    ['E', 'F', 'G', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'D'].map(concert),
    'bars 3..12 once, then bars 9..12 again',
  )
  player.stop()
  const shorter = new Player({ instrument: TENOR_SAX, loadScore: () => score, backend: async () => r.audio, timer: r.timerApi, bpm: 120, loop: { start: 8, end: 10 } })
  const last = tenorTimeline(score).events[11]!.noteIds[0]!
  r.notes.length = 0
  await shorter.play({ fromNoteId: last })
  r.run(10)
  assert.equal(r.notes.length, 1, 'bar 12 played once; the loop (bars 9-11) ended before it was entered')
  assert.equal(shorter.state, 'stopped')
})

test('clearing the loop: playback runs through the whole exercise again', async () => {
  const r = fresh()
  const player = new Player({ instrument: TENOR_SAX, loadScore: () => wholeBars(12), backend: async () => r.audio, timer: r.timerApi, bpm: 120, loop: { start: 8, end: 11 } })
  player.setLoop(undefined)
  await player.play()
  r.run(30)
  assert.equal(r.notes.length, 12)
  assert.equal(barOfNote(r.notes[0]!.spec), 0, 'from bar 1')
  assert.equal(player.state, 'stopped', 'ended by itself')
})

test('loop set while playing: carries on from the current note, then loops; cleared while playing: runs on to the end', async () => {
  const r = fresh()
  const player = new Player({ instrument: TENOR_SAX, loadScore: () => wholeBars(12), backend: async () => r.audio, timer: r.timerApi, bpm: 120 })
  await player.play()
  r.run(2 * 9 + 0.5) // inside bar 10
  r.notes.length = 0
  player.setLoop({ start: 8, end: 11 })
  r.run(30)
  assert.deepEqual(r.notes.slice(0, 5).map((x) => x.spec.midi[0]), ['E', 'F', 'G', 'D', 'E'].map(concert), 'restarts bar 10, runs to bar 12, wraps to bar 9')
  r.notes.length = 0
  player.setLoop(undefined)
  r.run(30)
  assert.ok(r.notes.length <= 3, 'the loop is dropped: the current pass ends with the exercise')
  assert.equal(player.state, 'stopped')
})

test('loop at a slurred end: the last note of the pass is released, not left hanging', () => {
  const r = fresh()
  const score = scoreOf([{ body: n({ step: 'C', slur: 'start' }) + n({ step: 'D' }) + n({ step: 'E', slur: 'stop' }) + n({ step: 'F' }) }])
  const timeline = tenorTimeline(score)
  const s = new Scheduler(timeline, { clock: r.audio, output: r.audio.output, timer: r.timerApi, bpm: 120 })
  s.start(0, { loop: { start: timeline.bars[0]!.start, end: timeline.bars[0]!.end } })
  r.run(9)
  assert.ok(r.notes.length >= 12)
  const lastOfPass = r.notes.filter((x) => x.spec.midi[0] === concert('F'))
  assert.ok(lastOfPass.every((x) => x.handle.releases.length === 1))
  const fresh2 = r.notes.filter((x, i) => i % 4 === 0)
  assert.ok(fresh2.every((x) => x.spec.attack && x.spec.join === undefined), 'the first note of each pass is attacked fresh')
})

// ---- 12.2 tempo ----

test('tempo change in bar 6 continues from bar 6 at the new tempo, pitch unchanged', async () => {
  const r = fresh()
  const player = new Player({ instrument: TENOR_SAX, loadScore: () => wholeBars(12), backend: async () => r.audio, timer: r.timerApi, bpm: 120 })
  await player.play()
  r.run(2 * 5 + 0.5) // in bar 6
  const before = r.notes.length
  assert.equal(barOfNote(r.notes[before - 1]!.spec), 5)
  player.setTempo(60)
  r.run(0.5)
  const restarted = r.notes[before]!
  assert.equal(restarted.spec.midi[0], concert('A'), 'bar 6 again (A), same pitch')
  assert.equal(r.notes[before]!.spec.midi[0], r.notes[before - 1]!.spec.midi[0], 'pitch is not changed by tempo')
  r.run(10)
  const next = r.notes[before + 1]!
  close(next.spec.when - restarted.spec.when, 4, 'bar 7 comes one bar (4 s at 60 bpm) later')
  assert.equal(next.spec.midi[0], concert('B'))
})

test('tempo is 30-200 in the beat unit', () => {
  const r = fresh()
  const p = new Player({ instrument: TENOR_SAX, loadScore: () => wholeBars(2), backend: async () => r.audio, timer: r.timerApi, beatUnit: frac(3, 2), bpm: 60 })
  assert.equal(p.setTempo(500), 200)
  assert.equal(p.setTempo(3), 30)
  assert.equal(p.setTempo(96), 96)
  assert.equal(p.bpm, 96)
})

test('tempo change during the count-in starts the count-in again at the new tempo', async () => {
  const r = fresh()
  const score = scoreOf([{ body: n({ step: 'C' }) + n({ step: 'D' }) + n({ step: 'E' }) }], [3, 4])
  const player = new Player({ instrument: TENOR_SAX, loadScore: () => score, backend: async () => r.audio, timer: r.timerApi, bpm: 120, countIn: true })
  await player.play()
  r.run(0.6) // in the second click
  r.clicks.length = 0
  player.setTempo(60)
  r.run(6)
  assert.equal(r.clicks.length, 3, 'a whole count-in again')
  close(r.clicks[1]!.when - r.clicks[0]!.when, 1)
})

// ---- 12.1 pause / resume ----

test('pause in bar 5 and resume continues in bar 5 (no count-in on resume)', async () => {
  const r = fresh()
  const player = new Player({ instrument: TENOR_SAX, loadScore: () => wholeBars(12), backend: async () => r.audio, timer: r.timerApi, bpm: 120, countIn: true })
  await player.play()
  r.run(4 * 0.5 + 2 * 4 + 1) // count-in, then into bar 5 (4 bars = 8 s + 1 s)
  assert.equal(player.positionNow(0.04)?.event?.bar, '5')
  player.pause()
  assert.equal(player.state, 'paused')
  const clicks = r.clicks.length
  r.notes.length = 0
  r.run(3)
  assert.equal(r.notes.length, 0, 'silent while paused')
  await player.play()
  assert.equal(player.state, 'playing')
  r.run(1)
  assert.equal(barOfNote(r.notes[0]!.spec), 4, 'bar 5 (G) sounds first on resume')
  assert.equal(r.notes[0]!.spec.midi[0], concert('G'))
  assert.equal(r.clicks.length, clicks, 'no count-in when resuming')
  r.run(3)
  assert.equal(r.notes[1]!.spec.midi[0], concert('A'), 'then on to bar 6')
})

test('pause is idle in other states; stop forgets the paused position', async () => {
  const r = fresh()
  const player = new Player({ instrument: TENOR_SAX, loadScore: () => wholeBars(12), backend: async () => r.audio, timer: r.timerApi, bpm: 120 })
  player.pause()
  assert.equal(player.state, 'stopped')
  await player.play()
  r.run(9)
  player.pause()
  player.stop()
  assert.equal(player.state, 'stopped')
  assert.equal(player.startNoteId, undefined)
  r.notes.length = 0
  await player.play()
  r.run(1)
  assert.equal(barOfNote(r.notes[0]!.spec), 0, 'a fresh play starts at the beginning')
})

test('toggle: play, pause, play', async () => {
  const r = fresh()
  const player = new Player({ instrument: TENOR_SAX, loadScore: () => wholeBars(4), backend: async () => r.audio, timer: r.timerApi, bpm: 120 })
  await player.toggle()
  assert.equal(player.state, 'playing')
  await player.toggle()
  assert.equal(player.state, 'paused')
  await player.toggle()
  assert.equal(player.state, 'playing')
})

// ---- 12.6 seek ----

test('seek while stopped: Play starts from that note; Stop returns to it', async () => {
  const r = fresh()
  const score = wholeBars(12)
  const bar9 = tenorTimeline(score).events[8]!.noteIds[0]!
  const player = new Player({ instrument: TENOR_SAX, loadScore: () => score, backend: async () => r.audio, timer: r.timerApi, bpm: 120 })
  player.seek(bar9)
  assert.equal(player.state, 'stopped')
  await player.play()
  r.run(1)
  assert.equal(r.notes[0]!.spec.midi[0], concert('D'), 'bar 9 (D)')
  assert.equal(player.positionNow(0)?.event?.bar, '9')
  player.stop()
  r.notes.length = 0
  await player.play()
  r.run(1)
  assert.equal(r.notes[0]!.spec.midi[0], concert('D'), 'after Stop, Play starts from the tapped note again')
})

test('seek while playing: jumps to bar 3 and continues from there, without a count-in', async () => {
  const r = fresh()
  const score = wholeBars(12)
  const bar3 = tenorTimeline(score).events[2]!.noteIds[0]!
  const player = new Player({ instrument: TENOR_SAX, loadScore: () => score, backend: async () => r.audio, timer: r.timerApi, bpm: 120, countIn: true })
  await player.play()
  r.run(2 + 2 * 8 + 1) // into bar 9 after the count-in
  const clicks = r.clicks.length
  r.notes.length = 0
  player.seek(bar3)
  assert.equal(player.state, 'playing')
  r.run(5)
  assert.deepEqual(r.notes.slice(0, 3).map((x) => x.spec.midi[0]), ['E', 'F', 'G'].map(concert), 'bars 3, 4, 5')
  assert.equal(r.clicks.length, clicks)
  assert.equal(player.positionNow(0)?.event?.bar, '5')
})

test('seek while paused moves the resume position', async () => {
  const r = fresh()
  const score = wholeBars(12)
  const bar9 = tenorTimeline(score).events[8]!.noteIds[0]!
  const player = new Player({ instrument: TENOR_SAX, loadScore: () => score, backend: async () => r.audio, timer: r.timerApi, bpm: 120 })
  await player.play()
  r.run(3)
  player.pause()
  player.seek(bar9)
  assert.equal(player.state, 'paused')
  r.notes.length = 0
  await player.play()
  r.run(1)
  assert.equal(r.notes[0]!.spec.midi[0], concert('D'))
})

test('setting a loop drops the tapped position: Play starts at the loop', async () => {
  const r = fresh()
  const score = wholeBars(12)
  const bar3 = tenorTimeline(score).events[2]!.noteIds[0]!
  const player = new Player({ instrument: TENOR_SAX, loadScore: () => score, backend: async () => r.audio, timer: r.timerApi, bpm: 120 })
  player.seek(bar3)
  player.setLoop({ start: 8, end: 11 })
  await player.play()
  r.run(1)
  assert.equal(r.notes[0]!.spec.midi[0], concert('D'))
})

test('the heard position is only reported while playing (a stale run is never read)', async () => {
  const r = fresh()
  const player = new Player({ instrument: TENOR_SAX, loadScore: () => wholeBars(12), backend: async () => r.audio, timer: r.timerApi, bpm: 120 })
  assert.equal(player.positionNow(0), undefined)
  await player.play()
  r.run(5)
  assert.equal(player.positionNow(0)?.event?.bar, '3')
  player.pause()
  r.run(10)
  assert.equal(player.positionNow(0), undefined, 'paused')
  player.stop()
  assert.equal(player.positionNow(0), undefined, 'stopped')
})

test('cursor: a restart (tempo change, tap) does not blink the highlight off while the output latency catches up', async () => {
  const r = fresh()
  const player = new Player({ instrument: TENOR_SAX, loadScore: () => wholeBars(12), backend: async () => r.audio, timer: r.timerApi, bpm: 120 })
  await player.play()
  r.run(5)
  const tracker = new CursorTracker((t) => player.currentScheduler!.positionAt(t), () => r.time - 0.06)
  assert.equal(tracker.poll().event?.bar, '3')
  player.setTempo(100)
  const update = tracker.poll() // heard time is still before the restarted run's anchor
  assert.equal(update.changed, false)
  assert.equal(update.event?.bar, '3')
  r.run(0.5)
  assert.equal(tracker.poll().event?.bar, '3')
})
