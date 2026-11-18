import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { TENOR_SAX } from '../src/core/instruments/instruments.ts'
import { appendPages, inForceAtEnd, mergePages, preparePages } from '../src/core/pages/pages.ts'
import type { Score, WedgeItem } from '../src/core/score/model.ts'
import { isWedge, notesOf } from '../src/core/score/model.ts'
import { parseMusicXml, serializeMusicXml } from '../src/core/score/musicxml.ts'
import { prepareRecognisedScore } from '../src/core/score/prepare.ts'
import { computeWarnings } from '../src/core/score/warnings.ts'
import { TWO_PAGE_IMAGES, TWO_PAGE_MERGED, TWO_PAGE_READINGS, twoPageMerged } from './fixtures/make-two-page.ts'
import { eighths, note, quarters, read } from './helpers.ts'

// Merging the readings of the pages of a piece (practice-app design D6, tasks 6.1 to 6.3).

// --- builders: one reading of one page, as MusicXML (divisions 12: quarter = 12) ---

interface PageOptions {
  /** `fifths` of the key at the top of the page, or none. */
  key?: number
  time?: [number, number]
  /** Written at the top of the page; none for a page that gives no clef. */
  clef?: 'G' | 'F'
  /** Raw `<attributes>` content added to the bar with this index (a mid-page change). */
  extra?: Record<number, string>
}

const KEY = (fifths: number): string => `<key><fifths>${fifths}</fifths></key>`
const TIME = (beats: number, beatType: number): string => `<time><beats>${beats}</beats><beat-type>${beatType}</beat-type></time>`

/** A page reading: the bars are `<measure>` bodies. By default it starts with a treble clef and one sharp, as printed music does. */
function page(bars: string[], options: PageOptions = {}): string {
  const { key = 1, time, clef = 'G', extra = {} } = options
  const top = `<divisions>12</divisions>${key === undefined ? '' : KEY(key)}${time ? TIME(time[0], time[1]) : ''}${
    clef === 'G' ? '<clef><sign>G</sign><line>2</line></clef>' : '<clef><sign>F</sign><line>4</line></clef>'
  }`
  const body = bars.map((b, i) => {
    const attrs = `${i === 0 ? top : ''}${extra[i] ?? ''}`
    return `<measure number="${i + 1}">${attrs ? `<attributes>${attrs}</attributes>` : ''}${b}</measure>`
  })
  return (
    `<?xml version="1.0"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Voice</part-name></score-part></part-list>` +
    `<part id="P1">${body.join('')}</part></score-partwise>`
  )
}

/** `n` bars of three quarter notes. */
const threeQuarters = (n: number): string[] => Array.from({ length: n }, () => quarters(3))

const q = (step: string): string => note({ step, type: 'quarter' })
const wedge = (type: string): string => `<direction placement="below"><direction-type><wedge type="${type}" number="1"/></direction-type></direction>`

const parsed = (xml: string): Score => parseMusicXml(xml)
const ids = (s: Score): string[] => s.measures.flatMap(notesOf).map((n) => n.id)

/** Where a clef, key or time signature is set: `bar:what`. */
function attributesSet(s: Score): string[] {
  return s.measures.flatMap((m) => [...(m.clef ? [`${m.number}:clef`] : []), ...(m.key ? [`${m.number}:key`] : []), ...(m.time ? [`${m.number}:time`] : [])])
}

const wedgesOf = (s: Score): { type: string; from: string; to: string }[] => {
  const step = new Map(s.measures.flatMap(notesOf).map((n) => [n.id, `${n.pitch?.step}${s.measures.findIndex((m) => notesOf(m).includes(n)) + 1}`]))
  return s.measures.flatMap((m) => m.items.filter(isWedge)).map((w: WedgeItem) => ({ type: w.type, from: step.get(w.start) ?? '?', to: step.get(w.stop) ?? '?' }))
}

// --- 6.1: merging the pages ---

test('pages: 8 + 6 bars give bars 1 to 14, and each page knows its range', () => {
  const result = preparePages([page(threeQuarters(8), { time: [3, 4] }), page(threeQuarters(6), { time: [3, 4] })])
  const merged = parsed(result.musicxml)
  assert.equal(result.bars, 14)
  assert.deepEqual(merged.measures.map((m) => m.number), Array.from({ length: 14 }, (_, i) => String(i + 1)))
  assert.deepEqual(result.pages, [{ firstBar: 1, lastBar: 8 }, { firstBar: 9, lastBar: 14 }])
  assert.deepEqual(result.repairs, [])
})

