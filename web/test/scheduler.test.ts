import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PLAYBACK_TUNING, Scheduler } from '../src/core/playback/scheduler.ts'
import type { ClickSpec, NoteOnSpec, NoteOutput, TimerApi, VoiceHandle } from '../src/core/playback/scheduler.ts'
import { loopSpanOf } from '../src/core/playback/timeline.ts'
import { frac } from '../src/core/score/rational.ts'
import { ALTO_SAX, PIANO, TENOR_SAX } from '../src/core/instruments/instruments.ts'
import { buildTimeline } from '../src/core/playback/timeline.ts'
import { n, scoreOf, tenorTimeline } from './playbackHelpers.ts'

class FakeClock {
  currentTime = 0
}

class FakeTimer implements TimerApi {
  fn: (() => void) | undefined
  set(fn: () => void): unknown {
    this.fn = fn
    return 1
  }
  clear(): void {
    this.fn = undefined
  }
}

interface Recorded {
  spec: NoteOnSpec
  /** Clock time at which noteOn was called. */
  calledAt: number
  handle: FakeHandle
}

class FakeHandle implements VoiceHandle {
  releases: { when: number; fade: number }[] = []
  cancelled = false
  release(when: number, fade: number): void {
    this.releases.push({ when, fade })
  }
  cancel(): void {
    this.cancelled = true
  }
}

class FakeOutput implements NoteOutput {
  notes: Recorded[] = []
  clicks: (ClickSpec & { calledAt: number })[] = []
  clock: FakeClock
  constructor(clock: FakeClock) {
    this.clock = clock
  }
  noteOn(spec: NoteOnSpec): VoiceHandle {
    const handle = new FakeHandle()
    this.notes.push({ spec, calledAt: this.clock.currentTime, handle })
    return handle
  }
  click(spec: ClickSpec): void {
    this.clicks.push({ ...spec, calledAt: this.clock.currentTime })
  }
}

function rig(body: string, bpm = 120, extraBars: string[] = [], options: { time?: [number, number]; metronome?: boolean } = {}) {
  const clock = new FakeClock()
  const timer = new FakeTimer()
  const output = new FakeOutput(clock)
  let ended = 0
  const timeline = tenorTimeline(scoreOf([{ body }, ...extraBars.map((b) => ({ body: b }))], options.time ?? [4, 4]))
  const scheduler = new Scheduler(timeline, { clock, output, timer, bpm, onEnd: () => ended++, ...(options.metronome ? { metronome: true } : {}) })
  /** Advance the clock in 25 ms timer steps. */
  const run = (seconds: number): void => {
    const steps = Math.round(seconds / 0.025)
    for (let i = 0; i < steps; i++) {
      clock.currentTime = Math.round((clock.currentTime + 0.025) * 1e6) / 1e6
      timer.fn?.()
    }
  }
  return { clock, timer, output, timeline, scheduler, run, ended: () => ended }
}

const close = (a: number, b: number, msg?: string): void => assert.ok(Math.abs(a - b) < 1e-9, msg ?? `${a} vs ${b}`)

test('scheduler: notes are scheduled inside the lookahead window, in order, at exact times', () => {
  const r = rig(n({ step: 'C' }) + n({ step: 'D' }) + n({ step: 'E' }) + n({ step: 'F' }))
  r.scheduler.start()
  // 120 bpm = 0.5 s per beat; first note after the start delay.
  assert.equal(r.output.notes.length, 1, 'only the first note is inside the 100 ms window')
  r.run(3)
  assert.equal(r.output.notes.length, 4)
  r.output.notes.forEach((rec, k) => {
    close(rec.spec.when, PLAYBACK_TUNING.startDelay + k * 0.5, `note ${k} time`)
    assert.ok(rec.spec.when - rec.calledAt < PLAYBACK_TUNING.lookahead + 1e-9, `note ${k} scheduled ${rec.spec.when - rec.calledAt}s ahead`)
    assert.ok(rec.spec.when >= rec.calledAt - 1e-9, 'never scheduled in the past')
  })
  const times = r.output.notes.map((x) => x.spec.when)
  assert.deepEqual([...times].sort((a, b) => a - b), times)
  assert.equal(r.ended(), 1)
  assert.equal(r.scheduler.running, false)
})

