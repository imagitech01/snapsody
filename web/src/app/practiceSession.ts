import { computed, effect, signal } from '@preact/signals'
import type { ReadonlySignal, Signal } from '@preact/signals'
import { diag } from '../core/diag.ts'
import { instrumentById, instrumentOrDefault } from '../core/instruments/instruments.ts'
import type { Instrument } from '../core/instruments/instruments.ts'
import { Player } from '../core/playback/player.ts'
import type { AudioBackend, PlayerState } from '../core/playback/player.ts'
import type { Position, TimerApi } from '../core/playback/scheduler.ts'
import { clampTempo, startingTempo, tempoSetup } from '../core/playback/tempo.ts'
import type { TempoSetup } from '../core/playback/tempo.ts'
import { buildTimeline } from '../core/playback/timeline.ts'
import type { LoopRest, Timeline, TimelineOptions } from '../core/playback/timeline.ts'
import { outputLatency } from '../core/playback/webaudio.ts'
import { parseMusicXml } from '../core/score/musicxml.ts'
import type { Score } from '../core/score/model.ts'
import { firstVoice, voiceView } from '../core/score/model.ts'
import type { Device } from '../platform/port.ts'
import { DEFAULT_PRACTICE, LibraryError } from './library.ts'
import { hasInstrumentRow, hasPartsRow, partsHintOf, resolvePart, sameYourPart } from './parts.ts'
import type { PartsHint, YourPart } from './parts.ts'
import type { Library, PieceInfo, PracticeState } from './library.ts'
import type { Settings } from './settings.ts'

/*
 * The practice session (practice-app design D8, D10, D11, D12; specs `practice-controls`,
 * `score-playback` "Cursor follows playback", `instruments` "Default instrument"): what the
 * practice screen talks to while one piece is open. It owns the player and everything the user sets
 * while practising, as signals the UI reads, and the intents that change them.
 *
 *   const session = await PracticeSession.open(pieceId, { library, settings, device, backend })
 *   session.tempo.value                        // 80, or what the piece's marking or the user's last choice says
 *   await session.play()
 *   session.goToBar(9); session.setLoop({ start: 9, end: 12 })
 *   await session.close()                       // on leaving the piece
 *
 * Units. Everything the session shows or takes is a BAR NUMBER: 1 for the first bar (it is also what
 * `practice.json` stores). The player counts bars from 0, as indices into the score; the two are
 * converted in `loopRange` and `noteOfBar` and nowhere else. A bar number is the position of the bar in
 * the score (the pages are numbered by position when they are merged, `core/pages`).
 *
 * Where the bar comes from. While the player is playing, `bar` follows what is heard (a poll of the
 * player, `pollInterval`). Otherwise it is read from the player: the note it will start from (the
 * paused or tapped one), else the start of the loop, else bar 1. So the bar never drifts from what
 * Play will do, whichever intent moved it.
 *
 * What is remembered (`practice.json`, `PracticeState`): bar, tempo, loop, loopRest and metronome, and for a
 * piece with several parts your part (`part`), what is switched off under "Plays along" (`silent`), whether
 * your own line sounds (`ownLine`), the piece's own instrument and whether the parts hint was shown. The
 * count-in is a general setting (design D17): it follows `settings.countIn` while the session is open (it is
 * switched in Settings only). The instrument is the piece's own once the user chose one (`setPieceInstrument`),
 * else the settings' default, which it follows when that changes (change parts-and-accompaniment, D5, D9). The
 * tempo is remembered only when the user chose one; until then `practice.json` says `tempo: null` and the
 * piece's marking decides.
 *
 * Parts (D5, D6, D9). `part`, `silent` and `ownLine` are signals the card and the Your part sheet read. Choosing
 * another part (`setPart`) clears `silent`, turns your line on, rebuilds the timeline, and, while playing, the
 * music restarts in place with every part together. The parts hint (`hint`) is there the first time a piece with the
 * Your part row is opened, until the user dismisses it or plays; `partsHintSeen` is saved at once so it never comes back.
 *
 * Saving. A change the user makes (tempo, loop, rest, metronome, a bar) is saved
 * after `saveDelay` of quiet (debounced). Pause, closing the session and the app going to the
 * background save at once. The bar moving on while playing does not schedule a save; it is saved when
 * playback pauses, ends, the session closes or the app goes to the background. A failed save is not
 * reported to the user (`practice.json` is a convenience): it is tried again with the next one, and
 * `save()` rejects for a caller that wants to know. `lastPracticed` of the piece is written once per
 * session, when playback first starts.
 *
 * Keep awake is on exactly while the player is playing or the metronome clicks on its own, and follows the
 * player, so a Play that fails to load its sound never holds the screen on or counts as practising.
 *
 * "Show a bar" (`showBar`, when the user scrolls the score away) and "Return to playing"
 * (`returnToPlaying`) only move the view: they never call the player. `following` is what the score
 * view reads: it is true while the view should scroll along with the playing bar, which is always,
 * except while the user looks at another bar (design D17: following is not a setting). `goToBar` and `goToNote` are the ones that move the player (Restart, a
 * tap on a note): where Play starts, or where playback carries on.
 *
 * The metronome on its own (change steady-notes-and-free-metronome, design D1). Switching the metronome
 * on while nothing plays starts the clicks at once (the player's `metronomeAlone`); `metronomeAlone` says
 * when they sound. A remembered `metronome: true` only sets the switch: nothing sounds until Play, or
 * until the user switches it off and on. Leaving the piece (`close`) and the app going to the background
 * silence it and keep the setting; it does not start again by itself.
 *
 * The count-in. While the count-in clicks sound, `counting` says which click ({ n, of }); it is null
 * otherwise. It is read from the heard position by the same poll as the bar.
 *
 * The audio backend. The session owns every backend the player asks `deps.backend` for: `close()`
 * closes each of them (also one that is still loading when the session closes), so the factory must
 * return a new backend per call, not a shared one.
 */

