import type { ElementRef } from './elements.ts'
import type { Bar, StaffBar, Barline, Clef, DynamicItem, Measure, MeasureItem, Note, NoteType, PartBar, Pitch, Score, Step, TempoItem, TimeSignature, VoiceRef, VoiceScore, WedgeItem } from './model.ts'
import { allItemLists, firstVoice, freshDirectionId, isDirection, isNote, isWedge, partIndex, placeOfNote, sameVoice, usedIds, voiceView, voices } from './model.ts'
import { endingLabels, parseEndingNumbers } from './endings.ts'
import { noteDuration } from './musicxml.ts'
import type { Frac } from './rational.ts'
import { add, cmp, div, eq, frac, mul, sub } from './rational.ts'
import { beatLength } from './beams.ts'

/*
 * Editing the score model (task group 13, design D6). Every function mutates the score it is given
 * and either returns normally or throws `EditError` with a message the UI can show. The editing
 * session (editSession.ts) clones the score before each call, which is what makes undo work.
 *
 * Nothing in here checks the score afterwards: what the user should check (bar lengths, range, the
 * time signature) is computed from the score and the instrument in use, whenever it is needed
 * (warnings.ts, `computeScoreWarnings`), so it also follows undo and redo. An edit that breaks a bar is
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
export function resolveAlters(score: VoiceScore, from = 0, to = score.measures.length - 1): void {
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

function locate(score: VoiceScore, id: string): Located {
  for (let barIndex = 0; barIndex < score.measures.length; barIndex++) {
    const measure = score.measures[barIndex]!
    const at = measure.items.findIndex((i) => isNote(i) && i.id === id)
    if (at >= 0) return { measure, barIndex, at, note: measure.items[at] as Note }
  }
  throw new EditError('That note no longer exists')
}

/** All notes of the score in order, with where they are. */
function allNotes(score: VoiceScore): Located[] {
  const out: Located[] = []
  score.measures.forEach((measure, barIndex) =>
    measure.items.forEach((item, at) => {
      if (isNote(item)) out.push({ measure, barIndex, at, note: item })
    }),
  )
  return out
}

/**
 * The note that starts the next (or previous) chord or note of the voice, not a grace note. A chord counts once,
 * by its first note, so a chord's own notes are never each other's neighbours (change edit-parts, D3).
 */
function neighbour(score: VoiceScore, id: string, dir: 1 | -1): Note | undefined {
  const base = chordMembers(score, id)[0]!
  const notes = allNotes(score).filter((l) => (!l.note.grace && !l.note.chord) || l.note.id === base.id)
  const i = notes.findIndex((l) => l.note.id === base.id)
  return notes[i + dir]?.note
}

/** The notes of the chord that holds the note `id`, from its first note; a lone note is a chord of one. */
function chordMembers(score: VoiceScore, id: string): Note[] {
  const { measure, at } = locate(score, id)
  const [a, b] = chordSpan(measure.items, at)
  return measure.items.slice(a, b + 1) as Note[]
}

/** Same written step and octave: the note of a chord a tie goes to. */
const sameLine = (a: Note, b: Note): boolean => !!a.pitch && !!b.pitch && a.pitch.step === b.pitch.step && a.pitch.octave === b.pitch.octave

/**
 * The note a tie from (`dir` 1) or to (-1) the note `id` joins: in the next (previous) chord or note, the note of
 * the same step and octave that has the other end of a tie, else one of the same step and octave, else for a lone
 * note the note itself.
 */
function tiePartner(score: VoiceScore, id: string, dir: 1 | -1): Note | undefined {
  const own = locate(score, id).note
  const other = neighbour(score, id, dir)
  if (!other) return undefined
  const chord = chordMembers(score, other.id)
  const end = dir > 0 ? 'tieStop' : 'tieStart'
  return chord.find((n) => sameLine(n, own) && n[end]) ?? chord.find((n) => sameLine(n, own)) ?? chord.find((n) => n[end]) ?? (chord.length === 1 ? other : undefined)
}

/**
 * The view of the voice that holds the note `id` (change edit-parts, D5): every note edit runs on the note's own
 * voice, so the edits below work in any part, staff and voice. Throws `EditError` when no note has that id.
 */
export function voiceOfNote(score: Score, id: string): VoiceScore {
  const place = placeOfNote(score, id)
  if (!place) throw new EditError('That note no longer exists')
  return voiceView(score, place.ref)
}

/**
 * What a note edit runs on: a voice view as it is, or for a whole score the view of the note's voice. The note
 * edits take either, so the editor passes the score and the tests of one voice keep passing a view.
 */
function viewFor(target: Score | VoiceScore, id: string): VoiceScore {
  return 'bars' in target ? voiceOfNote(target, id) : target
}

export function freshId(score: VoiceScore): string {
  // Ids are unique across the whole score, every voice included (design D2), so they are taken from `usedIds`.
  const used = usedIds(score)
  let n = (score.of ? allNoteCount(score.of.score) : allNotes(score).length) + 1
  while (used.has(`e${n}`)) n++
  return `e${n}`
}

function allNoteCount(score: Score): number {
  let count = 0
  for (const bar of score.bars) for (const pb of bar.parts) for (const sb of pb.staves) for (const v of sb.voices) for (const i of v) if (isNote(i)) count++
  return count
}

/**
 * The score and the voice a view was made from, for the score-level setters below (key, time, clef, bar
 * lines): a view's bar attributes are read-only copies, so those are set on the score. Throws for a bare
 * view (one not made by `voiceView`).
 */
export function ownerOf(view: VoiceScore): { score: Score; ref: VoiceRef } {
  if (!view.of) throw new EditError('This edit needs a score made from parts')
  return view.of
}

// ---------------------------------------------------------------- pitch

