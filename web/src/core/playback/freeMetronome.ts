import type { Frac } from '../score/rational.ts'
import { PLAYBACK_TUNING } from './scheduler.ts'
import type { ClickHandle, Clock, NoteOutput, TimerApi } from './scheduler.ts'

/*
 * The metronome on its own (change steady-notes-and-free-metronome, design D1): clicks on every beat
 * while no music plays, on the same clock, timer and click output as the scheduler. `Player` owns it.
 *
 * It hands the output at most one click ahead, and only within the lookahead window, and keeps the
 * handle of that click. So whatever takes over (Play, a tempo change, stop) can cancel the one click
 * that has not sounded yet, instead of it sounding off the new grid. Clicks are spaced from the last
 * one that sounded, so a tempo change takes effect from the next click without a jump in phase.
 */

const num = (f: Frac): number => f.n / f.d

export interface FreeMetronomeOptions {
  clock: Clock
  output: NoteOutput
  timer?: TimerApi
  /** Quarter-note beats per minute (the scheduler's unit). */
  bpm: number
  /** The beat, in quarter notes: one click per beat. */
  spacing: Frac
  /** Beats in a bar: the first of every `beatsPerBar` clicks is accented. */
  beatsPerBar: number
  lookahead?: number
  tickMs?: number
  /** Seconds between `start()` and the first click, so the first one is scheduled, not late. */
  startDelay?: number
}

const realTimer: TimerApi = {
  set: (fn, ms) => globalThis.setInterval(fn, ms),
  clear: (h) => globalThis.clearInterval(h as number),
}

interface Pending {
  when: number
  /** Its beat number from the start (0 is the first click, accented). */
  beat: number
  handle: ClickHandle | void
}

export class FreeMetronome {
  private readonly clock: Clock
  private readonly output: NoteOutput
  private readonly timer: TimerApi
  private readonly lookahead: number
  private readonly tickMs: number
  private readonly startDelay: number
  private bpmValue: number
  private spacingValue: Frac
  private perBar: number

  private timerHandle: unknown
  private active = false
  /** The time and beat number of the next click to hand out. */
  private nextWhen = 0
  private nextBeat = 0
  /** The last click that has sounded (its time is at or before now), for spacing the next one. */
  private lastSounded: { when: number; beat: number } | undefined
  /** The one click handed to the output that may not have sounded yet. */
  private pending: Pending | undefined

  constructor(options: FreeMetronomeOptions) {
    this.clock = options.clock
    this.output = options.output
    this.timer = options.timer ?? realTimer
    this.lookahead = options.lookahead ?? PLAYBACK_TUNING.lookahead
    this.tickMs = options.tickMs ?? PLAYBACK_TUNING.tickMs
    this.startDelay = options.startDelay ?? PLAYBACK_TUNING.startDelay
    this.bpmValue = options.bpm
    this.spacingValue = options.spacing
    this.perBar = Math.max(1, Math.round(options.beatsPerBar))
  }

  get running(): boolean {
    return this.active
  }

  /** Quarter-note beats per minute. */
  get bpm(): number {
    return this.bpmValue
  }

  get beatsPerBar(): number {
    return this.perBar
  }

  /** Seconds between two clicks. */
  private interval(): number {
    return num(this.spacingValue) * (60 / this.bpmValue)
  }

  /** Starts clicking: the first click, accented, comes `startDelay` from now. Does nothing while running. */
  start(): void {
    if (this.active) return
    this.active = true
    this.nextWhen = this.clock.currentTime + this.startDelay
    this.nextBeat = 0
    this.lastSounded = undefined
    this.pending = undefined
    this.timerHandle = this.timer.set(() => this.tick(), this.tickMs)
    this.tick()
  }

  /** Stops: the click handed out that has not sounded yet is cancelled, and nothing more is handed out. */
  stop(): void {
    if (!this.active) return
    this.active = false
    // Only a timer this metronome set is cleared: a shared timer may be driving the scheduler too.
    if (this.timerHandle !== undefined) this.timer.clear(this.timerHandle)
    this.timerHandle = undefined
    this.cancelPending()
  }

  /** Changes the tempo (quarter bpm); the next click is spaced from the last one at the new tempo. */
  setBpm(bpm: number): void {
    if (bpm === this.bpmValue) return
    this.bpmValue = bpm
    this.respace()
    this.tick()
  }

  /**
   * Changes the beat, the beats in a bar and the tempo together (a new beat unit changes all three:
   * one at a time, the metronome would hand out a click at a spacing that is neither the old nor the
   * new one). The next click is spaced from the last one by the new beat; when the bar is counted in
   * a different number of beats, the next click starts a new bar, so the accent never lands in the
   * middle of one.
   */
  setBeat(spacing: Frac, beatsPerBar: number, bpm: number = this.bpmValue): void {
    const perBar = Math.max(1, Math.round(beatsPerBar))
    const same = spacing.n * this.spacingValue.d === this.spacingValue.n * spacing.d && perBar === this.perBar && bpm === this.bpmValue
    if (same) return
    const newBar = perBar !== this.perBar
    this.spacingValue = spacing
    this.perBar = perBar
    this.bpmValue = bpm
    this.respace()
    if (newBar && this.active) this.nextBeat = Math.ceil(this.nextBeat / perBar) * perBar
    this.tick()
  }

  /** Takes back the click that has not sounded and sets the next one at the current spacing (the caller hands it out). */
  private respace(): void {
    if (!this.active) return
    const now = this.clock.currentTime
    this.settle(now)
    const pending = this.cancelPending()
    // The click taken back keeps its beat number, so the count of the bar goes on.
    if (pending) this.nextBeat = pending.beat
    this.nextWhen = this.lastSounded ? Math.max(this.lastSounded.when + this.interval(), now) : (pending?.when ?? this.nextWhen)
  }

  /** The pending click counts as sounded once its time has come. */
  private settle(now: number): void {
    const pending = this.pending
    if (pending && pending.when <= now) {
      this.lastSounded = { when: pending.when, beat: pending.beat }
      this.pending = undefined
    }
  }

  private cancelPending(): Pending | undefined {
    const pending = this.pending
    this.pending = undefined
    if (!pending) return undefined
    if (pending.when > this.clock.currentTime) {
      pending.handle?.cancel()
      return pending
    }
    this.lastSounded = { when: pending.when, beat: pending.beat }
    return undefined
  }

  private tick(): void {
    if (!this.active) return
    const now = this.clock.currentTime
    this.settle(now)
    // At most one click ahead: the next one is handed out only once the last one has sounded.
    if (this.pending) return
    // A timer that woke very late (the page was busy): the beats that went by are skipped, on the same
    // grid, instead of sounding in a burst. A click that is only a little late sounds now, as the scheduler does.
    const step = this.interval()
    if (now - this.nextWhen > this.lookahead) {
      const missed = Math.ceil((now - this.nextWhen) / step - 1e-9)
      this.nextWhen += missed * step
      this.nextBeat += missed
    }
    if (this.nextWhen >= now + this.lookahead) return
    const when = Math.max(this.nextWhen, now)
    const beat = this.nextBeat
    const handle = this.output.click?.({ when, accent: beat % this.perBar === 0 })
    this.pending = { when, beat, handle }
    this.nextWhen += step
    this.nextBeat = beat + 1
  }
}
