import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ALTO_SAX, CLARINET, GUITAR, PIANO, TENOR_SAX } from '../src/core/instruments/instruments.ts'
import type { Instrument } from '../src/core/instruments/instruments.ts'
import { notesOf } from '../src/core/score/model.ts'
import { parseMusicXml } from '../src/core/score/musicxml.ts'
import { frac } from '../src/core/score/rational.ts'
import { Scheduler } from '../src/core/playback/scheduler.ts'
import type { NoteOnSpec, NoteOutput, TimerApi, VoiceHandle } from '../src/core/playback/scheduler.ts'
import { ACCENT_DB, DYNAMIC_GAIN, MAX_ATTACK_GAIN, buildTimeline, expandMeasureOrder, loopSpanOf, midiOf, parseEndingNumbers } from '../src/core/playback/timeline.ts'
import type { PlaybackEvent } from '../src/core/playback/timeline.ts'
import { COMMITTED_FIXTURE, read } from './helpers.ts'
import { barOf, dyn, n, scoreOf, scoreXml, tenorTimeline, wedge } from './playbackHelpers.ts'
import { setBarEnd, setBarStart, setRepeatTimes } from '../src/core/score/edit.ts'

const order = (bars: Parameters<typeof scoreOf>[0]): number[] =>
  expandMeasureOrder(scoreOf(bars).measures).map((p) => p.barIndex + 1)

const ev = (events: PlaybackEvent[], i: number): PlaybackEvent => {
  const e = events[i]
  assert.ok(e, `event ${i}`)
  return e
}

// --- 10.1 repeats, endings, ties ---

test('timeline: a simple repeat plays bars 1, 2, 1, 2, 3', () => {
  const bars = [
    barOf('C', { left: '<repeat direction="forward"/>' }),
    barOf('D', { right: '<repeat direction="backward"/>' }),
    barOf('E'),
  ]
  assert.deepEqual(order(bars), [1, 2, 1, 2, 3])
})

test('timeline: a backward repeat without a forward sign returns to the start', () => {
  assert.deepEqual(order([barOf('C'), barOf('D', { right: '<repeat direction="backward"/>' }), barOf('E')]), [1, 2, 1, 2, 3])
})

test('timeline: first and second endings (1 2 3 | 1st: 4 | 2nd: 5 | 6)', () => {
  const bars = [
    barOf('C', { left: '<repeat direction="forward"/>' }),
    barOf('D'),
    barOf('E'),
    barOf('F', { left: '<ending number="1" type="start"/>', right: '<ending number="1" type="stop"/><repeat direction="backward"/>' }),
    barOf('G', { left: '<ending number="2" type="start"/>', right: '<ending number="2" type="discontinue"/>' }),
    barOf('A'),
  ]
  assert.deepEqual(order(bars), [1, 2, 3, 4, 1, 2, 3, 5, 6])
  const timeline = tenorTimeline(scoreOf(bars))
  assert.deepEqual(
    timeline.events.map((e) => e.pass),
    [1, 1, 1, 1, 2, 2, 2, 2, 1],
  )
})

test('timeline: a two-bar first ending is skipped as a whole on the second pass', () => {
  const bars = [
    barOf('C', { left: '<repeat direction="forward"/>' }),
    barOf('D', { left: '<ending number="1" type="start"/>' }),
    barOf('E', { right: '<ending number="1" type="stop"/><repeat direction="backward"/>' }),
    barOf('F', { left: '<ending number="2" type="start"/>', right: '<ending number="2" type="discontinue"/>' }),
    barOf('G'),
  ]
  assert.deepEqual(order(bars), [1, 2, 3, 1, 4, 5])
})

test('timeline: repeat times and ending number lists', () => {
  const bars = [
    barOf('C', { left: '<repeat direction="forward"/>' }),
    barOf('D', { left: '<ending number="1, 2" type="start"/>', right: '<ending number="1, 2" type="stop"/><repeat direction="backward" times="3"/>' }),
    barOf('E', { left: '<ending number="3" type="start"/>', right: '<ending number="3" type="discontinue"/>' }),
  ]
  assert.deepEqual(order(bars), [1, 2, 1, 2, 1, 3])
  assert.deepEqual(parseEndingNumbers('1, 2'), [1, 2])
  assert.deepEqual(parseEndingNumbers('1-3'), [1, 2, 3])
})

test('timeline: two separate repeated sections, and a repeat after a forward sign in the middle', () => {
  const bars = [
    barOf('C', { right: '<repeat direction="backward"/>' }),
    barOf('D', { left: '<repeat direction="forward"/>' }),
    barOf('E', { right: '<repeat direction="backward"/>' }),
    barOf('F'),
  ]
  assert.deepEqual(order(bars), [1, 1, 2, 3, 2, 3, 4])
})

test('timeline: without a forward sign a repeat goes back to the last double bar line', () => {
  // Exercise 82: |: run :| G – || run :| G – ||
  const bars = [
    barOf('C', { right: '<repeat direction="backward"/>' }),
    barOf('G', { right: '<bar-style>light-light</bar-style>' }),
    barOf('D', { right: '<repeat direction="backward"/>' }),
    barOf('G', { right: '<bar-style>light-light</bar-style>' }),
  ]
  assert.deepEqual(order(bars), [1, 1, 2, 3, 3, 4])
  // The double bar line may also be written as the next bar's left bar line.
  const left = [
    barOf('C'),
    barOf('D', { left: '<bar-style>light-light</bar-style>' }),
    barOf('E', { right: '<repeat direction="backward"/>' }),
  ]
  assert.deepEqual(order(left), [1, 2, 3, 2, 3])
})

