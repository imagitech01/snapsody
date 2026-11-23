import { batch, computed, signal } from '@preact/signals'
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
import {
  EditError,
  addBar,
  addSlur,
  addTie,
  addWedge,
  appendNote,
  barLengthAt,
  barLinesOf,
  canSplitBefore,
  compareInTime,
  copyBarBefore,
  deleteBar,
  deleteElement,
  deleteNote,
  diatonic,
  dynamicOf,
  insertNote,
  joinBars,
  moveNote,
  noteToRest,
  onsetIn,
  placeNote,
  resizeNote,
  restToNote,
  setBarEnd,
  setBarStart,
  setDuration,
  setDynamic,
  setEnding,
  setRepeatTimes,
  spansOfBar,
  stepPitch,
} from '../core/score/edit.ts'
import type { BarEnd, BarLines, BarSpan, BarStart, LoudnessMark, NoteChoice } from '../core/score/edit.ts'
import { EditSession } from '../core/score/editSession.ts'
import { describeElement } from '../core/score/elements.ts'
import type { ElementInfo, ElementRef } from '../core/score/elements.ts'
import { endingLabels } from '../core/score/endings.ts'
import { gridOf } from '../core/score/grid.ts'
import type { GridDescription } from '../core/score/grid.ts'
import { isNote, isWedge, sameVoice, voices } from '../core/score/model.ts'
import type { Clef, KeySignature, MeasureItem, Note, NoteType, Score, Step, TimeSignature, VoiceRef, VoiceScore } from '../core/score/model.ts'
import { allItemLists, firstVoice, partIndex, placeOfNote, singleVoiceScore, voiceView } from '../core/score/model.ts'
import { noteName } from '../core/score/noteNames.ts'
import { barLength, beatsText, effectiveTimes, expectedLength, midiNumber } from '../core/score/repairs.ts'
import { dropLooseSlurEnds, noteDuration, parseMusicXml, serializeMusicXml } from '../core/score/musicxml.ts'
import type { Frac } from '../core/score/rational.ts'
import { cmp, eq, frac, mul } from '../core/score/rational.ts'
import { suggestRepairs } from '../core/score/suggest.ts'
import type { Suggestion } from '../core/score/suggest.ts'
import { computeScoreWarnings } from '../core/score/warnings.ts'
import type { ScoreWarning } from '../core/score/warnings.ts'
import { barMap } from '../core/score/model.ts'
import { changedCopy, isSpanMark, markEdit, marksOf, nextStripMark, refusalText, savedPlaces, savesWithBars } from './editorRules.ts'
import type { FallbackKey, MarkKind, SessionMessage, SpanMark } from './editorRules.ts'
import type { I18n } from './i18n/index.ts'
import { LibraryError } from './library.ts'
import type { Library, PieceInfo } from './library.ts'
import type { Router } from './router.ts'
import type { EditorView, Settings } from './settings.ts'

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
 * One bar at a time (change redesign-score-editor, group 5; design D1, D3, D8, D14):
 *
 * - The current bar (`currentBar`) is the bar shown large. It is not the selection: it opens on the bar of the first
 *   warning (bar 1 without one) with nothing selected, "no selection, but a current bar" being the normal state. Selecting
 *   a note, an element or a bar, and stepping to a warning, make its bar current; going to another bar (`goToBar`,
 *   previous, next, the overview, the full score) keeps a selection only in that bar. After every edit, undo and redo
 *   it follows the selected note, else it stays where it is, kept in range when bars were deleted.
 * - What the screen shows besides it is session state too, as the rules depend on it: the view (Notes or Grid, from
 *   and to the settings), the tools tab that is open, "Full score", the Grid's staff and voice, what a tap on the staff
 *   or the grid adds, the armed mark and the span that waits for its last note (`pending`, D14), and the message line
 *   (what the last refused action says).
 * - Every action is one undo step (a tap on the staff and the pitch drag that follows it share one), and a refused one
 *   changes nothing and puts its reason on the message line.
 * - A change of bars that a save would refuse is never offered (`canDeleteBar`, `canRemoveBarLineAfter`, task 5.3): each
 *   is tried on a copy and checked as the library would check its save, against the piece as last saved
 *   (`editorRules.ts`), so a save after any offered actions, undo and redo included, goes through.
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

/** The tools tab open under the bar (design D1). */
export type ToolsTab = 'notes' | 'marks' | 'bars' | 'score'

/** What a tap on the staff or the grid adds while nothing is selected (spec "Notes tools"): a length, plain or dotted, and a note or a rest. */
export interface TapChoice {
  type: NoteType
  dots: number
  rest: boolean
}

/** A slur, tie or hairpin that waits for its last note (design D14): the mark, its first note, and the bar (from 1) that note is in. */
export interface PendingSpan {
  kind: SpanMark
  from: string
  bar: number
}

/** What the current bar adds up to, for the beats chip ("3½ of 4 beats"): in beats of its time signature, and whether that is the whole bar. */
export interface BarBeats {
  counted: string
  beats: number
  beatType: number
  addsUp: boolean
}

export interface EditorDeps {
  library: Pick<Library, 'load' | 'writeScore' | 'update' | 'readPractice'>
  /** The default instrument (warnings, preview), the note names the selected note is named in (design D9), and the view the editor opens in. */
  settings: Pick<Settings, 'defaultInstrument' | 'noteNames' | 'editorView' | 'setEditorView'>
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

