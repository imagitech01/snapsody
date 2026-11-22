import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { TENOR_SAX } from '../src/core/instruments/instruments.ts'
import { appendPages, inForceAtEnd, mergePages, preparePages } from '../src/core/pages/pages.ts'
import type { PartRead } from '../src/core/pages/pages.ts'
import type { Score, VoiceScore, WedgeItem } from '../src/core/score/model.ts'
import { allItemLists, isNote, isWedge, notesOf, singleVoiceScore } from '../src/core/score/model.ts'
import { parseMusicXml, serializeMusicXml } from '../src/core/score/musicxml.ts'
import { prepareRecognisedScore } from '../src/core/score/prepare.ts'
import { computeWarnings } from '../src/core/score/warnings.ts'
import { TWO_PAGE_IMAGES, TWO_PAGE_MERGED, TWO_PAGE_READINGS, twoPageMerged } from './fixtures/make-two-page.ts'
import { eighths, note, quarters, read } from './helpers.ts'
import { firstLine, setAttr } from './helpers.ts'

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
const ids = (s: Score): string[] => firstLine(s).measures.flatMap(notesOf).map((n) => n.id)

/** Where a clef, key or time signature is set: `bar:what`. */
function attributesSet(s: Score): string[] {
  return firstLine(s).measures.flatMap((m) => [...(m.clef ? [`${m.number}:clef`] : []), ...(m.key ? [`${m.number}:key`] : []), ...(m.time ? [`${m.number}:time`] : [])])
}

const wedgesOf = (s: Score): { type: string; from: string; to: string }[] => {
  const step = new Map(firstLine(s).measures.flatMap(notesOf).map((n) => [n.id, `${n.pitch?.step}${firstLine(s).measures.findIndex((m) => notesOf(m).includes(n)) + 1}`]))
  return firstLine(s).measures.flatMap((m) => m.items.filter(isWedge)).map((w: WedgeItem) => ({ type: w.type, from: step.get(w.start) ?? '?', to: step.get(w.stop) ?? '?' }))
}

// --- 6.1: merging the pages ---

test('pages: 8 + 6 bars give bars 1 to 14, and each page knows its range', () => {
  const result = preparePages([page(threeQuarters(8), { time: [3, 4] }), page(threeQuarters(6), { time: [3, 4] })])
  const merged = parsed(result.musicxml)
  assert.equal(result.bars, 14)
  assert.deepEqual(firstLine(merged).measures.map((m) => m.number), Array.from({ length: 14 }, (_, i) => String(i + 1)))
  assert.deepEqual(result.pages, [{ firstBar: 1, lastBar: 8 }, { firstBar: 9, lastBar: 14 }])
  assert.deepEqual(result.repairs, [])
})

test('pages: bars are numbered by position, whatever numbers the readings gave them', () => {
  const { score, ranges } = mergePages([parsed(page(threeQuarters(2))), parsed(page(threeQuarters(3))), parsed(page(threeQuarters(1)))])
  assert.deepEqual(firstLine(score).measures.map((m) => m.number), ['1', '2', '3', '4', '5', '6'])
  assert.deepEqual(ranges, [{ firstBar: 1, lastBar: 2 }, { firstBar: 3, lastBar: 5 }, { firstBar: 6, lastBar: 6 }])
})

test('pages: a clef, key and time signature repeated at the top of page 2 give no change at bar 9', () => {
  const result = preparePages([page(threeQuarters(8), { time: [3, 4] }), page(threeQuarters(6), { time: [3, 4] })])
  assert.deepEqual(attributesSet(parsed(result.musicxml)), ['1:clef', '1:key', '1:time'])
})

test('pages: a key repeated at the top of page 2, and nothing else repeated, drops only the key', () => {
  const merged = parsed(preparePages([page(threeQuarters(8), { time: [3, 4] }), page(threeQuarters(6), { time: [3, 4], clef: 'F' })]).musicxml)
  assert.deepEqual(attributesSet(merged), ['1:clef', '1:key', '1:time', '9:clef'])
  assert.equal(firstLine(merged).measures[8]?.clef?.sign, 'F')
})