test('timeline: an end-repeat is not a place to go back to; a repeat played in full is not taken again', () => {
  // A :|| B :|| C: the second repeat goes back to the beginning, and A's repeat is not taken again.
  const back = (times?: number): string => `<repeat direction="backward"${times ? ` times="${times}"` : ''}/>`
  assert.deepEqual(order([barOf('C', { right: back() }), barOf('D', { right: back() }), barOf('E')]), [1, 1, 2, 1, 2, 3])
  assert.deepEqual(order([barOf('C', { right: back(3) }), barOf('D', { right: back() }), barOf('E')]), [1, 1, 1, 2, 1, 2, 3])
  // After a section with a forward sign, a lone end-repeat goes back to that forward sign.
  const bars = [
    barOf('C'),
    barOf('D', { left: '<repeat direction="forward"/>', right: back() }),
    barOf('E', { right: back() }),
    barOf('F'),
  ]
  assert.deepEqual(order(bars), [1, 2, 2, 3, 2, 3, 4])
})

test('timeline: a double bar line inside a section with a forward sign does not move the repeat', () => {
  const bars = [
    barOf('C', { left: '<repeat direction="forward"/>' }),
    barOf('D', { right: '<bar-style>light-light</bar-style>' }),
    barOf('E', { right: '<repeat direction="backward"/>' }),
    barOf('F'),
  ]
  assert.deepEqual(order(bars), [1, 2, 3, 1, 2, 3, 4])
})

// --- edit-bar-lines task 1.3: playback follows the bar lines the user sets in the editor ---

const playedOrder = (s: ReturnType<typeof scoreOf>): number[] => expandMeasureOrder(s.measures).map((p) => p.barIndex + 1)

test('timeline: a start-repeat the user adds wins over the double-bar-line fallback (exercise 82)', () => {
  const s = scoreOf([
    barOf('C', { right: '<repeat direction="backward"/>' }),
    barOf('G', { right: '<bar-style>light-light</bar-style>' }),
    barOf('D', { right: '<repeat direction="backward"/>' }),
    barOf('G', { right: '<bar-style>light-light</bar-style>' }),
  ])
  setBarStart(s, 2, 'repeat')
  assert.deepEqual(playedOrder(s), [1, 1, 2, 3, 3, 4])
  // Without the double bar line, the repeat goes back to the start until the user adds the start-repeat.
  const plain = scoreOf([barOf('C', { right: '<repeat direction="backward"/>' }), barOf('G'), barOf('D', { right: '<repeat direction="backward"/>' }), barOf('G')])
  assert.deepEqual(playedOrder(plain), [1, 1, 2, 3, 1, 2, 3, 4])
  setBarStart(plain, 2, 'repeat')
  assert.deepEqual(playedOrder(plain), [1, 1, 2, 3, 3, 4])
})

test('timeline: an end-repeat the user adds, a count of 3, and an end set back to normal', () => {
  const s = scoreOf([barOf('C'), barOf('D'), barOf('E')])
  setBarEnd(s, 1, 'repeat')
  assert.deepEqual(playedOrder(s), [1, 2, 1, 2, 3])
  setRepeatTimes(s, 1, 3)
  assert.deepEqual(playedOrder(s), [1, 2, 1, 2, 1, 2, 3])
  const misread = scoreOf([barOf('C'), barOf('D'), barOf('E'), barOf('F', { right: '<repeat direction="backward"/>' }), barOf('G')])
  setBarEnd(misread, 3, 'normal')
  assert.deepEqual(playedOrder(misread), [1, 2, 3, 4, 5])
})

test('timeline: first and second endings still play right after the count of the first ending changes; a "1." ending still plays twice at 3x', () => {
  const s = scoreOf([
    barOf('C', { left: '<repeat direction="forward"/>' }),
    barOf('D'),
    barOf('E', { left: '<ending number="1" type="start"/>', right: '<ending number="1" type="stop"/><repeat direction="backward"/>' }),
    barOf('F', { left: '<ending number="2" type="start"/>', right: '<ending number="2" type="discontinue"/>' }),
    barOf('G'),
  ])
  setRepeatTimes(s, 2, 3)
  // Known gap (design.md Risks): the "1." ending is skipped on pass 2, so its end-repeat is never reached again,
  // and the section plays twice although the control says 3x. Endings and counts are pinned as they play now.
  assert.deepEqual(playedOrder(s), [1, 2, 3, 1, 2, 4, 5])
  assert.equal(s.measures[2]!.leftBarline?.ending?.number, '1', 'the first ending is still there')
  setRepeatTimes(s, 2, 2)
  assert.deepEqual(playedOrder(s), [1, 2, 3, 1, 2, 4, 5])
  assert.deepEqual(tenorTimeline(s).events.map((e) => e.pass), [1, 1, 1, 2, 2, 2, 1], 'the second ending plays on the last pass')
})

test('timeline: no repeats means one pass in score order; bar positions are exact beats', () => {
  const timeline = tenorTimeline(scoreOf([barOf('C'), barOf('D')]))
  assert.deepEqual(
    timeline.bars.map((b) => [b.bar, b.start, b.end]),
    [
      ['1', frac(0), frac(4)],
      ['2', frac(4), frac(8)],
    ],
  )
  assert.deepEqual(timeline.end, frac(8))
})

test('timeline: triplet durations stay exact', () => {
  const body = n({ type: 'quarter' }) + n({ type: 'eighth', triplet: true }).repeat(3) + n({ type: 'quarter' }) + n({ type: 'eighth' }) + n({ type: 'eighth' })
  const t = tenorTimeline(scoreOf([{ body }]))
  assert.deepEqual(
    t.events.map((e) => e.start),
    [frac(0), frac(1), frac(4, 3), frac(5, 3), frac(2), frac(3), frac(7, 2)],
  )
  assert.deepEqual(t.end, frac(4))
})

