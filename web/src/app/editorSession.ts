import { computed, signal } from '@preact/signals'
import type { ReadonlySignal, Signal } from '@preact/signals'
import { instrumentById, instrumentOrDefault } from '../core/instruments/instruments.ts'
import type { Instrument } from '../core/instruments/instruments.ts'
import { Player } from '../core/playback/player.ts'
import type { AudioBackend } from '../core/playback/player.ts'
import type { TimerApi } from '../core/playback/scheduler.ts'
import { startingTempo, tempoSetup } from '../core/playback/tempo.ts'
import type { Quarters } from '../core/playback/tempo.ts'
import { barLinesOf } from '../core/score/edit.ts'
import type { BarLines } from '../core/score/edit.ts'
import { EditSession } from '../core/score/editSession.ts'
import { describeElement } from '../core/score/elements.ts'
import type { ElementInfo, ElementRef } from '../core/score/elements.ts'
import { isNote, isWedge } from '../core/score/model.ts'
import type { Clef, KeySignature, Note, Score, TimeSignature, VoiceRef, VoiceScore } from '../core/score/model.ts'
import { firstVoice, singleVoiceScore, voiceView } from '../core/score/model.ts'
import { parseMusicXml, serializeMusicXml } from '../core/score/musicxml.ts'
import { computeScoreWarnings } from '../core/score/warnings.ts'
import type { ScoreWarning } from '../core/score/warnings.ts'
import type { I18n } from './i18n/index.ts'
import { LibraryError } from './library.ts'
import type { Library, PieceInfo } from './library.ts'
import type { Router } from './router.ts'
import type { Settings } from './settings.ts'

/*
 * The editor of a piece (practice-app task 9.6, spec `score-editing`, design D4 and D12): the
 * working score with undo and redo, what is selected, the live warnings, the bar preview, the title,
 * and saving.
 *
 * - Edits go through `EditSession` (core): each `apply` runs an edit function of `core/score/edit.ts`
 *   on a copy, so an edit that throws changes nothing. Undo and redo step through whole scores.
 * - The selection is a bar, and a note in it when one is selected. Bars are counted by position
 *   (1, 2, ... over the whole piece, as the pages' ranges are), never by the printed number. After
 *   every edit, undo and redo the selection is checked again: a note that is gone leaves its bar
 *   selected. An edit that returns a note id (`insertNote`, `deleteNote`) selects that note.
 * - Or the selection is an element other than a note (change select-and-delete-elements, D1): a clef,
 *   a dynamic, a slur, ... named by an `ElementRef`, with its bar selected. `selectedElement` is what it
 *   is now, and undefined once it is gone (deleted); the reference itself is kept, so undoing the
 *   deletion selects it again. The next edit made while it is gone forgets it, and selecting a note or
 *   a bar replaces it. A bar line is not kept as an element: tapping one selects its bar.
 * - Warnings are computed from the working score and the instrument in use, the default instrument
 *   of the settings, whenever either changes (design D4); they are never stored. `nextWarning` and
 *   `previousWarning` step through them in score order and select what each is about.
 * - Dirty means the working score is not the one saved (undoing every edit makes it clean again)
 *   or the title differs from the piece's name. While it is dirty, the leave guard the session puts
 *   on the editor screen asks the discard question (spec "Save and practice").
 * - Save writes the score (`Library.writeScore`, based on the score file the editor loaded; a
 *   `conflict` when the piece was saved elsewhere since) only when it changed, then renames the
 *   piece when the title changed. An empty title is not accepted. The raw readings are not touched.
 * - A piece that adding music has just made opens `isNew` (change simplify-editor-and-name-new-pieces,
 *   D5): `naming` is on, so the editor asks for a name, until the title is typed in, a save succeeds or
 *   the editor closes. It changes nothing else: an untouched date name saves as it is.
 * - Save & practice (design D12): from an editor opened over the practice screen of the same piece it
 *   goes back to that screen, which opens its session again on the saved score (the router shows only
 *   the screen on top, so the practice screen is made again when it comes back); from anywhere else it
 *   replaces the editor with the practice screen. Either way the practice screen is a new one, without
 *   the `autoplay` it may have been opened with.
 *
 * Not here: drawing the score and the editor's tabs (the UI); adding pages (addMusic). The page photos
 * stay stored with the piece, but the editor no longer shows them.
 */

