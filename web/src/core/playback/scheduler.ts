import type { Frac } from '../score/rational.ts'
import { ZERO, add, cmp, frac, mul, sub } from '../score/rational.ts'
import type { BeatClick, LoopSpan, PlaybackEvent, Timeline } from './timeline.ts'

export type { LoopSpan } from './timeline.ts'

/*
 * The lookahead scheduler (task 10.3, design D8).
 *
 * A timer wakes every few milliseconds; each time it hands the output every
 * note-on and note-off that falls inside the next `lookahead` seconds, with an
 * exact audio-clock time. Beats are converted to seconds only here, with the
 * current tempo, so tempo never changes pitch. The scheduler knows nothing
 * about Web Audio: it drives a `NoteOutput` (webaudio.ts implements it, tests
 * fake it).
 *
 * The metronome (practice-app design D10) is a track of beats laid out with the notes. Its actions
 * are always scheduled and only sounded while the metronome is on, so switching it needs no restart:
 * the next click that has not sounded yet is the first one, and switching it off stops the clicks
 * from the next lookahead window on.
 */

/**
 * The scheduler counts quarter-note beats per minute. The user's range (30-200 in the beat unit,
 * see tempo.ts) is enforced by the player; this is only a sanity range wide enough for any unit.
 */
export const SCHEDULER_BPM_MIN = 5
export const SCHEDULER_BPM_MAX = 800
const clampBpm = (bpm: number): number => Math.min(SCHEDULER_BPM_MAX, Math.max(SCHEDULER_BPM_MIN, bpm))

/** Tunable by ear (task 11.4). */
export const PLAYBACK_TUNING = {
  /** Seconds scheduled ahead of the audio clock. */
  lookahead: 0.1,
  /** Timer period in milliseconds. */
  tickMs: 25,
  /** Gap between pressing Play and the first note, so the first note is scheduled, not late. */
  startDelay: 0.06,
  /** Fade-in of a fresh attack (the sample carries its own attack). */
  attackFade: 0.005,
  /** Crossfade between two slurred notes. */
  legatoFade: 0.04,
  /** Fade-out at the end of a normal note and of a staccato note. */
  releaseFade: 0.06,
  staccatoRelease: 0.02,
  /** Fade-out when playback is stopped. */
  stopFade: 0.03,
  /** An accented note falls back from its attack gain to its level this long after it starts. */
  accentDecay: 0.15,
} as const

export interface NoteOnSpec {
  /** Audio-clock time, seconds. */
  when: number
  /** Concert MIDI notes. */
  midi: number[]
  gain: number
  /** True: play the sample from its start. False: slurred, start in the sustain section and fade in (a set that always strikes, `attack: 'always'`, starts it from the attack anyway). */
  attack: boolean
  /** Fade-in length in seconds. */
  fade: number
  /** The sounding note this one slurs from; the output fades it out over `fade` from `when`. */
  join?: VoiceHandle
  /**
   * An accent: the note is at `gain` (above the `gain` of the note) at the end of its fade-in and falls
   * back to `gain` `decay` seconds after `when`.
   */
  accent?: { gain: number; decay: number }
}

export interface VoiceHandle {
  /** Fade out so that the sound has ended at `when + fade`. */
  release(when: number, fade: number): void
  /** Drop a note that has not started yet. */
  cancel(): void
}

export interface ClickSpec {
  /** Audio-clock time, seconds. */
  when: number
  /** The first click of a count-in, and the first beat of each bar of the metronome, is accented. */
  accent: boolean
}

export interface NoteOutput {
  noteOn(spec: NoteOnSpec): VoiceHandle
  /** A count-in or metronome click (optional: an output without it plays them silently). */
  click?(spec: ClickSpec): void
}

/** A count-in: `clicks` clicks, `spacing` beats apart, ending where the first note starts. */
export interface CountIn {
  clicks: number
  spacing: Frac
}

export interface StartOptions {
  /** Seconds between the call and the first click or note. */
  delay?: number
  countIn?: CountIn
  loop?: LoopSpan
}

export interface Clock {
  readonly currentTime: number
}

