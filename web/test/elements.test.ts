import assert from 'node:assert/strict'
import { test } from 'node:test'
import { describeElement, mapElements, sameElement } from '../src/core/score/elements.ts'
import type { ElementRef, SvgTree } from '../src/core/score/elements.ts'
import type { Score } from '../src/core/score/model.ts'
import { notesOf } from '../src/core/score/model.ts'
import { parseMusicXml } from '../src/core/score/musicxml.ts'
import { loadToolkit, renderScore } from '../src/core/score/render.ts'
import { parseXml } from '../src/core/score/xml.ts'
import type { XmlElement } from '../src/core/score/xml.ts'
import { COMMITTED_FIXTURE, HOMR_MARKS_FIXTURE, read } from './helpers.ts'
import { firstLine, setAttr } from './helpers.ts'

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
  for (const [ref, expected] of cases) assert.deepEqual(describeElement(firstLine(score), ref), expected, JSON.stringify(ref))
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
  for (const ref of gone) assert.equal(describeElement(firstLine(score), ref), undefined, JSON.stringify(ref))

  // A clef change describes its clef; the first clef of a score without one is treble.
  setAttr(score, 3, 'clef', { sign: 'F', line: 4 })
  assert.deepEqual(describeElement(firstLine(score), { kind: 'clef', bar: 3 }), { kind: 'clef', bar: 3, clef: { sign: 'F', line: 4 }, deletable: true })
  setAttr(score, 0, 'clef', undefined)
  assert.deepEqual(describeElement(firstLine(score), { kind: 'clef', bar: 0 })?.clef, { sign: 'G', line: 2 })
  // Once removed, the element is gone.
  notesOf(firstLine(score).measures[0]!)[0]!.staccato = undefined
  assert.equal(describeElement(firstLine(score), { kind: 'articulation', noteId: 'a1', mark: 'staccato' }), undefined)
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
  const map = mapElements(root, xmlTree, firstLine(score))
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
  for (const ref of map.values()) assert.ok(describeElement(firstLine(score), ref), `${key(ref)} is in the score`)
})

test('elements: dynamics, tempo marks and words in one bar map in the order they are written, a tempo of words only included', async () => {
  const score = fixture()
  // Bar 2: "rit." as a tempo mark of words only (drawn as g.dir). Bar 3: p, dolce, then an f at the end.
  firstLine(score).measures[1]!.items.unshift({ kind: 'tempo', id: 't9', words: 'rit.' })
  firstLine(score).measures[2]!.items.push({ kind: 'dynamic', id: 'f9', mark: 'f' })
  firstLine(score).measures[2]!.items.splice(1, 0, { kind: 'dynamic', id: 'pp9', mark: 'pp' })
  const { map, selectable } = await drawnAndMapped(score)
  assert.deepEqual(selectable.filter((e) => !map.has(e)).length, 0)
  const inBar = (bar: number): string[] =>
    [...map.values()].filter((r) => (r.kind === 'dynamic' || r.kind === 'tempo' || r.kind === 'words') && describeElement(firstLine(score), r)?.bar === bar).map((r) => `${r.kind}:${'id' in r ? r.id : ''}`)
  assert.deepEqual(inBar(1), ['tempo:t9'])
  assert.deepEqual(inBar(2), ['dynamic:d3', 'dynamic:pp9', 'words:d4', 'dynamic:f9'])
})

