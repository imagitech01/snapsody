import type { ElementRef } from './elements.ts'
import type { Clef, Measure, MeasureItem, Note, NoteType, Pitch, Score, Step, TempoItem, TimeSignature, WedgeItem } from './model.ts'
import { freshDirectionId, isDirection, isNote, isWedge } from './model.ts'
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

const MARK_NAMES = { tenuto: 'a tenuto', accent: 'an accent', strongAccent: 'a strong accent', staccatissimo: 'a staccatissimo' } as const

/** Tenuto, accent, strong accent and staccatissimo belong to notes; tapping the active mark removes it. */
function toggleArticulation(score: Score, id: string, mark: keyof typeof MARK_NAMES): void {
  const { note } = locate(score, id)
  if (note.rest) throw new EditError(`A rest cannot have ${MARK_NAMES[mark]}`)
  if (note[mark]) delete note[mark]
  else note[mark] = true
}

export function toggleTenuto(score: Score, id: string): void {
  toggleArticulation(score, id, 'tenuto')
}

export function toggleAccent(score: Score, id: string): void {
  toggleArticulation(score, id, 'accent')
}

export function toggleStrongAccent(score: Score, id: string): void {
  toggleArticulation(score, id, 'strongAccent')
}

export function toggleStaccatissimo(score: Score, id: string): void {
  toggleArticulation(score, id, 'staccatissimo')
}

/**
 * Sets the ornament of a note; a note has at most one, so a trill, turn or mordent replaces the others,
 * and choosing the one it has takes it off (change more-marks, D4).
 */
export function toggleOrnament(score: Score, id: string, ornament: NonNullable<Note['ornament']>): void {
  const { note } = locate(score, id)
  if (note.rest) throw new EditError(`A rest cannot have a ${ornament}`)
  if (note.ornament === ornament) delete note.ornament
  else note.ornament = ornament
}

/** The other note of a two-note tremolo that `id` belongs to: the stop after a start, the start before a stop. */
function tremoloPartner(score: Score, id: string): Note | undefined {
  const notes = allNotes(score).map((l) => l.note)
  const i = notes.findIndex((n) => n.id === id)
  const kind = notes[i]?.tremolo?.kind
  if (kind === 'start') {
    const next = notes[i + 1]
    return next?.tremolo?.kind === 'stop' ? next : undefined
  }
  if (kind === 'stop') {
    const prev = notes[i - 1]
    return prev?.tremolo?.kind === 'start' ? prev : undefined
  }
  return undefined
}

/** Takes the tremolo off a note, and off the other note of a two-note tremolo. */
function removeTremolo(score: Score, id: string): void {
  const partner = tremoloPartner(score, id)
  if (partner) delete partner.tremolo
  delete locate(score, id).note.tremolo
}

/** A single tremolo with 3 strokes, on or off. A note of a two-note tremolo takes it off both notes. */
export function toggleTremolo(score: Score, id: string): void {
  const { note } = locate(score, id)
  if (note.rest) throw new EditError('A rest cannot have a tremolo')
  if (note.tremolo) removeTremolo(score, id)
  else note.tremolo = { kind: 'single', strokes: 3 }
}

/** The first note of the chord that `id` is in, and whether it is in a chord at all (two or more notes). */
export function chordOf(score: Score, id: string): { first: Note; inChord: boolean } {
  const { measure, at } = locate(score, id)
  const [a, b] = chordSpan(measure.items, at)
  return { first: measure.items[a] as Note, inChord: b > a }
}