/** A loop as bar numbers, both ends included. */
export interface LoopBars {
  start: number
  end: number
}

/** What the session needs of the library: the narrow part it calls. */
export type PracticeLibrary = Pick<Library, 'load' | 'readPractice' | 'writePractice' | 'update'>

export interface PracticeSessionDeps {
  library: PracticeLibrary
  /** The default instrument and the count-in (the count-in is followed while the session is open). */
  settings: Pick<Settings, 'defaultInstrument' | 'countIn'>
  device: Pick<Device, 'setKeepAwake' | 'onPause'>
  /** Makes the audio backend for the instrument in use; the session closes it (see above). Called from the Play press. */
  backend: (instrument: Instrument) => Promise<AudioBackend>
  /** The timer of the scheduler, the bar poll and the debounce (an interval timer, like `TimerApi`); the real one by default. */
  timer?: TimerApi
  /** The time for `lastPracticed`. */
  now?: () => Date
  /** Milliseconds of quiet before a change is saved (default `SAVE_DELAY_MS`). */
  saveDelay?: number
  /** Milliseconds between two looks at the playing bar (default `POLL_MS`). */
  pollInterval?: number
}

export const SAVE_DELAY_MS = 1000
export const POLL_MS = 50

const realTimer: TimerApi = {
  set: (fn, ms) => globalThis.setInterval(fn, ms),
  clear: (handle) => globalThis.clearInterval(handle as number),
}

const wholeBar = (n: number): number => (Number.isFinite(n) ? Math.round(n) : 1)

/** Your line and what plays along with it (design D5): what the timeline and the player are made with. */
interface PlayAlong {
  part?: TimelineOptions['part']
  silent: string[]
  ownLine: boolean
}

/**
 * Your line and what plays along, from `practice.json` (design D5): the stored part when the score has it (else the first
 * part, both hands), the parts switched off, and whether your own line sounds (absent: it does). The instrument is the
 * same kind of seam: `settings.defaultInstrument` where the session opens.
 */
function playAlongOf(saved: PracticeState, score: Score): PlayAlong {
  const part = saved.part && score.parts.some((p) => p.id === saved.part!.id) ? saved.part : undefined
  return { ...(part ? { part } : {}), silent: saved.silent ?? [], ownLine: saved.ownLine ?? true }
}

export class PracticeSession {
  /** The piece as it was when the session opened (its name, pages and so on). */
  readonly piece: PieceInfo
  /** The number of bars of the score. */
  readonly bars: number
  /** The score as it was when the session opened: what the score view draws and the player plays. */
  readonly score: Score
  /** The beat unit tempo is counted in, and where the default tempo came from (`tempoSetup`). */
  readonly tempoSetup: TempoSetup
  /** The player. The score view reads the heard position from `heard()`; tests look at it. Its methods are for this class only. */
  readonly player: Player