/** What is selected: a bar (1-based position in the piece), and a note in it, or none. */
export interface Selection {
  bar: number
  noteId: string | null
}

/** The selected element (not a note): what was selected, and what it is now. */
export interface SelectedElement {
  ref: ElementRef
  info: ElementInfo
}

/** What "Preview bar N" plays (spec "Preview a bar"): the bar on its own, at the practice tempo, with the instrument in use. */
export interface BarPreview {
  bar: number
  /** A score of that one bar, with the clef, key and time in force there, from the working score. */
  score: Score
  /** Beats per minute of `beatUnit`: the tempo the user practises the piece at, else the score's. */
  bpm: number
  beatUnit: Quarters
  instrument: Instrument
}

export type SaveResult =
  | { ok: true; info: PieceInfo }
  /**
   * `empty-name`: the title is empty, nothing was written. `conflict`: the piece was saved elsewhere
   * since it was opened, nothing was written. `failed`: the save failed (a full disk); the edits
   * are still here.
   */
  | { ok: false; reason: 'empty-name' | 'conflict' | 'failed'; error?: unknown }

export interface EditorDeps {
  library: Pick<Library, 'load' | 'writeScore' | 'update' | 'readPractice'>
  settings: Pick<Settings, 'defaultInstrument'>
  /** The router with the editor screen on top: the leave guard goes on it, and Save & practice goes back to the practice screen under it, or replaces it. */
  router?: Pick<Router, 'setLeaveGuard' | 'confirm' | 'replace' | 'pop' | 'stack'>
  /** The texts of the discard question. */
  i18n: Pick<I18n, 't'>
  /** The audio for the bar preview (created inside the tap, a user gesture). Without it there is no preview to play. */
  backend?: (instrument: Instrument) => Promise<AudioBackend>
  /** Reads the list of pieces again (the shell's `home.refresh`): a rename is in the list before the practice screen shows the name. */
  refreshList?: () => Promise<void>
  timer?: TimerApi
}

/** Where a note is: its bar (0-based index) and its place among the bar's notes. */
interface NotePlace {
  note: Note
  barIndex: number
  order: number
}

/**
 * The voice the editor edits (change parts-and-accompaniment, task 7.1, D2): the first voice of your part
 * (practice.json), the first part when none is chosen or the score does not have it; for a hand chosen on a
 * two-staff part, the first voice of that hand's staff (right = staff 0, left = staff 1).
 */
export function editedVoice(score: Score, chosen: ChosenInPractice = {}): VoiceRef {
  const part = score.parts.find((p) => p.id === chosen.part) ?? score.parts[0]
  if (!part) return firstVoice(score)
  const staff = part.staves === 2 && chosen.hand === 'left' ? 1 : 0
  return { part: part.id, staff, voice: 0 }
}

/** The view of the edited voice of a score, made fresh from the score each time it is needed. */
const lineOf = (score: Score, ref: VoiceRef): VoiceScore => voiceView(score, ref)

function findNote(score: Score, ref: VoiceRef, id: string): NotePlace | undefined {
  for (const [barIndex, m] of lineOf(score, ref).measures.entries()) {
    let order = 0
    for (const item of m.items) {
      if (!isNote(item) || item.hidden) continue
      if (item.id === id) return { note: item, barIndex, order }
      order++
    }
  }
  return undefined
}

/** A place in the score to order warnings by: [bar index, note order]; a bar itself comes before its notes. */
type Key = readonly [number, number]

const compareKeys = (a: Key, b: Key): number => a[0] - b[0] || a[1] - b[1]

