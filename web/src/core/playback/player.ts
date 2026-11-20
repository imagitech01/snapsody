import { instrumentById } from '../instruments/instruments.ts'
import type { Instrument } from '../instruments/instruments.ts'
import type { Score, VoiceScore } from '../score/model.ts'
import { firstVoice, voiceView } from '../score/model.ts'
import { frac } from '../score/rational.ts'
import type { Frac } from '../score/rational.ts'
import { FreeMetronome } from './freeMetronome.ts'
import { PITCH_REFERENCE_DEFAULT, clampPitchReference } from './samples.ts'
import { Scheduler } from './scheduler.ts'
import type { Clock, CountIn, NoteOutput, Position, StartOptions, TimerApi } from './scheduler.ts'
import { DEFAULT_TEMPO, clampTempo, countInClicks } from './tempo.ts'
import type { Quarters } from './tempo.ts'
import type { LoopRest, LoopSpan, PlaybackEvent, Timeline } from './timeline.ts'
import { buildTimeline, loopSpanOf } from './timeline.ts'
import type { TimelineOptions } from './timeline.ts'
import { outputLatency } from './webaudio.ts'

/*
 * The player: what the UI talks to (tasks 10.5 and group 12). It owns the audio backend and the
 * practice state: tempo (30-200 in the exercise's beat unit, changeable live), count-in, an
 * optional bar-range loop, pause/resume and the start position set by tapping a note.
 *
 * Position rules:
 *  - Play from stopped starts at the tapped position (else the loop start, else the beginning).
 *  - Pause remembers the note that was heard; Play again resumes at that note, without a count-in.
 *  - Stop forgets the pause position and returns to the tapped position.
 *  - Seeking while playing jumps there and carries on (no count-in); seeking while stopped or
 *    paused only moves the position.
 *
 * Live changes while playing: the metronome and the instrument take effect without a restart (the
 * metronome from the next beat, the instrument from the next note); tempo, loop and rest continue
 * from the current note, which starts again.
 *
 * The metronome on its own (design D1 of steady-notes-and-free-metronome): switching the metronome on
 * while stopped or paused starts a `FreeMetronome` at once, in the time signature of the bar Play would
 * start from. It is a flag next to the state (`metronomeAlone`), not a state of its own, so nothing
 * that reads the state (the Play button) changes. Only `setMetronome(true)` starts it: a player made
 * with `metronome: true` stays silent. Play stops it before the piece starts; pause, stop and the end
 * of the piece never start it again.
 */

export interface AudioBackend extends Clock {
  readonly output: NoteOutput
  readonly outputLatency?: number
  readonly baseLatency?: number
  /**
   * Makes the output play from the sample set of an instrument's sound (`Instrument.sound`, the folder
   * `samples/<sound>/`), loading it when it is not loaded yet. Notes already sounding are not
   * touched. Every set loaded stays there for the notes that name their sound (`NoteOnSpec.sound`: the
   * parts of a piece can have different instruments), and the last one asked for is what notes that name
   * none play from. Optional: an output with a single sound ignores it.
   */
  useSound?(sound: string): Promise<void>
  /** Tunes the output to A4 = `hz` (notes that start from now on). Optional. */
  setPitchReference?(hz: number): void
  /** Releases the audio context (optional; the exercise view keeps its backend for the life of the page). */
  close?(): void
}

export type PlayerState = 'stopped' | 'loading' | 'playing' | 'paused'

/** Bars to loop, as indices into score.measures, both inclusive. */
export interface LoopRange {
  start: number
  end: number
}

