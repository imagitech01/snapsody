import assert from 'node:assert/strict'
import { test } from 'node:test'
import { frac } from '../src/core/score/rational.ts'
import type { Bar, Measure, Note, Score, Step } from '../src/core/score/model.ts'
import { freshDirectionId, singleVoiceScore, usedIds, voiceView, voices } from '../src/core/score/model.ts'

// The score model with parts, and the voice view (change parts-and-accompaniment, task 2.2, design D1/D2).

const note = (id: string, step: Step, octave = 4): Note => ({
  kind: 'note',
  id,
  pitch: { step, octave },
  type: 'quarter',
  dots: 0,
  duration: frac(1, 4),
  slurs: [],
  tuplets: [],
})

/** Three bars in today's shape: a clef, key and time in bar 1, a key change in bar 3. */
function oneLine(): Measure[] {
  return [
    {
      number: '1',
      clef: { sign: 'G', line: 2 },
      key: { fifths: 1 },
      time: { beats: 2, beatType: 4 },
      leftBarline: { repeat: 'forward' },
      items: [note('n1', 'G'), note('n2', 'A')],
    },
    { number: '2', rightBarline: { repeat: 'backward' }, newSystem: true, items: [note('n3', 'B'), note('n4', 'C', 5)] },
    { number: '3', key: { fifths: -1 }, multiRest: 2, items: [note('n5', 'F'), note('n6', 'G')] },
  ]
}

/** A melody (P1) and a piano part (P2) over two bars; the left hand has a second voice in bar 2. */
function melodyPiano(): Score {
  const bars: Bar[] = [
    {
      number: '1',
      time: { beats: 2, beatType: 4 },
      parts: [
        { key: { fifths: 0 }, staves: [{ clef: { sign: 'G', line: 2 }, voices: [[note('m1', 'E', 5), note('m2', 'D', 5)]] }] },
        {
          key: { fifths: 0 },
          staves: [
            { clef: { sign: 'G', line: 2 }, voices: [[note('r1', 'C', 5), note('r2', 'E', 5)]] },
            { clef: { sign: 'F', line: 4 }, voices: [[note('l1', 'C', 3), note('l2', 'G', 2)], []] },
          ],
        },
      ],
    },
    {
      number: '2',
      parts: [
        { staves: [{ voices: [[note('m3', 'C', 5), note('m4', 'C', 5)]] }] },
        {
          key: { fifths: 2 },
          staves: [
            { voices: [[note('r3', 'D', 5), note('r4', 'F', 5)]] },
            { clef: { sign: 'G', line: 2 }, voices: [[note('l3', 'D', 4)], [note('l4', 'A', 3)]] },
          ],
        },
      ],
    },
  ]
  return {
    title: 'Two parts',
    parts: [
      { id: 'P1', name: 'Melody', staves: 1 },
      { id: 'P2', name: 'Piano', staves: 2 },
    ],
    bars,
  }
}

test('model: the view of a one-line score equals the measures it was made from', () => {
  const measures = oneLine()
  const expected = structuredClone(measures)
  const score = singleVoiceScore(measures, { title: 'Etude', partName: 'Voice' })
  assert.deepEqual(score.parts, [{ id: 'P1', name: 'Voice', staves: 1 }])
  assert.equal(score.title, 'Etude')
  const view = voiceView(score, { part: 'P1', staff: 0, voice: 0 })
  assert.deepEqual(view.measures, expected)
  assert.equal(view.title, 'Etude')
  assert.equal(view.partName, 'Voice')
  assert.deepEqual(voices(score), [{ part: 'P1', staff: 0, voice: 0 }])
})

test('model: the view carries the part key and the staff clef, where they change', () => {
  const score = melodyPiano()
  const left = voiceView(score, { part: 'P2', staff: 1, voice: 0 })
  assert.deepEqual(left.measures.map((m) => m.key), [{ fifths: 0 }, { fifths: 2 }], 'the part key, on both staves')
  assert.deepEqual(left.measures.map((m) => m.clef), [{ sign: 'F', line: 4 }, { sign: 'G', line: 2 }], 'the clef of the left-hand staff')
  assert.deepEqual(left.measures.map((m) => m.time), [{ beats: 2, beatType: 4 }, undefined], 'the shared time')
  const right = voiceView(score, { part: 'P2', staff: 0, voice: 0 })
  assert.deepEqual(right.measures.map((m) => m.clef), [{ sign: 'G', line: 2 }, undefined], 'the right hand keeps its clef')
  assert.deepEqual(right.measures.map((m) => m.key), [{ fifths: 0 }, { fifths: 2 }])
  const melody = voiceView(score, { part: 'P1', staff: 0, voice: 0 })
  assert.deepEqual(melody.measures.map((m) => m.key), [{ fifths: 0 }, undefined], 'the melody has its own key')
  assert.deepEqual(melody.measures[1]!.items.map((i) => (i as Note).id), ['m3', 'm4'])
  assert.equal(melody.partName, 'Melody')
  const second = voiceView(score, { part: 'P2', staff: 1, voice: 1 })
  assert.deepEqual(second.measures.map((m) => m.items.length), [0, 1], 'a voice that has nothing in a bar is empty there')
})

test('model: every voice is listed, in order of part, staff and voice', () => {
  assert.deepEqual(voices(melodyPiano()), [
    { part: 'P1', staff: 0, voice: 0 },
    { part: 'P2', staff: 0, voice: 0 },
    { part: 'P2', staff: 1, voice: 0 },
    { part: 'P2', staff: 1, voice: 1 },
  ])
})

test('model: an item edited through the view is changed in the model', () => {
  const score = melodyPiano()
  const view = voiceView(score, { part: 'P2', staff: 1, voice: 1 })
  const items = view.measures[1]!.items
  ;(items[0] as Note).pitch = { step: 'B', octave: 3 }
  items.push(note('l5', 'C', 4))
  const inModel = score.bars[1]!.parts[1]!.staves[1]!.voices[1]!
  assert.equal(inModel, items, 'the same array')
  assert.deepEqual((inModel[0] as Note).pitch, { step: 'B', octave: 3 })
  assert.equal(inModel.length, 2)
  // and through a one-line score made from measures
  const measures = oneLine()
  const one = singleVoiceScore(measures)
  voiceView(one, { part: 'P1', staff: 0, voice: 0 }).measures[0]!.items.pop()
  assert.equal(measures[0]!.items.length, 1)
})

test('model: fresh ids are taken from the whole score, not only the voice', () => {
  const score = melodyPiano()
  const used = usedIds(voiceView(score, { part: 'P1', staff: 0, voice: 0 }))
  assert.ok(used.has('l4'), 'a note of another part counts as used')
  score.bars[1]!.parts[1]!.staves[0]!.voices[0]!.push({ kind: 'dynamic', id: 'd1', mark: 'p' })
  assert.equal(freshDirectionId(voiceView(score, { part: 'P1', staff: 0, voice: 0 })), 'd2')
})
