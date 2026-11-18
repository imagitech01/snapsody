import type { Measure, MeasureItem, Note, NoteType, Pitch, Score, Step, TempoItem, TimeSignature, WedgeItem } from './model.ts'
import { isNote, isWedge } from './model.ts'
import { noteDuration } from './musicxml.ts'

/*
 * Editing the score model (task group 13, design D6). Every function mutates the score it is given
 * and either returns normally or throws `EditError` with a message the UI can show. The editing
 * session (editSession.ts) clones the score before each call, which is what makes undo work.
 *
 * Nothing in here checks the score afterwards: what the user should check (bar lengths, range, the
 * time signature) is computed from the score and the instrument in use, whenever it is needed
 * (warnings.ts, `computeWarnings`), so it also follows undo and redo. An edit that breaks a bar is
 * allowed; the bar is flagged, never repaired.
 *
 * Pitch and accidentals: `pitch.alter` is always the SOUNDING alter. `note.accidental` is the printed
 * accidental, if there is one. A note without a printed accidental inherits its alter from the key
 * signature and from earlier printed accidentals on the same step and octave in the same bar (a tie
 * carries it across the barline). `resolveAlters` recomputes the inherited alters; it runs after every
 * edit that can change them (pitch, accidental, delete, insert, key change).
 */

export class EditError extends Error {}