  /** The player's state. */
  readonly state: ReadonlySignal<PlayerState>
  /** The bar the user is at: the heard one while playing, else the one Play starts from. */
  readonly bar: ReadonlySignal<number>
  /** Beats per minute of `tempoSetup.unit`: the user's choice, else the piece's marking. */
  readonly tempo: ReadonlySignal<number>
  /** The bars looping, or null. */
  readonly loop: ReadonlySignal<LoopBars | null>
  /** Bars of silence between two passes of the loop. */
  readonly loopRest: ReadonlySignal<LoopRest>
  /** The general count-in setting (`Settings.countIn`). */
  readonly countIn: ReadonlySignal<boolean>
  readonly metronome: ReadonlySignal<boolean>
  /** True while the metronome sounds on its own, with no music playing. */
  readonly metronomeAlone: ReadonlySignal<boolean>
  /** The bar the user asked to see while the music plays elsewhere ("Showing bar N"), or null. */
  readonly shownBar: ReadonlySignal<number | null>
  /** True while the view scrolls along with the playing bar: no other bar is being shown. */
  readonly following: ReadonlySignal<boolean>
  /** The instrument of the piece in use: its own once chosen, else the settings' default. A two-staff part sounds as piano whatever this is. */
  get instrument(): Instrument {
    return this.instrumentSignal.value
  }
  /** The same as a signal, for the Practice tools. */
  readonly pieceInstrument: ReadonlySignal<Instrument>
  /** The instrument the user chose for this piece (an id), or null while the default from Settings is followed. */
  readonly instrumentChoice: ReadonlySignal<string | null>
  /** Your part: the stored one when the score has it, else the first part, both hands. */
  readonly part: ReadonlySignal<YourPart>
  /** The parts and hands switched off under "Plays along": 'P1', 'P2:left' ... */
  readonly silent: ReadonlySignal<readonly string[]>
  /** Your own line sounds. */
  readonly ownLine: ReadonlySignal<boolean>
  /** The parts hint to show now, or null: not the first time, or dismissed, or the piece has no Your part row. */
  readonly hint: ReadonlySignal<PartsHint | null>
  /** True when the sound of the default instrument, which this session follows, could not be loaded after it changed. */
  get instrumentProblem(): ReadonlySignal<boolean> {
    return this.problemSignal
  }
  /** The piece has more than one part or a two-staff part: the Your part row and the card show. */
  readonly hasPartsRow: boolean
  /** The piece has a one-staff part: the Instrument for this piece row shows. */
  readonly hasInstrumentRow: boolean
  /** Playing, and in the silence between two passes of a loop. */
  readonly resting: ReadonlySignal<boolean>
  /** During the count-in: which click is sounding, of how many (1-based); null when no count-in is sounding. */
  readonly counting: ReadonlySignal<{ n: number; of: number } | null>

  private readonly pieceId: string
  private readonly library: PracticeLibrary
  private readonly device: Pick<Device, 'setKeepAwake' | 'onPause'>
  private readonly timer: TimerApi
  private readonly now: () => Date
  private readonly saveDelay: number
  private readonly pollInterval: number
  private timeline: Timeline

  private readonly stateSignal: Signal<PlayerState>
  private readonly barSignal: Signal<number>
  private readonly tempoSignal: Signal<number>
  private readonly loopSignal: Signal<LoopBars | null>
  private readonly restSignal: Signal<LoopRest>
  private readonly metronomeSignal: Signal<boolean>
  private readonly aloneSignal: Signal<boolean>
  private readonly shownSignal: Signal<number | null>
  private readonly settings: PracticeSessionDeps['settings']
  private readonly restingSignal: Signal<boolean>
  private readonly countingSignal: Signal<{ n: number; of: number } | null>
  private readonly instrumentSignal: Signal<Instrument>
  private readonly choiceSignal: Signal<string | null>
  private readonly partSignal: Signal<YourPart>
  private readonly silentSignal: Signal<readonly string[]>
  private readonly ownLineSignal: Signal<boolean>
  private readonly hintSignal: Signal<PartsHint | null>
  private readonly problemSignal: Signal<boolean> = signal(false)

  /** The tempo the user chose, or null: what `practice.json` keeps. */
  private chosenTempo: number | null
  /** Something changed since the last save. */
  private dirty = false
  private closed = false
  private closing = false
  private practised = false
  private awake = false
  private previous: PlayerState = 'stopped'
  private readonly kept: Pick<PracticeState, 'part' | 'silent' | 'ownLine' | 'instrument' | 'partsHintSeen'>
  private polling: { handle: unknown } | undefined
  private saveSlot: { handle?: unknown } | undefined
  private readonly backends: Promise<AudioBackend>[] = []
  private readonly stops: Array<() => void> = []

