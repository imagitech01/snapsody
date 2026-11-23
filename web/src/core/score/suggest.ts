import { DURATION_TYPES, EditError, GRID_VALUES, appendNote, canSplitBefore, deleteNote, joinBars, setDuration, splitBar } from './edit.ts'
import type { NoteValue } from './edit.ts'
import type { Note, Pitch, Score, VoiceRef } from './model.ts'
import { isNote, voiceView } from './model.ts'
import { noteDuration } from './musicxml.ts'
import type { Frac } from './rational.ts'
import { add, eq, frac, mul, sub } from './rational.ts'
import { barLength, effectiveTimes, expectedLength, hasNotes } from './repairs.ts'
import { barLengthFlagged } from './warnings.ts'

/*
 * Suggested repairs (change redesign-score-editor, design D6; spec "Suggested repairs"): for a bar that does not add
 * up, the single changes after which it does. Each one carries the edit to run (`run`, one call on a score, so the
 * editor applies it as one undo step) and the parts of its label, so the screen builds the text in the note names of
 * the settings (`I18n.suggestion`). It never guesses beyond one change: a wrong one costs one Undo.
 */

/** Where a note or rest is named in a label: its id, its written pitch (none for a rest) and its place in the bar from 1. */
export interface SuggestedNote {
  noteId: string
  /** The written pitch with its sounding alter, absent for a rest. */
  pitch?: Pitch
  /** Its place among the notes and rests of the voice's bar, from 1: a chord counts once, grace notes and hidden rests not at all. */
  place: number
}

/** The edit a suggestion runs: on the whole score, as `EditSession.apply` gives it. */
export type SuggestionRun = (score: Score) => void

export type Suggestion =
  /** A rest of the missing length at the end of the bar: "Add a quarter rest at the end". */
  | { kind: 'addRest'; length: NoteValue; run: SuggestionRun }
  /** A bar line after this note, in a bar exactly two bars long: "Bar line after G4 (3)". */
  | ({ kind: 'barLine'; run: SuggestionRun } & SuggestedNote)
  /** Joining the bar with the next one: "Join with the next bar". */
  | { kind: 'join'; run: SuggestionRun }
  /** A note or rest made dotted, undotted, halved or doubled: "E4 (1) → dotted quarter". */
  | ({ kind: 'length'; length: NoteValue; run: SuggestionRun } & SuggestedNote)
  /** A rest taken away: "Remove the rest (3)". */
  | ({ kind: 'removeRest'; run: SuggestionRun } & SuggestedNote)

export type SuggestionKind = Suggestion['kind']

export interface SuggestOptions {
  /**
   * Whether the bar line after bar `bar` may be removed, for the join: the editor's own rule
   * (`EditorSession.canRemoveBarLineAfter`, which knows where a page or a line of the photo ends). Without it, any join
   * that `joinBars` allows.
   */
  canJoin?: (bar: number) => boolean
}

/** At most this many, so the chips fit one row (D6). */
export const MAX_SUGGESTIONS = 4

/**
 * The suggested repairs for the voice `where` in bar `bar` (from 0), in the order of D6, at most `MAX_SUGGESTIONS`:
 *
 * 1. first the changes that touch no note: a rest of the missing length at the end (when that is one value), then a bar
 *    line where the bar is exactly two bars long and a note or rest starts at its middle (`canSplitBefore`), then
 *    joining with the next bar when the two together add up;
 * 2. then, in one pass over the notes and rests from the left of the bar, each one dotted, undotted, halved or doubled
 *    (in that order), and a rest removed.
 *
 * Each is tried on a copy of the score with the edit it runs, and kept only when the edit is allowed and the bar (both
 * bars, for a bar line) then adds up. A triplet, a grace note and a whole-bar rest are not changed. None for a bar that
 * has no bar-length warning (`barLengthFlagged`): a bar that adds up, a short pickup bar (D11), a short later voice, or a
 * bar without a time signature.
 */
