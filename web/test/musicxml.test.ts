import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Measure, MeasureItem, Note, Score } from '../src/core/score/model.ts'
import { allItemLists, isDirection, isNote, isWedge, notesOf } from '../src/core/score/model.ts'
import { beamScore } from '../src/core/score/beams.ts'
import { parseMusicXml, serializeMusicXml } from '../src/core/score/musicxml.ts'
import { eq, frac } from '../src/core/score/rational.ts'
import { barLength } from '../src/core/score/repairs.ts'
import { multiRestHolds, multiRestRuns } from '../src/core/score/model.ts'
import { COMMITTED_FIXTURE, HOMR_MARKS_FIXTURE, LOCAL_HOMR_PIANO_PAGE, LOCAL_PAGE, MELODY_PIANO_FIXTURE, read, skipUnless } from './helpers.ts'
import { firstLine, setAttr } from './helpers.ts'

function measure(m: Measure[], i: number): Measure {
  const x = m[i]
  assert.ok(x, `measure ${i + 1} exists`)
  return x
}
function nth(m: Measure, i: number): Note {
  const n = notesOf(m)[i]
  assert.ok(n, `note ${i} exists in measure ${m.number}`)
  return n
}

test('musicxml: the committed fixture parses with every supported element', () => {
  const warnings: string[] = []
  const score = parseMusicXml(read(COMMITTED_FIXTURE), warnings)
  assert.deepEqual(warnings, [])
  assert.equal(score.title, 'Test & Étude ♯')
  assert.equal(firstLine(score).partName, 'Tenor Saxophone')
  assert.equal(firstLine(score).measures.length, 6)
  const [m1, m2, m3, m4, m5, m6] = firstLine(score).measures.map((_, i) => measure(firstLine(score).measures, i)) as [Measure, Measure, Measure, Measure, Measure, Measure]

  // clef / key / time, barlines and repeats
  assert.deepEqual(m1.clef, { sign: 'G', line: 2 })
  assert.deepEqual(m1.key, { fifths: -2, mode: 'major' })
  assert.deepEqual(m1.time, { beats: 3, beatType: 4, symbol: 'common' })
  assert.deepEqual(m1.leftBarline, { style: 'heavy-light', repeat: 'forward' })
  assert.deepEqual(m4.rightBarline, { style: 'light-heavy', ending: { number: '1', type: 'stop' }, repeat: 'backward', times: 2 })
  assert.deepEqual(m4.leftBarline, { ending: { number: '1', type: 'start' } })
  assert.deepEqual(m5.leftBarline, { ending: { number: '2', type: 'start' } })
  assert.deepEqual(m5.rightBarline, { style: 'light-light', ending: { number: '2', type: 'discontinue' } })
  assert.equal(m5.newSystem, true)
  assert.deepEqual(m6.time, { beats: 2, beatType: 4 })
  assert.deepEqual(m6.key, { fifths: 0 })

  // tempo (words + metronome + sound), dynamics, other words
  const tempo = m1.items.find((i) => i.kind === 'tempo')
  assert.deepEqual(tempo, { kind: 'tempo', id: 'd1', words: 'Moderato', beatUnit: 'quarter', perMinute: 96, soundTempo: 96 })
  assert.deepEqual(m1.items.filter((i) => i.kind === 'dynamic'), [{ kind: 'dynamic', id: 'd2', mark: 'mf' }])
  assert.deepEqual(m3.items.filter((i) => i.kind === 'dynamic'), [{ kind: 'dynamic', id: 'd3', mark: 'p' }])
  assert.deepEqual(m3.items.filter((i) => i.kind === 'words'), [{ kind: 'words', id: 'd4', text: 'dolce' }])

  // pitch, accidentals, staccato, ids
  const bb = nth(m1, 0)
  assert.deepEqual(bb.pitch, { step: 'B', alter: -1, octave: 4 })
  assert.equal(bb.accidental, 'flat')
  assert.equal(bb.staccato, true)
  assert.equal(bb.id, 'a1')
  assert.deepEqual(nth(m1, 3).pitch, { step: 'E', alter: 1, octave: 5 })
  const ids = firstLine(score).measures.flatMap((m) => notesOf(m).map((n) => n.id))
  assert.equal(new Set(ids).size, ids.length, 'ids are unique')

  // slurs
  assert.deepEqual(nth(m1, 1).slurs, [{ type: 'start', number: 1 }])
  assert.deepEqual(nth(m1, 2).slurs, [{ type: 'stop', number: 1 }])

  // triplet
  const t0 = nth(m2, 0)
  assert.deepEqual(t0.timeMod, { actual: 3, normal: 2 })
  assert.ok(eq(t0.duration, frac(1, 12)))
  assert.deepEqual(t0.tuplets, [{ type: 'start', number: 1 }])
  assert.deepEqual(nth(m2, 2).tuplets, [{ type: 'stop', number: 1 }])
  assert.equal(nth(m2, 1).staccato, true)

  // ties, breath, dotted, rests
  assert.equal(nth(m2, 3).tieStart, true)
  assert.equal(nth(m2, 3).breath, true)
  assert.equal(nth(m3, 0).tieStop, true)
  assert.equal(nth(m3, 0).dots, 1)
  assert.ok(eq(nth(m3, 0).duration, frac(3, 4)))
  assert.equal(nth(m4, 0).rest, true)
  assert.equal(nth(m4, 0).pitch, undefined)
  assert.equal(nth(m5, 0).measureRest, true)
  assert.ok(eq(nth(m5, 0).duration, frac(3, 4)))

  // every bar adds up to its time signature
  assert.ok(eq(barLength(m1), frac(3, 4)))
  assert.ok(eq(barLength(m2), frac(3, 4)))
  assert.ok(eq(barLength(m3), frac(3, 4)))
  assert.ok(eq(barLength(m4), frac(3, 4)))
  assert.ok(eq(barLength(m5), frac(3, 4)))
  assert.ok(eq(barLength(m6), frac(1, 2)))
})

test('musicxml: MusicXML -> model -> MusicXML -> model gives an equal model (committed fixture)', () => {
  const first = parseMusicXml(read(COMMITTED_FIXTURE))
  const xml = serializeMusicXml(first)
  const second = parseMusicXml(xml)
  assert.deepEqual(second, first)
  // and it is a fixed point after one round
  assert.equal(serializeMusicXml(second), xml)
})

test('musicxml: serialised output uses one divisions value that fits every duration', () => {
  const xml = serializeMusicXml(parseMusicXml(read(COMMITTED_FIXTURE)))
  assert.equal((xml.match(/<divisions>/g) ?? []).length, 1)
  assert.match(xml, /<divisions>6<\/divisions>/)
  assert.match(xml, /<note id="a1">/)
})

test('musicxml: input outside the model does not crash and is reported', () => {
  const warnings: string[] = []
  const xml = `<score-partwise><part-list><score-part id="P1"/><score-part id="P2"/></part-list>
    <part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>half</type></note>
      <note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>half</type></note>
      <backup><duration>2</duration></backup>
      <note><pitch><step>G</step><octave>3</octave></pitch><duration>2</duration><voice>2</voice><type>half</type></note>
      <note><chord/><pitch><step>B</step><octave>3</octave></pitch><duration>2</duration><voice>2</voice><type>half</type></note>
    </measure></part><part id="P2"><measure number="1"/></part></score-partwise>`
  const score = parseMusicXml(xml, warnings)
  assert.equal(notesOf(measure(firstLine(score).measures, 0)).length, 2)
  // Every part and voice is read now (change parts-and-accompaniment): nothing is dropped, so no warning says so.
  assert.ok(!warnings.some((w) => /first of 2 parts/.test(w)))
  assert.ok(!warnings.some((w) => /other voices/.test(w)))
  assert.equal(score.parts.length, 2)
  assert.deepEqual(score.bars[0]!.parts[0]!.staves[0]!.voices.map((v) => v.filter(isNote).length), [2, 2], 'the second voice is kept')
  assert.throws(() => parseMusicXml('<score-timewise/>'), /Timewise/)
  assert.throws(() => parseMusicXml('<html/>'), /Not MusicXML/)
  assert.ok(measure(firstLine(score).measures, 0).items.every((i) => !isNote(i) || i.duration.n > 0))
})