  // ---- One bar at a time (change redesign-score-editor, group 5) ----

  /** The bar shown large (from 1), always in the score: "Bar 3 of 12". */
  readonly currentBar: ReadonlySignal<number>
  /** How many bars the piece has now. */
  readonly barCount: ReadonlySignal<number>
  /** Notes or Grid, as the settings remember it. */
  readonly view: ReadonlySignal<EditorView>
  /** The tools tab that is open (design D1). */
  readonly tools: ReadonlySignal<ToolsTab>
  /** Whether "Full score" is shown in place of the bar view. */
  readonly fullScore: ReadonlySignal<boolean>
  /** What a tap on the staff or the grid adds while nothing is selected. */
  readonly tapChoice: ReadonlySignal<TapChoice>
  /** Whether a tap where there is no note adds one: with the Notes tools open and no mark armed (spec "Ways to add a mark"). */
  readonly canAddByTap: ReadonlySignal<boolean>
  /** The mark armed with nothing selected, painted on every note tapped (spec "Ways to add a mark"), or null. */
  readonly armed: ReadonlySignal<MarkKind | null>
  /** The slur, tie or hairpin that waits for its last note (design D14), or null. */
  readonly pending: ReadonlySignal<PendingSpan | null>
  /** The marks the selected note has, shown active in the Marks tools; empty without a selected note. */
  readonly activeMarks: ReadonlySignal<ReadonlySet<MarkKind>>
  /** What the last refused action says (the message line of design D1), or null. */
  readonly message: ReadonlySignal<string | null>
  /** The staff and voice the Grid shows (D3): the selected note's, else the one chosen, else the first voice of the first staff. */
  readonly gridVoice: ReadonlySignal<VoiceRef>
  /** The staves and voices of the part being edited that the Grid can show, for its chip. */
  readonly gridVoices: ReadonlySignal<readonly VoiceRef[]>
  /** The Grid's description of the current bar in `gridVoice` (rows, columns, blocks, the loudness strip). */
  readonly grid: ReadonlySignal<GridDescription | undefined>
  /** What the current bar adds up to (its first voice, or the voice of its bar-length warning), or undefined without a time signature. */
  readonly barBeats: ReadonlySignal<BarBeats | undefined>
  /** The warnings about the current bar, in score order. */
  readonly barWarnings: ReadonlySignal<readonly ScoreWarning[]>
  /** The suggested repairs of the current bar (design D6), for the first voice of the part being edited that has any. */
  readonly suggestions: ReadonlySignal<readonly Suggestion[]>
  /** The slurs, ties and hairpins of the part being edited that begin, end or pass in the current bar. */
  readonly spans: ReadonlySignal<readonly BarSpan[]>
  /** How the current bar starts and ends. */
  readonly barLines: ReadonlySignal<BarLines | undefined>
  /** The number of the ending the current bar lies in ("1", "2", or as read, "1, 2"), or null. */
  readonly barEnding: ReadonlySignal<string | null>
  /** Whether "Delete bar" is offered for the current bar (spec "Delete a bar", design D8). */
  readonly canDeleteBar: ReadonlySignal<boolean>
  /** Whether "Same as bar before" is offered: not for the first bar. */
  readonly canCopyBarBefore: ReadonlySignal<boolean>
  /** Whether "Join with next" is offered for the current bar (`canRemoveBarLineAfter`). */
  readonly canJoinNext: ReadonlySignal<boolean>

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
  private readonly current: Signal<number>
  private readonly tab: Signal<ToolsTab>
  private readonly full: Signal<boolean>
  private readonly choice: Signal<TapChoice>
  private readonly armedMark: Signal<MarkKind | null>
  private readonly waiting: Signal<{ kind: SpanMark; from: string } | null>
  private readonly gridChoice: Signal<VoiceRef | null>
  private readonly said: Signal<string | null>
  /** Where each bar of the working score is in the piece as last saved (`savedPlaces`), or undefined when a save now would be refused. */
  private readonly places: ReadonlySignal<Set<string>[] | undefined>
  /** Counts the changes of the working score (edits, undo, redo), so a pitch drag can tell that the note it moves was added by the step before. */
  private steps = 0
  /** The note the last step added by a tap, while no other step came after it: a pitch drag of it is part of that step. */
  private added: { id: string; step: number } | null = null

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