test('pages: what differs at the top of page 2 is kept, as a change', () => {
  const merged = parsed(preparePages([page(threeQuarters(2), { time: [3, 4] }), page(threeQuarters(2), { key: 2, time: [4, 4], clef: 'F' })]).musicxml)
  assert.deepEqual(attributesSet(merged), ['1:clef', '1:key', '1:time', '3:clef', '3:key', '3:time'])
  assert.equal(firstLine(merged).measures[2]?.key?.fifths, 2)
  assert.deepEqual(firstLine(merged).measures[2]?.time, { beats: 4, beatType: 4 })
})

test('pages: only the top of a page is looked at; a repeated key inside a page stays', () => {
  const merged = parsed(preparePages([page(threeQuarters(2), { time: [3, 4] }), page(threeQuarters(3), { time: [3, 4], extra: { 1: KEY(1) } })]).musicxml)
  assert.deepEqual(attributesSet(merged), ['1:clef', '1:key', '1:time', '4:key'])
})

test('pages: equal means the same music (default clef line, key mode, time symbol and inferred mark do not count)', () => {
  const first = parsed(page(threeQuarters(1)))
  setAttr(first, 0, 'clef', { sign: 'G', line: 2 })
  setAttr(first, 0, 'key', { fifths: 1 })
  setAttr(first, 0, 'time', { beats: 4, beatType: 4, symbol: 'common', inferred: true })
  const second = parsed(page(threeQuarters(1)))
  setAttr(second, 0, 'clef', { sign: 'G' })
  setAttr(second, 0, 'key', { fifths: 1, mode: 'major' })
  setAttr(second, 0, 'time', { beats: 4, beatType: 4 })
  assert.deepEqual(attributesSet(mergePages([first, second]).score), ['1:clef', '1:key', '1:time'])

  const third = parsed(page(threeQuarters(1)))
  setAttr(third, 0, 'clef', { sign: 'G', line: 2, octaveChange: -1 })
  setAttr(third, 0, 'key', { fifths: 1, mode: 'minor' })
  setAttr(third, 0, 'time', { beats: 2, beatType: 4 })
  setAttr(first, 0, 'key', { fifths: 1, mode: 'major' })
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
  firstLine(lone).measures[0]!.items.unshift({ kind: 'wedge', type: 'crescendo', start: 'n1', stop: 'n9' })
  const { score } = mergePages([parsed(page([quarters(3)])), lone])
  assert.deepEqual(firstLine(score).measures.flatMap((m) => m.items.filter(isWedge)), [])
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
  const withoutIds = (s: Pick<VoiceScore, 'measures'>) => JSON.parse(JSON.stringify(s.measures, (key, value: unknown) => (key === 'id' ? undefined : value))) as unknown
  const reading = parsed(page([MARKED]))
  assert.ok(notesOf(firstLine(reading).measures[0]!).some((n) => n.slurs.length > 0 && n.staccato))
  assert.ok(notesOf(firstLine(reading).measures[0]!).some((n) => n.tieStart))
  const merged = mergePages([reading, reading]).score
  assert.deepEqual(firstLine(merged).measures.map((m) => m.number), ['1', '2'])
  assert.deepEqual(withoutIds({ measures: [firstLine(merged).measures[1]!] }), withoutIds({ measures: [{ ...firstLine(reading).measures[0]!, number: '2', clef: undefined, key: undefined }] }))
})

test('pages: a slur over a page break is kept once the pages are merged; a slur that never ends is dropped', () => {
  const slurred = (step: string, type: string): string => note({ step, type: 'quarter' }).replace('<staff>', `<notations><slur type="${type}" number="1"/></notations><staff>`)
  const plain = (step: string): string => note({ step, type: 'quarter' })
  const one = page([plain('A') + plain('B') + slurred('C', 'start')], { time: [3, 4] }) // the slur goes on to page 2
  const two = page([slurred('D', 'stop') + slurred('E', 'start') + plain('F')], { time: [3, 4] }) // this one never ends
  const slurs = (xml: string): string[] => firstLine(parseMusicXml(xml)).measures.flatMap((m) => notesOf(m).flatMap((n) => n.slurs.map((s) => `${n.pitch?.step}:${s.type}`)))
  assert.deepEqual(slurs(preparePages([one, two]).musicxml), ['C:start', 'D:stop'])
  assert.deepEqual(slurs(appendPages(preparePages([one]).musicxml, [two]).musicxml), [], 'page 1 alone has a slur that never ends; once stored it is gone')
  assert.deepEqual(slurs(appendPages(preparePages([page([plain('G') + plain('A') + plain('B')], { time: [3, 4] })]).musicxml, [one, two]).musicxml), ['C:start', 'D:stop'])
})