test('musicxml: full page round-trips (local fixture)', { skip: skipUnless(LOCAL_PAGE) }, () => {
  const warnings: string[] = []
  const first = parseMusicXml(read(LOCAL_PAGE), warnings)
  assert.equal(firstLine(first).measures.length, 32)
  const second = parseMusicXml(serializeMusicXml(first))
  assert.deepEqual(second, first)
  // content is preserved: same counts of every kind of mark
  const count = (s: typeof first, f: (n: Note) => boolean): number =>
    firstLine(s).measures.reduce((a, m) => a + notesOf(m).filter(f).length, 0)
  assert.equal(count(first, (n) => n.slurs.length > 0), count(second, (n) => n.slurs.length > 0))
  assert.ok(count(first, (n) => n.breath === true) === 2)
  assert.ok(count(first, (n) => n.staccato === true) > 0)
  assert.ok(firstLine(first).measures.some((m) => m.rightBarline?.repeat === 'backward'))
  console.log(`page.musicxml parse warnings: ${warnings.length === 0 ? 'none' : warnings.join(' | ')}`)
})

// --- tenuto, accent, fermata and hairpins (practice-app task 4.1) ---

/** A part of 4/4 bars (divisions 1: a quarter is 1) from raw measure bodies. */
const bars = (...bodies: string[]): string =>
  `<?xml version="1.0"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name/></score-part></part-list><part id="P1">` +
  bodies
    .map((b, i) => `<measure number="${i + 1}">${i === 0 ? '<attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes>' : ''}${b}</measure>`)
    .join('') +
  `</part></score-partwise>`
const q = (id: string, notations = '', step = 'C'): string =>
  `<note id="${id}"><pitch><step>${step}</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff>${notations ? `<notations>${notations}</notations>` : ''}</note>`
const wedge = (type: string, number = 1): string => `<direction placement="below"><direction-type><wedge type="${type}" number="${number}"/></direction-type></direction>`
const dynamic = (mark: string): string => `<direction placement="below"><direction-type><dynamics><${mark}/></dynamics></direction-type></direction>`
const wedgesOf = (s: ReturnType<typeof parseMusicXml>): [string, string, string][] =>
  firstLine(s).measures.flatMap((m) => m.items.filter(isWedge).map((w): [string, string, string] => [w.type, w.start, w.stop]))

function roundTrips(xml: string): ReturnType<typeof parseMusicXml> {
  const first = parseMusicXml(xml)
  const written = serializeMusicXml(first)
  const second = parseMusicXml(written)
  assert.deepEqual(second, first, 'MusicXML -> model -> MusicXML -> model gives an equal model')
  assert.equal(serializeMusicXml(second), written, 'and the XML is a fixed point after one round')
  return first
}

test('musicxml: tenuto, accent and fermata are read, written and kept on every round', () => {
  const xml = bars(
    q('a', '<articulations><tenuto/></articulations>') +
      q('b', '<articulations><accent/></articulations>', 'D') +
      q('c', '<fermata/>', 'E') +
      q('d', '<articulations><staccato/><tenuto/><accent/></articulations><fermata/>', 'F'),
  )
  const s = roundTrips(xml)
  const [a, b, c, d] = notesOf(measure(firstLine(s).measures, 0))
  assert.deepEqual([a!.tenuto, a!.accent, a!.fermata, a!.staccato], [true, undefined, undefined, undefined])
  assert.deepEqual([b!.tenuto, b!.accent, b!.fermata], [undefined, true, undefined])
  assert.deepEqual([c!.tenuto, c!.accent, c!.fermata], [undefined, undefined, true])
  assert.deepEqual([d!.staccato, d!.tenuto, d!.accent, d!.fermata], [true, true, true, true])
  const written = serializeMusicXml(s)
  assert.match(written, /<articulations>\s*<tenuto\/>\s*<\/articulations>/)
  assert.match(written, /<accent\/>/)
  assert.match(written, /<fermata\/>/)
})

test('musicxml: a fermata can sit on a rest', () => {
  const rest = '<note id="r"><rest/><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff><notations><fermata/></notations></note>'
  const s = roundTrips(bars(q('a') + rest + q('b') + q('c')))
  assert.equal(notesOf(measure(firstLine(s).measures, 0))[1]!.fermata, true)
})

test('musicxml: a crescendo and a diminuendo are read as hairpins between notes, and round-trip', () => {
  const xml = bars(
    wedge('crescendo') + q('a') + q('b') + wedge('stop') + wedge('diminuendo') + q('c') + q('d') + wedge('stop'),
  )
  const s = roundTrips(xml)
  assert.deepEqual(wedgesOf(s), [['crescendo', 'a', 'b'], ['diminuendo', 'c', 'd']])
  // Each hairpin is kept in the measure of its first note, right before that note.
  assert.deepEqual(measure(firstLine(s).measures, 0).items.map((i) => (isWedge(i) ? `${i.type}:${i.start}` : (i as Note).id)), ['crescendo:a', 'a', 'b', 'diminuendo:c', 'c', 'd'])
  // Written back as a start before the first note and a stop after the last one.
  const written = serializeMusicXml(s)
  assert.deepEqual([...written.matchAll(/<wedge type="(\w+)" number="(\d+)"\/>/g)].map((m) => `${m[1]}${m[2]}`), ['crescendo1', 'stop1', 'diminuendo1', 'stop1'])
})

test('musicxml: a hairpin over a barline, the stop written at the start of the next bar, lands on the last note before it', () => {
  const xml = bars(dynamic('p') + wedge('crescendo') + q('a') + q('b') + q('c') + q('d'), wedge('stop') + dynamic('f') + q('e') + q('f') + q('g') + q('h'))
  const s = roundTrips(xml)
  assert.deepEqual(wedgesOf(s), [['crescendo', 'a', 'd']])
  // The stop is written at the end of the bar of its last note, before the dynamic that follows.
  const written = serializeMusicXml(s)
  assert.ok(written.indexOf('type="stop"') < written.indexOf('<f/>'), 'stop before f')
  assert.ok(written.indexOf('type="stop"') < written.indexOf('<measure number="2">'), 'stop in bar 1')
})

test('musicxml: a hairpin that starts at the end of a bar starts on the first note of the next bar', () => {
  const s = roundTrips(bars(q('a') + q('b') + q('c') + q('d') + wedge('diminuendo'), q('e') + q('f') + q('g') + q('h') + wedge('stop')))
  assert.deepEqual(wedgesOf(s), [['diminuendo', 'e', 'h']])
  assert.equal(measure(firstLine(s).measures, 0).items.some(isWedge), false)
  assert.equal(isWedge(measure(firstLine(s).measures, 1).items[0]!), true)
})