export interface TimerApi {
  set(fn: () => void, ms: number): unknown
  clear(handle: unknown): void
}

const realTimer: TimerApi = {
  set: (fn, ms) => globalThis.setInterval(fn, ms),
  clear: (h) => globalThis.clearInterval(h as number),
}

export interface SchedulerOptions {
  clock: Clock
  output: NoteOutput
  timer?: TimerApi
  lookahead?: number
  tickMs?: number
  startDelay?: number
  bpm?: number
  /** The metronome is on from the start (default off); `setMetronome` changes it while playing. */
  metronome?: boolean
  /** Called once when the last note has finished. */
  onEnd?: () => void
}

/** `click`: a count-in click (always sounds). `tick`: a metronome beat (sounds while the metronome is on). */
type ActionKind = 'click' | 'tick' | 'off' | 'on' | 'wrap' | 'end'

interface Action {
  /** Beat on the run's own axis: a looped pass k is shifted by k loop lengths (with the rest), so passes join exactly. */
  beat: Frac
  kind: ActionKind
  event?: PlaybackEvent
  /** Click number, 0-based. */
  click?: number
  /** A metronome beat: the first of its bar. */
  accent?: boolean
  /** A metronome beat that has been sent to the output. */
  sounded?: boolean
}

const KIND_ORDER: Record<ActionKind, number> = { click: 0, tick: 0, off: 1, on: 2, wrap: 3, end: 4 }

const num = (f: Frac): number => f.n / f.d

export interface Position {
  /** Beats from the start of the score (fractional). */
  beat: number
  /** The event sounding (or resting) at that time; undefined before the first note or after the end. */
  event: PlaybackEvent | undefined
  /** Playback has passed the end of the score. */
  finished: boolean
  /** During a count-in: which click is sounding (1-based) of how many. */
  count?: { n: number; of: number }
  /** Looping: the pass being played, 0 for the first. */
  loopPass?: number
  /** Looping: in the silence after a pass (`event` is undefined; `beat` runs on from the end of the loop through the silence). */
  resting?: true
}

export class Scheduler {
  private timelineValue: Timeline
  private readonly clock: Clock
  private readonly output: NoteOutput
  private readonly timer: TimerApi
  private readonly lookahead: number
  private readonly tickMs: number
  private readonly startDelay: number
  private readonly onEnd: (() => void) | undefined
  private bpmValue: number

  private timerHandle: unknown
  private actions: Action[] = []
  private next = 0
  private firstEvent = 0
  private firstBeat: Frac = ZERO
  private anchorTime = 0
  private anchorBeat: Frac | undefined
  private active = false
  /** The loop and count-in of the current run (a loop that does not apply is dropped). */
  private loop: LoopSpan | undefined
  /** One pass of the loop on the run's axis: the loop's bars plus the rest after them. */
  private loopLength: Frac = ZERO
  private loopEvents: PlaybackEvent[] = []
  private loopTicks: BeatClick[] = []
  private metronomeOn: boolean
  private countInSpec: CountIn | undefined
  private pass = 0
  /** Voices turned on in this run, by event index, with the time each one is over (Infinity while open). */
  private voices = new Map<number, { handle: VoiceHandle; endsAt: number }>()
  /** The note turned on last, for slur joins. */
  private lastOn: { index: number; voice: { handle: VoiceHandle; endsAt: number } } | undefined

  constructor(timeline: Timeline, options: SchedulerOptions) {
    this.timelineValue = timeline
    this.metronomeOn = options.metronome ?? false
    this.clock = options.clock
    this.output = options.output
    this.timer = options.timer ?? realTimer
    this.lookahead = options.lookahead ?? PLAYBACK_TUNING.lookahead
    this.tickMs = options.tickMs ?? PLAYBACK_TUNING.tickMs
    this.startDelay = options.startDelay ?? PLAYBACK_TUNING.startDelay
    this.onEnd = options.onEnd
    this.bpmValue = clampBpm(options.bpm ?? 80)
  }

  get timeline(): Timeline {
    return this.timelineValue
  }

  get running(): boolean {
    return this.active
  }

