import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ALTO_SAX, CLARINET, GUITAR, PIANO, TENOR_SAX, TRUMPET, VIOLIN } from '../src/core/instruments/instruments.ts'
import type { Instrument } from '../src/core/instruments/instruments.ts'
import { stepPitch } from '../src/core/score/edit.ts'
import { EditSession } from '../src/core/score/editSession.ts'
import { notesOf } from '../src/core/score/model.ts'
import { barLength } from '../src/core/score/repairs.ts'
import { eq, frac } from '../src/core/score/rational.ts'
import type { Score } from '../src/core/score/model.ts'
import { parseMusicXml, serializeMusicXml } from '../src/core/score/musicxml.ts'
import { prepareRecognisedScore } from '../src/core/score/prepare.ts'
import { computeWarnings } from '../src/core/score/warnings.ts'
import { HOMR_MARKS_FIXTURE, eighths, note, quarters, read, score } from './helpers.ts'

// Warnings are computed from the score and the instrument in use, never stored (design D4).

/** One 3/4 bar: A3, B3, C4 (a written A3 is below the tenor saxophone's range, and fine on a piano). */
const withA3 = (): Score => parseMusicXml(score([note({ step: 'A', octave: 3, type: 'quarter' }) + note({ step: 'B', octave: 3, type: 'quarter' }) + note({ step: 'C', octave: 4, type: 'quarter' })], [3, 4]))
const kinds = (s: Score, instrument: Instrument): string[] => computeWarnings(s, instrument).map((w) => `${w.kind}@${w.bar ?? '-'}`)

test('warnings: a written A3 is flagged for the tenor saxophone and not for the piano', () => {
  const s = withA3()
  const a3 = notesOf(s.measures[0]!)[0]!
  const tenor = computeWarnings(s, TENOR_SAX)
  assert.equal(tenor.length, 1)
  assert.deepEqual(
    { kind: tenor[0]!.kind, bar: tenor[0]!.bar, noteId: tenor[0]!.noteId, pitch: tenor[0]!.pitch, instrument: tenor[0]!.instrument },
    { kind: 'out-of-range', bar: '1', noteId: a3.id, pitch: 'A3', instrument: 'tenor-sax' },
  )
  assert.match(tenor[0]!.message, /Bar 1: A3 is outside the written range of the instrument \(Tenor saxophone, B♭3–F♯6\)/)
  assert.deepEqual(computeWarnings(s, PIANO), [])
  assert.deepEqual(a3.pitch, { step: 'A', octave: 3 }, 'the note keeps its pitch as read')
})

test('warnings: fixing the note clears the warning, and undo brings it back', () => {
  const session = new EditSession(withA3())
  const id = notesOf(session.score.measures[0]!)[0]!.id
  assert.deepEqual(kinds(session.score, TENOR_SAX), ['out-of-range@1'])
  session.apply((s) => stepPitch(s, id, 1)) // A3 -> B3, inside the range
  assert.deepEqual(kinds(session.score, TENOR_SAX), [])
  session.undo()
  assert.deepEqual(kinds(session.score, TENOR_SAX), ['out-of-range@1'])
  session.redo()
  assert.deepEqual(kinds(session.score, TENOR_SAX), [])
})

test('warnings: the range is the written range of the instrument in use', () => {
  // A full 4/4 bar: the pitches, then rests.
  const bar = (...pitches: [string, number, number?][]): string =>
    pitches.map(([step, octave, alter]) => note({ step, octave, alter: alter ?? 0, type: 'quarter' })).join('') +
    note({ type: 'quarter', rest: true }).repeat(4 - pitches.length)
  // E3 D#3 | B5 C6 | G6
  const s = parseMusicXml(score([bar(['E', 3], ['D', 3, 1]), bar(['B', 5], ['C', 6]), bar(['G', 6])], [4, 4]))
  const outside = (instrument: Instrument): string[] => computeWarnings(s, instrument).map((w) => w.pitch!)
  assert.deepEqual(outside(TENOR_SAX), ['E3', 'D♯3', 'G6'])
  assert.deepEqual(outside(ALTO_SAX), ['E3', 'D♯3', 'G6'])
  assert.deepEqual(outside(CLARINET), ['D♯3'])
  assert.deepEqual(outside(GUITAR), ['D♯3', 'C6', 'G6'])
  assert.deepEqual(outside(TRUMPET), ['E3', 'D♯3', 'G6'], 'a hidden instrument has its range too')
  assert.deepEqual(outside(VIOLIN), ['E3', 'D♯3'])
  assert.deepEqual(outside(PIANO), [])
})

