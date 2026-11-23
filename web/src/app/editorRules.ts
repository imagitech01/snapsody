import { BarEditError, BarLineError, EditError, GridError, chordOf, dynamicOf, setDynamic, toggleAccent, toggleArpeggio, toggleBreath, toggleCaesura, toggleFermata, toggleOrnament, toggleStaccatissimo, toggleStaccato, toggleStrongAccent, toggleTenuto, toggleTremolo, wedgeAt } from '../core/score/edit.ts'
import type { LoudnessMark } from '../core/score/edit.ts'
import { LOUDNESS_MARKS } from '../core/score/edit.ts'
import type { BarMap, Score } from '../core/score/model.ts'
import { barMap, partIndex, placeOfNote } from '../core/score/model.ts'
import type { I18n, MessageKey } from './i18n/index.ts'
import { barsAfterSave } from './library.ts'
import type { PieceInfo } from './library.ts'

/*
 * The rules of the editor that are not state (change redesign-score-editor, group 5): the marks a note can have and the
 * edit that turns each on or off, what a refused edit says, and what a change of bars may do given the piece as last
 * saved. `EditorSession` (editorSession.ts) holds the state and uses these.
 */

// ---- Marks ---------------------------------------------------------------------------------

/** The marks that belong to one note, turned on and off on it (spec "Articulation marks"). */
export const NOTE_MARKS = ['staccato', 'staccatissimo', 'tenuto', 'accent', 'strongAccent', 'fermata', 'trill', 'turn', 'mordent', 'tremolo', 'arpeggio', 'breath', 'caesura'] as const
export type NoteMark = (typeof NOTE_MARKS)[number]

/** The marks that join a first and a last note (spec "Slide between two notes", "A mark that waits for its last note"). */
export const SPAN_MARKS = ['slur', 'tie', 'crescendo', 'diminuendo'] as const
export type SpanMark = (typeof SPAN_MARKS)[number]

/** Every mark of the Marks tools: a note's own mark, a mark that joins two notes, or a loudness mark. */
export type MarkKind = NoteMark | SpanMark | LoudnessMark

export const isSpanMark = (kind: MarkKind): kind is SpanMark => (SPAN_MARKS as readonly string[]).includes(kind)
export const isLoudnessMark = (kind: MarkKind): kind is LoudnessMark => (LOUDNESS_MARKS as readonly string[]).includes(kind)

/** The edit that turns the mark `kind` on or off on the note `id`; a loudness mark replaces another one, and the one the note has comes off. */
export function markEdit(kind: NoteMark | LoudnessMark, id: string): (score: Score) => void {
  if (isLoudnessMark(kind)) return (s) => setDynamic(s, id, dynamicOf(s, id)?.mark === kind ? undefined : kind)
  switch (kind) {
    case 'staccato':
      return (s) => toggleStaccato(s, id)
    case 'staccatissimo':
      return (s) => toggleStaccatissimo(s, id)
    case 'tenuto':
      return (s) => toggleTenuto(s, id)
    case 'accent':
      return (s) => toggleAccent(s, id)
    case 'strongAccent':
      return (s) => toggleStrongAccent(s, id)
    case 'fermata':
      return (s) => toggleFermata(s, id)
    case 'trill':
    case 'turn':
    case 'mordent':
      return (s) => toggleOrnament(s, id, kind)
    case 'tremolo':
      return (s) => toggleTremolo(s, id)
    case 'arpeggio':
      return (s) => toggleArpeggio(s, id)
    case 'breath':
      return (s) => toggleBreath(s, id)
    case 'caesura':
      return (s) => toggleCaesura(s, id)
  }
}

/**
 * The marks the note `id` has, for showing them active (spec "Ways to add a mark"): its own marks, the arpeggio of its
 * chord, a slur or tie that starts or stops on it, the hairpin over it, and its loudness mark. Empty for a note that is
 * not in the score.
 */
export function marksOf(score: Score, id: string): Set<MarkKind> {
  const place = placeOfNote(score, id)
  const found = new Set<MarkKind>()
  if (!place) return found
  const note = place.note
  for (const kind of ['staccato', 'staccatissimo', 'tenuto', 'accent', 'strongAccent', 'fermata', 'breath', 'caesura'] as const) if (note[kind]) found.add(kind)
  if (note.ornament) found.add(note.ornament)
  if (note.tremolo) found.add('tremolo')
  if (chordOf(score, id).first.arpeggio) found.add('arpeggio')
  if (note.slurs.some((s) => s.type !== 'continue')) found.add('slur')
  if (note.tieStart || note.tieStop) found.add('tie')
  const wedge = wedgeAt(score, id)
  if (wedge) found.add(wedge.type)
  const dynamic = dynamicOf(score, id)?.mark
  if (dynamic && isLoudnessMark(dynamic as MarkKind)) found.add(dynamic as LoudnessMark)
  return found
}

/** The next mark of the loudness strip in Grid (spec "Loudness strip in Grid"): none, p, mf, f, none; pp, mp and ff step to none. */
export function nextStripMark(mark: string | undefined): LoudnessMark | undefined {
  if (mark === undefined) return 'p'
  if (mark === 'p') return 'mf'
  if (mark === 'mf') return 'f'
  return undefined
}

