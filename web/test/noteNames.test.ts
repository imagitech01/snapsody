import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Step } from '../src/core/score/model.ts'
import { midiNoteName, noteName } from '../src/core/score/noteNames.ts'

// Note names (change redesign-score-editor, design D9; spec `app-shell` "Note names"): letters or do re mi,
// Do = C, the same octave number in both, the accidental after the name.

const STEPS: Step[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B']

test('note names: C4 is Do4, B♭3 is Si♭3, F♯5 is Fa♯5', () => {
  assert.equal(noteName({ step: 'C', octave: 4 }, 'letters'), 'C4')
  assert.equal(noteName({ step: 'C', octave: 4 }, 'solfege'), 'Do4')
  assert.equal(noteName({ step: 'B', alter: -1, octave: 3 }, 'letters'), 'B♭3')
  assert.equal(noteName({ step: 'B', alter: -1, octave: 3 }, 'solfege'), 'Si♭3')
  assert.equal(noteName({ step: 'F', alter: 1, octave: 5 }, 'letters'), 'F♯5')
  assert.equal(noteName({ step: 'F', alter: 1, octave: 5 }, 'solfege'), 'Fa♯5')
})

test('note names: every step of the scale in both styles, with the same octave number', () => {
  assert.deepEqual(STEPS.map((step) => noteName({ step, octave: 4 }, 'letters')), ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4'])
  assert.deepEqual(STEPS.map((step) => noteName({ step, octave: 4 }, 'solfege')), ['Do4', 'Re4', 'Mi4', 'Fa4', 'Sol4', 'La4', 'Si4'])
  // The C major scale as MIDI notes: the octave changes at C in both styles.
  const scale = [60, 62, 64, 65, 67, 69, 71, 72]
  assert.deepEqual(scale.map((midi) => midiNoteName(midi, 'letters')), ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'])
  assert.deepEqual(scale.map((midi) => midiNoteName(midi, 'solfege')), ['Do4', 'Re4', 'Mi4', 'Fa4', 'Sol4', 'La4', 'Si4', 'Do5'])
})

test('note names: double accidentals, and a natural has no sign', () => {
  assert.equal(noteName({ step: 'E', alter: -2, octave: 4 }, 'solfege'), 'Mi♭♭4')
  assert.equal(noteName({ step: 'G', alter: 2, octave: 2 }, 'letters'), 'G♯♯2')
  assert.equal(noteName({ step: 'A', alter: 0, octave: 0 }, 'solfege'), 'La0')
})

test('note names: a MIDI note is spelled as the instrument ranges are given, in both styles', () => {
  const twelve = [60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71]
  assert.deepEqual(twelve.map((midi) => midiNoteName(midi, 'letters')), ['C4', 'C♯4', 'D4', 'E♭4', 'E4', 'F4', 'F♯4', 'G4', 'A♭4', 'A4', 'B♭4', 'B4'])
  assert.deepEqual(twelve.map((midi) => midiNoteName(midi, 'solfege')), ['Do4', 'Do♯4', 'Re4', 'Mi♭4', 'Mi4', 'Fa4', 'Fa♯4', 'Sol4', 'La♭4', 'La4', 'Si♭4', 'Si4'])
  assert.equal(midiNoteName(58, 'solfege'), 'Si♭3', 'the low end of the saxophones')
  assert.equal(midiNoteName(90, 'solfege'), 'Fa♯6', 'their high end')
})
