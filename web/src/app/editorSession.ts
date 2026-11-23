import { computed, signal } from '@preact/signals'
import type { ReadonlySignal, Signal } from '@preact/signals'
import { instrumentById, instrumentOrDefault } from '../core/instruments/instruments.ts'
import type { Instrument } from '../core/instruments/instruments.ts'
import { Player } from '../core/playback/player.ts'
import type { AudioBackend } from '../core/playback/player.ts'
import type { TimerApi } from '../core/playback/scheduler.ts'
import { startingTempo, tempoSetup } from '../core/playback/tempo.ts'
import { buildTimeline } from '../core/playback/timeline.ts'
import type { TimelineOptions } from '../core/playback/timeline.ts'
import type { Quarters } from '../core/playback/tempo.ts'
import { barLinesOf, canSplitBefore } from '../core/score/edit.ts'
import type { BarLines } from '../core/score/edit.ts'
import { EditSession } from '../core/score/editSession.ts'
import { describeElement } from '../core/score/elements.ts'
import type { ElementInfo, ElementRef } from '../core/score/elements.ts'
import { isNote, isWedge } from '../core/score/model.ts'
import type { Clef, KeySignature, MeasureItem, Note, Score, TimeSignature, VoiceRef, VoiceScore } from '../core/score/model.ts'
import { allItemLists, barMap, barSpans, firstVoice, partIndex, placeOfNote, sameMusic, singleVoiceScore, voiceView } from '../core/score/model.ts'
import { noteName } from '../core/score/noteNames.ts'
import { midiNumber } from '../core/score/repairs.ts'
import { dropLooseSlurEnds, parseMusicXml, serializeMusicXml } from '../core/score/musicxml.ts'
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
 *   When bar lines were added or removed since the last save, it passes the bar map from the score
 *   as last saved to the working one (`barMap`, change edit-parts D10), so the pages, the photo's
 *   lines and practice.json follow the new numbering.
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

/**
 * What "Preview bar N" plays (spec "Preview a bar"): the bar on its own, at the practice tempo, with the instrument in
 * use, as practice plays it (change edit-parts, D8): your part and the parts that play along, each with its own sound,
 * and your line on or off as practice has it.
 */