export class EditorSession {
  readonly pieceId: string
  /** The piece as saved. */
  readonly info: ReadonlySignal<PieceInfo>
  /** The working score; a new object after every edit, undo and redo. */
  readonly score: ReadonlySignal<Score>
  readonly canUndo: ReadonlySignal<boolean>
  readonly canRedo: ReadonlySignal<boolean>
  readonly selection: ReadonlySignal<Selection | null>
  /** The selected note, if a note is selected. */
  readonly selectedNote: ReadonlySignal<Note | undefined>
  /** The selected element other than a note, while it is in the score (change select-and-delete-elements). */
  readonly selectedElement: ReadonlySignal<SelectedElement | undefined>
  /** How the selected bar starts and ends (change edit-bar-lines), or undefined when no bar is selected. */
  readonly selectedBarLines: ReadonlySignal<BarLines | undefined>
  /** The title as the user is typing it. */
  readonly title: ReadonlySignal<string>
  /** Unsaved edits, or a title that differs from the name. */
  readonly dirty: ReadonlySignal<boolean>
  /** The instrument warnings and the preview use: the piece's own (practice.json) once chosen, else the default instrument in the settings. */
  readonly instrument: ReadonlySignal<Instrument>
  /** What to check, in score order (time signature first). */
  readonly warnings: ReadonlySignal<readonly ScoreWarning[]>
  /** "{count} things to check". */
  readonly warningCount: ReadonlySignal<number>
  /** The warning `nextWarning`/`previousWarning` went to last, while it is still there. */
  readonly currentWarning: ReadonlySignal<ScoreWarning | undefined>
  /** The piece is new and has its date name: the editor asks for a name (design D5 of simplify-editor-and-name-new-pieces). */
  readonly naming: ReadonlySignal<boolean>
  readonly saving: ReadonlySignal<boolean>
  /** True while the bar preview is loading its sound or playing, for the button that starts and stops it. */
  readonly previewing: ReadonlySignal<boolean>

  private readonly deps: EditorDeps
  private readonly session: EditSession
  /** Bumped by every change of the working score, so the signals above follow it. */
  private readonly version: Signal<number>
  private readonly saved: Signal<Score>
  private readonly saveInfo: Signal<PieceInfo>
  private readonly chosen: Signal<Selection | null>
  private readonly chosenElement: Signal<ElementRef | null>
  private readonly typed: Signal<string>
  private readonly focused: Signal<ScoreWarning | undefined>
  private readonly busy: Signal<boolean>
  private readonly previewState: Signal<boolean>
  private readonly askName: Signal<boolean>
  /** Beats per minute the user practises the piece at (practice.json), or null. */
  private readonly practiceTempo: number | null
  /** The voice being edited (your part's first voice) and what draws it: the editor draws that part only. */
  readonly voice: VoiceRef
  readonly drawn: ReadonlySignal<{ id: string; voice: { staff: number; voice: number } }>
  private player: Player | undefined
  private dropGuard: (() => void) | undefined