/** An arpeggio belongs to a chord and sits on its first note; the selected note may be any of the chord's. */
export function toggleArpeggio(score: Score, id: string): void {
  const { first, inChord } = chordOf(score, id)
  if (!inChord || first.rest) throw new EditError('An arpeggio needs a chord')
  if (first.arpeggio) delete first.arpeggio
  else first.arpeggio = true
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
  removeTremolo(score, id)
  // A hairpin item sits before its first note, so look the note up again once they are gone.
  for (const m of score.measures) m.items = m.items.filter((i) => !(isWedge(i) && (i.start === id || i.stop === id)))
  const { note, measure, barIndex, at } = locate(score, id)
  const next = neighbour(score, id, 1)
  const prev = neighbour(score, id, -1)
  measure.items.splice(at, 1)
  // A chord member left behind by its base takes over as the note.
  const after = measure.items[at]
  if (!note.chord && after && isNote(after) && after.chord) {
    delete after.chord
    // The chord's arpeggio moves to its new first note, unless that leaves one note.
    const more = measure.items[at + 1]
    if (note.arpeggio && more && isNote(more) && more.chord) after.arpeggio = true
  } else if (note.chord) {
    // A chord down to one note has no arpeggio.
    const [a, b] = chordSpan(measure.items, at - 1)
    if (a === b) delete (measure.items[a] as Note).arpeggio
  }
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
  delete note.strongAccent
  delete note.staccatissimo
  delete note.caesura
  delete note.ornament
  delete note.arpeggio
  removeTremolo(score, id)
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
    // The marking keeps its id when it is replaced, so a selection of it stays.
    item = { kind: 'tempo', id: firstTempoMarking(score)?.id ?? freshDirectionId(score) }
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

// ---------------------------------------------------------------- bar lines (change edit-bar-lines, design D1)

export type BarStart = 'normal' | 'repeat'
export type BarEnd = 'normal' | 'double' | 'repeat'

export interface BarLines {
  start: BarStart
  end: BarEnd
  /** How many times the section is played in total; 2 when the bar line does not say. */
  times: number
}

/** The fewest and most passes the editor offers for an end-repeat. */
export const MIN_REPEAT_TIMES = 2
export const MAX_REPEAT_TIMES = 8

/** Styles that read as a double bar line (a recognised final bar line `light-heavy` counts too, as in playback). */
const DOUBLE_STYLES = new Set(['light-light', 'light-heavy', 'heavy-light', 'heavy-heavy'])
const isPlainDouble = (b: Measure['leftBarline']): boolean => !!b && !b.repeat && !!b.style && DOUBLE_STYLES.has(b.style)

function barAt(score: Score, index: number): Measure {
  const m = Number.isInteger(index) ? score.measures[index] : undefined
  if (!m) throw new EditError('That bar does not exist')
  return m
}

/** Drops a bar line that says nothing any more (no style, repeat, count or ending). */
function tidyBarlines(m: Measure): void {
  for (const side of ['leftBarline', 'rightBarline'] as const) {
    const b = m[side]
    if (b && !b.style && !b.repeat && b.times === undefined && !b.ending) delete m[side]
  }
}

/**
 * Writes the boundary before bar `index` in one place: a double bar line written as the bar's left bar
 * line (no repeat) moves to the right bar line of the bar before it, unless that one already has a
 * style or a repeat of its own, in which case it is dropped. An ending on it stays where it is.
 */
function normalizeBoundary(score: Score, index: number): void {
  if (index <= 0 || index >= score.measures.length) return
  const m = score.measures[index]!
  if (!isPlainDouble(m.leftBarline)) return
  const prev = score.measures[index - 1]!
  if (!prev.rightBarline?.style && !prev.rightBarline?.repeat) prev.rightBarline = { ...prev.rightBarline, style: 'light-light' }
  delete m.leftBarline!.style
  tidyBarlines(m)
}

/** How the bar `index` starts and ends, whichever side of a boundary recognition wrote a double bar line on. */
export function barLinesOf(score: Score, index: number): BarLines {
  const m = barAt(score, index)
  const next = score.measures[index + 1]
  const right = m.rightBarline
  const end: BarEnd = right?.repeat === 'backward' ? 'repeat' : isPlainDouble(right) || isPlainDouble(next?.leftBarline) ? 'double' : 'normal'
  return {
    start: m.leftBarline?.repeat === 'forward' ? 'repeat' : 'normal',
    end,
    times: end === 'repeat' ? (right!.times ?? MIN_REPEAT_TIMES) : MIN_REPEAT_TIMES,
  }
}

/** Sets how the bar `index` starts: a plain bar line or a start-repeat `||:`. An ending on the bar line stays. */
export function setBarStart(score: Score, index: number, start: BarStart): void {
  const m = barAt(score, index)
  normalizeBoundary(score, index)
  const ending = m.leftBarline?.ending
  if (start === 'repeat') m.leftBarline = { style: 'heavy-light', repeat: 'forward', ...(ending ? { ending } : {}) }
  else if (ending) m.leftBarline = { ending }
  else delete m.leftBarline
}

/**
 * Sets how the bar `index` ends: a plain bar line, a double bar line `||` or an end-repeat `:||`. The
 * double bar line is always written as this bar's right bar line, so one on the next bar's left goes.
 * An end-repeat that stays an end-repeat keeps its count; an ending on the bar line stays.
 */
export function setBarEnd(score: Score, index: number, end: BarEnd): void {
  const m = barAt(score, index)
  const next = score.measures[index + 1]
  if (next && isPlainDouble(next.leftBarline)) {
    delete next.leftBarline!.style
    tidyBarlines(next)
  }
  const old = m.rightBarline
  const ending = old?.ending ? { ending: old.ending } : {}
  if (end === 'repeat') {
    const times = old?.repeat === 'backward' && old.times !== undefined && old.times !== MIN_REPEAT_TIMES ? { times: old.times } : {}
    m.rightBarline = { style: 'light-heavy', repeat: 'backward', ...times, ...ending }
  } else if (end === 'double') m.rightBarline = { style: 'light-light', ...ending }
  else if (old?.ending) m.rightBarline = { ...ending }
  else delete m.rightBarline
}

/** Sets how many times the section that ends in the end-repeat of bar `index` is played in total (2–8). */
export function setRepeatTimes(score: Score, index: number, times: number): void {
  const m = barAt(score, index)
  if (!Number.isInteger(times) || times < MIN_REPEAT_TIMES || times > MAX_REPEAT_TIMES) throw new EditError(`A repeat is played ${MIN_REPEAT_TIMES} to ${MAX_REPEAT_TIMES} times`)
  const right = m.rightBarline
  if (right?.repeat !== 'backward') throw new EditError('Only a bar that ends in an end-repeat has a number of passes')
  if (times === MIN_REPEAT_TIMES) delete right.times
  else right.times = times
}

// ---------------------------------------------------------------- clefs, key and time changes (change select-and-delete-elements, D3, D4)

const CLEF_SIGNS = new Set(['G', 'F', 'C'])

/** A pitch as a number of diatonic steps from C0 (C4 is 28, B4 is 34). */
const diatonic = (p: Pitch): number => p.octave * 7 + STEPS.indexOf(p.step)

/**
 * The pitch on the middle line of the staff under a clef, in diatonic steps: B4 for a treble clef, D3 for a
 * bass clef, C4 for an alto clef. The clef's own note is on its line (G4, F3 or C4), each line two steps
 * from the next, and an octave change moves it seven.
 */
function middleLine(clef: Clef): number {
  const sign = CLEF_SIGNS.has(clef.sign) ? clef.sign : 'G'
  const line = clef.line ?? (sign === 'G' ? 2 : sign === 'F' ? 4 : 3)
  const own = sign === 'G' ? 4 * 7 + 4 : sign === 'F' ? 3 * 7 + 3 : 4 * 7
  return own - (line - 3) * 2 + 7 * (clef.octaveChange ?? 0)
}

/** The clef in force at bar `index` (from 0): the last one set at or before it, else treble. */
export function clefAt(score: Score, index: number): Clef {
  for (let b = Math.min(index, score.measures.length - 1); b >= 0; b--) {
    const clef = score.measures[b]!.clef
    if (clef) return clef
  }
  return { sign: 'G', line: 2 }
}

/** The last bar (from 0) that the clef set at bar `index` applies to: the bar before the next clef change, or the last bar. */
function clefRangeEnd(score: Score, index: number): number {
  for (let b = index + 1; b < score.measures.length; b++) if (score.measures[b]!.clef) return b - 1
  return score.measures.length - 1
}

/**
 * Moves every pitched note of bars `from..to` by the difference between two clefs, so each stays on its
 * line or space of the staff (design D3), then works out the alters again: a printed accidental stays with
 * its note, any other note takes its alter from the key. One bar past the range too, for a tie into it.
 */
function keepStaffPositions(score: Score, from: number, to: number, before: Clef, after: Clef): void {
  const shift = middleLine(after) - middleLine(before)
  if (shift === 0) return
  for (let b = from; b <= to; b++) {
    for (const item of score.measures[b]!.items) {
      if (!isNote(item) || !item.pitch) continue
      const moved = diatonic(item.pitch) + shift
      item.pitch.octave = Math.floor(moved / 7)
      item.pitch.step = STEPS[((moved % 7) + 7) % 7]!
    }
  }
  resolveAlters(score, from, Math.min(to + 1, score.measures.length - 1))
}

/**
 * Sets the clef at bar `index` (from 0), the first one or a change, and keeps every note where it is on the
 * staff up to the next clef change: their pitches are read again under the new clef (spec "Fix a clef").
 */
export function setClef(score: Score, index: number, clef: Clef): void {
  const m = barAt(score, index)
  if (!CLEF_SIGNS.has(clef.sign)) throw new EditError('A clef is a treble, bass or C clef')
  const before = clefAt(score, index)
  m.clef = { ...clef }
  keepStaffPositions(score, index, clefRangeEnd(score, index), before, clef)
}

/**
 * Deletes the clef change at bar `index`: the clef before it applies again, and the notes keep their place
 * on the staff. The first clef is changed, not deleted.
 */
export function deleteClef(score: Score, index: number): void {
  const m = barAt(score, index)
  if (index === 0) throw new EditError('The first clef can be changed, not deleted')
  if (!m.clef) throw new EditError('There is no clef change in that bar')
  const before = m.clef
  const end = clefRangeEnd(score, index)
  delete m.clef
  keepStaffPositions(score, index, end, before, clefAt(score, index - 1))
}

/** Deletes the key change at bar `index`: the key before it applies again to the notes without their own accidental. */
export function deleteKey(score: Score, index: number): void {
  const m = barAt(score, index)
  if (index === 0) throw new EditError('The first key signature is changed in the Score tab, not deleted')
  if (!m.key) throw new EditError('There is no key change in that bar')
  delete m.key
  resolveAlters(score, index)
}

/** Deletes the time signature change at bar `index`: the one before it applies again (the bar check shows any bar that no longer fits). */
export function deleteTime(score: Score, index: number): void {
  const m = barAt(score, index)
  if (index === 0) throw new EditError('The first time signature is changed in the Score tab, not deleted')
  if (!m.time) throw new EditError('There is no time signature change in that bar')
  delete m.time
}

// ---------------------------------------------------------------- deleting a selected element (change select-and-delete-elements, D1)

/**
 * Deletes the element `ref` names, and only that (spec "Delete an element"). A slur or tie goes with both
 * its ends. The first clef, key and time signature, and bar lines, are not deleted. Throws `EditError` when
 * the element is not there.
 */
export function deleteElement(score: Score, ref: ElementRef): void {
  const gone = (): never => {
    throw new EditError('That element is no longer in the score')
  }
  switch (ref.kind) {
    case 'clef':
      return deleteClef(score, ref.bar)
    case 'key':
      return deleteKey(score, ref.bar)
    case 'time':
      return deleteTime(score, ref.bar)
    case 'barline':
      throw new EditError('A bar line is changed, not deleted')
    case 'dynamic':
    case 'tempo':
    case 'words':
      for (const m of score.measures) {
        const at = m.items.findIndex((i) => isDirection(i) && i.kind === ref.kind && i.id === ref.id)
        if (at >= 0) {
          m.items.splice(at, 1)
          return
        }
      }
      return gone()
    case 'slur': {
      const { note } = locate(score, ref.noteId)
      if (!note.slurs.some((s) => s.type === 'start' && s.number === ref.number)) return gone()
      return removeSlur(score, ref.noteId, ref.number, 'start')
    }
    case 'tie': {
      const { note } = locate(score, ref.noteId)
      if (!note.tieStart) return gone()
      return toggleTie(score, ref.noteId)
    }
    case 'wedge':
      for (const m of score.measures) {
        const at = m.items.findIndex((i) => isWedge(i) && i.start === ref.startId)
        if (at >= 0) {
          m.items.splice(at, 1)
          return
        }
      }
      return gone()
    case 'articulation': {
      const { note } = locate(score, ref.noteId)
      if (!note[ref.mark]) return gone()
      if (ref.mark === 'tremolo') removeTremolo(score, ref.noteId)
      else delete note[ref.mark]
      return
    }
  }
}
