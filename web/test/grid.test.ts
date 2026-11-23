import assert from 'node:assert/strict'
import { test } from 'node:test'
import { addWedge } from '../src/core/score/edit.ts'
import { gridOf } from '../src/core/score/grid.ts'
import type { GridBlock } from '../src/core/score/grid.ts'
import { firstVoice } from '../src/core/score/model.ts'
import type { Score, VoiceRef } from '../src/core/score/model.ts'
import { noteName } from '../src/core/score/noteNames.ts'
import { frac } from '../src/core/score/rational.ts'
import { backup, dyn, inChord, inVoice, n, onLeftHand, partsOf, scoreOf } from './playbackHelpers.ts'

// The Grid's description of one voice's bar (change redesign-score-editor, design D3, D4; task 4.2).

const bars = (bodies: string[], time: [number, number] = [4, 4]): Score => scoreOf(bodies.map((body) => ({ body })), time)
const grace = (id: string, step = 'A'): string => n({ id, step, type: 'eighth' }).replace(`<note id="${id}">`, `<note id="${id}"><grace/>`).replace(/<duration>\d+<\/duration>/, '')
const names = (rows: { pitch: Parameters<typeof noteName>[0] }[]): string[] => rows.map((r) => noteName(r.pitch, 'letters'))
const block = (blocks: GridBlock[], id: string): GridBlock => blocks.find((b) => b.id === id)!

test('grid: 16 columns in 4/4 with four beats, 12 in 6/8 with its two beats of three eighths (spec "A bar in 6/8")', () => {
  const four = gridOf(bars([n({ type: 'whole' })]), firstVoice(bars([n()])), 0)
  assert.equal(four.columns.length, 16)
  assert.equal(four.barColumns, 16)
  assert.deepEqual(four.columns.flatMap((c, i) => (c.beat ? [[i, c.beat]] : [])), [[0, 1], [4, 2], [8, 3], [12, 4]])
  assert.deepEqual(four.columns[5]!.start, frac(5, 16))
  const six = gridOf(bars([n({ type: 'half' }) + n({ type: 'quarter' })], [6, 8]), { part: 'P1', staff: 0, voice: 0 }, 0)
  assert.equal(six.columns.length, 12)
  assert.deepEqual(six.columns.flatMap((c, i) => (c.beat ? [[i, c.beat]] : [])), [[0, 1], [6, 2]])
  const waltz = gridOf(bars([n({ type: 'half' }) + n()], [3, 4]), { part: 'P1', staff: 0, voice: 0 }, 0)
  assert.equal(waltz.columns.length, 12)
  // A bar that is too long has more columns than its time signature, marked as outside the bar.
  const long = gridOf(bars([n({ type: 'whole' }) + n()]), { part: 'P1', staff: 0, voice: 0 }, 0)
  assert.deepEqual([long.columns.length, long.barColumns, long.columns[16]!.inBar, long.columns[16]!.beat], [20, 16, false, undefined])
})

test('grid: the rows cover the notes with three steps above and below, at least an octave, lines marked, in the key', () => {
  const s = bars([n({ step: 'E' }) + n({ step: 'G' }) + n({ step: 'A' }) + n({ step: 'F' })])
  const g = gridOf(s, firstVoice(s), 0)
  assert.deepEqual(names(g.rows), ['D5', 'C5', 'B4', 'A4', 'G4', 'F4', 'E4', 'D4', 'C4', 'B3'])
  assert.deepEqual(g.rows.filter((r) => r.line).map((r) => noteName(r.pitch, 'letters')), ['D5', 'B4', 'G4', 'E4'])
  assert.equal(names(g.rows)[block(g.blocks, g.blocks[0]!.id).row], 'E4')
  // One note: still an octave of rows. Grown by a step at the top for a drag to the edge.
  const one = bars([n({ step: 'G', type: 'whole' })])
  assert.deepEqual(names(gridOf(one, firstVoice(one), 0).rows), ['D5', 'C5', 'B4', 'A4', 'G4', 'F4', 'E4', 'D4'])
  assert.deepEqual(names(gridOf(one, firstVoice(one), 0, { up: 1 }).rows).slice(0, 2), ['E5', 'D5'])
  // No notes: the staff of the clef in force. In G major the F row is F♯.
  const empty = bars([n({ rest: true, type: 'whole' })])
  empty.bars[0]!.parts[0]!.key = { fifths: 1 }
  assert.deepEqual(names(gridOf(empty, firstVoice(empty), 0).rows), ['F♯5', 'E5', 'D5', 'C5', 'B4', 'A4', 'G4', 'F♯4', 'E4'])
  const piano = partsOf([{ id: 'P1', staves: 2, bars: [n({ type: 'whole', step: 'C', octave: 5 }) + backup(4) + onLeftHand(n({ rest: true, type: 'whole' }))] }])
  const left: VoiceRef = { part: 'P1', staff: 1, voice: 0 }
  assert.deepEqual(names(gridOf(piano, left, 0).rows), ['A3', 'G3', 'F3', 'E3', 'D3', 'C3', 'B2', 'A2', 'G2'], 'a left hand in the bass clef')
})

