import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Measure, Note } from '../src/core/score/model.ts'
import { isNote, isWedge, notesOf } from '../src/core/score/model.ts'
import { parseMusicXml, serializeMusicXml } from '../src/core/score/musicxml.ts'
import { eq, frac } from '../src/core/score/rational.ts'
import { barLength } from '../src/core/score/repairs.ts'
import { COMMITTED_FIXTURE, LOCAL_PAGE, read, skipUnless } from './helpers.ts'

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
  assert.deepEqual(tempo, { kind: 'tempo', words: 'Moderato', beatUnit: 'quarter', perMinute: 96, soundTempo: 96 })
  assert.deepEqual(m1.items.filter((i) => i.kind === 'dynamic'), [{ kind: 'dynamic', mark: 'mf' }])
  assert.deepEqual(m3.items.filter((i) => i.kind === 'dynamic'), [{ kind: 'dynamic', mark: 'p' }])
  assert.deepEqual(m3.items.filter((i) => i.kind === 'words'), [{ kind: 'words', text: 'dolce' }])

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
  assert.deepEqual(measure(s.measures, 0).items.filter((i) => i.kind === 'dynamic'), [{ kind: 'dynamic', mark: 'mp' }])
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