export interface PlayerOptions {
  /**
   * The instrument to start with: its transposition decides the sounding pitch (the written notes never
   * change) and its `sound` the sample folder. `setInstrument` changes it, also while playing.
   */
  instrument: Instrument
  /** The score to play, read again on every `play()` so edits are always heard (task 10.5). */
  loadScore: () => Score | Promise<Score>
  /** Creates the audio backend for the instrument in use; called inside the Play press (a user gesture), once. */
  backend: (instrument: Instrument) => Promise<AudioBackend>
  timer?: TimerApi
  /** Tempo in beats per minute of the beat unit. */
  bpm?: number
  /** The beat unit in quarter notes (default 1: a quarter note). */
  beatUnit?: Quarters
  countIn?: boolean
  loop?: LoopRange
  /** Bars of silence after each pass of the loop (default 0). */
  loopRest?: LoopRest
  /** The metronome (default off). */
  metronome?: boolean
  /** Your line, as the piece is practised (design D5): a part and for a two-staff part a hand. Absent: the first part, both hands. */
  part?: TimelineOptions['part']
  /** The parts and hands that do not sound under "Plays along": 'P1', 'P2:left' ... Absent: none. */
  silent?: readonly string[]
  /** Your line sounds (default). `setOwnLine` changes it, also while playing. */
  ownLine?: boolean
  /** A4 in Hz, 430 to 450 (default 440): all sound follows it. */
  pitchReference?: number
  onState?: (state: PlayerState) => void
  /** Called when the metronome starts or stops sounding on its own (`metronomeAlone`). */
  onMetronomeAlone?: (sounding: boolean) => void
}

export const DEFAULT_BPM = DEFAULT_TEMPO

/** The sample folders, besides the instrument's own, that the events of a timeline sound with (a piano part's piano). */
function otherSounds(timeline: Timeline, instrument: Instrument): string[] {
  const sounds = new Set<string>()
  for (const ev of timeline.events) sounds.add(instrumentById(ev.sound)?.sound ?? ev.sound)
  sounds.delete(instrument.sound)
  return [...sounds]
}

const num = (f: Frac): number => f.n / f.d

const clampRest = (bars: number): LoopRest => (bars >= 2 ? 2 : bars >= 1 ? 1 : 0)

export class Player {
  private readonly o: PlayerOptions
  private backendPromise: Promise<AudioBackend> | undefined
  private bpmValue: number
  private unit: Quarters
  private countInOn: boolean
  private loopRange: LoopRange | undefined
  private loopRestBars: LoopRest
  private metronomeOn: boolean
  private ownLineOn: boolean
  private partValue: TimelineOptions['part'] | undefined
  private silentValue: readonly string[]
  private reference: number
  private instrumentValue: Instrument
  /** The instrument whose pitches the current run plays (`instrumentValue` is ahead of it while a switch is loading). */
  private runInstrument: Instrument
  /** Counts the instrument switches, so that a switch that is overtaken by a later one does nothing. */
  private switchId = 0
  private stateValue: PlayerState = 'stopped'
  private runId = 0
  private scheduler: Scheduler | undefined
  private timelineValue: Timeline | undefined
  private audio: AudioBackend | undefined
  /** The first voice of the score of the current run: what the count-in's bar counts are read from (the bars are shared). */
  private runScore: VoiceScore | undefined
  /** The whole score of the current run, for the timeline of another instrument. */
  private runLoaded: Score | undefined
  /** Where Play starts from after Stop: the last note the user tapped. */
  private seekNoteId: string | undefined
  /** Where Play resumes after a pause (the note heard when paused). */
  private pausedNoteId: string | undefined
  /** The first note of the current run, for pausing during a count-in. */
  private runStartNoteId: string | undefined
  /** The metronome sounding on its own, while no music plays. */
  private alone: FreeMetronome | undefined
  /** The score and bar it counts, for a beat-unit change while it sounds. */
  private aloneBar: { score: VoiceScore; barIndex: number } | undefined
  /** Counts the starts and stops of the metronome on its own, so that a start still loading when it is overtaken does nothing. */
  private aloneId = 0
  /** A start of the metronome on its own that is waiting for the backend or the score. */
  private aloneStarting: Promise<void> | undefined