  constructor(deps: EditorDeps, info: PieceInfo, score: Score, practiceTempo: number | null, options: OpenOptions = {}, chosen: ChosenInPractice = {}) {
    this.deps = deps
    this.pieceId = info.id
    this.practiceTempo = practiceTempo
    this.voice = editedVoice(score, chosen)
    this.drawn = signal({ id: this.voice.part, voice: { staff: this.voice.staff, voice: this.voice.voice } })
    this.session = new EditSession(score, this.voice)
    this.version = signal(0)
    this.saved = signal(this.session.score)
    this.saveInfo = signal(info)
    this.chosen = signal(null)
    this.chosenElement = signal(null)
    this.typed = signal(info.name)
    this.focused = signal(undefined)
    this.busy = signal(false)
    this.previewState = signal(false)
    this.askName = signal(options.isNew === true)

    this.info = this.saveInfo
    this.title = this.typed
    this.selection = this.chosen
    this.saving = this.busy
    this.previewing = this.previewState
    this.naming = this.askName
    this.score = computed(() => {
      this.version.value
      return this.session.score
    })
    this.canUndo = computed(() => {
      this.version.value
      return this.session.canUndo
    })
    this.canRedo = computed(() => {
      this.version.value
      return this.session.canRedo
    })
    this.selectedNote = computed(() => {
      const id = this.chosen.value?.noteId
      return id ? findNote(this.score.value, this.voice, id)?.note : undefined
    })
    this.selectedElement = computed(() => {
      const ref = this.chosenElement.value
      const info = ref ? describeElement(lineOf(this.score.value, this.voice), ref) : undefined
      return ref && info ? { ref, info } : undefined
    })
    this.selectedBarLines = computed(() => {
      const bar = this.chosen.value?.bar
      const score = this.score.value
      return bar !== undefined && bar <= score.bars.length ? barLinesOf(score, bar - 1) : undefined
    })
    this.dirty = computed(() => this.score.value !== this.saved.value || this.typed.value.trim() !== this.saveInfo.value.name)
    // The piece's own instrument when the user chose one in Practice tools, else the default, which it follows (change parts-and-accompaniment, D5).
    const own = chosen.instrument ? instrumentById(chosen.instrument) : undefined
    this.instrument = computed(() => own ?? instrumentOrDefault(deps.settings.defaultInstrument.value))
    // Range warnings are for your part (practice.json) with that instrument; a part the score does not have is the first part.
    this.warnings = computed(() => {
      const score = this.score.value
      return computeScoreWarnings(score, this.voice.part, this.instrument.value)
    })
    this.warningCount = computed(() => this.warnings.value.length)
    this.currentWarning = computed(() => {
      const focused = this.focused.value
      return focused && this.warnings.value.find((w) => sameWarning(w, focused))
    })
  }

  // ---- Selection -----------------------------------------------------------------------------

  /** Selects a note (tapped on the score). False, changing nothing, for an id that is not in the score. */
  select(noteId: string): boolean {
    const place = findNote(this.session.score, this.voice, noteId)
    if (!place) return false
    this.chosenElement.value = null
    this.chosen.value = { bar: place.barIndex + 1, noteId }
    return true
  }

  /** Selects a bar (1-based position) without a note: "Go to bar". False for a bar that is not there. */
  selectBar(bar: number): boolean {
    if (!Number.isInteger(bar) || bar < 1 || bar > this.session.score.bars.length) return false
    this.chosenElement.value = null
    this.chosen.value = { bar, noteId: null }
    return true
  }

  /**
   * Selects an element other than a note (tapped on the score), and its bar. A bar line selects its bar
   * (`selectBar`). False, changing nothing, for an element that is not in the score.
   */
  selectElement(ref: ElementRef): boolean {
    const info = describeElement(lineOf(this.session.score, this.voice), ref)
    if (!info) return false
    if (ref.kind === 'barline') return this.selectBar(info.bar + 1)
    this.chosenElement.value = ref
    this.chosen.value = { bar: info.bar + 1, noteId: null }
    return true
  }

  clearSelection(): void {
    this.chosenElement.value = null
    this.chosen.value = null
  }

  // ---- Edits ---------------------------------------------------------------------------------

  /**
   * Applies an edit of `core/score/edit.ts` to the working score, as one undo step, and returns
   * what it returned. When that is the id of a note in the score (`insertNote`, `deleteNote`), the
   * note is selected. Throws, changing nothing, when the edit throws (an `EditError` to show). With
   * `amend`, it is part of the last undo step (the steps of a held button are undone together).
   *
   *   session.apply((s) => stepPitch(s, id, -1))
   */
  apply<T>(edit: (view: VoiceScore) => T, options: { amend?: boolean } = {}): T {
    // An element that was already gone is forgotten by the next edit; one this edit deletes is kept for undo.
    const element = this.chosenElement.peek()
    const wasGone = element !== null && !describeElement(lineOf(this.session.score, this.voice), element)
    const result = this.session.apply(edit, options)
    if (wasGone) this.chosenElement.value = null
    this.changed()
    if (typeof result === 'string' && findNote(this.session.score, this.voice, result)) this.select(result)
    return result
  }

