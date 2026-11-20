import assert from 'node:assert/strict'
import { test } from 'node:test'
import { FreeMetronome } from '../src/core/playback/freeMetronome.ts'
import { PLAYBACK_TUNING } from '../src/core/playback/scheduler.ts'
import type { ClickSpec, NoteOutput, TimerApi } from '../src/core/playback/scheduler.ts'
import { frac } from '../src/core/score/rational.ts'

// The metronome on its own (change steady-notes-and-free-metronome, task 1.1) on a fake clock: the test
// moves the audio time in 25 ms steps and runs the timer on each step, as the scheduler tests do.

const START = PLAYBACK_TUNING.startDelay
const close = (a: number, b: number, message?: string): void => assert.ok(Math.abs(a - b) < 1e-6, message ?? `${a} vs ${b}`)

function rig() {
  const clock = { currentTime: 0 }
  let tick: (() => void) | undefined
  let sets = 0
  const timer: TimerApi = {
    set: (fn) => ((tick = fn), ++sets),
    clear: () => (tick = undefined),
  }
  const clicks: (ClickSpec & { calledAt: number; cancelled: boolean })[] = []
  const output: NoteOutput = {
    noteOn: () => ({ release() {}, cancel() {} }),
    click: (spec) => {
      const click = { ...spec, calledAt: clock.currentTime, cancelled: false }
      clicks.push(click)
      return { cancel: () => void (click.cancelled = true) }
    },
  }
  const run = (seconds: number): void => {
    for (let i = 0; i < Math.round(seconds / 0.025); i++) {
      clock.currentTime = Math.round((clock.currentTime + 0.025) * 1e6) / 1e6
      tick?.()
    }
  }
  const metronome = (bpm: number, beatsPerBar: number, spacing = frac(1)) => new FreeMetronome({ clock, output, timer, bpm, spacing, beatsPerBar })
  return { clock, clicks, run, metronome, timerRunning: () => tick !== undefined, sets: () => sets }
}

test('free metronome: one click a beat at the tempo, the first at once and accented, every fourth accented in 4/4', () => {
  const r = rig()
  const m = r.metronome(80, 4)
  m.start()
  assert.equal(r.clicks.length, 1, 'the first click is handed out at once')
  close(r.clicks[0]!.when, START)
  r.run(6)
  // 80 bpm: 0.75 s a beat.
  const heard = r.clicks.filter((c) => c.when <= r.clock.currentTime)
  assert.equal(heard.length, 8)
  heard.forEach((c, k) => close(c.when, START + k * 0.75, `click ${k}`))
  assert.deepEqual(
    heard.map((c) => c.accent),
    [true, false, false, false, true, false, false, false],
  )
  assert.ok(r.clicks.every((c) => c.when - c.calledAt < PLAYBACK_TUNING.lookahead + 1e-9), 'handed out within the lookahead, like the notes')
  assert.equal(m.running, true)
})

test('free metronome: 3/4 accents every third click; a dotted-quarter beat at 40 counts 6/8 in two', () => {
  const r = rig()
  r.metronome(120, 3).start()
  r.run(3)
  assert.deepEqual(
    r.clicks.filter((c) => c.when <= r.clock.currentTime).map((c) => c.accent),
    [true, false, false, true, false, false],
  )

  // 6/8 counted in dotted quarters at 40 a minute: the quarter bpm is 60, a click every 1.5 s.
  const c = rig()
  c.metronome(60, 2, frac(3, 2)).start()
  c.run(6)
  const heard = c.clicks.filter((x) => x.when <= c.clock.currentTime)
  heard.forEach((x, k) => close(x.when, START + k * 1.5, `click ${k}`))
  assert.deepEqual(
    heard.map((x) => x.accent),
    [true, false, true, false],
  )
})

test('free metronome: never more than one click ahead of the clock', () => {
  const r = rig()
  r.metronome(200, 4, frac(1, 2)).start() // an eighth at 200 a minute in quarters: 0.15 s apart
  for (let k = 0; k < 80; k++) {
    r.run(0.025)
    const ahead = r.clicks.filter((c) => c.when > r.clock.currentTime)
    assert.ok(ahead.length <= 1, `at ${r.clock.currentTime}: ${ahead.length} clicks ahead`)
  }
  const heard = r.clicks.filter((c) => c.when <= r.clock.currentTime)
  heard.slice(1).forEach((c, k) => close(c.when - heard[k]!.when, 0.15, `gap ${k}`))
})

