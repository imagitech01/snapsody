import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as ed from '../src/core/score/edit.ts'
import type { Score } from '../src/core/score/model.ts'
import { drawnBars, indexScore, renderedNoteIds, unmappedNotes } from '../src/core/score/noteMap.ts'
import { voiceView, voices } from '../src/core/score/model.ts'
import { parseMusicXml, serializeMusicXml } from '../src/core/score/musicxml.ts'
import { renderScore } from '../src/core/score/render.ts'
import { COMMITTED_FIXTURE, HOMR_MARKS_FIXTURE, LOCAL_EXERCISE_87, MELODY_PIANO_FIXTURE, read, skipUnless } from './helpers.ts'
import { n, scoreOf } from './playbackHelpers.ts'
import { firstLine, setAttr } from './helpers.ts'

async function checkRender(xml: string) {
  const score = parseMusicXml(xml)
  const [svg, ...more] = await renderScore(score, { width: 360 })
  assert.ok(svg)
  assert.equal(more.length, 0, 'one page, scrolled vertically')
  const index = indexScore(firstLine(score))
  return { score, svg, index }
}

test('render: every model note and rest of the fixture has a rendered element with its id', async () => {
  const { svg, index } = await checkRender(read(COMMITTED_FIXTURE))
  assert.ok(index.size > 10)
  assert.deepEqual(unmappedNotes(svg, index), [])
  // The note ids are the SVG ids, in score order, and nothing else is drawn as a note.
  assert.deepEqual(renderedNoteIds(svg), [...index.keys()])
  assert.equal(index.get('a1')?.bar, '1', 'the id given in the XML survives')
})

test('render: the fixture shows clef, key, metre, tuplet, slur and staccato', async () => {
  const { svg } = await checkRender(read(COMMITTED_FIXTURE))
  for (const cls of ['clef', 'keySig', 'meterSig', 'tuplet', 'slur', 'artic']) {
    assert.match(svg, new RegExp(`class="${cls}[" ]`), `${cls} is drawn`)
  }
  assert.match(svg, /<svg[^>]*viewBox=/)
})

test('render: a narrower page makes more systems, not wider ones', async () => {
  const score = parseMusicXml(read(COMMITTED_FIXTURE))
  const count = (svg: string | undefined) => (svg?.match(/class="system"/g) ?? []).length
  const [wide] = await renderScore(score, { width: 1200 })
  const [narrow] = await renderScore(score, { width: 300 })
  assert.ok(count(narrow) > count(wide), `${count(narrow)} systems at 300px vs ${count(wide)} at 1200px`)
})

test('render: exercise 87 (local) maps all notes and shows 3/4, G major, triplets, slurs, staccato', { skip: skipUnless(LOCAL_EXERCISE_87) }, async () => {
  const { svg, index } = await checkRender(read(LOCAL_EXERCISE_87))
  assert.deepEqual(unmappedNotes(svg, index), [])
  for (const cls of ['clef', 'keySig', 'meterSig', 'tuplet', 'slur', 'artic']) assert.match(svg, new RegExp(`class="${cls}[" ]`))
})

// --- tenuto, accent, fermata and hairpins (practice-app task 4.3) ---
//
// Verovio 6.4 draws them as groups of these classes, each holding a SMuFL glyph (`<use xlink:href="#E4A4-…">`):
//   tenuto   <g class="artic">     E4A4 (above) / E4A5 (below)
//   accent   <g class="artic">     E4A0 / E4A1       (staccato is an `artic` too: E4A2 / E4A3)
//   fermata  <g class="fermata">   E4C0 / E4C1
//   hairpin  <g class="hairpin">   a <polyline> of three points: the apex first on a crescendo's left, a diminuendo's right
// Tenuto, accent and staccato share a class, so they are told apart by their glyph.

const TENUTO = /^E4A[45]$/
const ACCENT = /^E4A[01]$/
const STACCATO = /^E4A[23]$/
const FERMATA = /^E4C[01]$/