test('timeline: tied notes become one sounding event', () => {
  const body =
    n({ step: 'G', type: 'half', tie: 'start', id: 'a' }) + n({ step: 'G', type: 'quarter', tie: 'both', id: 'b' }) + n({ step: 'G', type: 'quarter', tie: 'stop', id: 'c' })
  const t = tenorTimeline(scoreOf([{ body }, { body: n({ step: 'A', type: 'whole' }) }]))
  assert.equal(t.events.length, 2)
  const tied = ev(t.events, 0)
  assert.deepEqual(tied.length, frac(4))
  assert.deepEqual(tied.noteIds, ['a', 'b', 'c'])
  assert.deepEqual(tied.sounding, frac(4))
  assert.equal(t.eventOfNote('c'), tied)
  assert.deepEqual(ev(t.events, 1).start, frac(4))
})

test('timeline: a tie to a different pitch is not merged', () => {
  const t = tenorTimeline(scoreOf([{ body: n({ step: 'G', tie: 'start' }) + n({ step: 'A', tie: 'stop' }) + n({ type: 'half', rest: true }) }]))
  assert.equal(t.events.length, 3)
})

test('timeline: events map back to note ids, bars and tap-to-seek', () => {
  const t = tenorTimeline(scoreOf([barOf('C'), barOf('D')]))
  const second = ev(t.events, 1)
  assert.equal(second.bar, '2')
  assert.equal(second.barIndex, 1)
  assert.equal(t.eventOfNote(second.noteIds[0]!), second)
  assert.equal(t.eventAtBeat(frac(5))?.index, 1)
  assert.equal(t.eventAtBeat(3.99)?.index, 0)
  assert.equal(t.eventAtBeat(8), undefined)
})

// --- 10.2 pitch, articulation, dynamics ---

test('timeline: written G4 sounds as F3 (tenor), Bb3 (alto), F4 (clarinet), G3 (guitar) and G4 (piano)', () => {
  const score = scoreOf([{ body: n({ step: 'G', octave: 4, type: 'whole' }) }])
  const before = structuredClone(score)
  const sounding = (instrument: Instrument): number[] => {
    const e = ev(buildTimeline(score, instrument).events, 0)
    assert.deepEqual(e.written, [67], `${instrument.id}: the written pitch is reported as printed`)
    return e.pitches
  }
  assert.deepEqual(sounding(TENOR_SAX), [53]) // F3
  assert.deepEqual(sounding(ALTO_SAX), [58]) // Bb3
  assert.deepEqual(sounding(CLARINET), [65]) // F4
  assert.deepEqual(sounding(GUITAR), [55]) // G3
  assert.deepEqual(sounding(PIANO), [67]) // G4
  assert.deepEqual(score, before, 'the written notes are never transposed')
  assert.equal(midiOf({ step: 'B', alter: -1, octave: 3 }) + TENOR_SAX.transpose, 44) // lowest: B-flat3 -> A-flat2
})

test('timeline: a chord member is transposed with the instrument too', () => {
  const body = n({ step: 'C', octave: 5, type: 'whole' }) + n({ step: 'E', octave: 5, type: 'whole' }).replace('<note>', '<note><chord/>')
  const t = buildTimeline(scoreOf([{ body }]), ALTO_SAX)
  assert.deepEqual(ev(t.events, 0).pitches, [72 - 9, 76 - 9])
  assert.deepEqual(ev(t.events, 0).written, [72, 76])
})

test('timeline: staccato sounds for half the written value; a normal note for all of it', () => {
  const t = tenorTimeline(scoreOf([{ body: n({ type: 'half', stac: true }) + n({ type: 'half' }) }]))
  assert.deepEqual(ev(t.events, 0).length, frac(2))
  assert.deepEqual(ev(t.events, 0).sounding, frac(1))
  assert.deepEqual(ev(t.events, 1).sounding, frac(2))
})

test('timeline: a breath mark leaves a gap of 1/8 beat', () => {
  const t = tenorTimeline(scoreOf([{ body: n({ type: 'quarter', breath: true }) + n({ type: 'quarter' }) }]))
  assert.deepEqual(ev(t.events, 0).sounding, frac(7, 8))
  assert.deepEqual(ev(t.events, 1).start, frac(1))
})

test('timeline: a breath mark never eats more than half of a short note', () => {
  const t = tenorTimeline(scoreOf([{ body: n({ type: '16th', breath: true }) }]))
  assert.deepEqual(ev(t.events, 0).sounding, frac(1, 8)) // 16th = 1/4 beat, gap capped at 1/8
  const u = tenorTimeline(scoreOf([{ body: n({ type: '16th', triplet: true, breath: true }) }]))
  assert.deepEqual(ev(u.events, 0).sounding, frac(1, 12)) // length 1/6, gap capped at half
})

test('timeline: f is louder than mf, and mf is the default', () => {
  const body = n() + dyn('f') + n() + dyn('p') + n()
  const t = tenorTimeline(scoreOf([{ body }]))
  const [a, b, c] = [ev(t.events, 0), ev(t.events, 1), ev(t.events, 2)]
  assert.equal(a.dynamic, 'mf')
  assert.ok(b.gain > a.gain, 'f louder than mf')
  assert.ok(c.gain < a.gain, 'p softer than mf')
  const mf = tenorTimeline(scoreOf([{ body: dyn('mf') + n() }]))
  assert.equal(ev(mf.events, 0).gain, a.gain)
})

test('timeline: a dynamic carries on through a repeat', () => {
  const bars = [
    { body: n({ type: 'whole' }), left: '<repeat direction="forward"/>' },
    { body: dyn('f') + n({ type: 'whole' }), right: '<repeat direction="backward"/>' },
  ]
  const t = tenorTimeline(scoreOf(bars))
  assert.deepEqual(
    t.events.map((e) => e.dynamic),
    ['mf', 'f', 'f', 'f'],
  )
})

