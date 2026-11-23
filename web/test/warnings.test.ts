import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ALTO_SAX, CLARINET, GUITAR, PIANO, TENOR_SAX, TRUMPET, VIOLIN } from '../src/core/instruments/instruments.ts'
import type { Instrument } from '../src/core/instruments/instruments.ts'
import { insertNote, setDuration, stepPitch } from '../src/core/score/edit.ts'
import { createI18n } from '../src/app/i18n/index.ts'
import { EditSession } from '../src/core/score/editSession.ts'
import { notesOf } from '../src/core/score/model.ts'
import { barLength } from '../src/core/score/repairs.ts'
import { eq, frac } from '../src/core/score/rational.ts'
import type { Score } from '../src/core/score/model.ts'
import { parseMusicXml, serializeMusicXml } from '../src/core/score/musicxml.ts'
import { prepareRecognisedScore } from '../src/core/score/prepare.ts'
import { computeScoreWarnings } from '../src/core/score/warnings.ts'
import { HOMR_MARKS_FIXTURE, MELODY_PIANO_FIXTURE, eighths, note, quarters, read, score } from './helpers.ts'
import { firstLine, warningsFor } from './helpers.ts'

// Warnings are computed from the score and the instrument in use, never stored (design D4).

/** One 3/4 bar: A3, B3, C4 (a written A3 is below the tenor saxophone's range, and fine on a piano). */
const withA3 = (): Score => parseMusicXml(score([note({ step: 'A', octave: 3, type: 'quarter' }) + note({ step: 'B', octave: 3, type: 'quarter' }) + note({ step: 'C', octave: 4, type: 'quarter' })], [3, 4]))
const kinds = (s: Score, instrument: Instrument): string[] => warningsFor(s, instrument).map((w) => `${w.kind}@${w.bar ?? '-'}`)

test('warnings: a written A3 is flagged for the tenor saxophone and not for the piano', () => {
  const s = withA3()
  const a3 = notesOf(firstLine(s).measures[0]!)[0]!
  const tenor = warningsFor(s, TENOR_SAX)
  assert.equal(tenor.length, 1)
  assert.deepEqual(
    { kind: tenor[0]!.kind, bar: tenor[0]!.bar, noteId: tenor[0]!.noteId, pitch: tenor[0]!.pitch, instrument: tenor[0]!.instrument },
    { kind: 'out-of-range', bar: '1', noteId: a3.id, pitch: 'A3', instrument: 'tenor-sax' },
  )
  assert.match(tenor[0]!.message, /Bar 1: A3 is outside the written range of the instrument \(Tenor saxophone, B♭3–F♯6\)/)
  assert.deepEqual(warningsFor(s, PIANO), [])
  assert.deepEqual(a3.pitch, { step: 'A', octave: 3 }, 'the note keeps its pitch as read')
})

test('warnings: fixing the note clears the warning, and undo brings it back', () => {
  const session = new EditSession(withA3())
  const id = notesOf(firstLine(session.score).measures[0]!)[0]!.id
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
  const outside = (instrument: Instrument): string[] => warningsFor(s, instrument).map((w) => w.pitch!)
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
  assert.deepEqual(warningsFor(s, TENOR_SAX), warningsFor(s, TENOR_SAX), 'the same twice')
  assert.deepEqual(s, before)
  assert.equal(serializeMusicXml(s), xml)
})

test('warnings: the time signature is warned about from the score alone, also after saving and loading', () => {
  const bars = [quarters(3), quarters(3)]
  const prepared = prepareRecognisedScore(score(bars)) // no time signature: 3/4 is inferred and marked
  assert.deepEqual(prepared.repairs, [])
  const loaded = parseMusicXml(prepared.musicxml)
  assert.deepEqual(kinds(loaded, TENOR_SAX), ['time-signature-inferred@-'])
  assert.match(warningsFor(loaded, TENOR_SAX)[0]!.message, /3\/4 was inferred/)
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
  assert.deepEqual(computeScoreWarnings({ parts: [], bars: [] }, '', TENOR_SAX), [])
})