  get metronome(): boolean {
    return this.metronomeOn
  }

  /** Quarter-note beats per minute. */
  get bpm(): number {
    return this.bpmValue
  }

  /** The loop of the current run, or undefined when it is not looping. */
  get looping(): LoopSpan | undefined {
    return this.active ? this.loop : undefined
  }

  /** The only place a beat becomes seconds. */
  private timeOf(beat: Frac): number {
    return this.anchorTime + num(sub(beat, this.anchorBeat!)) * (60 / this.bpmValue)
  }

  /**
   * Starts playing at the beginning of an event (see `timeline.eventOfNote`), by default the first.
   * With `countIn`, clicks come first. With `loop`, playback runs on to the end of the loop range and
   * then repeats it for ever; a loop that ends before the start event is ignored.
   */
  start(fromEvent = 0, options: StartOptions = {}): void {
    this.halt(PLAYBACK_TUNING.stopFade)
    const events = this.timeline.events
    if (events.length === 0) return
    const first = Math.max(0, Math.min(fromEvent, events.length - 1))
    const firstStart = events[first]!.start
    let loop = options.loop
    if (loop && cmp(loop.end, loop.start) <= 0) loop = undefined
    if (loop && cmp(firstStart, loop.end) >= 0) loop = undefined
    const span = loop
    this.loopEvents = span ? events.filter((e) => cmp(e.start, span.start) >= 0 && cmp(e.start, span.end) < 0) : []
    if (this.loopEvents.length === 0) loop = undefined
    this.loop = loop
    this.loopLength = loop ? add(sub(loop.end, loop.start), loop.rest ?? ZERO) : ZERO
    const kept = loop
    this.loopTicks = kept ? this.timeline.clicks.filter((c) => cmp(c.start, kept.start) >= 0 && cmp(c.start, kept.end) < 0) : []
    const countIn = options.countIn && options.countIn.clicks > 0 ? options.countIn : undefined
    this.countInSpec = countIn
    this.firstEvent = first
    this.firstBeat = firstStart
    this.anchorTime = this.clock.currentTime + (options.delay ?? this.startDelay)
    this.anchorBeat = countIn ? sub(firstStart, mul(countIn.spacing, frac(countIn.clicks))) : firstStart
    this.pass = 0
    this.lastOn = undefined
    this.actions = this.buildPass(0)
    this.next = 0
    this.active = true
    this.timerHandle = this.timer.set(() => this.tick(), this.tickMs)
    this.tick()
  }

  /** Stops now; sounding notes fade out quickly. */
  stop(): void {
    this.halt(PLAYBACK_TUNING.stopFade)
  }

  /**
   * Changes the tempo. While playing this reschedules from the current note (design D8): the note
   * sounding now is started again, at the new tempo. During a count-in the count-in starts again.
   * In the silence after a loop pass nothing sounds, so nothing restarts: the beat reached stays
   * "now" and the rest, its clicks and the next pass go on at the new tempo.
   */
  setBpm(bpm: number): void {
    const next = clampBpm(bpm)
    if (next === this.bpmValue) return
    const now = this.clock.currentTime
    const where = this.active ? this.positionAt(now) : undefined
    if (where?.resting && this.anchorBeat) {
      // The beat now (on the run's axis, not the loop's) is the one that keeps its time: only the anchor time moves.
      const anchor = num(this.anchorBeat)
      const reached = anchor + (now - this.anchorTime) / (60 / this.bpmValue)
      this.bpmValue = next
      this.anchorTime = now - (reached - anchor) * (60 / next)
      return
    }
    this.bpmValue = next
    if (!where || where.finished) return
    const keep: StartOptions = { delay: 0.02, ...(this.loop ? { loop: this.loop } : {}) }
    if (where.count || !where.event) {
      this.start(this.firstEvent, { ...keep, ...(this.countInSpec ? { countIn: this.countInSpec } : {}) })
    } else {
      this.start(where.event.index, keep)
    }
  }

