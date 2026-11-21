import type { Frac } from './rational.ts'

/**
 * The score model (design D6; parts, staves and voices since change parts-and-accompaniment, design D1).
 * A score holds parts, a part one or two staves, a staff one or more voices. The bars hold what every
 * part shares; each voice is a list of `MeasureItem`s per bar. Per-voice code works on a voice view
 * (`voiceView`), which has the shape the model had before parts: a list of `Measure`s. Durations are
 * exact fractions of a whole note.
 */

export type NoteType =
  | 'maxima'
  | 'long'
  | 'breve'
  | 'whole'
  | 'half'
  | 'quarter'
  | 'eighth'
  | '16th'
  | '32nd'
  | '64th'
  | '128th'

export type Step = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G'

export interface Pitch {
  step: Step
  /** Semitones: -1 flat, 1 sharp; may be fractional for microtones. */
  alter?: number
  octave: number
}

export interface SlurMark {
  type: 'start' | 'stop' | 'continue'
  number: number
}

export interface TupletMark {
  type: 'start' | 'stop'
  number: number
}

export interface TimeModification {
  actual: number
  normal: number
}

export interface Note {
  kind: 'note'
  /** Stable id, unique within the score; written as the `id` attribute of `<note>`. */
  id: string
  /** Absent for rests. */
  pitch?: Pitch
  rest?: boolean
  /** A whole-measure rest (`<rest measure="yes"/>`). */
  measureRest?: boolean
  /** Written accidental text as in `<accidental>`, e.g. "sharp", "natural". */
  accidental?: string
  /** Printed note value; absent when the source gave only a duration. */
  type?: NoteType
  dots: number
  timeMod?: TimeModification
  /** Sounding length as a fraction of a whole note. Zero for grace notes. */
  duration: Frac
  grace?: boolean
  /** Sounds together with the previous note (does not advance time). */
  chord?: boolean
  tieStart?: boolean
  tieStop?: boolean
  slurs: SlurMark[]
  tuplets: TupletMark[]
  staccato?: boolean
  /** Held for its full value (`<tenuto/>`). */
  tenuto?: boolean
  /** Played with a stronger attack (`<accent/>`). */
  accent?: boolean
  /** Held about twice its written length (`<fermata/>`); a rest can carry one too. */
  fermata?: boolean
  breath?: boolean
  /** An even stronger attack than an accent (`<strong-accent/>`; change more-marks, design D1). */
  strongAccent?: boolean
  /** Shorter than staccato (`<staccatissimo/>`). */
  staccatissimo?: boolean
  /** A short break before the next note (`<caesura/>`). */
  caesura?: boolean
  /** At most one per note: a trill (`<trill-mark/>`), a turn (`<turn/>` or `<inverted-turn/>`) or a mordent. */
  ornament?: 'trill' | 'turn' | 'mordent'
  /**
   * A tremolo (`<tremolo>`): `single` repeats the note; `start` and `stop` are the two notes of one
   * alternating pair (adjacent in a bar). `strokes` is the number of beams across the stem.
   */
  tremolo?: { kind: 'single' | 'start' | 'stop'; strokes: number }
  /** Rolled upwards (`<arpeggiate/>`); kept on the first note of the chord, written on every chord note. */
  arpeggio?: boolean
  /**
   * An invisible rest (always with `rest`): a `<forward>` inside a voice (change parts-and-accompaniment,
   * design D3), kept so that each voice's list still adds up. Written back as `<forward>`; never drawn,
   * selected or flagged.
   */
  hidden?: boolean
}

/**
 * Dynamics, tempo marks and words have a stable id, unique among them within the score (change
 * select-and-delete-elements, design D1), so that a selection of one survives edits. It is written as
 * the `id` attribute of its `<direction>`, and a score read without one gets a fresh one.
 */
export interface DynamicItem {
  kind: 'dynamic'
  id: string
  mark: string
}

/** A tempo marking: words, a metronome mark, or both. */
export interface TempoItem {
  kind: 'tempo'
  /** See `DynamicItem.id`. */
  id: string
  words?: string
  beatUnit?: NoteType
  beatUnitDots?: number
  perMinute?: number
  /** `<sound tempo>` in quarter notes per minute, when present. */
  soundTempo?: number
}

/** Other direction words (e.g. "dolce", "rit."); kept, not interpreted. */
export interface WordsItem {
  kind: 'words'
  /** See `DynamicItem.id`. */
  id: string
  text: string
}