test('warnings: the marks homr writes do not trip the bar check or the repairs (change more-marks)', () => {
  // As homr writes them, the two notes of a tremolo pair carry their own full values, so the bar
  // adds up as it is: no special rule is needed. Grace notes take no time, and the bars of a
  // multi-measure rest are whole-bar rests.
  const s = parseMusicXml(read(HOMR_MARKS_FIXTURE))
  const tremoloBar = firstLine(s).measures[2]!
  assert.deepEqual(notesOf(tremoloBar).map((n) => n.tremolo?.kind), ['start', 'stop'])
  assert.ok(eq(barLength(tremoloBar), frac(1)), 'the pair counts for both of its notes')
  assert.ok(notesOf(firstLine(s).measures[0]!).some((n) => n.grace))
  assert.deepEqual(warningsFor(s, PIANO), [])
  const prepared = prepareRecognisedScore(read(HOMR_MARKS_FIXTURE))
  assert.deepEqual(prepared.repairs, [])
  assert.deepEqual(warningsFor(parseMusicXml(prepared.musicxml), PIANO), [])
})

// ---- Several parts (change parts-and-accompaniment, task 3.4) ----------------------------------------------------

test('warnings: the accompaniment is not checked for range: a piano left hand down to C2 is not flagged for a tenor saxophone melody', () => {
  const s = parseMusicXml(read(MELODY_PIANO_FIXTURE))
  const low = s.bars[2]!.parts[1]!.staves[1]!.voices[1]!.filter((i) => i.kind === 'note' && !i.hidden)
  assert.equal((low[0] as { pitch?: { step: string; octave: number } }).pitch?.octave, 2, 'the left hand has a C2 in bar 3')
  assert.deepEqual(computeScoreWarnings(s, 'P1', TENOR_SAX), [])
  // a written A3 in the melody is still flagged: the range check runs on the user's part with the piece's instrument
  const a3 = notesOf(firstLine(s).measures[0]!)[0]!
  a3.pitch = { step: 'A', octave: 3 }
  const found = computeScoreWarnings(s, 'P1', TENOR_SAX)
  assert.deepEqual(found.map((w) => `${w.kind}@${w.bar}:${w.pitch}`), ['out-of-range@1:A3'])
  assert.equal(found[0]!.noteId, a3.id)
  assert.equal(found[0]!.instrument, 'tenor-sax')
})

test('warnings: a two-staff part is checked with the piano range, and only when it is the user\'s part', () => {
  const s = parseMusicXml(read(MELODY_PIANO_FIXTURE))
  const lh = s.bars[0]!.parts[1]!.staves[1]!.voices[0]!.find((i) => i.kind === 'note')!
  if (lh.kind === 'note') lh.pitch = { step: 'G', octave: 0 } // below the piano's A0
  assert.deepEqual(computeScoreWarnings(s, 'P1', TENOR_SAX), [], 'not the user\'s part: not checked')
  assert.deepEqual(computeScoreWarnings(s, 'P2', TENOR_SAX).map((w) => `${w.kind}@${w.bar}:${w.pitch}:${w.instrument}`), ['out-of-range@1:G0:piano'])
  // a note the tenor saxophone cannot play is fine in the piano part
  const rh = s.bars[0]!.parts[1]!.staves[0]!.voices[0]!.find((i) => i.kind === 'note')!
  if (rh.kind === 'note') rh.pitch = { step: 'C', octave: 3 }
  assert.equal(computeScoreWarnings(s, 'P2', TENOR_SAX).filter((w) => w.pitch === 'C3').length, 0)
})

test('warnings: the bar check runs on every voice of every part', () => {
  const s = parseMusicXml(read(MELODY_PIANO_FIXTURE))
  const voice = s.bars[3]!.parts[1]!.staves[1]!.voices[0]!
  voice.pop() // bar 4 of the piano's left hand is empty now: nothing to add up
  assert.deepEqual(computeScoreWarnings(s, 'P1', TENOR_SAX), [])
  const rh = s.bars[1]!.parts[1]!.staves[0]!.voices[0]!
  rh.splice(0, 3) // the first chord of bar 2 is gone: the right hand adds up to 2 beats
  const found = computeScoreWarnings(s, 'P1', TENOR_SAX)
  assert.deepEqual(found.map((w) => `${w.kind}@${w.bar}:${w.counted}`), ['bar-length@2:2'])
})

test('warnings: a voice after the first is flagged only when it is too long, not when it ends early', () => {
  const s = parseMusicXml(read(MELODY_PIANO_FIXTURE))
  const second = s.bars[2]!.parts[1]!.staves[1]!.voices[1]!
  second.pop() // the second left-hand voice of bar 3 ends early
  assert.deepEqual(computeScoreWarnings(s, 'P1', TENOR_SAX), [])
  const extra = second[0]
  if (extra && extra.kind === 'note') second.push({ ...extra, id: 'long', duration: frac(3, 4) }) // now too long
  assert.deepEqual(computeScoreWarnings(s, 'P1', TENOR_SAX).map((w) => `${w.kind}@${w.bar}`), ['bar-length@3'])
})