  undo(): boolean {
    const done = this.session.undo()
    if (done) this.changed()
    return done
  }

  redo(): boolean {
    const done = this.session.redo()
    if (done) this.changed()
    return done
  }

  // ---- Warnings ------------------------------------------------------------------------------

  /** Goes to the next warning after the current one (or after the selection), wrapping round, and selects what it is about. */
  nextWarning(): ScoreWarning | undefined {
    return this.stepWarning(1)
  }

  previousWarning(): ScoreWarning | undefined {
    return this.stepWarning(-1)
  }

  // ---- Title ---------------------------------------------------------------------------------

  /** The title as typed. Typing it ends `naming`. */
  setTitle(text: string): void {
    this.typed.value = text
    this.askName.value = false
  }

  // ---- Preview -------------------------------------------------------------------------------

  /** What "Preview bar N" plays for the selected bar, or undefined when no bar is selected. */
  barPreview(): BarPreview | undefined {
    const bar = this.chosen.value?.bar
    if (bar === undefined) return undefined
    const score = this.session.score
    const setup = tempoSetup(lineOf(score, this.voice))
    return {
      bar,
      score: barExcerpt(score, bar - 1, this.voice),
      bpm: startingTempo(this.practiceTempo, setup),
      beatUnit: setup.unit,
      instrument: this.instrument.value,
    }
  }

  /**
   * Plays the selected bar on its own, with the edits made so far (spec "Preview a bar"). Call it
   * from the tap: the audio is created on the first preview. Does nothing without a selected bar or
   * without a `backend`. A preview that is playing starts again.
   */
  async previewBar(): Promise<void> {
    const preview = this.barPreview()
    const backend = this.deps.backend
    if (!preview || !backend) return
    if (!this.player) {
      this.player = new Player({
        instrument: preview.instrument,
        loadScore: () => this.barPreview()?.score ?? singleVoiceScore([]),
        backend,
        onState: (state) => {
          this.previewState.value = state === 'loading' || state === 'playing'
        },
        ...(this.deps.timer ? { timer: this.deps.timer } : {}),
      })
    }
    const player = this.player
    player.stop()
    player.setBeatUnit(preview.beatUnit)
    player.setTempo(preview.bpm)
    await player.setInstrument(preview.instrument)
    await player.play()
  }

  /** Stops the preview. */
  stopPreview(): void {
    this.player?.stop()
  }

  // ---- Saving and leaving --------------------------------------------------------------------

  /**
   * Saves the edits and the title. Writes the score only when it changed, then renames when the
   * title changed. A failure leaves the edits here; what was saved before it stays saved.
   */
  async save(): Promise<SaveResult> {
    const name = this.typed.value.trim()
    if (name === '') return { ok: false, reason: 'empty-name' }
    if (this.busy.value) return { ok: false, reason: 'failed', error: new Error('a save is already running') }
    this.busy.value = true
    try {
      let info = this.saveInfo.value
      const score = this.session.score
      if (score !== this.saved.value) {
        info = await this.deps.library.writeScore(this.pieceId, serializeMusicXml(score), info.score)
        // The base moves on at once: a rename that fails next must not make the retry conflict with this save.
        this.saveInfo.value = info
        this.saved.value = score
      }
      if (name !== info.name) {
        info = await this.deps.library.update(this.pieceId, { name })
        this.saveInfo.value = info
        // The rename is saved; a list that could not be read again only shows the old name a while longer.
        await this.deps.refreshList?.().catch(() => undefined)
      }
      this.typed.value = name
      this.askName.value = false
      return { ok: true, info }
    } catch (error) {
      if (error instanceof LibraryError && error.code === 'conflict') return { ok: false, reason: 'conflict', error }
      if (error instanceof LibraryError && error.code === 'invalid') return { ok: false, reason: 'empty-name', error }
      return { ok: false, reason: 'failed', error }
    } finally {
      this.busy.value = false
    }
  }