/**
 * A hairpin: a crescendo or diminuendo from one note to another (MusicXML `<wedge>`).
 *
 * It is tied to its notes by id, like a slur, so it follows them through edits. It is kept in the
 * measure of its first note, directly before that note. The notes under it are the ones from `start`
 * to `stop` in score order, both included; `start` and `stop` may be the same note. In MusicXML it is
 * a pair of directions: the start before the first note and the stop after the last one.
 */
export interface WedgeItem {
  kind: 'wedge'
  type: 'crescendo' | 'diminuendo'
  /** Id of the first note under the hairpin. */
  start: string
  /** Id of the last note under the hairpin. */
  stop: string
}

export type MeasureItem = Note | DynamicItem | TempoItem | WordsItem | WedgeItem

/** A measure item drawn from a `<direction>` that carries an id: a dynamic, a tempo mark or words. */
export type DirectionItem = DynamicItem | TempoItem | WordsItem

export interface Clef {
  sign: string
  line?: number
  octaveChange?: number
}

export interface KeySignature {
  fifths: number
  mode?: string
}

export interface TimeSignature {
  beats: number
  beatType: number
  symbol?: 'common' | 'cut'
  /** True when the app inferred this time signature (none was recognised). */
  inferred?: boolean
}

export interface Ending {
  /** e.g. "1" or "1, 2". */
  number: string
  type: 'start' | 'stop' | 'discontinue'
}

export interface Barline {
  style?: string
  repeat?: 'forward' | 'backward'
  times?: number
  ending?: Ending
}

/**
 * One bar of one voice, in the shape of the model before parts: the bar's shared attributes, the part's
 * key and multi-measure rest, the staff's clef, and the voice's items. Made by `voiceView`; `items` is the
 * model's own list, the attributes are copies (see `VoiceScore`).
 */
export interface Measure {
  /** Printed measure number (kept as a string, as in MusicXML). */
  number: string
  clef?: Clef
  key?: KeySignature
  time?: TimeSignature
  leftBarline?: Barline
  rightBarline?: Barline
  newSystem?: boolean
  /**
   * On the first bar of a multi-measure rest: how many bars (this one included) were printed as one
   * symbol. The bars stay as they are, one whole-bar rest each; whether the run still holds is
   * `multiRestRuns`.
   */
  multiRest?: number
  items: MeasureItem[]
}

/**
 * A voice view (design D2): one voice of a score as a list of measures. Each measure's `items` is the same
 * array as the voice's list in the model, so an edit to items through the view edits the score; the bar
 * attributes are read-only copies, set through the score-level functions. `of` points back to the score
 * and the voice the view was made from (absent for a bare list of measures, as in some tests), so that
 * fresh ids are taken from the whole score.
 */
export interface VoiceScore {
  title?: string
  partName?: string
  measures: Measure[]
  of?: { score: Score; ref: VoiceRef }
}

/** A part as read: `P1`, `P2`, ... A two-staff part is a piano part (design D1). */
export interface Part {
  id: string
  name: string
  staves: 1 | 2
}

/** One staff of one part in one bar: its clef, where it changes, and its voices. */
export interface StaffBar {
  clef?: Clef
  /**
   * The staff's voices; `voices[0]` is its first voice. Every bar of a staff has the same number of
   * voices; a voice that has nothing in a bar has an empty list there (never for the first voice).
   */
  voices: MeasureItem[][]
}

/** One part in one bar: what belongs to the part (key, multi-measure rest) and its staves. */
export interface PartBar {
  key?: KeySignature
  /** As `Measure.multiRest`, for this part. */
  multiRest?: number
  /** One per staff of the part (`Part.staves`). */
  staves: StaffBar[]
}

/** A bar: what every part shares, and the part bars, parallel to `Score.parts`. */
export interface Bar {
  number: string
  time?: TimeSignature
  leftBarline?: Barline
  rightBarline?: Barline
  newSystem?: boolean
  parts: PartBar[]
  /**
   * Transient, while editing (change edit-parts, D10): the stretch of the score as the editor loaded it that this bar
   * holds, as `[start, end)` on a line where the loaded bar `i` is `[i, i + 1)`. Absent on every bar means each bar
   * is its own loaded bar (`barSpans`). The first bar line added or removed gives every bar its span; a split cuts the
   * span in two where the bar is split (in proportion to the bar's length), and a join puts the two spans together.
   * So the two halves of a split bar stay apart, also after a save. It lives in the score copies, so undo and redo
   * keep it right, and it is never written to MusicXML.
   */
  from?: [number, number]
}

