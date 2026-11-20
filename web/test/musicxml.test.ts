import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Measure, Note } from '../src/core/score/model.ts'
import { isDirection, isNote, isWedge, notesOf } from '../src/core/score/model.ts'
import { parseMusicXml, serializeMusicXml } from '../src/core/score/musicxml.ts'
import { eq, frac } from '../src/core/score/rational.ts'
import { barLength } from '../src/core/score/repairs.ts'
import { multiRestHolds, multiRestRuns } from '../src/core/score/model.ts'
import { COMMITTED_FIXTURE, HOMR_MARKS_FIXTURE, LOCAL_PAGE, read, skipUnless } from './helpers.ts'

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
  assert.equal(score.partName, 'Tenor Saxophone')
  assert.equal(score.measures.length, 6)
  const [m1, m2, m3, m4, m5, m6] = score.measures.map((_, i) => measure(score.measures, i)) as [Measure, Measure, Measure, Measure, Measure, Measure]

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
  const ids = score.measures.flatMap((m) => notesOf(m).map((n) => n.id))
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
  assert.equal(notesOf(measure(score.measures, 0)).length, 2)
  assert.ok(warnings.some((w) => /first of 2 parts/.test(w)))
  assert.ok(warnings.some((w) => /other voices/.test(w)))
  assert.throws(() => parseMusicXml('<score-timewise/>'), /Timewise/)
  assert.throws(() => parseMusicXml('<html/>'), /Not MusicXML/)
  assert.ok(measure(score.measures, 0).items.every((i) => !isNote(i) || i.duration.n > 0))
})

test('musicxml: full page round-trips (local fixture)', { skip: skipUnless(LOCAL_PAGE) }, () => {
  const warnings: string[] = []
  const first = parseMusicXml(read(LOCAL_PAGE), warnings)
  assert.equal(first.measures.length, 32)
  const second = parseMusicXml(serializeMusicXml(first))
  assert.deepEqual(second, first)
  // content is preserved: same counts of every kind of mark
  const count = (s: typeof first, f: (n: Note) => boolean): number =>
    s.measures.reduce((a, m) => a + notesOf(m).filter(f).length, 0)
  assert.equal(count(first, (n) => n.slurs.length > 0), count(second, (n) => n.slurs.length > 0))
  assert.ok(count(first, (n) => n.breath === true) === 2)
  assert.ok(count(first, (n) => n.staccato === true) > 0)
  assert.ok(first.measures.some((m) => m.rightBarline?.repeat === 'backward'))
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
  s.measures.flatMap((m) => m.items.filter(isWedge).map((w): [string, string, string] => [w.type, w.start, w.stop]))

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
  const [a, b, c, d] = notesOf(measure(s.measures, 0))
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
  assert.equal(notesOf(measure(s.measures, 0))[1]!.fermata, true)
})

test('musicxml: a crescendo and a diminuendo are read as hairpins between notes, and round-trip', () => {
  const xml = bars(
    wedge('crescendo') + q('a') + q('b') + wedge('stop') + wedge('diminuendo') + q('c') + q('d') + wedge('stop'),
  )
  const s = roundTrips(xml)
  assert.deepEqual(wedgesOf(s), [['crescendo', 'a', 'b'], ['diminuendo', 'c', 'd']])
  // Each hairpin is kept in the measure of its first note, right before that note.
  assert.deepEqual(measure(s.measures, 0).items.map((i) => (isWedge(i) ? `${i.type}:${i.start}` : (i as Note).id)), ['crescendo:a', 'a', 'b', 'diminuendo:c', 'c', 'd'])
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
  assert.equal(measure(s.measures, 0).items.some(isWedge), false)
  assert.equal(isWedge(measure(s.measures, 1).items[0]!), true)
})