test('musicxml: a dynamic next to the start of a hairpin, and a hairpin over one note, survive', () => {
  // The dynamic is written between the start direction and the note; the model puts the hairpin right before the note.
  const s = roundTrips(bars(wedge('crescendo') + dynamic('mp') + q('a') + q('b') + wedge('stop') + wedge('diminuendo') + q('c') + wedge('stop') + q('d')))
  assert.deepEqual(wedgesOf(s), [['crescendo', 'a', 'b'], ['diminuendo', 'c', 'c']])
  assert.deepEqual(measure(firstLine(s).measures, 0).items.filter((i) => i.kind === 'dynamic'), [{ kind: 'dynamic', id: 'd1', mark: 'mp' }])
})

test('musicxml: a hairpin stop after a chord lands on the chord\'s first note, not its members', () => {
  const member = '<note id="m"><chord/><pitch><step>E</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>'
  const s = roundTrips(bars(wedge('crescendo') + q('a') + q('b') + member + wedge('stop') + q('c') + q('d')))
  assert.deepEqual(wedgesOf(s), [['crescendo', 'a', 'b']])
})

test('musicxml: overlapping hairpins from other software get their own numbers when written', () => {
  const s = roundTrips(bars(wedge('crescendo', 1) + q('a') + wedge('diminuendo', 2) + q('b') + q('c') + wedge('stop', 1) + q('d') + wedge('stop', 2)))
  assert.deepEqual(wedgesOf(s), [['crescendo', 'a', 'c'], ['diminuendo', 'b', 'd']])
  const written = serializeMusicXml(s)
  assert.deepEqual([...written.matchAll(/<wedge type="(\w+)" number="(\d+)"\/>/g)].map((m) => `${m[1]}${m[2]}`), ['crescendo1', 'diminuendo2', 'stop1', 'stop2'])
})

test('musicxml: unpaired hairpins are dropped with a warning, never kept with a dangling note', () => {
  const warnings: string[] = []
  const s = parseMusicXml(
    bars(
      wedge('stop') + // a stop with no start
        q('a') +
        wedge('crescendo') + // a start with no note under it before its stop
        wedge('stop') +
        q('b') +
        wedge('diminuendo', 2) + // a start that never stops
        q('c') +
        q('d'),
    ),
    warnings,
  )
  assert.deepEqual(wedgesOf(s), [])
  assert.equal(warnings.length, 3)
  assert.ok(warnings.some((w) => /stop without a start/.test(w)))
  assert.ok(warnings.some((w) => /no note under it/.test(w)))
  assert.ok(warnings.some((w) => /never stopped/.test(w)))
  // What is dropped stays dropped on the next round.
  assert.deepEqual(wedgesOf(parseMusicXml(serializeMusicXml(s))), [])
})

const slur = (type: string, number = 1): string => `<slur type="${type}" number="${number}"/>`
const slursOf = (s: ReturnType<typeof parseMusicXml>): string[] =>
  firstLine(s).measures.flatMap((m) => notesOf(m).flatMap((n) => n.slurs.map((x) => `${n.id}:${x.type}${x.number}`)))

test('musicxml: loose slur ends are dropped as read (pencil marks read as slurs, piece 95), the slur with both ends is kept', () => {
  const warnings: string[] = []
  const s = parseMusicXml(
    bars(
      q('a', slur('start')) + q('b') + q('c', slur('start')) + q('d'), // two starts of slur 1 before any stop
      q('e', slur('start')) + q('f', slur('stop')) + q('g', slur('stop', 2)) + q('h', slur('start')), // a real slur; a stop with no start; a start that never ends
    ),
    warnings,
  )
  assert.deepEqual(slursOf(s), ['e:start1', 'f:stop1'])
  assert.deepEqual(warnings, [
    'Measure 1: a slur that never ends was dropped',
    'Measure 1: a slur that never ends was dropped',
    'Measure 2: a slur stop without a start was dropped',
    'Measure 2: a slur that never ends was dropped',
  ])
  // What is dropped is not written, so the saved file holds what the screen shows.
  const written = serializeMusicXml(s)
  assert.equal((written.match(/<slur /g) ?? []).length, 2)
  roundTrips(written)
})

test('musicxml: a slur that ends on the note the next one starts on, a nested slur and a continue mark are kept', () => {
  const warnings: string[] = []
  const s = parseMusicXml(
    bars(q('a', slur('start')) + q('b', slur('stop') + slur('start')) + q('c', slur('start', 2)) + q('d', slur('stop', 2)), q('e', slur('continue')) + q('f', slur('stop')) + q('g') + q('h')),
    warnings,
  )
  assert.deepEqual(slursOf(s), ['a:start1', 'b:stop1', 'b:start1', 'c:start2', 'd:stop2', 'e:continue1', 'f:stop1'])
  assert.deepEqual(warnings, [])
})

test('musicxml: the continue marks of a slur that never ends go with it', () => {
  const warnings: string[] = []
  const s = parseMusicXml(bars(q('a', slur('start')) + q('b', slur('continue')) + q('c', slur('start')) + q('d', slur('stop')), q('e') + q('f') + q('g') + q('h', slur('continue'))), warnings)
  assert.deepEqual(slursOf(s), ['c:start1', 'd:stop1'])
  assert.deepEqual(warnings, ['Measure 1: a slur that never ends was dropped', 'Measure 2: a slur continue without a start was dropped'])
})

test('musicxml: a hairpin whose notes are gone from the model is not written', () => {
  const s = parseMusicXml(bars(wedge('crescendo') + q('a') + q('b') + wedge('stop') + q('c') + q('d')))
  const w = measure(firstLine(s).measures, 0).items.find(isWedge)!
  w.stop = 'gone'
  assert.ok(!serializeMusicXml(s).includes('<wedge'))
  w.stop = 'b'
  w.start = 'c' // reversed
  assert.ok(!serializeMusicXml(s).includes('<wedge'))
})

test('musicxml: the committed fixture has tenuto, accent, fermata, a crescendo in bar 1 and a diminuendo over a barline', () => {
  const s = parseMusicXml(read(COMMITTED_FIXTURE))
  const all = firstLine(s).measures.flatMap(notesOf)
  assert.equal(all.filter((n) => n.tenuto).length, 1)
  assert.equal(all.filter((n) => n.accent).length, 1)
  assert.equal(all.filter((n) => n.fermata).length, 1)
  assert.equal(nth(measure(firstLine(s).measures, 0), 2).tenuto, true)
  assert.equal(nth(measure(firstLine(s).measures, 0), 3).accent, true)
  assert.equal(nth(measure(firstLine(s).measures, 5), 1).fermata, true)
  assert.deepEqual(wedgesOf(s), [
    ['crescendo', 'a1', nth(measure(firstLine(s).measures, 0), 3).id],
    ['diminuendo', nth(measure(firstLine(s).measures, 1), 0).id, nth(measure(firstLine(s).measures, 2), 0).id],
  ])
})

// --- direction ids (change select-and-delete-elements, task 1.1, design D1) ---

/** The [kind, id] of every dynamic, tempo mark and words item, in score order. */
const directionIds = (s: ReturnType<typeof parseMusicXml>): [string, string][] =>
  firstLine(s).measures.flatMap((m) => m.items.filter(isDirection).map((i): [string, string] => [i.kind, i.id]))