export interface Score {
  title?: string
  parts: Part[]
  bars: Bar[]
}

/** One voice of a score: the part's id, the staff (0 for the first) and the voice of that staff (0 for the first). */
export interface VoiceRef {
  part: string
  staff: number
  voice: number
}

/** The first voice of the first part: the whole score for a one-line piece. */
export function firstVoice(score: Score): VoiceRef {
  return { part: score.parts[0]?.id ?? 'P1', staff: 0, voice: 0 }
}

export function sameVoice(a: VoiceRef, b: VoiceRef): boolean {
  return a.part === b.part && a.staff === b.staff && a.voice === b.voice
}

/** Index of a part in `score.parts` (and in each `Bar.parts`), or -1. */
export function partIndex(score: Score, id: string): number {
  return score.parts.findIndex((p) => p.id === id)
}

/**
 * A one-line score (one part, one staff, one voice) from a list of measures in the shape of the model
 * before parts. The voice lists are the measures' own `items` arrays, not copies.
 */
export function singleVoiceScore(measures: Measure[], options: { title?: string; partName?: string; partId?: string } = {}): Score {
  const score: Score = {
    parts: [{ id: options.partId ?? 'P1', name: options.partName ?? '', staves: 1 }],
    bars: measures.map((m) => {
      const bar: Bar = { number: m.number, parts: [] }
      if (m.time) bar.time = m.time
      if (m.leftBarline) bar.leftBarline = m.leftBarline
      if (m.rightBarline) bar.rightBarline = m.rightBarline
      if (m.newSystem) bar.newSystem = m.newSystem
      const staff: StaffBar = { voices: [m.items] }
      if (m.clef) staff.clef = m.clef
      const part: PartBar = { staves: [staff] }
      if (m.key) part.key = m.key
      if (m.multiRest !== undefined) part.multiRest = m.multiRest
      bar.parts.push(part)
      return bar
    }),
  }
  if (options.title !== undefined) score.title = options.title
  return score
}

/**
 * The view of one voice (design D2). Each measure carries the bar's number, time, bar lines and new
 * system, the part's key and multi-measure rest, and the staff's clef, each where the model sets it (a
 * change, as in the model before parts), and the voice's own `items` array.
 */
export function voiceView(score: Score, ref: VoiceRef): VoiceScore {
  const pi = partIndex(score, ref.part)
  if (pi < 0) throw new Error(`no part ${ref.part}`)
  const part = score.parts[pi]!
  const measures = score.bars.map((bar): Measure => {
    const pb = bar.parts[pi]
    const sb = pb?.staves[ref.staff]
    const items = sb?.voices[ref.voice]
    if (!pb || !sb || !items) throw new Error(`no voice ${ref.part}/${ref.staff}/${ref.voice} in bar ${bar.number}`)
    const m: Measure = { number: bar.number, items }
    if (sb.clef) m.clef = sb.clef
    if (pb.key) m.key = pb.key
    if (bar.time) m.time = bar.time
    if (bar.leftBarline) m.leftBarline = bar.leftBarline
    if (bar.rightBarline) m.rightBarline = bar.rightBarline
    if (bar.newSystem) m.newSystem = bar.newSystem
    if (pb.multiRest !== undefined) m.multiRest = pb.multiRest
    return m
  })
  const view: VoiceScore = { measures, of: { score, ref } }
  if (score.title !== undefined) view.title = score.title
  if (part.name) view.partName = part.name
  return view
}

/** Every voice of the score, in order of part, staff and voice. */
export function voices(score: Score): VoiceRef[] {
  const refs: VoiceRef[] = []
  score.parts.forEach((part, pi) => {
    for (let staff = 0; staff < part.staves; staff++) {
      const count = Math.max(1, ...score.bars.map((b) => b.parts[pi]?.staves[staff]?.voices.length ?? 0))
      for (let voice = 0; voice < count; voice++) refs.push({ part: part.id, staff, voice })
    }
  })
  return refs
}

/** Where a note or rest is in a score (change edit-parts, D2 and D5): its voice, its bar (from 0) and its index in that voice's items there. */
export interface NotePlace {
  ref: VoiceRef
  barIndex: number
  at: number
  note: Note
}