test('scheduler: slurred notes get no new attack and are not released separately', () => {
  const r = rig(n({ slur: 'start' }) + n({}) + n({ slur: 'stop' }) + n({}))
  r.scheduler.start()
  r.run(3)
  const specs = r.output.notes.map((x) => x.spec)
  assert.deepEqual(
    specs.map((s) => s.attack),
    [true, false, false, true],
  )
  assert.equal(specs[1]!.join, r.output.notes[0]!.handle, 'crossfades from the previous note')
  assert.equal(specs[2]!.join, r.output.notes[1]!.handle)
  assert.equal(specs[3]!.join, undefined)
  assert.ok(specs[1]!.fade >= PLAYBACK_TUNING.legatoFade)
  // The slurred notes are taken over by the next note's crossfade; only the last note of the slur and the plain note get a release.
  assert.equal(r.output.notes[0]!.handle.releases.length, 0)
  assert.equal(r.output.notes[1]!.handle.releases.length, 0)
  assert.equal(r.output.notes[2]!.handle.releases.length, 1)
  assert.equal(r.output.notes[3]!.handle.releases.length, 1)
})

test('scheduler: a staccato note ends early; a normal note fills its value', () => {
  const r = rig(n({ stac: true }) + n({}))
  r.scheduler.start()
  r.run(2)
  const [a, b] = r.output.notes
  const end = (rec: Recorded): number => {
    const rel = rec.handle.releases[0]
    assert.ok(rel, 'released')
    return rel.when + rel.fade
  }
  // 120 bpm: a quarter is 0.5 s; staccato sounds 0.25 s.
  close(end(a!) - a!.spec.when, 0.25, 'staccato length')
  close(end(b!) - b!.spec.when, 0.5, 'normal length')
  assert.ok(a!.handle.releases[0]!.fade <= PLAYBACK_TUNING.staccatoRelease + 1e-9, 'short release')
})

test('scheduler: rests make no sound but keep the time', () => {
  const r = rig(n({ rest: true }) + n({ step: 'D' }))
  r.scheduler.start()
  r.run(2)
  assert.equal(r.output.notes.length, 1)
  close(r.output.notes[0]!.spec.when, PLAYBACK_TUNING.startDelay + 0.5)
})

test('scheduler: tempo is in beats, so pitch never changes and times scale', () => {
  const body = n({ step: 'C' }) + n({ step: 'D' })
  const slow = rig(body, 50)
  slow.scheduler.start()
  slow.run(4)
  const fast = rig(body, 96)
  fast.scheduler.start()
  fast.run(4)
  assert.deepEqual(
    slow.output.notes.map((x) => x.spec.midi),
    fast.output.notes.map((x) => x.spec.midi),
  )
  close(slow.output.notes[1]!.spec.when - slow.output.notes[0]!.spec.when, 60 / 50)
  close(fast.output.notes[1]!.spec.when - fast.output.notes[0]!.spec.when, 60 / 96)
})

test('scheduler: a tempo change while playing restarts from the current note at the new tempo', () => {
  const r = rig(n({ step: 'C' }) + n({ step: 'D' }) + n({ step: 'E' }) + n({ step: 'F' }), 120)
  r.scheduler.start()
  r.run(0.7) // note 2 (D) started at 0.56
  assert.equal(r.output.notes.length, 2)
  r.scheduler.setBpm(60)
  r.run(0.1)
  const restarted = r.output.notes[2]!
  assert.deepEqual(restarted.spec.midi, r.output.notes[1]!.spec.midi, 'the current note starts again')
  assert.equal(restarted.spec.attack, true)
  r.run(3)
  const t = r.output.notes.slice(2).map((x) => x.spec.when)
  close(t[1]! - t[0]!, 1, 'one second per beat at 60 bpm')
  assert.equal(r.output.notes.length, 5) // C D | D E F
})