test('warnings: computing them never changes the score (the triplet repair is not run)', () => {
  // Six plain eighths and a quarter in 3/4: the recognition pipeline would repair this; a warning only reports it.
  const s = parseMusicXml(score([quarters(3), eighths(6) + note({ step: 'G', type: 'quarter' }), quarters(3)], [3, 4]))
  const before = structuredClone(s)
  const xml = serializeMusicXml(s)
  assert.deepEqual(kinds(s, TENOR_SAX), ['bar-length@2'])
  assert.deepEqual(computeWarnings(s, TENOR_SAX), computeWarnings(s, TENOR_SAX), 'the same twice')
  assert.deepEqual(s, before)
  assert.equal(serializeMusicXml(s), xml)
})

test('warnings: the time signature is warned about from the score alone, also after saving and loading', () => {
  const bars = [quarters(3), quarters(3)]
  const prepared = prepareRecognisedScore(score(bars)) // no time signature: 3/4 is inferred and marked
  assert.deepEqual(prepared.repairs, [])
  const loaded = parseMusicXml(prepared.musicxml)
  assert.deepEqual(kinds(loaded, TENOR_SAX), ['time-signature-inferred@-'])
  assert.match(computeWarnings(loaded, TENOR_SAX)[0]!.message, /3\/4 was inferred/)
  // Bars that do not agree on one length leave the score without a time signature.
  const missing = parseMusicXml(prepareRecognisedScore(score([quarters(2), quarters(3), quarters(4)])).musicxml)
  assert.deepEqual(kinds(missing, TENOR_SAX), ['time-signature-missing@-'])
  // A time signature that was read is never warned about.
  assert.deepEqual(kinds(parseMusicXml(score(bars, [3, 4])), TENOR_SAX), [])
})

test('warnings: time signature first, then bars and notes in score order', () => {
  const a3 = note({ step: 'A', octave: 3, type: 'quarter' })
  // No time signature, 3 of 5 bars have 3 beats: 3/4 is inferred. Bar 3 has four beats and the A3, bar 5 has two.
  const prepared = prepareRecognisedScore(score([quarters(3), quarters(3), a3 + quarters(3), quarters(3), quarters(2)]))
  assert.deepEqual(kinds(parseMusicXml(prepared.musicxml), TENOR_SAX), ['time-signature-inferred@-', 'bar-length@3', 'out-of-range@3', 'bar-length@5'])
  assert.deepEqual(kinds(parseMusicXml(prepared.musicxml), PIANO), ['time-signature-inferred@-', 'bar-length@3', 'bar-length@5'])
})

test('warnings: an empty score has none', () => {
  assert.deepEqual(computeWarnings({ measures: [] }, TENOR_SAX), [])
})

test('warnings: the marks homr writes do not trip the bar check or the repairs (change more-marks)', () => {
  // As homr writes them, the two notes of a tremolo pair carry their own full values, so the bar
  // adds up as it is: no special rule is needed. Grace notes take no time, and the bars of a
  // multi-measure rest are whole-bar rests.
  const s = parseMusicXml(read(HOMR_MARKS_FIXTURE))
  const tremoloBar = s.measures[2]!
  assert.deepEqual(notesOf(tremoloBar).map((n) => n.tremolo?.kind), ['start', 'stop'])
  assert.ok(eq(barLength(tremoloBar), frac(1)), 'the pair counts for both of its notes')
  assert.ok(notesOf(s.measures[0]!).some((n) => n.grace))
  assert.deepEqual(computeWarnings(s, PIANO), [])
  const prepared = prepareRecognisedScore(read(HOMR_MARKS_FIXTURE))
  assert.deepEqual(prepared.repairs, [])
  assert.deepEqual(computeWarnings(parseMusicXml(prepared.musicxml), PIANO), [])
})