/**
 * Every note and rest of the score by id, with its part, staff, voice and bar (change edit-parts, D2). Ids are
 * unique in the whole score (change parts-and-accompaniment, D1), so an id alone says where a note is: the
 * editor derives the place of the selection from it, and every note edit finds its voice through it.
 */
export function noteIndex(score: Score): Map<string, NotePlace> {
  const index = new Map<string, NotePlace>()
  score.bars.forEach((bar, barIndex) =>
    bar.parts.forEach((pb, pi) =>
      pb.staves.forEach((sb, staff) =>
        sb.voices.forEach((items, voice) =>
          items.forEach((item, at) => {
            if (isNote(item)) index.set(item.id, { ref: { part: score.parts[pi]!.id, staff, voice }, barIndex, at, note: item })
          }),
        ),
      ),
    ),
  )
  return index
}

/** Where the note `id` is, or undefined when no note of the score has it. */
export function placeOfNote(score: Score, id: string): NotePlace | undefined {
  for (let barIndex = 0; barIndex < score.bars.length; barIndex++) {
    const bar = score.bars[barIndex]!
    for (let pi = 0; pi < bar.parts.length; pi++) {
      const staves = bar.parts[pi]!.staves
      for (let staff = 0; staff < staves.length; staff++) {
        const voiceLists = staves[staff]!.voices
        for (let voice = 0; voice < voiceLists.length; voice++) {
          const items = voiceLists[voice]!
          const at = items.findIndex((i) => isNote(i) && i.id === id)
          if (at >= 0) return { ref: { part: score.parts[pi]!.id, staff, voice }, barIndex, at, note: items[at] as Note }
        }
      }
    }
  }
  return undefined
}

/** Every item list of the score (every voice in every bar), in bar order, then part, staff and voice. */
export function allItemLists(score: Score): MeasureItem[][] {
  const lists: MeasureItem[][] = []
  for (const bar of score.bars) for (const pb of bar.parts) for (const sb of pb.staves) for (const v of sb.voices) lists.push(v)
  return lists
}

/** The whole score a view or a score belongs to, for ids that must be unique in it. */
function itemListsOf(score: Score | VoiceScore): MeasureItem[][] {
  if ('bars' in score) return allItemLists(score)
  if (score.of) return allItemLists(score.of.score)
  return score.measures.map((m) => m.items)
}

/** Every note and direction id used in the whole score (of the view's score, for a view). */
export function usedIds(score: Score | VoiceScore): Set<string> {
  const used = new Set<string>()
  for (const items of itemListsOf(score)) for (const item of items) if (isNote(item) || isDirection(item)) used.add(item.id)
  return used
}

export function isNote(item: MeasureItem): item is Note {
  return item.kind === 'note'
}

export function isWedge(item: MeasureItem): item is WedgeItem {
  return item.kind === 'wedge'
}

export function isDirection(item: MeasureItem): item is DirectionItem {
  return item.kind === 'dynamic' || item.kind === 'tempo' || item.kind === 'words'
}

/**
 * A direction id that no note or direction of the score uses: `d1`, `d2`, ... For items made by an edit
 * or a merge; the parser keeps the ids it reads.
 */
export function freshDirectionId(score: Score | VoiceScore, taken: ReadonlySet<string> = new Set()): string {
  const used = usedIds(score)
  for (const id of taken) used.add(id)
  let n = 1
  while (used.has(`d${n}`)) n++
  return `d${n}`
}

export function notesOf(measure: Measure): Note[] {
  return measure.items.filter(isNote)
}

/** A multi-measure rest that still holds: `length` bars from the bar at index `start`. */
export interface MultiRestRun {
  start: number
  length: number
}

/** Whether a voice's items are nothing but one plain whole-bar rest: no direction, other note or mark. */
function isPlainRestItems(items: readonly MeasureItem[]): boolean {
  const [only, ...more] = items
  if (!only || more.length > 0 || !isNote(only)) return false
  return only.rest === true && only.measureRest === true && !only.grace && !only.chord && !only.fermata && !only.hidden
}

/**
 * A bar that is nothing but one whole-bar rest: no barline, direction, other note or mark, and no clef,
 * key or time, except on the first bar of the run (`first`), where they are drawn before the symbol.
 */
function isPlainRestBar(m: Measure, first: boolean): boolean {
  if (!first && (m.clef || m.key || m.time)) return false
  if (m.leftBarline || m.rightBarline) return false
  return isPlainRestItems(m.items)
}