test('scheduler: starting from a note (tap-to-seek) skips what comes before and attacks it even inside a slur', () => {
  const r = rig(n({ slur: 'start' }) + n({}) + n({ slur: 'stop' }) + n({}))
  r.scheduler.start(1)
  r.run(3)
  assert.equal(r.output.notes.length, 3)
  assert.equal(r.output.notes[0]!.spec.attack, true)
  assert.equal(r.output.notes[0]!.spec.join, undefined)
  assert.equal(r.output.notes[1]!.spec.attack, false)
  close(r.output.notes[0]!.spec.when, PLAYBACK_TUNING.startDelay)
})

test('scheduler: stop fades out what is sounding and cancels the timer', () => {
  const r = rig(n({ type: 'whole' }))
  r.scheduler.start()
  r.run(0.5)
  r.scheduler.stop()
  const h = r.output.notes[0]!.handle
  assert.equal(h.releases.length, 1)
  close(h.releases[0]!.when, r.clock.currentTime)
  assert.equal(r.timer.fn, undefined)
  assert.equal(r.scheduler.running, false)
  r.run(5)
  assert.equal(r.output.notes.length, 1)
})

test('scheduler: counts quarter-note bpm in a wide sanity range (the 30-200 user range is the player\'s, in the beat unit)', () => {
  const r = rig(n({}), 1000)
  assert.equal(r.scheduler.bpm, 800)
  r.scheduler.setBpm(1)
  assert.equal(r.scheduler.bpm, 5)
  r.scheduler.setBpm(300) // 200 bpm of a dotted quarter
  assert.equal(r.scheduler.bpm, 300)
})

// --- 5.1 the metronome ---

const START = PLAYBACK_TUNING.startDelay

test('metronome 3/4: three clicks in every bar, the first one accented, on the beats of the notes', () => {
  const bar = n({ step: 'C' }) + n({ step: 'D' }) + n({ step: 'E' })
  const r = rig(bar, 120, [bar], { time: [3, 4], metronome: true })
  r.scheduler.start()
  r.run(4)
  assert.equal(r.output.clicks.length, 6, 'three clicks in each of two bars')
  assert.deepEqual(
    r.output.clicks.map((c) => c.accent),
    [true, false, false, true, false, false],
  )
  r.output.clicks.forEach((c, k) => close(c.when, START + k * 0.5, `click ${k}`))
  r.output.notes.forEach((note, k) => close(note.spec.when, r.output.clicks[k]!.when, `note ${k} sounds with its click`))
  assert.ok(r.output.clicks.every((c) => c.when - c.calledAt < PLAYBACK_TUNING.lookahead + 1e-9), 'clicks are scheduled inside the lookahead window, like notes')
})

test('metronome 6/8: two clicks a bar, a dotted quarter apart (the beat grid of compound time, the one the count-in counts)', () => {
  const bar = n({ type: 'eighth' }).repeat(6)
  const r = rig(bar, 90, [bar], { time: [6, 8], metronome: true }) // 90 quarters a minute: a dotted quarter lasts 1 s
  r.scheduler.start()
  r.run(4)
  assert.equal(r.output.clicks.length, 4, 'two clicks in each of two bars')
  assert.deepEqual(
    r.output.clicks.map((c) => c.accent),
    [true, false, true, false],
  )
  r.output.clicks.forEach((c, k) => close(c.when, START + k * 1, `click ${k}`))
  close(r.output.notes[3]!.spec.when, r.output.clicks[1]!.when, 'the fourth eighth falls on the second beat')
})

test('metronome off: no clicks, and the count-in still sounds', () => {
  const r = rig(n({}) + n({}), 120, [], { metronome: false })
  r.scheduler.start(0, { countIn: { clicks: 2, spacing: frac(1) } })
  r.run(3)
  assert.equal(r.output.clicks.length, 2, 'the count-in clicks only')
  assert.ok(r.output.clicks.every((c) => c.when < r.output.notes[0]!.spec.when))
})