    // One bar at a time: the editor opens on the bar of the first warning that is about a bar, else bar 1.
    const firstFlagged = this.warnings.peek().map((w) => this.keyOf(w)[0]).find((bar) => bar >= 0)
    this.current = signal((firstFlagged ?? 0) + 1)
    this.tab = signal('notes')
    this.full = signal(false)
    this.choice = signal({ type: 'quarter', dots: 0, rest: false })
    this.armedMark = signal(null)
    this.waiting = signal(null)
    this.gridChoice = signal(null)
    this.said = signal(null)
    this.currentBar = this.current
    this.barCount = computed(() => this.score.value.bars.length)
    this.view = deps.settings.editorView
    this.tools = this.tab
    this.fullScore = this.full
    this.tapChoice = this.choice
    this.armed = this.armedMark
    this.message = this.said
    this.canAddByTap = computed(() => this.tab.value === 'notes' && this.armedMark.value === null)
    this.pending = computed(() => {
      const waiting = this.waiting.value
      const place = waiting ? findNote(this.score.value, waiting.from) : undefined
      return waiting && place ? { kind: waiting.kind, from: waiting.from, bar: place.barIndex + 1 } : null
    })
    this.activeMarks = computed(() => {
      const id = this.chosen.value?.noteId
      return id ? marksOf(this.score.value, id) : new Set<MarkKind>()
    })
    this.gridVoices = computed(() => voices(this.score.value).filter((r) => r.part === this.editing.value))
    this.gridVoice = computed(() => {
      const id = this.chosen.value?.noteId
      const place = id ? placeOfNote(this.score.value, id) : undefined
      if (place && place.ref.part === this.editing.value) return place.ref
      const chosenRef = this.gridChoice.value
      const offered = this.gridVoices.value
      return (chosenRef && offered.find((r) => sameVoice(r, chosenRef))) ?? offered[0] ?? { part: this.editing.value, staff: 0, voice: 0 }
    })
    this.grid = computed(() => {
      const score = this.score.value
      const bar = this.current.value - 1
      return score.bars[bar] ? gridOf(score, this.gridVoice.value, bar) : undefined
    })
    this.barWarnings = computed(() => {
      this.score.value
      const bar = this.current.value - 1
      return this.warnings.value.filter((w) => this.keyOf(w)[0] === bar)
    })
    this.barBeats = computed(() => {
      const score = this.score.value
      const bar = this.current.value - 1
      const flagged = this.barWarnings.value.find((w) => w.kind === 'bar-length' && w.part === this.editing.value)
      const ref = flagged?.staff !== undefined && flagged.voice !== undefined ? { part: this.editing.value, staff: flagged.staff, voice: flagged.voice } : { part: this.editing.value, staff: 0, voice: 0 }
      if (partIndex(score, ref.part) < 0) return undefined
      const view = voiceView(score, ref)
      const measure = view.measures[bar]
      const time = effectiveTimes(view)[bar]
      if (!measure || !time) return undefined
      const length = barLength(measure)
      return { counted: beatsText(mul(length, frac(time.beatType))), beats: time.beats, beatType: time.beatType, addsUp: eq(length, expectedLength(time)) }
    })
    this.suggestions = computed(() => {
      const score = this.score.value
      const bar = this.current.value - 1
      if (!score.bars[bar]) return []
      const canJoin = (b: number): boolean => this.canRemoveBarLineAfter(b)
      for (const ref of this.gridVoices.value) {
        const found = suggestRepairs(score, ref, bar, { canJoin })
        if (found.length > 0) return found
      }
      return []
    })
    this.spans = computed(() => {
      const score = this.score.value
      const bar = this.current.value - 1
      return score.bars[bar] ? spansOfBar(score, this.editing.value, bar) : []
    })
    this.barLines = computed(() => {
      const score = this.score.value
      const bar = this.current.value - 1
      return score.bars[bar] ? barLinesOf(score, bar) : undefined
    })
    this.barEnding = computed(() => endingLabels(this.score.value.bars)[this.current.value - 1] ?? null)
    this.places = computed(() => savedPlaces(this.saveInfo.value, this.saved.value, this.score.value))
    this.canDeleteBar = computed(() => this.canDeleteBarAt(this.current.value - 1))
    this.canCopyBarBefore = computed(() => this.current.value > 1 && this.current.value <= this.score.value.bars.length)
    this.canJoinNext = computed(() => this.canRemoveBarLineAfter(this.current.value - 1))
  }

  // ---- Selection -----------------------------------------------------------------------------

  /**
   * Selects a note (tapped on the score, or a warning's). A note of another part switches to that part. False,
   * changing nothing, for an id that is not in the score.
   */
  select(noteId: string): boolean {
    const place = findNote(this.session.score, noteId)
    if (!place) return false
    batch(() => {
      if (place.part !== this.editing.peek()) this.switchTo(place.part)
      this.chosenElement.value = null
      this.chosen.value = { bar: place.barIndex + 1, noteId }
      this.current.value = place.barIndex + 1
    })
    return true
  }

  /** Selects a bar (1-based position) without a note, and makes it the current bar: "Go to bar". False for a bar that is not there. */
  selectBar(bar: number): boolean {
    if (!this.isBar(bar)) return false
    batch(() => {
      this.chosenElement.value = null
      this.chosen.value = { bar, noteId: null }
      this.current.value = bar
    })
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
    batch(() => {
      this.chosenElement.value = ref
      this.chosen.value = { bar: info.bar + 1, noteId: null }
      this.current.value = info.bar + 1
    })
    return true
  }

  /** Selects nothing; the current bar stays. */
  clearSelection(): void {
    batch(() => {
      this.chosenElement.value = null
      this.chosen.value = null
    })
  }

  /** Edits another part (the part switch, D1): the selection, the Grid's voice and a span waiting for its last note go; the current bar stays. False for a part that is not in the score. */
  setPart(id: string): boolean {
    if (partIndex(this.session.score, id) < 0) return false
    if (id === this.editing.peek()) return true
    batch(() => {
      this.switchTo(id)
      this.clearSelection()
      this.focused.value = undefined
    })
    return true
  }

  // ---- The current bar (task 5.1) ------------------------------------------------------------

  /**
   * Makes bar `bar` (from 1) the current bar (spec "Go to another bar"): previous and next, a tap in the overview, the line
   * arrows, a bar picked in the full score. A selection in another bar goes; an armed mark and a span waiting for its last
   * note stay (design D14). False, changing nothing, for a bar that is not there.
   */
  goToBar(bar: number): boolean {
    if (!this.isBar(bar)) return false
    batch(() => {
      if (this.chosen.peek() && this.chosen.peek()!.bar !== bar) this.clearSelection()
      this.current.value = bar
      this.said.value = null
    })
    return true
  }

  /** The bar before the current one; false on the first bar. */
  previousBar(): boolean {
    return this.goToBar(this.current.peek() - 1)
  }

  /** The bar after the current one; false on the last bar. */
  nextBar(): boolean {
    return this.goToBar(this.current.peek() + 1)
  }

  // ---- What the screen shows (task 5.2) ------------------------------------------------------

  /** Shows the bar in Notes or Grid, and remembers it in the settings for every piece (spec "Notes and Grid views"). Resolves when the settings are written. */
  setView(view: EditorView): Promise<void> {
    return this.deps.settings.setEditorView(view)
  }

  /**
   * Opens a tools tab. Opening the Notes or the Bars tools disarms the armed mark and ends a span that waits for its last
   * note (spec "Ways to add a mark", design D14); the Marks and Score tools keep them.
   */
  openTools(tab: ToolsTab): void {
    batch(() => {
      this.tab.value = tab
      if (tab === 'notes' || tab === 'bars') this.disarm()
      this.said.value = null
    })
  }

  /** Shows "Full score" in place of the bar view (design D1); the current bar, the selection, the armed mark and a waiting span stay. */
  openFullScore(): void {
    this.full.value = true
  }

  /** Back from "Full score": to the bar picked there (`bar`, from 1), or to the current bar without one. */
  closeFullScore(bar?: number): void {
    batch(() => {
      if (bar !== undefined) this.goToBar(bar)
      this.full.value = false
    })
  }

  /** Shows another staff or voice of the part being edited in Grid (spec "Choose the other hand"); a selected note of another voice goes. False for a voice the part does not have. */
  setGridVoice(ref: VoiceRef): boolean {
    if (!this.gridVoices.peek().some((r) => sameVoice(r, ref))) return false
    batch(() => {
      this.gridChoice.value = { ...ref }
      const id = this.chosen.peek()?.noteId
      const place = id ? placeOfNote(this.session.score, id) : undefined
      if (place && !sameVoice(place.ref, ref)) this.clearSelection()
    })
    return true
  }

  /** Clears the message line. */
  clearMessage(): void {
    this.said.value = null
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

  // ---- Notes tools (tasks 5.2, 5.3) ----------------------------------------------------------

  /**
   * A length in the Notes tools (spec "Notes tools"): with a note or rest selected, it gets that length, plain (a triplet
   * stays one), as one undo step; with nothing selected, a tap adds that length, plain. False when refused.
   */
  chooseLength(type: NoteType): boolean {
    const note = this.selectedNote.peek()
    if (!note) {
      this.choice.value = { ...this.choice.peek(), type, dots: 0 }
      return true
    }
    const id = note.id
    return this.tryApply((s) => setDuration(s, id, { type, dots: 0, triplet: !!note.timeMod }))
  }

  /** Dotted, on or off: on the selected note or rest (one undo step), else on what a tap adds. False when refused. */
  toggleDotted(): boolean {
    const note = this.selectedNote.peek()
    if (!note) {
      const choice = this.choice.peek()
      this.choice.value = { ...choice, dots: choice.dots > 0 ? 0 : 1 }
      return true
    }
    const { id, type, dots, timeMod } = note
    if (!type) return this.refuse('editor.error.edit')
    return this.tryApply((s) => setDuration(s, id, { type, dots: dots > 0 ? 0 : 1, triplet: !!timeMod }))
  }

  /** Note or rest: the selected note becomes a rest or the rest a note (one undo step), else a tap adds a rest or a note. False when refused. */
  chooseRest(rest: boolean): boolean {
    const note = this.selectedNote.peek()
    if (!note) {
      this.choice.value = { ...this.choice.peek(), rest }
      return true
    }
    if (!!note.rest === rest) return true
    const id = note.id
    return this.tryApply((s) => (rest ? noteToRest(s, id) : restToNote(s, id)))
  }

  // ---- Adding notes by a tap, and the pitch drag (task 5.3, design D2) ------------------------

  /**
   * A tap in the slot after the last note or rest of a staff's first voice (design D2, spec "A bar always takes a note"):
   * adds what a tap adds (`tapChoice`) at the end of that voice in the current bar, a note at `pitch` (the staff step
   * under the finger), replacing a whole-bar rest. Returns the new note's id, which is selected; undefined when nothing
   * is added: the Notes tools are not open, a mark is armed (`canAddByTap`), or the edit is refused (the message says
   * why). A pitch drag of the new note before the finger lifts (`dragPitch`) is part of the same undo step.
   */
  addAtSlot(staff: number, pitch?: { step: Step; octave: number }): string | undefined {
    if (!this.canAddByTap.peek()) return undefined
    const where = { part: this.editing.peek(), staff, voice: 0 }
    const bar = this.current.peek() - 1
    const what = this.tapWhat(pitch)
    return this.addNote((s) => appendNote(s, where, bar, what))
  }

  /**
   * A tap on the staff `staff` of the current bar where there is no note (spec "Notes view"): adds what a tap adds at
   * `pitch`, before the note to its right or else at the end, in the voice of the selected note when that is on this
   * staff, else in the staff's first voice. `right` is the note or rest drawn to the right of the tap on that staff, in
   * any voice; the new note goes before the first note of the chosen voice that starts at or after it. In a voice that
   * holds only a whole-bar rest it replaces the rest. Returns the new note's id, which is selected (see `addAtSlot`).
   */
  addOnStaff(staff: number, pitch?: { step: Step; octave: number }, right?: string): string | undefined {
    if (!this.canAddByTap.peek()) return undefined
    const score = this.session.score
    const part = this.editing.peek()
    const bar = this.current.peek() - 1
    const selected = this.chosen.peek()?.noteId
    const own = selected ? placeOfNote(score, selected) : undefined
    const where: VoiceRef = { part, staff, voice: own && own.ref.part === part && own.ref.staff === staff ? own.ref.voice : 0 }
    const what = this.tapWhat(pitch)
    const before = right === undefined ? undefined : noteFrom(score, where, bar, right)
    if (!before) return this.addNote((s) => appendNote(s, where, bar, what))
    return this.addNote((s) => {
      const id = insertNote(s, before, 'before', what.pitch ? 'note' : 'rest')
      setDuration(s, id, { type: what.type, dots: what.dots, triplet: false })
      if (what.pitch) pitchTo(s, id, what.pitch)
      return id
    })
  }

  /**
   * A pitch drag of the note `id` by `steps` staff steps (up is positive), applied on release (design D2, spec "Drag a
   * note to change its pitch"): one undo step, or part of the step that added the note, when the note was added by the
   * tap the drag follows and nothing happened since. False when refused (a rest).
   */
  dragPitch(id: string, steps: number): boolean {
    if (!Number.isInteger(steps)) return false
    const amend = this.added !== null && this.added.id === id && this.added.step === this.steps
    this.added = null
    if (steps === 0) return true
    return this.tryApply(
      (s) => {
        for (let k = 0; k < Math.abs(steps); k++) stepPitch(s, id, steps > 0 ? 1 : -1)
      },
      'editor.error.edit',
      { amend },
    )
  }

  // ---- Grid gestures (task 5.3, design D3, D4) -----------------------------------------------

  /**
   * A tap on an empty cell of the Grid (spec "Edit notes in Grid"): a note at `start` (a sixteenth of the current bar) on
   * the row's written step and octave, as long as what a tap adds or shorter, in the Grid's voice; in the column where a
   * note starts, a chord note of its length. Returns the new note's id, which is selected; undefined when nothing is
   * added (see `addAtSlot`).
   */
  gridAdd(start: Frac, pitch: { step: Step; octave: number }): string | undefined {
    if (!this.canAddByTap.peek()) return undefined
    const where = this.gridVoice.peek()
    const bar = this.current.peek() - 1
    const { type, dots } = this.choice.peek()
    return this.addNote((s) => placeNote(s, where, bar, start, noteDuration(type, dots), pitch))
  }

  /** A block dragged sideways to `start` in its bar (`moveNote`). False when refused: the block goes back and the message says why. */
  gridMove(id: string, start: Frac): boolean {
    return this.tryApply((s) => moveNote(s, id, start))
  }

  /** A block's end dragged to make it `length` long (`resizeNote`). False when refused. */
  gridResize(id: string, length: Frac): boolean {
    return this.tryApply((s) => resizeNote(s, id, length))
  }

  /**
   * Deletes a note or rest (Delete in the Notes tools, or in Grid), as one undo step; the note `deleteNote` names next is
   * selected, unless that is in another bar: then the note before it in the bar, else nothing, so the bar stays the
   * current one. False when refused.
   */
  deleteNote(id: string): boolean {
    const place = findNote(this.session.score, id)
    if (!place) return false
    const shown = shownNotes(voiceView(this.session.score, placeOfNote(this.session.score, id)!.ref).measures[place.barIndex]!.items)
    const at = shown.findIndex((n) => n.id === id)
    const before = at > 0 ? shown[at - 1]!.id : undefined
    if (!this.tryApply((s) => deleteNote(s, id))) return false
    if (this.chosen.peek()?.bar !== place.barIndex + 1) {
      batch(() => {
        if (!before || !this.select(before)) this.clearSelection()
        this.current.value = place.barIndex + 1
      })
    }
    return true
  }

  // ---- Marks (tasks 5.2, 5.3, 5.5; spec "Ways to add a mark", design D14) ---------------------

  /**
   * A mark tapped in the Marks tools. Tapping the armed mark again disarms it (and ends a span that waits). A slur, tie,
   * crescendo or diminuendo is armed; with a note selected, that note is its first (it then waits for its last). Any
   * other mark, with a note selected and nothing armed, is turned on or off on that note (one undo step); with nothing
   * selected it is armed, and every note tapped then gets it or loses it. False when refused.
   */
  tapMark(kind: MarkKind): boolean {
    const armed = this.armedMark.peek()
    if (armed === kind) {
      this.disarm()
      return true
    }
    const note = this.selectedNote.peek()
    if (isSpanMark(kind)) {
      batch(() => {
        this.armedMark.value = kind
        this.waiting.value = note && !note.rest ? { kind, from: note.id } : null
        this.said.value = null
      })
      return true
    }
    if (note && armed === null) return this.markNote(kind, note.id)
    batch(() => {
      this.armedMark.value = kind
      this.waiting.value = null
      this.said.value = null
    })
    return true
  }

  /**
   * A tap on a note or rest in the bar (or the Grid). With nothing armed it selects it. With a mark armed it does not
   * select: a mark of a note goes on or off (one undo step); a slur, tie or hairpin takes it as its first note, then as
   * its last, in either order, also in another bar (design D14), and is added as one undo step; the mark stays armed for
   * the next one. False when refused (the message says why; a span keeps waiting).
   */
  tapNote(id: string): boolean {
    const place = findNote(this.session.score, id)
    if (!place) return false
    const armed = this.armedMark.peek()
    if (armed === null) {
      this.said.value = null
      return this.select(id)
    }
    if (!isSpanMark(armed)) return this.markNote(armed, id)
    if (place.note.rest) return this.refuse('mark.error.rest')
    const waiting = this.waiting.peek()
    if (!waiting) {
      batch(() => {
        this.waiting.value = { kind: armed, from: id }
        this.said.value = null
      })
      return true
    }
    if (waiting.from === id) return true
    const done = this.addSpan(armed, waiting.from, id)
    if (done) this.waiting.value = null
    return done
  }

  /** Cancel on the notice of a span that waits (design D14): no mark is added, the notice goes, and the mark is no longer armed. */
  cancelPending(): void {
    this.disarm()
  }

  /**
   * A slide in Notes from one note to another (spec "Slide between two notes"): a slur, or the armed tie, crescendo or
   * diminuendo, from the earlier of the two to the later, as one undo step. False when refused.
   */
  slide(fromId: string, toId: string): boolean {
    if (fromId === toId) return false
    const armed = this.armedMark.peek()
    const done = this.addSpan(armed && isSpanMark(armed) ? armed : 'slur', fromId, toId)
    if (done) this.waiting.value = null
    return done
  }

  /** Puts the loudness mark `mark` on a note, changes it, or with undefined removes it (spec "Loudness marks"). One undo step; false when refused. */
  setLoudness(id: string, mark: LoudnessMark | undefined): boolean {
    return this.tryApply((s) => setDynamic(s, id, mark))
  }

  /** A tap on the loudness strip under a note (spec "Loudness strip in Grid"): its mark steps p, mf, f, none; pp, mp and ff step to none. One undo step. */
  stepLoudness(id: string): boolean {
    return this.tryApply((s) => setDynamic(s, id, nextStripMark(dynamicOf(s, id)?.mark)))
  }

  /** A slide along the loudness strip: forward from a note to a later one is a crescendo between them, back to an earlier one a diminuendo. One undo step. */
  stripSlide(fromId: string, toId: string): boolean {
    if (fromId === toId) return false
    return this.addSpan(compareInTime(this.session.score, fromId, toId) < 0 ? 'crescendo' : 'diminuendo', fromId, toId)
  }

  /** Removes a slur, tie or hairpin of the list (`spans`), with both its ends. One undo step. */
  removeSpan(span: BarSpan): boolean {
    return this.tryApply((s) => deleteElement(s, span.ref))
  }

  /** Goes to the first or the last bar of a span of the list, with its first or last note selected (spec "Go to the other end"). */
  goToSpanEnd(span: BarSpan, end: 'first' | 'last'): boolean {
    return this.select(end === 'first' ? span.fromId : span.toId)
  }

  // ---- Bars (task 5.3, design D5, D7, D8) ----------------------------------------------------

  /** "1st time only" or "2nd time only" on the current bar, or off when it has it (spec "First and second endings"); a first ending brings its end-repeat in the same undo step. */
  toggleEnding(ending: 1 | 2): boolean {
    const bar = this.current.peek() - 1
    const own = this.barEnding.peek()
    return this.tryApply((s) => setEnding(s, bar, own === String(ending) ? undefined : ending))
  }

  /** Removes the ending the current bar lies in, also one with other numbers as read ("1, 2"). */
  removeEnding(): boolean {
    const bar = this.current.peek() - 1
    return this.tryApply((s) => setEnding(s, bar, undefined))
  }

  /** How the current bar starts: plain or start-repeat. */
  setBarStart(start: BarStart): boolean {
    const bar = this.current.peek() - 1
    return this.tryApply((s) => setBarStart(s, bar, start))
  }

  /** How the current bar ends: plain, double, end-repeat or end bar line. */
  setBarEnd(end: BarEnd): boolean {
    const bar = this.current.peek() - 1
    return this.tryApply((s) => setBarEnd(s, bar, end))
  }

  /** How many times the section that ends in the current bar's end-repeat is played (2 to 8). */
  setRepeatTimes(times: number): boolean {
    const bar = this.current.peek() - 1
    return this.tryApply((s) => setRepeatTimes(s, bar, times))
  }

  /** "+ Bar before" or "+ Bar after" (spec "Add a bar"): an empty bar in every part, which becomes the current bar, with nothing selected. One undo step. */
  addBar(side: 'before' | 'after'): boolean {
    const bar = this.current.peek() - 1
    let at = bar
    if (!this.tryApply((s) => void (at = addBar(s, bar, side)))) return false
    batch(() => {
      this.clearSelection()
      this.current.value = at + 1
    })
    return true
  }

  /**
   * "Delete bar" (spec "Delete a bar"): the current bar goes in every part, as one undo step, and the bar after it (else
   * the one before) becomes current. Refused, with its reason, where it is not offered (`canDeleteBar`).
   */
  deleteBar(): boolean {
    const bar = this.current.peek() - 1
    if (!this.canDeleteBarAt(bar)) return this.refuse(this.session.score.bars.length === 1 ? 'bars.error.onlyBar' : 'bars.error.onlyPage')
    if (!this.tryApply((s) => deleteBar(s, bar))) return false
    batch(() => {
      this.clearSelection()
      this.current.value = Math.min(bar + 1, this.session.score.bars.length)
    })
    return true
  }

  /** "Same as bar before" (spec "Same as the bar before"), in the part being edited. One undo step; refused for the first bar. */
  copyBarBefore(): boolean {
    const bar = this.current.peek() - 1
    if (bar === 0) return this.refuse('bars.error.firstBar')
    const part = this.editing.peek()
    return this.tryApply((s) => copyBarBefore(s, { part }, bar))
  }

  /** "Join with next" (spec "Remove a bar line"). One undo step; refused, with its reason, after the last bar, at the end of a printed line or page, and where `joinBars` refuses. */
  joinNext(): boolean {
    const bar = this.current.peek() - 1
    if (bar >= this.session.score.bars.length - 1) return this.refuse('barline.error.last')
    if (!this.canRemoveBarLineAfter(bar)) return this.refuse('barline.error.line')
    return this.tryApply((s) => joinBars(s, bar))
  }

  /** Applies a suggested repair of the current bar (`suggestions`) as one undo step. */
  applySuggestion(suggestion: Suggestion): boolean {
    return this.tryApply(suggestion.run)
  }

  /**
   * Whether "Delete bar" is offered for bar `index` (from 0, in the working score) (spec "Delete a bar", design D8): not
   * for the only bar of the piece, and not where a save would then be refused or a page left with only added bars,
   * checked against the piece as last saved plus the edits so far (`savesWithBars`).
   */
  canDeleteBarAt(index: number): boolean {
    const score = this.score.value
    if (!Number.isInteger(index) || index < 0 || index >= score.bars.length || score.bars.length === 1) return false
    const after = changedCopy(score, (s) => deleteBar(s, index))
    return !!after && savesWithBars(this.saveInfo.value, this.saved.value, after)
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
   * Whether "Remove bar line" ("Join with next") is offered for the bar line after bar `barIndex` (from 0, in the working
   * score): not after the last bar, and not where a page or a line of a page's photo ends (`PageInfo.staves`) as a save
   * now would count them (D9 of change edit-parts, D8): the working score's bars are placed through the bar map from the
   * piece as last saved (`savedPlaces`), so an added bar is on the line of the bar it was added next to, a deleted bar's
   * place is gone, and a bar brought back by an undo after a save is where the save would put it. Nor where a save of the
   * joined bars would be refused (a bar that holds bars of two pages). A time, key or clef change or an ending at the bar
   * line is refused when tapped, with its explanation, so it is offered.
   */
  canRemoveBarLineAfter(barIndex: number): boolean {
    const score = this.score.value
    if (!Number.isInteger(barIndex) || barIndex < 0 || barIndex >= score.bars.length - 1) return false
    const info = this.saveInfo.value
    const saved = this.saved.value
    const places = this.places.value
    if (!places) return false
    // One page and one line of the photo for both bars: the bar line between them ends neither.
    if (new Set([...places[barIndex]!, ...places[barIndex + 1]!]).size !== 1) return false
    const joined = changedCopy(score, (s) => joinBars(s, barIndex))
    return !joined || savesWithBars(info, saved, joined)
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
      this.switchTo(changed[0]!)
      this.focused.value = undefined
    }
    this.changed()
  }

  /**
   * After the working score changed: the signals follow, and the selection is checked again (a note of a part that is not
   * shown is not kept). The current bar follows the selection, else stays, kept in range; a span whose first note is gone
   * stops waiting.
   */
  private changed(): void {
    this.steps++
    batch(() => {
      this.version.value++
      this.checkSelection()
      const score = this.session.score
      const selected = this.chosen.peek()
      this.current.value = selected ? selected.bar : Math.min(Math.max(this.current.peek(), 1), score.bars.length)
      const waiting = this.waiting.peek()
      if (waiting && !findNote(score, waiting.from)) this.waiting.value = null
    })
  }

  private checkSelection(): void {
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

  /** Whether `bar` (from 1) is a bar of the working score. */
  private isBar(bar: number): boolean {
    return Number.isInteger(bar) && bar >= 1 && bar <= this.session.score.bars.length
  }

  /** Edits the part `id`: the Grid's chosen voice goes, and a span that waits for a note of another part. */
  private switchTo(id: string): void {
    this.editing.value = id
    this.gridChoice.value = null
    const waiting = this.waiting.peek()
    if (waiting && findNote(this.session.score, waiting.from)?.part !== id) this.disarm()
  }

  /** No mark armed, and no span waiting. */
  private disarm(): void {
    batch(() => {
      this.armedMark.value = null
      this.waiting.value = null
    })
  }

  /** Applies an edit as one undo step (see `apply`); a refused one changes nothing and puts its reason on the message line. */
  private tryApply(edit: (score: Score) => unknown, failure: FallbackKey = 'editor.error.edit', options: { amend?: boolean } = {}): boolean {
    try {
      this.apply(edit, options)
    } catch (error) {
      if (!(error instanceof EditError)) throw error
      this.said.value = refusalText(this.deps.i18n.t, this.session.score, error, failure)
      return false
    }
    this.said.value = null
    return true
  }

  /** Puts a fixed text on the message line; false, for an action that was not done. */
  private refuse(key: SessionMessage): false {
    this.said.value = this.deps.i18n.t(key)
    return false
  }

  /** What a tap adds, as `appendNote` takes it: a note at `pitch` (B4 without one), or a rest. */
  private tapWhat(pitch: { step: Step; octave: number } | undefined): NoteChoice {
    const { type, dots, rest } = this.choice.peek()
    return { type, dots, triplet: false, ...(rest ? {} : { pitch: pitch ? { step: pitch.step, octave: pitch.octave } : { step: 'B' as Step, octave: 4 } }) }
  }

  /** Adds a note by a tap, as one undo step that a pitch drag of it may join (`dragPitch`); its id, which is selected, or undefined when refused. */
  private addNote(edit: (score: Score) => string): string | undefined {
    let id: string | undefined
    if (!this.tryApply((s) => (id = edit(s)))) return undefined
    this.added = { id: id!, step: this.steps }
    return id
  }

  /** Turns a mark of a note on or off on the note `id`, as one undo step. */
  private markNote(kind: Exclude<MarkKind, SpanMark>, id: string): boolean {
    const place = findNote(this.session.score, id)
    if (!place) return false
    if (place.note.rest && kind !== 'fermata') return this.refuse('mark.error.rest')
    return this.tryApply(markEdit(kind, id))
  }

  /** Adds a slur, tie or hairpin between two notes, the earlier one first, as one undo step: a slur or tie in one voice, a hairpin in one staff. */
  private addSpan(kind: SpanMark, a: string, b: string): boolean {
    const score = this.session.score
    const [from, to] = compareInTime(score, a, b) <= 0 ? [a, b] : [b, a]
    const pa = placeOfNote(score, from)?.ref
    const pb = placeOfNote(score, to)?.ref
    if (pa && pb && (kind === 'slur' || kind === 'tie') && !sameVoice(pa, pb)) return this.refuse('mark.error.voice')
    if (pa && pb && (kind === 'crescendo' || kind === 'diminuendo') && (pa.part !== pb.part || pa.staff !== pb.staff)) return this.refuse('mark.error.staff')
    const failure: FallbackKey = kind === 'slur' ? 'mark.error.slur' : kind === 'tie' ? 'mark.error.tie' : 'mark.error.wedge'
    return this.tryApply((s) => (kind === 'slur' ? addSlur(s, from, to) : kind === 'tie' ? addTie(s, from, to) : addWedge(s, kind, from, to)), failure)
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

/**
 * The note or rest of the voice `where` in bar `bar` (from 0) that a note tapped on the staff to the left of the note
 * `right` goes before: the first note, rest or chord of the voice that starts at or after `right` starts. Undefined when
 * there is none (the new note goes at the end), and for a voice that holds nothing to see but a whole-bar rest, which
 * `appendNote` replaces.
 */
function noteFrom(score: Score, where: VoiceRef, bar: number, right: string): string | undefined {
  const place = placeOfNote(score, right)
  if (!place || place.barIndex !== bar || !voices(score).some((r) => sameVoice(r, where))) return undefined
  const own = score.bars[bar]!.parts[partIndex(score, place.ref.part)]!.staves[place.ref.staff]!.voices[place.ref.voice]!
  let at = place.at
  while (at > 0 && isNote(own[at]!) && (own[at] as Note).chord) at--
  const start = onsetIn(own, at)
  const view = voiceView(score, where)
  const items = view.measures[bar]!.items
  const shown = items.filter((i): i is Note => isNote(i) && !i.hidden)
  const [only] = shown
  if (!only || (shown.length === 1 && only.rest && (only.measureRest || eq(only.duration, barLengthAt(view, bar))))) return undefined
  const k = items.findIndex((i, j) => isNote(i) && !i.chord && !i.grace && !i.hidden && cmp(onsetIn(items, j), start) >= 0)
  return k >= 0 ? (items[k] as Note).id : undefined
}

/** The notes and rests of a voice's bar that are drawn and stand on their own: no hidden rests, no chord notes after the first. */
const shownNotes = (items: readonly MeasureItem[]): Note[] => items.filter((i): i is Note => isNote(i) && !i.hidden && !i.chord)

/** Moves the note `id` by staff steps to the written step and octave `pitch`. */
function pitchTo(score: Score, id: string, pitch: { step: Step; octave: number }): void {
  const own = placeOfNote(score, id)?.note.pitch
  if (!own) return
  let steps = diatonic(pitch) - diatonic(own)
  while (steps !== 0) {
    stepPitch(score, id, steps > 0 ? 1 : -1)
    steps -= Math.sign(steps)
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