  constructor(options: PlayerOptions) {
    this.o = options
    this.bpmValue = clampTempo(options.bpm ?? DEFAULT_BPM)
    this.unit = options.beatUnit ?? frac(1)
    this.countInOn = options.countIn ?? false
    this.loopRange = options.loop
    this.loopRestBars = clampRest(options.loopRest ?? 0)
    this.metronomeOn = options.metronome ?? false
    this.ownLineOn = options.ownLine ?? true
    this.partValue = options.part
    this.silentValue = options.silent ?? []
    this.reference = clampPitchReference(options.pitchReference ?? PITCH_REFERENCE_DEFAULT)
    this.instrumentValue = options.instrument
    this.runInstrument = options.instrument
  }

  get state(): PlayerState {
    return this.stateValue
  }

  /** Tempo in beats per minute of the beat unit. */
  get bpm(): number {
    return this.bpmValue
  }

  get beatUnit(): Quarters {
    return this.unit
  }

  get countIn(): boolean {
    return this.countInOn
  }

  get loop(): LoopRange | undefined {
    return this.loopRange
  }

  /** Bars of silence after each pass of the loop. */
  get loopRest(): LoopRest {
    return this.loopRestBars
  }

  get metronome(): boolean {
    return this.metronomeOn
  }

  /** Your line sounds. */
  get ownLine(): boolean {
    return this.ownLineOn
  }

  /** A4 in Hz. */
  get pitchReference(): number {
    return this.reference
  }

  /** The instrument in use. */
  get instrument(): Instrument {
    return this.instrumentValue
  }

  /** The note Play will start from (paused position, else the tapped one), if any. */
  get startNoteId(): string | undefined {
    return this.pausedNoteId ?? this.seekNoteId
  }

  /** The timeline of the current (or last) run. */
  get timeline(): Timeline | undefined {
    return this.timelineValue
  }

  get currentScheduler(): Scheduler | undefined {
    return this.scheduler
  }

  /** True while the metronome sounds on its own (no music playing). */
  get metronomeAlone(): boolean {
    return this.alone !== undefined
  }

  get backendInstance(): AudioBackend | undefined {
    return this.audio
  }

  private setState(state: PlayerState): void {
    if (this.stateValue === state) return
    this.stateValue = state
    this.o.onState?.(state)
  }

  /** What the timeline is built for: your line, and what does not sound. */
  private timelineOptions(): TimelineOptions {
    return { ...(this.partValue ? { part: this.partValue } : {}), silent: this.silentValue }
  }

  /** Quarter-note beats per minute for the scheduler. */
  private quarterBpm(): number {
    return this.bpmValue * num(this.unit)
  }

  /** The loop, with its rest, as beats of a timeline, or undefined when there is none or it is not in the score. */
  private loopSpan(timeline: Timeline): LoopSpan | undefined {
    return this.loopRange ? loopSpanOf(timeline, this.loopRange, this.loopRestBars) : undefined
  }

  private countInFor(score: VoiceScore, barIndex: number): CountIn {
    return { clicks: countInClicks(score, barIndex, this.unit), spacing: this.unit }
  }