test('metronome with a count-in: the count-in, then the beats from the first note, none twice', () => {
  const r = rig(n({}).repeat(4), 120, [], { metronome: true })
  r.scheduler.start(0, { countIn: { clicks: 4, spacing: frac(1) } })
  r.run(6)
  const t = r.output.clicks.map((c) => Math.round((c.when - START) * 1000) / 1000)
  assert.deepEqual(t, [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5], 'four count-in clicks, then the four beats of the bar')
  assert.deepEqual(
    r.output.clicks.map((c) => c.accent),
    [true, false, false, false, true, false, false, false],
  )
  close(r.output.notes[0]!.spec.when, r.output.clicks[4]!.when)
})

test('metronome: switched on while playing, the clicks start at the next beat and the music is not interrupted', () => {
  const bar = n({ step: 'C' }) + n({ step: 'D' }) + n({ step: 'E' }) + n({ step: 'F' })
  const r = rig(bar, 120, [bar, bar])
  r.scheduler.start()
  r.run(0.8) // beats are at 0.06, 0.56, 1.06 ...
  assert.equal(r.output.clicks.length, 0)
  const notesBefore = r.output.notes.length
  r.scheduler.setMetronome(true)
  assert.equal(r.output.notes.length, notesBefore, 'no note was started again')
  assert.equal(r.scheduler.running, true)
  r.run(2)
  close(r.output.clicks[0]!.when, START + 2 * 0.5, 'the first click is on the next beat (1.06 s)')
  assert.equal(r.output.clicks[0]!.accent, false, 'beat 3 of the bar, not an accent')
  assert.deepEqual(
    r.output.clicks.slice(0, 3).map((c) => Math.round((c.when - START) * 1000) / 1000),
    [1, 1.5, 2],
  )
  assert.equal(r.output.clicks[2]!.accent, true, 'and the downbeat of bar 2 is accented')
  assert.ok(r.output.notes.length > notesBefore, 'the music went on')
  r.output.notes.forEach((note, k) => close(note.spec.when, START + k * 0.5, 'the notes keep their times'))
})

test('metronome: switched on just before a beat that is already in the lookahead window, that beat still clicks', () => {
  const r = rig(n({}).repeat(4), 120, [n({}).repeat(4)])
  r.scheduler.start()
  r.run(1.0) // the window now reaches 1.1: the beat at 1.06 has been handed out (silently)
  r.scheduler.setMetronome(true)
  assert.equal(r.output.clicks.length, 1)
  close(r.output.clicks[0]!.when, START + 2 * 0.5, 'beat at 1.06 s')
  // Switched on again or off and on: nothing sounds twice.
  r.scheduler.setMetronome(false)
  r.scheduler.setMetronome(true)
  assert.equal(r.output.clicks.length, 1)
  // A beat that has gone by (switched on at 1.07, after the beat at 1.06) is not played late.
  const late = rig(n({}).repeat(4), 120, [n({}).repeat(4)])
  late.scheduler.start()
  late.run(1.075)
  late.scheduler.setMetronome(true)
  assert.equal(late.output.clicks.length, 0)
  late.run(1)
  close(late.output.clicks[0]!.when, START + 3 * 0.5, 'the next one, at 1.56 s')
})

test('metronome: switched off while playing, the clicks stop from the next window and the notes carry on', () => {
  const bar = n({}).repeat(4)
  const r = rig(bar, 120, [bar], { metronome: true })
  r.scheduler.start()
  r.run(1.0)
  const before = r.output.clicks.length
  assert.ok(before >= 2)
  r.scheduler.setMetronome(false)
  r.run(3)
  assert.equal(r.output.clicks.length, before, 'no click after the switch')
  assert.equal(r.output.notes.length, 8, 'the music was not touched')
})