/** Moves a note one diatonic step up (`1`) or down (`-1`); B up is C of the next octave. */
export function stepPitch(target: Score | VoiceScore, id: string, dir: 1 | -1): void {
  const score = viewFor(target, id)
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

export function setAccidental(target: Score | VoiceScore, id: string, choice: AccidentalChoice): void {
  const score = viewFor(target, id)
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
  const all = measure.items.filter(isNote).filter((n) => !n.grace)
  for (const n of all) n.tuplets = []
  // A chord is one place in a triplet: its first note carries the bracket, its other notes are not counted.
  const notes = all.filter((n) => !n.chord)
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

export function setDuration(target: Score | VoiceScore, id: string, choice: DurationChoice): void {
  const score = viewFor(target, id)
  const { note, measure } = locate(score, id)
  if (note.grace) throw new EditError('A grace note has no length to edit')
  // Length, dots and triplet belong to the whole chord (change edit-parts, D3): every note of it changes.
  for (const member of chordMembers(score, id)) {
    member.type = choice.type
    member.dots = choice.dots
    if (choice.triplet) member.timeMod = { actual: 3, normal: 2 }
    else delete member.timeMod
    member.duration = noteDuration(member.type, member.dots, member.timeMod)
    delete member.measureRest
  }
  normaliseTuplets(measure)
}

// ---------------------------------------------------------------- slur, tie, staccato

export function toggleStaccato(target: Score | VoiceScore, id: string): void {
  const score = viewFor(target, id)
  const { note } = locate(score, id)
  if (note.rest) throw new EditError('A rest cannot be staccato')
  if (note.staccato) delete note.staccato
  else note.staccato = true
}

const MARK_NAMES = {
  tenuto: 'a tenuto',
  accent: 'an accent',
  strongAccent: 'a strong accent',
  staccatissimo: 'a staccatissimo',
  breath: 'a breath mark',
  caesura: 'a caesura',
} as const

/** Tenuto, accent, strong accent, staccatissimo, breath mark and caesura belong to notes; tapping the active mark removes it. */
function toggleArticulation(target: Score | VoiceScore, id: string, mark: keyof typeof MARK_NAMES): void {
  const score = viewFor(target, id)
  const { note } = locate(score, id)
  if (note.rest) throw new EditError(`A rest cannot have ${MARK_NAMES[mark]}`)
  if (note[mark]) delete note[mark]
  else note[mark] = true
}

export function toggleTenuto(score: Score | VoiceScore, id: string): void {
  toggleArticulation(score, id, 'tenuto')
}

export function toggleAccent(score: Score | VoiceScore, id: string): void {
  toggleArticulation(score, id, 'accent')
}

export function toggleStrongAccent(score: Score | VoiceScore, id: string): void {
  toggleArticulation(score, id, 'strongAccent')
}

export function toggleStaccatissimo(score: Score | VoiceScore, id: string): void {
  toggleArticulation(score, id, 'staccatissimo')
}

/** A breath mark after the note, on or off (change redesign-score-editor, D5); playback leaves a short gap after the note. */
export function toggleBreath(score: Score | VoiceScore, id: string): void {
  toggleArticulation(score, id, 'breath')
}

/** A caesura after the note, on or off (change redesign-score-editor, D5); playback leaves a longer gap than a breath mark. */
export function toggleCaesura(score: Score | VoiceScore, id: string): void {
  toggleArticulation(score, id, 'caesura')
}

/**
 * Sets the ornament of a note; a note has at most one, so a trill, turn or mordent replaces the others,
 * and choosing the one it has takes it off (change more-marks, D4).
 */
export function toggleOrnament(target: Score | VoiceScore, id: string, ornament: NonNullable<Note['ornament']>): void {
  const score = viewFor(target, id)
  const { note } = locate(score, id)
  if (note.rest) throw new EditError(`A rest cannot have a ${ornament}`)
  if (note.ornament === ornament) delete note.ornament
  else note.ornament = ornament
}

/** The other note of a two-note tremolo that `id` belongs to: the stop after a start, the start before a stop. */
function tremoloPartner(score: VoiceScore, id: string): Note | undefined {
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
function removeTremolo(score: VoiceScore, id: string): void {
  const partner = tremoloPartner(score, id)
  if (partner) delete partner.tremolo
  delete locate(score, id).note.tremolo
}

/** A single tremolo with 3 strokes, on or off. A note of a two-note tremolo takes it off both notes. */
export function toggleTremolo(target: Score | VoiceScore, id: string): void {
  const score = viewFor(target, id)
  const { note } = locate(score, id)
  if (note.rest) throw new EditError('A rest cannot have a tremolo')
  if (note.tremolo) removeTremolo(score, id)
  else note.tremolo = { kind: 'single', strokes: 3 }
}

/** The first note of the chord that `id` is in, and whether it is in a chord at all (two or more notes). */
export function chordOf(target: Score | VoiceScore, id: string): { first: Note; inChord: boolean } {
  const score = viewFor(target, id)
  const { measure, at } = locate(score, id)
  const [a, b] = chordSpan(measure.items, at)
  return { first: measure.items[a] as Note, inChord: b > a }
}

/** An arpeggio belongs to a chord and sits on its first note; the selected note may be any of the chord's. */
export function toggleArpeggio(target: Score | VoiceScore, id: string): void {
  const score = viewFor(target, id)
  const { first, inChord } = chordOf(score, id)
  if (!inChord || first.rest) throw new EditError('An arpeggio needs a chord')
  if (first.arpeggio) delete first.arpeggio
  else first.arpeggio = true
}

/** A fermata can sit on a note or on a rest. */
export function toggleFermata(target: Score | VoiceScore, id: string): void {
  const score = viewFor(target, id)
  const { note } = locate(score, id)
  if (note.fermata) delete note.fermata
  else note.fermata = true
}

/** Removes the slur that `mark` (on the note `id`) belongs to: both its start and its stop. */
function removeSlur(score: VoiceScore, id: string, number: number, type: 'start' | 'stop' | 'continue'): void {
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
export function toggleSlur(target: Score | VoiceScore, id: string): void {
  const score = viewFor(target, id)
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
export function addSlur(target: Score | VoiceScore, fromId: string, toId: string): void {
  oneVoice(target, fromId, toId, 'A slur joins notes of one voice')
  const score = viewFor(target, fromId)
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

/** On a whole score, two notes of different voices cannot be joined by a slur or tie (change edit-parts, D7). */
function oneVoice(target: Score | VoiceScore, a: string, b: string, message: string): void {
  if (!('bars' in target)) return
  const pa = placeOfNote(target, a)
  const pb = placeOfNote(target, b)
  if (!pa || !pb) throw new EditError('That note no longer exists')
  if (!sameVoice(pa.ref, pb.ref)) throw new EditError(message)
}

/** True when two notes have the same written step, octave and sounding alter. */
function samePitch(a: Note, b: Note): boolean {
  return !!a.pitch && !!b.pitch && a.pitch.step === b.pitch.step && a.pitch.octave === b.pitch.octave && (a.pitch.alter ?? 0) === (b.pitch.alter ?? 0)
}

/**
 * Ties the note `fromId` to the note `toId`, chosen as the first and last note of the tie. A tie joins
 * a note to the one right after it, and both must have the same pitch.
 */
export function addTie(target: Score | VoiceScore, fromId: string, toId: string): void {
  oneVoice(target, fromId, toId, 'A tie joins notes of one voice')
  const score = viewFor(target, fromId)
  const { note } = locate(score, fromId)
  locate(score, toId)
  if (!note.pitch) throw new EditError('A tie needs a note, not a rest')
  // In a chord, the tie goes to the note of the next chord that the user chose.
  const after = neighbour(score, fromId, 1)
  const next = after ? chordMembers(score, after.id).find((n) => n.id === toId) : undefined
  if (!next) throw new EditError('A tie joins a note to the note right after it')
  if (!samePitch(note, next)) throw new EditError('A tie needs the next note to have the same pitch')
  if (note.tieStart) throw new EditError('Those notes are already tied')
  note.tieStart = true
  next.tieStop = true
}

/** Tie toggle: removes the note's tie, or ties the note to the next note when that has the same pitch. */
export function toggleTie(target: Score | VoiceScore, id: string): void {
  const score = viewFor(target, id)
  const { note } = locate(score, id)
  if (note.tieStart) {
    const next = tiePartner(score, id, 1)
    delete note.tieStart
    if (next) delete next.tieStop
    return
  }
  if (note.tieStop) {
    const prev = tiePartner(score, id, -1)
    delete note.tieStop
    if (prev) delete prev.tieStart
    return
  }
  if (!note.pitch) throw new EditError('A tie needs a note, not a rest')
  const after = neighbour(score, id, 1)
  const next = after ? chordMembers(score, after.id).find((n) => samePitch(note, n)) : undefined
  if (!next) throw new EditError('A tie needs the next note to have the same pitch')
  note.tieStart = true
  next.tieStop = true
}

// ---------------------------------------------------------------- hairpins (crescendo, diminuendo)

export type WedgeType = WedgeItem['type']

/**
 * The views a hairpin of the note `id` is looked for in (change edit-parts, D7): a hairpin belongs to a staff, so on
 * a whole score every voice of the note's staff; a single view is its own staff.
 */
function staffViewsFor(target: Score | VoiceScore, id: string): VoiceScore[] {
  if (!('bars' in target)) return [target]
  const place = placeOfNote(target, id)
  if (!place) throw new EditError('That note no longer exists')
  return voices(target)
    .filter((r) => r.part === place.ref.part && r.staff === place.ref.staff)
    .map((r) => voiceView(target, r))
}

/**
 * Where each note a hairpin can start or stop on stands in its staff: the notes of every voice of the staff that are
 * not grace notes or chord notes other than the first, in time order (by bar, then start in the bar, then voice).
 * With one voice it is the order of the voice.
 */
function staffOrder(views: VoiceScore[]): Map<string, number> {
  const found: { id: string; bar: number; at: Frac; voice: number; k: number }[] = []
  views.forEach((view, voice) =>
    view.measures.forEach((m, bar) =>
      m.items.forEach((item, k) => {
        if (isNote(item) && !item.grace && !item.chord && !item.hidden) found.push({ id: item.id, bar, at: onsetIn(m.items, k), voice, k })
      }),
    ),
  )
  found.sort((a, b) => a.bar - b.bar || cmp(a.at, b.at) || a.voice - b.voice || a.k - b.k)
  return new Map(found.map((f, i) => [f.id, i]))
}

/** Every hairpin of the staff with the measure that holds it and the span of notes it covers. */
function hairpins(views: VoiceScore[]): { item: WedgeItem; measure: Measure; from: number; to: number }[] {
  const order = staffOrder(views)
  const found: { item: WedgeItem; measure: Measure; from: number; to: number }[] = []
  for (const view of views) {
    for (const measure of view.measures) {
      for (const item of measure.items) {
        if (!isWedge(item)) continue
        const from = order.get(item.start)
        const to = order.get(item.stop)
        if (from !== undefined && to !== undefined && from <= to) found.push({ item, measure, from, to })
      }
    }
  }
  return found
}

/** The hairpin that covers the note (any note from its first to its last, both included), for showing the mark as active. */
export function wedgeAt(target: Score | VoiceScore, id: string): WedgeItem | undefined {
  const views = staffViewsFor(target, id)
  const at = staffOrder(views).get(id)
  if (at === undefined) return undefined
  return hairpins(views).find((h) => h.from <= at && at <= h.to)?.item
}

/**
 * Adds a crescendo or diminuendo from the note `fromId` to the note `toId` (the same note is allowed:
 * a hairpin over one long note). Both are notes of one staff, in any of its voices (change edit-parts, D7). It
 * must not overlap another hairpin of the staff and must cover at least one sounding note; the first note may not
 * come after the last.
 */
export function addWedge(target: Score | VoiceScore, type: WedgeType, fromId: string, toId: string): void {
  const views = staffViewsFor(target, fromId)
  if ('bars' in target) {
    const a = placeOfNote(target, fromId)!
    const b = placeOfNote(target, toId)
    if (!b) throw new EditError('That note no longer exists')
    if (a.ref.part !== b.ref.part || a.ref.staff !== b.ref.staff) throw new EditError('A hairpin starts and stops on notes of one staff')
  }
  const owner = views.find((v) => v.measures.some((m) => m.items.some((i) => isNote(i) && i.id === fromId)))!
  const first = locate(owner, fromId)
  const order = staffOrder(views)
  const from = order.get(fromId)
  const to = order.get(toId)
  if (from === undefined || to === undefined) throw new EditError('A hairpin starts and stops on notes of the melody, not on grace notes or chord notes')
  if (from > to) throw new EditError('A hairpin must end on or after the note it starts on')
  // MusicXML writes the start before its first note and the stop after its last, voice after voice in each bar: a
  // hairpin from a later voice back to an earlier voice of the same bar would have its stop written before its start,
  // and be lost on save. It is refused (change edit-parts, D7).
  if ('bars' in target) {
    const written = new Map<string, number>()
    for (const items of allItemLists(target)) for (const item of items) if (isNote(item)) written.set(item.id, written.size)
    if (written.get(fromId)! > written.get(toId)!) throw new EditError('A hairpin from a later voice must end in that voice or in a later bar')
  }
  if (hairpins(views).some((h) => h.from <= to && from <= h.to)) throw new EditError('That would overlap another hairpin')
  const covered = views.flatMap((v) => allNotes(v)).filter((l) => {
    const at = order.get(l.note.id)
    return at !== undefined && at >= from && at <= to
  })
  if (covered.every((l) => l.note.rest)) throw new EditError('A hairpin needs at least one note under it, not only rests')
  // Kept in the measure of its first note, directly before that note (the form the parser gives).
  const wedge: WedgeItem = { kind: 'wedge', type, start: fromId, stop: toId }
  first.measure.items.splice(first.at, 0, wedge)
}

/** Removes the hairpin that covers the note (any note under it, not only its ends). */
export function removeWedge(target: Score | VoiceScore, id: string): void {
  const views = staffViewsFor(target, id)
  const at = staffOrder(views).get(id)
  const found = at === undefined ? undefined : hairpins(views).find((h) => h.from <= at && at <= h.to)
  if (!found) {
    if (!views.some((v) => v.measures.some((m) => m.items.some((i) => isNote(i) && i.id === id)))) throw new EditError('That note no longer exists')
    throw new EditError('There is no hairpin on that note')
  }
  found.measure.items.splice(found.measure.items.indexOf(found.item), 1)
}

// ---------------------------------------------------------------- the slurs, ties and hairpins of a bar (change redesign-score-editor, D14)

/** A slur, tie or hairpin as the editor lists it for a bar (spec "Slurs and hairpins of the bar"). */
export interface BarSpan {
  kind: 'slur' | 'tie' | 'crescendo' | 'diminuendo'
  /** The bars (from 0) of its first and its last note. */
  first: number
  last: number
  /** Its first and last note: where the editor goes to show either end. */
  fromId: string
  toId: string
  /** The voice of its first note. */
  voice: VoiceRef
  /** What `deleteElement` removes it with: a slur or tie with both its ends. */
  ref: ElementRef
  /** Whether it begins, and whether it ends, in the bar it was listed for. */
  startsHere: boolean
  endsHere: boolean
}

/**
 * Every slur, tie, crescendo and diminuendo of the part `part` that begins, ends or passes in bar `bar` (from 0), also
 * those wholly inside it (design D14, spec "Slurs and hairpins of the bar"): in the order of their first note in time,
 * then slurs, ties and hairpins. A slur runs from a note with its start to the next note of the voice with a stop of the
 * same number (as `deleteElement` removes it); a tie from a note to its partner in the next chord; a hairpin from its
 * start note to its stop note, in any voice of its staff. A slur or tie with no other end is not listed. Pure.
 */
export function spansOfBar(score: Score, part: string, bar: number): BarSpan[] {
  const found: BarSpan[] = []
  const place = (id: string) => placeOfNote(score, id)
  for (const ref of voices(score).filter((r) => r.part === part)) {
    const view = voiceView(score, ref)
    const notes = allNotes(view)
    notes.forEach((l, i) => {
      for (const s of l.note.slurs) {
        if (s.type !== 'start') continue
        const end = notes.slice(i + 1).find((o) => o.note.slurs.some((t) => t.type === 'stop' && t.number === s.number))
        if (end) found.push(span('slur', l, end, ref, { kind: 'slur', noteId: l.note.id, number: s.number }))
      }
      if (l.note.tieStart) {
        const partner = tiePartner(view, l.note.id, 1)
        const end = partner && notes.find((o) => o.note === partner)
        if (end) found.push(span('tie', l, end, ref, { kind: 'tie', noteId: l.note.id }))
      }
    })
  }
  for (const items of allItemLists(score)) {
    for (const item of items) {
      if (!isWedge(item)) continue
      const a = place(item.start)
      const b = place(item.stop)
      if (!a || !b || a.ref.part !== part) continue
      found.push({ kind: item.type, first: a.barIndex, last: b.barIndex, fromId: item.start, toId: item.stop, voice: a.ref, ref: { kind: 'wedge', startId: item.start }, startsHere: false, endsHere: false })
    }
  }
  const order = ['slur', 'tie', 'crescendo', 'diminuendo']
  return found
    .filter((s) => s.first <= bar && bar <= s.last)
    .map((s) => ({ ...s, startsHere: s.first === bar, endsHere: s.last === bar }))
    .sort((x, y) => compareInTime(score, x.fromId, y.fromId) || order.indexOf(x.kind) - order.indexOf(y.kind))
}

function span(kind: 'slur' | 'tie', from: Located, to: Located, voice: VoiceRef, ref: ElementRef): BarSpan {
  return { kind, first: from.barIndex, last: to.barIndex, fromId: from.note.id, toId: to.note.id, voice, ref, startsHere: false, endsHere: false }
}

// ---------------------------------------------------------------- loudness marks (change redesign-score-editor, D5)

/** The loudness marks the editor sets on a note (spec "Loudness marks"). */
export const LOUDNESS_MARKS = ['pp', 'p', 'mp', 'mf', 'f', 'ff'] as const
export type LoudnessMark = (typeof LOUDNESS_MARKS)[number]

/**
 * The loudness marks of a note: every dynamic of the note's staff (any voice) that stands directly before a note or rest
 * starting where the note's chord starts, in the note's bar. A dynamic belongs to a staff (spec "Marks belong to a staff
 * or voice"), so one written in another voice at the same start is the note's too. Throws `EditError` for a missing note.
 */
function dynamicsOf(target: Score | VoiceScore, id: string): { view: VoiceScore; measure: Measure; at: number; found: { items: MeasureItem[]; item: DynamicItem }[] } {
  const views = staffViewsFor(target, id)
  const view = views.find((v) => v.measures.some((m) => m.items.some((i) => isNote(i) && i.id === id)))
  if (!view) throw new EditError('That note no longer exists')
  const { measure, barIndex, at: own } = locate(view, id)
  const at = chordSpan(measure.items, own)[0]
  const start = onsetIn(measure.items, at)
  const found: { items: MeasureItem[]; item: DynamicItem }[] = []
  for (const v of views) {
    const items = v.measures[barIndex]!.items
    items.forEach((item, k) => {
      if (item.kind !== 'dynamic' || !eq(onsetIn(items, k), start)) return
      // Not one after the voice's last note: that one stands before nothing.
      if (items.slice(k + 1).some(isNote)) found.push({ items, item })
    })
  }
  return { view, measure, at, found }
}

/** The loudness mark of a note (see `dynamicsOf`), for showing the active mark; the first when there are more. */
export function dynamicOf(target: Score | VoiceScore, id: string): DynamicItem | undefined {
  return dynamicsOf(target, id).found[0]?.item
}

/**
 * Puts a loudness mark on a note, changes it, or with `undefined` removes it (spec "Loudness marks"). A note has at most
 * one: a mark of the note's staff at the note's start (see `dynamicsOf`) is changed in place and keeps its id, and any
 * further one goes. A new mark is one `DynamicItem` directly before the note (before its chord, and before a hairpin
 * that starts on it), in the note's voice, so in its staff. A rest takes none. Throws `EditError` when there is nothing
 * to remove.
 */
export function setDynamic(target: Score | VoiceScore, id: string, mark: LoudnessMark | undefined): void {
  const { view, measure, at, found } = dynamicsOf(target, id)
  const note = measure.items[at] as Note
  if (mark !== undefined && note.rest) throw new EditError('A rest cannot have a loudness mark')
  if (mark !== undefined && !LOUDNESS_MARKS.includes(mark)) throw new EditError('That is not a loudness mark')
  if (mark === undefined && found.length === 0) throw new EditError('There is no loudness mark on that note')
  // Removed: every one goes. Set: the first is changed, any further one goes.
  const kept = mark === undefined ? undefined : found[0]
  for (const { items, item } of found) if (item !== kept?.item) items.splice(items.indexOf(item), 1)
  if (mark === undefined) return
  if (kept) {
    kept.item.mark = mark
    return
  }
  let index = measure.items.indexOf(note)
  while (index > 0 && isWedge(measure.items[index - 1]!)) index--
  measure.items.splice(index, 0, { kind: 'dynamic', id: freshDirectionId(view), mark })
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
function dropSlursAndTies(score: VoiceScore, note: Note): void {
  for (const s of [...note.slurs]) if (s.type !== 'continue') removeSlur(score, note.id, s.number, s.type)
  note.slurs = []
  if (note.tieStart) {
    const next = tiePartner(score, note.id, 1)
    if (next) delete next.tieStop
    delete note.tieStart
  }
  if (note.tieStop) {
    const prev = tiePartner(score, note.id, -1)
    if (prev) delete prev.tieStart
    delete note.tieStop
  }
}

/**
 * Deletes a note and returns the id of the note to select next (the following one, else the previous).
 * A hairpin that starts or stops on the note goes with it, as a slur does. A note of a chord goes alone, and the
 * chord that is left stays selected (change edit-parts, D3).
 */
export function deleteNote(target: Score | VoiceScore, id: string): string | undefined {
  const score = viewFor(target, id)
  const isFirstVoice = (score.of?.ref.voice ?? 0) === 0
  {
    // A bar's whole-bar rest is what an emptied first voice holds: deleting it would only put it back.
    const { measure, note } = locate(score, id)
    if (isFirstVoice && wholeBarRestOf(measure.items) === note) return id
  }
  dropSlursAndTies(score, locate(score, id).note)
  removeTremolo(score, id)
  // A hairpin item sits before its first note, so look the note up again once they are gone. On a whole score a
  // hairpin of the staff may be kept in another voice. In place: the view's `items` is the score's own list.
  for (const items of 'bars' in target ? allItemLists(target) : score.measures.map((m) => m.items)) {
    const kept = items.filter((i) => !(isWedge(i) && (i.start === id || i.stop === id)))
    items.splice(0, items.length, ...kept)
  }
  const { note, measure, barIndex, at } = locate(score, id)
  const next = neighbour(score, id, 1)
  const prev = neighbour(score, id, -1)
  measure.items.splice(at, 1)
  // A chord member left behind by its base takes over as the note.
  const after = measure.items[at]
  let left: Note | undefined
  if (!note.chord && after && isNote(after) && after.chord) {
    delete after.chord
    // The chord's arpeggio moves to its new first note, unless that leaves one note.
    const more = measure.items[at + 1]
    if (note.arpeggio && more && isNote(more) && more.chord) after.arpeggio = true
    left = after
  } else if (note.chord) {
    // A chord down to one note has no arpeggio.
    const [a, b] = chordSpan(measure.items, at - 1)
    if (a === b) delete (measure.items[a] as Note).arpeggio
    left = measure.items[a] as Note
  }
  normaliseTuplets(measure)
  resolveAlters(score, barIndex, barIndex)
  // A staff's first voice is never left without a note or rest to see: it gets a whole-bar rest in place of what is left
  // (nothing, or hidden rests), which stays selected, so the bar can be filled again (change redesign-score-editor, D5).
  // A later voice may stay empty.
  if (isFirstVoice && !measure.items.some((i) => isNote(i) && !i.hidden)) {
    const rest = wholeBarRest(freshId(score), barLengthAt(score, barIndex))
    const kept = measure.items.filter((i) => !isNote(i))
    measure.items.splice(0, measure.items.length, ...kept, rest)
    return rest.id
  }
  return (left ?? next ?? prev)?.id
}

/**
 * The length of a whole-bar rest in bar `index` of a view: the time signature in force there; without one, the longest
 * voice of the bar in the view's score, else a whole note.
 */
export function barLengthAt(view: VoiceScore, index: number): Frac {
  for (let b = index; b >= 0; b--) {
    const time = view.measures[b]?.time
    if (time) return frac(time.beats, time.beatType)
  }
  let longest = frac(0)
  const lists = view.of ? view.of.score.bars[index]!.parts.flatMap((pb) => pb.staves.flatMap((sb) => sb.voices)) : [view.measures[index]!.items]
  for (const items of lists) if (cmp(voiceLength(items), longest) > 0) longest = voiceLength(items)
  return longest.n > 0 ? longest : frac(1)
}

/** A note or rest to add (`appendNote`): its length, and the written step and octave of a note; without a pitch it is a rest. */
export interface NoteChoice extends DurationChoice {
  pitch?: { step: Step; octave: number }
}

/** The voice `where` of a score as a view, or `EditError` when the score has no such voice. */
function voiceAt(score: Score, where: VoiceRef): VoiceScore {
  const pi = partOf(score, where)
  if (!score.bars.every((bar) => bar.parts[pi]?.staves[where.staff]?.voices[where.voice])) throw new EditError('That voice does not exist')
  return voiceView(score, where)
}

/** Every item list a hairpin of the view may be kept in: the whole score's, for a view made from one. */
function wedgeLists(target: Score | VoiceScore): MeasureItem[][] {
  if ('bars' in target) return allItemLists(target)
  return target.of ? allItemLists(target.of.score) : target.measures.map((m) => m.items)
}

/**
 * Adds a note or a rest at the end of the voice `where` in bar `bar` (from 0) and returns its id (change
 * redesign-score-editor, D5, spec "A bar always takes a note"): the place after the last note or rest, where the editor
 * shows the slot for the next note. A voice that holds nothing but a whole-bar rest has that rest replaced, together with
 * a hairpin that starts or stops on it. A note gets no accidental of its own: the key and the bar's accidentals give its
 * alter. On a voice view `where` is the view's own voice. A bar that no longer adds up is flagged, never refused.
 */
export function appendNote(target: Score | VoiceScore, where: VoiceRef, bar: number, what: NoteChoice): string {
  const score = 'bars' in target ? voiceAt(target, where) : target
  const measure = Number.isInteger(bar) ? score.measures[bar] : undefined
  if (!measure) throw new EditError('That bar does not exist')
  if (!DURATION_TYPES.includes(what.type) || !Number.isInteger(what.dots) || what.dots < 0 || what.dots > 2) throw new EditError('That length cannot be added')
  const fresh: Note = { kind: 'note', id: freshId(score), type: what.type, dots: what.dots, duration: frac(0), slurs: [], tuplets: [] }
  if (what.triplet) fresh.timeMod = { actual: 3, normal: 2 }
  fresh.duration = noteDuration(fresh.type!, fresh.dots, fresh.timeMod)
  if (what.pitch) fresh.pitch = { step: what.pitch.step, octave: what.pitch.octave }
  else fresh.rest = true
  const notes = measure.items.filter(isNote)
  const [only] = notes
  const barRest = notes.length === 1 && only!.rest && !only!.hidden && (only!.measureRest || eq(only!.duration, barLengthAt(score, bar))) ? only : undefined
  // A first voice with nothing to see holds hidden rests only (the reader fills an empty first voice so): they make way too.
  const firstVoice = ('bars' in target ? where.voice : (score.of?.ref.voice ?? 0)) === 0
  const hiddenOnly = firstVoice && notes.length > 0 && notes.every((n) => n.hidden)
  if (barRest) {
    for (const items of wedgeLists(target)) {
      const kept = items.filter((i) => !(isWedge(i) && (i.start === barRest.id || i.stop === barRest.id)))
      items.splice(0, items.length, ...kept)
    }
    measure.items.splice(measure.items.indexOf(barRest), 1, fresh)
  } else if (hiddenOnly) {
    const at = measure.items.indexOf(notes[0]!)
    const kept = measure.items.filter((i, k) => !isNote(i) || k === at)
    kept.splice(kept.indexOf(notes[0]!), 1, fresh)
    measure.items.splice(0, measure.items.length, ...kept)
  } else measure.items.push(fresh)
  normaliseTuplets(measure)
  resolveAlters(score, bar, bar)
  return fresh.id
}

/** A pitch for a note made next to, or out of a rest at, the note `id`: its own, else the nearest pitched note's, else B4. No accidental. */
function pitchNear(score: VoiceScore, id: string): Pitch {
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
export function insertNote(target: Score | VoiceScore, id: string, where: 'before' | 'after', what: 'note' | 'rest'): string {
  const score = viewFor(target, id)
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

// ---------------------------------------------------------------- chord tools (change edit-parts, D3 and D4)

/**
 * Adds a note to the chord of the note `id` (a lone note becomes a chord), a third above its top note: two steps
 * up, with no accidental of its own, so the key and the bar's accidentals give its alter (a third above D in D
 * major is F♯). It has the chord's length. Returns its id, so the editor selects it.
 */
export function addChordNote(target: Score | VoiceScore, id: string): string {
  const score = viewFor(target, id)
  const chord = chordMembers(score, id)
  if (chord.some((n) => n.rest || !n.pitch)) throw new EditError('A rest has no chord')
  const top = chord.reduce((a, b) => (diatonic(b.pitch!) > diatonic(a.pitch!) ? b : a))
  const third = diatonic(top.pitch!) + 2
  const last = chord.at(-1)!
  const fresh: Note = {
    kind: 'note',
    id: freshId(score),
    pitch: { step: STEPS[((third % 7) + 7) % 7]!, octave: Math.floor(third / 7) },
    dots: last.dots,
    duration: { ...last.duration },
    chord: true,
    slurs: [],
    tuplets: [],
  }
  if (last.type) fresh.type = last.type
  if (last.timeMod) fresh.timeMod = { ...last.timeMod }
  if (last.grace) fresh.grace = true
  const { measure, barIndex, at } = locate(score, last.id)
  measure.items.splice(at + 1, 0, fresh)
  resolveAlters(score, barIndex, barIndex)
  return fresh.id
}

/** Where an item starts in its bar: the length of the notes and rests before it, chord notes and grace notes not counted. */
export function onsetIn(items: readonly MeasureItem[], at: number): Frac {
  let t = frac(0)
  for (let k = 0; k < at; k++) {
    const item = items[k]!
    if (isNote(item) && !item.chord && !item.grace) t = add(t, item.duration)
  }
  return t
}

/**
 * Which of two notes of a score starts first (negative: `a`), by bar, then start in the bar, then score order: the
 * order the editor puts two tapped notes in, the first and the last of a slur, tie or hairpin.
 */
export function compareInTime(score: Score, a: string, b: string): number {
  const pa = placeOfNote(score, a)
  const pb = placeOfNote(score, b)
  if (!pa || !pb) return 0
  const items = (p: NonNullable<typeof pa>): MeasureItem[] => score.bars[p.barIndex]!.parts[partIndex(score, p.ref.part)]!.staves[p.ref.staff]!.voices[p.ref.voice]!
  return pa.barIndex - pb.barIndex || cmp(onsetIn(items(pa), pa.at), onsetIn(items(pb), pb.at)) || pa.at - pb.at
}

/**
 * Moves the note `id` to the other staff of its two-staff part (change edit-parts, D4, spec "Chord tools"): the
 * whole chord when `id` is the chord's first note (or a lone note), else that note only. It goes to the other
 * staff's first voice, at the same start, where it joins a chord or note of the same start and length, or takes
 * the place of a rest of the same start and length. The staff it leaves keeps a rest of the same length when the
 * whole chord left. Slurs, ties, tremolos and hairpins on the moved notes go, with their other ends; the other
 * marks stay. Pitches stay as they are. Returns `id`, which stays selected. Throws `EditError` when there is no
 * such place.
 */
export function moveToOtherStaff(score: Score, id: string): string {
  const place = placeOfNote(score, id)
  if (!place) throw new EditError('That note no longer exists')
  const pi = partOf(score, place.ref)
  if (score.parts[pi]!.staves !== 2) throw new EditError('Only a part with two staves has another hand')
  if (place.note.rest) throw new EditError('A rest stays in its hand')
  if (place.note.grace) throw new EditError('A grace note moves with its note')
  const view = voiceView(score, place.ref)
  const source = view.measures[place.barIndex]!
  const chord = chordMembers(view, id)
  const base = chord[0]!
  const whole = base.id === id
  const moving = whole ? chord : [place.note]
  const start = onsetIn(source.items, source.items.indexOf(base))
  // The other staff's first voice, in the same bar.
  const otherRef: VoiceRef = { part: place.ref.part, staff: 1 - place.ref.staff, voice: 0 }
  const other = voiceView(score, otherRef)
  const into = other.measures[place.barIndex]!
  const at = into.items.findIndex((item, k) => isNote(item) && !item.chord && !item.grace && eq(onsetIn(into.items, k), start) && eq(item.duration, base.duration))
  const found = at >= 0 ? (into.items[at] as Note) : undefined
  if (!found) throw new EditError('The other hand has no rest or chord of the same length there')
  // Slurs, ties, tremolos and hairpins do not cross to the other hand.
  for (const n of moving) {
    dropSlursAndTies(view, n)
    removeTremolo(view, n.id)
  }
  const ids = new Set(moving.map((n) => n.id))
  for (const items of allItemLists(score)) {
    const kept = items.filter((i) => !(isWedge(i) && (ids.has(i.start) || ids.has(i.stop))))
    items.splice(0, items.length, ...kept)
  }
  // Out of the staff they were in: a whole chord leaves a rest of its length.
  const from = source.items.indexOf(base)
  if (whole) {
    const rest: Note = { kind: 'note', id: freshId(view), rest: true, dots: base.dots, duration: { ...base.duration }, slurs: [], tuplets: [] }
    if (base.type) rest.type = base.type
    if (base.timeMod) rest.timeMod = { ...base.timeMod }
    source.items.splice(from, chord.length, rest)
  } else source.items.splice(source.items.indexOf(place.note), 1)
  // Into the other staff: joining a chord, or in the place of a rest.
  for (const n of moving) delete n.arpeggio
  if (found.rest) {
    for (const items of allItemLists(score)) {
      const kept = items.filter((i) => !(isWedge(i) && (i.start === found.id || i.stop === found.id)))
      items.splice(0, items.length, ...kept)
    }
    const index = into.items.indexOf(found)
    moving.forEach((n, k) => {
      if (k === 0) delete n.chord
      else n.chord = true
    })
    into.items.splice(index, 1, ...moving)
  } else {
    const index = into.items.indexOf(found)
    const [, last] = chordSpan(into.items, index)
    for (const n of moving) n.chord = true
    into.items.splice(last + 1, 0, ...moving)
  }
  normaliseTuplets(source)
  normaliseTuplets(into)
  resolveAlters(view, place.barIndex, place.barIndex + 1)
  resolveAlters(other, place.barIndex, place.barIndex + 1)
  return id
}

// ---------------------------------------------------------------- Grid: add, move and change length (change redesign-score-editor, D4, D5)

/**
 * Why a Grid edit is refused, for the editor's explanation (spec "Grid keeps the bar in order", "Grid leaves alone what
 * it cannot draw"): `overlap` (another note of the voice, or a locked one, is in the way), `end` (past the end of the
 * bar), `locked` (a triplet, a grace note or a note off the sixteenths, edited in Notes), `length` (no single note has
 * that length), `room` (less than a sixteenth free where a note is added), `chord` (the chord already has that note),
 * `rest` (a rest is not a block: it follows from the notes), `gap` (the time left over cannot be written as rests).
 */
export type GridRefusal = 'overlap' | 'end' | 'locked' | 'length' | 'room' | 'chord' | 'rest' | 'gap'

/** A refused Grid edit: why. Nothing was changed. The message is a full English sentence. */
export class GridError extends EditError {
  readonly reason: GridRefusal

  constructor(reason: GridRefusal, message: string) {
    super(message)
    this.reason = reason
  }
}

/** A note value as printed: its type and dots. */
export interface NoteValue {
  type: NoteType
  dots: number
}

/** The lengths a note can have in Grid, longest first: whole to sixteenth, plain or dotted, on the sixteenths (no dotted sixteenth). */
export const GRID_VALUES: readonly NoteValue[] = (['whole', 'half', 'quarter', 'eighth', '16th'] as NoteType[]).flatMap((type): NoteValue[] =>
  type === '16th' ? [{ type, dots: 0 }] : [{ type, dots: 1 }, { type, dots: 0 }],
)

/** The Grid value that has exactly this length, if one has. */
export function gridValue(length: Frac): NoteValue | undefined {
  return GRID_VALUES.find((v) => eq(noteDuration(v.type, v.dots), length))
}

/** The longest Grid value that is not longer than `max`. */
function longestValue(max: Frac): NoteValue | undefined {
  return GRID_VALUES.find((v) => cmp(noteDuration(v.type, v.dots), max) <= 0)
}

/** Why a note cannot be edited in Grid (D4): it is a triplet (or another tuplet), a grace note, or not on the sixteenths. */
export type GridLock = 'triplet' | 'grace' | 'offGrid'

/** Whether a time in the bar is on the sixteenth grid. */
export const onSixteenths = (t: Frac): boolean => div(t, frac(1, 16)).d === 1

/**
 * One place in time of a voice's bar: a note, chord or rest with the items that belong to it. `lead..at` are the items
 * before it that stand at its start (directions, hairpins, grace notes), `at` is its note or rest, `at + 1..end` its
 * chord notes. Every item of the bar up to `GridBar.tail` is in exactly one slot.
 */
interface Slot {
  lead: number
  at: number
  end: number
  start: Frac
  length: Frac
  note: Note
  /** A rest that is not locked: time without a block, which a Grid edit may fill or write again. */
  free: boolean
  locked?: GridLock
}

const slotEnd = (s: Slot): Frac => add(s.start, s.length)

/** Why the note or chord at `at` (with its chord notes up to `end`) is locked in Grid, if it is. */
export function gridLock(items: readonly MeasureItem[], at: number, end: number, start: Frac): GridLock | undefined {
  const note = items[at] as Note
  if (note.grace) return 'grace'
  if (items.slice(at, end).some((i) => isNote(i) && !!i.timeMod)) return 'triplet'
  if (!onSixteenths(start) || !onSixteenths(add(start, note.duration))) return 'offGrid'
  return undefined
}

/** One voice's bar as Grid edits see it. */
interface GridBar {
  view: VoiceScore
  bar: number
  items: MeasureItem[]
  slots: Slot[]
  /** Index after the last slot: what follows are the voice's trailing directions, which stay at the end. */
  tail: number
  voiceEnd: Frac
  /** The time signature's bar length (`barLengthAt`). */
  barLength: Frac
  /** No note may end after this: the bar length, or the voice's end in a bar that is too long. */
  limit: Frac
  firstVoice: boolean
}

function gridBar(view: VoiceScore, bar: number): GridBar {
  const items = view.measures[bar]!.items
  const barLength = barLengthAt(view, bar)
  // A whole-bar rest stands for the whole bar, whatever length it was read with.
  const barRest = wholeBarRestOf(items)
  const slots: Slot[] = []
  let lead = 0
  let t = frac(0)
  for (let at = 0; at < items.length; at++) {
    const item = items[at]!
    if (!isNote(item) || item.grace || item.chord) continue
    let end = at + 1
    while (end < items.length && isNote(items[end]!) && (items[end] as Note).chord) end++
    const length = item === barRest ? barLength : item.duration
    const locked = gridLock(items, at, end, t)
    slots.push({ lead, at, end, start: t, length, note: item, free: !!item.rest && !locked, ...(locked ? { locked } : {}) })
    t = add(t, length)
    lead = end
    at = end - 1
  }
  return { view, bar, items, slots, tail: lead, voiceEnd: t, barLength, limit: cmp(t, barLength) > 0 ? t : barLength, firstVoice: (view.of?.ref.voice ?? 0) === 0 }
}

/** The beat of the bar for writing rests (as `beams.ts` groups notes), and whether it is a dotted one (compound time). */
function restBeat(view: VoiceScore, bar: number): Frac {
  for (let b = bar; b >= 0; b--) {
    const time = view.measures[b]?.time
    if (time) return beatLength(time)
  }
  return frac(1, 4)
}

/** Rest values for a gap, longest first; the dotted ones are only used in compound time (`restsFor`). */
const GAP_VALUES: readonly NoteValue[] = [
  { type: 'whole', dots: 1 },
  { type: 'whole', dots: 0 },
  { type: 'half', dots: 1 },
  { type: 'half', dots: 0 },
  { type: 'quarter', dots: 1 },
  { type: 'quarter', dots: 0 },
  { type: 'eighth', dots: 1 },
  { type: 'eighth', dots: 0 },
  { type: '16th', dots: 0 },
  { type: '32nd', dots: 0 },
  { type: '64th', dots: 0 },
]

const isMultiple = (a: Frac, b: Frac): boolean => div(a, b).d === 1

/**
 * The rests that write the time from `from` to `to` of a bar (D5: standard lengths, split at the beats), each with its
 * start. From each place, the longest value that fits the rule:
 *
 * - A rest of a beat or longer starts on a beat, is a whole number of beats long, and starts at a multiple of its own
 *   length from the start of the bar: in 4/4 a half rest on beat 1 or 3, never on beat 2. It is dotted only in compound
 *   time, where the beat itself is dotted: in 6/8 a dotted quarter rest on either beat, or a dotted half from the start,
 *   never a half.
 * - A shorter rest stays inside its beat, plain, at a multiple of its length from the beat's start.
 *
 * The beat is `beatLength` of `beams.ts` (a quarter in simple time, a dotted quarter in 6/8). Time that no value fits
 * that way (next to a note off the sixteenths) takes the longest plain value that fits at all; throws `GridError` when
 * nothing does.
 */
function restsFor(from: Frac, to: Frac, beat: Frac): { start: Frac; value: NoteValue; duration: Frac }[] {
  const compound = beat.n % 3 === 0
  const out: { start: Frac; value: NoteValue; duration: Frac }[] = []
  let pos = from
  while (cmp(pos, to) < 0) {
    const fits = (v: NoteValue, aligned: boolean): boolean => {
      const d = noteDuration(v.type, v.dots)
      if (cmp(add(pos, d), to) > 0) return false
      if (!aligned) return v.dots === 0
      if (cmp(d, beat) >= 0) return (v.dots === 0 || compound) && isMultiple(d, beat) && isMultiple(pos, d)
      if (v.dots > 0) return false
      const inBeat = sub(pos, mul(frac(Math.floor((pos.n * beat.d) / (pos.d * beat.n))), beat))
      return cmp(add(inBeat, d), beat) <= 0 && isMultiple(inBeat, d)
    }
    const value = GAP_VALUES.find((v) => fits(v, true)) ?? GAP_VALUES.find((v) => fits(v, false))
    if (!value) throw new GridError('gap', 'That would leave a gap that rests cannot fill')
    const duration = noteDuration(value.type, value.dots)
    out.push({ start: pos, value, duration })
    pos = add(pos, duration)
  }
  return out
}

/** The note Grid puts in place: its items (what stands before it, the note, its chord notes), its start and its length. */
interface Placed {
  items: MeasureItem[]
  note: Note
  start: Frac
  length: Frac
}

/**
 * Writes the time from `from` to `to` of a Grid bar again (D4: only the gaps an edit touched): the free slots
 * `first..last` (none when both are undefined: the time after the voice's last slot) are replaced by `placed` and the rests
 * of the time around it. A rest that starts where a new rest starts is kept as that rest, with its id and its fermata,
 * and only its length is written again. What stood before a rest that is written again (a direction, a hairpin, a grace
 * note) goes before the rest or note that now holds its time; a hairpin that started or stopped on a rest that went now
 * does so on that rest or note (`lists`: where hairpins are kept), so no mark is lost. In a later voice, a gap that held
 * hidden rests only is one hidden rest again; any other gap gets rests of standard lengths (`restsFor`).
 */
function rewriteRun(g: GridBar, first: number | undefined, last: number | undefined, from: Frac, to: Frac, placed: Placed, lists: MeasureItem[][], newId: () => string): void {
  const run = first === undefined || last === undefined ? [] : g.slots.slice(first, last + 1)
  const i0 = run[0]?.lead ?? g.tail
  const i1 = run.at(-1)?.end ?? g.tail
  const rests = run.filter((s) => s.free)
  const kept = new Set(placed.items)
  // What stood before a rest that is written again, with its time.
  const anchored: { t: Frac; item: MeasureItem }[] = []
  for (const s of rests) for (let k = s.lead; k < s.at; k++) if (!kept.has(g.items[k]!)) anchored.push({ t: s.start, item: g.items[k]! })
  const hidden = !g.firstVoice && rests.length > 0 && rests.every((s) => s.note.hidden)
  const reusable = new Map(rests.map((s) => [`${s.start.n}/${s.start.d}`, s.note]))
  const used = new Set<Note>()
  const restAt = (start: Frac, duration: Frac, value?: NoteValue): Note => {
    const old = reusable.get(`${start.n}/${start.d}`)
    const rest: Note = old ?? { kind: 'note', id: newId(), rest: true, dots: 0, duration, slurs: [], tuplets: [] }
    used.add(rest)
    rest.duration = duration
    delete rest.measureRest
    if (value) {
      rest.type = value.type
      rest.dots = value.dots
      delete rest.hidden
    } else {
      rest.hidden = true
      rest.dots = 0
      delete rest.type
    }
    return rest
  }
  const gap = (a: Frac, b: Frac): { start: Frac; items: MeasureItem[]; main: Note }[] => {
    if (cmp(a, b) >= 0) return []
    if (hidden) {
      const rest = restAt(a, sub(b, a))
      return [{ start: a, items: [rest], main: rest }]
    }
    return restsFor(a, b, restBeat(g.view, g.bar)).map((r) => {
      const rest = restAt(r.start, r.duration, r.value)
      return { start: r.start, items: [rest], main: rest }
    })
  }
  const end = add(placed.start, placed.length)
  const mains = [...gap(from, placed.start), { start: placed.start, items: placed.items, main: placed.note }, ...gap(end, to)]
  /** The rest or note that holds the time `t` now: the last one that starts at or before it. */
  const holder = (t: Frac): number => {
    let i = 0
    while (i + 1 < mains.length && cmp(mains[i + 1]!.start, t) <= 0) i++
    return i
  }
  const before = mains.map((): MeasureItem[] => [])
  for (const { t, item } of anchored) before[holder(t)]!.push(item)
  const written = mains.flatMap((m, i) => [...before[i]!, ...m.items])
  // A hairpin on a rest that went now starts or stops on what holds its time.
  const moved = new Map(rests.filter((s) => !used.has(s.note)).map((s) => [s.note.id, mains[holder(s.start)]!.main.id]))
  if (moved.size > 0) {
    for (const items of lists) {
      for (const item of items) {
        if (!isWedge(item)) continue
        item.start = moved.get(item.start) ?? item.start
        item.stop = moved.get(item.stop) ?? item.stop
      }
    }
  }
  g.items.splice(i0, i1 - i0, ...written)
}

/** Fresh note ids for a Grid edit, unique in the whole score the view was made from. */
const gridIds = (view: VoiceScore): (() => string) => (view.of ? idMaker(view.of.score) : localIds(view))

/** The free slots around slot `k` (not itself): back to the last note before it, on to the first note after it. */
function freeAround(g: GridBar, k: number): { first: number; last: number } {
  let first = k
  while (first > 0 && g.slots[first - 1]!.free) first--
  let last = k
  while (last + 1 < g.slots.length && g.slots[last + 1]!.free) last++
  return { first, last }
}

/**
 * Where a run of the voice that ends at slot `last` lets a note end, and to where the rewrite goes. A run that is the end
 * of the voice reaches the limit of the bar; the first voice is then written up to the bar's length, as time without a
 * block is rest (spec "Grid keeps the bar in order"); a later voice and a pickup (a short first bar, D11) only up to the
 * note, as they may stay short.
 */
function runEnd(g: GridBar, last: number | undefined, noteEnd: Frac): { hi: Frac; to: Frac; atEnd: boolean } {
  const atEnd = last === undefined || last === g.slots.length - 1
  const end = last === undefined ? g.voiceEnd : slotEnd(g.slots[last]!)
  if (!atEnd) return { hi: end, to: end, atEnd }
  const max = (...fs: Frac[]): Frac => fs.reduce((x, y) => (cmp(y, x) > 0 ? y : x))
  const pickup = g.bar === 0 && cmp(g.voiceEnd, g.barLength) < 0
  return { hi: g.limit, to: g.firstVoice && !pickup ? max(end, noteEnd, g.barLength) : max(end, noteEnd), atEnd }
}

/**
 * Takes a two-note tremolo off a moved or shortened chord whose end (`end`) or start (`start`) moved, from both of its
 * notes: a rest between them would make playback join the pair across it. The one mark a Grid edit takes away. A tie
 * stays, as `insertNote` leaves it: playback ends a tie at a rest, and the tie is the user's to remove.
 */
function splitTremolo(view: VoiceScore, members: Note[], start: boolean, end: boolean): void {
  for (const n of members) if ((end && n.tremolo?.kind === 'start') || (start && n.tremolo?.kind === 'stop')) removeTremolo(view, n.id)
}

/** The slot of the note `id` for a move or a length change, refused for a rest, a grace note or a locked note. */
function blockSlot(g: GridBar, note: Note): number {
  if (note.grace) throw new GridError('locked', 'Edit triplets and grace notes in Notes')
  const k = g.slots.findIndex((s) => g.items.slice(s.at, s.end).includes(note))
  const slot = g.slots[k]!
  if (slot.note.rest) throw new GridError('rest', 'A rest follows from the notes: move a note instead')
  if (slot.locked) throw new GridError('locked', 'Edit triplets and grace notes in Notes')
  return k
}

const overlap = (): GridError => new GridError('overlap', 'Another note is in the way')
const pastEnd = (): GridError => new GridError('end', 'That goes past the end of the bar')

/**
 * Adds a note in Grid (D5, spec "Edit notes in Grid") to the voice `where` in bar `bar` (from 0), at `start` (a sixteenth
 * of the bar) and on the written step and octave `pitch`, with no accidental of its own: the key and the bar's
 * accidentals give its alter. Returns its id.
 *
 * - In free time (a rest, or after the voice's last note), the note takes the longest Grid value that is not longer than
 *   `length` and ends before the next note or the end of the bar. The rests it lands in are written again around it
 *   (`rewriteRun`); in the first voice up to the bar's length when it is at the end of the voice (not in a pickup).
 * - Where a note or chord starts, it is a chord note of that chord's length (spec "A chord note"): the Grid's tap in the
 *   column where a note starts. `length` is then not used.
 *
 * Throws `GridError` (nothing changed): `end` outside the bar, `overlap` inside a note that starts earlier, `locked` on a
 * locked note or rest, `chord` when the chord has that note, `room` when less than a sixteenth is free.
 */
export function placeNote(target: Score | VoiceScore, where: VoiceRef, bar: number, start: Frac, length: Frac, pitch: { step: Step; octave: number }): string {
  const view = 'bars' in target ? voiceAt(target, where) : target
  if (!Number.isInteger(bar) || !view.measures[bar]) throw new EditError('That bar does not exist')
  if (!STEPS.includes(pitch.step) || !Number.isInteger(pitch.octave)) throw new EditError('That is not a pitch')
  if (!onSixteenths(start)) throw new EditError('A note in Grid starts on a sixteenth')
  const g = gridBar(view, bar)
  if (cmp(start, frac(0)) < 0 || cmp(start, g.limit) >= 0) throw pastEnd()
  const newId = gridIds(view)
  const k = g.slots.findIndex((s) => cmp(s.start, start) <= 0 && cmp(start, slotEnd(s)) < 0)
  const hit = g.slots[k]
  if (hit && !hit.free) {
    if (hit.locked) throw new GridError('locked', 'Edit triplets and grace notes in Notes')
    if (!eq(hit.start, start)) throw overlap()
    const chord = g.items.slice(hit.at, hit.end) as Note[]
    if (chord.some((n) => n.pitch?.step === pitch.step && n.pitch.octave === pitch.octave)) throw new GridError('chord', 'That note is already in the chord')
    const base = hit.note
    const fresh: Note = { kind: 'note', id: newId(), pitch: { step: pitch.step, octave: pitch.octave }, dots: base.dots, duration: { ...base.duration }, chord: true, slurs: [], tuplets: [] }
    if (base.type) fresh.type = base.type
    g.items.splice(hit.end, 0, fresh)
    resolveAlters(view, bar, bar)
    return fresh.id
  }
  // The free run the note lands in: the rests around the one it is in, or the rests at the end of the voice.
  let first: number | undefined
  let last: number | undefined
  if (hit) ({ first, last } = freeAround(g, k))
  else if (g.slots.at(-1)?.free) ({ first, last } = freeAround(g, g.slots.length - 1))
  const from = first === undefined ? g.voiceEnd : g.slots[first]!.start
  const { hi } = runEnd(g, last, start)
  const value = cmp(length, frac(0)) > 0 ? longestValue(cmp(length, sub(hi, start)) < 0 ? length : sub(hi, start)) : undefined
  if (!value) throw new GridError('room', 'There is no room for a note there')
  const duration = noteDuration(value.type, value.dots)
  const fresh: Note = { kind: 'note', id: newId(), pitch: { step: pitch.step, octave: pitch.octave }, type: value.type, dots: value.dots, duration, slurs: [], tuplets: [] }
  const { to } = runEnd(g, last, add(start, duration))
  rewriteRun(g, first, last, from, to, { items: [fresh], note: fresh, start, length: duration }, wedgeLists(target), newId)
  resolveAlters(view, bar, bar)
  return fresh.id
}

/**
 * Moves the note `id` (its whole chord, with what stands before it: its loudness mark, a hairpin that starts on it, its
 * grace notes) to `start` in its bar, in Grid (D5, spec "Edit notes in Grid"). It may only move through free time: not
 * over another note of the voice or a locked one, nor past the end of the bar, so the notes keep their order and every
 * slur and hairpin of the voice stays as it is. The rests on both sides are written again (`rewriteRun`). A two-note
 * tremolo goes (`splitTremolo`); a tie stays.
 *
 * Throws `GridError` (nothing changed): `overlap`, `end`, `locked` for a triplet, grace note or note off the sixteenths,
 * `rest` for a rest.
 */
export function moveNote(target: Score | VoiceScore, id: string, start: Frac): void {
  const view = viewFor(target, id)
  const { barIndex: bar, note } = locate(view, id)
  const g = gridBar(view, bar)
  const k = blockSlot(g, note)
  const slot = g.slots[k]!
  if (!onSixteenths(start)) throw new EditError('A note in Grid starts on a sixteenth')
  if (eq(start, slot.start)) return
  const { first, last } = freeAround(g, k)
  const end = add(start, slot.length)
  const { hi, to, atEnd } = runEnd(g, last, end)
  if (cmp(start, frac(0)) < 0) throw pastEnd()
  if (cmp(start, g.slots[first]!.start) < 0) throw overlap()
  if (cmp(end, hi) > 0) throw atEnd ? pastEnd() : overlap()
  splitTremolo(view, g.items.slice(slot.at, slot.end) as Note[], true, true)
  const items = g.items.slice(slot.lead, slot.end)
  rewriteRun(g, first, last, g.slots[first]!.start, to, { items, note: slot.note, start, length: slot.length }, wedgeLists(target), gridIds(view))
}

/**
 * Changes the length of the note `id` (its whole chord, as `setDuration`) in Grid (D5, spec "Edit notes in Grid"): to
 * `length`, which must be a Grid value (`GRID_VALUES`). The note keeps its start; it may not grow over the next note of
 * the voice or a locked one, nor past the end of the bar. The rests after it are written again (`rewriteRun`). A
 * two-note tremolo that starts on it goes when the end moved (`splitTremolo`); a tie stays.
 *
 * Throws `GridError` (nothing changed): `length`, `overlap`, `end`, `locked`, `rest`.
 */
export function resizeNote(target: Score | VoiceScore, id: string, length: Frac): void {
  const view = viewFor(target, id)
  const { barIndex: bar, note } = locate(view, id)
  const g = gridBar(view, bar)
  const k = blockSlot(g, note)
  const slot = g.slots[k]!
  const value = gridValue(length)
  if (!value) throw new GridError('length', 'No single note has that length')
  const members = g.items.slice(slot.at, slot.end) as Note[]
  if (eq(length, slot.length) && members.every((n) => n.type === value.type && n.dots === value.dots)) return
  const { last } = freeAround(g, k)
  const end = add(slot.start, length)
  const { hi, to, atEnd } = runEnd(g, last, end)
  if (cmp(end, hi) > 0) throw atEnd ? pastEnd() : overlap()
  if (!eq(length, slot.length)) splitTremolo(view, members, false, true)
  for (const n of members) {
    n.type = value.type
    n.dots = value.dots
    n.duration = noteDuration(value.type, value.dots)
  }
  const items = g.items.slice(slot.lead, slot.end)
  rewriteRun(g, k, last, slot.start, to, { items, note: slot.note, start: slot.start, length }, wedgeLists(target), gridIds(view))
}

// ---------------------------------------------------------------- note <-> rest

/**
 * Turns a note into a rest of the same length and place, and returns the rest's id. A rest carries no pitch,
 * accidental, tie, slur or articulation, so those go, and the other ends of its slurs and ties go with them; a
 * fermata and any hairpin that ends on it stay. A chord becomes one rest, from any of its notes (change edit-parts,
 * D3): the rest keeps the id of the chord's first note, and its other notes are removed.
 */
export function noteToRest(target: Score | VoiceScore, id: string): string {
  const score = viewFor(target, id)
  const found = locate(score, id)
  if (found.note.rest) throw new EditError('That is already a rest')
  if (found.note.grace) throw new EditError('A grace note cannot become a rest')
  const { measure, barIndex } = found
  const [first, last] = chordSpan(measure.items, found.at)
  const note = measure.items[first] as Note
  if (note.grace) throw new EditError('A grace note cannot become a rest')
  for (let k = first + 1; k <= last; k++) {
    const member = measure.items[k] as Note
    dropSlursAndTies(score, member)
    removeTremolo(score, member.id)
  }
  measure.items.splice(first + 1, last - first)
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
  removeTremolo(score, note.id)
  note.rest = true
  // Later notes in the bar (and a note tied across the barline) lose what they took from this one.
  resolveAlters(score, barIndex, barIndex + 1)
  return note.id
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
export function restToNote(target: Score | VoiceScore, id: string): void {
  const score = viewFor(target, id)
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
 * Sets the key signature of one part at the start of the piece (later key changes are kept) and recomputes every
 * un-marked note's sounding alter in every voice of that part: with one sharp, every F without its own accidental
 * becomes F♯ (an F with a printed natural stays F). The other parts keep their key (change edit-parts, D6).
 */
export function setKey(score: Score, part: string, fifths: number): void {
  if (!Number.isInteger(fifths) || fifths < -7 || fifths > 7) throw new EditError('A key signature has 0 to 7 sharps or flats')
  const first = score.bars[0]?.parts[partOf(score, part)]
  if (!first) throw new EditError('The score has no bars')
  first.key = { fifths, ...(first.key?.mode ? { mode: first.key.mode } : {}) }
  for (const view of partViews(score, part)) resolveAlters(view)
}

/** A staff of a part, where a clef is set (change edit-parts, D6). */
export interface StaffRef {
  part: string
  staff: number
}

/** The views of every voice of a part, or of one staff of it. */
function partViews(score: Score, part: string, staff?: number): VoiceScore[] {
  partOf(score, part)
  return voices(score)
    .filter((r) => r.part === part && (staff === undefined || r.staff === staff))
    .map((r) => voiceView(score, r))
}

/** Sets the time signature at the start of the exercise; it is no longer an inferred one. */
export function setTime(score: Score, beats: number, beatType: number, symbol?: 'common' | 'cut'): void {
  if (!Number.isInteger(beats) || beats < 1 || beats > 32) throw new EditError('Beats must be 1 to 32')
  if (![1, 2, 4, 8, 16].includes(beatType)) throw new EditError('The beat type must be 1, 2, 4, 8 or 16')
  const first = score.bars[0]
  if (!first) throw new EditError('The score has no bars')
  const time: TimeSignature = { beats, beatType }
  if (symbol) time.symbol = symbol
  first.time = time
  for (const bar of score.bars) if (bar.time?.inferred) delete bar.time.inferred
}

function partOf(score: Score, part: string | { part: string }): number {
  const pi = partIndex(score, typeof part === 'string' ? part : part.part)
  if (pi < 0) throw new EditError('That part does not exist')
  return pi
}

export interface TempoChoice {
  /** "Moderato"; empty or absent for none. */
  words?: string
  /** Beats per minute of `beatUnit` (default quarter), absent for none. */
  perMinute?: number
  beatUnit?: NoteType
  beatUnitDots?: number
}

/** The item lists a tempo marking is looked for in: a view's bars, or every voice of a score in bar order. */
function tempoLists(target: Score | VoiceScore): MeasureItem[][] {
  return 'bars' in target ? allItemLists(target) : target.measures.map((m) => m.items)
}

/**
 * Replaces the exercise's first tempo marking (or adds one at the start); an empty choice removes it. On a whole
 * score it is the piece's first marking in any part (a tempo marking is the whole piece's, change edit-parts D6),
 * and a new one goes at the start of the first part.
 */
export function setTempoMarking(target: Score | VoiceScore, choice: TempoChoice): void {
  const words = choice.words?.trim()
  const hasMark = choice.perMinute !== undefined
  if (hasMark && !(choice.perMinute! > 0 && Number.isFinite(choice.perMinute!))) throw new EditError('The tempo must be a positive number')
  const score = 'bars' in target ? voiceView(target, firstVoice(target)) : target
  let item: TempoItem | undefined
  if (words || hasMark) {
    // The marking keeps its id when it is replaced, so a selection of it stays.
    item = { kind: 'tempo', id: firstTempoMarking(target)?.id ?? freshDirectionId(score) }
    if (words) item.words = words
    if (hasMark) {
      item.beatUnit = choice.beatUnit ?? 'quarter'
      if (choice.beatUnitDots) item.beatUnitDots = choice.beatUnitDots
      item.perMinute = choice.perMinute!
    }
  }
  for (const items of tempoLists(target)) {
    const at = items.findIndex((i) => i.kind === 'tempo')
    if (at >= 0) {
      if (item) items.splice(at, 1, item)
      else items.splice(at, 1)
      return
    }
  }
  if (item) {
    const first = score.measures[0]
    if (!first) throw new EditError('The score has no bars')
    first.items.unshift(item)
  }
}

/** The first tempo marking of the score, for the editor form: on a whole score, the first in any part. */
export function firstTempoMarking(target: Score | VoiceScore): TempoItem | undefined {
  for (const items of tempoLists(target)) for (const i of items) if (i.kind === 'tempo') return i
  return undefined
}

// ---------------------------------------------------------------- bar lines (change edit-bar-lines, design D1)

export type BarStart = 'normal' | 'repeat'
/** How a bar ends; `final` is the end bar line (thin and thick, `light-heavy`) without a repeat (change redesign-score-editor, D5). */
export type BarEnd = 'normal' | 'double' | 'repeat' | 'final'

export interface BarLines {
  start: BarStart
  end: BarEnd
  /** How many times the section is played in total; 2 when the bar line does not say. */
  times: number
}

/** The fewest and most passes the editor offers for an end-repeat. */
export const MIN_REPEAT_TIMES = 2
export const MAX_REPEAT_TIMES = 8

/**
 * Styles that read as a double bar line (a recognised final bar line `light-heavy` counts too, as in playback). The editor
 * shows `light-heavy` without a repeat at the end of a bar as an end bar line (`final`); playback still goes back to it.
 */
const DOUBLE_STYLES = new Set(['light-light', 'light-heavy', 'heavy-light', 'heavy-heavy'])
const isPlainDouble = (b: Barline | undefined): boolean => !!b && !b.repeat && !!b.style && DOUBLE_STYLES.has(b.style)
const isFinal = (b: Barline | undefined): boolean => !!b && !b.repeat && b.style === 'light-heavy'

// The bar line setters work on the score's bars (the shared attributes, design D1), not on a view.
function barAt(score: Score, index: number): Bar {
  const m = Number.isInteger(index) ? score.bars[index] : undefined
  if (!m) throw new EditError('That bar does not exist')
  return m
}

/** Drops a bar line that says nothing any more (no style, repeat, count or ending). */
function tidyBarlines(m: Bar): void {
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
  if (index <= 0 || index >= score.bars.length) return
  const m = score.bars[index]!
  if (!isPlainDouble(m.leftBarline)) return
  const prev = score.bars[index - 1]!
  if (!prev.rightBarline?.style && !prev.rightBarline?.repeat) prev.rightBarline = { ...prev.rightBarline, style: 'light-light' }
  delete m.leftBarline!.style
  tidyBarlines(m)
}

/** How the bar `index` starts and ends, whichever side of a boundary recognition wrote a double bar line on. */
export function barLinesOf(score: Score, index: number): BarLines {
  const m = barAt(score, index)
  const next = score.bars[index + 1]
  const right = m.rightBarline
  const end: BarEnd =
    right?.repeat === 'backward' ? 'repeat' : isFinal(right) ? 'final' : isPlainDouble(right) || isPlainDouble(next?.leftBarline) ? 'double' : 'normal'
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
 * Sets how the bar `index` ends: a plain bar line, a double bar line `||`, an end-repeat `:||` or an end bar line (thin
 * and thick, `light-heavy` without a repeat). The double and the end bar line are always written as this bar's right
 * bar line, so one on the next bar's left goes. An end-repeat that stays an end-repeat keeps its count; an ending on
 * the bar line stays.
 */
export function setBarEnd(score: Score, index: number, end: BarEnd): void {
  const m = barAt(score, index)
  const next = score.bars[index + 1]
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
  else if (end === 'final') m.rightBarline = { style: 'light-heavy', ...ending }
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
export const diatonic = (p: { step: Step; octave: number }): number => p.octave * 7 + STEPS.indexOf(p.step)

/**
 * The pitch on the middle line of the staff under a clef, in diatonic steps: B4 for a treble clef, D3 for a
 * bass clef, C4 for an alto clef. The clef's own note is on its line (G4, F3 or C4), each line two steps
 * from the next, and an octave change moves it seven.
 */
export function middleLine(clef: Clef): number {
  const sign = CLEF_SIGNS.has(clef.sign) ? clef.sign : 'G'
  const line = clef.line ?? (sign === 'G' ? 2 : sign === 'F' ? 4 : 3)
  const own = sign === 'G' ? 4 * 7 + 4 : sign === 'F' ? 3 * 7 + 3 : 4 * 7
  return own - (line - 3) * 2 + 7 * (clef.octaveChange ?? 0)
}

/** The clef in force at bar `index` (from 0): the last one set at or before it, else treble. */
export function clefAt(score: VoiceScore, index: number): Clef {
  for (let b = Math.min(index, score.measures.length - 1); b >= 0; b--) {
    const clef = score.measures[b]!.clef
    if (clef) return clef
  }
  return { sign: 'G', line: 2 }
}

/** The last bar (from 0) that the clef set at bar `index` applies to: the bar before the next clef change, or the last bar. */
function clefRangeEnd(score: VoiceScore, index: number): number {
  for (let b = index + 1; b < score.measures.length; b++) if (score.measures[b]!.clef) return b - 1
  return score.measures.length - 1
}

/**
 * Moves every pitched note of bars `from..to` by the difference between two clefs, so each stays on its
 * line or space of the staff (design D3), then works out the alters again: a printed accidental stays with
 * its note, any other note takes its alter from the key. One bar past the range too, for a tie into it.
 */
function keepStaffPositions(score: VoiceScore, from: number, to: number, before: Clef, after: Clef): void {
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
export function setClef(score: Score, where: StaffRef, index: number, clef: Clef): void {
  const staff = staffBarAt(score, where, index)
  if (!CLEF_SIGNS.has(clef.sign)) throw new EditError('A clef is a treble, bass or C clef')
  // A clef is the staff's: every voice of the staff is read again under it, and no other staff is.
  const views = partViews(score, where.part, where.staff)
  const before = clefAt(views[0]!, index)
  const end = clefRangeEnd(views[0]!, index)
  staff.clef = { ...clef }
  for (const view of views) keepStaffPositions(view, index, end, before, clef)
}

/** The staff `where` in bar `index`, where its clef is set. */
function staffBarAt(score: Score, where: StaffRef, index: number): StaffBar {
  const bar = barAt(score, index)
  const staff = bar.parts[partOf(score, where)]?.staves[where.staff]
  if (!staff) throw new EditError('That staff does not exist')
  return staff
}

/**
 * Deletes the clef change at bar `index`: the clef before it applies again, and the notes keep their place
 * on the staff. The first clef is changed, not deleted.
 */
export function deleteClef(score: Score, where: StaffRef, index: number): void {
  const staff = staffBarAt(score, where, index)
  if (index === 0) throw new EditError('The first clef can be changed, not deleted')
  if (!staff.clef) throw new EditError('There is no clef change in that bar')
  const before = staff.clef
  const end = clefRangeEnd(partViews(score, where.part, where.staff)[0]!, index)
  delete staff.clef
  const views = partViews(score, where.part, where.staff)
  const after = clefAt(views[0]!, index - 1)
  for (const view of views) keepStaffPositions(view, index, end, before, after)
}

/** Deletes the key change of a part at bar `index`: the key before it applies again to the notes without their own accidental. */
export function deleteKey(score: Score, part: string, index: number): void {
  const m = barAt(score, index)
  const pb = m.parts[partOf(score, part)]
  if (index === 0) throw new EditError('The first key signature is changed in the Score tab, not deleted')
  if (!pb?.key) throw new EditError('There is no key change in that bar')
  delete pb.key
  for (const view of partViews(score, part)) resolveAlters(view, index)
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
 * the element is not there. A clef is looked for on its staff, a key on its part (the first part's first staff
 * when the reference does not say), a mark on its note's voice, and a direction or hairpin in every voice.
 */
export function deleteElement(score: Score, ref: ElementRef): void {
  const gone = (): never => {
    throw new EditError('That element is no longer in the score')
  }
  const firstPart = score.parts[0]?.id ?? 'P1'
  switch (ref.kind) {
    case 'clef':
      return deleteClef(score, { part: ref.part ?? firstPart, staff: ref.staff ?? 0 }, ref.bar)
    case 'key':
      return deleteKey(score, ref.part ?? firstPart, ref.bar)
    case 'time':
      return deleteTime(score, ref.bar)
    case 'barline':
      throw new EditError('A bar line is changed, not deleted')
    case 'dynamic':
    case 'tempo':
    case 'words':
      for (const items of allItemLists(score)) {
        const at = items.findIndex((i) => isDirection(i) && i.kind === ref.kind && i.id === ref.id)
        if (at >= 0) {
          items.splice(at, 1)
          return
        }
      }
      return gone()
    case 'slur': {
      const view = voiceOfNote(score, ref.noteId)
      const { note } = locate(view, ref.noteId)
      if (!note.slurs.some((s) => s.type === 'start' && s.number === ref.number)) return gone()
      return removeSlur(view, ref.noteId, ref.number, 'start')
    }
    case 'tie': {
      const view = voiceOfNote(score, ref.noteId)
      const { note } = locate(view, ref.noteId)
      if (!note.tieStart) return gone()
      return toggleTie(view, ref.noteId)
    }
    case 'wedge':
      for (const items of allItemLists(score)) {
        const at = items.findIndex((i) => isWedge(i) && i.start === ref.startId)
        if (at >= 0) {
          items.splice(at, 1)
          return
        }
      }
      return gone()
    case 'articulation': {
      const view = voiceOfNote(score, ref.noteId)
      const { note } = locate(view, ref.noteId)
      if (!note[ref.mark]) return gone()
      if (ref.mark === 'tremolo') removeTremolo(view, ref.noteId)
      else delete note[ref.mark]
      return
    }
  }
}

// ---------------------------------------------------------------- adding and removing a bar line (change edit-parts, D9)

/**
 * Why a bar line cannot be added or removed there, for the editor's explanation: `first` (before the first note of a
 * bar), `end` (after the last note), `across` (a note sounds across the point), `triplet` (inside a triplet), `rest` (a
 * rest across the point has no standard lengths), `last` (after the last bar), and `clef`, `key`, `time`, `ending` (the
 * next bar starts with one).
 */
export type BarLineRefusal = 'first' | 'end' | 'across' | 'triplet' | 'rest' | 'last' | 'clef' | 'key' | 'time' | 'ending'

/** A bar line that cannot be added or removed: why, and in which voice when that matters. The message is a full English sentence. */
export class BarLineError extends EditError {
  readonly reason: BarLineRefusal
  readonly where: VoiceRef | undefined

  constructor(reason: BarLineRefusal, message: string, where?: VoiceRef) {
    super(message)
    this.reason = reason
    this.where = where
  }
}

/** The items of one voice in one bar. */
function voiceItems(score: Score, ref: VoiceRef, barIndex: number): MeasureItem[] {
  return score.bars[barIndex]!.parts[partOf(score, ref)]!.staves[ref.staff]!.voices[ref.voice]!
}

/**
 * Where a bar line before the note `id` goes (D9): the bar, and the start of the note in it. A chord's note gives its
 * chord's start, and a grace note the start of the note it leads to. Throws `BarLineError` when there is no such
 * point: before the first note of the bar (the first bar would be empty), or after its last.
 */
export function splitPoint(score: Score, id: string): { barIndex: number; point: Frac } {
  const place = placeOfNote(score, id)
  if (!place) throw new EditError('That note no longer exists')
  const items = voiceItems(score, place.ref, place.barIndex)
  let at = chordSpan(items, place.at)[0]
  if ((items[at] as Note).grace) {
    let k = at + 1
    while (k < items.length && !(isNote(items[k]!) && !(items[k] as Note).grace && !(items[k] as Note).chord)) k++
    if (k >= items.length) throw new BarLineError('end', 'A bar line goes before a note, and no note follows this grace note in its bar')
    at = k
  }
  const point = onsetIn(items, at)
  if (point.n === 0) throw new BarLineError('first', 'A bar line cannot go before the first note of a bar')
  return { barIndex: place.barIndex, point }
}

/** Whether a bar line can go before the note `id`: not before the first note of a bar, nor after its last (the rule of `splitPoint`). */
export function canSplitBefore(score: Score, id: string): boolean {
  try {
    splitPoint(score, id)
    return true
  } catch {
    return false
  }
}

/**
 * The voice as a refusal names it: "in the left hand", "in the melody", "in the left hand, voice 2"; nothing for a
 * one-line piece. A part of one staff is named by its name, a part of two staves by the hand.
 */
function voicePlace(score: Score, ref: VoiceRef): string {
  const pi = partOf(score, ref)
  const part = score.parts[pi]!
  const words: string[] = []
  if (part.staves === 2) words.push(ref.staff === 0 ? 'the right hand' : 'the left hand')
  else if (score.parts.length > 1) words.push(part.name ? `the ${part.name.toLowerCase()}` : `part ${pi + 1}`)
  if (ref.voice > 0) words.push(`voice ${ref.voice + 1}`)
  return words.length > 0 ? ` in ${words.join(', ')}` : ''
}

/** Standard rest values, longest first, for a rest that is split (D9). */
const REST_VALUES: NoteType[] = ['whole', 'half', 'quarter', 'eighth', '16th', '32nd', '64th']

/** Rests of standard lengths that add up to `length`, longest first; undefined when no such list exists. */
function restLengths(length: Frac): { type: NoteType; duration: Frac }[] | undefined {
  const out: { type: NoteType; duration: Frac }[] = []
  let left = length
  for (const type of REST_VALUES) {
    const value = noteDuration(type, 0)
    while (cmp(left, value) >= 0) {
      out.push({ type, duration: value })
      left = sub(left, value)
    }
  }
  return left.n === 0 ? out : undefined
}

/** Makes fresh note ids, unique in the whole score even before the notes are in it. */
function idMaker(score: Score): () => string {
  const used = usedIds(score)
  let n = allNoteCount(score) + 1
  return () => {
    while (used.has(`e${n}`)) n++
    const id = `e${n}`
    used.add(id)
    return id
  }
}

/** The one whole-bar rest of a voice that has nothing else sounding or resting (directions may be with it), or undefined. */
function wholeBarRestOf(items: readonly MeasureItem[]): Note | undefined {
  const notes = items.filter(isNote)
  const [only] = notes
  return notes.length === 1 && only!.rest && only!.measureRest && !only!.hidden ? only : undefined
}

/** A voice's length in its bar: its notes and rests, chord notes and grace notes not counted. */
const voiceLength = (items: readonly MeasureItem[]): Frac => onsetIn(items, items.length)

/** A whole-bar rest of `length`, with the fields of `like` when given (its id is replaced). */
function wholeBarRest(id: string, length: Frac, like?: Note): Note {
  const rest: Note = like ? { ...structuredClone(like), id, duration: length } : { kind: 'note', id, rest: true, measureRest: true, dots: 0, duration: length, slurs: [], tuplets: [] }
  return rest
}

/**
 * Splits the items of one voice at `point` (D9): what starts before it goes to the first bar, the rest to the second. A
 * direction, hairpin or grace note goes with the note after it; a chord's notes with the chord. An item that crosses
 * the point: a hidden rest becomes two, another rest becomes rests of standard lengths, longest first (the first keeps
 * the id), and a sounding note or a triplet refuses. The point between two notes of one triplet refuses too; the
 * triplets are counted in runs of notes as `normaliseTuplets` brackets them, whatever marks the source wrote.
 */
function splitVoice(score: Score, ref: VoiceRef, items: readonly MeasureItem[], point: Frac, newId: () => string): [MeasureItem[], MeasureItem[]] {
  const before: MeasureItem[] = []
  const after: MeasureItem[] = []
  let pending: MeasureItem[] = []
  let side = before
  let t = frac(0)
  /** The note that ends at the point belongs to a triplet that goes on after it. */
  let openTriplet = false
  /** The notes so far of the run of triplet notes the last note is in, counted as `normaliseTuplets` groups them. */
  let run: Note[] = []
  const refuse = (reason: 'across' | 'triplet' | 'rest'): never => {
    const where = voicePlace(score, ref)
    const message =
      reason === 'across'
        ? `A note${where} sounds across that point`
        : reason === 'triplet'
          ? `A bar line there would fall inside a triplet${where}`
          : `A rest${where} across that point cannot be split into standard lengths`
    throw new BarLineError(reason, message, ref)
  }
  for (const item of items) {
    if (!isNote(item) || item.grace) {
      pending.push(item)
      continue
    }
    if (item.chord) {
      side.push(...pending, item)
      pending = []
      continue
    }
    const end = add(t, item.duration)
    const mod = item.timeMod
    const head = run[0]?.timeMod
    run = mod ? (head && head.actual === mod.actual && head.normal === mod.normal ? [...run, item] : [item]) : []
    if (cmp(end, point) <= 0) {
      side = before
      if (eq(end, point)) openTriplet = !!mod && run.length % mod.actual !== 0
    } else if (cmp(t, point) >= 0) {
      if (eq(t, point) && openTriplet) refuse('triplet')
      side = after
    } else {
      // It crosses the point.
      if (item.timeMod) refuse('triplet')
      if (!item.rest) refuse('across')
      const head = sub(point, t)
      const tail = sub(end, point)
      if (item.hidden) {
        before.push(...pending, { ...item, duration: head })
        after.push({ ...structuredClone(item), id: newId(), duration: tail })
      } else {
        const first = restLengths(head)
        const second = restLengths(tail)
        if (!first || !second) return refuse('rest')
        const piece = (value: { type: NoteType; duration: Frac }, id: string, like?: Note): Note => {
          const rest: Note = like ? { ...like, id } : { kind: 'note', id, rest: true, dots: 0, duration: value.duration, slurs: [], tuplets: [] }
          rest.type = value.type
          rest.dots = 0
          rest.duration = value.duration
          delete rest.measureRest
          return rest
        }
        before.push(...pending, ...first.map((v, k) => (k === 0 ? piece(v, item.id, item) : piece(v, newId()))))
        after.push(...second.map((v) => piece(v, newId())))
      }
      pending = []
      side = after
      t = end
      continue
    }
    side.push(...pending, item)
    pending = []
    t = end
  }
  side.push(...pending)
  return [before, after]
}

/** Clears the multi-measure rest of every part whose bars `from..to` (indices) are in it: the run no longer says what is printed. */
function clearMultiRests(score: Score, from: number, to: number): void {
  score.bars.forEach((bar, start) =>
    bar.parts.forEach((pb) => {
      const n = pb.multiRest
      if (n !== undefined && start <= to && start + Math.max(n, 1) - 1 >= from) delete pb.multiRest
    }),
  )
}

/** Gives every bar its own loaded bar as `from`, before the first change in the number of bars (D10). */
function trackBars(score: Score): void {
  score.bars.forEach((bar, i) => {
    if (!bar.from) bar.from = [i, i + 1]
  })
}

/**
 * Renumbers the printed numbers of the bars from index `start` on after a bar was added (`by` 1) or removed (-1): a
 * number that is a whole number moves by one, so the order the source had stays; any other number stays as it is.
 */
function renumberFrom(score: Score, start: number, by: 1 | -1): void {
  for (let i = start; i < score.bars.length; i++) {
    const bar = score.bars[i]!
    if (/^\d+$/.test(bar.number)) bar.number = String(Number(bar.number) + by)
  }
}

/** After bars changed shape: the triplets of bars `from..to` are marked again, and the alters worked out again (one bar further, for a tie). */
function tidyBars(score: Score, from: number, to: number): void {
  for (const ref of voices(score)) {
    const view = voiceView(score, ref)
    for (let i = from; i <= to; i++) normaliseTuplets(view.measures[i]!)
    resolveAlters(view, from, Math.min(to + 1, view.measures.length - 1))
  }
}

/**
 * Adds a bar line before the note `id` (D9, spec "Add a bar line"): its bar becomes two in every part, staff and voice,
 * split at the note's start (a chord's start for a chord note, the next note's for a grace note). Returns `id`, which
 * stays selected.
 *
 * - Each voice is split as `splitVoice` says. A voice that is one whole-bar rest becomes a whole-bar rest in both bars,
 *   of the two bars' lengths: the point, and the longest voice's length from the point on. A staff's first voice that
 *   is left with nothing in one bar gets a whole-bar rest of that bar's length there.
 * - The first bar keeps how the bar starts (the left bar line, a new line, the time, key and clef changes); the second
 *   gets how it ends (the right bar line, an ending's stop with it). An ending that starts on the bar covers both.
 * - Slurs, ties and hairpins stay on their notes. Accidentals no longer carry across the new bar line.
 * - Every later printed number that is a whole number goes up by one; the second bar takes the first's number plus
 *   one. A multi-measure rest over the bar is cleared. The bar's `from` is cut in two at the point (D10).
 *
 * Throws `BarLineError` (nothing changed) before the first note of a bar, or when a note sounds across the point, the
 * point is inside a triplet, or a rest across it has no standard lengths, naming the part, staff and voice.
 */
export function splitBar(score: Score, id: string): string {
  const { barIndex, point } = splitPoint(score, id)
  const bar = score.bars[barIndex]!
  const newId = idMaker(score)
  // Every voice is split first, so a refusal in any of them changes nothing.
  const refs = voices(score)
  const lists = refs.map((ref) => voiceItems(score, ref, barIndex))
  let length = point
  for (const items of lists) if (!wholeBarRestOf(items)) length = cmp(voiceLength(items), length) > 0 ? voiceLength(items) : length
  const halves = refs.map((ref, k): [MeasureItem[], MeasureItem[]] => {
    const items = lists[k]!
    const rest = wholeBarRestOf(items)
    if (rest) {
      const at = items.indexOf(rest)
      return [
        [...items.slice(0, at), { ...rest, duration: point }],
        [wholeBarRest(newId(), sub(length, point), rest), ...items.slice(at + 1)],
      ]
    }
    const [first, second] = splitVoice(score, ref, items, point, newId)
    if (ref.voice === 0) {
      if (!first.some(isNote)) first.push(wholeBarRest(newId(), point))
      if (!second.some(isNote)) second.push(wholeBarRest(newId(), sub(length, point)))
    }
    return [first, second]
  })

  trackBars(score)
  clearMultiRests(score, barIndex, barIndex)
  const first: Bar = { ...bar, parts: [] }
  delete first.rightBarline
  const second: Bar = { number: /^\d+$/.test(bar.number) ? String(Number(bar.number) + 1) : bar.number, parts: [] }
  if (bar.rightBarline) second.rightBarline = bar.rightBarline
  // The second half of an added bar is an added bar too, of the same loaded bar, with an id of its own (D8 of change redesign-score-editor).
  if (bar.added) second.added = { id: nextAddedBarId(), side: bar.added.side }
  // The bar's stretch of the loaded score is cut where the bar is, in proportion to its length (D10).
  const [lo, hi] = bar.from!
  const cut = lo + ((hi - lo) * point.n * length.d) / (point.d * length.n)
  first.from = [lo, cut]
  second.from = [cut, hi]
  // An ending that starts on the right bar line (an unusual place for it) starts the first bar, so it covers both.
  const ending = bar.rightBarline?.ending
  if (ending?.type === 'start' && !bar.leftBarline?.ending) {
    first.leftBarline = { ...bar.leftBarline, ending }
    second.rightBarline = { ...bar.rightBarline }
    delete second.rightBarline.ending
    tidyBarlines(second)
  }
  bar.parts.forEach((pb, pi) => {
    const pfirst: PartBar = { ...pb, staves: [] }
    delete pfirst.multiRest
    const psecond: PartBar = { staves: [] }
    pb.staves.forEach((sb, si) => {
      const voiceHalves = sb.voices.map((_, vi) => halves[refs.findIndex((r) => r.part === score.parts[pi]!.id && r.staff === si && r.voice === vi)]!)
      pfirst.staves.push({ ...sb, voices: voiceHalves.map((h) => h[0]) })
      psecond.staves.push({ voices: voiceHalves.map((h) => h[1]) })
    })
    first.parts.push(pfirst)
    second.parts.push(psecond)
  })
  score.bars.splice(barIndex, 1, first, second)
  renumberFrom(score, barIndex + 2, 1)
  tidyBars(score, barIndex, barIndex + 1)
  return id
}

/** The time signature in force at bar `index`, if any. */
function timeAt(score: Score, index: number): TimeSignature | undefined {
  for (let i = index; i >= 0; i--) {
    const time = score.bars[i]?.time
    if (time) return time
  }
  return undefined
}

/**
 * A whole-bar rest next to notes, in a joined bar (D9): a rest of the time signature's bar length (the rest's own
 * length without one), of one value when there is one, else of standard lengths, longest first (the first keeps the id).
 */
function barLengthRests(rest: Note, time: TimeSignature | undefined, newId: () => string): Note[] {
  const length = time ? frac(time.beats, time.beatType) : rest.duration
  const one = valueOf(length)
  const values = one ? [{ type: one.type, dots: one.dots, duration: length }] : (restLengths(length) ?? []).map((v) => ({ ...v, dots: 0 }))
  if (values.length === 0) {
    const kept: Note = { ...rest, duration: length }
    delete kept.measureRest
    return [kept]
  }
  return values.map((v, k) => {
    const piece: Note = k === 0 ? { ...rest } : { kind: 'note', id: newId(), rest: true, dots: 0, duration: v.duration, slurs: [], tuplets: [] }
    delete piece.measureRest
    piece.type = v.type
    piece.dots = v.dots
    piece.duration = v.duration
    return piece
  })
}

/**
 * Removes the bar line after bar `barIndex` (D9, spec "Remove a bar line"): the bar and the next become one, in every
 * part, staff and voice, the first bar's items followed by the second's.
 *
 * - Two whole-bar rests become one, of both lengths. A whole-bar rest next to notes becomes a rest of the time
 *   signature's bar length (`barLengthRests`); the bar check marks the bar if it no longer adds up. A voice that is
 *   shorter than the first bar there (a later voice, or none) is filled up with a hidden rest before the second bar's
 *   notes, so they keep their place in time.
 * - The joined bar keeps how the first bar starts and how the second ends; the signs between them (an end-repeat, a
 *   double bar line, a start-repeat) and the second bar's new line are dropped.
 * - Every later printed number that is a whole number goes down by one. A multi-measure rest over either bar is cleared.
 *
 * Throws `BarLineError` (nothing changed) after the last bar, and when the second bar starts with a time, key or clef
 * change, or an ending starts or ends at that bar line: those are deleted first, so nothing is lost silently.
 */
export function joinBars(score: Score, barIndex: number): void {
  const a = barAt(score, barIndex)
  const b = score.bars[barIndex + 1]
  if (!b) throw new BarLineError('last', 'There is no bar after the last one to join it with')
  if (b.time) throw new BarLineError('time', 'The next bar starts with a time signature change. Delete it first.')
  if (b.parts.some((pb) => pb.key)) throw new BarLineError('key', 'The next bar starts with a key change. Delete it first.')
  if (b.parts.some((pb) => pb.staves.some((sb) => sb.clef))) throw new BarLineError('clef', 'The next bar starts with a clef change. Delete it first.')
  if (b.leftBarline?.ending || a.rightBarline?.ending || b.rightBarline?.ending?.type === 'start') {
    throw new BarLineError('ending', 'An ending starts or ends at that bar line, so it stays.')
  }
  const newId = idMaker(score)
  const time = timeAt(score, barIndex)
  let firstLength = frac(0)
  for (const pb of a.parts) for (const sb of pb.staves) for (const items of sb.voices) if (cmp(voiceLength(items), firstLength) > 0) firstLength = voiceLength(items)
  /** Ids of whole-bar rests that went into another one, and that one's id, for the hairpins that end on them. */
  const merged = new Map<string, string>()

  const join = (first: MeasureItem[], second: MeasureItem[], voice: number): MeasureItem[] => {
    const restA = wholeBarRestOf(first)
    const restB = wholeBarRestOf(second)
    if (restA && restB) {
      merged.set(restB.id, restA.id)
      return [...first.map((i) => (i === restA ? { ...restA, duration: add(restA.duration, restB.duration) } : i)), ...second.filter((i) => i !== restB)]
    }
    const hasA = first.some(isNote)
    const hasB = second.some(isNote)
    const left = restA && hasB ? first.flatMap((i) => (i === restA ? barLengthRests(restA, time, newId) : [i])) : first
    const right = restB && hasA ? second.flatMap((i) => (i === restB ? barLengthRests(restB, time, newId) : [i])) : second
    const length = voiceLength(left)
    if (voice > 0 && hasB && cmp(length, firstLength) < 0) {
      const gap: Note = { kind: 'note', id: newId(), rest: true, hidden: true, dots: 0, duration: sub(firstLength, length), slurs: [], tuplets: [] }
      return [...left, gap, ...right]
    }
    return [...left, ...right]
  }

  trackBars(score)
  clearMultiRests(score, barIndex, barIndex + 1)
  // With one of the two bars added, the joined bar holds the other's stretch of the loaded score as it is (D8 of change
  // redesign-score-editor); two bars of the loaded score hold the stretch from the first's start to the second's end.
  const from: [number, number] = a.added && !b.added ? b.from! : b.added && !a.added ? a.from! : [a.from![0], b.from![1]]
  const joined: Bar = { ...a, parts: [], from }
  if (b.rightBarline) joined.rightBarline = b.rightBarline
  else delete joined.rightBarline
  // A joined bar holds music of the loaded score unless both bars were added (D8 of change redesign-score-editor).
  if (!b.added) delete joined.added
  a.parts.forEach((pa, pi) => {
    const pb = b.parts[pi]!
    const part: PartBar = { ...pa, staves: [] }
    delete part.multiRest
    pa.staves.forEach((sa, si) => {
      const sb = pb.staves[si]!
      part.staves.push({ ...sa, voices: sa.voices.map((items, vi) => join(items, sb.voices[vi] ?? [], vi)) })
    })
    joined.parts.push(part)
  })
  score.bars.splice(barIndex, 2, joined)
  // A hairpin that started or stopped on a whole-bar rest that went into another one now does so on that one.
  if (merged.size > 0) {
    for (const items of allItemLists(score)) {
      for (const item of items) {
        if (!isWedge(item)) continue
        item.start = merged.get(item.start) ?? item.start
        item.stop = merged.get(item.stop) ?? item.stop
      }
    }
  }
  renumberFrom(score, barIndex + 1, -1)
  tidyBars(score, barIndex, barIndex)
}

// ---------------------------------------------------------------- endings and bars (change redesign-score-editor, D5, D7, D8)

/**
 * Why an ending or a bar edit is refused, for the editor's explanation: `onlyBar` (the only bar of the piece cannot be
 * deleted), `firstBar` (the first bar has no bar before it to copy), `secondEnding` (a second-time bar comes directly
 * after a first-time or second-time bar), `otherEnding` (the bar is in an ending with other numbers, which can only be
 * removed).
 */
export type BarEditRefusal = 'onlyBar' | 'firstBar' | 'secondEnding' | 'otherEnding'

/** A refused ending or bar edit: why. The message is a full English sentence. */
export class BarEditError extends EditError {
  readonly reason: BarEditRefusal

  constructor(reason: BarEditRefusal, message: string) {
    super(message)
    this.reason = reason
  }
}

/** One bar in the view of the endings: the number of the ending it lies in, and how that ending closes when it is its last bar. */
interface EndingPlace {
  label: string | null
  close?: 'stop' | 'discontinue'
}

/** The endings as a view of the bar lines (design D7): per bar, the ending it lies in (`endingLabels`), and the close of each ending's last bar. */
function endingView(score: Score): EndingPlace[] {
  const labels = endingLabels(score.bars)
  return labels.map((label, i) => {
    const place: EndingPlace = { label }
    const close = score.bars[i]!.rightBarline?.ending?.type
    if (label !== null && labels[i + 1] !== label && (close === 'stop' || close === 'discontinue')) place.close = close
    return place
  })
}

/** The runs of neighbouring bars with the same ending: first and last bar, number, and the close of one of its bars. */
function endingRuns(view: readonly EndingPlace[]): { first: number; last: number; label: string; close?: 'stop' | 'discontinue' }[] {
  const runs: { first: number; last: number; label: string; close?: 'stop' | 'discontinue' }[] = []
  view.forEach((place, i) => {
    if (place.label === null) return
    const run = runs.at(-1)
    if (run && run.last === i - 1 && run.label === place.label) run.last = i
    else runs.push({ first: i, last: i, label: place.label })
    if (place.close) runs.at(-1)!.close = place.close
  })
  return runs
}

/**
 * Writes the endings of the bars around `from..to` from the view (design D7): the ending marks of those bars, and of every
 * run of the view that reaches into them, are written again: `start` on the left bar line of a run's first bar, and on
 * the right bar line of its last bar the close it had (`stop` for a first ending, `discontinue` for a second one when it
 * had none). Endings outside are left as they are, so an ending's number ("1, 2") and close stay.
 */
function writeEndings(score: Score, view: readonly EndingPlace[], from: number, to: number): void {
  const runs = endingRuns(view).filter((r) => r.first <= to && r.last >= from)
  const lo = Math.max(0, Math.min(from, ...runs.map((r) => r.first)))
  const hi = Math.min(score.bars.length - 1, Math.max(to, ...runs.map((r) => r.last)))
  for (let i = lo; i <= hi; i++) {
    const bar = score.bars[i]!
    if (bar.leftBarline?.ending) delete bar.leftBarline.ending
    if (bar.rightBarline?.ending) delete bar.rightBarline.ending
    tidyBarlines(bar)
  }
  for (const run of runs) {
    const first = score.bars[run.first]!
    const last = score.bars[run.last]!
    first.leftBarline = { ...first.leftBarline, ending: { number: run.label, type: 'start' } }
    last.rightBarline = { ...last.rightBarline, ending: { number: run.label, type: run.close ?? (run.label === '2' ? 'discontinue' : 'stop') } }
  }
}

/**
 * Marks bar `index` (from 0) as "1st time only" (1), "2nd time only" (2), or in no ending (undefined), as one edit (design
 * D7, spec "First and second endings"). Neighbouring bars with the same mark form one ending: the bar lines of the run
 * are written again. A first ending whose last bar has no end-repeat gets one: the end-repeat of a bar inside the run
 * moves there (a first ending made longer), else a new one is set. Throws `BarEditError` (nothing changed) for a second
 * ending that does not come directly after a bar in ending 1 or 2 (`secondEnding`), and for 1 or 2 on a bar in an
 * ending with other numbers (`otherEnding`), which can only be removed.
 */
export function setEnding(score: Score, index: number, ending: 1 | 2 | undefined): void {
  barAt(score, index)
  const view = endingView(score)
  const own = view[index]!.label
  const label = ending === undefined ? null : String(ending)
  if (label !== null && own !== null && own !== '1' && own !== '2') {
    throw new BarEditError('otherEnding', `This bar is in the ending "${own}." as read; it can only be removed`)
  }
  if (ending === 2) {
    const before = view[index - 1]?.label
    const numbers = before ? parseEndingNumbers(before) : []
    if (!numbers.some((n) => n === 1 || n === 2)) throw new BarEditError('secondEnding', 'A second-time bar comes directly after a first-time bar')
  }
  if (label === own) return
  // The close of the bar's old ending goes along with the ending's last bar.
  const close = view[index]!.close
  view[index] = { label }
  const shortened = own !== null && view[index - 1]?.label === own && view[index + 1]?.label !== own
  if (close && shortened) view[index - 1]!.close = close
  writeEndings(score, view, index - 1, index + 1)
  // A first ending made shorter at its end: its end-repeat goes back to its new last bar, with its count.
  const right = score.bars[index]!.rightBarline
  if (shortened && own === '1' && right?.repeat === 'backward' && score.bars[index - 1]!.rightBarline?.repeat !== 'backward') {
    const times = right.times
    setBarEnd(score, index, 'normal')
    setBarEnd(score, index - 1, 'repeat')
    if (times !== undefined) setRepeatTimes(score, index - 1, times)
  }
  if (ending !== 1) return
  const run = endingRuns(view).find((r) => r.first <= index && index <= r.last)!
  if (score.bars[run.last]!.rightBarline?.repeat === 'backward') return
  let moved: number | undefined
  for (let i = run.last - 1; i >= run.first && moved === undefined; i--) if (score.bars[i]!.rightBarline?.repeat === 'backward') moved = i
  const times = moved === undefined ? undefined : score.bars[moved]!.rightBarline!.times
  if (moved !== undefined) setBarEnd(score, moved, 'normal')
  setBarEnd(score, run.last, 'repeat')
  if (times !== undefined) setRepeatTimes(score, run.last, times)
}

let addedBars = 0

/** An id for an added bar that no other bar of this run of the app has had (design D8: unique in the session, also after undo). */
function nextAddedBarId(): string {
  addedBars += 1
  return `added${addedBars}`
}

/** The length of a whole-bar rest in a bar added after bar `index` is in force: its time signature, else that bar's longest voice, else a whole note. */
function addedBarLength(score: Score, index: number, near: Bar): Frac {
  const time = index >= 0 ? timeAt(score, index) : near.time
  if (time) return frac(time.beats, time.beatType)
  let longest = frac(0)
  for (const pb of near.parts) for (const sb of pb.staves) for (const items of sb.voices) if (cmp(voiceLength(items), longest) > 0) longest = voiceLength(items)
  return longest.n > 0 ? longest : frac(1)
}

/**
 * Adds an empty bar before or after bar `index` (from 0), in every part (design D5, D8, spec "Add a bar"), and returns
 * the new bar's index. Each staff's first voice holds a whole-bar rest of the time signature in force there; its later
 * voices are empty. The bars after it are renumbered. A bar added before the first bar takes over the time, the keys
 * and the clefs of the piece's start, and one added before a bar that starts a line starts the line. It holds no music
 * of the loaded score: `from` is the empty stretch at its place and `added` names it (see `Bar.added`). A
 * multi-measure rest it falls inside is cleared.
 */
export function addBar(score: Score, index: number, side: 'before' | 'after'): number {
  const near = barAt(score, index)
  if (side !== 'before' && side !== 'after') throw new EditError('A bar is added before or after a bar')
  trackBars(score)
  const at = side === 'before' ? index : index + 1
  // A multi-measure rest over the place where the bar goes no longer says what is printed.
  score.bars.forEach((bar, start) =>
    bar.parts.forEach((pb) => {
      const n = pb.multiRest
      if (n !== undefined && start < at && start + Math.max(n, 1) > at) delete pb.multiRest
    }),
  )
  const newId = idMaker(score)
  const length = addedBarLength(score, side === 'before' ? index - 1 : index, near)
  const [lo, hi] = near.from!
  const bar: Bar = {
    number: side === 'after' && /^\d+$/.test(near.number) ? String(Number(near.number) + 1) : near.number,
    parts: near.parts.map((pb) => ({ staves: pb.staves.map((sb) => ({ voices: sb.voices.map((_, vi) => (vi === 0 ? [wholeBarRest(newId(), length)] : [])) })) })),
    from: near.added ? [lo, hi] : side === 'before' ? [lo, lo] : [hi, hi],
    added: { id: nextAddedBarId(), side: near.added?.side ?? side },
  }
  if (side === 'before') {
    if (index === 0) {
      // The piece starts with the new bar: what is in force from the start goes with it.
      if (near.time) bar.time = near.time
      delete near.time
      near.parts.forEach((pb, pi) => {
        const into = bar.parts[pi]!
        if (pb.key) into.key = pb.key
        delete pb.key
        pb.staves.forEach((sb, si) => {
          if (sb.clef) into.staves[si]!.clef = sb.clef
          delete sb.clef
        })
      })
    }
    if (near.newSystem) bar.newSystem = true
    delete near.newSystem
  }
  renumberFrom(score, at, 1)
  score.bars.splice(at, 0, bar)
  return at
}

/**
 * Deletes bar `index` (from 0) in every part (design D5, spec "Delete a bar"): it goes with its notes, its marks, its
 * repeat signs and its endings. A slur, tie, tremolo, crescendo or diminuendo with an end in it goes with its other end;
 * an ending it was part of ends or starts at its neighbour. What it sets from there on that the next bar does not set
 * itself (the time, a key, a clef, a tempo marking, the start of a line) moves to the next bar, so the music after it
 * reads as before. The bars after it are renumbered. A multi-measure rest over it is cleared. Throws `BarEditError` for
 * the only bar of the piece (`onlyBar`).
 */
export function deleteBar(score: Score, index: number): void {
  const bar = barAt(score, index)
  if (score.bars.length === 1) throw new BarEditError('onlyBar', 'The only bar of the piece cannot be deleted')
  trackBars(score)
  clearMultiRests(score, index, index)
  // Slurs, ties, tremolos and hairpins with an end in the bar go, with their other ends.
  const gone = new Set<string>()
  for (const ref of voices(score)) {
    const view = voiceView(score, ref)
    for (const item of [...view.measures[index]!.items]) {
      if (!isNote(item)) continue
      gone.add(item.id)
      dropSlursAndTies(view, item)
      removeTremolo(view, item.id)
    }
  }
  for (const items of allItemLists(score)) {
    const kept = items.filter((i) => !(isWedge(i) && (gone.has(i.start) || gone.has(i.stop))))
    items.splice(0, items.length, ...kept)
  }
  // What the bar sets from there on moves to the next bar, unless that bar sets its own.
  const next = score.bars[index + 1]
  if (next) {
    if (bar.time && !next.time) next.time = bar.time
    if (bar.newSystem) next.newSystem = true
    bar.parts.forEach((pb, pi) => {
      const into = next.parts[pi]!
      if (pb.key && !into.key) into.key = pb.key
      pb.staves.forEach((sb, si) => {
        const staff = into.staves[si]!
        if (sb.clef && !staff.clef) staff.clef = sb.clef
        sb.voices.forEach((items, vi) => {
          const tempo = items.filter((i) => i.kind === 'tempo')
          const target = staff.voices[vi]
          if (tempo.length > 0 && target && !target.some((i) => i.kind === 'tempo')) target.unshift(...tempo)
        })
      })
    })
  }
  // The endings, as a view: the bar's place goes, and the close of an ending it ended moves to the bar before.
  const view = endingView(score)
  const [place] = view.splice(index, 1)
  if (place!.close && view[index - 1]?.label === place!.label && view[index]?.label !== place!.label) view[index - 1]!.close = place!.close
  score.bars.splice(index, 1)
  renumberFrom(score, index, -1)
  writeEndings(score, view, index - 1, index)
  const after = Math.min(index, score.bars.length - 1)
  tidyBars(score, after, after)
}

/**
 * Makes bar `index` (from 0) the same as the bar before it in the part of `where` (design D5, spec "Same as the bar
 * before"): in every staff and voice of that part, the bar's notes and rests are replaced by a copy of those of the bar
 * before, with fresh ids, their accidentals and note marks, and the slurs, ties, crescendos and diminuendos that lie
 * wholly inside that bar. The bar's own loudness marks, tempo marks and words stay at their place in the bar; its bar
 * lines, repeat signs and endings, and the other parts, do not change. The slurs, ties and hairpins of the notes that
 * go, go with their other ends. On a voice view, that voice only. Throws `BarEditError` for the first bar (`firstBar`).
 */
export function copyBarBefore(target: Score | VoiceScore, where: { part: string }, index: number): void {
  const isScore = 'bars' in target
  const length = isScore ? target.bars.length : target.measures.length
  if (!Number.isInteger(index) || index < 0 || index >= length) throw new EditError('That bar does not exist')
  if (index === 0) throw new BarEditError('firstBar', 'The first bar has no bar before it to copy')
  if (isScore) partOf(target, where)
  const views = isScore ? voices(target).filter((r) => r.part === where.part).map((r) => voiceView(target, r)) : [target]
  const newId = isScore ? idMaker(target) : target.of ? idMaker(target.of.score) : localIds(target)

  // The copies: each source note with a fresh id, and the old ids of the notes the copies replace.
  const ids = new Map<string, string>()
  for (const view of views) for (const item of view.measures[index - 1]!.items) if (isNote(item)) ids.set(item.id, newId())
  const leaving = new Set<string>()
  for (const view of views) for (const item of view.measures[index]!.items) if (isNote(item)) leaving.add(item.id)

  // The notes that go lose their slurs, ties, tremolos and hairpins, with the other ends.
  for (const view of views) {
    for (const item of [...view.measures[index]!.items]) {
      if (!isNote(item)) continue
      dropSlursAndTies(view, item)
      removeTremolo(view, item.id)
    }
  }
  for (const items of wedgeLists(target)) {
    const kept = items.filter((i) => !(isWedge(i) && (leaving.has(i.start) || leaving.has(i.stop))))
    items.splice(0, items.length, ...kept)
  }

  for (const view of views) {
    const source = view.measures[index - 1]!.items
    const into = view.measures[index]!.items
    const copies = copyItems(view, source, ids, openSlurNumbers(view, index))
    // The bar's own directions keep their place in time: each goes before the first copied note at or after its start.
    const directions = into.flatMap((item, k) => (isDirection(item) ? [{ item, at: onsetIn(into, k) }] : []))
    for (const { item, at } of directions) {
      let k = copies.findIndex((c, j) => isNote(c) && cmp(onsetIn(copies, j), at) >= 0)
      if (k < 0) k = copies.length
      while (k > 0 && isWedge(copies[k - 1]!)) k--
      copies.splice(k, 0, item)
    }
    into.splice(0, into.length, ...copies)
  }
  for (const view of views) {
    normaliseTuplets(view.measures[index]!)
    resolveAlters(view, index, Math.min(index + 1, view.measures.length - 1))
  }
}

/** Fresh note ids for a bare voice view (one not made from a score). */
function localIds(view: VoiceScore): () => string {
  const used = usedIds(view)
  let n = allNotes(view).length + 1
  return () => {
    while (used.has(`e${n}`)) n++
    const id = `e${n}`
    used.add(id)
    return id
  }
}

/** The slur numbers of the voice that are open across the start of bar `index`: a slur copied into the bar must not take one. */
function openSlurNumbers(view: VoiceScore, index: number): Set<number> {
  const open = new Set<number>()
  for (let b = 0; b < index; b++) {
    for (const item of view.measures[b]!.items) {
      if (!isNote(item)) continue
      for (const s of item.slurs) if (s.type === 'stop') open.delete(s.number)
      for (const s of item.slurs) if (s.type === 'start') open.add(s.number)
    }
  }
  return open
}

/**
 * Copies of the notes, rests and hairpins of one voice's items in one bar of `view` (`source`), for `copyBarBefore`: with
 * the ids of `ids`, and only the slurs, ties and hairpins that lie wholly inside the bar. Slurs get numbers that are not
 * in `taken`. Directions are not copied.
 */
function copyItems(view: VoiceScore, source: readonly MeasureItem[], ids: ReadonlyMap<string, string>, taken: ReadonlySet<number>): MeasureItem[] {
  // The slurs that start and stop in the bar: their marks by note id and number.
  const inner = new Set<string>()
  const open = new Map<number, string[]>()
  for (const item of source) {
    if (!isNote(item)) continue
    for (const s of item.slurs) {
      if (s.type === 'start') open.set(s.number, [`${item.id}/${s.number}`])
      else if (s.type === 'continue') open.get(s.number)?.push(`${item.id}/${s.number}`)
      else {
        const marks = open.get(s.number)
        if (marks) for (const mark of [...marks, `${item.id}/${s.number}`]) inner.add(mark)
        open.delete(s.number)
      }
    }
  }
  const numbers = new Map<number, number>()
  const numberFor = (n: number): number => {
    if (!numbers.has(n)) {
      let free = 1
      while (taken.has(free) || [...numbers.values()].includes(free)) free++
      numbers.set(n, free)
    }
    return numbers.get(n)!
  }
  const inBar = (n: Note | undefined): boolean => !!n && source.includes(n)
  const out: MeasureItem[] = []
  for (const item of source) {
    if (isWedge(item)) {
      const start = ids.get(item.start)
      const stop = ids.get(item.stop)
      if (start && stop) out.push({ ...item, start, stop })
      continue
    }
    if (!isNote(item)) continue
    const copy: Note = structuredClone(item)
    copy.id = ids.get(item.id)!
    copy.slurs = item.slurs.filter((s) => inner.has(`${item.id}/${s.number}`)).map((s) => ({ type: s.type, number: numberFor(s.number) }))
    if (copy.tieStart && !inBar(tiePartner(view, item.id, 1))) delete copy.tieStart
    if (copy.tieStop && !inBar(tiePartner(view, item.id, -1))) delete copy.tieStop
    out.push(copy)
  }
  return out
}
