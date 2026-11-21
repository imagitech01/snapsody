import { BarLineError } from '../../../core/score/edit.ts'
import type { EditError } from '../../../core/score/edit.ts'
import { partIndex } from '../../../core/score/model.ts'
import type { Score } from '../../../core/score/model.ts'
import type { I18n } from '../../../app/i18n/index.ts'

/**
 * Why a bar line could not be added or removed (change edit-parts, D9), as the editor says it: the refusal's own text,
 * naming the hand or the part when the piece has more than one place a note can be in ("A note in the left hand sounds
 * across that point…"). A one-line piece names no place. Any other failure is the general one.
 */
export function barLineText(t: I18n['t'], score: Score, error: EditError): string {
  if (!(error instanceof BarLineError)) return t('editor.error.edit')
  const place = placeOf(t, score, error)
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
function placeOf(t: I18n['t'], score: Score, error: BarLineError): string | undefined {
  const where = error.where
  if (!where) return undefined
  const part = score.parts[partIndex(score, where.part)]
  if (!part) return undefined
  if (part.staves === 2) return t(where.staff === 0 ? 'barline.place.right' : 'barline.place.left')
  return score.parts.length > 1 && part.name ? t('barline.place.part', { name: part.name.toLowerCase() }) : undefined
}