test('metronome: it follows a tempo change (the click spacing is the new beat) and does not click twice', () => {
  const bar = n({}).repeat(4)
  const r = rig(bar, 120, [bar, bar], { metronome: true })
  r.scheduler.start()
  r.run(0.7) // clicks at 0.06 and 0.56; the note that began at 0.56 is the current one
  r.scheduler.setBpm(60)
  r.run(4)
  const t = r.output.clicks.map((c) => c.when)
  const at = t.findIndex((x) => x > 0.7)
  assert.ok(at > 0)
  t.slice(at + 1).forEach((x, k) => close(x - t[at + k]!, 1, 'one second a beat at 60 bpm'))
  const sorted = [...t].sort((a, b) => a - b)
  assert.deepEqual(t, sorted)
  // The current beat clicks again with the note that starts again; there is no click in between.
  assert.ok(t[at]! - 0.7 < 0.1)
})

test('metronome: the clicks go on through a loop without a gap, and a loop with a rest clicks through the rest', () => {
  const bar = n({}).repeat(4)
  const r = rig(bar, 120, [bar, bar], { metronome: true })
  const loop = { start: r.timeline.bars[0]!.start, end: r.timeline.bars[1]!.end }
  r.scheduler.start(0, { loop })
  r.run(12)
  const t = r.output.clicks.map((c) => Math.round((c.when - START) * 1000) / 1000)
  assert.deepEqual(t.slice(0, 20), Array.from({ length: 20 }, (_, i) => i * 0.5), 'beats 0.5 s apart across two passes of two bars and into the third')
  assert.ok(r.output.clicks.every((c, i) => c.accent === (i % 4 === 0)))

  const rested = rig(bar, 120, [bar, bar], { metronome: true })
  const span = loopSpanOf(rested.timeline, { start: 0, end: 0 }, 1)!
  rested.scheduler.start(0, { loop: span })
  rested.run(9)
  const u = rested.output.clicks.map((c) => Math.round((c.when - START) * 1000) / 1000)
  assert.deepEqual(u.slice(0, 12), Array.from({ length: 12 }, (_, i) => i * 0.5), 'the bar, one bar of rest, and the bar again: always one beat in half a second')
  const notes = rested.output.notes.map((x) => Math.round((x.spec.when - START) * 1000) / 1000)
  assert.deepEqual(notes.slice(0, 5), [0, 0.5, 1, 1.5, 4], 'the second pass starts after the bar and a bar of rest')
})

test('metronome: a fermata does not move the clicks off the notes', () => {
  const bar = n({ step: 'C' }) + n({ step: 'D', fermata: true }) + n({ step: 'E' }) + n({ step: 'F' })
  const r = rig(bar, 120, [bar], { metronome: true })
  r.scheduler.start()
  r.run(6)
  const t = r.output.clicks.map((c) => Math.round((c.when - START) * 1000) / 1000)
  assert.deepEqual(t.slice(0, 5), [0, 0.5, 1.5, 2, 2.5], 'no clicks while the note is held; the next beat is the next note')
  const notes = r.output.notes.map((x) => Math.round((x.spec.when - START) * 1000) / 1000)
  assert.deepEqual(notes.slice(0, 5), [0, 0.5, 1.5, 2, 2.5], 'the audio is held for twice the note, and the clicks are on the notes')
})

// --- 5.2 rest between repeats, a tempo change in the silence ---