  /**
   * Plays, or resumes after a pause. From stopped it starts at the tapped note, else the start of the
   * loop, else the beginning; `fromNoteId` overrides that. The score is read (and the timeline built)
   * now, never cached from an earlier play.
   */
  async play(options: { fromNoteId?: string } = {}): Promise<void> {
    const resuming = this.stateValue === 'paused' && !options.fromNoteId
    // The music takes over from the metronome on its own at once, before anything loads: its click
    // that has not sounded yet is taken back, so it cannot sound over the count-in off the grid.
    this.stopMetronomeAlone()
    this.runId++
    this.scheduler?.stop()
    const run = this.runId
    let keepBackend = false
    this.setState('loading')
    try {
      this.backendPromise ??= this.o.backend(this.instrumentValue)
      const [audio, loaded] = await Promise.all([this.backendPromise, Promise.resolve(this.o.loadScore())])
      const score = voiceView(loaded, firstVoice(loaded))
      if (run !== this.runId) return
      // The sound of the instrument in use (it may have been switched since the backend was made, or while this loaded),
      // and of the other instruments the parts need (a piano part is played by the piano), loaded once each.
      let instrument = this.instrumentValue
      let timeline: Timeline
      // What the timeline was made for: a change of it while the sounds load (the instrument, your part, what is silent) is made again.
      const wanted = (): string => JSON.stringify([this.instrumentValue.id, this.partValue ?? null, this.silentValue])
      let made = wanted()
      for (;;) {
        timeline = buildTimeline(loaded, instrument, this.timelineOptions())
        try {
          for (const sound of otherSounds(timeline, instrument)) await audio.useSound?.(sound)
          // Last, so that it is the sound notes that name none play from.
          await audio.useSound?.(instrument.sound)
        } catch (e) {
          keepBackend = true // the backend is fine; its sound did not load
          throw e
        }
        if (run !== this.runId) return
        if (wanted() === made) break
        made = wanted()
        instrument = this.instrumentValue
      }
      audio.setPitchReference?.(this.reference)
      this.audio = audio
      this.runScore = score
      this.runLoaded = loaded
      this.runInstrument = instrument
      this.timelineValue = timeline
      const loop = this.loopSpan(timeline)
      const first = this.startEvent(timeline, options.fromNoteId)
      this.pausedNoteId = undefined
      this.runStartNoteId = first?.noteIds[0]
      const start: StartOptions = {}
      if (loop) start.loop = loop
      if (this.countInOn && !resuming && first) start.countIn = this.countInFor(score, first.barIndex)
      const scheduler = new Scheduler(timeline, {
        clock: audio,
        output: audio.output,
        bpm: this.quarterBpm(),
        metronome: this.metronomeOn,
        ownLine: this.ownLineOn,
        ...(this.o.timer ? { timer: this.o.timer } : {}),
        onEnd: () => {
          if (run === this.runId) this.setState('stopped')
        },
      })
      this.scheduler = scheduler
      this.setState('playing')
      // Paused, stopped or played again by a listener of the state: that run wins, this one never sounds.
      if (run !== this.runId) return
      scheduler.start(first?.index ?? 0, start)
    } catch (e) {
      if (run === this.runId) {
        // A run that failed leaves nothing sounding: the music would play on with the player stopped and the screen not following it.
        this.scheduler?.stop()
        this.setState('stopped')
      }
      if (!keepBackend) this.backendPromise = undefined
      throw e
    }
  }

  /** The event Play starts from: `fromNoteId`, else the paused or tapped note, else the start of the loop, else the first. */
  private startEvent(timeline: Timeline, fromNoteId?: string): PlaybackEvent | undefined {
    const startId = fromNoteId ?? this.startNoteId
    let from: PlaybackEvent | undefined = startId ? timeline.eventOfNote(startId) : undefined
    const loop = this.loopSpan(timeline)
    if (!from && loop) from = timeline.eventAtBeat(loop.start)
    return from ?? timeline.events.find((e) => e.own) ?? timeline.events[0]
  }

  /** Pauses; Play continues at the note that was heard. A pause during the count-in resumes at its start. */
  pause(): void {
    if (this.stateValue !== 'playing') {
      if (this.stateValue === 'loading') this.stop()
      return
    }
    const audio = this.audio
    const where = audio && this.scheduler ? this.scheduler.positionAt(audio.currentTime - outputLatency(audio)) : undefined
    this.runId++
    this.scheduler?.stop()
    if (where?.finished) {
      this.setState('stopped')
      return
    }
    // Paused in the silence between two passes: Play starts the next pass. During the count-in: the start of the run.
    const nextPass = where?.resting && this.timelineValue ? this.timelineValue.eventAtBeat(this.loopSpan(this.timelineValue)?.start ?? 0) : undefined
    this.pausedNoteId = where?.event?.noteIds[0] ?? nextPass?.noteIds[0] ?? this.runStartNoteId
    this.setState('paused')
  }

