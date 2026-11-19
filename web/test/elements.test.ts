import assert from 'node:assert/strict'
import { test } from 'node:test'
import { describeElement, mapElements, sameElement } from '../src/core/score/elements.ts'
import type { ElementRef, SvgTree } from '../src/core/score/elements.ts'
import type { Score } from '../src/core/score/model.ts'
import { notesOf } from '../src/core/score/model.ts'
import { parseMusicXml } from '../src/core/score/musicxml.ts'
import { renderScore } from '../src/core/score/render.ts'
import { parseXml } from '../src/core/score/xml.ts'
import type { XmlElement } from '../src/core/score/xml.ts'
import { COMMITTED_FIXTURE, read } from './helpers.ts'

// Selecting elements other than notes (change select-and-delete-elements, tasks 1.2 and 1.4).

const fixture = (): Score => parseMusicXml(read(COMMITTED_FIXTURE))

// ---------------------------------------------------------------- describeElement (task 1.2)

test('elements: describeElement names each kind on the all-elements fixture, with its bar', () => {
  const score = fixture()
  const cases: [ElementRef, unknown][] = [
    [{ kind: 'clef', bar: 0 }, { kind: 'clef', bar: 0, clef: { sign: 'G', line: 2 }, deletable: false }],
    [{ kind: 'key', bar: 0 }, { kind: 'key', bar: 0, deletable: false }],
    [{ kind: 'time', bar: 0 }, { kind: 'time', bar: 0, deletable: false }],
    [{ kind: 'key', bar: 5 }, { kind: 'key', bar: 5, deletable: true }],
    [{ kind: 'time', bar: 5 }, { kind: 'time', bar: 5, deletable: true }],
    [{ kind: 'tempo', id: 'd1' }, { kind: 'tempo', bar: 0, deletable: true }],
    [{ kind: 'dynamic', id: 'd2' }, { kind: 'dynamic', bar: 0, text: 'mf', deletable: true }],
    [{ kind: 'dynamic', id: 'd3' }, { kind: 'dynamic', bar: 2, text: 'p', deletable: true }],
    [{ kind: 'words', id: 'd4' }, { kind: 'words', bar: 2, deletable: true }],
    [{ kind: 'slur', noteId: 'n1', number: 1 }, { kind: 'slur', bar: 0, deletable: true }],
    [{ kind: 'tie', noteId: 'n7' }, { kind: 'tie', bar: 1, deletable: true }],
    [{ kind: 'wedge', startId: 'a1' }, { kind: 'wedge', bar: 0, deletable: true }],
    [{ kind: 'wedge', startId: 'n4' }, { kind: 'wedge', bar: 1, deletable: true }],
    [{ kind: 'articulation', noteId: 'a1', mark: 'staccato' }, { kind: 'articulation', bar: 0, mark: 'staccato', deletable: true }],
    [{ kind: 'articulation', noteId: 'n2', mark: 'tenuto' }, { kind: 'articulation', bar: 0, mark: 'tenuto', deletable: true }],
    [{ kind: 'articulation', noteId: 'n3', mark: 'accent' }, { kind: 'articulation', bar: 0, mark: 'accent', deletable: true }],
    [{ kind: 'articulation', noteId: 'n7', mark: 'breath' }, { kind: 'articulation', bar: 1, mark: 'breath', deletable: true }],
    [{ kind: 'articulation', noteId: 'n15', mark: 'fermata' }, { kind: 'articulation', bar: 5, mark: 'fermata', deletable: true }],
    [{ kind: 'barline', bar: 3 }, { kind: 'barline', bar: 3, deletable: false }],
  ]
  for (const [ref, expected] of cases) assert.deepEqual(describeElement(score, ref), expected, JSON.stringify(ref))
})