test('timeline: slurred notes connect, the note after the slur gets a new attack', () => {
  const body = n({ slur: 'start' }) + n({}) + n({ slur: 'stop' }) + n({})
  const t = tenorTimeline(scoreOf([{ body }]))
  assert.deepEqual(
    t.events.map((e) => [e.attack, e.legatoNext]),
    [
      [true, true],
      [false, true],
      [false, false],
      [true, false],
    ],
  )
})

test('timeline: slur over notes 1-2 then a staccato note 3 (triplet)', () => {
  const body = n({ type: 'eighth', triplet: true, slur: 'start' }) + n({ type: 'eighth', triplet: true, slur: 'stop' }) + n({ type: 'eighth', triplet: true, stac: true })
  const t = tenorTimeline(scoreOf([{ body }]))
  assert.deepEqual(
    t.events.map((e) => e.attack),
    [true, false, true],
  )
  assert.deepEqual(ev(t.events, 2).sounding, frac(1, 6)) // half of 1/3 beat
})

test('timeline: a slur does not connect across a rest', () => {
  const body = n({ slur: 'start' }) + n({ rest: true }) + n({ slur: 'stop' })
  const t = tenorTimeline(scoreOf([{ body }]))
  assert.equal(ev(t.events, 0).legatoNext, false)
  assert.equal(ev(t.events, 2).attack, true)
})

test('timeline: the committed fixture expands with every feature', () => {
  const score = parseMusicXml(read(COMMITTED_FIXTURE))
  const t = tenorTimeline(score)
  assert.ok(t.events.length > 0)
  // bars 1-4, then 1-3 again, then ending 2 (bar 5), then bar 6
  assert.deepEqual(
    t.bars.map((b) => b.bar),
    ['1', '2', '3', '4', '1', '2', '3', '5', '6'],
  )
  assert.ok(notesOf(score.measures[0]!).length > 0)
})

// --- 5.3 expression: fermata, tenuto, accent, hairpins ---

const beats = (c: { start: { n: number; d: number } }[]): number[] => c.map((x) => x.start.n / x.start.d)

test('timeline: a fermata holds its note for twice its value, and everything after it moves later', () => {
  const body = n({ step: 'C' }) + n({ step: 'D', fermata: true }) + n({ step: 'E' }) + n({ step: 'F' })
  const t = tenorTimeline(scoreOf([{ body }, { body: n({ step: 'G', type: 'whole' }) }]))
  assert.deepEqual(
    t.events.map((e) => [e.start, e.length, e.sounding]),
    [
      [frac(0), frac(1), frac(1)],
      [frac(1), frac(2), frac(2)], // the quarter under the fermata: 2 beats (2 s at 60 bpm)
      [frac(3), frac(1), frac(1)],
      [frac(4), frac(1), frac(1)],
      [frac(5), frac(4), frac(4)],
    ],
  )
  assert.deepEqual(
    t.bars.map((b) => [b.start, b.end]),
    [
      [frac(0), frac(5)],
      [frac(5), frac(9)],
    ],
    'the bar is as long as it sounds',
  )
  assert.deepEqual(t.end, frac(9))
  // The cursor sees what is heard: the held note covers beats 1 to 3.
  assert.equal(t.eventAtBeat(2.5)?.index, 1)
  assert.equal(t.eventAtBeat(3)?.index, 2)
})

test('timeline: a fermata on a rest holds the pause, and on a tied note only that note is held', () => {
  const rest = tenorTimeline(scoreOf([{ body: n({ rest: true, fermata: true }) + n({ step: 'D' }) }]))
  assert.deepEqual(ev(rest.events, 0).length, frac(2))
  assert.deepEqual(ev(rest.events, 1).start, frac(2))
  const tied = tenorTimeline(scoreOf([{ body: n({ step: 'G', type: 'half', tie: 'start' }) + n({ step: 'G', type: 'half', tie: 'stop', fermata: true }) }]))
  assert.equal(tied.events.length, 1)
  assert.deepEqual(ev(tied.events, 0).length, frac(6), 'half + held half = 2 + 4 beats')
})

test('timeline: tenuto takes away the staccato shortening; a plain note and a tenuto note both sound for their whole value', () => {
  const t = tenorTimeline(
    scoreOf([
      { body: n({ type: 'half', tenuto: true }) + n({ type: 'half', stac: true, tenuto: true }) },
      { body: n({ type: 'half', stac: true }) + n({ type: 'half' }) },
    ]),
  )
  assert.deepEqual(ev(t.events, 0).sounding, frac(2), 'tenuto: the whole value')
  assert.deepEqual(ev(t.events, 1).sounding, frac(2), 'staccato with tenuto: no articulation gap')
  assert.equal(ev(t.events, 1).staccato, false, 'and no short release either')
  assert.deepEqual(ev(t.events, 2).sounding, frac(1), 'staccato alone is still half')
  assert.deepEqual(ev(t.events, 3).sounding, frac(2))
  // A breath mark is a gap of its own and stays.
  const breath = tenorTimeline(scoreOf([{ body: n({ tenuto: true, breath: true }) + n({}) }]))
  assert.deepEqual(ev(breath.events, 0).sounding, frac(7, 8))
})