test('elements: clef, key and time changes map to the change, also where a system starts and at the end of the system before', async () => {
  const score = fixture()
  // A clef change mid-line (bar 3), and a clef, key and time change at bar 4, which starts the second system at 360 px.
  setAttr(score, 2, 'clef', { sign: 'F', line: 4 })
  setAttr(score, 3, 'clef', { sign: 'G', line: 2 })
  setAttr(score, 3, 'key', { fifths: 3 })
  setAttr(score, 3, 'time', { beats: 3, beatType: 4 })
  // A slur from bar 3 into bar 4, over the system break.
  notesOf(firstLine(score).measures[2]!)[0]!.slurs.push({ type: 'start', number: 2 })
  notesOf(firstLine(score).measures[3]!)[2]!.slurs.push({ type: 'stop', number: 2 })
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

// ---------------------------------------------------------------- the marks of change more-marks (task 4.1)

const homrMarks = (): Score => parseMusicXml(read(HOMR_MARKS_FIXTURE))

/** The editor draws a multi-measure rest bar by bar (`expand`), and maps with the identity table. */
async function drawnExpanded(score: Score, width = 900) {
  const [svg] = await renderScore(score, { width, multiRests: 'expand' })
  const root = parseXml(svg!)
  const map = mapElements(root, xmlTree, firstLine(score))
  const groups = (cls: string): XmlElement[] => {
    const out: XmlElement[] = []
    const walk = (e: XmlElement): void => {
      if (e.name === 'g' && xmlTree.classes(e).includes(cls)) out.push(e)
      for (const c of e.children) walk(c)
    }
    walk(root)
    return out
  }
  return { map, groups, svg: svg! }
}

test('elements: every new mark of the homr fixture maps to the note it is drawn for, and none is left unmapped', async () => {
  const score = homrMarks()
  const { map, groups } = await drawnExpanded(score)
  const mark = (noteId: string, m: string): ElementRef => ({ kind: 'articulation', noteId, mark: m as never })
  const expected: ElementRef[] = [
    mark('n1', 'ornament'), // mordent, bar 1
    mark('n4', 'strongAccent'),
    mark('n5', 'staccatissimo'),
    mark('n6', 'ornament'), // trill
    mark('n7', 'ornament'), // turn
    mark('n8', 'ornament'), // trill
    mark('n9', 'tremolo'), // the pair of bar 3, on its first note
    mark('n11', 'tremolo'), // two single tremolos in bar 4
    mark('n13', 'tremolo'),
    mark('n15', 'arpeggio'),
    mark('n21', 'fermata'), // on the third note of a chord
    mark('n26', 'caesura'),
  ]
  const marks = [...map.values()].filter((r) => r.kind === 'articulation')
  assert.deepEqual([...new Set(marks.map(key))].sort(), [...new Set(expected.map(key))].sort())
  for (const ref of marks) assert.ok(describeElement(firstLine(score), ref), `${key(ref)} is in the score`)
  // Each ornament maps by its own kind.
  const kindOf = (cls: string): (string | undefined)[] => groups(cls).map((g) => (map.get(g)?.kind === 'articulation' ? describeElement(firstLine(score), map.get(g)!)?.ornament : undefined))
  assert.deepEqual([kindOf('trill'), kindOf('turn'), kindOf('mordent')], [['trill', 'trill'], ['turn'], ['mordent']])
  // Every drawn group of a new kind is mapped; a tremolo is mapped by its strokes (its notes stay notes).
  for (const cls of ['artic', 'trill', 'turn', 'mordent', 'arpeg', 'caesura', 'fermata']) {
    const missing = groups(cls).filter((g) => !map.has(g))
    assert.deepEqual(missing.map((g) => g.attrs.id), [], `${cls} groups are all mapped`)
  }
  for (const cls of ['bTrem', 'fTrem']) {
    const strokes = groups(cls).flatMap((g) => g.children.filter((c) => !xmlTree.classes(c).includes('note')))
    assert.ok(strokes.length > 0, `${cls} has strokes`)
    assert.ok(strokes.every((s) => map.get(s)), `${cls} strokes are mapped`)
    assert.ok(groups(cls).every((g) => !map.has(g)), `${cls} itself is not, so a tap on its notes still selects a note`)
  }
  assert.equal(groups('bTrem').length, 2)
  assert.equal(groups('fTrem').length, 1)
})

test('elements: a strong accent and a staccatissimo drawn below the note are told by their glyphs too', async () => {
  // A staccatissimo on a note with its stem up is drawn below it; a strong accent is below only when it says so.
  const note = (id: string, step: string, tail: string) =>
    `<note id="${id}"><pitch><step>${step}</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>quarter</type><notations>${tail}</notations></note>`
  const xml = `<?xml version="1.0"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name></part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>2</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
    ${note('lo1', 'C', '<articulations><strong-accent placement="below"/></articulations>')}${note('lo2', 'D', '<articulations><staccatissimo/></articulations>')}${note('hi1', 'A', '<articulations><strong-accent/></articulations>')}${note('hi2', 'B', '<articulations><staccatissimo/></articulations>')}</measure></part></score-partwise>`
  const score = parseMusicXml(xml)
  // Drawn straight from this MusicXML: the app never writes `placement`, so only Verovio's own choice would show below forms.
  const tk = await loadToolkit()
  tk.setOptions({ scale: 40, pageWidth: 3000, pageHeight: 60000, adjustPageHeight: true, header: 'none', footer: 'none' })
  assert.ok(tk.loadData(xml))
  const root = parseXml(tk.renderToSVG(1))
  const map = mapElements(root, xmlTree, firstLine(score))
  const arts: XmlElement[] = []
  const walk = (e: XmlElement): void => {
    if (xmlTree.classes(e).includes('artic')) arts.push(e)
    for (const c of e.children) walk(c)
  }
  walk(root)
  const glyphs = arts.map((g) => xmlTree.glyph(g))
  for (const g of ['E4AC', 'E4AD', 'E4A8', 'E4A9']) assert.ok(glyphs.includes(g), `${g} is drawn (${glyphs.join(',')})`)
  assert.deepEqual([...map.values()].filter((r) => r.kind === 'articulation').map(key).sort(), [
    key({ kind: 'articulation', noteId: 'hi1', mark: 'strongAccent' }),
    key({ kind: 'articulation', noteId: 'hi2', mark: 'staccatissimo' }),
    key({ kind: 'articulation', noteId: 'lo1', mark: 'strongAccent' }),
    key({ kind: 'articulation', noteId: 'lo2', mark: 'staccatissimo' }),
  ].sort())
})