  private constructor(info: PieceInfo, score: Score, saved: PracticeState, deps: PracticeSessionDeps) {
    this.piece = info
    this.pieceId = info.id
    this.library = deps.library
    this.settings = deps.settings
    this.device = deps.device
    this.timer = deps.timer ?? realTimer
    this.now = deps.now ?? (() => new Date())
    this.saveDelay = deps.saveDelay ?? SAVE_DELAY_MS
    this.pollInterval = deps.pollInterval ?? POLL_MS

    const bars = score.bars.length
    this.bars = bars
    this.score = score
    // The tempo and the count-in come from the bars every part shares; any voice's view has them.
    const line = voiceView(score, firstVoice(score))
    this.tempoSetup = tempoSetup(line)
    const chosenInstrument = saved.instrument ? instrumentById(saved.instrument) : undefined
    const instrument = chosenInstrument ?? instrumentOrDefault(deps.settings.defaultInstrument.value)
    const along = playAlongOf(saved, score)
    // What other screens keep in practice.json (your part, the parts hint, the instrument ...) is written back as it was.
    this.kept = {}
    if (saved.part !== undefined) this.kept.part = saved.part
    if (saved.silent !== undefined) this.kept.silent = saved.silent
    if (saved.ownLine !== undefined) this.kept.ownLine = saved.ownLine
    if (saved.instrument !== undefined) this.kept.instrument = saved.instrument
    if (saved.partsHintSeen !== undefined) this.kept.partsHintSeen = saved.partsHintSeen
    // The same timeline the player plays: your line and the parts that play along, on the shared bars.
    this.timeline = buildTimeline(score, instrument, { ...(along.part ? { part: along.part } : {}), silent: along.silent })

    // What practice.json says, held to this score (a stored bar or loop can be past its end).
    const loop = restoreLoop(saved.loop, bars)
    let bar = Math.min(bars, Math.max(1, saved.bar))
    // After its end the scheduler would drop the loop; before it, playback runs up to the loop, so that bar is kept.
    if (loop && bar > loop.end) bar = loop.start
    this.chosenTempo = saved.tempo === null ? null : clampTempo(saved.tempo)

    this.stateSignal = signal('stopped')
    this.barSignal = signal(bar)
    this.tempoSignal = signal(startingTempo(this.chosenTempo, this.tempoSetup))
    this.loopSignal = signal(loop)
    this.restSignal = signal(saved.loopRest)
    this.metronomeSignal = signal(saved.metronome)
    this.aloneSignal = signal(false)
    this.shownSignal = signal<number | null>(null)
    this.restingSignal = signal(false)
    this.countingSignal = signal(null)
    this.state = this.stateSignal
    this.bar = this.barSignal
    this.tempo = this.tempoSignal
    this.loop = this.loopSignal
    this.loopRest = this.restSignal
    this.countIn = deps.settings.countIn
    this.metronome = this.metronomeSignal
    this.metronomeAlone = this.aloneSignal
    this.shownBar = this.shownSignal
    this.following = computed(() => this.shownSignal.value === null)
    this.instrumentSignal = signal(instrument)
    this.choiceSignal = signal(chosenInstrument ? chosenInstrument.id : null)
    this.pieceInstrument = this.instrumentSignal
    this.instrumentChoice = this.choiceSignal
    this.partSignal = signal(resolvePart(score, saved.part))
    this.silentSignal = signal(along.silent)
    this.ownLineSignal = signal(along.ownLine)
    this.part = this.partSignal
    this.silent = this.silentSignal
    this.ownLine = this.ownLineSignal
    this.hasPartsRow = hasPartsRow(score)
    this.hasInstrumentRow = hasInstrumentRow(score)
    // The hint: the first time a piece with the Your part row is opened. It is marked seen at once (saved with the next write).
    const hint = saved.partsHintSeen ? null : partsHintOf(score)
    this.hintSignal = signal(hint)
    this.hint = this.hintSignal
    if (hint) {
      this.kept.partsHintSeen = true
      this.change()
    }
    this.resting = this.restingSignal
    this.counting = this.countingSignal

    this.player = new Player({
      instrument,
      loadScore: () => score,
      backend: (wanted) => {
        const made = deps.backend(wanted)
        this.backends.push(made)
        return made
      },
      ...(deps.timer ? { timer: deps.timer } : {}),
      bpm: this.tempoSignal.value,
      beatUnit: this.tempoSetup.unit,
      countIn: deps.settings.countIn.value,
      ...(loop ? { loop: loopRange(loop) } : {}),
      loopRest: saved.loopRest,
      // Only the switch: a player made with the metronome on stays silent until Play or the user switches it on.
      metronome: saved.metronome,
      ...(along.part ? { part: along.part } : {}),
      silent: along.silent,
      ownLine: along.ownLine,
      onState: (state) => this.onState(state),
      onMetronomeAlone: (sounding) => {
        this.aloneSignal.value = sounding
        // The screen stays on while it clicks: a screen that times out sends the app to the background, which silences it.
        this.setAwake(sounding || this.stateSignal.value === 'playing')
      },
    })
    // Play starts where the user was: tapping a bar is how the player is told.
    const id = this.noteOfBar(bar)
    if (id !== undefined) this.player.seek(id)
    this.syncBar()

    // The count-in follows the settings while the session is open.
    this.stops.push(
      effect(() => {
        this.player.setCountIn(deps.settings.countIn.value)
      }),
    )
    // The default instrument is followed until the user chooses one for the piece.
    this.stops.push(
      effect(() => {
        const next = instrumentOrDefault(deps.settings.defaultInstrument.value)
        if (this.choiceSignal.peek() !== null || next.id === this.instrumentSignal.peek().id) return
        // The default changed under a session that follows it: when its sound cannot be loaded the old instrument stays (signal and player alike), and the screen says so.
        void this.useInstrument(next).catch(() => (this.problemSignal.value = true))
      }),
    )
    this.stops.push(deps.device.onPause(() => this.background()))
  }

