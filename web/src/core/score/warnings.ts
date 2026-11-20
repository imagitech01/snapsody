import type { Instrument, InstrumentId } from '../instruments/instruments.ts'
import type { Score } from './model.ts'
import { isNote } from './model.ts'
import { eq, frac, mul } from './rational.ts'
import { barLength, beatsText, effectiveTimes, expectedLength, hasNotes, midiName, midiNumber, pitchName } from './repairs.ts'

/*
 * Warnings: what the user should check in a score (practice-app design D4, specs `score-recognition`
 * "Range check" and `score-editing` "Flags shown for review").
 *
 * They are computed, never stored. `computeWarnings` is a pure function of the score and the
 * instrument in use, so a warning follows the instrument (a written A3 is flagged for the tenor
 * saxophone and not for the piano) and disappears by itself once the score is fixed. The only thing
 * persisted is the record of the automatic repairs (repairs.ts) and the `inferred` mark on the time
 * signature, which lives in the saved MusicXML. Warnings never change the score and never block
 * practising.
 *
 * (Not to be confused with the `warnings: string[]` of `parseMusicXml`, which reports what the parser
 * had to drop.)
 */

export type ScoreWarningKind = 'bar-length' | 'out-of-range' | 'time-signature-inferred' | 'time-signature-missing'

export interface ScoreWarning {
  kind: ScoreWarningKind
  /** Printed measure number, when the warning concerns a bar. */
  bar?: string
  /** The note it concerns (out-of-range), for marking it on the score. */
  noteId?: string
  /** For out-of-range: the written pitch as read (for example "A3") and the instrument it is outside of. */
  pitch?: string
  instrument?: InstrumentId
  /**
   * For bar-length: what the bar adds up to, counted in the time signature's beat unit, as a person
   * reads it ("3½", "2⅔", "2 5/12"; `beatsText`). The time signature it is measured against is `time`.
   */
  counted?: string
  /** For bar-length: the time signature in force for the bar. For time-signature-inferred: the one that was inferred. */
  time?: { beats: number; beatType: number }
  /** English text for the UI; the app's i18n can build its own from the fields above. */
  message: string
}

/**
 * Every warning of the score for this instrument: the time signature first (it concerns the whole
 * piece), then the bars and notes in score order, a bar's length before its notes' ranges. Does not
 * touch the score.
 */
export function computeWarnings(score: Score, instrument: Instrument): ScoreWarning[] {
  const warnings = timeSignatureWarnings(score)
  const times = effectiveTimes(score)
  const { low, high } = instrument.writtenRange
  score.measures.forEach((m, index) => {
    const time = times[index]
    if (time && hasNotes(m)) {
      const length = barLength(m)
      if (!eq(length, expectedLength(time))) {
        const counted = beatsText(mul(length, frac(time.beatType)))
        warnings.push({
          kind: 'bar-length',
          bar: m.number,
          counted,
          time: { beats: time.beats, beatType: time.beatType },
          message: `Bar ${m.number} adds up to ${counted} beats but ${time.beats}/${time.beatType} needs ${time.beats}`,
        })
      }
    }
    for (const item of m.items) {
      if (!isNote(item) || item.rest || !item.pitch) continue
      const midi = midiNumber(item.pitch)
      if (midi >= low && midi <= high) continue
      const pitch = pitchName(item.pitch)
      warnings.push({
        kind: 'out-of-range',
        bar: m.number,
        noteId: item.id,
        pitch,
        instrument: instrument.id,
        message: `Bar ${m.number}: ${pitch} is outside the written range of the instrument (${instrument.name}, ${midiName(low)}–${midiName(high)}); it may be a misread`,
      })
    }
  })
  return warnings
}

function timeSignatureWarnings(score: Score): ScoreWarning[] {
  if (score.measures.length === 0) return []
  if (!score.measures.some((m) => m.time)) {
    return [{ kind: 'time-signature-missing', message: 'No time signature was recognised and the bars do not agree on one length' }]
  }
  const inferred = score.measures.find((m) => m.time?.inferred)?.time
  if (!inferred) return []
  return [
    {
      kind: 'time-signature-inferred',
      time: { beats: inferred.beats, beatType: inferred.beatType },
      message: `No time signature was recognised; ${inferred.beats}/${inferred.beatType} was inferred from the bar lengths`,
    },
  ]
}