test('pages: bars are numbered by position, whatever numbers the readings gave them', () => {
  const { score, ranges } = mergePages([parsed(page(threeQuarters(2))), parsed(page(threeQuarters(3))), parsed(page(threeQuarters(1)))])
  assert.deepEqual(score.measures.map((m) => m.number), ['1', '2', '3', '4', '5', '6'])
  assert.deepEqual(ranges, [{ firstBar: 1, lastBar: 2 }, { firstBar: 3, lastBar: 5 }, { firstBar: 6, lastBar: 6 }])
})

test('pages: a clef, key and time signature repeated at the top of page 2 give no change at bar 9', () => {
  const result = preparePages([page(threeQuarters(8), { time: [3, 4] }), page(threeQuarters(6), { time: [3, 4] })])
  assert.deepEqual(attributesSet(parsed(result.musicxml)), ['1:clef', '1:key', '1:time'])
})

test('pages: a key repeated at the top of page 2, and nothing else repeated, drops only the key', () => {
  const merged = parsed(preparePages([page(threeQuarters(8), { time: [3, 4] }), page(threeQuarters(6), { time: [3, 4], clef: 'F' })]).musicxml)
  assert.deepEqual(attributesSet(merged), ['1:clef', '1:key', '1:time', '9:clef'])
  assert.equal(merged.measures[8]?.clef?.sign, 'F')
})

test('pages: what differs at the top of page 2 is kept, as a change', () => {
  const merged = parsed(preparePages([page(threeQuarters(2), { time: [3, 4] }), page(threeQuarters(2), { key: 2, time: [4, 4], clef: 'F' })]).musicxml)
  assert.deepEqual(attributesSet(merged), ['1:clef', '1:key', '1:time', '3:clef', '3:key', '3:time'])
  assert.equal(merged.measures[2]?.key?.fifths, 2)
  assert.deepEqual(merged.measures[2]?.time, { beats: 4, beatType: 4 })
})

test('pages: only the top of a page is looked at; a repeated key inside a page stays', () => {
  const merged = parsed(preparePages([page(threeQuarters(2), { time: [3, 4] }), page(threeQuarters(3), { time: [3, 4], extra: { 1: KEY(1) } })]).musicxml)
  assert.deepEqual(attributesSet(merged), ['1:clef', '1:key', '1:time', '4:key'])
})

test('pages: equal means the same music (default clef line, key mode, time symbol and inferred mark do not count)', () => {
  const first = parsed(page(threeQuarters(1)))
  first.measures[0]!.clef = { sign: 'G', line: 2 }
  first.measures[0]!.key = { fifths: 1 }
  first.measures[0]!.time = { beats: 4, beatType: 4, symbol: 'common', inferred: true }
  const second = parsed(page(threeQuarters(1)))
  second.measures[0]!.clef = { sign: 'G' }
  second.measures[0]!.key = { fifths: 1, mode: 'major' }
  second.measures[0]!.time = { beats: 4, beatType: 4 }
  assert.deepEqual(attributesSet(mergePages([first, second]).score), ['1:clef', '1:key', '1:time'])

  const third = parsed(page(threeQuarters(1)))
  third.measures[0]!.clef = { sign: 'G', line: 2, octaveChange: -1 }
  third.measures[0]!.key = { fifths: 1, mode: 'minor' }
  third.measures[0]!.time = { beats: 2, beatType: 4 }
  first.measures[0]!.key = { fifths: 1, mode: 'major' }
  assert.deepEqual(attributesSet(mergePages([first, third]).score), ['1:clef', '1:key', '1:time', '2:clef', '2:key', '2:time'])
})

