import { beatLength } from './beams.ts'
import { barLengthAt, clefAt, diatonic, dynamicOf, gridLock, keyAlter, middleLine, onsetIn } from './edit.ts'
import type { GridLock } from './edit.ts'
import type { MeasureItem, Note, Pitch, Score, Step, TimeSignature, VoiceRef, VoiceScore, WedgeItem } from './model.ts'
import { isNote, isWedge, noteIndex, partIndex, voiceView } from './model.ts'
import type { Frac } from './rational.ts'
import { add, cmp, div, frac } from './rational.ts'

/*
 * The Grid's picture of one voice of one bar (change redesign-score-editor, design D3, D4; spec "Grid view", "Grid shows
 * one staff and voice", "Grid leaves alone what it cannot draw", "Loudness strip in Grid"). A pure description: the
 * screen draws it as SVG and turns gestures into `placeNote`, `moveNote`, `resizeNote`, `stepPitch`, `deleteNote`,
 * `setDynamic` and `addWedge` (edit.ts). It never changes the score.
 *
 * Places in the bar are fractions of a whole note (`start`, `length`) and, for drawing, sixteenths as plain numbers
 * (`col`, `cols`): a triplet eighth is 4/3 of a column wide.
 */

/** A row: one staff step (a line or a space) in the key, from the top. `pitch` has the key's alter, for `noteName(pitch, style)`. */
export interface GridRow {
  pitch: Pitch
  /** Diatonic steps from C0 (C4 is 28). */
  step: number
  /** A line of the five-line staff under the clef in force (the others are spaces or ledger steps). */
  line: boolean
}

/** A column: one sixteenth of the bar. */
export interface GridColumn {
  start: Frac
  /** The beat it starts, from 1, when it starts one (16 columns in 4/4: beats on 1, 5, 9 and 13; 12 in 6/8: on 1 and 7). */
  beat?: number
  /** False past the time signature's length, in a bar whose voice is too long. */
  inBar: boolean
}

/** A note as a block: one per note, so a chord is a column of blocks. */
export interface GridBlock {
  id: string
  /** The voice of the staff it is in (0 for the first). */
  voice: number
  start: Frac
  /** Its sounding length; 0 for a grace note, drawn as a thin mark before the note it leads to. */
  length: Frac
  col: number
  cols: number
  /** Index in `GridDescription.rows`. */
  row: number
  /** The written pitch with its sounding alter, for the label. */
  pitch: Pitch
  /** The printed accidental ("sharp", "flat", "natural", ...), when the note has one. */
  accidental?: string
  /** Why it cannot be dragged or resized in Grid (D4); absent for a block that can. */
  locked?: GridLock
  /** Staccato or staccatissimo: drawn shorter than its length (spec "A staccato block"). */
  staccato: boolean
  /** Accent or strong accent: drawn with a marked front edge. */
  accent: boolean
  /** The ids of the notes of its chord, its first note first, when it is in a chord of two or more. */
  chord?: string[]
}

/** A rest of a locked group (a rest in a triplet), drawn hatched across the rows: the time cannot take a note in Grid. */
export interface GridLockedRest {
  id: string
  start: Frac
  length: Frac
  col: number
  cols: number
  locked: GridLock
}

/** A loudness mark in the strip: of the note it stands before in the shown voice (`noteId`), else only at its column. */
export interface GridDynamic {
  id: string
  mark: string
  noteId?: string
  start: Frac
  col: number
}

/**
 * A crescendo or diminuendo in the strip, from its first note to the end of its last. A hairpin that starts in an earlier
 * bar starts at the left edge (`before`, `from` 0), one that ends in a later bar ends at the right edge (`after`, `to`
 * the number of columns).
 */
export interface GridHairpin {
  type: WedgeItem['type']
  start: string
  stop: string
  from: number
  to: number
  before: boolean
  after: boolean
}

export interface GridDescription {
  where: VoiceRef
  bar: number
  /** From the highest step to the lowest. */
  rows: GridRow[]
  columns: GridColumn[]
  /** The columns of the time signature's bar length (the others are a voice that is too long). */
  barColumns: number
  /** The blocks of the shown voice. */
  blocks: GridBlock[]
  lockedRests: GridLockedRest[]
  /** The faint blocks of the staff's other voices, which do not react to touch (spec "Grid shows one staff and voice"). */
  others: GridBlock[]
  /** The loudness marks of the staff in the bar, by start. */
  dynamics: GridDynamic[]
  /** The hairpins of the staff that start, end or pass in the bar. */
  hairpins: GridHairpin[]
}