/**
 * The multi-measure rests that still hold (change more-marks, design D2): a bar with `multiRest` n >= 2
 * whose n bars, itself included, are all plain whole-bar rests (see `isPlainRestBar`; the first may carry a clef, key or time) and exist in the
 * score. The one place that says it: the serializer writes `<multiple-rest>` for these and no others,
 * and whatever maps bars to drawn measures or clears `multiRest` after an edit asks it too. Runs come
 * in score order and never overlap; a `multiRest` inside a run that holds is ignored.
 */
export function multiRestRuns(score: VoiceScore): MultiRestRun[] {
  const runs: MultiRestRun[] = []
  let covered = 0
  score.measures.forEach((m, index) => {
    if (index < covered) return
    const n = m.multiRest
    if (n === undefined || n < 2 || index + n > score.measures.length) return
    for (let k = 0; k < n; k++) {
      const bar = score.measures[index + k]
      if (!bar || !isPlainRestBar(bar, k === 0)) return
    }
    runs.push({ start: index, length: n })
    covered = index + n
  })
  return runs
}

/** Whether the bar at `barIndex` starts a multi-measure rest that still holds. */
export function multiRestHolds(score: VoiceScore, barIndex: number): boolean {
  return multiRestRuns(score).some((r) => r.start === barIndex)
}

/**
 * The multi-measure rests that still hold for one part (design D1, D3 of change parts-and-accompaniment):
 * as `multiRestRuns`, but a bar is plain only when every staff of the part has one plain whole-bar rest in
 * its first voice and nothing in any other voice, and none of its staves sets a clef (the part's key and
 * the bar's time count as before). `partIndex` is the index in `score.parts`.
 */
export function partMultiRestRuns(score: Score, partIndex: number): MultiRestRun[] {
  const plain = (index: number, first: boolean): boolean => {
    const bar = score.bars[index]
    const pb = bar?.parts[partIndex]
    if (!bar || !pb) return false
    if (!first && (pb.key || bar.time || pb.staves.some((s) => s.clef))) return false
    if (bar.leftBarline || bar.rightBarline) return false
    return pb.staves.length > 0 && pb.staves.every((s) => isPlainRestItems(s.voices[0] ?? []) && s.voices.slice(1).every((v) => v.length === 0))
  }
  const runs: MultiRestRun[] = []
  let covered = 0
  score.bars.forEach((bar, index) => {
    if (index < covered) return
    const n = bar.parts[partIndex]?.multiRest
    if (n === undefined || n < 2 || index + n > score.bars.length) return
    for (let k = 0; k < n; k++) if (!plain(index + k, k === 0)) return
    runs.push({ start: index, length: n })
    covered = index + n
  })
  return runs
}

/** The stretch of the loaded score each bar holds (`Bar.from`); a bar without `from` holds its own loaded bar. */
export function barSpans(score: Score): [number, number][] {
  return score.bars.map((bar, i) => bar.from ?? [i, i + 1])
}

/** Whether two bars hold some of the same music of the loaded score. */
export const sameMusic = (a: readonly [number, number], b: readonly [number, number]): boolean => a[0] < b[1] && b[0] < a[1]

/** For each bar of an earlier score (by index), the bars of a later one that hold its music: bar numbers from 1, first and last included. */
export type BarMap = readonly { first: number; last: number }[]

/**
 * Where each bar of `before` went in `after` (change edit-parts, D10), worked out through their `from`s, which both
 * count in the score as the editor loaded it: a bar of `before` is now held by every bar of `after` whose stretch
 * of the loaded score overlaps its own. Edits keep the bars in order, so that is one range. Undefined when nothing
 * moved (the same number of bars, each in its own place), so a save without bar-line changes writes no map.
 */
export function barMap(before: Score, after: Score): BarMap | undefined {
  const was = barSpans(before)
  const now = barSpans(after)
  const map = was.map((span, j) => {
    let first = -1
    let last = -1
    now.forEach((other, i) => {
      if (!sameMusic(span, other)) return
      if (first < 0) first = i
      last = i
    })
    if (first < 0) throw new Error(`bar ${j + 1} of the saved score is in no bar of the edited one`)
    return { first: first + 1, last: last + 1 }
  })
  const same = before.bars.length === after.bars.length && map.every((r, j) => r.first === j + 1 && r.last === j + 1)
  return same ? undefined : map
}
