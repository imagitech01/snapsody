import type { I18n } from '../../app/i18n/index.ts'
import type { AlongChoice, PartChoice, YourPart } from '../../app/parts.ts'
import type { Score } from '../../core/score/model.ts'

/*
 * The words for the parts of a piece (change parts-and-accompaniment, design D9; the agreed mock): the title of a
 * choice under "Your part" ("Piano, right hand", or "Right hand" in a piece that is only a piano part), the
 * name on the card next to the metronome ("Melody", "Both hands", "Left hand"), its short form for landscape,
 * where the card has no room for words.
 */

type T = I18n['t']
type Named = Pick<PartChoice, 'kind' | 'name' | 'alone'>

/** "Melody 2", "Piano, both hands"; "Both hands" when the piece is only the piano part. */
export function partTitle(t: T, c: Named): string {
  if (c.kind === 'line') return c.name
  if (c.alone) return t(`part.${c.kind}`)
  return t(`part.titled.${c.kind}`, { name: c.name })
}

/** What the card says: the part's name, or the hand or hands played. */
export function cardName(t: T, c: Pick<Named, 'kind' | 'name'>): string {
  return c.kind === 'line' ? c.name : t(`part.${c.kind}`)
}

/** What the card shows when the words do not fit (landscape): the initial of a name and its number ("M2"), "R", "L" or "R+L". */
export function cardShort(t: T, c: Pick<Named, 'kind' | 'name'>): string {
  if (c.kind !== 'line') return t(`part.short.${c.kind}`)
  const initial = [...c.name.trim()][0]?.toUpperCase() ?? ''
  const number = /(\d+)\s*$/.exec(c.name)?.[1] ?? ''
  return initial + number
}

/** The line under a choice. */
export const partSubtitle = (t: T, c: Pick<Named, 'kind'>): string => t(`part.sub.${c.kind}`)

/** The kind of choice your part is (a part, or both hands, or one), with the part's name, for the card and the summary. */
export function choiceOf(score: Score, yours: YourPart, alone: boolean): Named {
  const part = score.parts.find((p) => p.id === yours.id) ?? score.parts[0]!
  return { kind: part.staves === 2 ? (yours.hand ?? 'both') : 'line', name: part.name, alone }
}

/** The name of a part or hand that plays along: a whole part by its name ("Piano"), a hand as "Left hand" or "Piano, left hand". */
export const alongName = (t: T, c: AlongChoice): string => (c.kind === 'both' ? c.name : partTitle(t, c))