/** The glyph codes (like "E4A4") drawn inside the groups of one class, in document order. */
function glyphsOf(svg: string, cls: string): string[] {
  return [...svg.matchAll(new RegExp(`<g [^>]*class="${cls}">\\s*<use xlink:href="#([0-9A-F]{4})-`, 'g'))].map((m) => m[1]!)
}

/** The shape of each hairpin: 'crescendo' when the polyline's apex (its middle point) is left of its ends. */
function hairpinShapes(svg: string): string[] {
  return [...svg.matchAll(/<g [^>]*class="hairpin">\s*<polyline[^>]* points="([^"]*)"/g)].map((m) => {
    const [first, apex] = m[1]!.trim().split(/\s+/).map((p) => Number(p.split(',')[0]))
    return apex! < first! ? 'crescendo' : 'diminuendo'
  })
}

/** Two bars of four notes, high and low (so stems go both ways): ids a-d and e-h. */
const twoBars = (): Score =>
  scoreOf([
    { body: n({ id: 'a', step: 'D', octave: 4 }) + n({ id: 'b', step: 'A', octave: 5 }) + n({ id: 'c', step: 'E', octave: 4 }) + n({ id: 'd', step: 'G', octave: 5 }) },
    { body: n({ id: 'e', step: 'F', octave: 4 }) + n({ id: 'f', step: 'B', octave: 5 }) + n({ id: 'g', step: 'G', octave: 4 }) + n({ id: 'h', step: 'C', octave: 5 }) },
  ])

test('render: tenuto, accent, fermata and a crescendo and diminuendo made with the editing operations are drawn', async () => {
  const score = twoBars()
  ed.toggleTenuto(firstLine(score), 'a')
  ed.toggleTenuto(firstLine(score), 'f')
  ed.toggleAccent(firstLine(score), 'b')
  ed.toggleFermata(firstLine(score), 'c')
  ed.addWedge(firstLine(score), 'crescendo', 'a', 'd')
  ed.addWedge(firstLine(score), 'diminuendo', 'e', 'h')
  const [svg] = await renderScore(score, { width: 900 })
  assert.ok(svg)
  assert.deepEqual(glyphsOf(svg, 'artic').filter((g) => TENUTO.test(g)).length, 2, 'two tenuto marks')
  assert.deepEqual(glyphsOf(svg, 'artic').filter((g) => ACCENT.test(g)).length, 1, 'one accent')
  assert.equal(glyphsOf(svg, 'artic').length, 3, 'and no other articulation')
  assert.equal(glyphsOf(svg, 'fermata').filter((g) => FERMATA.test(g)).length, 1, 'one fermata')
  assert.deepEqual(hairpinShapes(svg), ['crescendo', 'diminuendo'])
  // The marks add no note: every model note is still drawn, in order, and nothing else is taken for one.
  const index = indexScore(firstLine(score))
  assert.deepEqual(unmappedNotes(svg, index), [])
  assert.deepEqual(renderedNoteIds(svg), [...index.keys()])
})

test('render: the same score without the marks draws none of them (staccato is an artic too, and stays apart)', async () => {
  const score = twoBars()
  ed.toggleStaccato(firstLine(score), 'a')
  const [svg] = await renderScore(score, { width: 900 })
  assert.ok(svg)
  assert.deepEqual(glyphsOf(svg, 'artic').filter((g) => STACCATO.test(g)).length, 1, 'the staccato is drawn')
  assert.equal(glyphsOf(svg, 'artic').filter((g) => TENUTO.test(g) || ACCENT.test(g)).length, 0, 'but no tenuto or accent')
  assert.equal(glyphsOf(svg, 'fermata').length, 0)
  assert.deepEqual(hairpinShapes(svg), [])
  assert.ok(!/class="hairpin"|class="fermata"/.test(svg), 'not even the classes')
})

test('render: a hairpin over a barline and a fermata on a rest are drawn', async () => {
  const score = twoBars()
  ed.noteToRest(firstLine(score), 'd')
  ed.toggleFermata(firstLine(score), 'd')
  ed.addWedge(firstLine(score), 'crescendo', 'c', 'f')
  const [svg] = await renderScore(score, { width: 900 })
  assert.deepEqual(hairpinShapes(svg!), ['crescendo'])
  assert.equal(glyphsOf(svg!, 'fermata').filter((g) => FERMATA.test(g)).length, 1)
  assert.deepEqual(unmappedNotes(svg!, indexScore(firstLine(score))), [])
})