export interface BarPreview {
  bar: number
  /** A score of that one bar, every part of it, with the clefs, keys and time in force there, from the working score. */
  score: Score
  /** Beats per minute of `beatUnit`: the tempo the user practises the piece at, else the score's. */
  bpm: number
  beatUnit: Quarters
  instrument: Instrument
  /** Your line (practice.json), when the score has that part; absent: the first part, both hands. */
  part?: TimelineOptions['part']
  /** What does not play along. */
  silent: readonly string[]
  /** Whether your line sounds. */
  ownLine: boolean
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
  /** The default instrument (warnings, preview) and the note names the selected note is named in (design D9). */
  settings: Pick<Settings, 'defaultInstrument' | 'noteNames'>
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

/** Where a note is: its part, its bar (0-based index) and its place among the bar's notes of its voice. */
interface NotePlace {
  note: Note
  part: string
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

/** Where a shown note is, in any part, staff and voice (change edit-parts, D2): a hidden rest is not there to select. */
function findNote(score: Score, id: string): NotePlace | undefined {
  const place = placeOfNote(score, id)
  if (!place || place.note.hidden) return undefined
  const items = score.bars[place.barIndex]!.parts.find((_, pi) => score.parts[pi]?.id === place.ref.part)!.staves[place.ref.staff]!.voices[place.ref.voice]!
  const order = items.slice(0, place.at).filter((i) => isNote(i) && !i.hidden).length
  return { note: place.note, part: place.ref.part, barIndex: place.barIndex, order }
}

/**
 * The parts an undo or redo changed, from the score before to the score after (change edit-parts, D1): those whose
 * bars differ. A change in the number of bars (a bar line added or removed) is every part's, and says none.
 */
function changedParts(a: Score, b: Score): string[] {
  if (a.bars.length !== b.bars.length) return []
  return b.parts.filter((_, pi) => JSON.stringify(a.bars.map((bar) => bar.parts[pi])) !== JSON.stringify(b.bars.map((bar) => bar.parts[pi]))).map((p) => p.id)
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
  /** The selected note's pitch in the note names of the settings ("B♭3", "Si♭3"); empty for a rest or no note. It follows a change of the setting. */
  readonly selectedNoteName: ReadonlySignal<string>
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
  /** Your line and what plays along with it, as practice.json has them, for the preview (D8). */
  private readonly along: { part?: TimelineOptions['part']; silent: readonly string[]; ownLine: boolean }
  /**
   * The part being edited (change edit-parts, D1): your part (practice.json) when the editor opens, else the first.
   * Switching clears the selection; selecting a note of another part (a warning's), or an undo or redo of an edit in
   * another part, switches to it.
   */
  readonly part: ReadonlySignal<string>
  /** What the score island draws: the part being edited, both staves and every voice of it. */
  readonly drawn: ReadonlySignal<{ id: string }>
  /** Where the selected note is (D2): "Bar 5 · Left hand · Chord, note 2 of 3", "Bar 2 · Note 3"; empty when no note is selected. */
  readonly selectionLabel: ReadonlySignal<string>
  /** Your part (practice.json), or the first part: the range warnings are for it. */
  readonly yourPart: string
  private readonly editing: Signal<string>
  private player: Player | undefined
  private dropGuard: (() => void) | undefined

  constructor(deps: EditorDeps, info: PieceInfo, score: Score, practiceTempo: number | null, options: OpenOptions = {}, chosen: ChosenInPractice = {}) {
    this.deps = deps
    this.pieceId = info.id
    this.practiceTempo = practiceTempo
    this.yourPart = editedVoice(score, chosen).part
    this.along = {
      ...(chosen.part ? { part: { id: chosen.part, ...(chosen.hand ? { hand: chosen.hand } : {}) } } : {}),
      silent: chosen.silent ?? [],
      ownLine: chosen.ownLine ?? true,
    }
    this.editing = signal(this.yourPart)
    this.part = this.editing
    this.drawn = computed(() => ({ id: this.editing.value }))
    this.session = new EditSession(score)
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
      return id ? findNote(this.score.value, id)?.note : undefined
    })
    this.selectedNoteName = computed(() => {
      const pitch = this.selectedNote.value?.pitch
      return pitch ? noteName(pitch, deps.settings.noteNames.value) : ''
    })
    this.selectionLabel = computed(() => {
      const id = this.chosen.value?.noteId
      this.version.value
      return (id && this.noteLabel(id)) || ''
    })
    this.selectedElement = computed(() => {
      const ref = this.chosenElement.value
      const info = ref ? describeElement(this.score.value, ref) : undefined
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
      return computeScoreWarnings(score, this.yourPart, this.instrument.value)
    })
    this.warningCount = computed(() => this.warnings.value.length)
    this.currentWarning = computed(() => {
      const focused = this.focused.value
      return focused && this.warnings.value.find((w) => sameWarning(w, focused))
    })
  }

  // ---- Selection -----------------------------------------------------------------------------