test('pages: a page with no bars, no page at all, and a reading that is not MusicXML are errors that name the page', () => {
  assert.throws(() => mergePages([parsed(page(threeQuarters(1))), singleVoiceScore([])]), /Page 2 has no bars/)
  assert.throws(() => preparePages([]), /No pages/)
  assert.throws(() => appendPages(page(threeQuarters(1)), []), /No pages/)
  assert.throws(() => preparePages([page(threeQuarters(1)), '<nope/>']), /Page 2: Not MusicXML/)
  assert.throws(() => appendPages(page(threeQuarters(1)), [page(threeQuarters(1)), page(threeQuarters(1)), 'oops']), /Page 3:/)
})

test('pages: the title and part name are the first page\'s', () => {
  const first = parsed(page(threeQuarters(1)))
  first.title = 'Exercise 42'
  first.parts[0]!.name = 'Tenor'
  const second = parsed(page(threeQuarters(1)))
  second.title = 'Other'
  const { score } = mergePages([first, second])
  assert.equal(score.title, 'Exercise 42')
  assert.equal(firstLine(score).partName, 'Tenor')
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
  assert.deepEqual(firstLine(merged).measures.slice(8).map((m) => notesOf(m).filter((n) => n.timeMod).length), [6, 0, 6])
  // No time signature was inferred for page 2: the only one is page 1's, as read.
  assert.deepEqual(attributesSet(merged), ['1:clef', '1:key', '1:time'])
  assert.deepEqual(firstLine(merged).measures[0]?.time, { beats: 3, beatType: 4 })
  assert.ok(!result.musicxml.includes('time-signature-inferred'))
  assert.deepEqual(computeWarnings(firstLine(merged), TENOR_SAX), [])
  // Prepared on its own, the same page is read as 4/4: two of its three bars are that long, so a time signature is inferred, and flagged.
  const alone = parsed(prepareRecognisedScore(second).musicxml)
  assert.deepEqual(firstLine(alone).measures[0]?.time, { beats: 4, beatType: 4, inferred: true })
})

test('pages: no time signature on any page gives one inferred from all the bars, at the first bar only', () => {
  const merged = parsed(preparePages([page(threeQuarters(5)), page(threeQuarters(1))]).musicxml)
  assert.deepEqual(attributesSet(merged), ['1:clef', '1:key', '1:time'])
  assert.deepEqual(firstLine(merged).measures[0]?.time, { beats: 3, beatType: 4, inferred: true })
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
  assert.deepEqual(firstLine(after).measures.slice(0, 8), firstLine(before).measures)
  assert.deepEqual(result.pages, [{ firstBar: 9, lastBar: 14 }])
  // Bar 3 would be repaired by the pipeline; it was not touched.
  assert.equal(notesOf(firstLine(after).measures[2]!).filter((n) => n.timeMod).length, 0)
  assert.deepEqual(result.repairs, [])
})

test('pages: the pages added are checked against the time signature in force at the end of the piece, and only they are repaired', () => {
  const result = appendPages(EXISTING, [page(CONTINUATION)])
  const after = parsed(result.musicxml)
  assert.deepEqual(result.repairs.map((r) => r.bar), ['9', '11'])
  assert.deepEqual(firstLine(after).measures.slice(8).map((m) => notesOf(m).filter((n) => n.timeMod).length), [6, 0, 6])
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
  assert.equal(firstLine(different).measures[8]?.key?.fifths, 0)
})

test('pages: the new notes get ids that do not clash with the piece\'s, whatever the piece calls its notes', () => {
  const existing = parsed(EXISTING)
  const edited = notesOf(firstLine(existing).measures[0]!)
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
  assert.deepEqual(firstLine(after).measures[0]?.time, { beats: 3, beatType: 4, inferred: true })
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
  assert.deepEqual(firstLine(merged).measures[0]?.time, { beats: 6, beatType: 8 })
  assert.deepEqual(result.repairs, [])
})