  /**
   * Switches the metronome on or off, without a restart. Switched on, the clicks start at the next
   * beat that has not passed (also one that lies in the lookahead window already handed out); switched
   * off, clicks already handed to the output within the window still sound.
   */
  setMetronome(on: boolean): void {
    if (this.metronomeOn === on) return
    this.metronomeOn = on
    if (!on || !this.active) return
    const now = this.clock.currentTime
    const due: Action[] = []
    for (let k = this.next - 1; k >= 0; k--) {
      const action = this.actions[k]!
      if (this.timeOf(action.beat) < now) break
      if (action.kind === 'tick' && !action.sounded) due.push(action)
    }
    for (const action of due.reverse()) this.perform(action, this.timeOf(action.beat), now)
  }

  /**
   * Swaps in another timeline of the same score, for instance after the instrument changed (only the
   * pitches differ). Nothing restarts: the notes sounding keep sounding and the notes to come use
   * the new timeline, at the times they already had. Returns false (and changes nothing) when the
   * timeline is not of the same music.
   */
  useTimeline(timeline: Timeline): boolean {
    const old = this.timelineValue.events
    const events = timeline.events
    if (events.length !== old.length || events.some((e, i) => e.start.n !== old[i]!.start.n || e.start.d !== old[i]!.start.d)) return false
    this.timelineValue = timeline
    for (const action of this.actions) if (action.event) action.event = events[action.event.index]!
    this.loopEvents = this.loopEvents.map((e) => events[e.index]!)
    return true
  }

  /** Where playback is at an audio-clock time (the cursor passes a latency-corrected time). */
  positionAt(audioTime: number): Position {
    if (!this.anchorBeat) return { beat: 0, event: undefined, finished: false }
    const anchor = num(this.anchorBeat)
    const beat = anchor + (audioTime - this.anchorTime) / (60 / this.bpmValue)
    if (beat < anchor) return { beat, event: undefined, finished: false }
    const firstBeat = num(this.firstBeat)
    if (beat < firstBeat) {
      const clicks = this.countInSpec?.clicks ?? 0
      const spacing = this.countInSpec ? num(this.countInSpec.spacing) : 1
      const n = Math.min(clicks, Math.floor((beat - anchor) / spacing) + 1)
      return { beat, event: undefined, finished: false, ...(clicks > 0 ? { count: { n, of: clicks } } : {}) }
    }
    if (this.loop && beat >= num(this.loop.end)) {
      const start = num(this.loop.start)
      const length = num(this.loopLength)
      const into = (beat - start) % length
      const passes = Math.floor((beat - start) / length)
      const inLoop = num(sub(this.loop.end, this.loop.start))
      if (into >= inLoop) {
        return { beat: num(this.loop.end) + (into - inLoop), event: undefined, finished: false, loopPass: passes, resting: true }
      }
      return { beat: start + into, event: this.timeline.eventAtBeat(start + into), finished: false, loopPass: passes }
    }
    if (beat >= num(this.timeline.end)) return { beat, event: undefined, finished: true }
    return { beat, event: this.timeline.eventAtBeat(beat), finished: false, ...(this.loop ? { loopPass: 0 } : {}) }
  }