// --- warnings that say where they are (change edit-parts, D5) ---

test('warnings: left hand too long (spec "Edits keep bars consistent")', () => {
  // Bar 5 of the fixture: the left hand has four quarter notes; the first becomes a half note, so it adds up to 5 beats.
  const session = new EditSession(parseMusicXml(read(MELODY_PIANO_FIXTURE)))
  session.apply((s) => setDuration(s, 'n56', { type: 'half', dots: 0, triplet: false }))
  const found = computeScoreWarnings(session.score, 'P1', TENOR_SAX).filter((w) => w.kind === 'bar-length')
  assert.equal(found.length, 1)
  const [w] = found
  // The left hand has one voice with notes in bar 5, so the text names the hand only.
  assert.deepEqual([w!.bar, w!.part, w!.staff, w!.voice, w!.hand, w!.voiceNumber], ['5', 'P2', 1, 0, 'left', undefined])
  assert.equal(w!.message, 'Bar 5, left hand, adds up to 5 beats but 4/4 needs 4')
  assert.equal(createI18n().warning(w!), 'Bar 5, left hand, adds up to 5 beats but 4/4 needs 4.')
  // In bar 3 the left hand has two voices: a second voice that runs too long is named.
  session.apply((s) => setDuration(s, 'n44', { type: 'whole', dots: 0, triplet: false }))
  const second = computeScoreWarnings(session.score, 'P1', TENOR_SAX).find((x) => x.kind === 'bar-length' && x.bar === '3')!
  assert.deepEqual([second.hand, second.voiceNumber], ['left', 2])
  assert.equal(createI18n().warning(second), 'Bar 3, left hand, voice 2, adds up to 6 beats but 4/4 needs 4.')
})

test('warnings: a hand with one voice is named without a voice, and a one-line piece keeps its text', () => {
  // Bar 1 of the fixture: the right hand has one voice; a half rest after its last chord makes it 6 beats.
  const session = new EditSession(parseMusicXml(read(MELODY_PIANO_FIXTURE)))
  session.apply((s) => insertNote(s, 'n23', 'after', 'rest'))
  const right = computeScoreWarnings(session.score, 'P1', TENOR_SAX).find((w) => w.kind === 'bar-length')!
  assert.deepEqual([right.hand, right.voiceNumber], ['right', undefined])
  assert.equal(createI18n().warning(right), 'Bar 1, right hand, adds up to 6 beats but 4/4 needs 4.')
  // One line: the text is as it was.
  const line = parseMusicXml(score([quarters(4)], [3, 4]))
  const [one] = computeScoreWarnings(line, 'P1', TENOR_SAX)
  assert.equal(one!.kind, 'bar-length')
  assert.deepEqual([one!.hand, one!.voiceNumber], [undefined, undefined])
  assert.equal(one!.message, 'Bar 1 adds up to 4 beats but 3/4 needs 3')
  assert.equal(createI18n().warning(one!), 'Bar 1 adds up to 4 beats but 3/4 needs 3.')
})

// --- a pickup bar (change redesign-score-editor, D11) ---

test('warnings: a short first bar is a pickup and not flagged; a long first bar and a short second bar are (spec "Pickup bar")', () => {
  // A 4/4 piece that starts with one quarter note: the last beat before bar 2.
  const pickup = parseMusicXml(score([quarters(1), quarters(4), quarters(4)], [4, 4]))
  assert.deepEqual(kinds(pickup, TENOR_SAX), [])
  // A first bar of five beats is too long, not a pickup.
  const long = parseMusicXml(score([quarters(5), quarters(4)], [4, 4]))
  assert.deepEqual(kinds(long, TENOR_SAX), ['bar-length@1'])
  // A short bar after the first is flagged as before.
  const second = parseMusicXml(score([quarters(4), quarters(3), quarters(4)], [4, 4]))
  assert.deepEqual(kinds(second, TENOR_SAX), ['bar-length@2'])
  // After a pickup, a short second bar is still flagged.
  assert.deepEqual(kinds(parseMusicXml(score([quarters(1), quarters(3)], [4, 4])), TENOR_SAX), ['bar-length@2'])
})