test('pages: notes get new ids, unique over the pages, and the readings are not changed', () => {
  // The parser numbers each page from n1, so the readings share their ids.
  const first = parsed(page(threeQuarters(2)))
  const second = parsed(page(threeQuarters(2)))
  assert.deepEqual(ids(first), ids(second))
  const before = structuredClone([first, second])
  const { score } = mergePages([first, second])
  assert.deepEqual(ids(score), ['n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7', 'n8', 'n9', 'n10', 'n11', 'n12'])
  assert.equal(new Set(ids(score)).size, 12)
  assert.deepEqual([first, second], before)
  // They stay unique through writing and reading, and in the prepared piece.
  const prepared = parsed(preparePages([page(threeQuarters(2)), page(threeQuarters(2))]).musicxml)
  assert.equal(new Set(ids(prepared)).size, 12)
})

test('pages: a hairpin keeps its notes on every page, whatever the pages call them', () => {
  const first = page([wedge('crescendo') + q('A') + q('B') + wedge('stop') + q('C'), quarters(3)])
  const second = page([wedge('diminuendo') + q('D') + q('E') + q('F') + wedge('stop'), quarters(3)])
  const merged = parsed(preparePages([first, second]).musicxml)
  assert.deepEqual(wedgesOf(merged), [
    { type: 'crescendo', from: 'A1', to: 'B1' },
    { type: 'diminuendo', from: 'D3', to: 'F3' },
  ])
  // Page 2's hairpin is not tied to page 1's notes, which had the same ids in the readings.
  assert.deepEqual(wedgesOf(parsed(serializeMusicXml(mergePages([parsed(first), parsed(second)]).score))), wedgesOf(merged))
})

test('pages: a hairpin whose ends are not on its page is dropped, not tied to a note of another page', () => {
  const lone = parsed(page([quarters(3)]))
  lone.measures[0]!.items.unshift({ kind: 'wedge', type: 'crescendo', start: 'n1', stop: 'n9' })
  const { score } = mergePages([parsed(page([quarters(3)])), lone])
  assert.deepEqual(score.measures.flatMap((m) => m.items.filter(isWedge)), [])
})

/** A bar with what a reading can carry besides plain notes: a dynamic, a slur, a tie, staccato, a triplet, a repeat and an ending. */
const MARKED =
  '<barline location="left"><bar-style>heavy-light</bar-style><repeat direction="forward"/></barline>' +
  '<direction placement="below"><direction-type><dynamics><mf/></dynamics></direction-type></direction>' +
  note({ step: 'A', type: 'quarter' }).replace('<staff>', '<notations><slur type="start" number="1"/><articulations><staccato/></articulations></notations><staff>') +
  note({ step: 'B', type: 'quarter' }).replace('</note>', '<tie type="start"/></note>').replace('<staff>', '<notations><slur type="stop" number="1"/></notations><staff>') +
  note({ step: 'B', type: 'eighth', triplet: true }).repeat(3) +
  '<barline location="right"><ending number="1" type="stop"/><repeat direction="backward"/></barline>'

test('pages: slurs, ties, tuplets, marks, dynamics and barlines go through as read', () => {
  const withoutIds = (s: Score) => JSON.parse(JSON.stringify(s.measures, (key, value: unknown) => (key === 'id' ? undefined : value))) as unknown
  const reading = parsed(page([MARKED]))
  assert.ok(notesOf(reading.measures[0]!).some((n) => n.slurs.length > 0 && n.staccato))
  assert.ok(notesOf(reading.measures[0]!).some((n) => n.tieStart))
  const merged = mergePages([reading, reading]).score
  assert.deepEqual(merged.measures.map((m) => m.number), ['1', '2'])
  assert.deepEqual(withoutIds({ measures: [merged.measures[1]!] }), withoutIds({ measures: [{ ...reading.measures[0]!, number: '2', clef: undefined, key: undefined }] }))
})

test('pages: a page with no bars, no page at all, and a reading that is not MusicXML are errors that name the page', () => {
  assert.throws(() => mergePages([parsed(page(threeQuarters(1))), { measures: [] }]), /Page 2 has no bars/)
  assert.throws(() => preparePages([]), /No pages/)
  assert.throws(() => appendPages(page(threeQuarters(1)), []), /No pages/)
  assert.throws(() => preparePages([page(threeQuarters(1)), '<nope/>']), /Page 2: Not MusicXML/)
  assert.throws(() => appendPages(page(threeQuarters(1)), [page(threeQuarters(1)), page(threeQuarters(1)), 'oops']), /Page 3:/)
})

