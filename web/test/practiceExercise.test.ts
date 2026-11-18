import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isNote, notesOf } from '../src/core/score/model.ts'
import { parseMusicXml, serializeMusicXml } from '../src/core/score/musicxml.ts'
import { TENOR_SAX } from '../src/core/instruments/instruments.ts'
import { prepareRecognisedScore } from '../src/core/score/prepare.ts'
import { computeWarnings } from '../src/core/score/warnings.ts'
import {
  PRACTICE_EXERCISE,
  PRACTICE_EXERCISE_RECOGNISED,
  practiceExercise,
  recognisedVariant,
} from './fixtures/make-practice-exercise.ts'
import { read } from './helpers.ts'

// The committed practice-exercise scores the UI tests use (openspec test-pyramid design T6).

test('practice exercise: the committed files are the generator output', () => {
  assert.equal(read(PRACTICE_EXERCISE), practiceExercise(), 'run: node test/fixtures/make-practice-exercise.ts')
  assert.equal(read(PRACTICE_EXERCISE_RECOGNISED), recognisedVariant(), 'run: node test/fixtures/make-practice-exercise.ts')
})

test('practice exercise: 19 bars in 3/4, G major, with what the UI tests need, and it round-trips', () => {
  const score = parseMusicXml(read(PRACTICE_EXERCISE))
  assert.equal(score.measures.length, 19)
  assert.deepEqual(score.measures[0]?.time, { beats: 3, beatType: 4 })
  assert.equal(score.measures[0]?.key?.fifths, 1)
  const notes = score.measures.flatMap(notesOf)
  assert.ok(notes.some((n) => n.timeMod?.actual === 3), 'triplets')
  assert.ok(notes.some((n) => n.slurs.length > 0), 'slurs')
  assert.ok(notes.some((n) => n.staccato), 'staccato')
  assert.equal(score.measures[4]?.leftBarline?.repeat, 'forward')
  assert.deepEqual(score.measures[11]?.rightBarline?.ending, { number: '1', type: 'stop' })
  assert.equal(score.measures[11]?.rightBarline?.repeat, 'backward')
  assert.equal(score.measures[12]?.leftBarline?.ending?.number, '2')
  assert.ok(score.measures[0]?.items.some((i) => i.kind === 'tempo' && i.words === 'Moderato'), 'tempo word')
  // MusicXML -> model -> MusicXML -> model gives the same model, and a fixed point after one round.
  const xml = serializeMusicXml(score)
  assert.deepEqual(parseMusicXml(xml), score)
  assert.equal(serializeMusicXml(parseMusicXml(xml)), xml)
  // Every bar is full.
  assert.deepEqual(computeWarnings(parseMusicXml(prepareRecognisedScore(read(PRACTICE_EXERCISE)).musicxml), TENOR_SAX), [])
})

test('practice exercise: the recognised variant gets the triplet repair in bar 10 and a range warning in bar 18', () => {
  const prepared = prepareRecognisedScore(read(PRACTICE_EXERCISE_RECOGNISED))
  assert.equal(prepared.bars, 19)
  assert.deepEqual(prepared.repairs.map((r) => r.bar), ['10'])
  const warnings = computeWarnings(parseMusicXml(prepared.musicxml), TENOR_SAX)
  assert.deepEqual(warnings.map((f) => [f.kind, f.bar]), [['out-of-range', '18']])
  assert.match(warnings[0]!.message, /A3/)
  assert.ok(!read(PRACTICE_EXERCISE_RECOGNISED).includes('<beam'), 'homr writes no beams')
  // After the repair, the music is the engraved exercise's except for the misread note.
  const repaired = parseMusicXml(prepared.musicxml).measures.flatMap(notesOf)
  const clean = parseMusicXml(read(PRACTICE_EXERCISE)).measures.flatMap(notesOf)
  assert.equal(repaired.length, clean.length)
  const differing = repaired.flatMap((n, i) => (JSON.stringify([n.pitch, n.duration]) === JSON.stringify([clean[i]!.pitch, clean[i]!.duration]) ? [] : [i]))
  assert.equal(differing.length, 1)
  assert.ok(parseMusicXml(prepared.musicxml).measures[17]!.items.filter(isNote).some((n) => n.pitch?.step === 'A' && n.pitch.octave === 3))
})
