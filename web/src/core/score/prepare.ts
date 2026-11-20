import { parseMusicXml, serializeMusicXml } from './musicxml.ts'
import type { Score } from './model.ts'
import { firstVoice, voiceView, voices } from './model.ts'
import { inferTimeSignature, repairBarLengths } from './repairs.ts'
import type { Repair } from './repairs.ts'

export interface PreparedScore {
  /** The repaired score as MusicXML (a missing time signature that was inferred is marked as such in it). */
  musicxml: string
  /** Repairs that were applied automatically: the record that is stored with the piece. */
  repairs: Repair[]
  /** Number of bars in the score. */
  bars: number
}

/**
 * The post-recognition pipeline: parse, infer a missing time signature, repair bar lengths,
 * serialise. It decides nothing about what the user should check: that is computed from the result
 * and the instrument in use (`computeWarnings`). Throws if the input is not partwise MusicXML.
 */
export function prepareRecognisedScore(recognised: string): PreparedScore {
  return prepareScore(parseMusicXml(recognised))
}

/**
 * The same pipeline on a score that is already parsed (the pages of a piece, merged: core/pages).
 * It changes the score it is given.
 */
export function prepareScore(score: Score): PreparedScore {
  // The time signature is inferred on the first part's first voice; the bars are repaired on every voice (design D4).
  inferTimeSignature(voiceView(score, firstVoice(score)))
  const repairs = repairVoices(score)
  return { musicxml: serializeMusicXml(score), repairs, bars: score.bars.length }
}

/** Repairs the bar lengths of every voice of the score, from bar index `from` on (repairs.ts `repairBarLengths`), voice by voice. */
export function repairVoices(score: Score, from = 0): Repair[] {
  return voices(score).flatMap((ref) => repairBarLengths(voiceView(score, ref), from))
}