test('pages: the title and part name are the first page\'s', () => {
  const first = parsed(page(threeQuarters(1)))
  first.title = 'Exercise 42'
  first.partName = 'Tenor'
  const second = parsed(page(threeQuarters(1)))
  second.title = 'Other'
  const { score } = mergePages([first, second])
  assert.equal(score.title, 'Exercise 42')
  assert.equal(score.partName, 'Tenor')
})

// --- 6.2: the repairs run on the merged score ---

/** Page 2 as a continuation page is printed: no time signature at its top. Bars 1 and 3 are 6 plain eighths and a quarter (4 quarters long). */
const CONTINUATION = [eighths(6) + note({ step: 'G', type: 'quarter' }), quarters(3), eighths(6) + note({ step: 'G', type: 'quarter' })]

test('pages: page 2 without a time signature is checked against page 1\'s 3/4 and gets no inferred flag', () => {
  const first = page(threeQuarters(8), { time: [3, 4] })
  const second = page(CONTINUATION)
  const result = preparePages([first, second])
  const merged = parsed(result.musicxml)
  // Checked against 3/4: bars 9 and 11 are too long, and each holds two groups of three eighths that are triplets.
  assert.deepEqual(result.repairs.map((r) => r.bar), ['9', '11'])
  assert.deepEqual(merged.measures.slice(8).map((m) => notesOf(m).filter((n) => n.timeMod).length), [6, 0, 6])
  // No time signature was inferred for page 2: the only one is page 1's, as read.
  assert.deepEqual(attributesSet(merged), ['1:clef', '1:key', '1:time'])
  assert.deepEqual(merged.measures[0]?.time, { beats: 3, beatType: 4 })
  assert.ok(!result.musicxml.includes('time-signature-inferred'))
  assert.deepEqual(computeWarnings(merged, TENOR_SAX), [])
  // Prepared on its own, the same page is read as 4/4: two of its three bars are that long, so a time signature is inferred, and flagged.
  const alone = parsed(prepareRecognisedScore(second).musicxml)
  assert.deepEqual(alone.measures[0]?.time, { beats: 4, beatType: 4, inferred: true })
})

test('pages: no time signature on any page gives one inferred from all the bars, at the first bar only', () => {
  const merged = parsed(preparePages([page(threeQuarters(5)), page(threeQuarters(1))]).musicxml)
  assert.deepEqual(attributesSet(merged), ['1:clef', '1:key', '1:time'])
  assert.deepEqual(merged.measures[0]?.time, { beats: 3, beatType: 4, inferred: true })
})

test('pages: preparing the merged pages is the pipeline of a single page, run on the merged score', () => {
  const raw = [page(threeQuarters(8), { time: [3, 4] }), page(CONTINUATION)]
  const { score } = mergePages(raw.map(parsed))
  const literal = prepareRecognisedScore(serializeMusicXml(score))
  const result = preparePages(raw)
  assert.equal(result.musicxml, literal.musicxml)
  assert.deepEqual(result.repairs, literal.repairs)
  assert.equal(result.bars, literal.bars)
  // The prepared score is a fixed point of writing and reading.
  assert.equal(serializeMusicXml(parsed(result.musicxml)), result.musicxml)
})

// --- 6.2: adding pages to an existing, corrected score ---

/** A corrected piece in 3/4 with one bar the repairs would change (six plain eighths and a quarter): the user left it. */
const EXISTING = page([...threeQuarters(2), eighths(6) + note({ step: 'G', type: 'quarter' }), ...threeQuarters(5)], { time: [3, 4] })

test('pages: adding a page leaves the existing bars as they were, with their ids and corrections', () => {
  const before = parsed(EXISTING)
  const result = appendPages(EXISTING, [page(threeQuarters(6), { time: [3, 4] })])
  const after = parsed(result.musicxml)
  assert.equal(result.bars, 14)
  assert.deepEqual(after.measures.slice(0, 8), before.measures)
  assert.deepEqual(result.pages, [{ firstBar: 9, lastBar: 14 }])
  // Bar 3 would be repaired by the pipeline; it was not touched.
  assert.equal(notesOf(after.measures[2]!).filter((n) => n.timeMod).length, 0)
  assert.deepEqual(result.repairs, [])
})

