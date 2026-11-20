import type { Instrument, InstrumentId } from '../instruments/instruments.ts'
import { instrumentOfPart } from '../instruments/instruments.ts'
import type { Score, VoiceScore } from './model.ts'
import { isNote, partIndex, voiceView, voices } from './model.ts'
import { cmp, eq, frac, mul } from './rational.ts'
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
 * Every warning of one voice for this instrument: the time signature first (it concerns the whole
 * piece), then the bars and notes in score order, a bar's length before its notes' ranges. Does not
 * touch the score.
 */
export function computeWarnings(score: VoiceScore, instrument: Instrument): ScoreWarning[] {
  return [...timeSignatureWarnings(score), ...voiceWarnings(score, instrument).flat()]
}

/** The bar and range warnings of one voice, by bar (index from 0). A voice without an instrument gets the bar check only. */
function voiceWarnings(score: VoiceScore, instrument: Instrument | undefined, laterVoice = false): ScoreWarning[][] {
  const times = effectiveTimes(score)
  return score.measures.map((m, index) => {
    const found: ScoreWarning[] = []
    const time = times[index]
    if (time && hasNotes(m)) {
      const length = barLength(m)
      // A voice after the first is flagged only when it is too long: a short one is simply not full.
      const expected = expectedLength(time)
      if (!eq(length, expected) && !(laterVoice && cmp(length, expected) < 0)) {
        const counted = beatsText(mul(length, frac(time.beatType)))
        found.push({
          kind: 'bar-length',
          bar: m.number,
          counted,
          time: { beats: time.beats, beatType: time.beatType },
          message: `Bar ${m.number} adds up to ${counted} beats but ${time.beats}/${time.beatType} needs ${time.beats}`,
        })
      }
    }
    if (!instrument) return found
    const { low, high } = instrument.writtenRange
    for (const item of m.items) {
      if (!isNote(item) || item.rest || !item.pitch) continue
      const midi = midiNumber(item.pitch)
      if (midi >= low && midi <= high) continue
      const pitch = pitchName(item.pitch)
      found.push({
        kind: 'out-of-range',
        bar: m.number,
        noteId: item.id,
        pitch,
        instrument: instrument.id,
        message: `Bar ${m.number}: ${pitch} is outside the written range of the instrument (${instrument.name}, ${midiName(low)}–${midiName(high)}); it may be a misread`,
      })
    }
    return found
  })
}

/**
 * Every warning of a score of several parts (change parts-and-accompaniment, design D4): the time signature
 * (read on the first part's first voice), the bar check on every voice, and the range check only on the voices of
 * the user's part (`yourPart`, a part id), with that part's instrument: the piano's for a two-staff part, any
 * other part the piece's instrument (`instrumentOfPart`). The other parts are not checked for range: a left hand
 * down to C2 is not a misread on a tenor saxophone. Order as `computeWarnings`: by bar, and in a bar by voice. A voice with
 * nothing in a bar is not checked in it. For a one-voice score it is `computeWarnings`.
 */
export function computeScoreWarnings(score: Score, yourPart: string, pieceInstrument: Instrument): ScoreWarning[] {
  const refs = voices(score)
  const first = refs[0]
  if (!first) return []
  const mine = partIndex(score, yourPart) >= 0 ? yourPart : first.part
  const partInfo = score.parts[partIndex(score, mine)]!
  const instrument = instrumentOfPart(partInfo, pieceInstrument)
  const perVoice = refs.map((ref) => voiceWarnings(voiceView(score, ref), ref.part === mine ? instrument : undefined, ref.voice > 0))
  const result = timeSignatureWarnings(voiceView(score, first))
  score.bars.forEach((_, bar) => {
    for (const found of perVoice) result.push(...(found[bar] ?? []))
  })
  return result
}

function timeSignatureWarnings(score: VoiceScore): ScoreWarning[] {
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