const STEPS: Step[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B']
const sixteenths = (t: Frac): number => (t.n * 16) / t.d

/** Where the item at `at` starts: a chord note at its chord's start, a grace note at the start of the note it leads to. */
function startOf(items: readonly MeasureItem[], at: number): Frac {
  let a = at
  while (a > 0 && isNote(items[a]!) && (items[a] as Note).chord && !(items[a] as Note).grace) a--
  return onsetIn(items, a)
}

/** The blocks and the locked rests of one voice's items in a bar, without rows (`step` instead). */
function blocksOf(items: readonly MeasureItem[], voice: number): { blocks: (Omit<GridBlock, 'row'> & { step: number })[]; lockedRests: GridLockedRest[] } {
  const blocks: (Omit<GridBlock, 'row'> & { step: number })[] = []
  const lockedRests: GridLockedRest[] = []
  for (let at = 0; at < items.length; at++) {
    const item = items[at]!
    if (!isNote(item) || item.chord) continue
    let end = at + 1
    while (end < items.length && isNote(items[end]!) && (items[end] as Note).chord) end++
    const start = startOf(items, at)
    const locked = gridLock(items, at, end, start)
    const members = items.slice(at, end) as Note[]
    const length = item.grace ? frac(0) : item.duration
    const place = { start, length, col: sixteenths(start), cols: sixteenths(length) }
    if (item.rest) {
      if (locked && !item.hidden) lockedRests.push({ id: item.id, ...place, locked })
    } else {
      for (const n of members) {
        if (!n.pitch) continue
        const block: Omit<GridBlock, 'row'> & { step: number } = {
          id: n.id,
          voice,
          ...place,
          step: diatonic(n.pitch),
          pitch: { ...n.pitch },
          staccato: !!(n.staccato || n.staccatissimo),
          accent: !!(n.accent || n.strongAccent),
        }
        if (n.accidental !== undefined) block.accidental = n.accidental
        if (locked) block.locked = locked
        if (members.length > 1) block.chord = members.map((m) => m.id)
        blocks.push(block)
      }
    }
    at = end - 1
  }
  return { blocks, lockedRests }
}

/** The key's fifths in force at bar `index` of a view. */
function fifthsAt(view: VoiceScore, index: number): number {
  for (let b = index; b >= 0; b--) {
    const key = view.measures[b]?.key
    if (key) return key.fifths
  }
  return 0
}

function timeAt(view: VoiceScore, index: number): TimeSignature | undefined {
  for (let b = index; b >= 0; b--) {
    const time = view.measures[b]?.time
    if (time) return time
  }
  return undefined
}

/**
 * The Grid's description of the voice `where` in bar `bar` (from 0) of a score (D3).
 *
 * - Rows: the staff steps from three above the highest note of the staff's voices in the bar to three below the lowest,
 *   at least an octave (grown upwards first); a bar without notes shows the staff of its clef. `grow` adds steps above
 *   (`up`) and below (`down`), for a block dragged to the edge.
 * - Columns: the sixteenths of the time signature's bar length (of the longest voice of the bar without one), and more
 *   when the voice is longer; the beats as `beams.ts` counts them (a dotted quarter in 6/8).
 * - Blocks: every note of the voice; a triplet, a grace note and a note that does not start and end on a sixteenth are
 *   locked (D4). The other voices of the staff are the faint blocks.
 * - The strip: the loudness marks of the staff in the bar, each tied to the note of the shown voice it belongs to (the
 *   one `dynamicOf` gives), and the hairpins of the staff that touch the bar.
 */
export function gridOf(score: Score, where: VoiceRef, bar: number, grow: { up?: number; down?: number } = {}): GridDescription {
  const view = voiceView(score, where)
  const measure = view.measures[bar]
  if (!measure) throw new RangeError(`no bar ${bar}`)
  const pi = partIndex(score, where.part)
  const staff = score.bars[bar]!.parts[pi]!.staves[where.staff]!
  const own = blocksOf(measure.items, where.voice)
  const others = staff.voices.flatMap((items, voice) => (voice === where.voice ? [] : blocksOf(items, voice).blocks))

  // Rows.
  const mid = middleLine(clefAt(view, bar))
  const steps = [...own.blocks, ...others].map((b) => b.step)
  let hi = steps.length > 0 ? Math.max(...steps) + 3 : mid + 4
  let lo = steps.length > 0 ? Math.min(...steps) - 3 : mid - 4
  for (let up = true; hi - lo < 7; up = !up) {
    if (up) hi++
    else lo--
  }
  hi += Math.max(0, grow.up ?? 0)
  lo -= Math.max(0, grow.down ?? 0)
  const fifths = fifthsAt(view, bar)
  const rows: GridRow[] = []
  for (let step = hi; step >= lo; step--) {
    const name = STEPS[((step % 7) + 7) % 7]!
    const pitch: Pitch = { step: name, octave: Math.floor(step / 7) }
    const alter = keyAlter(fifths, name)
    if (alter !== 0) pitch.alter = alter
    rows.push({ pitch, step, line: Math.abs(step - mid) <= 4 && (step - mid) % 2 === 0 })
  }
  const rowOf = (step: number): number => hi - step

  // Columns.
  const barLength = barLengthAt(view, bar)
  const notes = measure.items.filter(isNote)
  const voiceLength = notes.length === 1 && notes[0]!.measureRest ? barLength : onsetIn(measure.items, measure.items.length)
  const total = cmp(voiceLength, barLength) > 0 ? voiceLength : barLength
  const barColumns = Math.ceil(sixteenths(barLength))
  const time = timeAt(view, bar)
  const beat = time ? beatLength(time) : frac(1, 4)
  const columns: GridColumn[] = []
  for (let c = 0; c < Math.ceil(sixteenths(total)); c++) {
    const start = frac(c, 16)
    const column: GridColumn = { start, inBar: c < barColumns }
    const beats = div(start, beat)
    if (c < barColumns && beats.d === 1) column.beat = beats.n + 1
    columns.push(column)
  }

  // The strip: loudness marks of the staff, tied to the shown voice's notes where they belong.
  const markOf = new Map<string, string>()
  for (const b of own.blocks) {
    if (b.locked === 'grace' || (b.chord && b.chord[0] !== b.id) || markOf.has(b.id)) continue
    const found = dynamicOf(score, b.id)
    if (found) markOf.set(found.id, b.id)
  }
  const dynamics: GridDynamic[] = []
  for (const items of staff.voices) {
    items.forEach((item, k) => {
      if (item.kind !== 'dynamic' || dynamics.some((d) => d.id === item.id)) return
      const start = onsetIn(items, k)
      const noteId = markOf.get(item.id)
      dynamics.push({ id: item.id, mark: item.mark, start, col: sixteenths(start), ...(noteId ? { noteId } : {}) })
    })
  }
  dynamics.sort((a, b) => cmp(a.start, b.start))

  // Hairpins of the staff (kept before their first note, in any voice and bar) that touch the bar.
  const index = noteIndex(score)
  const hairpins: GridHairpin[] = []
  score.bars.forEach((b) =>
    b.parts[pi]!.staves[where.staff]!.voices.forEach((items) =>
      items.forEach((item) => {
        if (!isWedge(item)) return
        const first = index.get(item.start)
        const last = index.get(item.stop)
        if (!first || !last || first.barIndex > bar || last.barIndex < bar) return
        const list = (p: typeof first): MeasureItem[] => score.bars[p.barIndex]!.parts[pi]!.staves[p.ref.staff]!.voices[p.ref.voice]!
        const before = first.barIndex < bar
        const after = last.barIndex > bar
        const from = before ? 0 : sixteenths(startOf(list(first), first.at))
        const to = after ? columns.length : sixteenths(add(startOf(list(last), last.at), last.note.grace ? frac(0) : last.note.duration))
        hairpins.push({ type: item.type, start: item.start, stop: item.stop, from, to, before, after })
      }),
    ),
  )
  hairpins.sort((a, b) => a.from - b.from)

  const withRow = <T extends { step: number }>(b: T): Omit<T, 'step'> & { row: number } => {
    const { step, ...rest } = b
    return { ...rest, row: rowOf(step) }
  }
  return {
    where,
    bar,
    rows,
    columns,
    barColumns,
    blocks: own.blocks.map(withRow),
    lockedRests: own.lockedRests,
    others: others.map(withRow),
    dynamics,
    hairpins,
  }
}