  /**
   * Opens a piece: loads it, restores its `practice.json` (the defaults when there is none or it cannot
   * be read) and builds the player with the default instrument. Rejects with the library's error for a
   * piece that is missing or damaged, and with `damaged` for a score that cannot be read.
   */
  static async open(pieceId: string, deps: PracticeSessionDeps): Promise<PracticeSession> {
    const piece = await deps.library.load(pieceId)
    let score: Score
    try {
      score = parseMusicXml(piece.musicxml)
    } catch (error) {
      throw new LibraryError('damaged', `the score cannot be read: ${error instanceof Error ? error.message : String(error)}`, pieceId)
    }
    if (score.bars.length === 0) throw new LibraryError('damaged', 'the score has no bars', pieceId)
    let saved: PracticeState | null = null
    try {
      saved = await deps.library.readPractice(pieceId)
    } catch {
      // Only a convenience: the piece opens with the defaults.
    }
    const session = new PracticeSession(piece.info, score, saved ?? DEFAULT_PRACTICE, deps)
    diag.log('session.open', { piece: pieceId, player: session.player.diagId, bars: score.bars.length, parts: score.parts.length, bar: session.bar.peek() })
    return session
  }

  // ---- Playing -------------------------------------------------------------------------------

  /**
   * Plays, or resumes after a pause (without a count-in). From stopped it starts at the bar the
   * session is at. Does nothing while it is already playing or loading. Rejects when the sound cannot
   * be loaded; the session is then stopped, and not counted as practising.
   */
  async play(): Promise<void> {
    if (this.closed) return
    const state = this.player.state
    if (state === 'playing' || state === 'loading') return
    await this.player.play()
  }

  /** Pauses; the bar and the rest of the settings are saved at once. */
  pause(): void {
    if (this.closed) return
    this.player.pause()
  }

  /** Play when stopped or paused, pause when playing. */
  async toggle(): Promise<void> {
    if (this.player.state === 'playing') this.pause()
    else await this.play()
  }

  /**
   * Goes to the first bar of the loop when one is set, else to bar 1. While playing it keeps playing
   * from there (without a count-in); paused or stopped, Play starts there.
   */
  restart(): void {
    this.goToBar(this.loopSignal.value?.start ?? 1)
  }

  /** Moves playback to a bar (held to the piece): while playing it jumps and carries on, else Play starts there. The view follows it. */
  goToBar(n: number): void {
    if (this.closed) return
    const bar = this.clampBar(n)
    const id = this.noteOfBar(bar)
    if (id === undefined) return
    this.player.seek(id)
    this.barSignal.value = bar
    this.shownSignal.value = null
    this.change()
  }

  /**
   * Moves playback to a note ("Tap to start from a note"): while playing it jumps there and carries on,
   * else Play starts there. The bar of the note becomes the bar the user is at, and the view follows.
   * An id the score does not have changes nothing.
   */
  goToNote(noteId: string): void {
    if (this.closed) return
    const event = this.timeline.eventOfNote(noteId)
    if (!event) return
    this.player.seek(noteId)
    this.barSignal.value = event.barIndex + 1
    this.shownSignal.value = null
    this.change()
  }