test("timeline: an accent raises the attack by about 4 dB above the note's level; its neighbours are unchanged", () => {
  const t = tenorTimeline(scoreOf([{ body: n({}) + n({ accent: true }) + n({}) + n({ rest: true, accent: true }) }]))
  const [a, b, c, d] = [ev(t.events, 0), ev(t.events, 1), ev(t.events, 2), ev(t.events, 3)]
  assert.deepEqual([a.accent, b.accent, c.accent, d.accent], [false, true, false, false], 'a rest has no attack to accent')
  assert.equal(b.gain, a.gain, 'the level under the accent is the dynamic level')
  assert.ok(Math.abs(20 * Math.log10(b.attackGain / b.gain) - ACCENT_DB) < 1e-9, 'about +4 dB')
  assert.ok(b.attackGain > a.attackGain && b.attackGain > c.attackGain, 'clearly louder than the unaccented notes at the same dynamic')
  assert.equal(a.attackGain, a.gain)
  // It follows the dynamic: an accented note at f is louder than an accented note at mf.
  const f = tenorTimeline(scoreOf([{ body: n({ accent: true }) + dyn('f') + n({ accent: true }) }]))
  assert.ok(ev(f.events, 1).attackGain > ev(f.events, 0).attackGain)
})

test('timeline: an accent raises the attack by 4 dB only as far as full scale allows: no attack gain is above 1', () => {
  // Every printed dynamic, with an accented note and a plain one after it.
  for (const mark of Object.keys(DYNAMIC_GAIN)) {
    const t = tenorTimeline(scoreOf([{ body: dyn(mark) + n({ accent: true }) + n({}) }]))
    const [accented, plain] = [ev(t.events, 0), ev(t.events, 1)]
    assert.ok(accented.attackGain <= MAX_ATTACK_GAIN, `${mark}: attack gain ${accented.attackGain}`)
    assert.ok(accented.attackGain >= accented.gain, `${mark}: the accent is never below the level`)
    assert.equal(plain.attackGain, plain.gain)
    const wanted = Math.min(MAX_ATTACK_GAIN, DYNAMIC_GAIN[mark]! * 10 ** (ACCENT_DB / 20))
    assert.ok(Math.abs(accented.attackGain - wanted) < 1e-12, `${mark}: ${accented.attackGain} is not ${wanted}`)
  }
  assert.equal(MAX_ATTACK_GAIN, 1)
  const attack = (mark: string): number => ev(tenorTimeline(scoreOf([{ body: dyn(mark) + n({ accent: true }) }])).events, 0).attackGain
  assert.ok(Math.abs(20 * Math.log10(attack('mf') / DYNAMIC_GAIN.mf!) - ACCENT_DB) < 1e-9, 'mf: +4 dB as before')
  assert.equal(attack('fff'), DYNAMIC_GAIN.fff, 'fff is full scale already: no accent')
  // A crescendo up to fff with an accent on its last note stays in range too.
  const cresc = tenorTimeline(scoreOf([{ body: dyn('mf') + wedge('crescendo') + n({}) + n({ accent: true }) + n({ accent: true }) + n({ accent: true }) + wedge('stop') }, { body: dyn('fff') + n({ type: 'whole' }) }]))
  assert.ok(cresc.events.every((e) => e.attackGain <= MAX_ATTACK_GAIN && e.gain <= MAX_ATTACK_GAIN))
})

const gains = (t: { events: PlaybackEvent[] }): number[] => t.events.map((e) => e.gain)
const rising = (xs: number[]): boolean => xs.every((x, i) => i === 0 || x > xs[i - 1]!)
const quarters = (...steps: string[]): string => steps.map((step) => n({ step })).join('')

test('timeline: a crescendo over four notes rises note by note and reaches the next dynamic', () => {
  const bars = [{ body: dyn('mf') + wedge('crescendo') + quarters('C', 'D', 'E', 'F') + wedge('stop') }, { body: dyn('f') + n({ step: 'G', type: 'whole' }) }]
  const g = gains(tenorTimeline(scoreOf(bars)))
  assert.equal(g[0], DYNAMIC_GAIN.mf, 'the first note is at the level the hairpin starts from')
  assert.ok(rising(g.slice(0, 4)), `each of the four notes is louder than the one before: ${g.slice(0, 4)}`)
  assert.ok(g[3]! < DYNAMIC_GAIN.f!, 'the target is reached at the mark that follows')
  assert.equal(g[4], DYNAMIC_GAIN.f, 'f sounds as f')
  assert.deepEqual(
    g.slice(0, 4).map((x) => Math.round(x * 1000) / 1000),
    [0.6, 0.645, 0.69, 0.735],
    'linear from mf (0.6) towards f (0.78), by the start of each note',
  )
})

test('timeline: a hairpin with no dynamic after it goes one step, and that level stays', () => {
  const cresc = tenorTimeline(scoreOf([{ body: wedge('crescendo') + n({}) + n({}) + wedge('stop') + n({}) + n({}) }]))
  assert.deepEqual(gains(cresc), [DYNAMIC_GAIN.mf, (DYNAMIC_GAIN.mf! + DYNAMIC_GAIN.f!) / 2, DYNAMIC_GAIN.f, DYNAMIC_GAIN.f], 'mf to f; then f carries on')
  assert.deepEqual(
    cresc.events.map((e) => e.dynamic),
    ['mf', 'mf', 'f', 'f'],
  )
  const dim = tenorTimeline(scoreOf([{ body: dyn('f') + wedge('diminuendo') + quarters('C', 'D', 'E', 'F') + wedge('stop') }, { body: n({ type: 'whole' }) }]))
  const g = gains(dim)
  assert.equal(g[0], DYNAMIC_GAIN.f)
  assert.ok(g.slice(0, 4).every((x, i) => i === 0 || x < g[i - 1]!), `falling note by note: ${g.slice(0, 4)}`)
  assert.equal(g[4], DYNAMIC_GAIN.mf, 'one step down from f is mf, and it stays')
})