test('loop rest: a tempo change in the silence goes on from the same beat at the new tempo (no restart, the clicks follow)', () => {
  const bar = n({}).repeat(4)
  const r = rig(bar, 120, [bar], { metronome: true })
  const span = loopSpanOf(r.timeline, { start: 0, end: 0 }, 1)! // 4 beats of music, 4 of rest
  r.scheduler.start(0, { loop: span })
  r.run(3) // the bar ends at 2.06 s; the rest runs until 4.06 s; clicks at beats 4-7 (2.06, 2.56, 3.06, 3.56 s) are on the way
  assert.equal(r.scheduler.positionAt(3).resting, true)
  const notes = r.output.notes.length
  const clicks = r.output.clicks.length
  r.scheduler.setBpm(60) // 3 s is beat 5.88 of 8: 2.12 beats left, 2.12 s at 60 bpm
  assert.equal(r.scheduler.running, true)
  assert.equal(r.scheduler.positionAt(3).resting, true, 'still resting, at the same beat')
  assert.ok(Math.abs(r.scheduler.positionAt(3).beat - (3 - START) / 0.5) < 1e-9, 'the beat reached did not move')
  // A tempo control sends several changes in a row: the rest must not collapse.
  r.scheduler.setBpm(50)
  r.scheduler.setBpm(60)
  assert.equal(r.scheduler.positionAt(3).resting, true)
  assert.ok(Math.abs(r.scheduler.positionAt(3).beat - (3 - START) / 0.5) < 1e-9)
  r.run(6)
  assert.equal(r.output.notes.length > notes, true)
  const next = r.output.notes[notes]!
  assert.equal(next.spec.attack, true)
  close(next.spec.when, 3 + (8 - (3 - START) / 0.5), 'the next pass of bar 1 begins when what is left of the rest has gone (2.12 beats, at 60 bpm)')
  close(r.output.notes[notes + 1]!.spec.when - next.spec.when, 1, 'and the bar goes on at one second a beat')
  // The clicks of the rest went on, without a gap, and the first beat of the next pass is on its note.
  const after = r.output.clicks.slice(clicks).map((c) => c.when)
  assert.ok(after.length >= 3)
  assert.ok(Math.abs(after[0]! - (3 + (7 - (3 - START) / 0.5))) < 1e-9, 'the last beat of the rest, at the new tempo')
  assert.ok(Math.abs(after[1]! - next.spec.when) < 1e-9, 'then the downbeat of the next pass together with its first note')
  assert.equal(r.output.clicks.slice(clicks)[1]!.accent, true)
})

// --- 5.3 accent ---

test('accent: the note-on carries the attack gain above its level and the fall-back time; its neighbours carry none', () => {
  const r = rig(n({}) + n({ accent: true }) + n({}))
  r.scheduler.start()
  r.run(3)
  const [a, b, c] = r.output.notes.map((x) => x.spec)
  assert.equal(a!.accent, undefined)
  assert.equal(c!.accent, undefined)
  assert.equal(b!.gain, a!.gain, 'the level is the dynamic level')
  assert.ok(b!.accent!.gain > a!.gain && b!.accent!.gain > c!.gain, 'the attack is above the neighbours')
  assert.ok(Math.abs(20 * Math.log10(b!.accent!.gain / b!.gain) - 4) < 1e-9)
  assert.equal(b!.accent!.decay, PLAYBACK_TUNING.accentDecay)
  assert.equal(PLAYBACK_TUNING.accentDecay, 0.15, 'back at the level within 150 ms')
})

// --- 5.4 swapping the timeline (switching instrument) ---

test('timeline swap: the notes to come use the new pitches at the times they already had, nothing restarts', () => {
  const score = scoreOf([{ body: n({ step: 'C' }) + n({ step: 'D' }) + n({ step: 'E' }) + n({ step: 'F' }) }])
  const r = rig(n({ step: 'C' }) + n({ step: 'D' }) + n({ step: 'E' }) + n({ step: 'F' }))
  r.scheduler.start()
  r.run(0.7) // C and D have started
  assert.equal(r.output.notes.length, 2)
  assert.equal(r.scheduler.useTimeline(buildTimeline(score, PIANO)), true)
  assert.equal(r.output.notes.length, 2, 'no note started again')
  r.run(3)
  assert.equal(r.output.notes.length, 4)
  assert.deepEqual(
    r.output.notes.map((x) => x.spec.midi[0]),
    [60 - 14, 62 - 14, 64, 65],
    'C and D from the tenor sax, E and F from the piano',
  )
  r.output.notes.forEach((note, k) => close(note.spec.when, START + k * 0.5, 'the times did not change'))
  assert.equal(r.ended(), 1)
  // Another score is refused.
  const other = scoreOf([{ body: n({ step: 'C' }) }])
  assert.equal(r.scheduler.useTimeline(buildTimeline(other, ALTO_SAX)), false)
  assert.equal(r.scheduler.useTimeline(buildTimeline(scoreOf([{ body: n({ step: 'C', type: 'half' }) + n({}) + n({}) + n({}) }]), TENOR_SAX)), false)
})