  // ---- Settings the user changes -------------------------------------------------------------

  /** Sets the tempo (30 to 200, in `tempoSetup.unit`); while playing it carries on from the current note. Remembered for the piece. Returns the tempo set. */
  setTempo(bpm: number): number {
    if (this.closed) return this.tempoSignal.value
    const set = this.player.setTempo(bpm)
    this.chosenTempo = set
    this.tempoSignal.value = set
    this.change()
    return set
  }

  /**
   * Loops a range of bars (both ends included; held to the piece, and put in order). While playing it
   * carries on from the current note and loops from there; otherwise Play starts at the start of the loop.
   */
  setLoop(range: LoopBars): void {
    if (this.closed) return
    const a = this.clampBar(range.start)
    const b = this.clampBar(range.end)
    const loop = { start: Math.min(a, b), end: Math.max(a, b) }
    this.loopSignal.value = loop
    this.player.setLoop(loopRange(loop)) // forgets the position Play would start from
    this.syncBar()
    this.change()
  }

  /** Switches the loop off; while playing the music runs on through the piece. */
  clearLoop(): void {
    if (this.closed || this.loopSignal.value === null) return
    this.loopSignal.value = null
    this.player.setLoop(undefined)
    this.syncBar()
    this.change()
  }

  /** Bars of silence after each pass of the loop: 0, 1 or 2. */
  setLoopRest(bars: number): LoopRest {
    if (this.closed) return this.restSignal.value
    const set = this.player.setLoopRest(bars)
    this.restSignal.value = set
    this.change()
    return set
  }

  /**
   * The metronome, also while playing (it starts with the next beat). Switched on while nothing plays,
   * it clicks on its own at once. The switch is set (and saved) at once; the promise rejects, as Play
   * does, when the sound cannot be loaded, and the switch then stays on with nothing sounding.
   */
  setMetronome(on: boolean): Promise<void> {
    if (this.closed) return Promise.resolve()
    const started = this.player.setMetronome(on)
    this.metronomeSignal.value = on
    this.change()
    return started
  }

  toggleMetronome(): Promise<void> {
    return this.setMetronome(!this.metronomeSignal.value)
  }

  // ---- Parts (change parts-and-accompaniment, D5, D6, D9) -------------------------------------

  /**
   * Takes another part (and for a two-staff part a hand) as your own. What was switched off under "Plays along"
   * is forgotten and your line is turned on, as for a new piece. The score view draws the new part, the timeline
   * is made again and, while playing, the music goes on from where it was with every part together; stopped or paused,
   * Play starts at the bar the user is at, on the first note of the new part. Remembered for the piece. The same part
   * again changes nothing.
   */
  setPart(next: YourPart): void {
    if (this.closed) return
    const part = resolvePart(this.score, next)
    if (sameYourPart(part, this.partSignal.value)) return
    this.partSignal.value = part
    this.silentSignal.value = []
    this.ownLineSignal.value = true
    this.kept.part = part
    this.kept.silent = []
    this.kept.ownLine = true
    this.applyPlayAlong()
    this.change()
  }

  /** Switches a part or hand ('P1', 'P2:left' ...) on or off under "Plays along"; heard at once, also while playing. */
  setPlaysAlong(key: string, along: boolean): void {
    if (this.closed) return
    const without = this.silentSignal.value.filter((k) => k !== key)
    const silent = along ? without : [...without, key]
    if (silent.length === this.silentSignal.value.length && silent.every((k) => this.silentSignal.value.includes(k))) return
    this.silentSignal.value = silent
    this.kept.silent = silent
    this.applyPlayAlong()
    this.change()
  }

  /** Your own line sounds or not, also while playing: the notes stop from the next one, and come back from the next one. The cursor follows it either way. */
  setOwnLine(on: boolean): void {
    if (this.closed || this.ownLineSignal.value === on) return
    this.ownLineSignal.value = on
    this.kept.ownLine = on
    this.player.setOwnLine(on)
    this.change()
  }

  toggleOwnLine(): void {
    this.setOwnLine(!this.ownLineSignal.value)
  }

  /** The timeline and the player for your part and what plays along now. */
  private applyPlayAlong(): void {
    const part = this.partSignal.value
    const silent = this.silentSignal.value
    this.timeline = buildTimeline(this.score, this.instrumentSignal.value, { part, silent })
    this.player.setPlayAlong(part, silent, this.ownLineSignal.value)
    // Not playing: Play starts at the first note of your new part in the bar the user is at.
    if (this.player.state !== 'playing') {
      const id = this.noteOfBar(this.barSignal.value)
      if (id !== undefined) this.player.seek(id)
      this.syncBar()
    }
  }

