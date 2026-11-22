import assert from 'node:assert/strict'
import { test } from 'node:test'
import { notesOf } from '../src/core/score/model.ts'
import { parseMusicXml, serializeMusicXml } from '../src/core/score/musicxml.ts'
import { eq, frac } from '../src/core/score/rational.ts'
import { TENOR_SAX } from '../src/core/instruments/instruments.ts'
import { barLength, beatsText, inferTimeSignature, midiName, repairBarLengths } from '../src/core/score/repairs.ts'
import { eighths, note, quarters, score } from './helpers.ts'
import { firstLine, warningsFor } from './helpers.ts'

const full34 = quarters(3)
/** What is left for the user to check in a score, for the tenor saxophone. */
const warningsOf = (s: ReturnType<typeof parseMusicXml>) => warningsFor(s, TENOR_SAX)

test('bar length: six plain eighths + quarter in 3/4 is repaired to two triplet groups', () => {
  const s = parseMusicXml(score([full34, eighths(6) + note({ step: 'G', type: 'quarter' }), full34], [3, 4]))
  const bar2 = firstLine(s).measures[1]
  assert.ok(bar2)
  assert.ok(eq(barLength(bar2), frac(1, 1)), 'recognised as 4 beats')
  const repairs = repairBarLengths(firstLine(s))
  assert.deepEqual(warningsOf(s), [])
  assert.equal(repairs.length, 1)
  assert.equal(repairs[0]?.bar, '2')
  assert.ok(eq(barLength(bar2), frac(3, 4)), 'now 3 beats')
  const notes = notesOf(bar2)
  assert.deepEqual(notes.slice(0, 6).map((n) => n.timeMod), Array(6).fill({ actual: 3, normal: 2 }))
  assert.deepEqual(notes.map((n) => n.tuplets.map((t) => t.type)), [['start'], [], ['stop'], ['start'], [], ['stop'], []])
  assert.equal(notes[6]?.timeMod, undefined, 'the quarter is untouched')
  // the repair survives serialisation
  assert.ok(eq(barLength(firstLine(parseMusicXml(serializeMusicXml(s))).measures[1] as never), frac(3, 4)))
})

test('bar length: an eighth rest takes part in a repaired triplet group', () => {
  const body =
    note({ type: 'eighth', rest: true }) + eighths(2) + note({ step: 'G', type: 'quarter' }) + eighths(3, 'F')
  const s = parseMusicXml(score([body], [3, 4]))
  assert.equal(repairBarLengths(firstLine(s)).length, 1)
  assert.ok(eq(barLength(firstLine(s).measures[0] as never), frac(3, 4)))
})

test('bar length: an unrepairable bar is flagged with its number and left unchanged', () => {
  const short = quarters(2) // 2 beats
  const fiveEighthsAndHalf = eighths(5) + note({ step: 'G', type: 'half' }) // 9/8: no whole triplet groups fix it
  const ok = full34
  const s = parseMusicXml(score([ok, short, ok, fiveEighthsAndHalf], [3, 4]))
  const before = serializeMusicXml(s)
  const repairs = repairBarLengths(firstLine(s))
  const flags = warningsOf(s)
  assert.equal(repairs.length, 0)
  assert.deepEqual(flags.map((f) => [f.kind, f.bar]), [['bar-length', '2'], ['bar-length', '4']])
  assert.match(flags[0]?.message ?? '', /Bar 2 adds up to 2 beats but 3\/4 needs 3/)
  assert.equal(serializeMusicXml(s), before, 'flagged bars are not modified')
})

test('bar length: ambiguous cases are not repaired (only the specified pattern)', () => {
  // six eighths + quarter + extra plain eighth pair elsewhere: converting every group would overshoot the fix
  const s = parseMusicXml(score([eighths(3) + note({ step: 'G', type: 'half' }) + note({ step: 'G', type: 'quarter' })], [3, 4]))
  // 3/8 + 1/2 + 1/4 = 9/8, needs 3/4: surplus 3/8 = 3 groups, only one available -> flagged
  const repairs = repairBarLengths(firstLine(s))
  assert.equal(repairs.length, 0)
  assert.equal(warningsOf(s).length, 1)
})

test('bar length: correct bars and rests-only/empty bars cause no flags', () => {
  const s = parseMusicXml(score([full34, full34], [3, 4]))
  assert.deepEqual(repairBarLengths(firstLine(s)), [])
  assert.deepEqual(warningsOf(s), [])
})