test('timeline: a dynamic that goes the wrong way for the hairpin is not its target; one step is used instead', () => {
  const t = tenorTimeline(scoreOf([{ body: wedge('crescendo') + n({}) + n({}) + wedge('stop') + dyn('p') + n({}) }]))
  assert.ok(ev(t.events, 1).gain > ev(t.events, 0).gain, 'still a crescendo')
  assert.ok(ev(t.events, 1).gain < DYNAMIC_GAIN.f!)
  assert.equal(ev(t.events, 2).gain, DYNAMIC_GAIN.p, 'and p sounds as p')
})

test('timeline: a hairpin runs across a barline, and ends at a mark that sits on its last note', () => {
  const bars = [
    { body: dyn('p') + wedge('crescendo') + n({ type: 'half' }) + n({ type: 'half' }) },
    { body: n({ type: 'half' }) + dyn('f') + n({ type: 'half' }) + wedge('stop') },
  ]
  const g = gains(tenorTimeline(scoreOf(bars)))
  assert.equal(g[0], DYNAMIC_GAIN.p)
  assert.ok(rising(g), `rising across the bar: ${g}`)
  assert.equal(g[3], DYNAMIC_GAIN.f, 'the mark on the last note is reached there')
})

test('timeline: a hairpin on one note, on a tied note, and one that cannot end do no harm', () => {
  const one = tenorTimeline(scoreOf([{ body: wedge('crescendo') + n({}) + wedge('stop') + n({}) }]))
  assert.deepEqual(gains(one), [DYNAMIC_GAIN.mf, DYNAMIC_GAIN.f], 'the note itself is at its level; the level after it is the target')
  const tied = tenorTimeline(
    scoreOf([{ body: wedge('crescendo') + n({ step: 'G', type: 'half', tie: 'start' }) + n({ step: 'G', type: 'half', tie: 'stop' }) + wedge('stop') + dyn('f') + n({ type: 'half' }) + n({ type: 'half' }) }]),
  )
  assert.equal(tied.events.length, 3, 'tied notes are one event')
  assert.equal(ev(tied.events, 1).gain, DYNAMIC_GAIN.f)
  // A hairpin whose last note is not in the score (it was deleted) is never played.
  const score = scoreOf([{ body: n({ id: 'a' }) + n({ id: 'b' }) + n({ id: 'c' }) }])
  score.measures[0]!.items.unshift({ kind: 'wedge', type: 'crescendo', start: 'a', stop: 'gone' })
  assert.deepEqual(gains(tenorTimeline(score)), [DYNAMIC_GAIN.mf, DYNAMIC_GAIN.mf, DYNAMIC_GAIN.mf])
})

test('timeline: a hairpin in a repeated bar starts from the level in force on each pass', () => {
  const bars = [
    { body: n({ type: 'whole' }), left: '<repeat direction="forward"/>' },
    { body: wedge('crescendo') + n({ type: 'half' }) + n({ type: 'half' }) + wedge('stop'), right: '<repeat direction="backward"/>' },
  ]
  const t = tenorTimeline(scoreOf(bars))
  // bar 1 (mf) | bar 2: mf up to f | bar 1 (f now) | bar 2: from f one step up
  assert.deepEqual(
    t.events.map((e) => e.pass),
    [1, 1, 1, 2, 2, 2],
  )
  const g = gains(t)
  assert.equal(g[1], DYNAMIC_GAIN.mf)
  assert.ok(g[2]! > g[1]!)
  assert.equal(g[3], DYNAMIC_GAIN.f, 'the first pass left the level at f')
  assert.equal(g[4], DYNAMIC_GAIN.f, 'the second pass starts again from f')
  assert.ok(g[5]! > g[4]!, 'and rises towards ff')
})

test('timeline: hairpin gains leave the score alone and do not depend on the instrument', () => {
  const score = scoreOf([{ body: wedge('crescendo') + n({}) + n({}) + wedge('stop') + dyn('ff') + n({}) + n({}) }])
  const before = structuredClone(score)
  assert.deepEqual(gains(buildTimeline(score, PIANO)), gains(buildTimeline(score, TENOR_SAX)))
  assert.deepEqual(score, before)
})

// --- 5.1 the beat grid, and 5.2 rest between loop repeats ---

test('timeline: the beat grid is every beat of the time signature, the first of each bar accented', () => {
  const grid = (bars: Parameters<typeof scoreOf>[0], time: [number, number]) => {
    const t = tenorTimeline(scoreOf(bars, time))
    return { at: beats(t.clicks), accent: t.clicks.map((c) => c.accent) }
  }
  // 4/4: four quarter beats; 3/4: three; 2/2: two half-note beats.
  assert.deepEqual(grid([barOf('C'), barOf('D')], [4, 4]), { at: [0, 1, 2, 3, 4, 5, 6, 7], accent: [true, false, false, false, true, false, false, false] })
  assert.deepEqual(grid([{ body: n({}).repeat(3) }, { body: n({}).repeat(3) }], [3, 4]), { at: [0, 1, 2, 3, 4, 5], accent: [true, false, false, true, false, false] })
  assert.deepEqual(grid([barOf('C')], [2, 2]), { at: [0, 2], accent: [true, false] })
  // 6/8 is compound time: two beats a bar, a dotted quarter (1.5 quarters) apart, the same as the count-in counts.
  assert.deepEqual(grid([{ body: n({ type: 'eighth' }).repeat(6) }, { body: n({ type: 'eighth' }).repeat(6) }], [6, 8]), { at: [0, 1.5, 3, 4.5], accent: [true, false, true, false] })
  // 3/8 and 5/8 are counted in eighths.
  assert.deepEqual(grid([{ body: n({ type: 'eighth' }).repeat(3) }], [3, 8]), { at: [0, 0.5, 1], accent: [true, false, false] })
  assert.equal(grid([{ body: n({ type: 'eighth' }).repeat(5) }], [5, 8]).at.length, 5)
})

