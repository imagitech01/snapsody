import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { SvgTree } from '../src/core/score/elements.ts'
import { lineOfBar, linesOf } from '../src/core/score/lines.ts'
import { drawnBars } from '../src/core/score/noteMap.ts'
import { parseMusicXml } from '../src/core/score/musicxml.ts'
import { renderScore } from '../src/core/score/render.ts'
import { parseXml } from '../src/core/score/xml.ts'
import type { XmlElement } from '../src/core/score/xml.ts'
import { PRACTICE_EXERCISE } from './fixtures/make-practice-exercise.ts'
import { HOMR_MARKS_FIXTURE, MELODY_PIANO_FIXTURE, read } from './helpers.ts'
import { noteIndex } from '../src/core/score/model.ts'
import { firstLine } from './helpers.ts'

// The lines of a drawn score (change simplify-editor-and-name-new-pieces, task 2.1).

const xmlTree: Pick<SvgTree<XmlElement>, 'classes' | 'children'> = {
  classes: (n) => (n.attrs.class ?? '').split(/\s+/).filter(Boolean),
  children: (n) => n.children,
}

test('lines: on the practice exercise at 360px every bar is in exactly one line, the lines run in order, and there is one per system drawn', async () => {
  const score = parseMusicXml(read(PRACTICE_EXERCISE))
  const [svg, ...more] = await renderScore(score, { width: 360 })
  assert.equal(more.length, 0)
  const lines = linesOf(parseXml(svg!), xmlTree)

  assert.equal(lines.length, (svg!.match(/class="system"/g) ?? []).length, 'one line per system')
  assert.ok(lines.length > 1, `the 19 bars take more than one line at 360px (${lines.length})`)
  assert.equal(lines[0]!.firstBar, 0)
  assert.equal(lines.at(-1)!.lastBar, firstLine(score).measures.length - 1)
  for (const [index, line] of lines.entries()) {
    assert.ok(line.firstBar <= line.lastBar, `line ${index} holds a bar`)
    if (index > 0) assert.equal(line.firstBar, lines[index - 1]!.lastBar + 1, `line ${index} starts after the one before`)
  }
  for (let bar = 0; bar < firstLine(score).measures.length; bar++) {
    assert.equal(lines.filter((line) => line.firstBar <= bar && bar <= line.lastBar).length, 1, `bar ${bar + 1} is in exactly one line`)
  }
  assert.equal(lineOfBar(lines, 0), 0)
  assert.equal(lineOfBar(lines, firstLine(score).measures.length - 1), lines.length - 1)
  assert.equal(lineOfBar(lines, firstLine(score).measures.length), -1)
})

test('lines: a wider page holds more bars in a line', async () => {
  const score = parseMusicXml(read(PRACTICE_EXERCISE))
  const count = async (width: number) => linesOf(parseXml((await renderScore(score, { width }))[0]!), xmlTree).length
  assert.ok((await count(1200)) < (await count(360)))
})

test('lines: a system without bars is left out, and several pages count on', () => {
  const node = (cls: string, ...children: XmlElement[]): XmlElement => ({ name: 'g', attrs: { class: cls }, children, text: '' })
  const page = (bars: number[]) => node('page', ...bars.map((n) => node('system', ...Array.from({ length: n }, () => node('measure')))))
  const root = node('root', page([2, 0, 3]), page([1]))
  assert.deepEqual(linesOf(root, xmlTree), [
    { firstBar: 0, lastBar: 1 },
    { firstBar: 2, lastBar: 4 },
    { firstBar: 5, lastBar: 5 },
  ])
})

// A collapsed multi-measure rest is one drawn measure for several bars (change more-marks, task 2.2).

test('lines: a collapsed run counts for all its bars, so the bar after it is on the right line', async () => {
  const score = parseMusicXml(read(HOMR_MARKS_FIXTURE))
  const [svg] = await renderScore(score, { width: 360, multiRests: 'collapse' })
  const root = parseXml(svg!)
  const bars = drawnBars(firstLine(score), 'collapse')
  const lines = linesOf(root, xmlTree, bars)
  assert.equal(lines[0]!.firstBar, 0)
  assert.equal(lines.at(-1)!.lastBar, 11, 'the 12 bars, though 9 measures are drawn')
  for (const [index, line] of lines.entries()) if (index > 0) assert.equal(line.firstBar, lines[index - 1]!.lastBar + 1)
  const runLine = lineOfBar(lines, 7)
  for (const bar of [8, 9, 10]) assert.equal(lineOfBar(lines, bar), runLine, `bar ${bar + 1} is on the line of the symbol`)
  // The same drawing counted without the table reads 9 bars: the bar after the run would be taken for bar 9.
  assert.equal(linesOf(root, xmlTree).at(-1)!.lastBar, 8)
  // Expanded: the identity.
  const [expanded] = await renderScore(score, { width: 360, multiRests: 'expand' })
  assert.equal(linesOf(parseXml(expanded!), xmlTree, drawnBars(firstLine(score), 'expand')).at(-1)!.lastBar, 11)
})

test('lines: a synthetic drawing with a measure that holds three bars', () => {
  const node = (cls: string, ...children: XmlElement[]): XmlElement => ({ name: 'g', attrs: { class: cls }, children, text: '' })
  const root = node('root', node('system', node('measure'), node('measure')), node('system', node('measure')))
  const bars = { barsOf: [{ first: 0, count: 1 }, { first: 1, count: 3 }, { first: 4, count: 1 }] }
  assert.deepEqual(linesOf(root, xmlTree, bars), [
    { firstBar: 0, lastBar: 3 },
    { firstBar: 4, lastBar: 4 },
  ])
})

test('lines: on the piano part, the line of a left-hand note holds both staves (change edit-parts, spec "One line while editing")', async () => {
  const score = parseMusicXml(read(MELODY_PIANO_FIXTURE))
  const [svg] = await renderScore(score, { width: 360, parts: ['P2'], multiRests: 'expand' })
  const root = parseXml(svg!)
  const lines = linesOf(root, xmlTree)
  // C3 of the left hand, in bar 3: its line is the system that draws bar 3.
  const bar = noteIndex(score).get('n43')!.barIndex
  const line = lineOfBar(lines, bar)
  assert.ok(line >= 0)
  const systems: XmlElement[] = []
  const walk = (e: XmlElement): void => {
    if (xmlTree.classes(e).includes('system')) systems.push(e)
    else for (const c of e.children) walk(c)
  }
  walk(root)
  const system = systems[line]!
  const measures = system.children.filter((c) => xmlTree.classes(c).includes('measure'))
  assert.equal(measures.length, lines[line]!.lastBar - lines[line]!.firstBar + 1)
  for (const m of measures) assert.equal(m.children.filter((c) => xmlTree.classes(c).includes('staff')).length, 2, 'right hand and left hand')
  // And the left hand's note is drawn in that line.
  const ids: string[] = []
  const collect = (e: XmlElement): void => {
    if (e.attrs.id) ids.push(e.attrs.id)
    for (const c of e.children) collect(c)
  }
  collect(system)
  assert.ok(ids.includes('n43'))
})