const STEPS: Step[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B']

/** Sharps in order (F C G D A E B) and flats in reverse. */
const SHARP_ORDER: Step[] = ['F', 'C', 'G', 'D', 'A', 'E', 'B']

/** Alter a key signature gives to a step. */
export function keyAlter(fifths: number, step: Step): number {
  if (fifths > 0) return SHARP_ORDER.slice(0, Math.min(7, fifths)).includes(step) ? 1 : 0
  if (fifths < 0) return SHARP_ORDER.slice().reverse().slice(0, Math.min(7, -fifths)).includes(step) ? -1 : 0
  return 0
}

const ACCIDENTAL_ALTER: Record<string, number> = {
  sharp: 1,
  flat: -1,
  natural: 0,
  'double-sharp': 2,
  'sharp-sharp': 2,
  'flat-flat': -2,
  'natural-sharp': 1,
  'natural-flat': -1,
}

export type AccidentalChoice = 'sharp' | 'flat' | 'natural' | 'none'

const setAlter = (p: Pitch, alter: number): void => {
  if (alter === 0) delete p.alter
  else p.alter = alter
}

/**
 * Recomputes the sounding alter of every note in measures `from..to` (inclusive, default all) from its
 * printed accidental, or, without one, from the key signature and earlier accidentals in the bar.
 */
export function resolveAlters(score: Score, from = 0, to = score.measures.length - 1): void {
  let fifths = 0
  /** Alter carried by an open tie, by "step+octave", into the next bar. */
  let tieCarry = new Map<string, number>()
  score.measures.forEach((m, index) => {
    if (m.key) fifths = m.key.fifths
    const inRange = index >= from && index <= to
    const bar = new Map<string, number>()
    const nextTie = new Map<string, number>()
    for (const item of m.items) {
      if (!isNote(item) || !item.pitch) continue
      const p = item.pitch
      const slot = `${p.step}${p.octave}`
      const printed = item.accidental !== undefined ? ACCIDENTAL_ALTER[item.accidental] : undefined
      if (inRange) {
        if (printed !== undefined) setAlter(p, printed)
        else if (item.accidental !== undefined) {
          // A printed accidental we have no value for (e.g. a quarter tone): trust the stored alter.
        } else if (item.tieStop && tieCarry.has(slot)) setAlter(p, tieCarry.get(slot)!)
        else if (bar.has(slot)) setAlter(p, bar.get(slot)!)
        else setAlter(p, keyAlter(fifths, p.step))
      }
      const alter = p.alter ?? 0
      if (printed !== undefined || item.accidental !== undefined) bar.set(slot, alter)
      if (item.tieStart) nextTie.set(slot, alter)
    }
    tieCarry = nextTie
  })
}

// ---------------------------------------------------------------- lookups

interface Located {
  measure: Measure
  /** Index of the measure in score.measures. */
  barIndex: number
  /** Index of the item in measure.items. */
  at: number
  note: Note
}

function locate(score: Score, id: string): Located {
  for (let barIndex = 0; barIndex < score.measures.length; barIndex++) {
    const measure = score.measures[barIndex]!
    const at = measure.items.findIndex((i) => isNote(i) && i.id === id)
    if (at >= 0) return { measure, barIndex, at, note: measure.items[at] as Note }
  }
  throw new EditError('That note no longer exists')
}

/** All notes of the score in order, with where they are. */
function allNotes(score: Score): Located[] {
  const out: Located[] = []
  score.measures.forEach((measure, barIndex) =>
    measure.items.forEach((item, at) => {
      if (isNote(item)) out.push({ measure, barIndex, at, note: item })
    }),
  )
  return out
}

/** The next (or previous) note of the score that is not a grace note. */
function neighbour(score: Score, id: string, dir: 1 | -1): Note | undefined {
  const notes = allNotes(score).filter((l) => !l.note.grace || l.note.id === id)
  const i = notes.findIndex((l) => l.note.id === id)
  return notes[i + dir]?.note
}

export function freshId(score: Score): string {
  const used = new Set(allNotes(score).map((l) => l.note.id))
  let n = used.size + 1
  while (used.has(`e${n}`)) n++
  return `e${n}`
}

// ---------------------------------------------------------------- pitch

/** Moves a note one diatonic step up (`1`) or down (`-1`); B up is C of the next octave. */
export function stepPitch(score: Score, id: string, dir: 1 | -1): void {
  const { note, barIndex } = locate(score, id)
  if (!note.pitch) throw new EditError('A rest has no pitch')
  const i = STEPS.indexOf(note.pitch.step) + dir
  if (i < 0) {
    note.pitch.step = 'B'
    note.pitch.octave -= 1
  } else if (i > 6) {
    note.pitch.step = 'C'
    note.pitch.octave += 1
  } else note.pitch.step = STEPS[i]!
  // A printed accidental belongs to the note (it was read next to it), so it travels with the step.
  resolveAlters(score, barIndex, barIndex)
}

export function setAccidental(score: Score, id: string, choice: AccidentalChoice): void {
  const { note, barIndex } = locate(score, id)
  if (!note.pitch) throw new EditError('A rest has no accidental')
  if (choice === 'none') delete note.accidental
  else note.accidental = choice
  resolveAlters(score, barIndex, barIndex)
}

// ---------------------------------------------------------------- duration

export interface DurationChoice {
  type: NoteType
  dots: number
  triplet: boolean
}

/** Whole … 16th, the values offered in the editor. */
export const DURATION_TYPES: NoteType[] = ['whole', 'half', 'quarter', 'eighth', '16th']

/** Chunks runs of notes that share a time modification into complete groups and marks their ends. */
function normaliseTuplets(measure: Measure): void {
  const notes = measure.items.filter(isNote).filter((n) => !n.grace)
  for (const n of notes) n.tuplets = []
  let run: Note[] = []
  const flush = () => {
    if (run.length === 0) return
    const size = run[0]!.timeMod!.actual
    for (let i = 0; i + size <= run.length; i += size) {
      run[i]!.tuplets.push({ type: 'start', number: 1 })
      run[i + size - 1]!.tuplets.push({ type: 'stop', number: 1 })
    }
    run = []
  }
  for (const n of notes) {
    if (n.timeMod && (run.length === 0 || (run[0]!.timeMod!.actual === n.timeMod.actual && run[0]!.timeMod!.normal === n.timeMod.normal))) run.push(n)
    else {
      flush()
      if (n.timeMod) run.push(n)
    }
  }
  flush()
}

export function setDuration(score: Score, id: string, choice: DurationChoice): void {
  const { note, measure } = locate(score, id)
  if (note.grace) throw new EditError('A grace note has no length to edit')
  note.type = choice.type
  note.dots = choice.dots
  if (choice.triplet) note.timeMod = { actual: 3, normal: 2 }
  else delete note.timeMod
  note.duration = noteDuration(note.type, note.dots, note.timeMod)
  delete note.measureRest
  normaliseTuplets(measure)
}

// ---------------------------------------------------------------- slur, tie, staccato

export function toggleStaccato(score: Score, id: string): void {
  const { note } = locate(score, id)
  if (note.rest) throw new EditError('A rest cannot be staccato')
  if (note.staccato) delete note.staccato
  else note.staccato = true
}

/** Tenuto and accent belong to notes; tapping the active mark removes it. */
function toggleArticulation(score: Score, id: string, mark: 'tenuto' | 'accent'): void {
  const { note } = locate(score, id)
  if (note.rest) throw new EditError(`A rest cannot have a${mark === 'accent' ? 'n' : ''} ${mark}`)
  if (note[mark]) delete note[mark]
  else note[mark] = true
}

export function toggleTenuto(score: Score, id: string): void {
  toggleArticulation(score, id, 'tenuto')
}

export function toggleAccent(score: Score, id: string): void {
  toggleArticulation(score, id, 'accent')
}

/** A fermata can sit on a note or on a rest. */
export function toggleFermata(score: Score, id: string): void {
  const { note } = locate(score, id)
  if (note.fermata) delete note.fermata
  else note.fermata = true
}

/** Removes the slur that `mark` (on the note `id`) belongs to: both its start and its stop. */
function removeSlur(score: Score, id: string, number: number, type: 'start' | 'stop' | 'continue'): void {
  const notes = allNotes(score).map((l) => l.note)
  const i = notes.findIndex((n) => n.id === id)
  const own = notes[i]!
  own.slurs = own.slurs.filter((s) => !(s.number === number && s.type === type))
  if (type === 'continue') return
  const step = type === 'start' ? 1 : -1
  const want = type === 'start' ? 'stop' : 'start'
  for (let j = i + step; j >= 0 && j < notes.length; j += step) {
    const found = notes[j]!.slurs.findIndex((s) => s.number === number && s.type === want)
    if (found >= 0) {
      notes[j]!.slurs.splice(found, 1)
      return
    }
  }
}

/**
 * Slur toggle: when the note has a slur mark the whole slur is removed; otherwise a slur is added from
 * the note to the next note.
 */
export function toggleSlur(score: Score, id: string): void {
  const { note } = locate(score, id)
  const own = note.slurs.find((s) => s.type === 'start') ?? note.slurs.find((s) => s.type === 'stop')
  if (own) {
    removeSlur(score, id, own.number, own.type)
    return
  }
  if (note.rest) throw new EditError('A slur needs a note, not a rest')
  const next = neighbour(score, id, 1)
  if (!next || next.rest) throw new EditError('A slur needs a following note')
  const taken = new Set([...note.slurs, ...next.slurs].map((s) => s.number))
  let number = 1
  while (taken.has(number)) number++
  note.slurs.push({ type: 'start', number })
  next.slurs.push({ type: 'stop', number })
}

/**
 * Adds a slur from the note `fromId` to the note `toId`: the first and the last note of the phrase, as
 * the editor lets the user choose them (spec `score-editing` "Articulation marks"). They must be two
 * notes, not rests, the first before the last. The slur gets the lowest number that no other slur
 * open anywhere under it is using, so a slur inside another one stays apart from it.
 */
export function addSlur(score: Score, fromId: string, toId: string): void {
  locate(score, fromId)
  locate(score, toId)
  const notes = allNotes(score)
    .map((l) => l.note)
    .filter((n) => !n.grace)
  const i = notes.findIndex((n) => n.id === fromId)
  const j = notes.findIndex((n) => n.id === toId)
  if (i < 0 || j < 0) throw new EditError('A slur starts and ends on notes, not on grace notes')
  if (i >= j) throw new EditError('A slur joins two different notes, the first one before the last one')
  if (notes[i]!.rest || notes[j]!.rest) throw new EditError('A slur starts and ends on notes, not rests')
  const open = new Set<number>()
  const taken = new Set<number>()
  notes.forEach((n, k) => {
    const underNew = (): void => {
      if (k >= i && k <= j) for (const number of open) taken.add(number)
    }
    underNew()
    for (const s of n.slurs) if (s.type === 'stop') open.delete(s.number)
    for (const s of n.slurs) if (s.type === 'start') open.add(s.number)
    underNew()
  })
  let number = 1
  while (taken.has(number)) number++
  notes[i]!.slurs.push({ type: 'start', number })
  notes[j]!.slurs.push({ type: 'stop', number })
}

/** True when two notes have the same written step, octave and sounding alter. */
function samePitch(a: Note, b: Note): boolean {
  return !!a.pitch && !!b.pitch && a.pitch.step === b.pitch.step && a.pitch.octave === b.pitch.octave && (a.pitch.alter ?? 0) === (b.pitch.alter ?? 0)
}

/**
 * Ties the note `fromId` to the note `toId`, chosen as the first and last note of the tie. A tie joins
 * a note to the one right after it, and both must have the same pitch.
 */
export function addTie(score: Score, fromId: string, toId: string): void {
  const { note } = locate(score, fromId)
  locate(score, toId)
  if (!note.pitch) throw new EditError('A tie needs a note, not a rest')
  const next = neighbour(score, fromId, 1)
  if (!next || next.id !== toId) throw new EditError('A tie joins a note to the note right after it')
  if (!samePitch(note, next)) throw new EditError('A tie needs the next note to have the same pitch')
  if (note.tieStart) throw new EditError('Those notes are already tied')
  note.tieStart = true
  next.tieStop = true
}

/** Tie toggle: removes the note's tie, or ties the note to the next note when that has the same pitch. */
export function toggleTie(score: Score, id: string): void {
  const { note } = locate(score, id)
  if (note.tieStart) {
    delete note.tieStart
    const next = neighbour(score, id, 1)
    if (next) delete next.tieStop
    return
  }
  if (note.tieStop) {
    delete note.tieStop
    const prev = neighbour(score, id, -1)
    if (prev) delete prev.tieStart
    return
  }
  if (!note.pitch) throw new EditError('A tie needs a note, not a rest')
  const next = neighbour(score, id, 1)
  if (!next || !samePitch(note, next)) throw new EditError('A tie needs the next note to have the same pitch')
  note.tieStart = true
  next.tieStop = true
}

// ---------------------------------------------------------------- hairpins (crescendo, diminuendo)

export type WedgeType = WedgeItem['type']

/** Where each melody note stands in the score: hairpins start and stop on these, never on grace notes or chord members. */
function melodyOrder(score: Score): Map<string, number> {
  const order = new Map<string, number>()
  for (const l of allNotes(score)) if (!l.note.grace && !l.note.chord) order.set(l.note.id, order.size)
  return order
}

/** Every hairpin of the score with the measure that holds it and the span of melody notes it covers. */
function hairpins(score: Score): { item: WedgeItem; measure: Measure; from: number; to: number }[] {
  const order = melodyOrder(score)
  const found: { item: WedgeItem; measure: Measure; from: number; to: number }[] = []
  for (const measure of score.measures) {
    for (const item of measure.items) {
      if (!isWedge(item)) continue
      const from = order.get(item.start)
      const to = order.get(item.stop)
      if (from !== undefined && to !== undefined && from <= to) found.push({ item, measure, from, to })
    }
  }
  return found
}

/** The hairpin that covers the note (any note from its first to its last, both included), for showing the mark as active. */
export function wedgeAt(score: Score, id: string): WedgeItem | undefined {
  const at = melodyOrder(score).get(id)
  if (at === undefined) return undefined
  return hairpins(score).find((h) => h.from <= at && at <= h.to)?.item
}

/**
 * Adds a crescendo or diminuendo from the note `fromId` to the note `toId` (the same note is allowed:
 * a hairpin over one long note). It must not overlap another hairpin and must cover at least one
 * sounding note; the first note may not come after the last.
 */
export function addWedge(score: Score, type: WedgeType, fromId: string, toId: string): void {
  const first = locate(score, fromId)
  const last = locate(score, toId)
  const order = melodyOrder(score)
  const from = order.get(fromId)
  const to = order.get(toId)
  if (from === undefined || to === undefined) throw new EditError('A hairpin starts and stops on notes of the melody, not on grace notes or chord notes')
  if (from > to) throw new EditError('A hairpin must end on or after the note it starts on')
  if (hairpins(score).some((h) => h.from <= to && from <= h.to)) throw new EditError('That would overlap another hairpin')
  const covered = allNotes(score).filter((l) => {
    const at = order.get(l.note.id)
    return at !== undefined && at >= from && at <= to
  })
  if (covered.every((l) => l.note.rest)) throw new EditError('A hairpin needs at least one note under it, not only rests')
  // Kept in the measure of its first note, directly before that note (the form the parser gives).
  const wedge: WedgeItem = { kind: 'wedge', type, start: fromId, stop: last.note.id }
  first.measure.items.splice(first.at, 0, wedge)
}

/** Removes the hairpin that covers the note (any note under it, not only its ends). */
export function removeWedge(score: Score, id: string): void {
  locate(score, id)
  const at = melodyOrder(score).get(id)
  const found = at === undefined ? undefined : hairpins(score).find((h) => h.from <= at && at <= h.to)
  if (!found) throw new EditError('There is no hairpin on that note')
  found.measure.items.splice(found.measure.items.indexOf(found.item), 1)
}

// ---------------------------------------------------------------- delete and insert

/** First and last item index of the chord that contains the item at `at`. */
function chordSpan(items: MeasureItem[], at: number): [number, number] {
  let a = at
  while (a > 0 && isNote(items[a]!) && (items[a] as Note).chord) a--
  let b = at
  while (b + 1 < items.length && isNote(items[b + 1]!) && (items[b + 1] as Note).chord) b++
  return [a, b]
}

/** Takes the slurs and ties of a note, and their other ends, away: a rest or a deleted note has none. */
function dropSlursAndTies(score: Score, note: Note): void {
  for (const s of [...note.slurs]) if (s.type !== 'continue') removeSlur(score, note.id, s.number, s.type)
  note.slurs = []
  if (note.tieStart) {
    const next = neighbour(score, note.id, 1)
    if (next) delete next.tieStop
    delete note.tieStart
  }
  if (note.tieStop) {
    const prev = neighbour(score, note.id, -1)
    if (prev) delete prev.tieStart
    delete note.tieStop
  }
}

/**
 * Deletes a note and returns the id of the note to select next (the following one, else the previous).
 * A hairpin that starts or stops on the note goes with it, as a slur does.
 */
export function deleteNote(score: Score, id: string): string | undefined {
  dropSlursAndTies(score, locate(score, id).note)
  // A hairpin item sits before its first note, so look the note up again once they are gone.
  for (const m of score.measures) m.items = m.items.filter((i) => !(isWedge(i) && (i.start === id || i.stop === id)))
  const { note, measure, barIndex, at } = locate(score, id)
  const next = neighbour(score, id, 1)
  const prev = neighbour(score, id, -1)
  measure.items.splice(at, 1)
  // A chord member left behind by its base takes over as the note.
  const after = measure.items[at]
  if (!note.chord && after && isNote(after) && after.chord) delete after.chord
  normaliseTuplets(measure)
  resolveAlters(score, barIndex, barIndex)
  return (next ?? prev)?.id
}

/** A pitch for a note made next to, or out of a rest at, the note `id`: its own, else the nearest pitched note's, else B4. No accidental. */
function pitchNear(score: Score, id: string): Pitch {
  const notes = allNotes(score)
  const i = notes.findIndex((l) => l.note.id === id)
  let source: Pitch | undefined = notes[i]?.note.pitch
  for (let d = 1; d < notes.length && !source; d++) source = notes[i + d]?.note.pitch ?? notes[i - d]?.note.pitch
  return source ? { step: source.step, octave: source.octave } : { step: 'B', octave: 4 }
}

/**
 * Inserts a note or a rest before or after the selected note and returns its new id. The new note takes
 * the length of the selected one; a note takes its pitch too (a rest selected: the nearest pitched note,
 * else B4), without a printed accidental.
 */
export function insertNote(score: Score, id: string, where: 'before' | 'after', what: 'note' | 'rest'): string {
  const { note, measure, at, barIndex } = locate(score, id)
  const newId = freshId(score)
  const fresh: Note = { kind: 'note', id: newId, dots: note.dots, duration: note.duration, slurs: [], tuplets: [] }
  if (note.type) fresh.type = note.type
  if (note.timeMod) fresh.timeMod = { ...note.timeMod }
  if (what === 'rest') fresh.rest = true
  else fresh.pitch = pitchNear(score, id)
  if (fresh.duration.n === 0) throw new EditError('Cannot insert next to a grace note')
  const [first, last] = chordSpan(measure.items, at)
  let index = where === 'before' ? first : last + 1
  // A hairpin item stays directly before its first note, so a note inserted before that note goes in front of it, outside the hairpin.
  while (where === 'before' && index > 0 && isWedge(measure.items[index - 1]!) && (measure.items[index - 1] as WedgeItem).start === (measure.items[first] as Note).id) index--
  measure.items.splice(index, 0, fresh)
  normaliseTuplets(measure)
  resolveAlters(score, barIndex, barIndex)
  return newId
}

// ---------------------------------------------------------------- note <-> rest

/**
 * Turns a note into a rest of the same length and place (the id stays). A rest carries no pitch,
 * accidental, tie, slur or articulation, so those go, and the other ends of its slurs and ties go
 * with them; a fermata and any hairpin that ends on it stay. A chord's other notes are removed with it.
 */
export function noteToRest(score: Score, id: string): void {
  const { note } = locate(score, id)
  if (note.rest) throw new EditError('That is already a rest')
  if (note.grace) throw new EditError('A grace note cannot become a rest')
  if (note.chord) throw new EditError('A note of a chord cannot become a rest; delete it instead')
  const { measure, barIndex, at } = locate(score, id)
  const [, last] = chordSpan(measure.items, at)
  for (let k = at + 1; k <= last; k++) dropSlursAndTies(score, measure.items[k] as Note)
  measure.items.splice(at + 1, last - at)
  dropSlursAndTies(score, note)
  delete note.pitch
  delete note.accidental
  delete note.staccato
  delete note.tenuto
  delete note.accent
  delete note.breath
  note.rest = true
  // Later notes in the bar (and a note tied across the barline) lose what they took from this one.
  resolveAlters(score, barIndex, barIndex + 1)
}

/** The printed value (type and dots) that has exactly this length, for a whole-measure rest that has none. */
function valueOf(duration: Note['duration']): { type: NoteType; dots: number } | undefined {
  for (const type of ['whole', 'half', 'quarter', 'eighth', '16th'] as NoteType[]) {
    for (let dots = 0; dots <= 2; dots++) {
      const d = noteDuration(type, dots)
      if (d.n === duration.n && d.d === duration.d) return { type, dots }
    }
  }
  return undefined
}

/**
 * Turns a rest into a note of the same length and place (the id stays), on the pitch of the nearest
 * note (B4 when there is none) and without an accidental; a fermata stays. A whole-measure rest takes
 * the printed value of its length, so it needs one that a single note can have.
 */
export function restToNote(score: Score, id: string): void {
  const { note, barIndex } = locate(score, id)
  if (!note.rest) throw new EditError('That is already a note')
  if (note.measureRest && !note.type) {
    const value = valueOf(note.duration)
    if (!value) throw new EditError('This bar rest is too long for one note: set its length first')
    note.type = value.type
    note.dots = value.dots
  }
  const pitch = pitchNear(score, id)
  delete note.measureRest
  delete note.rest
  note.pitch = pitch
  resolveAlters(score, barIndex, barIndex)
}

// ---------------------------------------------------------------- key, time, tempo

/**
 * Sets the key signature at the start of the exercise (later key changes in the score are kept) and
 * recomputes every un-marked note's sounding alter: with one sharp, every F without its own accidental
 * becomes F♯ (an F with a printed natural stays F).
 */
export function setKey(score: Score, fifths: number): void {
  if (!Number.isInteger(fifths) || fifths < -7 || fifths > 7) throw new EditError('A key signature has 0 to 7 sharps or flats')
  const first = score.measures[0]
  if (!first) throw new EditError('The score has no bars')
  first.key = { fifths, ...(first.key?.mode ? { mode: first.key.mode } : {}) }
  resolveAlters(score)
}

/** Sets the time signature at the start of the exercise; it is no longer an inferred one. */
export function setTime(score: Score, beats: number, beatType: number, symbol?: 'common' | 'cut'): void {
  if (!Number.isInteger(beats) || beats < 1 || beats > 32) throw new EditError('Beats must be 1 to 32')
  if (![1, 2, 4, 8, 16].includes(beatType)) throw new EditError('The beat type must be 1, 2, 4, 8 or 16')
  const first = score.measures[0]
  if (!first) throw new EditError('The score has no bars')
  const time: TimeSignature = { beats, beatType }
  if (symbol) time.symbol = symbol
  first.time = time
  for (const m of score.measures) if (m.time?.inferred) delete m.time.inferred
}

export interface TempoChoice {
  /** "Moderato"; empty or absent for none. */
  words?: string
  /** Beats per minute of `beatUnit` (default quarter), absent for none. */
  perMinute?: number
  beatUnit?: NoteType
  beatUnitDots?: number
}

/** Replaces the exercise's first tempo marking (or adds one at the start); an empty choice removes it. */
export function setTempoMarking(score: Score, choice: TempoChoice): void {
  const words = choice.words?.trim()
  const hasMark = choice.perMinute !== undefined
  if (hasMark && !(choice.perMinute! > 0 && Number.isFinite(choice.perMinute!))) throw new EditError('The tempo must be a positive number')
  let item: TempoItem | undefined
  if (words || hasMark) {
    item = { kind: 'tempo' }
    if (words) item.words = words
    if (hasMark) {
      item.beatUnit = choice.beatUnit ?? 'quarter'
      if (choice.beatUnitDots) item.beatUnitDots = choice.beatUnitDots
      item.perMinute = choice.perMinute!
    }
  }
  for (const m of score.measures) {
    const at = m.items.findIndex((i) => i.kind === 'tempo')
    if (at >= 0) {
      if (item) m.items.splice(at, 1, item)
      else m.items.splice(at, 1)
      return
    }
  }
  if (item) {
    const first = score.measures[0]
    if (!first) throw new EditError('The score has no bars')
    first.items.unshift(item)
  }
}

/** The first tempo marking of the score, for the editor form. */
export function firstTempoMarking(score: Score): TempoItem | undefined {
  for (const m of score.measures) for (const i of m.items) if (i.kind === 'tempo') return i
  return undefined
}