  /** Play when stopped or paused, pause when playing. */
  async toggle(): Promise<void> {
    if (this.stateValue === 'playing') this.pause()
    else if (this.stateValue !== 'loading') await this.play()
  }

  /** Stops the music, and the metronome on its own: Stop leaves nothing sounding. */
  stop(): void {
    this.stopMetronomeAlone()
    this.runId++
    this.scheduler?.stop()
    this.pausedNoteId = undefined
    this.setState('stopped')
  }

  /**
   * Moves the playback position to a note (tap-to-seek). While playing, playback jumps there and
   * continues; otherwise the next Play starts from it.
   */
  seek(noteId: string): void {
    this.seekNoteId = noteId
    if (this.stateValue === 'paused') this.pausedNoteId = noteId
    else this.pausedNoteId = undefined
    if (this.stateValue !== 'playing') return
    const timeline = this.timelineValue
    const event = timeline?.eventOfNote(noteId)
    if (!timeline || !event || !this.scheduler) return
    this.runStartNoteId = noteId
    const loop = this.loopSpan(timeline)
    this.scheduler.start(event.index, { delay: 0.02, ...(loop ? { loop } : {}) })
  }

  /** Changes the tempo; while playing, continues from the current note at the new tempo. Returns the tempo set. */
  setTempo(bpm: number): number {
    this.bpmValue = clampTempo(bpm)
    this.scheduler?.setBpm(this.quarterBpm())
    this.alone?.setBpm(this.quarterBpm())
    return this.bpmValue
  }

  /** Sets the beat unit tempo is counted in (the quarter bpm follows, and the beats of the metronome on its own). */
  setBeatUnit(unit: Quarters): void {
    this.unit = unit
    this.scheduler?.setBpm(this.quarterBpm())
    // The beat, the count of the bar and the quarter bpm change together, in one step.
    if (this.alone && this.aloneBar) this.alone.setBeat(unit, countInClicks(this.aloneBar.score, this.aloneBar.barIndex, unit), this.quarterBpm())
  }

  setCountIn(on: boolean): void {
    this.countInOn = on
  }

  /**
   * Sets or clears (undefined) the bar range to loop. Setting one makes Play start at the loop (the
   * tapped position is dropped); while playing it carries on from the current note and loops from
   * there. Clearing it while playing lets playback run on through the whole exercise.
   */
  setLoop(range: LoopRange | undefined): void {
    this.loopRange = range
    if (range) {
      this.seekNoteId = undefined
      this.pausedNoteId = undefined
    }
    this.restartHere()
  }

  /**
   * Sets the bars of silence after each pass of the loop (0, 1 or 2). While playing a loop it carries
   * on from the current note (which starts again) with the new rest; in the silence itself the loop
   * starts again from its first bar.
   */
  setLoopRest(bars: number): LoopRest {
    this.loopRestBars = clampRest(bars)
    if (this.loopRange) this.restartHere()
    return this.loopRestBars
  }

  /**
   * Continues with the current loop and rest from the note being played. In the silence between two
   * passes there is no such note: a loop starts again from its first bar, and when the loop is gone
   * the music goes on after where it ended. Nothing happens before the first note (the count-in).
   */
  private restartHere(): void {
    const { scheduler, timelineValue: timeline, audio } = this
    if (this.stateValue !== 'playing' || !scheduler || !timeline || !audio) return
    const where = scheduler.positionAt(audio.currentTime)
    const loop = this.loopSpan(timeline)
    let at = where.event?.index
    if (at === undefined && where.resting) {
      const was = scheduler.looping
      at = (loop ? timeline.eventAtBeat(loop.start) : was ? timeline.eventAtBeat(was.end) : undefined)?.index
      if (at === undefined) {
        if (!loop) this.stop() // nothing follows the loop
        return
      }
    }
    if (at === undefined) return
    scheduler.start(at, { delay: 0.02, ...(loop ? { loop } : {}) })
  }

