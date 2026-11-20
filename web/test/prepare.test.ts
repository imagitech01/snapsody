import assert from 'node:assert/strict'
import { test } from 'node:test'
import { notesOf } from '../src/core/score/model.ts'
import { parseMusicXml } from '../src/core/score/musicxml.ts'
import { TENOR_SAX } from '../src/core/instruments/instruments.ts'
import { prepareRecognisedScore } from '../src/core/score/prepare.ts'
import { computeWarnings } from '../src/core/score/warnings.ts'
import { COMMITTED_FIXTURE, LOCAL_EXERCISE_87, LOCAL_PAGE, eighths, note, quarters, read, score, skipUnless } from './helpers.ts'
import { firstLine } from './helpers.ts'

/** What the user should check in a prepared score, for the tenor saxophone. */
const warningsOf = (musicxml: string) => computeWarnings(firstLine(parseMusicXml(musicxml)), TENOR_SAX)

test('prepare: pipeline repairs and serialises; the warnings are computed from the result', () => {
  const xml = score(
    [quarters(3), eighths(6) + note({ step: 'G', type: 'quarter' }), quarters(2), note({ step: 'A', octave: 3, type: 'half', dots: 1 })],
    [3, 4],
  )
  const result = prepareRecognisedScore(xml)
  assert.equal(result.bars, 4)
  assert.equal(result.repairs.length, 1)
  assert.deepEqual(warningsOf(result.musicxml).map((f) => [f.kind, f.bar]), [['bar-length', '3'], ['out-of-range', '4']])
  // output is valid and equals the in-memory result
  const again = prepareRecognisedScore(result.musicxml)
  assert.equal(again.musicxml, result.musicxml, 'idempotent')
  assert.equal(again.repairs.length, 0)
  assert.deepEqual(warningsOf(again.musicxml), warningsOf(result.musicxml))
})

test('prepare: the committed fixture has no repairs and no warnings', () => {
  const result = prepareRecognisedScore(read(COMMITTED_FIXTURE))
  assert.deepEqual(warningsOf(result.musicxml), [])
  assert.deepEqual(result.repairs, [])
})

test('prepare: non-MusicXML input throws', () => {
  assert.throws(() => prepareRecognisedScore('<nope/>'))
})

test('prepare: exercise 87 gives zero warnings (local fixture)', { skip: skipUnless(LOCAL_EXERCISE_87) }, () => {
  const result = prepareRecognisedScore(read(LOCAL_EXERCISE_87))
  assert.equal(result.bars, 19)
  assert.deepEqual(warningsOf(result.musicxml), [])
  const s = parseMusicXml(result.musicxml)
  const first = firstLine(s).measures[0]
  assert.deepEqual(first?.key, { fifths: 1 })
  assert.deepEqual(first?.time, { beats: 3, beatType: 4 })
  assert.ok(first?.items.some((i) => i.kind === 'dynamic' && i.mark === 'mf'))
  const last = notesOf(firstLine(s).measures[18] as never).at(-1)
  assert.equal(last?.dots, 1)
  assert.equal(last?.type, 'half')
  assert.deepEqual(last?.pitch, { step: 'G', octave: 4 })
  console.log(`exercise 87 repairs applied: ${result.repairs.length}`)
})

test('prepare: full page report (local fixture)', { skip: skipUnless(LOCAL_PAGE) }, () => {
  const result = prepareRecognisedScore(read(LOCAL_PAGE))
  const warnings = warningsOf(result.musicxml)
  console.log(`page.musicxml: ${result.bars} bars, ${warnings.length} warnings, ${result.repairs.length} repairs`)
  for (const f of warnings) console.log(`  warning ${f.kind}: ${f.message}`)
  for (const r of result.repairs) console.log(`  repair: ${r.message}`)
  assert.equal(result.bars, 32)
})