// ---- What a refusal says -------------------------------------------------------------------

/** The texts a refused edit can fall back on when the refusal has no reason of its own. */
export type FallbackKey = 'editor.error.edit' | 'mark.error.slur' | 'mark.error.tie' | 'mark.error.wedge'

/**
 * What the editor's message line says for a refused edit (design D1): the reason of a bar-line, Grid or bar refusal in
 * the app's words, naming the hand or the part where a bar line meets a note (as `ui/screens/editor/barLineText.ts`,
 * which the old screen uses until it is replaced), else `fallback`.
 */
export function refusalText(t: I18n['t'], score: Score, error: EditError, fallback: FallbackKey = 'editor.error.edit'): string {
  if (error instanceof GridError) return t(`grid.error.${error.reason}`)
  if (error instanceof BarEditError) return t(`bars.error.${error.reason}`)
  if (!(error instanceof BarLineError)) return t(fallback)
  const place = placeOfRefusal(t, score, error)
  switch (error.reason) {
    case 'across':
      return place ? t('barline.error.acrossIn', { place }) : t('barline.error.across')
    case 'triplet':
      return place ? t('barline.error.tripletIn', { place }) : t('barline.error.triplet')
    case 'rest':
      return place ? t('barline.error.restIn', { place }) : t('barline.error.rest')
    default:
      return t(`barline.error.${error.reason}`)
  }
}

/** "the left hand", "the melody", or nothing for a one-line piece. */
function placeOfRefusal(t: I18n['t'], score: Score, error: BarLineError): string | undefined {
  const where = error.where
  if (!where) return undefined
  const part = score.parts[partIndex(score, where.part)]
  if (!part) return undefined
  if (part.staves === 2) return t(where.staff === 0 ? 'barline.place.right' : 'barline.place.left')
  return score.parts.length > 1 && part.name ? t('barline.place.part', { name: part.name.toLowerCase() }) : undefined
}

/** A message key, for the fixed texts the session puts on the message line. */
export type SessionMessage = Extract<MessageKey, 'editor.error.edit' | 'bars.error.onlyBar' | 'bars.error.onlyPage' | 'bars.error.firstBar' | 'barline.error.last' | 'barline.error.line' | 'mark.error.rest' | 'mark.error.voice' | 'mark.error.staff'>

// ---- Changes of bars and the piece as last saved (design D8, task 5.3) ---------------------

/** The map of a score whose bars are each in their own place: what `barMap` leaves out. */
function sameBars(count: number): BarMap {
  return { bars: Array.from({ length: count }, (_, i) => ({ first: i + 1, last: i + 1 })), added: [] }
}

/**
 * Where each bar of `score` is in the piece as last saved (`info`, with its score `saved`), as a save now would count it
 * (`barsAfterSave`): for each bar, the places ("page:line", the line being the index of the photo's line on the page,
 * -1 for none) of the saved bars it holds and of the saved bar it belongs to. Undefined when a save now would be
 * refused.
 */
export function savedPlaces(info: PieceInfo, saved: Score, score: Score): Set<string>[] | undefined {
  const map = barMap(saved, score) ?? sameBars(score.bars.length)
  const after = barsAfterSave(info, map)
  if (!after.ok) return undefined
  const holders: number[][] = score.bars.map(() => [])
  map.bars.forEach((range, k) => {
    if (range) for (let b = range.first; b <= range.last; b++) holders[b - 1]?.push(k + 1)
  })
  const placeOf = (old: number): string => {
    const page = info.pages.find((p) => p.firstBar <= old && old <= p.lastBar)
    return `${page?.n ?? 0}:${page ? page.staves.findIndex((s) => s.firstBar <= old && old <= s.lastBar) : -1}`
  }
  return score.bars.map((_, i) => new Set([...holders[i]!, after.owners[i]!].map(placeOf)))
}

/**
 * Whether a save of `changed` (the working score after a change of bars) would go through, and leave every page of the
 * piece a bar that is not an added one (`Bar.added`). The second rule is stricter than the library: a page whose only
 * bars were added in the session could be left without bars by an undo after a save (the added bar goes, and the bars
 * the undo brings back belong to a neighbouring page), so Delete is not offered for the last bar of a page that is
 * not an added bar.
 */
export function savesWithBars(info: PieceInfo, saved: Score, changed: Score): boolean {
  const map = barMap(saved, changed) ?? sameBars(changed.bars.length)
  const after = barsAfterSave(info, map)
  if (!after.ok) return false
  return info.pages.every((page) => after.owners.some((owner, i) => page.firstBar <= owner && owner <= page.lastBar && !changed.bars[i]!.added))
}

/** A fresh copy of a score with `change` made to it, or undefined when the change throws an `EditError`. */
export function changedCopy(score: Score, change: (score: Score) => unknown): Score | undefined {
  const copy = structuredClone(score)
  try {
    change(copy)
  } catch (error) {
    if (error instanceof EditError) return undefined
    throw error
  }
  return copy
}