  /**
   * Switches the metronome on or off, also while playing: no restart, the clicks start from the next
   * beat (see `Scheduler.setMetronome`). Switched on while stopped or paused, it sounds on its own at
   * once; this can be the first gesture, so the backend may be made here. Resolves when it sounds (or
   * at once when nothing has to start), and rejects, like a failed Play, when the backend cannot be
   * made; the setting stays on and nothing sounds. Switched off, it stops at once.
   */
  setMetronome(on: boolean): Promise<void> {
    this.metronomeOn = on
    this.scheduler?.setMetronome(on)
    if (!on) {
      this.stopMetronomeAlone()
      return Promise.resolve()
    }
    if (this.stateValue !== 'stopped' && this.stateValue !== 'paused') return Promise.resolve()
    return this.startMetronomeAlone()
  }

  /**
   * Your line on or off, also while playing: no restart. Its notes stop from the next event and the other parts
   * play on; switched on again, it is heard from the next event. The cursor follows it either way (see
   * `Scheduler.setOwnLine`).
   */
  setOwnLine(on: boolean): void {
    this.ownLineOn = on
    this.scheduler?.setOwnLine(on)
  }

  /** Sets your part and hand (absent: the first part, both hands). While playing it is heard at once (see `setPlayAlong`). */
  setPart(part: TimelineOptions['part'] | undefined): void {
    this.partValue = part
    this.swapTimeline()
  }

  /** Sets the parts and hands that do not sound ('P1', 'P2:left' ...). While playing it is heard at once (see `setPlayAlong`). */
  setSilent(silent: readonly string[]): void {
    this.silentValue = silent
    this.swapTimeline()
  }

  /**
   * Sets your part, what is silent and whether your line sounds, in one step (choosing another part changes all three).
   * Stopped or paused, the next Play uses them. While playing, the music restarts in place: the sounds the new
   * timeline needs are loaded (the old music goes on meanwhile), then the notes from the time reached on play as the new
   * timeline says, every part together (`Scheduler.replaceTimeline`).
   */
  setPlayAlong(part: TimelineOptions['part'] | undefined, silent: readonly string[], ownLine: boolean): void {
    this.partValue = part
    this.silentValue = silent
    this.ownLineOn = ownLine
    // With the new timeline, so that no note of the old one is judged by the new switch; at once when nothing plays.
    if (!this.swapTimeline()) this.scheduler?.setOwnLine(ownLine)
  }

  /** Counts the swaps of the timeline, so that a swap that is overtaken by a later one does nothing. */
  private swapId = 0

  /** Plays on with a timeline made for the part and the silent parts now set (only while playing). */
  private swapTimeline(): boolean {
    const { audio, scheduler, runLoaded: loaded } = this
    if (this.stateValue !== 'playing' || !audio || !scheduler || !loaded) return false
    const id = ++this.swapId
    void (async () => {
      const wanted = buildTimeline(loaded, this.runInstrument, this.timelineOptions())
      try {
        for (const sound of otherSounds(wanted, this.runInstrument)) await audio.useSound?.(sound)
        await audio.useSound?.(this.runInstrument.sound)
      } catch {
        // The sound did not load: the music goes on as it was, with your line as it was asked.
        if (id === this.swapId && this.scheduler === scheduler) scheduler.setOwnLine(this.ownLineOn)
        return
      }
      if (id !== this.swapId || this.stateValue !== 'playing' || this.scheduler !== scheduler) return
      // Made again after the waiting: the instrument or the options may have changed meanwhile.
      const timeline = buildTimeline(loaded, this.runInstrument, this.timelineOptions())
      scheduler.replaceTimeline(timeline, this.ownLineOn)
      this.timelineValue = timeline
    })()
    return true
  }

  /**
   * Silences the metronome on its own and leaves the setting as it is (the app going to the background,
   * the screen being left). It does not start again by itself.
   */
  stopMetronomeAlone(): void {
    this.aloneId++
    this.aloneStarting = undefined
    const alone = this.alone
    if (!alone) return
    this.alone = undefined
    this.aloneBar = undefined
    alone.stop()
    this.o.onMetronomeAlone?.(false)
  }