test('elements: describeElement is undefined for an element that is not there (or is gone)', () => {
  const score = fixture()
  const gone: ElementRef[] = [
    { kind: 'clef', bar: 3 }, // no clef change at bar 4
    { kind: 'key', bar: 2 },
    { kind: 'time', bar: 9 },
    { kind: 'barline', bar: 6 },
    { kind: 'dynamic', id: 'd4' }, // d4 is words, not a dynamic
    { kind: 'tempo', id: 'nope' },
    { kind: 'slur', noteId: 'n2', number: 1 }, // n2 has the slur's stop, not its start
    { kind: 'slur', noteId: 'n1', number: 2 },
    { kind: 'tie', noteId: 'n8' }, // the tie's stop
    { kind: 'wedge', startId: 'n1' },
    { kind: 'articulation', noteId: 'n1', mark: 'staccato' },
  ]
  for (const ref of gone) assert.equal(describeElement(score, ref), undefined, JSON.stringify(ref))

  // A clef change describes its clef; the first clef of a score without one is treble.
  score.measures[3]!.clef = { sign: 'F', line: 4 }
  assert.deepEqual(describeElement(score, { kind: 'clef', bar: 3 }), { kind: 'clef', bar: 3, clef: { sign: 'F', line: 4 }, deletable: true })
  delete score.measures[0]!.clef
  assert.deepEqual(describeElement(score, { kind: 'clef', bar: 0 })?.clef, { sign: 'G', line: 2 })
  // Once removed, the element is gone.
  notesOf(score.measures[0]!)[0]!.staccato = undefined
  assert.equal(describeElement(score, { kind: 'articulation', noteId: 'a1', mark: 'staccato' }), undefined)
})

// ---------------------------------------------------------------- mapElements (task 1.4)

/** A Verovio SVG parsed with the app's XML parser, read the way the score view reads the DOM. */
const xmlTree: SvgTree<XmlElement> = {
  classes: (n) => (n.attrs.class ?? '').split(/\s+/).filter(Boolean),
  id: (n) => n.attrs.id ?? '',
  children: (n) => n.children,
  glyph(n) {
    const find = (e: XmlElement): string | undefined => {
      if (e.name === 'use') return /#([0-9A-F]{4})/.exec(e.attrs['xlink:href'] ?? e.attrs.href ?? '')?.[1]
      for (const c of e.children) {
        const g = find(c)
        if (g) return g
      }
      return undefined
    }
    return find(n)
  },
}

/** The classes of everything the editor can select apart from notes. */
const SELECTABLE = ['clef', 'keySig', 'meterSig', 'dynam', 'tempo', 'dir', 'artic', 'fermata', 'breath', 'barLine', 'slur', 'tie', 'hairpin']

async function drawnAndMapped(score: Score, width = 360) {
  const [svg] = await renderScore(score, { width })
  const root = parseXml(svg!)
  const map = mapElements(root, xmlTree, score)
  const selectable: XmlElement[] = []
  const walk = (e: XmlElement): void => {
    if (e.name === 'g' && xmlTree.classes(e).some((c) => SELECTABLE.includes(c))) selectable.push(e)
    for (const c of e.children) walk(c)
  }
  walk(root)
  return { map, selectable }
}

const key = (ref: ElementRef): string => JSON.stringify(ref, Object.keys(ref).sort())

test('elements: on the drawn all-elements fixture every selectable element maps to the element it draws, and none is left over', async () => {
  const score = fixture()
  const { map, selectable } = await drawnAndMapped(score)
  const unmapped = selectable.filter((e) => !map.has(e)).map((e) => `${e.attrs.class}#${e.attrs.id ?? ''}`)
  assert.deepEqual(unmapped, [], 'every drawn element is mapped')
  const expected: ElementRef[] = [
    { kind: 'clef', bar: 0 },
    { kind: 'key', bar: 0 },
    { kind: 'time', bar: 0 },
    { kind: 'key', bar: 5 },
    { kind: 'time', bar: 5 },
    { kind: 'tempo', id: 'd1' },
    { kind: 'dynamic', id: 'd2' },
    { kind: 'dynamic', id: 'd3' },
    { kind: 'words', id: 'd4' },
    { kind: 'wedge', startId: 'a1' },
    { kind: 'wedge', startId: 'n4' },
    { kind: 'slur', noteId: 'n1', number: 1 },
    { kind: 'tie', noteId: 'n7' },
    { kind: 'articulation', noteId: 'a1', mark: 'staccato' },
    { kind: 'articulation', noteId: 'n2', mark: 'tenuto' },
    { kind: 'articulation', noteId: 'n3', mark: 'accent' },
    { kind: 'articulation', noteId: 'n4', mark: 'staccato' },
    { kind: 'articulation', noteId: 'n5', mark: 'staccato' },
    { kind: 'articulation', noteId: 'n6', mark: 'staccato' },
    { kind: 'articulation', noteId: 'n7', mark: 'breath' },
    { kind: 'articulation', noteId: 'n15', mark: 'fermata' },
    ...[0, 1, 2, 3, 4, 5].map((bar): ElementRef => ({ kind: 'barline', bar })),
  ]
  assert.deepEqual([...new Set([...map.values()].map(key))].sort(), expected.map(key).sort())
  // Every element that is mapped is in the score.
  for (const ref of map.values()) assert.ok(describeElement(score, ref), `${key(ref)} is in the score`)
})