  /**
   * "Save & practice": saves, then opens the piece for practice (design D12). When the screen under the
   * editor is the practice screen of this piece, the editor goes back to it; any other way, the practice
   * screen takes the editor's place. In both cases the practice screen that results is a new one, so it
   * reads the saved score.
   */
  async saveAndPractice(): Promise<SaveResult> {
    const result = await this.save()
    if (result.ok) {
      this.close()
      const router = this.deps.router
      if (router) {
        const stack = router.stack.value
        const below = stack[stack.length - 2]
        if (below?.name === 'practice' && below.pieceId === this.pieceId) router.pop()
        router.replace({ name: 'practice', pieceId: this.pieceId })
      }
    }
    return result
  }

  /**
   * What back (and the editor's Cancel) asks before leaving: nothing when there is nothing to lose,
   * else the discard question; true lets the user leave.
   */
  confirmLeave(): boolean | Promise<boolean> {
    if (!this.dirty.value) return true
    const router = this.deps.router
    if (!router) return false
    const { t } = this.deps.i18n
    return router.confirm({
      title: t('editor.discard.title'),
      message: t('editor.discard.body'),
      confirmLabel: t('editor.discard.confirm'),
      cancelLabel: t('editor.discard.keep'),
      destructive: true,
    })
  }

  /** Puts the leave guard on the screen that is on top of the router now (the editor's). */
  guardLeaving(): void {
    const router = this.deps.router
    if (!router) return
    this.dropGuard?.()
    this.dropGuard = router.setLeaveGuard(() => this.confirmLeave())
  }

  /** Stops the preview, drops the leave guard, and ends `naming`. */
  close(): void {
    this.askName.value = false
    this.player?.stop()
    this.dropGuard?.()
    this.dropGuard = undefined
  }

  // ---- inside --------------------------------------------------------------------------------

  /** After the working score changed: the signals follow, and the selection is checked again. */
  private changed(): void {
    this.version.value++
    const selected = this.chosen.value
    if (!selected) return
    const score = this.session.score
    const element = this.chosenElement.value
    const info = element ? describeElement(lineOf(score, this.voice), element) : undefined
    if (info) {
      this.chosen.value = { bar: info.bar + 1, noteId: null }
      return
    }
    const place = selected.noteId ? findNote(score, this.voice, selected.noteId) : undefined
    if (place) this.chosen.value = { bar: place.barIndex + 1, noteId: selected.noteId }
    else if (selected.bar <= score.bars.length) this.chosen.value = { bar: selected.bar, noteId: null }
    else this.chosen.value = null
  }

  private keyOf(warning: ScoreWarning): Key {
    const score = this.session.score
    if (warning.noteId) {
      const place = findNote(score, this.voice, warning.noteId)
      if (place) return [place.barIndex, place.order]
    }
    if (warning.bar !== undefined) {
      const index = score.bars.findIndex((m) => m.number === warning.bar)
      if (index >= 0) return [index, -1]
    }
    return [-1, -1]
  }

