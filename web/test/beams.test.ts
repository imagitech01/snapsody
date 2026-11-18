import assert from 'node:assert/strict'
import { test } from 'node:test'
import { beamScore } from '../src/core/score/beams.ts'
import { notesOf } from '../src/core/score/model.ts'
import { parseMusicXml, serializeMusicXml } from '../src/core/score/musicxml.ts'
import { eighths, note, quarters, score } from './helpers.ts'

/** The level-1..n beam values per note of measure [index], e.g. ['begin', 'end', '-'] ('-' = no beam). */
function beams(xml: string, index = 0): string[] {
  const s = parseMusicXml(xml)
  const marks = beamScore(s)
  return notesOf(s.measures[index]!).map((n) => (marks.get(n.id) ?? []).map((b) => b.value).join('+') || '-')
}

test('beams: eighths in 4/4 are joined in pairs, one per beat', () => {
  assert.deepEqual(beams(score([eighths(8)], [4, 4])), ['begin', 'end', 'begin', 'end', 'begin', 'end', 'begin', 'end'])
})

test('beams: 6/8 joins three eighths per dotted-quarter beat', () => {
  assert.deepEqual(beams(score([eighths(6)], [6, 8])), ['begin', 'continue', 'end', 'begin', 'continue', 'end'])
})

test('beams: eighth triplets in 3/4 are joined per beat (exercise 87)', () => {
  const triplets = Array.from({ length: 6 }, () => note({ step: 'G', type: 'eighth', triplet: true })).join('')
  assert.deepEqual(beams(score([triplets + quarters(1)], [3, 4])), ['begin', 'continue', 'end', 'begin', 'continue', 'end', '-'])
})

test('beams: a rest or a longer note breaks the group, and a lone eighth keeps its flag', () => {
  const body = note({ type: 'eighth' }) + note({ type: 'eighth', rest: true }) + quarters(1) + eighths(2) + note({ type: 'quarter' })
  assert.deepEqual(beams(score([body], [3, 4])), ['-', '-', '-', 'begin', 'end', '-'])
})

test('beams: sixteenths get a second beam, a lone sixteenth a hook', () => {
  const body =
    note({ type: '16th' }) + note({ type: '16th' }) + note({ type: '16th' }) + note({ type: '16th' }) + // beat 1
    note({ type: 'eighth', dots: 1 }) + note({ type: '16th' }) + // beat 2: dotted eighth + sixteenth
    quarters(2)
  assert.deepEqual(beams(score([body], [4, 4])), [
    'begin+begin', 'continue+continue', 'continue+continue', 'end+end',
    'begin', 'end+backward hook',
    '-', '-',
  ])
})

test('beams: a pickup bar is counted from the end of a full bar', () => {
  // 4/4 pickup of three eighths: the first stands alone on the "and" of 3, the last two make beat 4.
  assert.deepEqual(beams(score([eighths(3), quarters(4)], [4, 4])), ['-', 'begin', 'end'])
})

test('beams: written into the MusicXML for rendering only, in schema order', () => {
  const s = parseMusicXml(score([eighths(2) + quarters(2)], [2, 4]))
  const plain = serializeMusicXml(s)
  assert.ok(!plain.includes('<beam'), 'the saved form has no beams')
  const shown = serializeMusicXml(s, { beams: beamScore(s) })
  assert.match(shown, /<staff>1<\/staff>\s*<beam number="1">begin<\/beam>\s*<\/note>/)
  assert.match(shown, /<beam number="1">end<\/beam>/)
  // Reading it back ignores the beams, so nothing else changes.
  assert.equal(serializeMusicXml(parseMusicXml(shown)), plain)
})