test('pages: the pages added are checked against the time signature in force at the end of the piece, and only they are repaired', () => {
  const result = appendPages(EXISTING, [page(CONTINUATION)])
  const after = parsed(result.musicxml)
  assert.deepEqual(result.repairs.map((r) => r.bar), ['9', '11'])
  assert.deepEqual(after.measures.slice(8).map((m) => notesOf(m).filter((n) => n.timeMod).length), [6, 0, 6])
  assert.deepEqual(attributesSet(after), ['1:clef', '1:key', '1:time'])
  assert.deepEqual(result.pages, [{ firstBar: 9, lastBar: 11 }])
})

test('pages: the time signature in force is the last one set, also when it was set in the middle of the piece', () => {
  const existing = page([...threeQuarters(2), quarters(2), quarters(2)], { time: [3, 4], extra: { 2: TIME(2, 4) } })
  assert.deepEqual(inForceAtEnd(parsed(existing)).time, { beats: 2, beatType: 4 })
  // Page 2's bars are two quarters long: they agree with the 2/4 in force and need nothing; a repeated 2/4 at its top is dropped.
  const result = appendPages(existing, [page([quarters(2)], { time: [2, 4] })])
  assert.deepEqual(attributesSet(parsed(result.musicxml)), ['1:clef', '1:key', '1:time', '3:time'])
})

test('pages: a clef, key or time signature at the top of the added pages that repeats the one in force is dropped, a different one is kept', () => {
  const same = parsed(appendPages(EXISTING, [page(threeQuarters(2), { time: [3, 4] })]).musicxml)
  assert.deepEqual(attributesSet(same), ['1:clef', '1:key', '1:time'])
  const different = parsed(appendPages(EXISTING, [page(threeQuarters(2), { key: 0, time: [3, 4] })]).musicxml)
  assert.deepEqual(attributesSet(different), ['1:clef', '1:key', '1:time', '9:key'])
  assert.equal(different.measures[8]?.key?.fifths, 0)
})

test('pages: the new notes get ids that do not clash with the piece\'s, whatever the piece calls its notes', () => {
  const existing = parsed(EXISTING)
  const edited = notesOf(existing.measures[0]!)
  edited[0]!.id = 'e7'
  edited[1]!.id = 'n99'
  const before = ids(existing)
  const result = appendPages(serializeMusicXml(existing), [page(threeQuarters(2)), page(threeQuarters(2))])
  const after = ids(parsed(result.musicxml))
  assert.equal(new Set(after).size, after.length)
  assert.deepEqual(after.slice(0, before.length), before)
  assert.equal(after.length, before.length + 12)
  assert.ok(after.slice(before.length).every((id) => !before.includes(id)))
})

test('pages: pages added to a piece whose time signature was inferred are checked against it; the mark stays where it was', () => {
  const existing = preparePages([page(threeQuarters(5))])
  assert.ok(existing.musicxml.includes('time-signature-inferred'))
  const result = appendPages(existing.musicxml, [page(CONTINUATION)])
  const after = parsed(result.musicxml)
  assert.deepEqual(result.repairs.map((r) => r.bar), ['6', '8'])
  assert.deepEqual(attributesSet(after), ['1:clef', '1:key', '1:time'])
  assert.deepEqual(after.measures[0]?.time, { beats: 3, beatType: 4, inferred: true })
})

test('pages: with no time signature in force and none on the new pages, none is inferred in the middle of the piece', () => {
  const existing = serializeMusicXml(parsed(page([quarters(3), quarters(4), quarters(2)])))
  const result = appendPages(existing, [page(threeQuarters(3))])
  assert.deepEqual(attributesSet(parsed(result.musicxml)), ['1:clef', '1:key'])
  assert.deepEqual(result.repairs, [])
  // A time signature on the new pages is used, as it would be on any page.
  const explicit = appendPages(existing, [page([eighths(6) + note({ step: 'G', type: 'quarter' })], { time: [3, 4] })])
  assert.deepEqual(explicit.repairs.map((r) => r.bar), ['4'])
})

// --- 10.4: a time signature the reader estimated (design D7) ---

/** `n` bars of six eighths: 6/8, and as long as 3/4. */
const sixEighths = (n: number): string[] => Array.from({ length: n }, () => eighths(6))