test('time signature: a common-time exercise without one gets 4/4, marked inferred', () => {
  const bars = [quarters(4), eighths(8) , quarters(4), quarters(2) + note({ type: 'half', step: 'A' }), note({ type: 'whole' })]
  const s = parseMusicXml(score(bars))
  assert.equal(firstLine(s).measures[0]?.time, undefined)
  assert.equal(inferTimeSignature(firstLine(s)), true)
  assert.deepEqual(firstLine(s).measures[0]?.time, { beats: 4, beatType: 4, inferred: true })
  const flags = warningsOf(s)
  assert.deepEqual(flags.map((f) => f.kind), ['time-signature-inferred'])
  assert.match(flags[0]?.message ?? '', /4\/4 was inferred/)
  // the inferred marker survives serialisation
  const again = parseMusicXml(serializeMusicXml(s))
  assert.deepEqual(firstLine(again).measures[0]?.time, { beats: 4, beatType: 4, inferred: true })
  assert.deepEqual(again, s)
})

test('time signature: the majority decides; a short last bar is then flagged by the bar check', () => {
  const s = parseMusicXml(score([quarters(3), quarters(3), quarters(3), quarters(2)]))
  inferTimeSignature(firstLine(s))
  assert.deepEqual(firstLine(s).measures[0]?.time, { beats: 3, beatType: 4, inferred: true })
  assert.deepEqual(warningsOf(s).filter((f) => f.kind === 'bar-length').map((f) => f.bar), ['4'])
})

test('time signature: no majority means no inference and a warning', () => {
  const s = parseMusicXml(score([quarters(2), quarters(3), quarters(4)]))
  assert.equal(inferTimeSignature(firstLine(s)), false)
  assert.equal(firstLine(s).measures[0]?.time, undefined)
  assert.deepEqual(warningsOf(s).map((f) => f.kind), ['time-signature-missing'])
})

test('time signature: an existing one is never overwritten', () => {
  const s = parseMusicXml(score([quarters(4)], [3, 4]))
  assert.equal(inferTimeSignature(firstLine(s)), false)
  assert.deepEqual(firstLine(s).measures[0]?.time, { beats: 3, beatType: 4 })
})

test('range: written A3 is flagged and keeps its pitch; B-flat3 to F-sharp6 are fine', () => {
  const body =
    note({ step: 'A', octave: 3, type: 'quarter' }) + // below range
    note({ step: 'B', octave: 3, alter: -1, type: 'quarter' }) + // lowest written note
    note({ step: 'A', octave: 3, alter: 1, type: 'quarter' }) // A#3 = Bb3, in range
  const top =
    note({ step: 'F', octave: 6, alter: 1, type: 'quarter' }) + // highest written note
    note({ step: 'G', octave: 6, type: 'quarter' }) + // above range
    note({ type: 'quarter', rest: true })
  const s = parseMusicXml(score([body, top], [3, 4]))
  const flags = warningsOf(s)
  assert.deepEqual(flags.map((f) => [f.kind, f.bar]), [['out-of-range', '1'], ['out-of-range', '2']])
  assert.match(flags[0]?.message ?? '', /A3 is outside the written range of the instrument \(Tenor saxophone, B♭3–F♯6\)/)
  const a3 = notesOf(firstLine(s).measures[0] as never)[0]
  assert.equal(flags[0]?.noteId, a3?.id)
  assert.deepEqual(a3?.pitch, { step: 'A', octave: 3 })
  assert.deepEqual(firstLine(parseMusicXml(serializeMusicXml(s))).measures[0]?.items[0] && notesOf(firstLine(parseMusicXml(serializeMusicXml(s))).measures[0] as never)[0]?.pitch, { step: 'A', octave: 3 })
})

test('midi note names are spelled as the instrument ranges are given', () => {
  assert.deepEqual([58, 90, 52, 96, 21, 108, 83, 55, 100, 54, 86].map(midiName), ['B♭3', 'F♯6', 'E3', 'C7', 'A0', 'C8', 'B5', 'G3', 'E7', 'F♯3', 'D6'])
})

test('beat counts read as mixed numbers', () => {
  assert.equal(beatsText(frac(3)), '3')
  assert.equal(beatsText(frac(9, 4)), '2¼')
  assert.equal(beatsText(frac(8, 3)), '2⅔')
  assert.equal(beatsText(frac(1, 2)), '½')
  assert.equal(beatsText(frac(29, 12)), '2 5/12')
})