  private startMetronomeAlone(): Promise<void> {
    if (this.alone) return Promise.resolve()
    if (this.aloneStarting) return this.aloneStarting
    const id = ++this.aloneId
    // Made here, inside the gesture (an AudioContext must be created or resumed in one), before any await.
    const backend = (this.backendPromise ??= this.o.backend(this.instrumentValue))
    const starting = (async () => {
      let audio: AudioBackend
      try {
        audio = await backend
      } catch (e) {
        // Asked for again by the next gesture, as after a failed Play.
        if (this.backendPromise === backend) this.backendPromise = undefined
        if (id !== this.aloneId) return
        throw e
      }
      const loaded = await this.o.loadScore()
      const score = voiceView(loaded, firstVoice(loaded))
      // Switched off, played, stopped or silenced while it loaded: the later wish wins.
      if (id !== this.aloneId || !this.metronomeOn || (this.stateValue !== 'stopped' && this.stateValue !== 'paused')) return
      this.audio = audio
      // The bar Play would start from gives the beats of the bar, as it gives the count-in's.
      const first = this.startEvent(buildTimeline(loaded, this.instrumentValue, this.timelineOptions()))
      const barIndex = first?.barIndex ?? 0
      const alone = new FreeMetronome({
        clock: audio,
        output: audio.output,
        bpm: this.quarterBpm(),
        spacing: this.unit,
        beatsPerBar: countInClicks(score, barIndex, this.unit),
        ...(this.o.timer ? { timer: this.o.timer } : {}),
      })
      this.alone = alone
      this.aloneBar = { score, barIndex }
      alone.start()
      this.o.onMetronomeAlone?.(true)
    })().finally(() => {
      if (this.aloneStarting === starting) this.aloneStarting = undefined
    })
    this.aloneStarting = starting
    return starting
  }

  /** Sets A4 in Hz (a whole number from 430 to 450); the notes that start from now on follow it. Returns the value set. */
  setPitchReference(hz: number): number {
    this.reference = clampPitchReference(hz)
    this.audio?.setPitchReference?.(this.reference)
    return this.reference
  }

  /**
   * Switches the instrument. While playing it neither stops nor restarts: the sound of the new
   * instrument is loaded first (the old one keeps playing), then the notes still to come are played by
   * it, at the times they already had; the note sounding finishes in the old sound. Stopped or paused,
   * the next Play uses it. The written notes are not touched. Rejects when the sound cannot be loaded;
   * the instrument in use is then the old one again.
   */
  async setInstrument(instrument: Instrument): Promise<void> {
    if (instrument === this.instrumentValue) return
    this.instrumentValue = instrument
    const { audio, scheduler, runLoaded: loaded } = this
    if (this.stateValue !== 'playing' || !audio || !scheduler || !loaded) return
    const id = ++this.switchId
    try {
      await audio.useSound?.(instrument.sound)
    } catch (e) {
      if (id === this.switchId) this.instrumentValue = this.runInstrument
      throw e
    }
    // Overtaken by another switch, or paused, stopped or started again meanwhile: Play uses the instrument in use.
    if (id !== this.switchId || this.stateValue !== 'playing' || this.scheduler !== scheduler) return
    const timeline = buildTimeline(loaded, instrument, this.timelineOptions())
    if (!scheduler.useTimeline(timeline)) scheduler.replaceTimeline(timeline)
    this.timelineValue = timeline
    this.runInstrument = instrument
  }

  /** The position being heard now, with the count-in click and loop pass; only while playing. */
  positionNow(latency: number): Position | undefined {
    const audio = this.audio
    if (this.stateValue !== 'playing' || !audio || !this.scheduler) return undefined
    return this.scheduler.positionAt(audio.currentTime - latency)
  }

  /** The event being heard now, for the cursor. */
  eventNow(latency: number): PlaybackEvent | undefined {
    return this.positionNow(latency)?.event
  }
}