test('musicxml: a dynamic next to the start of a hairpin, and a hairpin over one note, survive', () => {
  // The dynamic is written between the start direction and the note; the model puts the hairpin right before the note.
  const s = roundTrips(bars(wedge('crescendo') + dynamic('mp') + q('a') + q('b') + wedge('stop') + wedge('diminuendo') + q('c') + wedge('stop') + q('d')))
  assert.deepEqual(wedgesOf(s), [['crescendo', 'a', 'b'], ['diminuendo', 'c', 'c']])
  assert.deepEqual(measure(s.measures, 0).items.filter((i) => i.kind === 'dynamic'), [{ kind: 'dynamic', id: 'd1', mark: 'mp' }])
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

test('musicxml: a hairpin whose notes are gone from the model is not written', () => {
  const s = parseMusicXml(bars(wedge('crescendo') + q('a') + q('b') + wedge('stop') + q('c') + q('d')))
  const w = measure(s.measures, 0).items.find(isWedge)!
  w.stop = 'gone'
  assert.ok(!serializeMusicXml(s).includes('<wedge'))
  w.stop = 'b'
  w.start = 'c' // reversed
  assert.ok(!serializeMusicXml(s).includes('<wedge'))
})

test('musicxml: the committed fixture has tenuto, accent, fermata, a crescendo in bar 1 and a diminuendo over a barline', () => {
  const s = parseMusicXml(read(COMMITTED_FIXTURE))
  const all = s.measures.flatMap(notesOf)
  assert.equal(all.filter((n) => n.tenuto).length, 1)
  assert.equal(all.filter((n) => n.accent).length, 1)
  assert.equal(all.filter((n) => n.fermata).length, 1)
  assert.equal(nth(measure(s.measures, 0), 2).tenuto, true)
  assert.equal(nth(measure(s.measures, 0), 3).accent, true)
  assert.equal(nth(measure(s.measures, 5), 1).fermata, true)
  assert.deepEqual(wedgesOf(s), [
    ['crescendo', 'a1', nth(measure(s.measures, 0), 3).id],
    ['diminuendo', nth(measure(s.measures, 1), 0).id, nth(measure(s.measures, 2), 0).id],
  ])
})

// --- direction ids (change select-and-delete-elements, task 1.1, design D1) ---

/** The [kind, id] of every dynamic, tempo mark and words item, in score order. */
const directionIds = (s: ReturnType<typeof parseMusicXml>): [string, string][] =>
  s.measures.flatMap((m) => m.items.filter(isDirection).map((i): [string, string] => [i.kind, i.id]))

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
  assert.deepEqual(s.measures.flatMap((m) => notesOf(m).map((n) => n.id)).slice(0, 4), ['a1', 'n1', 'n2', 'n3'])
  assert.equal(notesOf(s.measures[5]!).at(-1)!.id, 'n15')
})

test('musicxml: one direction with several items gives each its own id, and a direction id that a note has is not taken', () => {
  const xml =
    '<direction id="a"><direction-type><dynamics><f/><p/></dynamics></direction-type></direction>' +
    '<direction id="a"><direction-type><dynamics><mp/></dynamics></direction-type></direction>' +
    '<direction id="b"><direction-type><dynamics><mf/></dynamics></direction-type></direction>' + q('b') + q('c')
  const s = parseMusicXml(bars(xml))
  const ids = directionIds(s).map(([, id]) => id)
  assert.equal(ids[0], 'a', 'the first item keeps the direction id')
  const noteIds = s.measures.flatMap((m) => notesOf(m).map((n) => n.id))
  assert.deepEqual(noteIds, ['b', 'c'], 'note ids are untouched')
  const all = [...ids, ...noteIds]
  assert.equal(new Set(all).size, all.length, `every id is unique: ${all.join(', ')}`)
})

// ---- more marks (change more-marks, design D1 and D2) ----

/** The written XML without its indentation, to match elements next to each other. */
const compact = (xml: string): string => xml.replace(/>\s+</g, '><')
const marksScore = (warnings: string[] = []) => parseMusicXml(read(HOMR_MARKS_FIXTURE), warnings)
/** The `i`th note item of bar number `bar` (grace notes and chord members included). */
const inBar = (score: ReturnType<typeof marksScore>, bar: number, i: number): Note => nth(measure(score.measures, bar - 1), i)

test('marks: every mark homr writes lands on its note', () => {
  const warnings: string[] = []
  const s = marksScore(warnings)
  assert.equal(s.measures.length, 12)
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
  assert.equal(measure(s.measures, 6).items.length, 4)
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
  assert.deepEqual(notesOf(across.measures[0]!)[0]!.tremolo, { kind: 'single', strokes: 2 })
  assert.deepEqual(notesOf(across.measures[1]!)[0]!.tremolo, { kind: 'single', strokes: 2 })
})

test('marks: a doit is dropped with a warning, and a second ornament on a note is dropped with one', () => {
  const warnings: string[] = []
  marksScore(warnings)
  assert.deepEqual(warnings.filter((w) => /doit/.test(w)).length, 1)
  assert.match(warnings.find((w) => /doit/.test(w)) ?? '', /^Measure 7: /)
  const two: string[] = []
  const s = parseMusicXml(bars(q('a', '<ornaments><trill-mark/><turn/></ornaments>')), two)
  assert.equal(notesOf(s.measures[0]!)[0]!.ornament, 'trill', 'the first one read is kept')
  assert.equal(two.length, 1)
  assert.match(two[0]!, /more than one ornament/)
})

test('marks: valid MusicXML is read as well: a mordent and a turn under ornaments, a single tremolo', () => {
  const s = parseMusicXml(bars(q('a', '<ornaments><mordent/></ornaments>') + q('b', '<ornaments><turn/><tremolo type="single">2</tremolo></ornaments>') + q('c', '<ornaments><tremolo type="single"/></ornaments>')))
  const [a, b, c] = notesOf(s.measures[0]!)
  assert.equal(a!.ornament, 'mordent')
  assert.equal(b!.ornament, 'turn')
  assert.deepEqual(b!.tremolo, { kind: 'single', strokes: 2 })
  assert.deepEqual(c!.tremolo, { kind: 'single', strokes: 3 }, 'the strokes default to 3')
})