  /** The actions of one pass, on the run's own beat axis (pass k of a loop is shifted by k loop lengths). */
  private buildPass(pass: number): Action[] {
    const events = this.timeline.events
    const loop = this.loop
    const offset = pass === 0 ? ZERO : mul(this.loopLength, frac(pass))
    const played =
      pass === 0
        ? events.slice(this.firstEvent).filter((e) => !loop || cmp(e.start, loop.end) < 0)
        : this.loopEvents
    const actions: Action[] = []
    if (pass === 0 && this.countInSpec) {
      const { clicks, spacing } = this.countInSpec
      for (let k = 0; k < clicks; k++) {
        actions.push({ beat: sub(this.firstBeat, mul(spacing, frac(clicks - k))), kind: 'click', click: k })
      }
    }
    // The metronome: the beats of this pass, and in a loop the beats of the silence after it.
    const ticks =
      pass === 0
        ? this.timeline.clicks.filter((c) => cmp(c.start, this.firstBeat) >= 0 && (!loop || cmp(c.start, loop.end) < 0))
        : this.loopTicks
    for (const c of ticks) actions.push({ beat: add(c.start, offset), kind: 'tick', accent: c.accent })
    for (const c of loop?.restClicks ?? []) actions.push({ beat: add(add(loop!.end, c.offset), offset), kind: 'tick', accent: c.accent })
    played.forEach((ev, i) => {
      if (ev.rest) return
      actions.push({ beat: add(ev.start, offset), kind: 'on', event: ev })
      // A slurred note is not released when the next note takes it over; at the end of a pass nothing does.
      const taken = ev.legatoNext && played[i + 1]?.index === ev.index + 1
      if (!taken) actions.push({ beat: add(add(ev.start, ev.sounding), offset), kind: 'off', event: ev })
    })
    if (loop) actions.push({ beat: add(add(loop.end, loop.rest ?? ZERO), offset), kind: 'wrap' })
    else actions.push({ beat: this.timeline.end, kind: 'end' })
    actions.sort((a, b) => cmp(a.beat, b.beat) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind])
    return actions
  }

  private halt(fade: number): void {
    if (this.timerHandle !== undefined) this.timer.clear(this.timerHandle)
    this.timerHandle = undefined
    const now = this.clock.currentTime
    for (const v of this.voices.values()) {
      if (v.endsAt > now) v.handle.release(now, fade)
    }
    this.voices.clear()
    this.lastOn = undefined
    this.actions = []
    this.active = false
  }

  private tick(): void {
    if (!this.active) return
    const now = this.clock.currentTime
    const horizon = now + this.lookahead
    for (;;) {
      if (this.next >= this.actions.length) {
        if (!this.loop) break
        this.pass++
        this.actions = this.buildPass(this.pass)
        this.next = 0
        continue
      }
      const action = this.actions[this.next]!
      const when = this.timeOf(action.beat)
      // The end marker waits for the audio clock, so `onEnd` fires when the last note is over.
      if (action.kind === 'end' ? when > now : when >= horizon) break
      this.next++
      this.perform(action, Math.max(when, now), now)
    }
    if (!this.loop && this.next >= this.actions.length) {
      this.timer.clear(this.timerHandle)
      this.timerHandle = undefined
      this.active = false
      this.onEnd?.()
    }
  }

  private perform(action: Action, when: number, now: number): void {
    const ev = action.event
    if (action.kind === 'click') {
      this.output.click?.({ when, accent: action.click === 0 })
    } else if (action.kind === 'tick') {
      if (this.metronomeOn) {
        this.output.click?.({ when, accent: !!action.accent })
        action.sounded = true
      }
    } else if (action.kind === 'on' && ev) {
      const previous = this.lastOn
      const joined = !ev.attack && previous !== undefined && previous.index === ev.index - 1 && previous.voice.endsAt === Number.POSITIVE_INFINITY
      const fade = joined ? PLAYBACK_TUNING.legatoFade : PLAYBACK_TUNING.attackFade
      const handle = this.output.noteOn({
        when,
        midi: ev.pitches,
        gain: ev.gain,
        attack: !joined,
        fade,
        ...(joined ? { join: previous.voice.handle } : {}),
        ...(ev.accent ? { accent: { gain: ev.attackGain, decay: PLAYBACK_TUNING.accentDecay } } : {}),
      })
      if (joined) previous.voice.endsAt = when + fade
      const voice = { handle, endsAt: Number.POSITIVE_INFINITY }
      this.voices.set(ev.index, voice)
      this.lastOn = { index: ev.index, voice }
    } else if (action.kind === 'off' && ev) {
      const voice = this.voices.get(ev.index)
      if (!voice) return
      const soundingSeconds = num(ev.sounding) * (60 / this.bpmValue)
      const base = ev.staccato ? PLAYBACK_TUNING.staccatoRelease : PLAYBACK_TUNING.releaseFade
      const fade = Math.min(base, soundingSeconds / 2)
      // The sound has ended at `when`: the fade-out lies before it.
      const from = Math.max(when - fade, now)
      voice.handle.release(from, Math.max(when - from, 0))
      voice.endsAt = when
    }
  }
}