test('musicxml: dynamics, tempo marks and words keep their ids through a save and a load', () => {
  const xml =
    '<direction id="t7" placement="above"><direction-type><words>Allegro</words></direction-type><sound tempo="120"/></direction>' +
    '<direction id="x" placement="below"><direction-type><dynamics><p/></dynamics></direction-type></direction>' +
    q('a') + '<direction id="w2" placement="above"><direction-type><words>dolce</words></direction-type></direction>' + q('b')
  const s = parseMusicXml(bars(xml))
  assert.deepEqual(directionIds(s), [['tempo', 't7'], ['dynamic', 'x'], ['words', 'w2']])
  const written = serializeMusicXml(s)
  assert.deepEqual([...written.matchAll(/<direction id="([^"]+)"/g)].map((m) => m[1]), ['t7', 'x', 'w2'])
  assert.deepEqual(directionIds(parseMusicXml(written)), directionIds(s))
})

test('musicxml: a file without direction ids gets unique fresh ones, and its note ids are the same as before', () => {
  const s = parseMusicXml(read(COMMITTED_FIXTURE))
  assert.deepEqual(directionIds(s), [['tempo', 'd1'], ['dynamic', 'd2'], ['dynamic', 'd3'], ['words', 'd4']])
  // Note ids: the one the file gives, then n1, n2, ... as they were before directions had ids.
  assert.deepEqual(firstLine(s).measures.flatMap((m) => notesOf(m).map((n) => n.id)).slice(0, 4), ['a1', 'n1', 'n2', 'n3'])
  assert.equal(notesOf(firstLine(s).measures[5]!).at(-1)!.id, 'n15')
})

test('musicxml: one direction with several items gives each its own id, and a direction id that a note has is not taken', () => {
  const xml =
    '<direction id="a"><direction-type><dynamics><f/><p/></dynamics></direction-type></direction>' +
    '<direction id="a"><direction-type><dynamics><mp/></dynamics></direction-type></direction>' +
    '<direction id="b"><direction-type><dynamics><mf/></dynamics></direction-type></direction>' + q('b') + q('c')
  const s = parseMusicXml(bars(xml))
  const ids = directionIds(s).map(([, id]) => id)
  assert.equal(ids[0], 'a', 'the first item keeps the direction id')
  const noteIds = firstLine(s).measures.flatMap((m) => notesOf(m).map((n) => n.id))
  assert.deepEqual(noteIds, ['b', 'c'], 'note ids are untouched')
  const all = [...ids, ...noteIds]
  assert.equal(new Set(all).size, all.length, `every id is unique: ${all.join(', ')}`)
})

// ---- more marks (change more-marks, design D1 and D2) ----

/** The written XML without its indentation, to match elements next to each other. */
const compact = (xml: string): string => xml.replace(/>\s+</g, '><')
const marksScore = (warnings: string[] = []) => parseMusicXml(read(HOMR_MARKS_FIXTURE), warnings)
/** The `i`th note item of bar number `bar` (grace notes and chord members included). */
const inBar = (score: ReturnType<typeof marksScore>, bar: number, i: number): Note => nth(measure(firstLine(score).measures, bar - 1), i)

test('marks: every mark homr writes lands on its note', () => {
  const warnings: string[] = []
  const s = marksScore(warnings)
  assert.equal(firstLine(s).measures.length, 12)
  assert.equal(inBar(s, 1, 0).ornament, 'mordent', 'a mordent written among the articulations')
  assert.equal(inBar(s, 1, 1).grace, true)
  assert.equal(inBar(s, 1, 2).grace, undefined)
  assert.equal(inBar(s, 1, 3).strongAccent, true)
  assert.equal(inBar(s, 1, 4).staccatissimo, true)
  assert.equal(inBar(s, 2, 0).ornament, 'trill')
  assert.equal(inBar(s, 2, 1).ornament, 'turn', 'an inverted turn is read as a turn')
  assert.equal(inBar(s, 2, 2).ornament, 'trill')
  assert.deepEqual(inBar(s, 3, 0).tremolo, { kind: 'start', strokes: 3 })
  assert.deepEqual(inBar(s, 3, 1).tremolo, { kind: 'stop', strokes: 3 })
  // a chord arpeggiated on its middle note: kept on the first note of the chord only
  assert.equal(inBar(s, 5, 0).arpeggio, true)
  assert.equal(inBar(s, 5, 1).arpeggio, undefined)
  assert.equal(inBar(s, 5, 2).arpeggio, undefined)
  assert.equal(inBar(s, 5, 3).arpeggio, undefined)
  // a fermata on the top, non-first note of a chord stays on that note
  assert.deepEqual([0, 1, 2, 3].map((i) => inBar(s, 6, i).fermata === true), [false, false, true, false])
  assert.equal(measure(firstLine(s).measures, 6).items.length, 4)
  assert.equal(inBar(s, 7, 0).ornament, undefined, 'a doit is not kept')
  assert.equal(inBar(s, 7, 0).caesura, undefined)
  assert.equal(inBar(s, 7, 3).caesura, true, 'a caesura on the last note of bar 7')
  assert.deepEqual(warnings.filter((w) => !/doit/.test(w)), [])
})

test('marks: tremolos pair by the rule: adjacent start and stop is a pair, anything else is single', () => {
  const s = marksScore()
  assert.deepEqual(inBar(s, 3, 0).tremolo, { kind: 'start', strokes: 3 })
  assert.deepEqual(inBar(s, 3, 1).tremolo, { kind: 'stop', strokes: 3 })
  // bar 4: a start on the first note and a stop on the third, with a note between them
  assert.deepEqual(inBar(s, 4, 0).tremolo, { kind: 'single', strokes: 3 })
  assert.equal(inBar(s, 4, 1).tremolo, undefined)
  assert.deepEqual(inBar(s, 4, 2).tremolo, { kind: 'single', strokes: 3 })
  // a start in one bar and a stop in the next are not a pair either
  const across = parseMusicXml(
    '<score-partwise><part-list><score-part id="P1"/></part-list><part id="P1">' +
      '<measure number="1"><attributes><divisions>1</divisions><time><beats>1</beats><beat-type>4</beat-type></time></attributes>' +
      '<note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type><notations><ornaments><tremolo type="start">2</tremolo></ornaments></notations></note></measure>' +
      '<measure number="2"><note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type><notations><ornaments><tremolo type="stop">2</tremolo></ornaments></notations></note></measure>' +
      '</part></score-partwise>',
  )
  assert.deepEqual(notesOf(firstLine(across).measures[0]!)[0]!.tremolo, { kind: 'single', strokes: 2 })
  assert.deepEqual(notesOf(firstLine(across).measures[1]!)[0]!.tremolo, { kind: 'single', strokes: 2 })
})

test('marks: a doit is dropped with a warning, and a second ornament on a note is dropped with one', () => {
  const warnings: string[] = []
  marksScore(warnings)
  assert.deepEqual(warnings.filter((w) => /doit/.test(w)).length, 1)
  assert.match(warnings.find((w) => /doit/.test(w)) ?? '', /^Measure 7: /)
  const two: string[] = []
  const s = parseMusicXml(bars(q('a', '<ornaments><trill-mark/><turn/></ornaments>')), two)
  assert.equal(notesOf(firstLine(s).measures[0]!)[0]!.ornament, 'trill', 'the first one read is kept')
  assert.equal(two.length, 1)
  assert.match(two[0]!, /more than one ornament/)
})

test('marks: valid MusicXML is read as well: a mordent and a turn under ornaments, a single tremolo', () => {
  const s = parseMusicXml(bars(q('a', '<ornaments><mordent/></ornaments>') + q('b', '<ornaments><turn/><tremolo type="single">2</tremolo></ornaments>') + q('c', '<ornaments><tremolo type="single"/></ornaments>')))
  const [a, b, c] = notesOf(firstLine(s).measures[0]!)
  assert.equal(a!.ornament, 'mordent')
  assert.equal(b!.ornament, 'turn')
  assert.deepEqual(b!.tremolo, { kind: 'single', strokes: 2 })
  assert.deepEqual(c!.tremolo, { kind: 'single', strokes: 3 }, 'the strokes default to 3')
})

test('marks: a multi-measure rest is kept on its first bar as n bars of rest', () => {
  const s = marksScore()
  assert.equal(measure(firstLine(s).measures, 7).multiRest, 4)
  for (const bar of [9, 10, 11, 12]) assert.equal(measure(firstLine(s).measures, bar - 1).multiRest, undefined)
  for (const bar of [8, 9, 10, 11]) assert.deepEqual(notesOf(measure(firstLine(s).measures, bar - 1)).map((n) => n.measureRest), [true])
  assert.deepEqual(multiRestRuns(firstLine(s)), [{ start: 7, length: 4 }])
  assert.equal(multiRestHolds(firstLine(s), 7), true)
  assert.equal(multiRestHolds(firstLine(s), 8), false)
})

test('marks: reading, writing and reading again keeps every mark', () => {
  const s = marksScore()
  const written = compact(serializeMusicXml(s))
  const again = parseMusicXml(written)
  assert.deepEqual(again, s)
  // valid MusicXML: the mordent sits under <ornaments>, never among the articulations
  assert.match(written, /<ornaments><mordent\/><\/ornaments>/)
  assert.ok(!/<articulations>[^]*?<mordent/.test(written))
  assert.match(written, /<turn\/>/)
  assert.ok(!/inverted-turn|doit/.test(written))
  assert.match(written, /<ornaments><trill-mark\/><\/ornaments>/)
  assert.match(written, /<tremolo type="start">3<\/tremolo>/)
  assert.match(written, /<tremolo type="single">3<\/tremolo>/)
  assert.match(written, /<articulations><staccatissimo\/><\/articulations>/)
  assert.match(written, /<articulations><strong-accent\/><\/articulations>/)
})

test('marks: a caesura is written under articulations and read back', () => {
  const s = parseMusicXml(bars(q('a', '<articulations><caesura/></articulations>')))
  const written = compact(serializeMusicXml(s))
  assert.match(written, /<articulations><caesura\/><\/articulations>/)
  assert.equal(notesOf(firstLine(parseMusicXml(written)).measures[0]!)[0]!.caesura, true)
})

test('marks: an arpeggio is written on every note of its chord and on no other', () => {
  const written = compact(serializeMusicXml(marksScore()))
  const bar5 = /<measure number="5">([^]*?)<\/measure>/.exec(written)![1]!
  assert.equal(bar5.match(/<arpeggiate\/>/g)!.length, 3, 'on the three chord notes')
  assert.equal(bar5.match(/<note /g)!.length, 4)
  assert.equal(written.match(/<arpeggiate\/>/g)!.length, 3)
  assert.equal(notesOf(firstLine(parseMusicXml(written)).measures[4]!).filter((n) => n.arpeggio).length, 1)
})

test('marks: a multi-measure rest is written as <multiple-rest> in the first bar, last in its attributes', () => {
  const written = compact(serializeMusicXml(marksScore()))
  assert.equal(written.match(/<multiple-rest>/g)!.length, 1)
  const bar8 = /<measure number="8">([^]*?)<\/measure>/.exec(written)![1]!
  assert.match(bar8, /^<attributes><measure-style><multiple-rest>4<\/multiple-rest><\/measure-style><\/attributes>/)
  // the bars stay: 4 explicit whole-bar rests
  assert.equal(written.match(/<rest measure="yes"\/>/g)!.length, 4)
  assert.equal(firstLine(parseMusicXml(written)).measures[7]!.multiRest, 4)
})

test('marks: a run with a note in it is written without <multiple-rest>, and keeps multiRest in the model', () => {
  const s = marksScore()
  const bar10 = measure(firstLine(s).measures, 9)
  // The view's `items` is the model's own list, so it is replaced in place.
  bar10.items.splice(0, bar10.items.length, { ...nth(measure(firstLine(s).measures, 6), 0), id: 'extra' })
  assert.deepEqual(multiRestRuns(firstLine(s)), [])
  assert.equal(multiRestHolds(firstLine(s), 7), false)
  const written = serializeMusicXml(s)
  assert.ok(!/multiple-rest/.test(written))
  assert.equal(firstLine(parseMusicXml(written)).measures[7]!.multiRest, undefined, 'the file no longer says it')
  assert.equal(firstLine(s).measures[7]!.multiRest, 4, 'the model is not changed by writing')
})

test('marks: any other item in a run breaks it: a barline, a direction, a clef, a second note, a fermata on the rest', () => {
  const broken = (change: (s: ReturnType<typeof marksScore>) => void): number => {
    const s = marksScore()
    change(s)
    return multiRestRuns(firstLine(s)).length
  }
  assert.equal(broken(() => {}), 1)
  assert.equal(broken((s) => { setAttr(s, 9, 'rightBarline', { style: 'light-light' }) }), 0)
  assert.equal(broken((s) => { setAttr(s, 8, 'leftBarline', { repeat: 'forward' }) }), 0)
  assert.equal(broken((s) => { setAttr(s, 10, 'key', { fifths: 2 }) }), 0)
  assert.equal(broken((s) => { setAttr(s, 10, 'time', { beats: 3, beatType: 4 }) }), 0)
  assert.equal(broken((s) => { firstLine(s).measures[9]!.items.unshift({ kind: 'dynamic', id: 'dx', mark: 'f' }) }), 0)
  assert.equal(broken((s) => { (firstLine(s).measures[9]!.items[0] as Note).fermata = true }), 0)
  assert.equal(broken((s) => { (firstLine(s).measures[9]!.items[0] as Note).measureRest = false }), 0)
  assert.equal(broken((s) => { setAttr(s, 7, 'multiRest', 5) }), 0, 'a run that is longer than its rests')
  assert.equal(broken((s) => { setAttr(s, 7, 'multiRest', 1) }), 0, 'one bar is not a multi-measure rest')

  // A clef, key or time on the run's first bar is drawn before the symbol: the run still holds.
  assert.equal(broken((s) => { setAttr(s, 7, 'clef', { sign: 'F', line: 4 }); setAttr(s, 7, 'key', { fifths: 2 }); setAttr(s, 7, 'time', { beats: 3, beatType: 4 }) }), 1)
})

test('marks: expand never writes <multiple-rest>, and writing with it does not change the model', () => {
  const s = marksScore()
  const before = JSON.stringify(s)
  const written = compact(serializeMusicXml(s, { multiRests: 'expand' }))
  assert.ok(!/multiple-rest|measure-style/.test(written))
  assert.equal(written.match(/<rest measure="yes"\/>/g)!.length, 4, 'every bar is still there')
  assert.equal(JSON.stringify(s), before)
  assert.match(compact(serializeMusicXml(s, { multiRests: 'collapse' })), /<multiple-rest>4</)
  assert.match(compact(serializeMusicXml(s)), /<multiple-rest>4</, 'collapse is the default: saving keeps the run')
})

// ---- Writer pins (change parts-and-accompaniment, task 2.3, design D10) --------------------------------------

/**
 * `test/fixtures/written/` holds what the writer produced for the one-line fixtures before parts: as stored
 * (`<base>.musicxml`), as drawn (`.drawing.musicxml`: no title or part name, beams, drawing ids, multi-measure
 * rests collapsed) and as drawn in the editor (`.expand.musicxml`: the same, rests expanded). The writer must
 * still produce exactly these bytes.
 */
const WRITTEN_SOURCES: Record<string, string> = {
  'all-elements': 'fixtures/all-elements.musicxml',
  'homr-marks': 'fixtures/homr-marks.musicxml',
  'practice-exercise': 'fixtures/practice-exercise.musicxml',
  'practice-exercise.recognised': 'fixtures/practice-exercise.recognised.musicxml',
  'two-page-merged': 'fixtures/two-page/merged.musicxml',
  'two-page-page-1': 'fixtures/two-page/page-1.musicxml',
  'two-page-page-2': 'fixtures/two-page/page-2.musicxml',
}

for (const [base, source] of Object.entries(WRITTEN_SOURCES)) {
  test(`writer pin: ${base} is written byte for byte as before parts (stored, drawn, drawn expanded)`, () => {
    const score = parseMusicXml(read(new URL(source, import.meta.url).pathname))
    const golden = (suffix: string): string => read(new URL(`fixtures/written/${base}${suffix}.musicxml`, import.meta.url).pathname)
    assert.equal(serializeMusicXml(score), golden(''), 'as stored')
    const drawn = { ...score, parts: score.parts.map((p) => ({ ...p, name: '' })) }
    delete drawn.title
    const beams = beamScore(firstLine(score))
    assert.equal(serializeMusicXml(drawn, { beams, drawingIds: true, multiRests: 'collapse' }), golden('.drawing'), 'as drawn')
    assert.equal(serializeMusicXml(drawn, { beams, drawingIds: true, multiRests: 'expand' }), golden('.expand'), 'as drawn, multi-measure rests expanded')
  })
}

// ---- Parts, staves and voices (change parts-and-accompaniment, tasks 3.1 and 3.2) -------------------------------

/** One voice of a score as text: `C4/4` a note (`+` for a chord member, `R` a rest, `H` a hidden rest) with its length in whole notes. */
function voiceText(items: readonly MeasureItem[]): string {
  return items
    .filter(isNote)
    .map((n) => `${n.hidden ? 'H' : n.rest ? 'R' : `${n.chord ? '+' : ''}${n.pitch!.step}${n.pitch!.octave}`}:${n.duration.n}/${n.duration.d}`)
    .join(' ')
}
const voicesOf = (score: Score, bar: number, part: number, staff: number): string[] => score.bars[bar]!.parts[part]!.staves[staff]!.voices.map(voiceText)
const idsOf = (score: Score): string[] => allItemLists(score).flatMap((l) => l.filter(isNote).map((n) => n.id))
/** The model with every hidden rest's id replaced: a hidden rest has no id in a file, so it gets a new one on every reading. */
const withoutHiddenIds = (score: Score): Score => {
  const copy = structuredClone(score)
  for (const items of allItemLists(copy)) for (const item of items) if (isNote(item) && item.hidden) item.id = 'hidden'
  return copy
}

test('parts: a melody and a piano grand staff are read as two parts, with names, staves, clefs, key and time', () => {
  const warnings: string[] = []
  const score = parseMusicXml(read(MELODY_PIANO_FIXTURE), warnings)
  assert.deepEqual(warnings, [])
  assert.deepEqual(score.parts, [{ id: 'P1', name: 'Melody', staves: 1 }, { id: 'P2', name: 'Piano', staves: 2 }])
  assert.equal(score.title, 'Melody and piano study')
  assert.equal(score.bars.length, 8)
  assert.deepEqual(score.bars[0]!.time, { beats: 4, beatType: 4 })
  assert.deepEqual(score.bars[0]!.parts[0]!.staves[0]!.clef, { sign: 'G', line: 2 })
  assert.deepEqual(score.bars[0]!.parts[1]!.staves.map((s) => s.clef), [{ sign: 'G', line: 2 }, { sign: 'F', line: 4 }])
  assert.deepEqual(score.bars[0]!.parts[1]!.key, { fifths: 0 })
  assert.ok(score.bars.every((b) => b.parts.length === 2 && b.parts[0]!.staves.length === 1 && b.parts[1]!.staves.length === 2))
})

test('parts: every note lands in its part, staff and voice; chords and both left-hand voices are kept', () => {
  const score = parseMusicXml(read(MELODY_PIANO_FIXTURE))
  assert.deepEqual(voicesOf(score, 0, 0, 0), ['G4:1/4 A4:1/4 B4:1/4 C5:1/4'])
  assert.deepEqual(voicesOf(score, 0, 1, 0), ['C4:1/2 +E4:1/2 +G4:1/2 C4:1/2 +E4:1/2 +G4:1/2'], 'chords in the right hand')
  assert.deepEqual(voicesOf(score, 0, 1, 1), ['C3:1/2 G2:1/2', ''])
  // bar 3: two voices in the left hand; the second starts after a <forward>, which is a hidden rest
  assert.deepEqual(voicesOf(score, 2, 1, 1), ['E3:1/4 D3:1/4 C3:1/2', 'H:1/2 C2:1/2'])
  assert.deepEqual(voicesOf(score, 2, 1, 0), ['C4:1/2 +E4:1/2 +G4:1/2 C4:1/2 +F4:1/2 +A4:1/2'])
  // every staff has the same number of voices in every bar
  assert.ok(score.bars.every((b) => b.parts[1]!.staves[1]!.voices.length === 2 && b.parts[1]!.staves[0]!.voices.length === 1 && b.parts[0]!.staves[0]!.voices.length === 1))
  assert.deepEqual(voicesOf(score, 0, 1, 1).length, 2)
  assert.deepEqual(voicesOf(score, 0, 1, 1)[1], '', 'an empty voice is an empty list')
  // a whole-bar rest on a hidden staff, and the melody resting while the piano plays
  assert.deepEqual(voicesOf(score, 5, 1, 1), ['R:1/1', ''])
  assert.deepEqual(voicesOf(score, 4, 0, 0), ['R:1/1'])
  assert.equal((score.bars[5]!.parts[1]!.staves[1]!.voices[0]![0] as Note).measureRest, true)
  // the melody's slur and fermata, and the piano's dynamic on its first staff
  const melody = score.bars.flatMap((b) => b.parts[0]!.staves[0]!.voices[0]!.filter(isNote))
  assert.deepEqual(melody.filter((n) => n.slurs.length > 0).map((n) => n.slurs[0]!.type), ['start', 'continue', 'stop'])
  assert.deepEqual(melody.filter((n) => n.fermata).map((n) => `${n.pitch!.step}${n.pitch!.octave}`), ['C5'])
  assert.equal(allItemLists(score).flat().filter((i) => isNote(i) && i.fermata).length, 1, 'a fermata in the melody only')
  assert.deepEqual(score.bars[0]!.parts[1]!.staves[0]!.voices[0]!.filter(isDirection).map((d) => d.kind), ['dynamic'])
  // repeat and line break come from the first part
  assert.deepEqual(score.bars[0]!.leftBarline, { style: 'heavy-light', repeat: 'forward' })
  assert.deepEqual(score.bars[3]!.rightBarline, { style: 'light-heavy', repeat: 'backward' })
  assert.equal(score.bars[4]!.newSystem, true)
  // note ids are unique in the whole score
  assert.equal(new Set(idsOf(score)).size, idsOf(score).length)
})

test('parts: hidden rests are there and every voice adds up to the bar', () => {
  const score = parseMusicXml(read(MELODY_PIANO_FIXTURE))
  const hidden = allItemLists(score).flat().filter((i): i is Note => isNote(i) && i.hidden === true)
  assert.equal(hidden.length, 1)
  assert.ok(hidden[0]!.rest)
  assert.ok(eq(hidden[0]!.duration, frac(1, 2)))
  for (const bar of score.bars) {
    for (const pb of bar.parts) {
      for (const sb of pb.staves) {
        sb.voices.forEach((items, vi) => {
          const length = barLength({ number: bar.number, items })
          if (items.length > 0) assert.ok(eq(length, frac(1)), `bar ${bar.number} voice ${vi}: ${length.n}/${length.d}`)
        })
      }
    }
  }
})

test('parts: a <forward> that no voice continues after moves the cursor and adds no hidden rest; one without a gap before a note adds none either', () => {
  const xml = (body: string): string =>
    `<score-partwise><part-list><score-part id="P1"/></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>${body}</measure></part></score-partwise>`
  const n = (step: string, duration: number, voice = 1): string => `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>${duration}</duration><voice>${voice}</voice><type>${duration === 4 ? 'whole' : 'quarter'}</type></note>`
  // two quarters, then a forward to the end of the bar: nothing follows, so nothing is added
  const trailing = parseMusicXml(xml(`${n('C', 1)}${n('D', 1)}<forward><duration>2</duration></forward>`))
  assert.deepEqual(voicesOf(trailing, 0, 0, 0), ['C4:1/4 D4:1/4'])
  // a forward in the middle of the only voice: the note after it starts later, so the gap is a hidden rest
  const middle = parseMusicXml(xml(`${n('C', 1)}<forward><duration>2</duration></forward>${n('D', 1)}`))
  assert.deepEqual(voicesOf(middle, 0, 0, 0), ['C4:1/4 H:1/2 D4:1/4'])
  // a second voice that ends early is not padded at the end of the bar
  const early = parseMusicXml(xml(`${n('C', 4)}<backup><duration>4</duration></backup>${n('E', 1, 2)}`))
  assert.deepEqual(voicesOf(early, 0, 0, 0), ['C4:1/1', 'E4:1/4'])
})

test('parts: when a later part disagrees on a bar attribute, one warning per bar names it, and the first part wins', () => {
  const part = (id: string, time: string, extra: string): string =>
    `<part id="${id}"><measure number="1"><attributes><divisions>1</divisions>${time}</attributes><note><rest measure="yes"/><duration>4</duration><voice>1</voice></note></measure>` +
    `<measure number="2">${extra}<note><rest measure="yes"/><duration>4</duration><voice>1</voice></note></measure></part>`
  const four = '<time><beats>4</beats><beat-type>4</beat-type></time>'
  const three = '<time><beats>3</beats><beat-type>4</beat-type></time>'
  const warnings: string[] = []
  const score = parseMusicXml(
    `<score-partwise><part-list><score-part id="P1"/><score-part id="P2"/></part-list>${part('P1', four, '')}${part('P2', three, '<print new-system="yes"/><barline location="right"><bar-style>light-heavy</bar-style></barline>')}</score-partwise>`,
    warnings,
  )
  assert.deepEqual(score.bars[0]!.time, { beats: 4, beatType: 4 })
  assert.equal(score.bars[1]!.newSystem, undefined)
  assert.equal(score.bars[1]!.rightBarline, undefined)
  assert.equal(warnings.filter((w) => /Measure 1:/.test(w)).length, 1)
  assert.equal(warnings.filter((w) => /Measure 2:/.test(w)).length, 1)
  assert.match(warnings.find((w) => /Measure 1:/.test(w))!, /P2.*time signature.*first part/)
  assert.match(warnings.find((w) => /Measure 2:/.test(w))!, /bar lines and line break|line break and bar lines|bar lines/)
  assert.ok(!warnings.some((w) => /first of/.test(w)))
  // parts with no matching part-name and several one-staff parts are numbered
  assert.deepEqual(score.parts.map((p) => p.name), ['Melody 1', 'Melody 2'])
})

test('parts: names: one part keeps its name; a custom name is kept next to a piano', () => {
  const one = parseMusicXml(read(COMMITTED_FIXTURE))
  assert.equal(one.parts[0]!.name, 'Tenor Saxophone')
  const two = read(MELODY_PIANO_FIXTURE).replace('<part-name>Voice</part-name>', '<part-name>Flute</part-name>')
  assert.deepEqual(parseMusicXml(two).parts.map((p) => p.name), ['Flute', 'Piano'])
})

test('parts: the melody-piano fixture survives read, write, read', () => {
  const first = parseMusicXml(read(MELODY_PIANO_FIXTURE))
  const written = serializeMusicXml(first)
  const second = parseMusicXml(written)
  assert.deepEqual(withoutHiddenIds(second), withoutHiddenIds(first))
  // and the writer is a fixed point after that
  assert.equal(serializeMusicXml(second), written)
  // each note keeps its id (a hidden rest has none in a file)
  assert.deepEqual(idsOf(second).filter((id) => /^n/.test(id)).length, idsOf(first).length)
})

test('parts: the writer puts staves, per-staff clefs, voices 1-4 and 5-8, backups and forwards where MusicXML wants them', () => {
  const written = serializeMusicXml(parseMusicXml(read(MELODY_PIANO_FIXTURE)))
  assert.equal(written.match(/<part /g)!.length, 2)
  assert.equal(written.match(/<divisions>/g)!.length, 2, 'one <divisions> per part (the first bar of each)')
  assert.equal(new Set(written.match(/<divisions>(\d+)</g)).size, 1, 'the same value in each')
  assert.equal(written.match(/<staves>2<\/staves>/g)!.length, 1)
  const piano = /<part id="P2">([^]*)<\/part>/.exec(written)![1]!
  const melody = /<part id="P1">([^]*?)<\/part>/.exec(written)![1]!
  assert.match(piano, /<clef number="1">/)
  assert.match(piano, /<clef number="2">/)
  assert.ok(!/<clef number/.test(melody), 'a one-staff part has no clef number')
  assert.ok(!/<staves>/.test(melody))
  assert.match(piano, /<voice>5<\/voice>/)
  assert.match(piano, /<voice>6<\/voice>/)
  assert.ok(!/<voice>[78]<\/voice>/.test(piano))
  assert.match(piano, /<forward>\s*<duration>\d+<\/duration>\s*<voice>6<\/voice>\s*<staff>2<\/staff>\s*<\/forward>/)
  assert.ok(/<backup>/.test(piano))
  // the shared attributes are repeated in every part
  assert.equal(written.match(/<time>/g)!.length, 2)
  assert.equal(written.match(/repeat direction="backward"/g)!.length, 2)
  assert.equal(written.match(/<fermata\/>/g)!.length, 1)
  assert.match(melody, /<fermata\/>/)
  // empty voices are left out: the right hand has one voice and nothing is written for a second
  assert.ok(!/<voice>2<\/voice>/.test(piano))
})

test('parts: parts: [P2] writes the piano part only, with its ids, and drawing ids that do not collide', () => {
  const score = parseMusicXml(read(MELODY_PIANO_FIXTURE))
  const written = serializeMusicXml(score, { parts: ['P2'], drawingIds: true })
  assert.equal(written.match(/<part /g)!.length, 1)
  assert.match(written, /<part id="P2">/)
  assert.equal(written.match(/<score-part /g)!.length, 1)
  assert.ok(!/<part id="P1"/.test(written))
  assert.match(written, /<clef number="1" id="clef-P2-0-0">/)
  assert.match(written, /<clef number="2" id="clef-P2-1-0">/)
  assert.ok(!/id="clef-P1-/.test(written))
  const both = serializeMusicXml(score, { drawingIds: true })
  assert.match(both, /<clef id="clef-P1-0-0">/, 'every clef id names its part and staff (change edit-parts, D6)')
  const readBack = parseMusicXml(written)
  assert.deepEqual(readBack.parts, [{ id: 'P2', name: 'Piano', staves: 2 }])
  assert.deepEqual(voicesOf(readBack, 2, 0, 1), ['E3:1/4 D3:1/4 C3:1/2', 'H:1/2 C2:1/2'])
})

test('parts: a multi-measure rest of a part holds only when every staff and voice of the part rests plainly', () => {
  const score = parseMusicXml(read(MELODY_PIANO_FIXTURE))
  const rest = (): Note => ({ kind: 'note', id: `r${Math.random()}`, rest: true, measureRest: true, dots: 0, duration: frac(1), slurs: [], tuplets: [] })
  // the melody rests in bars 5 and 6 (a rest, then notes): make bars 5-6 two rests, and the piano plays on
  score.bars[5]!.parts[0]!.staves[0]!.voices[0]!.splice(0, 4, rest())
  score.bars[4]!.parts[0]!.multiRest = 2
  const drawn = (options = {}): string => serializeMusicXml(score, options)
  const melody = (xml: string): string => /<part id="P1">([^]*?)<\/part>/.exec(xml)![1]!
  assert.match(melody(drawn()), /<multiple-rest>2<\/multiple-rest>/)
  assert.ok(!/<multiple-rest>/.test(/<part id="P2">([^]*)<\/part>/.exec(drawn())![1]!))
  assert.ok(!/multiple-rest/.test(drawn({ multiRests: 'expand' })))
  // a note in a bar of the run breaks it
  score.bars[5]!.parts[0]!.staves[0]!.voices[0]!.unshift({ ...rest(), measureRest: false, rest: false, pitch: { step: 'C', octave: 5 }, type: 'whole' })
  assert.ok(!/multiple-rest/.test(drawn()))
})

test('parts: a local homr page of a melody and piano keeps every note it read (local fixture)', { skip: skipUnless(LOCAL_HOMR_PIANO_PAGE) }, () => {
  const source = read(LOCAL_HOMR_PIANO_PAGE)
  const warnings: string[] = []
  const score = parseMusicXml(source, warnings)
  assert.equal(score.parts.length, 2)
  assert.deepEqual(score.parts.map((p) => p.staves), [1, 2])
  assert.deepEqual(score.parts.map((p) => p.name), ['Melody', 'Piano'])
  assert.ok(!warnings.some((w) => /dropped|ignored/.test(w)), warnings.join('; '))
  const notesInFile = (source.match(/<note[ >]/g) ?? []).length
  const notesKept = allItemLists(score).flat().filter((i) => isNote(i) && !i.hidden).length
  assert.equal(notesKept, notesInFile, 'every note homr read is kept')
  const again = parseMusicXml(serializeMusicXml(score))
  assert.deepEqual(withoutHiddenIds(again), withoutHiddenIds(score))
})

// ---- Reading fixes found in review (change parts-and-accompaniment, group 3) ------------------------------------

const wrap = (attrs: string, ...bars: string[]): string =>
  `<score-partwise><part-list><score-part id="P1"/></part-list><part id="P1">${bars.map((b, i) => `<measure number="${i + 1}">${i === 0 ? `<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time>${attrs}</attributes>` : ''}${b}</measure>`).join('')}</part></score-partwise>`
const qn = (step: string, voice: number, staff = 1, d = 1, type = 'quarter'): string =>
  `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>${d}</duration><voice>${voice}</voice><type>${type}</type><staff>${staff}</staff></note>`
const mRest = (voice: number, staff: number): string => `<note><rest measure="yes"/><duration>4</duration><voice>${voice}</voice><staff>${staff}</staff></note>`

test('parts: homr writes the rests after a multi-measure rest on staff 2 with voice 1: it is the staff\'s own voice, and the run holds', () => {
  const back = '<backup><duration>4</duration></backup>'
  const piano = '<staves>2</staves><clef number="1"><sign>G</sign></clef><clef number="2"><sign>F</sign></clef>'
  const xml = wrap(
    piano,
    mRest(1, 1) + back + mRest(5, 2),
    mRest(1, 1) + back + mRest(1, 2),
    mRest(1, 1) + back + mRest(1, 2),
  ).replace('<measure number="1">', '<measure number="1">').replace('</attributes>', '<measure-style><multiple-rest>3</multiple-rest></measure-style></attributes>')
  const score = parseMusicXml(xml)
  assert.ok(score.bars.every((b) => b.parts[0]!.staves[1]!.voices.length === 1), 'no second voice on staff 2')
  assert.equal(score.bars[0]!.parts[0]!.multiRest, 3)
  const written = serializeMusicXml(score)
  assert.match(written, /<multiple-rest>3<\/multiple-rest>/, 'the run still holds')
  assert.equal(parseMusicXml(written).bars[0]!.parts[0]!.multiRest, 3)
})

test('parts: voices are numbered from the lowest voice number of the staff, not by first use', () => {
  // a rest-only second position (voice 2) is written before the melody (voice 1)
  const xml = wrap('', '<note><rest/><duration>2</duration><voice>2</voice><type>half</type><staff>1</staff></note><backup><duration>2</duration></backup>' + qn('C', 1) + qn('D', 1) + qn('E', 1) + qn('F', 1))
  const score = parseMusicXml(xml)
  assert.deepEqual(voicesOf(score, 0, 0, 0), ['C4:1/4 D4:1/4 E4:1/4 F4:1/4', 'R:1/2'], 'the melody is the first voice')
})

test('parts: a voice after the first is not padded at the end, and an empty first voice is filled with the bar of the time signature', () => {
  const short = parseMusicXml(wrap('', qn('C', 1, 1, 4, 'whole') + '<backup><duration>4</duration></backup>' + qn('E', 2, 1, 1)))
  assert.deepEqual(voicesOf(short, 0, 0, 0), ['C4:1/1', 'E4:1/4'])
  // only a voice 2 in the bar: the first voice gets a hidden rest as long as the bar (4/4), not as long as voice 2
  const only = parseMusicXml(wrap('', qn('C', 1, 1, 4, 'whole'), qn('E', 2, 1, 1)))
  assert.deepEqual(voicesOf(only, 1, 0, 0), ['H:1/1', 'E4:1/4'])
})

test('parts: a direction inside a hidden rest of the first voice splits the rest, so it keeps its time', () => {
  const dir = '<direction placement="below"><direction-type><dynamics><p/></dynamics></direction-type><staff>2</staff></direction>'
  const piano = '<staves>2</staves><clef number="1"><sign>G</sign></clef><clef number="2"><sign>F</sign></clef>'
  // staff 2 has only voice 6, from beat 3: a hidden rest of two beats, then the notes; "p" is written at beat 3 after a forward... at beat 2
  const xml = wrap(piano, qn('C', 1, 1, 4, 'whole') + '<backup><duration>4</duration></backup><forward><duration>2</duration></forward>' + dir + qn('D', 6, 2, 2, 'half'))
  const score = parseMusicXml(xml)
  assert.deepEqual(voicesOf(score, 0, 0, 1), ['H:1/2 D4:1/2'])
  const items = score.bars[0]!.parts[0]!.staves[1]!.voices[0]!
  assert.deepEqual(items.map((i) => (isNote(i) ? 'note' : i.kind)), ['note', 'dynamic', 'note'], 'the dynamic is between the rest and the note')
  // a direction at beat 2 of a rest that spans it
  const mid = '<direction placement="below"><direction-type><dynamics><f/></dynamics></direction-type><staff>2</staff></direction>'
  const xml2 = wrap(piano, qn('C', 1, 1, 4, 'whole') + '<backup><duration>4</duration></backup><forward><duration>2</duration></forward>' + qn('D', 6, 2, 2, 'half') + '<backup><duration>4</duration></backup>' + '<forward><duration>1</duration></forward>' + mid)
  const items2 = parseMusicXml(xml2).bars[0]!.parts[0]!.staves[1]!.voices[0]!
  assert.deepEqual(items2.map((i) => (isNote(i) ? `${i.hidden ? 'H' : 'n'}${i.duration.n}/${i.duration.d}` : i.kind)), ['H1/4', 'dynamic', 'H1/4', 'n1/2'])
})