  /**
   * Selects a note (tapped on the score, or a warning's). A note of another part switches to that part. False,
   * changing nothing, for an id that is not in the score.
   */
  select(noteId: string): boolean {
    const place = findNote(this.session.score, noteId)
    if (!place) return false
    if (place.part !== this.editing.peek()) this.editing.value = place.part
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
    const info = describeElement(this.session.score, ref)
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

  /** Edits another part (the part switch, D1): the selection is cleared. False for a part that is not in the score. */
  setPart(id: string): boolean {
    if (partIndex(this.session.score, id) < 0) return false
    if (id === this.editing.peek()) return true
    this.editing.value = id
    this.clearSelection()
    this.focused.value = undefined
    return true
  }

  /**
   * Where a note is, as the editor names it (D2): the bar; the hand when its part has two staves; the voice when its
   * staff has more than one voice with something in that bar; then for a chord's note its place from the bottom
   * ("Chord, note 2 of 3"), else its place among the notes and rests of its voice in the bar, a chord counted once.
   * Undefined for a note that is not in the score or not drawn (a hidden rest).
   */
  noteLabel(id: string): string | undefined {
    const score = this.session.score
    const place = placeOfNote(score, id)
    if (!place || place.note.hidden) return undefined
    const { t } = this.deps.i18n
    const pi = partIndex(score, place.ref.part)
    const staff = score.bars[place.barIndex]!.parts[pi]!.staves[place.ref.staff]!
    const items = staff.voices[place.ref.voice]!
    const parts = [t('bar.label', { bar: place.barIndex + 1 })]
    if (score.parts[pi]!.staves === 2) parts.push(t(place.ref.staff === 0 ? 'part.right' : 'part.left'))
    const filled = staff.voices.filter((v) => v.some((i) => isNote(i) && !i.hidden)).length
    if (filled > 1) parts.push(t('editor.place.voice', { voice: place.ref.voice + 1 }))
    let a = place.at
    while (a > 0 && (items[a] as Note).chord) a--
    let b = place.at
    while (b + 1 < items.length && isNote(items[b + 1]!) && (items[b + 1] as Note).chord) b++
    if (b > a && !place.note.rest) {
      const chord = (items.slice(a, b + 1) as Note[]).map((n, k) => ({ n, k }))
      const height = (n: Note): number => (n.pitch ? midiNumber(n.pitch) : 0)
      chord.sort((x, y) => height(x.n) - height(y.n) || x.k - y.k)
      parts.push(t('editor.place.chord', { note: chord.findIndex((c) => c.n === place.note) + 1, count: chord.length }))
    } else {
      const order = items.slice(0, place.at + 1).filter((i) => isNote(i) && !i.hidden && !i.chord).length
      parts.push(t(place.note.rest ? 'editor.place.rest' : 'editor.place.note', { note: order }))
    }
    return parts.join(' · ')
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
  apply<T>(edit: (score: Score) => T, options: { amend?: boolean } = {}): T {
    // An element that was already gone is forgotten by the next edit; one this edit deletes is kept for undo.
    const element = this.chosenElement.peek()
    const wasGone = element !== null && !describeElement(this.session.score, element)
    const result = this.session.apply(edit, options)
    if (wasGone) this.chosenElement.value = null
    this.changed()
    if (typeof result === 'string' && findNote(this.session.score, result)) this.select(result)
    return result
  }

  /** Undoes the last edit; when it was made in another part, the editor switches to that part (D1), so the user sees what changed. */
  undo(): boolean {
    const before = this.session.score
    const done = this.session.undo()
    if (done) this.followChange(before)
    return done
  }

  redo(): boolean {
    const before = this.session.score
    const done = this.session.redo()
    if (done) this.followChange(before)
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
    // The tempo as practice works it out: from the first part's first voice, where the piece's marking is read.
    const setup = tempoSetup(lineOf(score, firstVoice(score)))
    const own = this.along.part && partIndex(score, this.along.part.id) >= 0 ? this.along.part : undefined
    return {
      bar,
      score: barExcerpt(score, bar - 1),
      bpm: startingTempo(this.practiceTempo, setup),
      beatUnit: setup.unit,
      instrument: this.instrument.value,
      ...(own ? { part: own } : {}),
      silent: this.along.silent,
      ownLine: this.along.ownLine,
    }
  }

  /** The notes the preview of the selected bar sounds (D8): the bar's events as practice builds them, your line's only while it is on. */
  previewNotes(): string[] {
    const preview = this.barPreview()
    if (!preview) return []
    const timeline = buildTimeline(preview.score, preview.instrument, { ...(preview.part ? { part: preview.part } : {}), silent: preview.silent })
    return timeline.events.filter((e) => preview.ownLine || !e.own).flatMap((e) => (e.pitches.length > 0 ? e.noteIds : []))
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
        ...(preview.part ? { part: preview.part } : {}),
        silent: preview.silent,
        ownLine: preview.ownLine,
        onState: (state) => {
          this.previewState.value = state === 'loading' || state === 'playing'
        },
        ...(this.deps.timer ? { timer: this.deps.timer } : {}),
      })
    }
    const player = this.player
    player.stop()
    // What plays along is as practice.json has it; it does not change while the editor is open.
    player.setPlayAlong(preview.part, preview.silent, preview.ownLine)
    player.setBeatUnit(preview.beatUnit)
    player.setTempo(preview.bpm)
    await player.setInstrument(preview.instrument)
    await player.play()
  }

  /** Stops the preview. */
  stopPreview(): void {
    this.player?.stop()
  }

  // ---- Bar lines (change edit-parts, D9) -----------------------------------------------------

  /**
   * Whether "Bar line before" is offered for the note `noteId`: not for the first note of its bar (that would leave an
   * empty bar), nor for a grace note at its bar's end. The same rule as `splitBar` (`canSplitBefore`); a note or
   * triplet across the point is refused when tapped, with its explanation.
   */
  canAddBarLineBefore(noteId: string): boolean {
    return findNote(this.session.score, noteId) !== undefined && canSplitBefore(this.session.score, noteId)
  }

  /**
   * Whether "Remove bar line" is offered for the bar line after bar `barIndex` (from 0, in the working score): not after
   * the last bar, and not where a page or a line of a page's photo ends (`PageInfo.staves`) in the piece as last saved,
   * as a printed line always ends at a bar line (D9). The working score's bars are matched to the saved piece's through
   * `from`: after a bar line added and not yet saved, the indices no longer match piece.json, and the bar line between
   * the two halves of a split bar is never the end of a printed line. A time, key or clef change or an ending at the
   * bar line is refused when tapped, with its explanation.
   */
  canRemoveBarLineAfter(barIndex: number): boolean {
    const score = this.session.score
    if (!Number.isInteger(barIndex) || barIndex < 0 || barIndex >= score.bars.length - 1) return false
    const saved = barSpans(this.saved.value)
    const now = barSpans(score)
    /** The bars (from 0) of the score as last saved that the working bar `i` holds music of. */
    const savedBars = (i: number): number[] => saved.flatMap((span, j) => (sameMusic(span, now[i]!) ? [j] : []))
    const before = savedBars(barIndex)
    const after = savedBars(barIndex + 1)
    if (before.length === 0 || after.length === 0) return false
    const last = Math.max(...before)
    // Inside one saved bar: the bar line between the halves of a split bar.
    if (Math.min(...after) <= last) return true
    const end = last + 1
    return !this.saveInfo.value.pages.some((page) => page.lastBar === end || page.staves.some((staff) => staff.lastBar === end))
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
    /** Whether the score is written and the rename runs: only the rename refuses a name (a bar map that does not fit is a failure). */
    let renaming = false
    try {
      let info = this.saveInfo.value
      const score = this.session.score
      if (score !== this.saved.value) {
        // The map goes from the score as last saved, which piece.json counts in, to this one; both count `from` in the score as loaded (D10).
        const map = barMap(this.saved.value, score)
        const xml = serializeMusicXml(score)
        info = map ? await this.deps.library.writeScore(this.pieceId, xml, info.score, map) : await this.deps.library.writeScore(this.pieceId, xml, info.score)
        // The base moves on at once: a rename that fails next must not make the retry conflict with this save.
        this.saveInfo.value = info
        this.saved.value = score
      }
      if (name !== info.name) {
        renaming = true
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
      if (error instanceof LibraryError && error.code === 'invalid' && renaming) return { ok: false, reason: 'empty-name', error }
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

  /** After an undo or redo: to the part it changed, when that is not the one shown, then as after any change. */
  private followChange(before: Score): void {
    const changed = changedParts(before, this.session.score)
    if (changed.length > 0 && !changed.includes(this.editing.peek())) {
      this.editing.value = changed[0]!
      this.focused.value = undefined
    }
    this.changed()
  }

  /** After the working score changed: the signals follow, and the selection is checked again (a note of a part that is not shown is not kept). */
  private changed(): void {
    this.version.value++
    const selected = this.chosen.value
    if (!selected) return
    const score = this.session.score
    const element = this.chosenElement.value
    const info = element ? describeElement(score, element) : undefined
    if (info) {
      this.chosen.value = { bar: info.bar + 1, noteId: null }
      return
    }
    const place = selected.noteId ? findNote(score, selected.noteId) : undefined
    if (place && place.part === this.editing.peek()) this.chosen.value = { bar: place.barIndex + 1, noteId: selected.noteId }
    else if (selected.bar <= score.bars.length) this.chosen.value = { bar: selected.bar, noteId: null }
    else this.chosen.value = null
  }

  private keyOf(warning: ScoreWarning): Key {
    const score = this.session.score
    if (warning.noteId) {
      const place = findNote(score, warning.noteId)
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
        const place = selected.noteId ? findNote(this.session.score, selected.noteId) : undefined
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
    // A bar of another part's voice: that part is shown (D1), and the warning stays the current one.
    if (next.warning.part !== undefined && next.warning.part !== this.editing.peek() && partIndex(this.session.score, next.warning.part) >= 0) this.editing.value = next.warning.part
    if (next.key[0] >= 0) this.selectBar(next.key[0] + 1)
    return next.warning
  }
}

/** The same warning, as it is computed again after an edit. */
function sameWarning(a: ScoreWarning, b: ScoreWarning): boolean {
  return a.kind === b.kind && a.bar === b.bar && a.noteId === b.noteId && a.part === b.part && a.staff === b.staff && a.voice === b.voice
}

/**
 * The bar at [index] as a score of its own, for the preview (change edit-parts, D8): every part, staff and voice of
 * it, with the time in force there, each part's key and each staff's clef in force, without repeat bar lines or
 * endings (it plays once), a multi-measure rest or hairpins that reach outside it. The score is not changed; a bar
 * that is not there gives a score without bars.
 */
export function barExcerpt(score: Score, index: number): Score {
  return excerptOf(score, index, false)
}

/**
 * The bar at [index] as a score of its own, for the large bar of the editor (change redesign-score-editor, D2): as
 * `barExcerpt`, but with the bar's own bar lines and endings, so that a bar line can be tapped and an ending's
 * bracket is seen (Verovio 6.4 draws it only when the ending starts and ends in this bar); and without what reaches outside the bar, which cannot be drawn from one bar: hairpins, and the
 * slur and tie ends of notes whose other end is in another bar. The score is not changed; a bar that is not there
 * gives a score without bars.
 */
export function barForEditing(score: Score, index: number): Score {
  return excerptOf(score, index, true)
}

function excerptOf(score: Score, index: number, forEditing: boolean): Score {
  const parts = score.parts.map((p) => ({ ...p }))
  const source = score.bars[index]
  if (!source) return { parts, bars: [] }
  const bar = structuredClone(source)
  const before = score.bars.slice(0, index + 1)
  let time: TimeSignature | undefined
  for (const b of before) time = b.time ?? time
  if (time) bar.time = { ...time }
  if (!forEditing) {
    delete bar.leftBarline
    delete bar.rightBarline
  }
  delete bar.newSystem
  bar.number = '1'
  const ids = new Set(allItemLists({ parts, bars: [bar] }).flatMap((items) => items.filter(isNote).map((n) => n.id)))
  bar.parts.forEach((pb, pi) => {
    let key: KeySignature | undefined
    for (const b of before) key = b.parts[pi]?.key ?? key
    if (key) pb.key = { ...key }
    delete pb.multiRest
    pb.staves.forEach((sb, si) => {
      let clef: Clef | undefined
      for (const b of before) clef = b.parts[pi]?.staves[si]?.clef ?? clef
      if (clef) sb.clef = { ...clef }
      sb.voices = sb.voices.map((items) => items.filter((item) => !isWedge(item) || (ids.has(item.start) && ids.has(item.stop))))
      if (forEditing) sb.voices.forEach(dropTiesOutside)
    })
  })
  const excerpt: Score = { parts, bars: [bar] }
  if (score.title !== undefined) excerpt.title = score.title
  // In one bar, a slur whose other end is in another bar has one end only.
  if (forEditing) dropLooseSlurEnds(excerpt)
  return excerpt
}

/**
 * Takes the tie ends off the notes of one voice's bar whose other end is in another bar: a tie joins a note to the
 * next chord or note of the voice (grace notes do not count), so a tie start in the bar's last one goes to the next
 * bar and a tie stop in its first one comes from the bar before.
 */
function dropTiesOutside(items: MeasureItem[]): void {
  const notes = items.filter(isNote)
  // For each note, the main note of its chord: the note itself, or the note before it that the chord hangs on.
  const heads = new Map<Note, Note>()
  let head: Note | undefined
  for (const n of notes) {
    if (!n.chord || !head) head = n
    heads.set(n, head)
  }
  const mains = notes.filter((n) => !n.grace && !n.chord)
  for (const n of notes) {
    const at = notes.indexOf(heads.get(n)!)
    if (n.tieStart && !mains.some((m) => notes.indexOf(m) > at)) delete n.tieStart
    if (n.tieStop && !mains.some((m) => notes.indexOf(m) < at)) delete n.tieStop
  }
}

/** What Practice tools remember for the piece (practice.json) that the editor needs: your part, what plays along, and the piece's own instrument. */
export interface ChosenInPractice {
  part?: string
  /** The hand chosen on a two-staff part. */
  hand?: 'right' | 'left'
  instrument?: string | null
  /** The parts and hands switched off under "Plays along" ('P1', 'P2:left' ...). */
  silent?: readonly string[]
  /** Whether your own line sounds (absent: it does). */
  ownLine?: boolean
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
    ...(practice?.silent ? { silent: practice.silent } : {}),
    ...(practice?.ownLine !== undefined ? { ownLine: practice.ownLine } : {}),
  })
  session.guardLeaving()
  return session
}