test('elements: dynamics, tempo marks and words in one bar map in the order they are written, a tempo of words only included', async () => {
  const score = fixture()
  // Bar 2: "rit." as a tempo mark of words only (drawn as g.dir). Bar 3: p, dolce, then an f at the end.
  score.measures[1]!.items.unshift({ kind: 'tempo', id: 't9', words: 'rit.' })
  score.measures[2]!.items.push({ kind: 'dynamic', id: 'f9', mark: 'f' })
  score.measures[2]!.items.splice(1, 0, { kind: 'dynamic', id: 'pp9', mark: 'pp' })
  const { map, selectable } = await drawnAndMapped(score)
  assert.deepEqual(selectable.filter((e) => !map.has(e)).length, 0)
  const inBar = (bar: number): string[] =>
    [...map.values()].filter((r) => (r.kind === 'dynamic' || r.kind === 'tempo' || r.kind === 'words') && describeElement(score, r)?.bar === bar).map((r) => `${r.kind}:${'id' in r ? r.id : ''}`)
  assert.deepEqual(inBar(1), ['tempo:t9'])
  assert.deepEqual(inBar(2), ['dynamic:d3', 'dynamic:pp9', 'words:d4', 'dynamic:f9'])
})

test('elements: clef, key and time changes map to the change, also where a system starts and at the end of the system before', async () => {
  const score = fixture()
  // A clef change mid-line (bar 3), and a clef, key and time change at bar 4, which starts the second system at 360 px.
  score.measures[2]!.clef = { sign: 'F', line: 4 }
  score.measures[3]!.clef = { sign: 'G', line: 2 }
  score.measures[3]!.key = { fifths: 3 }
  score.measures[3]!.time = { beats: 3, beatType: 4 }
  // A slur from bar 3 into bar 4, over the system break.
  notesOf(score.measures[2]!)[0]!.slurs.push({ type: 'start', number: 2 })
  notesOf(score.measures[3]!)[2]!.slurs.push({ type: 'stop', number: 2 })
  const { map, selectable } = await drawnAndMapped(score)
  assert.deepEqual(selectable.filter((e) => !map.has(e)).map((e) => e.attrs.class), [])
  const refs = [...map.values()]
  const count = (ref: ElementRef): number => refs.filter((r) => sameElement(r, ref)).length
  assert.ok(count({ kind: 'clef', bar: 2 }) >= 1, 'the mid-line clef change')
  // The change at bar 4: drawn at the start of system 2, and as the courtesy one at the end of system 1.
  assert.ok(count({ kind: 'clef', bar: 3 }) >= 1, 'the clef change at the system start')
  assert.ok(count({ kind: 'key', bar: 3 }) >= 2, `the key change at the start of system 2 and its courtesy key (${count({ kind: 'key', bar: 3 })})`)
  assert.ok(count({ kind: 'time', bar: 3 }) >= 2, 'the time change and its courtesy time signature')
  assert.equal(count({ kind: 'slur', noteId: 'n8', number: 2 }), 2, 'both pieces of the slur over the system break')
  // The key of bar 0 is still drawn at the start of system 1 only.
  assert.equal(count({ kind: 'key', bar: 0 }), 1)
})