  /**
   * The instrument of this piece: an id from the list, or null for "Your default", which follows Settings from then on.
   * Heard at once, also while playing (see `Player.setInstrument`); the promise rejects when its sound cannot be loaded,
   * and the instrument in use is then the old one again. Remembered for the piece.
   */
  async setPieceInstrument(id: string | null): Promise<void> {
    if (this.closed) return
    const wanted = id === null ? undefined : instrumentById(id)
    const choice = wanted ? wanted.id : null
    if (choice === this.choiceSignal.value) return
    const before = { choice: this.choiceSignal.value, instrument: this.instrumentSignal.value }
    this.choiceSignal.value = choice
    this.kept.instrument = choice
    this.change()
    try {
      await this.useInstrument(wanted ?? instrumentOrDefault(this.settings.defaultInstrument.value))
    } catch (error) {
      // As before: the player keeps the old instrument when the new sound could not be loaded.
      this.choiceSignal.value = before.choice
      this.instrumentSignal.value = before.instrument
      this.kept.instrument = before.choice
      throw error
    }
  }

  private async useInstrument(next: Instrument): Promise<void> {
    const before = this.instrumentSignal.value
    this.instrumentSignal.value = next
    try {
      await this.player.setInstrument(next)
      this.problemSignal.value = false
    } catch (error) {
      // The player keeps the old instrument; the signal goes back with it, unless a later switch has taken over.
      if (this.instrumentSignal.value === next) this.instrumentSignal.value = before
      throw error
    }
  }

  /** The hint goes away (the user closed it, opened Your part from it, or played). It was marked seen when the piece opened. */
  dismissHint(): void {
    if (this.hintSignal.value !== null) this.hintSignal.value = null
  }

  /** The view looks at a bar (held to the piece) while the music plays on: following is paused. Never touches the player. */
  showBar(n: number): void {
    if (this.closed) return
    this.shownSignal.value = this.clampBar(n)
  }

  /** "Return to playing": the view goes back to the playing bar and follows it again. Never touches the player. */
  returnToPlaying(): void {
    if (this.closed) return
    this.shownSignal.value = null
  }

  // ---- What is heard -------------------------------------------------------------------------

  /** The position being heard now, with the count-in and loop pass: what the score view's cursor follows. Undefined unless playing. */
  heard(): Position | undefined {
    const audio = this.player.backendInstance
    return this.player.positionNow(audio ? outputLatency(audio) : 0)
  }

  // ---- Saving --------------------------------------------------------------------------------

  /** Saves `practice.json` now, when something changed. Rejects when the write fails (the change stays unsaved, to be tried again). */
  save(): Promise<void> {
    this.cancelSave()
    if (!this.dirty) return Promise.resolve()
    this.dirty = false
    return this.library.writePractice(this.pieceId, this.snapshot()).catch((error: unknown) => {
      this.dirty = true
      throw error
    })
  }

  /** What `practice.json` keeps: the tempo only when the user chose one; never the instrument or the count-in (general settings). */
  snapshot(): PracticeState {
    return {
      bar: this.barSignal.value,
      tempo: this.chosenTempo,
      loop: this.loopSignal.value ? { ...this.loopSignal.value } : null,
      loopRest: this.restSignal.value,
      metronome: this.metronomeSignal.value,
      ...this.kept,
    }
  }

  /**
   * Leaves the piece: pauses (the bar is saved), saves what is unsaved, stops the player, closes the
   * audio and releases the screen. Resolves when the save is done, and rejects when it failed; the
   * session is closed either way, and closing again does nothing.
   */
  async close(): Promise<void> {
    if (this.closed) return
    diag.log('session.close', { piece: this.pieceId, player: this.player.diagId, state: this.player.state, backends: this.backends.length })
    this.closing = true
    this.player.stopMetronomeAlone()
    const state = this.player.state
    if (state === 'playing') this.player.pause()
    else if (state === 'loading') this.player.stop()
    this.closed = true
    this.stopPoll()
    this.cancelSave()
    for (const stop of this.stops.splice(0)) stop()
    try {
      await this.save()
    } finally {
      this.player.stop()
      for (const made of this.backends) made.then((audio) => audio.close?.(), () => undefined)
      this.setAwake(false)
    }
  }

  // ---- Inside --------------------------------------------------------------------------------