test('timeline: the beat grid follows a change of time signature and a repeat', () => {
  const score = scoreOf([
    { body: n({}).repeat(4), left: '<repeat direction="forward"/>' },
    { body: n({}).repeat(4), right: '<repeat direction="backward"/>' },
    { body: n({}).repeat(3) },
  ])
  score.measures[2]!.time = { beats: 3, beatType: 4 }
  const t = tenorTimeline(score)
  assert.equal(t.clicks.length, 4 + 4 + 4 + 4 + 3, 'bars 1, 2, 1, 2 in 4/4 and bar 3 in 3/4')
  assert.deepEqual(
    t.clicks.filter((c) => c.accent).map((c) => c.barIndex),
    [0, 1, 0, 1, 2],
  )
  assert.deepEqual(beats(t.clicks.slice(-3)), [16, 17, 18], 'the last bar has three beats')
})

test('timeline: a first bar shorter than a bar is a pickup: its beats count back from the bar line', () => {
  const t = tenorTimeline(scoreOf([{ body: n({}) }, { body: n({}).repeat(4) }]))
  assert.deepEqual(beats(t.clicks), [0, 1, 2, 3, 4], 'beat 4 of the pickup, then the four beats of bar 2')
  assert.deepEqual(
    t.clicks.map((c) => c.accent),
    [false, true, false, false, false],
    'beat 1 is the first beat after the bar line',
  )
  const two = tenorTimeline(scoreOf([{ body: n({}) + n({}) }, { body: n({}).repeat(4) }]))
  assert.deepEqual(beats(two.clicks), [0, 1, 2, 3, 4, 5], 'beats 3 and 4 of the pickup')
  assert.deepEqual(
    two.clicks.map((c) => c.accent),
    [false, false, true, false, false, false],
  )
})

test('timeline: under a fermata the beat grid stops, and the next beat comes with the next note', () => {
  const bar = n({ step: 'C' }) + n({ step: 'D', fermata: true }) + n({ step: 'E' }) + n({ step: 'F' })
  const t = tenorTimeline(scoreOf([{ body: bar }, { body: bar }]))
  // Bar 1 is 5 beats long: beats at 0, 1 (the held note starts), 3, 4; bar 2 starts at 5.
  assert.deepEqual(beats(t.clicks.slice(0, 5)), [0, 1, 3, 4, 5])
  assert.deepEqual(
    t.clicks.slice(0, 5).map((c) => c.accent),
    [true, false, false, false, true],
  )
  // A whole note held: only its own beat, and the grid goes on with the next bar.
  const whole = tenorTimeline(scoreOf([{ body: n({ type: 'whole', fermata: true }) }, barOf('D')]))
  assert.deepEqual(beats(whole.clicks), [0, 8, 9, 10, 11])
})

/** Runs a scheduler on a fake clock from event `from`, and returns what it sounded. */
function runLoop(timeline: ReturnType<typeof tenorTimeline>, bpm: number, loop: ReturnType<typeof loopSpanOf>, seconds: number, options: { metronome?: boolean; from?: number } = {}) {
  const clock = { currentTime: 0 }
  let tick: (() => void) | undefined
  const timer: TimerApi = { set: (fn) => ((tick = fn), 1), clear: () => (tick = undefined) }
  const notes: { when: number; midi: number[] }[] = []
  const clicks: { when: number; accent: boolean }[] = []
  const output: NoteOutput = {
    noteOn: (spec: NoteOnSpec): VoiceHandle => {
      notes.push({ when: spec.when, midi: spec.midi })
      return { release() {}, cancel() {} }
    },
    click: (spec) => void clicks.push({ when: spec.when, accent: spec.accent }),
  }
  const scheduler = new Scheduler(timeline, { clock, output, timer, bpm, metronome: options.metronome ?? false })
  scheduler.start(options.from ?? 0, { delay: 0, ...(loop ? { loop } : {}) })
  for (let i = 0; i < Math.round(seconds / 0.025); i++) {
    clock.currentTime = Math.round((clock.currentTime + 0.025) * 1e6) / 1e6
    tick?.()
  }
  return { notes, clicks, scheduler }
}

const wholeBar = (step: string): { body: string } => ({ body: n({ step, type: 'whole' }) })

test('loop rest: bars 2-3 of a 4/4 piece with a rest of one bar at 60 bpm leave 4 seconds of silence after each pass', () => {
  const timeline = tenorTimeline(scoreOf([wholeBar('C'), wholeBar('D'), wholeBar('E'), wholeBar('F')]))
  const span = loopSpanOf(timeline, { start: 1, end: 2 }, 1)!
  assert.deepEqual([span.start, span.end, span.rest], [frac(4), frac(12), frac(4)], 'bars 2-3 are beats 4..12; one bar of rest is 4 beats')
  assert.equal(span.rest!.n / span.rest!.d, 4, 'which is 4 s at 60 bpm (one beat a second)')

  // Played from bar 2: D 0-4 s, E 4-8 s, then 4 s of silence, then D again at 12 s.
  const r = runLoop(timeline, 60, span, 40, { from: 1 })
  const sounding = (step: string): number => midiOf({ step: step as 'D', octave: 4 }) - 14
  const d = r.notes.filter((x) => x.midi[0] === sounding('D')).map((x) => x.when)
  const e = r.notes.filter((x) => x.midi[0] === sounding('E')).map((x) => x.when)
  assert.ok(d.length >= 3 && e.length >= 3)
  const gap = d[1]! - (e[0]! + 4) // the end of bar 3 (E is a whole note: 4 s) to the start of bar 2 again
  assert.ok(Math.abs(gap - 4) < 1e-9, `4 s between the passes, got ${gap}`)
  assert.ok(Math.abs(d[2]! - d[1]! - 12) < 1e-9, 'a pass lasts 8 s of music plus 4 s of rest, every time')
  assert.equal(r.notes.length, r.notes.filter((x) => x.midi[0] === sounding('D') || x.midi[0] === sounding('E')).length, 'nothing else sounds, in the rest or after')
})

