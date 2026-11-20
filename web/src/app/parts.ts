import type { Part, Score } from '../core/score/model.ts'
import type { I18n } from './i18n/index.ts'

/*
 * What the practice screen says about the parts of a piece (change parts-and-accompaniment, design D5 and D9):
 * which parts and hands the user can take as their own, what plays along under each choice, when the
 * "Your part" and "Instrument for this piece" rows and the card show, and which hint a piece gets. The
 * words come from `en.ts`; this module only says which words (a `kind`) and which names (the parts' own).
 */

export type Hand = 'right' | 'left'

/** Your part as `practice.json` keeps it: a part, and for a two-staff part possibly one hand. */
export interface YourPart {
  id: string
  hand?: Hand
}

/** A choice under "Your part": a one-staff part, or a two-staff part with both hands, or with one. */
export interface PartChoice {
  part: YourPart
  kind: 'line' | 'both' | Hand
  /** The part's name ("Melody", "Piano"). */
  name: string
  /** True when the piece is one two-staff part and nothing else (hands are then named without the part: "Right hand"). */
  alone: boolean
}

/** A part or hand that plays along under a choice: `key` is what `practice.json` keeps in `silent`. */
export interface AlongChoice {
  key: string
  kind: 'line' | 'both' | Hand
  name: string
  alone: boolean
}

/** The Your part row, its card and the hint show when there is more than one part or a two-staff part. */
export const hasPartsRow = (score: Score): boolean => score.parts.length > 1 || score.parts.some((p) => p.staves === 2)

/** The Instrument for this piece row shows when the piece has a one-staff part (a piano part always sounds as piano). */
export const hasInstrumentRow = (score: Score): boolean => score.parts.some((p) => p.staves === 1)

const isAlone = (score: Score): boolean => score.parts.length === 1 && score.parts[0]!.staves === 2

/** Every choice of "Your part", in the order of the parts: a one-staff part, or both hands, the right hand, the left hand. */
export function partChoices(score: Score): PartChoice[] {
  const alone = isAlone(score)
  const choices: PartChoice[] = []
  for (const part of score.parts) {
    if (part.staves === 1) choices.push({ part: { id: part.id }, kind: 'line', name: part.name, alone })
    else {
      choices.push({ part: { id: part.id }, kind: 'both', name: part.name, alone })
      choices.push({ part: { id: part.id, hand: 'right' }, kind: 'right', name: part.name, alone })
      choices.push({ part: { id: part.id, hand: 'left' }, kind: 'left', name: part.name, alone })
    }
  }
  return choices
}

export const sameYourPart = (a: YourPart, b: YourPart): boolean => a.id === b.id && (a.hand ?? undefined) === (b.hand ?? undefined)

/** Your part held to the score: the stored one when the score has it (a hand only for a two-staff part), else the first part, both hands. */
export function resolvePart(score: Score, stored: YourPart | undefined): YourPart {
  const found = stored ? score.parts.find((p) => p.id === stored.id) : undefined
  if (!found) return { id: score.parts[0]?.id ?? 'P1' }
  return found.staves === 2 && stored!.hand ? { id: found.id, hand: stored!.hand } : { id: found.id }
}

/** What plays along when this is your part: every other part, and the other hand of a part you take one hand of. */
export function alongOf(score: Score, yours: YourPart): AlongChoice[] {
  const alone = isAlone(score)
  const result: AlongChoice[] = []
  for (const part of score.parts) {
    if (part.id !== yours.id) {
      result.push({ key: part.id, kind: part.staves === 2 ? 'both' : 'line', name: part.name, alone })
    } else if (part.staves === 2 && yours.hand) {
      const other: Hand = yours.hand === 'right' ? 'left' : 'right'
      result.push({ key: `${part.id}:${other}`, kind: other, name: part.name, alone })
    }
  }
  return result
}

/** The part a card or a choice is about, by id. */
export const partOf = (score: Score, id: string): Part | undefined => score.parts.find((p) => p.id === id)

// ---- The hint --------------------------------------------------------------------------------------

/** The first-time hint of a piece with the Your part row: which wording, and the names it uses. */
export interface PartsHint {
  kind: 'melodyPiano' | 'pianoAlone' | 'melodies' | 'other'
  /** The part names, in order, joined by ", ". For `melodyPiano` only the one-staff part's name. */
  names: string
  count: number
}

/** The hint for a piece, or null when it has no Your part row. */
export function partsHintOf(score: Score): PartsHint | null {
  if (!hasPartsRow(score)) return null
  const one = score.parts.filter((p) => p.staves === 1)
  const two = score.parts.filter((p) => p.staves === 2)
  const names = score.parts.map((p) => p.name).join(', ')
  const count = score.parts.length
  if (one.length === 1 && two.length === 1 && count === 2) return { kind: 'melodyPiano', names: one[0]!.name, count }
  if (count === 1 && two.length === 1) return { kind: 'pianoAlone', names, count }
  if (two.length === 0) return { kind: 'melodies', names, count }
  return { kind: 'other', names, count }
}

/** The hint's words (`en.ts`). */
export function partsHintText(t: I18n['t'], hint: PartsHint): string {
  switch (hint.kind) {
    case 'melodyPiano':
      return t('practice.hint.melodyPiano', { name: hint.names })
    case 'pianoAlone':
      return t('practice.hint.pianoAlone')
    case 'melodies':
      return t('practice.hint.melodies', { count: hint.count, names: hint.names })
    default:
      return t('practice.hint.other', { names: hint.names })
  }
}