test('marks: a multi-measure rest is kept on its first bar as n bars of rest', () => {
  const s = marksScore()
  assert.equal(measure(s.measures, 7).multiRest, 4)
  for (const bar of [9, 10, 11, 12]) assert.equal(measure(s.measures, bar - 1).multiRest, undefined)
  for (const bar of [8, 9, 10, 11]) assert.deepEqual(notesOf(measure(s.measures, bar - 1)).map((n) => n.measureRest), [true])
  assert.deepEqual(multiRestRuns(s), [{ start: 7, length: 4 }])
  assert.equal(multiRestHolds(s, 7), true)
  assert.equal(multiRestHolds(s, 8), false)
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
  assert.equal(notesOf(parseMusicXml(written).measures[0]!)[0]!.caesura, true)
})

test('marks: an arpeggio is written on every note of its chord and on no other', () => {
  const written = compact(serializeMusicXml(marksScore()))
  const bar5 = /<measure number="5">([^]*?)<\/measure>/.exec(written)![1]!
  assert.equal(bar5.match(/<arpeggiate\/>/g)!.length, 3, 'on the three chord notes')
  assert.equal(bar5.match(/<note /g)!.length, 4)
  assert.equal(written.match(/<arpeggiate\/>/g)!.length, 3)
  assert.equal(notesOf(parseMusicXml(written).measures[4]!).filter((n) => n.arpeggio).length, 1)
})

test('marks: a multi-measure rest is written as <multiple-rest> in the first bar, last in its attributes', () => {
  const written = compact(serializeMusicXml(marksScore()))
  assert.equal(written.match(/<multiple-rest>/g)!.length, 1)
  const bar8 = /<measure number="8">([^]*?)<\/measure>/.exec(written)![1]!
  assert.match(bar8, /^<attributes><measure-style><multiple-rest>4<\/multiple-rest><\/measure-style><\/attributes>/)
  // the bars stay: 4 explicit whole-bar rests
  assert.equal(written.match(/<rest measure="yes"\/>/g)!.length, 4)
  assert.equal(parseMusicXml(written).measures[7]!.multiRest, 4)
})

test('marks: a run with a note in it is written without <multiple-rest>, and keeps multiRest in the model', () => {
  const s = marksScore()
  const bar10 = measure(s.measures, 9)
  bar10.items = [{ ...nth(measure(s.measures, 6), 0), id: 'extra' }]
  assert.deepEqual(multiRestRuns(s), [])
  assert.equal(multiRestHolds(s, 7), false)
  const written = serializeMusicXml(s)
  assert.ok(!/multiple-rest/.test(written))
  assert.equal(parseMusicXml(written).measures[7]!.multiRest, undefined, 'the file no longer says it')
  assert.equal(s.measures[7]!.multiRest, 4, 'the model is not changed by writing')
})

test('marks: any other item in a run breaks it: a barline, a direction, a clef, a second note, a fermata on the rest', () => {
  const broken = (change: (s: ReturnType<typeof marksScore>) => void): number => {
    const s = marksScore()
    change(s)
    return multiRestRuns(s).length
  }
  assert.equal(broken(() => {}), 1)
  assert.equal(broken((s) => { s.measures[9]!.rightBarline = { style: 'light-light' } }), 0)
  assert.equal(broken((s) => { s.measures[8]!.leftBarline = { repeat: 'forward' } }), 0)
  assert.equal(broken((s) => { s.measures[10]!.key = { fifths: 2 } }), 0)
  assert.equal(broken((s) => { s.measures[10]!.time = { beats: 3, beatType: 4 } }), 0)
  assert.equal(broken((s) => { s.measures[9]!.items.unshift({ kind: 'dynamic', id: 'dx', mark: 'f' }) }), 0)
  assert.equal(broken((s) => { (s.measures[9]!.items[0] as Note).fermata = true }), 0)
  assert.equal(broken((s) => { (s.measures[9]!.items[0] as Note).measureRest = false }), 0)
  assert.equal(broken((s) => { s.measures[7]!.multiRest = 5 }), 0, 'a run that is longer than its rests')
  assert.equal(broken((s) => { s.measures[7]!.multiRest = 1 }), 0, 'one bar is not a multi-measure rest')

  // A clef, key or time on the run's first bar is drawn before the symbol: the run still holds.
  assert.equal(broken((s) => { s.measures[7]!.clef = { sign: 'F', line: 4 }; s.measures[7]!.key = { fifths: 2 }; s.measures[7]!.time = { beats: 3, beatType: 4 } }), 1)
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