  private stepWarning(dir: 1 | -1): ScoreWarning | undefined {
    const warnings = this.warnings.value
    if (warnings.length === 0) {
      this.focused.value = undefined
      return undefined
    }
    const keyed = warnings.map((warning, index) => ({ warning, index, key: this.keyOf(warning) }))
    const focused = this.currentWarning.value
    let at: { key: Key; index: number } | undefined
    if (focused) {
      const entry = keyed.find((k) => k.warning === focused)!
      at = { key: entry.key, index: entry.index }
    } else {
      const selected = this.chosen.value
      if (selected) {
        const place = selected.noteId ? findNote(this.session.score, this.voice, selected.noteId) : undefined
        // A selected note counts as just before itself, so its own warning is the next one.
        at = { key: place ? [place.barIndex, place.order - 0.5] : [selected.bar - 1, -1.5], index: dir > 0 ? -1 : warnings.length }
      }
    }
    const after = (k: (typeof keyed)[number]): boolean => !at || compareKeys(k.key, at.key) > 0 || (compareKeys(k.key, at.key) === 0 && k.index > at.index)
    const before = (k: (typeof keyed)[number]): boolean => !!at && (compareKeys(k.key, at.key) < 0 || (compareKeys(k.key, at.key) === 0 && k.index < at.index))
    const ordered = [...keyed].sort((a, b) => compareKeys(a.key, b.key) || a.index - b.index)
    const next = dir > 0 ? (ordered.find(after) ?? ordered[0]!) : ([...ordered].reverse().find(before) ?? ordered.at(-1)!)
    this.focused.value = next.warning
    if (next.warning.noteId && this.select(next.warning.noteId)) return next.warning
    if (next.key[0] >= 0) this.selectBar(next.key[0] + 1)
    return next.warning
  }
}

/** The same warning, as it is computed again after an edit. */
function sameWarning(a: ScoreWarning, b: ScoreWarning): boolean {
  return a.kind === b.kind && a.bar === b.bar && a.noteId === b.noteId
}

/**
 * The bar at [index] as a score of its own, for the preview: with the clef, key and time in force
 * there, without repeat barlines or endings (it plays once), and without hairpins that reach
 * outside it. The score is not changed.
 */
export function barExcerpt(score: Score, index: number, ref: VoiceRef = firstVoice(score)): Score {
  const source = lineOf(score, ref).measures[index]
  if (!source) return singleVoiceScore([])
  const m = structuredClone(source)
  // The clef, key and time in force in the edited voice: its own staff's clef and its own part's key.
  let clef: Clef | undefined
  let key: KeySignature | undefined
  let time: TimeSignature | undefined
  for (const b of lineOf(score, ref).measures.slice(0, index + 1)) {
    clef = b.clef ?? clef
    key = b.key ?? key
    time = b.time ?? time
  }
  if (clef) m.clef = { ...clef }
  if (key) m.key = { ...key }
  if (time) m.time = { ...time }
  delete m.leftBarline
  delete m.rightBarline
  const ids = new Set(m.items.filter(isNote).map((n) => n.id))
  m.items = m.items.filter((item) => !isWedge(item) || (ids.has(item.start) && ids.has(item.stop)))
  m.number = '1'
  const name = score.parts.find((p) => p.id === ref.part)?.name
  return singleVoiceScore([m], name ? { partName: name } : {})
}

/** What Practice tools remember for the piece (practice.json) that the editor needs: your part, and the piece's own instrument. */
export interface ChosenInPractice {
  part?: string
  /** The hand chosen on a two-staff part. */
  hand?: 'right' | 'left'
  instrument?: string | null
}

/** How the editor opens a piece. `isNew`: adding music has just made it, so the editor asks for its name. */
export interface OpenOptions {
  isNew?: boolean
}

/**
 * Opens a piece in the editor: loads it and what the practice session remembers (for the preview
 * tempo), and puts the leave guard on the screen that is on top of the router now, which must be
 * the editor's. Rejects as `Library.load` does (`not-found`, `damaged`, ...).
 */
export async function openEditor(deps: EditorDeps, pieceId: string, options: OpenOptions = {}): Promise<EditorSession> {
  const piece = await deps.library.load(pieceId)
  const practice = await deps.library.readPractice(pieceId).catch(() => null)
  const session = new EditorSession(deps, piece.info, parseMusicXml(piece.musicxml), practice?.tempo ?? null, options, {
    ...(practice?.part ? { part: practice.part.id, ...(practice.part.hand ? { hand: practice.part.hand } : {}) } : {}),
    ...(practice?.instrument !== undefined ? { instrument: practice.instrument } : {}),
  })
  session.guardLeaving()
  return session
}