test('pages: an estimated time on the first page counts as absent: it is inferred, and marked inferred', () => {
  const raw = [page(threeQuarters(4), { time: [4, 4] }), page(threeQuarters(2))]
  const result = preparePages(raw, [{ timeEstimated: true }])
  const merged = parsed(result.musicxml)
  assert.deepEqual(attributesSet(merged), ['1:clef', '1:key', '1:time'])
  assert.deepEqual(firstLine(merged).measures[0]?.time, { beats: 3, beatType: 4, inferred: true })
  assert.ok(result.musicxml.includes('time-signature-inferred'))
  assert.deepEqual(result.repairs, [])
  // Taken as read, the 4/4 stays.
  assert.deepEqual(firstLine(parsed(preparePages(raw, [{ timeEstimated: false }]).musicxml)).measures[0]?.time, { beats: 4, beatType: 4 })
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
  const empty = serializeMusicXml(singleVoiceScore([]))
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
function spelled(measure: VoiceScore['measures'][number]): string[] {
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
  assert.equal(firstLine(one!).measures.length, 8)
  assert.equal(firstLine(two!).measures.length, 6)
  // homr starts every reading with a clef, a key and a time signature; page 2 is read as 3/4 as well, though none is printed on it.
  for (const reading of [one!, two!]) {
    assert.deepEqual(firstLine(reading).measures[0]?.clef, { sign: 'G', line: 2 })
    assert.deepEqual(firstLine(reading).measures[0]?.key, { fifths: 1 })
    assert.deepEqual(firstLine(reading).measures[0]?.time, { beats: 3, beatType: 4 })
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
  assert.deepEqual(firstLine(merged).measures.map((m) => m.number), Array.from({ length: 14 }, (_, i) => String(i + 1)))
  assert.deepEqual(firstLine(merged).measures.map(spelled), EXERCISE)
  assert.deepEqual(attributesSet(merged), ['1:clef', '1:key', '1:time'])
  assert.deepEqual(firstLine(merged).measures[0]?.time, { beats: 3, beatType: 4 })
  assert.equal(new Set(ids(merged)).size, EXERCISE.flat().length)
  assert.deepEqual(computeWarnings(firstLine(merged), TENOR_SAX), [])
  // What the pages had besides notes: dynamics, slurs, staccato, triplets.
  assert.deepEqual(firstLine(merged).measures.flatMap((m, i) => m.items.filter((item) => item.kind === 'dynamic').map((item) => `${i + 1}:${item.kind === 'dynamic' ? item.mark : ''}`)), ['1:mf', '12:p'])
  assert.equal(notesOf(firstLine(merged).measures[2]!).filter((n) => n.slurs.length > 0).length, 2)
  assert.equal(notesOf(firstLine(merged).measures[4]!).filter((n) => n.staccato).length, 4)
  assert.equal(notesOf(firstLine(merged).measures[10]!).filter((n) => n.timeMod?.actual === 3).length, 6)
  assert.equal(firstLine(merged).measures[13]?.rightBarline?.style, 'heavy-heavy')
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

// ---- Parts across pages (change parts-and-accompaniment, task 3.3, design D4) ----------------------------------

/** A note of a quarter, in staff `staff` and voice `voice` (divisions 12), for the readings of several parts below. */
const pn = (step: string, octave: number, staff = 1, voice = 1): string =>
  `<note><pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>12</duration><voice>${voice}</voice><type>quarter</type><staff>${staff}</staff></note>`
const wholeRest = (staff = 1, voice = 1): string => `<note><rest measure="yes"/><duration>36</duration><voice>${voice}</voice><staff>${staff}</staff></note>`

/** A melody part (one staff) of the given bars, each three quarters long. */
function melodyPart(id: string, bars: string[]): string {
  const attrs = `<attributes><divisions>12</divisions><key><fifths>0</fifths></key><time><beats>3</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>`
  return `<part id="${id}">${bars.map((b, i) => `<measure number="${i + 1}">${i === 0 ? attrs : ''}${b}</measure>`).join('')}</part>`
}

/** A piano part (two staves) of the given bars: each bar is its right-hand and left-hand notes. */
function pianoPart(id: string, bars: [string, string][]): string {
  const attrs = `<attributes><divisions>12</divisions><staves>2</staves><key><fifths>0</fifths></key><time><beats>3</beats><beat-type>4</beat-type></time><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>`
  return `<part id="${id}">${bars.map(([rh, lh], i) => `<measure number="${i + 1}">${i === 0 ? attrs : ''}${rh}<backup><duration>36</duration></backup>${lh}</measure>`).join('')}</part>`
}

const reading = (...parts: string[]): string =>
  `<?xml version="1.0"?><score-partwise version="4.0"><part-list>${parts.map((_, i) => `<score-part id="P${i + 1}"/>`).join('')}</part-list>${parts.join('')}</score-partwise>`

/** Melody: C D E, one bar. Piano: the right hand F A C, the left hand F2 and a rest. */
const MEL_BAR = pn('C', 5) + pn('D', 5) + pn('E', 5)
const PIANO_BAR: [string, string] = [pn('F', 4) + pn('A', 4) + pn('C', 5), pn('F', 2, 2, 5) + pn('F', 2, 2, 5) + pn('F', 2, 2, 5)]
const step = (s: Score, bar: number, part: number, staff: number, voice = 0): string =>
  s.bars[bar]!.parts[part]!.staves[staff]!.voices[voice]!.filter(isNote).map((n) => (n.rest ? (n.measureRest ? 'R' : 'r') : n.pitch!.step)).join('')

test('pages: a melody that rests on page 2 gets whole-bar rests there, and the piano goes on', () => {
  const page1 = reading(melodyPart('P1', [MEL_BAR, MEL_BAR]), pianoPart('P2', [PIANO_BAR, PIANO_BAR]))
  const page2 = reading(pianoPart('P1', [PIANO_BAR, PIANO_BAR]))
  const prepared = preparePages([page1, page2])
  assert.deepEqual(prepared.warnings, [])
  assert.deepEqual(prepared.partsRead, [{ staves: 1, kept: true }, { staves: 2, kept: true }])
  assert.deepEqual(prepared.pages, [{ firstBar: 1, lastBar: 2 }, { firstBar: 3, lastBar: 4 }])
  const score = parseMusicXml(prepared.musicxml)
  assert.equal(score.parts.length, 2)
  assert.deepEqual(score.parts.map((p) => p.staves), [1, 2])
  assert.deepEqual([0, 1, 2, 3].map((b) => step(score, b, 0, 0)), ['CDE', 'CDE', 'R', 'R'], 'the melody rests on page 2')
  const rest = score.bars[2]!.parts[0]!.staves[0]!.voices[0]![0]!
  assert.ok(isNote(rest) && rest.measureRest && rest.rest)
  assert.deepEqual(rest.duration, { n: 3, d: 4 }, 'as long as the bar')
  assert.deepEqual([0, 1, 2, 3].map((b) => step(score, b, 1, 0)), ['FAC', 'FAC', 'FAC', 'FAC'], 'the piano is on every page')
  assert.deepEqual([2, 3].map((b) => step(score, b, 1, 1)), ['FFF', 'FFF'])
  // the clef and key of the piano on page 2 repeat what is in force and are dropped; ids are unique in the score
  assert.equal(score.bars[2]!.parts[1]!.staves[0]!.clef, undefined)
  assert.equal(score.bars[2]!.parts[1]!.key, undefined)
  const all = allItemLists(score).flatMap((l) => l.filter(isNote).map((n) => n.id))
  assert.equal(new Set(all).size, all.length)
})

test('pages: a part only on a later page is dropped with a warning', () => {
  const page1 = reading(pianoPart('P1', [PIANO_BAR, PIANO_BAR]))
  const page2 = reading(melodyPart('P1', [MEL_BAR, MEL_BAR]), pianoPart('P2', [PIANO_BAR, PIANO_BAR]))
  const prepared = preparePages([page1, page2])
  assert.equal(prepared.warnings.length, 1)
  assert.match(prepared.warnings[0]!, /Page 2.*dropped/)
  const score = parseMusicXml(prepared.musicxml)
  assert.deepEqual(score.parts.map((p) => p.staves), [2])
  assert.equal(score.bars.length, 4)
  assert.deepEqual([0, 1, 2, 3].map((b) => step(score, b, 0, 0)), ['FAC', 'FAC', 'FAC', 'FAC'], 'the piano of page 2 follows page 1')
  assert.ok(!allItemLists(score).flat().some((i) => isNote(i) && i.pitch?.step === 'D' && i.pitch.octave === 5), 'no note of the dropped melody')
})

test('pages: adding a page to a melody-only piece keeps the melody only', () => {
  const page1 = reading(melodyPart('P1', [MEL_BAR, MEL_BAR]), pianoPart('P2', [PIANO_BAR, PIANO_BAR]))
  const page2 = reading(melodyPart('P1', [MEL_BAR]), pianoPart('P2', [PIANO_BAR]))
  // the piece was read as a melody with a piano, and kept the melody only
  const first = preparePages([page1], [], [true, false])
  const partsRead: PartRead[] = [{ staves: 1, kept: true }, { staves: 2, kept: false }]
  assert.deepEqual(first.partsRead, partsRead)
  assert.deepEqual(parseMusicXml(first.musicxml).parts.map((p) => p.staves), [1])
  const added = appendPages(first.musicxml, [page2], [], first.partsRead)
  const score = parseMusicXml(added.musicxml)
  assert.deepEqual(score.parts.map((p) => p.staves), [1], 'the melody only')
  assert.equal(score.bars.length, 3)
  assert.equal(added.bars, 3)
  assert.deepEqual(added.pages, [{ firstBar: 3, lastBar: 3 }])
  assert.deepEqual([0, 1, 2].map((b) => step(score, b, 0, 0)), ['CDE', 'CDE', 'CDE'])
  assert.deepEqual(added.warnings, [], 'the dropped piano is not a surprise: no warning')
  // a piece saved before parts has no partsRead: it keeps its first part from added pages, as before
  const old = appendPages(first.musicxml, [page2])
  assert.deepEqual(parseMusicXml(old.musicxml).parts.map((p) => p.staves), [1])
  assert.equal(parseMusicXml(old.musicxml).bars.length, 3)
  // a piece that kept both parts takes both from the added page
  const both = preparePages([page1])
  const bothAdded = parseMusicXml(appendPages(both.musicxml, [page2], [], both.partsRead).musicxml)
  assert.deepEqual(bothAdded.parts.map((p) => p.staves), [1, 2])
  assert.deepEqual([step(bothAdded, 2, 0, 0), step(bothAdded, 2, 1, 0), step(bothAdded, 2, 1, 1)], ['CDE', 'FAC', 'FFF'])
})

test('pages: mergePages matches parts in order by staves and leaves a middle part out when the page lacks it', () => {
  const full = parseMusicXml(reading(melodyPart('P1', [MEL_BAR]), pianoPart('P2', [PIANO_BAR]), melodyPart('P3', [MEL_BAR.replace(/C/g, 'G')])))
  const partial = parseMusicXml(reading(melodyPart('P1', [MEL_BAR]), melodyPart('P2', [MEL_BAR.replace(/C/g, 'G')])))
  // the second melody of the partial page is matched to the third part of the first page (the piano has two staves)
  const { score, warnings } = mergePages([full, partial])
  assert.deepEqual(warnings, [])
  assert.deepEqual(score.parts.map((p) => p.staves), [1, 2, 1])
  assert.deepEqual([0, 1].map((b) => step(score, b, 1, 0)), ['FAC', 'R'], 'the piano rests on page 2')
  assert.deepEqual([0, 1].map((b) => step(score, b, 2, 0)), ['GDE', 'GDE'])
})

test('pages: a page of a piano reading added to a piece from before parts gives its first line, as the old reader did', () => {
  const old = serializeMusicXml(singleVoiceScore(firstLine(parseMusicXml(reading(melodyPart('P1', [MEL_BAR])))).measures, { partName: 'Voice' }))
  const page = reading(pianoPart('P1', [PIANO_BAR, PIANO_BAR]))
  const added = appendPages(old, [page])
  const score = parseMusicXml(added.musicxml)
  assert.deepEqual(score.parts.map((p) => p.staves), [1])
  assert.deepEqual([0, 1, 2].map((b) => step(score, b, 0, 0)), ['CDE', 'FAC', 'FAC'], 'the right hand of the piano page, not rests')
  assert.deepEqual(added.warnings, [])
})
