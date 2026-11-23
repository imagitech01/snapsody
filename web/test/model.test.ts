import assert from 'node:assert/strict'
import { test } from 'node:test'
import { frac } from '../src/core/score/rational.ts'
import type { Bar, Measure, Note, Score, Step } from '../src/core/score/model.ts'
import { barMap, freshDirectionId, singleVoiceScore, usedIds, voiceView, voices } from '../src/core/score/model.ts'
import { addBar, deleteBar, joinBars, splitBar } from '../src/core/score/edit.ts'

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

// ---- the bar map after added and deleted bars (change redesign-score-editor, D8, task 3.6) ------

/** A 2/4 melody of `n` bars of two quarter notes, as loaded (no `from`): bar k (from 1) holds the notes `k.1` and `k.2`. */
const loaded = (n: number): Score =>
  singleVoiceScore(Array.from({ length: n }, (_, i): Measure => ({ number: String(i + 1), ...(i === 0 ? { time: { beats: 2, beatType: 4 } } : {}), items: [note(`${i + 1}.1`, 'C'), note(`${i + 1}.2`, 'D')] })))
/** The index of the bar that holds note `id`. */
const barOf = (s: Score, id: string): number => s.bars.findIndex((b) => b.parts[0]!.staves[0]!.voices[0]!.some((i) => i.kind === 'note' && i.id === id))
const r = (first: number, last: number) => ({ first, last })

test('barMap: an added, a deleted, a split and a joined bar in one edit', () => {
  const before = loaded(6)
  const after = structuredClone(before)
  addBar(after, 0, 'after')
  splitBar(after, '2.2')
  deleteBar(after, barOf(after, '4.1'))
  joinBars(after, barOf(after, '5.1'))
  // Now: 1, the added bar, 2 in two, 3, 5 and 6 as one.
  assert.equal(after.bars.length, 6)
  assert.deepEqual(barMap(before, after), { bars: [r(1, 1), r(3, 4), r(5, 5), null, r(6, 6), r(6, 6)], added: [{ bar: 2, of: 1 }] })
  assert.equal(barMap(before, structuredClone(before)), undefined, 'nothing moved')
})

test('barMap: a bar added before bar 1 belongs to bar 1, one added after the last bar to the last bar', () => {
  const before = loaded(3)
  const first = structuredClone(before)
  addBar(first, 0, 'before')
  assert.deepEqual(barMap(before, first), { bars: [r(2, 2), r(3, 3), r(4, 4)], added: [{ bar: 1, of: 1 }] })
  const last = structuredClone(before)
  addBar(last, 2, 'after')
  assert.deepEqual(barMap(before, last), { bars: [r(1, 1), r(2, 2), r(3, 3)], added: [{ bar: 4, of: 3 }] })
  // Two bars added at the end of page 1 / start of page 2 sit side by side, each with the bar it was added next to.
  const both = structuredClone(before)
  addBar(both, 0, 'after')
  addBar(both, 2, 'before')
  assert.deepEqual(barMap(before, both), { bars: [r(1, 1), r(4, 4), r(5, 5)], added: [{ bar: 2, of: 1 }, { bar: 3, of: 2 }] })
})

test('barMap: a bar added next to half of a split bar, and next to an added bar, belongs to the loaded bar', () => {
  const before = loaded(3)
  const after = structuredClone(before)
  splitBar(after, '2.2')
  addBar(after, 1, 'after')
  addBar(after, 2, 'after')
  // 1, 2 (first half), added, added, 2 (second half), 3.
  assert.deepEqual(barMap(before, after), { bars: [r(1, 1), r(2, 5), r(6, 6)], added: [{ bar: 3, of: 2 }, { bar: 4, of: 2 }] })
  // A bar added before the second half of a split bar whose first half was deleted: the place is inside the stretch of
  // bar 2 of `before`, so it belongs to bar 2, not to the bar before it.
  const half = structuredClone(before)
  splitBar(half, '2.2')
  deleteBar(half, 1)
  addBar(half, 1, 'before')
  assert.deepEqual(barMap(before, half), { bars: [r(1, 1), r(3, 3), r(4, 4)], added: [{ bar: 2, of: 2 }] })
})

test('barMap: two loaded bars joined across the place of a deleted bar hold it too, as the stretch of the joined bar covers it', () => {
  // `from` cannot tell this join from a join of the three bars: the deleted bar maps to the joined bar.
  const before = loaded(5)
  const after = structuredClone(before)
  deleteBar(after, 2)
  joinBars(after, 1)
  assert.deepEqual(after.bars.map((b) => b.from), [[0, 1], [1, 4], [4, 5]])
  assert.deepEqual(barMap(before, after), { bars: [r(1, 1), r(2, 2), r(2, 2), r(2, 2), r(3, 3)], added: [] })
})

test('barMap: from a score saved with added bars, a kept added bar maps by its id and a deleted one to nothing', () => {
  const start = loaded(6)
  addBar(start, 1, 'after')
  addBar(start, 5, 'before')
  // Saved as: 1, 2, X, 3, 4, Y, 5, 6.
  const saved = structuredClone(start)
  const after = structuredClone(saved)
  deleteBar(after, 5)
  addBar(after, 2, 'after')
  addBar(after, 0, 'before')
  // Now: W, 1, 2, X, Z, 3, 4, 5, 6. Z was added after X, so it belongs to bar 2 like X; W to bar 1.
  assert.equal(after.bars[3]!.added!.id, saved.bars[2]!.added!.id)
  assert.deepEqual(barMap(saved, after), {
    bars: [r(2, 2), r(3, 3), r(4, 4), r(6, 6), r(7, 7), null, r(8, 8), r(9, 9)],
    added: [
      { bar: 1, of: 1 },
      { bar: 5, of: 2 },
    ],
  })
  // A bar added next to a saved added bar whose loaded bar was deleted before the save belongs to that added bar.
  const lone = loaded(3)
  addBar(lone, 1, 'after')
  deleteBar(lone, 1)
  const savedLone = structuredClone(lone)
  addBar(lone, 1, 'after')
  assert.deepEqual(barMap(savedLone, lone), { bars: [r(1, 1), r(2, 2), r(4, 4)], added: [{ bar: 3, of: 2 }] })
  // Also when that added bar is deleted in turn: the new one still belongs to it, not to the bar before.
  deleteBar(lone, 1)
  assert.deepEqual(barMap(savedLone, lone), { bars: [r(1, 1), null, r(3, 3)], added: [{ bar: 2, of: 2 }] })
})

test('barMap: a deleted bar that an undo brings back after the save belongs to the bar before it', () => {
  const before = loaded(4)
  const saved = structuredClone(before)
  deleteBar(saved, 2)
  // The undo gives back the score from before the delete; the save maps from the score as saved.
  assert.deepEqual(barMap(saved, before), { bars: [r(1, 1), r(2, 2), r(4, 4)], added: [{ bar: 3, of: 2 }] })
})
