import type { Instrument, InstrumentId } from '../instruments/instruments.ts'
import { instrumentOfPart } from '../instruments/instruments.ts'
import type { Pitch, Score, VoiceScore } from './model.ts'
import { isNote, partIndex, voiceView, voices } from './model.ts'
import { cmp, eq, frac, mul } from './rational.ts'
import { midiNoteName, noteName } from './noteNames.ts'
import { barLength, beatsText, effectiveTimes, expectedLength, hasNotes, midiNumber } from './repairs.ts'

/*
 * Warnings: what the user should check in a score (practice-app design D4, specs `score-recognition`
 * "Range check" and `score-editing` "Flags shown for review").
 *
 * They are computed, never stored. `computeScoreWarnings` is a pure function of the score and the
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
  /** For out-of-range: the same written pitch, so the shown text can name it in the user's note names (design D9). */
  written?: Pitch
  instrument?: InstrumentId
  /**
   * For bar-length: what the bar adds up to, counted in the time signature's beat unit, as a person
   * reads it ("3½", "2⅔", "2 5/12"; `beatsText`). The time signature it is measured against is `time`.
   */
  counted?: string
  /** For bar-length: the time signature in force for the bar. For time-signature-inferred: the one that was inferred. */
  time?: { beats: number; beatType: number }
  /**
   * The voice it is about, for a bar-length or out-of-range warning of a score of parts (change edit-parts, D5):
   * the part's id, the staff and the voice (both from 0). The editor switches to that part to show it.
   */
  part?: string
  staff?: number
  voice?: number
  /** The staff by name, when the part has two: the right hand (staff 0) or the left hand. The text names it. */
  hand?: 'right' | 'left'
  /** The voice by number from 1, when its staff has more than one. The text names it. */
  voiceNumber?: number
  /** English text, notes named with letters (for logs and tests); the app's i18n builds the shown text from the fields above. */
  message: string
}

/** Where a voice's warnings are: the voice, and what of it the text names. */
interface Where {
  part: string
  staff: number
  voice: number
  hand?: 'right' | 'left'
  voiceNumber?: number
}

/** "Bar 5", "Bar 5, left hand", "Bar 5, left hand, voice 2" or "Bar 5, voice 2": the start of a warning's English text. */
function barPlace(bar: string, where?: Where): string {
  return [`Bar ${bar}`, ...(where?.hand ? [`${where.hand} hand`] : []), ...(where?.voiceNumber ? [`voice ${where.voiceNumber}`] : [])].join(', ')
}

/** The fields of `where` that a warning carries. */
function placeFields(where?: Where): Partial<ScoreWarning> {
  if (!where) return {}
  return { part: where.part, staff: where.staff, voice: where.voice, ...(where.hand ? { hand: where.hand } : {}), ...(where.voiceNumber ? { voiceNumber: where.voiceNumber } : {}) }
}

/** The bar and range warnings of one voice, by bar (index from 0). A voice without an instrument gets the bar check only. */
function voiceWarnings(score: VoiceScore, instrument: Instrument | undefined, laterVoice = false, whereIn?: (bar: number) => Where): ScoreWarning[][] {
  const times = effectiveTimes(score)
  return score.measures.map((m, index) => {
    const where = whereIn?.(index)
    const named = !!where?.hand || !!where?.voiceNumber
    const found: ScoreWarning[] = []
    const time = times[index]
    if (time && hasNotes(m)) {
      const length = barLength(m)
      // A voice after the first is flagged only when it is too long: a short one is simply not full. A short first bar
      // is a pickup, as playback counts it (change redesign-score-editor, D11); a first bar that is too long is flagged.
      const expected = expectedLength(time)
      const short = cmp(length, expected) < 0
      if (!eq(length, expected) && !(laterVoice && short) && !(index === 0 && short)) {
        const counted = beatsText(mul(length, frac(time.beatType)))
        found.push({
          kind: 'bar-length',
          bar: m.number,
          counted,
          time: { beats: time.beats, beatType: time.beatType },
          ...placeFields(where),
          message: `${barPlace(m.number, where)}${named ? ',' : ''} adds up to ${counted} beats but ${time.beats}/${time.beatType} needs ${time.beats}`,
        })
      }
    }
    if (!instrument) return found
    const { low, high } = instrument.writtenRange
    for (const item of m.items) {
      if (!isNote(item) || item.rest || !item.pitch) continue
      const midi = midiNumber(item.pitch)
      if (midi >= low && midi <= high) continue
      const pitch = noteName(item.pitch, 'letters')
      found.push({
        kind: 'out-of-range',
        bar: m.number,
        noteId: item.id,
        pitch,
        written: { ...item.pitch },
        instrument: instrument.id,
        ...placeFields(where),
        message: `${barPlace(m.number, where)}: ${pitch} is outside the written range of the instrument (${instrument.name}, ${midiNoteName(low, 'letters')}–${midiNoteName(high, 'letters')}); it may be a misread`,
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
 * down to C2 is not a misread on a tenor saxophone. The time signature comes first, then the bars in score order, and in a bar the voices in order, a bar's length
 * before its notes' ranges. A voice with nothing in a bar is not checked in it. Does not touch the score.
 */
export function computeScoreWarnings(score: Score, yourPart: string, pieceInstrument: Instrument): ScoreWarning[] {
  const refs = voices(score)
  const first = refs[0]
  if (!first) return []
  const mine = partIndex(score, yourPart) >= 0 ? yourPart : first.part
  const partInfo = score.parts[partIndex(score, mine)]!
  const instrument = instrumentOfPart(partInfo, pieceInstrument)
  // What a text names (change edit-parts, D5): the hand when the part has two staves, the voice when its staff has
  // more than one voice with notes in that bar (as the editor's label of a note does).
  const where = (ref: (typeof refs)[number]) => (bar: number): Where => {
    const pi = partIndex(score, ref.part)
    const staves = score.parts[pi]!.staves
    const filled = score.bars[bar]?.parts[pi]?.staves[ref.staff]?.voices.filter((v) => v.some((i) => isNote(i) && !i.hidden)).length ?? 0
    return {
      ...ref,
      ...(staves === 2 ? { hand: ref.staff === 0 ? ('right' as const) : ('left' as const) } : {}),
      ...(filled > 1 ? { voiceNumber: ref.voice + 1 } : {}),
    }
  }
  const perVoice = refs.map((ref) => voiceWarnings(voiceView(score, ref), ref.part === mine ? instrument : undefined, ref.voice > 0, where(ref)))
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