test('grid: blocks at their place and length; a triplet and a grace note are locked blocks (spec "Grid leaves alone what it cannot draw")', () => {
  const trip = (id: string, step: string) => n({ id, step, type: 'eighth', triplet: true })
  const s = bars([trip('t1', 'C') + trip('t2', 'D') + trip('t3', 'E') + grace('g') + n({ id: 'b', step: 'G' }) + n({ id: 'c', type: 'half', step: 'B' })])
  const g = gridOf(s, firstVoice(s), 0)
  assert.deepEqual(
    g.blocks.map((b) => [b.id, b.col, b.cols, b.locked ?? '-']),
    [
      ['t1', 0, 4 / 3, 'triplet'],
      ['t2', 4 / 3, 4 / 3, 'triplet'],
      ['t3', 8 / 3, 4 / 3, 'triplet'],
      ['g', 4, 0, 'grace'],
      ['b', 4, 4, '-'],
      ['c', 8, 8, '-'],
    ],
  )
  assert.deepEqual([block(g.blocks, 'c').start, block(g.blocks, 'c').length], [frac(1, 2), frac(1, 2)])
  // A rest in a triplet is locked time; a plain rest is no block.
  const r = bars([trip('t1', 'C') + n({ id: 'tr', rest: true, type: 'eighth', triplet: true }) + trip('t3', 'E') + n({ id: 'r', rest: true, type: 'quarter' }) + n({ id: 'h', type: 'half' })])
  const withRest = gridOf(r, firstVoice(r), 0)
  assert.deepEqual(withRest.lockedRests.map((x) => [x.id, x.col, x.locked]), [['tr', 4 / 3, 'triplet']])
  assert.deepEqual(withRest.blocks.map((b) => b.id), ['t1', 't3', 'h'])
})

test('grid: staccato and accent on the blocks, the label\'s accidental, and a chord as a column of blocks (spec "A staccato block")', () => {
  const s = bars([n({ id: 'a', stac: true }) + n({ id: 'b', accent: true }) + n({ id: 'c', step: 'F', alter: 1 }).replace('</type>', '</type><accidental>sharp</accidental>') + n({ id: 'd', step: 'C', octave: 5 }) + inChord(n({ id: 'e', step: 'E', octave: 5 }))])
  const g = gridOf(s, firstVoice(s), 0)
  assert.deepEqual(g.blocks.map((b) => [b.id, b.staccato, b.accent]), [['a', true, false], ['b', false, true], ['c', false, false], ['d', false, false], ['e', false, false]])
  assert.equal(block(g.blocks, 'a').cols, 4, 'a staccato quarter is still a quarter long')
  assert.deepEqual([block(g.blocks, 'c').accidental, noteName(block(g.blocks, 'c').pitch, 'solfege')], ['sharp', 'Fa♯4'])
  assert.deepEqual([block(g.blocks, 'd').chord, block(g.blocks, 'e').chord, block(g.blocks, 'e').col], [['d', 'e'], ['d', 'e'], 12])
  assert.equal(block(g.blocks, 'a').chord, undefined)
})

test('grid: the other voices of the staff are faint blocks; the rows make room for them', () => {
  const s = partsOf([{ id: 'P1', bars: [n({ id: 'a', type: 'whole', step: 'E', octave: 5 }) + backup(4) + inVoice(n({ id: 'v', type: 'half', step: 'C', octave: 4 }), 2)] }])
  const g = gridOf(s, firstVoice(s), 0)
  assert.deepEqual(g.blocks.map((b) => b.id), ['a'])
  assert.deepEqual(g.others.map((b) => [b.id, b.voice, b.cols, names(g.rows)[b.row]]), [['v', 1, 8, 'C4']])
  const second = gridOf(s, { part: 'P1', staff: 0, voice: 1 }, 0)
  assert.deepEqual([second.blocks.map((b) => b.id), second.others.map((b) => b.id)], [['v'], ['a']])
})

test('grid: the loudness strip holds the marks under their notes and the hairpins of the bar (spec "Loudness strip in Grid")', () => {
  const s = scoreOf([
    { body: n({ id: 'x', type: 'half' }) + n({ id: 'y', type: 'half' }) },
    { body: dyn('p') + n({ id: 'a' }) + n({ id: 'b' }) + n({ id: 'r', rest: true }) + dyn('mf') + n({ id: 'c' }) },
    { body: n({ id: 'z', type: 'whole' }) },
  ])
  addWedge(s, 'diminuendo', 'y', 'a')
  addWedge(s, 'crescendo', 'b', 'c')
  const g = gridOf(s, firstVoice(s), 1)
  assert.deepEqual(g.dynamics.map((d) => [d.mark, d.noteId, d.col]), [['p', 'a', 0], ['mf', 'c', 12]])
  assert.deepEqual(g.hairpins.map((h) => [h.type, h.start, h.stop, h.from, h.to, h.before, h.after]), [
    ['diminuendo', 'y', 'a', 0, 4, true, false],
    ['crescendo', 'b', 'c', 4, 16, false, false],
  ])
  // In the bars around it: the diminuendo ends after bar 1, nothing reaches bar 3.
  assert.deepEqual(gridOf(s, firstVoice(s), 0).hairpins.map((h) => [h.type, h.from, h.to, h.after]), [['diminuendo', 8, 16, true]])
  assert.deepEqual(gridOf(s, firstVoice(s), 2).hairpins, [])
  // A mark at a place where the shown voice has no note is shown by its column only.
  const other = partsOf([{ id: 'P1', bars: [n({ id: 'h', type: 'whole' }) + backup(4) + inVoice(n({ id: 'v1', rest: true }) + n({ id: 'v2', type: 'quarter' }), 2)] }])
  other.bars[0]!.parts[0]!.staves[0]!.voices[1]!.splice(1, 0, { kind: 'dynamic', id: 'd9', mark: 'f' })
  assert.deepEqual(gridOf(other, firstVoice(other), 0).dynamics.map((d) => [d.mark, d.noteId, d.col]), [['f', undefined, 4]])
})