test('render: the committed fixture shows its tenuto, accent, fermata and hairpins', async () => {
  const { svg } = await checkRender(read(COMMITTED_FIXTURE))
  const artic = glyphsOf(svg, 'artic')
  assert.equal(artic.filter((g) => TENUTO.test(g)).length, 1, 'tenuto')
  assert.equal(artic.filter((g) => ACCENT.test(g)).length, 1, 'accent')
  assert.equal(glyphsOf(svg, 'fermata').filter((g) => FERMATA.test(g)).length, 1, 'fermata')
  const shapes = hairpinShapes(svg)
  assert.ok(shapes.includes('crescendo') && shapes.includes('diminuendo'), `both hairpins (${shapes.join(', ')})`)
})

// --- drawing ids (change select-and-delete-elements, task 1.3, design D2) ---

test('render: clef changes, slurs, ties and hairpins are drawn with drawing ids, which the stored MusicXML never has', async () => {
  const score = parseMusicXml(read(COMMITTED_FIXTURE))
  setAttr(score, 2, 'clef', { sign: 'F', line: 4 })
  const [svg] = await renderScore(score, { width: 360 })
  const drawn = (cls: string, id: string): boolean => new RegExp(`<g[^>]*\\bid="${id}"[^>]*class="${cls}"|<g[^>]*class="${cls}"[^>]*\\bid="${id}"`).test(svg!)
  assert.ok(drawn('clef', 'clef-2'), 'the clef change at bar 3 (index 2)')
  assert.ok(drawn('slur', 'slur-n1-1'), 'the slur that starts on n1')
  assert.ok(drawn('tie', 'tie-n7'), 'the tie that starts on n7')
  assert.ok(drawn('hairpin', 'wedge-a1') && drawn('hairpin', 'wedge-n4'), 'the crescendo and the diminuendo, by their first note')
  const stored = serializeMusicXml(score)
  assert.ok(!/id="(clef|slur|tie|wedge)-/.test(stored), 'the stored score has no drawing ids')
  assert.match(serializeMusicXml(score, { drawingIds: true }), /<clef id="clef-2">/)
})

// ---- The marks of homr and the multi-measure rest (change more-marks, tasks 2.1 and 2.2) ----------------------

const count = (svg: string, cls: string): number => (svg.match(new RegExp(`<g\\b[^>]*class="${cls}[" ]`, 'g')) ?? []).length

test('render: practice draws the run of the marks fixture as one g.multiRest, the editor one g.measure per bar', async () => {
  const score = parseMusicXml(read(HOMR_MARKS_FIXTURE))
  const [practice] = await renderScore(score, { width: 360, multiRests: 'collapse' })
  const [editor] = await renderScore(score, { width: 360, multiRests: 'expand' })
  assert.equal(count(practice!, 'multiRest'), 1)
  assert.equal(count(editor!, 'multiRest'), 0)
  assert.equal(count(editor!, 'measure'), 12, 'one drawn measure per bar')
  assert.equal(count(practice!, 'measure'), 9, 'bars 8 to 11 are one drawn measure: 12 - 3')
  assert.equal(count(practice!, 'multiRest'), 1)
  const [default_] = await renderScore(score, { width: 360 })
  assert.equal(count(default_!, 'multiRest'), 1, 'collapse is the default')
})

test('render: every mark of the fixture is drawn, collapsed or not', async () => {
  const score = parseMusicXml(read(HOMR_MARKS_FIXTURE))
  for (const multiRests of ['collapse', 'expand'] as const) {
    const [svg] = await renderScore(score, { width: 360, multiRests })
    for (const cls of ['mordent', 'turn', 'trill', 'arpeg', 'caesura', 'bTrem', 'fTrem']) assert.ok(count(svg!, cls) > 0, `${cls} is drawn (${multiRests})`)
    const glyphs = [...svg!.matchAll(/class="artic"[^>]*>\s*<use [^>]*href="#(\w+)-/g)].map((m) => m[1]!)
    assert.ok(glyphs.some((g) => /^E4A[CD]$/.test(g)), `a strong accent (marcato) is drawn (${multiRests}): ${glyphs}`)
    assert.ok(glyphs.some((g) => /^E4A[89]$/.test(g)), `a staccatissimo is drawn (${multiRests}): ${glyphs}`)
  }
})

test('render: a collapsed run maps its four rests to its one g.multiRest, and none of them is reported unmapped', async () => {
  const score = parseMusicXml(read(HOMR_MARKS_FIXTURE))
  const index = indexScore(firstLine(score))
  const restIds = [...index].filter(([, info]) => info.barIndex >= 7 && info.barIndex <= 10).map(([id]) => id)
  assert.equal(restIds.length, 4)
  const [practice] = await renderScore(score, { width: 360, multiRests: 'collapse' })
  // Verovio keeps none of the model ids on the symbol: the table is what resolves them.
  for (const id of restIds) assert.ok(!practice!.includes(`id="${id}"`), `${id} is not in the drawing`)
  assert.deepEqual(unmappedNotes(practice!, index, drawnBars(firstLine(score), 'collapse')), [])
  assert.deepEqual(unmappedNotes(practice!, index), restIds, 'without the table the rests are reported')
  const [editor] = await renderScore(score, { width: 360, multiRests: 'expand' })
  assert.deepEqual(unmappedNotes(editor!, index, drawnBars(firstLine(score), 'expand')), [])
})

test('drawn bars: the table sends each bar to its drawn measure; a collapsed run is one measure, expanding is the identity', () => {
  const score = parseMusicXml(read(HOMR_MARKS_FIXTURE))
  const collapsed = drawnBars(firstLine(score), 'collapse')
  assert.deepEqual(collapsed.measureOf, [0, 1, 2, 3, 4, 5, 6, 7, 7, 7, 7, 8])
  assert.deepEqual(collapsed.barsOf[7], { first: 7, count: 4 })
  assert.equal(collapsed.barsOf.length, 9)
  assert.deepEqual(collapsed.runOf(9), { start: 7, length: 4 })
  assert.equal(collapsed.runOf(11), undefined)
  const expanded = drawnBars(firstLine(score), 'expand')
  assert.deepEqual(expanded.measureOf, Array.from({ length: 12 }, (_, i) => i))
  assert.equal(expanded.runOf(8), undefined)
})

// ---- Practice draws your part only (change parts-and-accompaniment, task 6.2, design D7) ----------------------

test('render (practice): with your part P2 the piano is drawn as a grand staff, two staves in each measure, and no melody note', async () => {
  const score = parseMusicXml(read(MELODY_PIANO_FIXTURE))
  const [svg, ...more] = await renderScore(score, { width: 360, parts: ['P2'] })
  assert.ok(svg)
  assert.equal(more.length, 0)
  const measures = svg.match(/class="measure"/g)?.length ?? 0
  const staves = svg.match(/class="staff"/g)?.length ?? 0
  assert.ok(measures > 0)
  assert.equal(staves, measures * 2, 'a grand staff: two staves in every measure')
  assert.match(svg, /class="grpSym"/, 'joined by a brace')

  const idsOf = (part: string): string[] => voices(score).filter((r) => r.part === part).flatMap((r) => [...indexScore(voiceView(score, r)).keys()])
  const drawn = new Set(renderedNoteIds(svg))
  assert.ok(idsOf('P1').length > 0 && idsOf('P2').length > 0)
  for (const id of idsOf('P1')) assert.ok(!drawn.has(id), `the melody note ${id} is not drawn`)
  for (const id of idsOf('P2')) assert.ok(drawn.has(id), `the piano note ${id} is drawn`)

  // The melody alone is one staff in each measure, and none of the piano.
  const [melody] = await renderScore(score, { width: 360, parts: ['P1'] })
  assert.equal(melody!.match(/class="staff"/g)?.length, melody!.match(/class="measure"/g)?.length)
  for (const id of idsOf('P2')) assert.ok(!renderedNoteIds(melody!).includes(id))
})