export function suggestRepairs(score: Score, where: VoiceRef, bar: number, options: SuggestOptions = {}): Suggestion[] {
  const view = voiceView(score, where)
  const measure = view.measures[bar]
  const time = effectiveTimes(view)[bar]
  if (!measure || !time || !hasNotes(measure)) return []
  const length = barLength(measure)
  if (!barLengthFlagged(length, time, bar, where.voice > 0)) return []
  const expected = expectedLength(time)

  const found: Suggestion[] = []
  /** Keeps `s` when its edit is allowed on a copy and the bars `check` then add up in the voice. */
  const offer = (s: Suggestion, check: number[]): void => {
    if (found.length >= MAX_SUGGESTIONS) return
    const copy = structuredClone(score)
    try {
      s.run(copy)
    } catch (error) {
      if (error instanceof EditError) return
      throw error
    }
    const after = voiceView(copy, where)
    if (check.every((b) => after.measures[b] && eq(barLength(after.measures[b]!), expected))) found.push(s)
  }

  // The notes and rests of the bar that a label can name, with their start.
  const named: { note: Note; place: number; start: Frac }[] = []
  let t = frac(0)
  for (const item of measure.items) {
    if (!isNote(item) || item.chord || item.grace) continue
    if (!item.hidden) named.push({ note: item, place: named.length + 1, start: t })
    t = add(t, item.duration)
  }
  const label = (n: Note, place: number): SuggestedNote => ({ noteId: n.id, place, ...(n.pitch ? { pitch: { ...n.pitch } } : {}) })

  // 3. A rest of the missing length at the end.
  const missing = sub(expected, length)
  const rest = missing.n > 0 ? GRID_VALUES.find((v) => eq(noteDuration(v.type, v.dots), missing)) : undefined
  if (rest) offer({ kind: 'addRest', length: rest, run: (s) => void appendNote(s, where, bar, { ...rest, triplet: false }) }, [bar])

  // 4. A bar line at the middle of a bar that is two bars long.
  if (eq(length, mul(expected, frac(2)))) {
    const k = named.findIndex((x) => eq(x.start, expected))
    const at = named[k]
    const before = named[k - 1]
    if (at && before && canSplitBefore(score, at.note.id)) {
      const id = at.note.id
      offer({ kind: 'barLine', ...label(before.note, before.place), run: (s) => void splitBar(s, id) }, [bar, bar + 1])
    }
  }

  // 5. Joining with the next bar.
  const next = view.measures[bar + 1]
  if (missing.n > 0 && next && eq(add(length, barLength(next)), expected) && options.canJoin?.(bar) !== false) {
    offer({ kind: 'join', run: (s) => joinBars(s, bar) }, [bar])
  }

  // 1 and 2. One note or rest at a time, from the left.
  for (const { note, place } of named) {
    if (note.timeMod || note.measureRest || !note.type) continue
    const i = DURATION_TYPES.indexOf(note.type)
    if (i < 0) continue
    const values: NoteValue[] = []
    values.push({ type: note.type, dots: note.dots === 0 ? 1 : 0 })
    if (DURATION_TYPES[i + 1]) values.push({ type: DURATION_TYPES[i + 1]!, dots: note.dots })
    if (i > 0) values.push({ type: DURATION_TYPES[i - 1]!, dots: note.dots })
    const id = note.id
    for (const value of values) {
      if (!eq(add(sub(length, note.duration), noteDuration(value.type, value.dots)), expected)) continue
      offer({ kind: 'length', ...label(note, place), length: value, run: (s) => setDuration(s, id, { ...value, triplet: false }) }, [bar])
    }
    if (note.rest && eq(sub(length, note.duration), expected)) offer({ kind: 'removeRest', ...label(note, place), run: (s) => void deleteNote(s, id) }, [bar])
  }
  return found
}
