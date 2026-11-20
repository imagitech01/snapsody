import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ALTO_SAX,
  CLARINET,
  DEFAULT_INSTRUMENT,
  GUITAR,
  INSTRUMENTS,
  PIANO,
  TENOR_SAX,
  TRUMPET,
  VIOLIN,
  instrumentById,
  instrumentOrDefault,
  visibleInstruments,
} from '../src/core/instruments/instruments.ts'
import type { Pitch } from '../src/core/score/model.ts'
import { midiNumber } from '../src/core/score/repairs.ts'

// Written ranges are checked through the pitch-to-MIDI helper, with the pitches as the spec names them.
const p = (step: Pitch['step'], octave: number, alter = 0): Pitch => ({ step, octave, ...(alter ? { alter } : {}) })

test('instruments: all seven are offered, in order: the five of the spec, then violin and trumpet (they passed the listening check)', () => {
  assert.deepEqual(visibleInstruments().map((i) => i.id), ['tenor-sax', 'alto-sax', 'clarinet', 'piano', 'guitar', 'violin', 'trumpet'])
  assert.deepEqual(INSTRUMENTS.map((i) => i.id), ['tenor-sax', 'alto-sax', 'clarinet', 'piano', 'guitar', 'violin', 'trumpet'])
  for (const i of [VIOLIN, TRUMPET]) assert.equal(instrumentById(i.id), i)
  for (const i of INSTRUMENTS) assert.equal(i.hidden, undefined, 'none is hidden any more; `hidden` stays for a future instrument')
})

test('instruments: transposition from written to sounding pitch, in semitones', () => {
  assert.deepEqual(
    INSTRUMENTS.map((i) => [i.id, i.transpose]),
    [['tenor-sax', -14], ['alto-sax', -9], ['clarinet', -2], ['piano', 0], ['guitar', -12], ['violin', 0], ['trumpet', -2]],
  )
})

test('instruments: written ranges (B-flat3 to F-sharp6 for both saxophones)', () => {
  const ranges: [typeof TENOR_SAX, Pitch, Pitch][] = [
    [TENOR_SAX, p('B', 3, -1), p('F', 6, 1)],
    [ALTO_SAX, p('B', 3, -1), p('F', 6, 1)],
    [CLARINET, p('E', 3), p('C', 7)],
    [PIANO, p('A', 0), p('C', 8)],
    [GUITAR, p('E', 3), p('B', 5)],
    [VIOLIN, p('G', 3), p('E', 7)],
    [TRUMPET, p('F', 3, 1), p('D', 6)],
  ]
  for (const [instrument, low, high] of ranges) {
    assert.deepEqual(instrument.writtenRange, { low: midiNumber(low), high: midiNumber(high) }, instrument.id)
  }
})

test('instruments: a name, a family and a sound folder named like the id', () => {
  assert.deepEqual(
    INSTRUMENTS.map((i) => [i.id, i.name, i.family]),
    [
      ['tenor-sax', 'Tenor saxophone', 'woodwind'],
      ['alto-sax', 'Alto saxophone', 'woodwind'],
      ['clarinet', 'B♭ clarinet', 'woodwind'],
      ['piano', 'Piano', 'keyboard'],
      ['guitar', 'Guitar', 'string'],
      ['violin', 'Violin', 'string'],
      ['trumpet', 'Trumpet', 'brass'],
    ],
  )
  for (const i of INSTRUMENTS) assert.equal(i.sound, i.id, `${i.id}: the sample folder is the id`)
  assert.equal(new Set(INSTRUMENTS.map((i) => i.id)).size, INSTRUMENTS.length, 'ids are unique')
  for (const i of INSTRUMENTS) assert.deepEqual(i.clef, { sign: 'G', line: 2 })
})

test('instruments: the default is the tenor saxophone, also for a missing or unknown id', () => {
  assert.equal(DEFAULT_INSTRUMENT, TENOR_SAX)
  assert.equal(instrumentOrDefault(undefined), TENOR_SAX)
  assert.equal(instrumentOrDefault('theremin'), TENOR_SAX)
  assert.equal(instrumentOrDefault('clarinet'), CLARINET)
  assert.equal(instrumentById('theremin'), undefined)
})