test('pages: an estimated 3/4 at the top of page 2 after a 6/8 page 1 counts as absent: no time change', () => {
  const raw = [page(sixEighths(4), { time: [6, 8] }), page(sixEighths(3), { time: [3, 4] })]
  // As read, with nothing said about the estimate, page 2's 3/4 differs from 6/8 and is kept, as a change.
  assert.deepEqual(attributesSet(parsed(preparePages(raw).musicxml)), ['1:clef', '1:key', '1:time', '5:time'])
  const result = preparePages(raw, [{ timeEstimated: false }, { timeEstimated: true }])
  const merged = parsed(result.musicxml)
  assert.deepEqual(attributesSet(merged), ['1:clef', '1:key', '1:time'])
  assert.deepEqual(merged.measures[0]?.time, { beats: 6, beatType: 8 })
  assert.deepEqual(result.repairs, [])
})

test('pages: an estimated time on the first page counts as absent: it is inferred, and marked inferred', () => {
  const raw = [page(threeQuarters(4), { time: [4, 4] }), page(threeQuarters(2))]
  const result = preparePages(raw, [{ timeEstimated: true }])
  const merged = parsed(result.musicxml)
  assert.deepEqual(attributesSet(merged), ['1:clef', '1:key', '1:time'])
  assert.deepEqual(merged.measures[0]?.time, { beats: 3, beatType: 4, inferred: true })
  assert.ok(result.musicxml.includes('time-signature-inferred'))
  assert.deepEqual(result.repairs, [])
  // Taken as read, the 4/4 stays.
  assert.deepEqual(parsed(preparePages(raw, [{ timeEstimated: false }]).musicxml).measures[0]?.time, { beats: 4, beatType: 4 })
})

test('pages: an estimated time at the top of added pages counts as absent: the time in force carries on', () => {
  const existing = preparePages([page(sixEighths(2), { time: [6, 8] })]).musicxml
  const added = page(sixEighths(2), { time: [3, 4] })
  assert.deepEqual(attributesSet(parsed(appendPages(existing, [added]).musicxml)), ['1:clef', '1:key', '1:time', '3:time'])
  const result = appendPages(existing, [added], [{ timeEstimated: true }])
  assert.deepEqual(attributesSet(parsed(result.musicxml)), ['1:clef', '1:key', '1:time'])
  assert.deepEqual(result.pages, [{ firstBar: 3, lastBar: 4 }])
})

test('pages: adding to a piece with no bars makes a new piece', () => {
  const empty = serializeMusicXml({ measures: [] })
  assert.deepEqual(appendPages(empty, [page(threeQuarters(2))]), preparePages([page(threeQuarters(2))]))
})

// --- 6.3: the two-page fixture ---

/** The exercise of the fixture, as engraved by tools/pages/make_two_page_fixture.py: written pitch and value per note (e = eighth, q = quarter, h. = dotted half, t = triplet eighth). */
const EXERCISE: string[][] = [
  ['G4 q', 'B4 q', 'D5 q'],
  ['E5 q', 'D5 q', 'B4 q'],
  ['G4 e', 'A4 e', 'B4 e', 'C5 e', 'D5 q'],
  ['G4 h.'],
  ['A4 e', 'B4 e', 'C5 e', 'D5 e', 'E5 q'],
  ['D5 q', 'B4 q', 'G4 q'],
  ['B4 e', 'C5 e', 'D5 e', 'E5 e', 'D5 q'],
  ['B4 h', 'A4 q'],
  // page 2
  ['B4 q', 'D5 q', 'G5 q'],
  ['F#5 q', 'E5 q', 'D5 q'],
  ['C5 t', 'D5 t', 'E5 t', 'F#5 t', 'G5 t', 'A5 t', 'B5 q'],
  ['D5 q', 'B4 q', 'G4 q'],
  ['A4 q', 'B4 q', 'C5 q'],
  ['G4 h.'],
]

/** The notes of a bar in the spelling of EXERCISE. */
function spelled(measure: Score['measures'][number]): string[] {
  const short: Record<string, string> = { quarter: 'q', eighth: 'e', half: 'h' }
  return notesOf(measure).map((n) => {
    const p = n.pitch!
    const value = n.timeMod ? 't' : `${short[n.type!]}${'.'.repeat(n.dots)}`
    return `${p.step}${p.alter === 1 ? '#' : ''}${p.octave} ${value}`
  })
}