  private onState(state: PlayerState): void {
    const before = this.previous
    this.previous = state
    this.stateSignal.value = state
    if (state !== 'loading') this.setAwake(state === 'playing' || this.aloneSignal.value)
    if (state === 'playing') {
      this.dismissHint()
      this.startPoll()
      this.markPracticed()
    } else {
      this.stopPoll()
      this.restingSignal.value = false
      this.countingSignal.value = null
    }
    if (state === 'paused') {
      this.syncBar()
      this.dirty = true
      if (!this.closing) this.saveQuietly()
    } else if (state === 'stopped' && before === 'playing') {
      // The piece ended (or the loop it was in went): the bar is where Play will start again.
      this.syncBar()
      this.dirty = true
      if (!this.closing) this.scheduleSave()
    }
  }

  /** The app goes to the background: silence the metronome on its own, pause (which saves), or save what is unsaved. */
  private background(): void {
    if (this.closed) return
    this.player.stopMetronomeAlone()
    const state = this.player.state
    if (state === 'playing' || state === 'loading') this.player.pause()
    this.saveQuietly()
  }

  /** When the player is not playing, the bar is the one Play will start from. */
  private syncBar(): void {
    if (this.player.state === 'playing') return
    const id = this.player.startNoteId
    const event = id === undefined ? undefined : this.timeline.eventOfNote(id)
    this.barSignal.value = event ? event.barIndex + 1 : (this.loopSignal.value?.start ?? 1)
  }

  private clampBar(n: number): number {
    return Math.min(this.bars, Math.max(1, wholeBar(n)))
  }

  /** The head note of the first event of a bar (bar number, from 1), which is how the player is told to go there. */
  private noteOfBar(bar: number): string | undefined {
    const span = this.timeline.bars.find((b) => b.barIndex === bar - 1)
    // An event of your line: it is drawn, and a tap on it is the same thing.
    return span ? this.timeline.events.slice(span.firstEvent).find((e) => e.own)?.noteIds[0] : undefined
  }

  private readonly poll = (): void => {
    const position = this.heard()
    if (!position) return
    this.restingSignal.value = position.resting === true
    this.setCounting(position.count ?? null)
    const bar = position.barIndex ?? position.event?.barIndex
    if (bar !== undefined && !position.resting) this.barSignal.value = bar + 1
  }

  /** Publishes the count-in click only when it changed, so that the signal does not fire on every look. */
  private setCounting(next: { n: number; of: number } | null): void {
    const now = this.countingSignal.value
    if (now === next || (now && next && now.n === next.n && now.of === next.of)) return
    this.countingSignal.value = next
  }

  private startPoll(): void {
    if (this.polling) return
    this.polling = { handle: this.timer.set(this.poll, this.pollInterval) }
  }

  private stopPoll(): void {
    const polling = this.polling
    if (!polling) return
    this.polling = undefined
    this.timer.clear(polling.handle)
  }

  private markPracticed(): void {
    if (this.practised) return
    this.practised = true
    this.library.update(this.pieceId, { lastPracticed: this.now().toISOString() }).catch(() => {
      this.practised = false // tried again when playback next starts
    })
  }

  private setAwake(on: boolean): void {
    if (this.awake === on) return
    this.awake = on
    try {
      void Promise.resolve(this.device.setKeepAwake(on)).catch(() => undefined)
    } catch {
      // The screen may go dark; nothing else depends on it.
    }
  }

  /** A change the user made: saved after a quiet moment. */
  private change(): void {
    this.dirty = true
    this.scheduleSave()
  }

  private scheduleSave(): void {
    if (this.closing) return
    this.cancelSave()
    const slot: { handle?: unknown } = {}
    slot.handle = this.timer.set(() => {
      this.cancelSave()
      this.saveQuietly()
    }, this.saveDelay)
    this.saveSlot = slot
  }

  private cancelSave(): void {
    const slot = this.saveSlot
    if (!slot) return
    this.saveSlot = undefined
    this.timer.clear(slot.handle)
  }

  private saveQuietly(): void {
    this.save().catch(() => undefined)
  }
}

/** The loop as the player counts bars: indices into the score. */
function loopRange(loop: LoopBars): { start: number; end: number } {
  return { start: loop.start - 1, end: loop.end - 1 }
}

/** A stored loop held to a score of `bars` bars: null when it starts after the end, cut at the end otherwise. */
function restoreLoop(loop: PracticeState['loop'], bars: number): LoopBars | null {
  if (!loop || loop.start > bars) return null
  return { start: loop.start, end: Math.min(loop.end, bars) }
}