test("loop rest: none, one and two bars, each as long as the loop's last bar (4/4, 3/4 and 6/8)", () => {
  const t = tenorTimeline(scoreOf([wholeBar('C'), wholeBar('D')]))
  assert.equal(loopSpanOf(t, { start: 0, end: 1 })!.rest, undefined, 'no rest by default')
  assert.equal(loopSpanOf(t, { start: 0, end: 1 }, 0)!.rest, undefined)
  assert.deepEqual(loopSpanOf(t, { start: 0, end: 1 }, 2)!.rest, frac(8))
  assert.deepEqual(loopSpanOf(t, { start: 0, end: 1 }, 7)!.rest, frac(8), 'two bars at most')
  assert.equal(loopSpanOf(t, { start: 5, end: 6 }, 1), undefined, 'a range that is not in the score')
  const waltz = tenorTimeline(scoreOf([{ body: n({}).repeat(3) }, { body: n({}).repeat(3) }], [3, 4]))
  assert.deepEqual(loopSpanOf(waltz, { start: 0, end: 1 }, 1)!.rest, frac(3))
  const jig = tenorTimeline(scoreOf([{ body: n({ type: 'eighth' }).repeat(6) }], [6, 8]))
  assert.deepEqual(loopSpanOf(jig, { start: 0, end: 0 }, 2)!.rest, frac(6), 'two 6/8 bars are 6 quarter beats')
  assert.deepEqual(
    loopSpanOf(jig, { start: 0, end: 0 }, 2)!.restClicks!.map((c) => [c.offset, c.accent]),
    [
      [frac(0), true],
      [frac(3, 2), false],
      [frac(3), true],
      [frac(9, 2), false],
    ],
    'the clicks of the rest are on the 6/8 beats',
  )
})

test('loop rest: the metronome fills the silence with clicks, beat 1 accented; with the metronome off the rest is silent', () => {
  const timeline = tenorTimeline(scoreOf([wholeBar('C'), wholeBar('D'), wholeBar('E'), wholeBar('F')]))
  const span = loopSpanOf(timeline, { start: 1, end: 2 }, 1)!
  assert.deepEqual(
    span.restClicks!.map((c) => [c.offset.n / c.offset.d, c.accent]),
    [
      [0, true],
      [1, false],
      [2, false],
      [3, false],
    ],
  )

  // From bar 2 at 60 bpm: D 0-4 s, E 4-8 s, 4 s of rest, then D again at 12 s.
  const on = runLoop(timeline, 60, span, 26, { metronome: true, from: 1 })
  const times = on.clicks.map((c) => Math.round(c.when * 1000) / 1000)
  assert.deepEqual(times.slice(0, 16), Array.from({ length: 16 }, (_, i) => i), 'clicks run on through the notes and the rest without a break')
  const inRest = on.clicks.filter((c) => c.when >= 8 - 1e-9 && c.when < 12 - 1e-9)
  assert.deepEqual(
    inRest.map((c) => c.accent),
    [true, false, false, false],
    'four clicks in the rest, the first one accented',
  )
  assert.ok(on.clicks.every((c, i) => c.accent === (i % 4 === 0)), 'one accent per bar, on beat 1, through every pass')

  const off = runLoop(timeline, 60, span, 26, { metronome: false, from: 1 })
  assert.equal(off.clicks.length, 0, 'metronome off: the rest is silent')
})

test('loop rest: the count-in plays before the first pass only, and the position says it is resting', () => {
  const timeline = tenorTimeline(scoreOf([wholeBar('C'), wholeBar('D'), wholeBar('E')]))
  const span = loopSpanOf(timeline, { start: 1, end: 1 }, 1)!
  const clock = { currentTime: 0 }
  let tick: (() => void) | undefined
  const clicks: number[] = []
  const notes: number[] = []
  const output: NoteOutput = {
    noteOn: (s): VoiceHandle => (notes.push(s.when), { release() {}, cancel() {} }),
    click: (s) => void clicks.push(s.when),
  }
  const timer: TimerApi = { set: (fn) => ((tick = fn), 1), clear: () => (tick = undefined) }
  const scheduler = new Scheduler(timeline, { clock, output, timer, bpm: 60 })
  scheduler.start(1, { delay: 0, loop: span, countIn: { clicks: 4, spacing: frac(1) } })
  for (let i = 0; i < Math.round(40 / 0.025); i++) {
    clock.currentTime = Math.round((clock.currentTime + 0.025) * 1e6) / 1e6
    tick?.()
  }
  assert.equal(clicks.length, 4, 'four count-in clicks, none before later passes')
  assert.ok(clicks.every((c) => c < notes[0]!))
  assert.deepEqual(
    notes.slice(0, 3).map((w) => w - notes[0]!),
    [0, 8, 16],
    'a pass is 4 s of music and 4 s of rest',
  )

  // Beat 4 is at 4 s (after the count-in); bar 2 runs to beat 8, and the rest to beat 12.
  assert.equal(scheduler.positionAt(5).resting, undefined, 'in the bar')
  const inRest = scheduler.positionAt(10)
  assert.equal(inRest.resting, true)
  assert.equal(inRest.event, undefined)
  assert.equal(inRest.loopPass, 0)
  assert.ok(Math.abs(inRest.beat - 10) < 1e-9, 'beat 10: the position runs on through the rest')
  const second = scheduler.positionAt(13)
  assert.equal(second.resting, undefined)
  assert.equal(second.loopPass, 1)
  assert.equal(second.event?.bar, '2', 'the second pass is in bar 2 again')
})