test('fixture: two page images and homr\'s reading of each', () => {
  for (const image of TWO_PAGE_IMAGES) {
    assert.ok(existsSync(image), image)
    assert.deepEqual([...readFileSync(image).subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'a PNG')
  }
  const [one, two] = TWO_PAGE_READINGS.map((path) => parsed(read(path)))
  assert.equal(one!.measures.length, 8)
  assert.equal(two!.measures.length, 6)
  // homr starts every reading with a clef, a key and a time signature; page 2 is read as 3/4 as well, though none is printed on it.
  for (const reading of [one!, two!]) {
    assert.deepEqual(reading.measures[0]?.clef, { sign: 'G', line: 2 })
    assert.deepEqual(reading.measures[0]?.key, { fifths: 1 })
    assert.deepEqual(reading.measures[0]?.time, { beats: 3, beatType: 4 })
  }
  // Both readings number their notes from the start, so the ids clash until the pages are merged.
  assert.deepEqual(ids(one!).slice(0, 3), ids(two!).slice(0, 3))
})

test('fixture: the committed merged score is what the two readings give', () => {
  assert.equal(read(TWO_PAGE_MERGED), twoPageMerged(), 'run: node test/fixtures/make-two-page.ts')
})

test('fixture: the merged score is the exercise in 14 bars, with its clef, key and time signature once', () => {
  const result = preparePages(TWO_PAGE_READINGS.map((path) => read(path)))
  assert.equal(result.bars, 14)
  assert.deepEqual(result.pages, [{ firstBar: 1, lastBar: 8 }, { firstBar: 9, lastBar: 14 }])
  assert.deepEqual(result.repairs, [])
  const merged = parsed(read(TWO_PAGE_MERGED))
  assert.deepEqual(merged.measures.map((m) => m.number), Array.from({ length: 14 }, (_, i) => String(i + 1)))
  assert.deepEqual(merged.measures.map(spelled), EXERCISE)
  assert.deepEqual(attributesSet(merged), ['1:clef', '1:key', '1:time'])
  assert.deepEqual(merged.measures[0]?.time, { beats: 3, beatType: 4 })
  assert.equal(new Set(ids(merged)).size, EXERCISE.flat().length)
  assert.deepEqual(computeWarnings(merged, TENOR_SAX), [])
  // What the pages had besides notes: dynamics, slurs, staccato, triplets.
  assert.deepEqual(merged.measures.flatMap((m, i) => m.items.filter((item) => item.kind === 'dynamic').map((item) => `${i + 1}:${item.kind === 'dynamic' ? item.mark : ''}`)), ['1:mf', '12:p'])
  assert.equal(notesOf(merged.measures[2]!).filter((n) => n.slurs.length > 0).length, 2)
  assert.equal(notesOf(merged.measures[4]!).filter((n) => n.staccato).length, 4)
  assert.equal(notesOf(merged.measures[10]!).filter((n) => n.timeMod?.actual === 3).length, 6)
  assert.equal(merged.measures[13]?.rightBarline?.style, 'heavy-heavy')
})

test('fixture: adding page 2 to the piece made of page 1 gives the same score as merging both at once', () => {
  const [first, second] = TWO_PAGE_READINGS.map((path) => read(path))
  const piece = preparePages([first!])
  assert.equal(piece.bars, 8)
  const added = appendPages(piece.musicxml, [second!])
  assert.equal(added.musicxml, read(TWO_PAGE_MERGED))
  assert.deepEqual(added.pages, [{ firstBar: 9, lastBar: 14 }])
  assert.equal(added.bars, 14)
})

test('fixture: page 2\'s 3/4 is homr\'s estimate (tools/homr/staff_positions.py); treated as absent, the merged score is the same', () => {
  const readings = TWO_PAGE_READINGS.map((path) => read(path))
  const options = [{ timeEstimated: false }, { timeEstimated: true }]
  assert.equal(preparePages(readings, options).musicxml, read(TWO_PAGE_MERGED))
  const piece = preparePages([readings[0]!], [options[0]!])
  assert.equal(appendPages(piece.musicxml, [readings[1]!], [options[1]!]).musicxml, read(TWO_PAGE_MERGED))
})