test('free metronome: a tempo change spaces the next click from the last one, and the count of the bar goes on', () => {
  const r = rig()
  const m = r.metronome(80, 4)
  m.start()
  r.run(1.7) // clicks at 0.06, 0.81, 1.56; the next (2.31) is not handed out yet
  assert.equal(r.clicks.length, 3)
  m.setBpm(100) // 0.6 s a beat
  r.run(3)
  const heard = r.clicks.filter((c) => !c.cancelled && c.when <= r.clock.currentTime)
  close(heard[3]!.when, START + 1.5 + 0.6, 'the next click is one beat at 100 after the last one at 80')
  heard.slice(3).forEach((c, k) => close(c.when, START + 1.5 + 0.6 * (k + 1), `click ${k + 3}`))
  assert.deepEqual(
    heard.map((c) => c.accent).slice(0, 6),
    [true, false, false, false, true, false],
    'the fifth click is still the next bar\'s first',
  )
  assert.equal(m.bpm, 100)
})

test('free metronome: a tempo change with a click already handed out takes it back and hands it out again at the new spacing', () => {
  const r = rig()
  const m = r.metronome(60, 4) // 1 s a beat: clicks at 0.06, 1.06, 2.06
  m.start()
  r.run(1.0) // the click at 1.06 is handed out (within 0.1 s), not yet heard
  assert.equal(r.clicks.length, 2)
  assert.ok(r.clicks[1]!.when > r.clock.currentTime)
  m.setBpm(120) // 0.5 s a beat: the next click is due at 0.56, which has passed, so it sounds now
  assert.equal(r.clicks[1]!.cancelled, true, 'the click on the old grid is taken back')
  const again = r.clicks[2]!
  close(again.when, r.clock.currentTime, 'and sounds now, not half a beat late')
  assert.equal(again.accent, false, 'it is still the second beat of the bar')
  r.run(2)
  const heard = r.clicks.filter((c) => !c.cancelled)
  heard.slice(2).forEach((c, k) => close(c.when - heard[k + 1]!.when, 0.5, `gap ${k}`))
})

test('free metronome: stop takes back the click that has not sounded, clears its timer, and leaves nothing scheduled', () => {
  const r = rig()
  const m = r.metronome(120, 4)
  m.start()
  r.run(0.475) // the click at 0.56 is handed out, not heard
  const ahead = r.clicks.filter((c) => c.when > r.clock.currentTime)
  assert.equal(ahead.length, 1, 'at most one click beyond now')
  m.stop()
  assert.equal(ahead[0]!.cancelled, true)
  assert.equal(r.timerRunning(), false)
  assert.equal(m.running, false)
  const handed = r.clicks.length
  r.run(3)
  assert.equal(r.clicks.length, handed, 'no click after stop')
  assert.ok(!r.clicks[0]!.cancelled, 'a click that sounded is not touched')

  // Stopping again, or a metronome that never ran, does not clear a timer it does not hold.
  const sets = r.sets()
  m.stop()
  r.metronome(60, 4).stop()
  assert.equal(r.sets(), sets)
})

test('free metronome: a new beat unit with another count of the bar starts a new bar on the next click', () => {
  const r = rig()
  const m = r.metronome(60, 2, frac(3, 2)) // 6/8 in dotted quarters
  m.start()
  r.run(1.6) // clicks at 0.06 and 1.56 heard
  m.setBeat(frac(1, 2), 6) // the same bar in eighths: six clicks, 0.5 s apart at a quarter bpm of 60
  r.run(3.5)
  const heard = r.clicks.filter((c) => !c.cancelled && c.when <= r.clock.currentTime)
  close(heard[2]!.when, START + 1.5 + 0.5)
  assert.deepEqual(
    heard.map((c) => c.accent),
    [true, false, true, false, false, false, false, false, true],
  )
  // A timer that wakes very late skips the beats that went by instead of sounding them all at once.
  const late = rig()
  const l = late.metronome(120, 4)
  l.start()
  late.clock.currentTime = 2.01
  late.run(0.025)
  const sounding = late.clicks.filter((c) => c.when >= 1)
  assert.equal(sounding.length, 1, 'one click, not a burst')
  close(sounding[0]!.when, START + 4 * 0.5, 'on the grid')
  assert.equal(sounding[0]!.accent, true, 'the fifth beat: the first of the next bar')
})

test('free metronome: a shorter beat set late in a long one takes effect in one step, the next click accented', () => {
  const r = rig()
  const m = r.metronome(60, 2, frac(2)) // half notes at a quarter bpm of 60: 2 s apart
  m.start()
  r.run(3.5) // clicks at 0.06 and 2.06 heard; 1.5 s into the second beat
  m.setBeat(frac(1, 2), 8, 120) // eighths at a quarter bpm of 120: 0.25 s apart, eight a bar
  r.run(1)
  const after = r.clicks.filter((c) => !c.cancelled && c.when > START + 2 && c.when <= r.clock.currentTime)
  close(after[0]!.when, r.clock.currentTime - 1, 'the next click at once (one new beat after the last has passed)')
  assert.equal(after[0]!.accent, true, 'and it starts the bar')
  assert.deepEqual(
    after.map((c) => c.accent).slice(0, 4),
    [true, false, false, false],
  )
})
