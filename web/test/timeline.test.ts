import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ALTO_SAX, CLARINET, GUITAR, PIANO, TENOR_SAX } from '../src/core/instruments/instruments.ts'
import type { Instrument } from '../src/core/instruments/instruments.ts'
import { notesOf } from '../src/core/score/model.ts'
import { parseMusicXml } from '../src/core/score/musicxml.ts'
import { frac } from '../src/core/score/rational.ts'
import { Scheduler } from '../src/core/playback/scheduler.ts'
import type { NoteOnSpec, NoteOutput, TimerApi, VoiceHandle } from '../src/core/playback/scheduler.ts'
import { ACCENT_DB, DYNAMIC_GAIN, MAX_ATTACK_GAIN, STRONG_ACCENT_DB, buildTimeline, expandMeasureOrder, loopSpanOf, midiOf, parseEndingNumbers } from '../src/core/playback/timeline.ts'
import type { PlaybackEvent } from '../src/core/playback/timeline.ts'
import { COMMITTED_FIXTURE, MELODY_PIANO_FIXTURE, read } from './helpers.ts'
import { backup, barOf, dyn, inChord, inVoice, n, onLeftHand, partsOf, scoreOf, scoreXml, tenorTimeline, wedge } from './playbackHelpers.ts'
import { setBarEnd, setBarStart, setRepeatTimes } from '../src/core/score/edit.ts'
import { firstLine, setAttr } from './helpers.ts'

const order = (bars: Parameters<typeof scoreOf>[0]): number[] =>
  expandMeasureOrder(firstLine(scoreOf(bars)).measures).map((p) => p.barIndex + 1)

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

const playedOrder = (s: ReturnType<typeof scoreOf>): number[] => expandMeasureOrder(firstLine(s).measures).map((p) => p.barIndex + 1)

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
  assert.equal(firstLine(s).measures[2]!.leftBarline?.ending?.number, '1', 'the first ending is still there')
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
    const e = ev(buildTimeline(firstLine(score), instrument).events, 0)
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
  const t = buildTimeline(firstLine(scoreOf([{ body }])), ALTO_SAX)
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

test('timeline: a slur start that is never closed connects nothing (it is not drawn either)', () => {
  const body = n({ slur: 'start' }) + n({}) + n({}) + n({})
  const t = tenorTimeline(scoreOf([{ body }, { body: n({}) + n({}) + n({}) + n({}) }]))
  assert.ok(t.events.every((e) => e.attack && !e.legatoNext))
})

test('timeline: loose slur starts before a real slur (piece 95, pencil marks read as slurs) leave the bars between unslurred', () => {
  // Bars 1-2 of the piece: a start on bar 1, another on bar 2, then the one slur the paper has, in bar 3.
  const bars = [
    { body: n({ slur: 'start' }) + n({ stac: true }) + n({}) + n({ stac: true }) },
    { body: n({}) + n({ slur: 'start' }) + n({}) + n({}) },
    { body: n({ slur: 'start' }) + n({ slur: 'stop' }) + n({}) + n({}) },
  ]
  const t = tenorTimeline(scoreOf(bars))
  assert.deepEqual(
    t.events.map((e) => e.legatoNext),
    [false, false, false, false, false, false, false, false, true, false, false, false],
  )
  assert.deepEqual(
    t.events.map((e) => e.attack),
    [true, true, true, true, true, true, true, true, true, false, true, true],
  )
})

test('timeline: a slur that starts on the note the previous one ends on continues the legato', () => {
  const both = (): string => n({ slur: 'stop' }).replace('<slur type="stop" number="1"/>', '<slur type="stop" number="1"/><slur type="start" number="1"/>')
  const body = n({ slur: 'start' }) + both() + n({ slur: 'stop' }) + n({})
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

test('timeline: a slur whose end sits on a chord member ends where it is drawn', () => {
  // Ends on the top note of a chord (notes 2 and 3 are one chord): the chord is the slur's last note, the note after it gets an attack.
  const toChord = n({ slur: 'start' }) + n({}) + inChord(n({ step: 'E', slur: 'stop' })) + n({})
  assert.deepEqual(
    tenorTimeline(scoreOf([{ body: toChord }])).events.map((e) => [e.attack, e.legatoNext]),
    [
      [true, true],
      [false, false],
      [true, false],
    ],
  )
  // Starts on a chord member: the chord connects into the next note.
  const fromChord = n({}) + inChord(n({ step: 'E', slur: 'start' })) + n({ slur: 'stop' }) + n({}) + n({})
  assert.deepEqual(
    tenorTimeline(scoreOf([{ body: fromChord }])).events.map((e) => e.legatoNext),
    [true, false, false, false],
  )
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
  assert.ok(notesOf(firstLine(score).measures[0]!).length > 0)
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
  firstLine(score).measures[0]!.items.unshift({ kind: 'wedge', type: 'crescendo', start: 'a', stop: 'gone' })
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
  assert.deepEqual(gains(buildTimeline(firstLine(score), PIANO)), gains(buildTimeline(firstLine(score), TENOR_SAX)))
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
  setAttr(score, 2, 'time', { beats: 3, beatType: 4 })
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

// --- more-marks group 3: ornaments, grace notes, chord marks, stronger and shorter marks (design D3) ---

/** A note element with raw notations, optionally a chord member or a grace note (divisions 12). */
function x(spec: { step: string; octave: number; type?: string; alter?: number; notations?: string; chord?: boolean; grace?: boolean }): string {
  const type = spec.type ?? 'quarter'
  const ticks = { whole: 48, half: 24, quarter: 12, eighth: 6 }[type] ?? 12
  return (
    `<note>${spec.grace ? '<grace/>' : ''}${spec.chord ? '<chord/>' : ''}<pitch><step>${spec.step}</step>${spec.alter ? `<alter>${spec.alter}</alter>` : ''}<octave>${spec.octave}</octave></pitch>` +
    `${spec.grace ? '' : `<duration>${ticks}</duration>`}<voice>1</voice><type>${type}</type>` +
    `${spec.notations ? `<notations>${spec.notations}</notations>` : ''}<staff>1</staff></note>`
  )
}
const orn = (inner: string): string => `<ornaments>${inner}</ornaments>`
const art = (inner: string): string => `<articulations>${inner}</articulations>`

/** The timeline at concert pitch (no transposition), in a key. */
function inKey(bars: string[], fifths = 0) {
  const xml = scoreXml(bars.map((body) => ({ body }))).replace('<fifths>0</fifths>', `<fifths>${fifths}</fifths>`)
  return buildTimeline(firstLine(parseMusicXml(xml)), { transpose: 0 })
}
const bt = (f: { n: number; d: number }): number => f.n / f.d
const soundsOf = (e: PlaybackEvent) => {
  assert.ok(e.sounds, 'the event carries sounds')
  return e.sounds
}
const pitchesOf = (e: PlaybackEvent): number[] => soundsOf(e).map((s) => s.midi)

test('ornaments: an A4 trill in G major alternates A4 and B4 from the written note, ends on it, and the next note is on its beat', () => {
  const t = inKey([x({ step: 'A', octave: 4, notations: orn('<trill-mark/>') }) + x({ step: 'G', octave: 4 })], 1)
  const e = ev(t.events, 0)
  const midi = pitchesOf(e)
  assert.equal(midi[0], 69)
  assert.deepEqual([...new Set(midi)].sort(), [69, 71], 'A4 and B4 only')
  midi.forEach((m, k) => assert.equal(m, k % 2 === 0 ? 69 : 71, `note ${k}`))
  assert.equal(midi.at(-1), 69, 'ends on the main note')
  const s = soundsOf(e)
  assert.equal(bt(s[0]!.length), 1 / 8, 'ORNAMENT_NOTE')
  const last = s.at(-1)!
  assert.equal(bt(last.offset) + bt(last.length), 1, 'the trill fills the note')
  assert.equal(bt(ev(t.events, 1).start), 1, 'the next note is on its beat')
})

test('ornaments: an E5 trill in G major alternates E5 and F sharp 5', () => {
  const t = inKey([x({ step: 'E', octave: 5, notations: orn('<trill-mark/>') })], 1)
  const midi = pitchesOf(ev(t.events, 0))
  assert.deepEqual([...new Set(midi)].sort(), [76, 78])
  assert.equal(midi[0], 76)
})

test('ornaments: a trill honours an accidental earlier in the bar (F natural, then E5 trill in G major: upper note F5)', () => {
  const t = inKey([x({ step: 'F', octave: 5 }) + x({ step: 'E', octave: 5, notations: orn('<trill-mark/>') })], 1)
  assert.deepEqual([...new Set(pitchesOf(ev(t.events, 1)))].sort(), [76, 77])
})

test('ornaments: a turn on a half note D5 in C major is E5, D5, C5, then D5 held', () => {
  const t = inKey([x({ step: 'D', octave: 5, type: 'half', notations: orn('<turn/>') }) + x({ step: 'G', octave: 4, type: 'half' })])
  const e = ev(t.events, 0)
  assert.deepEqual(pitchesOf(e), [76, 74, 72, 74])
  const s = soundsOf(e)
  assert.deepEqual(s.map((k) => bt(k.offset)), [0, 1 / 8, 2 / 8, 3 / 8])
  assert.deepEqual(s.slice(0, 3).map((k) => bt(k.length)), [1 / 8, 1 / 8, 1 / 8])
  assert.equal(bt(s[3]!.offset) + bt(s[3]!.length), 2, 'D5 is held to the end of the half note')
  assert.equal(bt(ev(t.events, 1).start), 2)
})

test('ornaments: a mordent on a quarter note G4 in C major is G4, F4, then G4 held', () => {
  const t = inKey([x({ step: 'G', octave: 4, notations: orn('<mordent/>') }) + x({ step: 'A', octave: 4 })])
  const e = ev(t.events, 0)
  assert.deepEqual(pitchesOf(e), [67, 65, 67])
  const s = soundsOf(e)
  assert.deepEqual(s.map((k) => bt(k.offset)), [0, 1 / 8, 2 / 8])
  assert.equal(bt(s[2]!.offset) + bt(s[2]!.length), 1)
  assert.equal(bt(ev(t.events, 1).start), 1)
})

test('ornaments: the quick notes of a turn take at most a quarter of a short note each', () => {
  const t = inKey([x({ step: 'D', octave: 5, type: 'eighth', notations: orn('<turn/>') }) + x({ step: 'D', octave: 5, type: 'eighth' })])
  const s = soundsOf(ev(t.events, 0))
  assert.equal(bt(s[0]!.length), 1 / 8, 'an eighth is half a beat: a quarter of it is 1/8')
  const short = inKey([x({ step: 'D', octave: 5, type: 'eighth', notations: orn('<mordent/>') })])
  assert.ok(soundsOf(ev(short.events, 0)).every((k) => bt(k.length) > 0))
})

test('ornaments: an ornament is not a note of its own: one event per written note, the cursor and bar span unchanged', () => {
  const t = inKey([x({ step: 'A', octave: 4, notations: orn('<trill-mark/>') }) + x({ step: 'G', octave: 4, type: 'half' }) + x({ step: 'G', octave: 4 })])
  assert.equal(t.events.length, 3)
  assert.deepEqual(t.events.map((e) => bt(e.start)), [0, 1, 3])
  assert.equal(t.bars[0]!.firstEvent, 0)
  assert.equal(bt(t.bars[0]!.end), 4)
  assert.equal(t.eventOfNote(ev(t.events, 0).noteIds[0]!), ev(t.events, 0))
})

test('tremolo: a two-note tremolo C5/E5 is one event over both notes, alternating for the pair\'s length', () => {
  const pair = x({ step: 'C', octave: 5, type: 'half', notations: orn('<tremolo type="start">3</tremolo>') }) + x({ step: 'E', octave: 5, type: 'half', notations: orn('<tremolo type="stop">3</tremolo>') })
  const t = inKey([pair, x({ step: 'G', octave: 4, type: 'whole' })])
  assert.equal(t.events.length, 2, 'the pair is one event')
  const e = ev(t.events, 0)
  assert.equal(e.index, 0)
  assert.equal(e.noteIds.length, 2)
  assert.equal(bt(e.length), 4, 'the pair\'s combined value')
  const s = soundsOf(e)
  assert.equal(s.length, 32, 'thirty-second notes (1/8 beat) over four beats')
  s.forEach((k, i) => {
    assert.equal(k.midi, i % 2 === 0 ? 72 : 76)
    assert.equal(bt(k.length), 1 / 8)
  })
  assert.equal(bt(ev(t.events, 1).start), 4, 'the next note is on its beat')
  assert.equal(ev(t.events, 1).index, 1)
  assert.equal(t.eventOfNote(e.noteIds[1]!), e, 'tapping the second note starts the pair')
  assert.equal(t.bars[0]!.firstEvent, 0)
  assert.equal(t.bars[1]!.firstEvent, 1)
  assert.equal(bt(t.bars[0]!.end), 4)
})

test('tremolo: a single tremolo repeats the note over its value, in notes of 1/2^(strokes+2) of a whole note', () => {
  const t = inKey([x({ step: 'C', octave: 5, notations: orn('<tremolo type="single">3</tremolo>') }) + x({ step: 'D', octave: 5, notations: orn('<tremolo type="single">2</tremolo>') })])
  const a = soundsOf(ev(t.events, 0))
  assert.equal(a.length, 8)
  assert.ok(a.every((k) => k.midi === 72 && bt(k.length) === 1 / 8))
  const b = soundsOf(ev(t.events, 1))
  assert.equal(b.length, 4, 'two strokes: sixteenth notes')
  assert.equal(bt(b[0]!.length), 1 / 4)
})

test('grace notes: a grace D5 before a quarter C5 on beat 2 ends exactly on beat 2, and C5 starts exactly on beat 2', () => {
  const t = inKey([x({ step: 'E', octave: 5 }) + x({ step: 'D', octave: 5, grace: true }) + x({ step: 'C', octave: 5 }) + x({ step: 'G', octave: 4, type: 'half' })])
  assert.equal(t.events.length, 3, 'a grace note has no event of its own')
  const e = ev(t.events, 1)
  assert.equal(bt(e.start), 1)
  const [grace, main] = soundsOf(e)
  assert.equal(grace!.midi, 74)
  assert.equal(bt(grace!.offset), -1 / 8)
  assert.equal(bt(grace!.length), 1 / 8)
  assert.equal(bt(grace!.offset) + bt(grace!.length), 0, 'it ends on the beat')
  assert.equal(main!.midi, 72)
  assert.equal(bt(main!.offset), 0)
  assert.equal(bt(main!.length), 1)
  assert.equal(bt(ev(t.events, 0).sounding), 7 / 8, 'the time comes from the sound of the note before, which stays on the grid')
  assert.equal(bt(ev(t.events, 0).length), 1)
  assert.equal(bt(ev(t.events, 2).start), 2)
})

test('grace notes: several grace notes sound in order, each ending where the next begins, the last on the beat', () => {
  const t = inKey([x({ step: 'E', octave: 5 }) + x({ step: 'D', octave: 5, grace: true }) + x({ step: 'E', octave: 5, grace: true }) + x({ step: 'C', octave: 5 })])
  const s = soundsOf(ev(t.events, 1))
  assert.deepEqual(s.slice(0, 2).map((k) => [k.midi, bt(k.offset)]), [[74, -2 / 8], [76, -1 / 8]])
})

test('grace notes: a short note before them gives up at most half its value', () => {
  const t = inKey([x({ step: 'E', octave: 5, type: 'eighth' }) + x({ step: 'D', octave: 5, grace: true }) + x({ step: 'E', octave: 5, grace: true }) + x({ step: 'C', octave: 5, type: 'eighth' })])
  const [g1, g2] = soundsOf(ev(t.events, 1))
  assert.equal(bt(g1!.length), 1 / 8, 'half of the eighth (1/2 beat) shared by two graces is 1/8 each')
  assert.equal(bt(g2!.offset) + bt(g2!.length), 0)
  assert.ok(bt(ev(t.events, 0).sounding) <= 1 / 2 - 2 / 8 + 1e-12)
})

test('grace notes: the first note of the piece carries its grace sound before its start', () => {
  const t = inKey([x({ step: 'D', octave: 5, grace: true }) + x({ step: 'C', octave: 5 })])
  const s = soundsOf(ev(t.events, 0))
  assert.equal(bt(s[0]!.offset), -1 / 8)
  assert.equal(bt(ev(t.events, 0).start), 0)
})

test('chord marks: an arpeggio C4-E4-G4 has its lowest note on the beat, then E4, then G4, all held to the chord\'s end', () => {
  const t = inKey([x({ step: 'C', octave: 4, notations: '<arpeggiate/>' }) + x({ step: 'E', octave: 4, chord: true }) + x({ step: 'G', octave: 4, chord: true }) + x({ step: 'A', octave: 4 })])
  const e = ev(t.events, 0)
  const s = soundsOf(e)
  assert.deepEqual(s.map((k) => k.midi), [60, 64, 67])
  assert.deepEqual(s.map((k) => bt(k.offset)), [0, 1 / 16, 2 / 16])
  assert.ok(s.every((k) => bt(k.offset) + bt(k.length) === 1), 'all end with the chord')
  assert.equal(bt(ev(t.events, 1).start), 1)
})

test('chord marks: a quarter-note chord with a fermata on its top note lasts two beats (two seconds at 60 bpm)', () => {
  const t = inKey([x({ step: 'C', octave: 4 }) + x({ step: 'E', octave: 4, chord: true }) + x({ step: 'G', octave: 4, chord: true, notations: '<fermata/>' }) + x({ step: 'A', octave: 4 })])
  const e = ev(t.events, 0)
  assert.equal(bt(e.length), 2)
  assert.equal(bt(e.sounding), 2)
  assert.equal(bt(ev(t.events, 1).start), 2)
  assert.equal(bt(e.length) * (60 / 60), 2, 'at 60 bpm a beat is a second')
})

test('strong accent: it starts louder than an accent at the same dynamic, under the same cap', () => {
  const t = inKey([dyn('p') + x({ step: 'C', octave: 4, notations: art('<accent/>') }) + x({ step: 'C', octave: 4, notations: art('<strong-accent/>') }) + x({ step: 'C', octave: 4 })])
  const [a, b, c] = t.events
  assert.equal(a!.gain, b!.gain)
  assert.ok(b!.attackGain > a!.attackGain, 'strong accent above accent')
  assert.ok(a!.attackGain > c!.attackGain)
  assert.ok(Math.abs(20 * Math.log10(b!.attackGain / b!.gain) - STRONG_ACCENT_DB) < 1e-9)
  assert.equal(STRONG_ACCENT_DB, 7)
  const loud = inKey([`${dyn('fff')}${x({ step: 'C', octave: 4, notations: art('<strong-accent/>') })}`])
  assert.ok(ev(loud.events, 0).attackGain <= MAX_ATTACK_GAIN)
})

test('staccatissimo: it sounds a quarter of the value, shorter than staccato (a half), and tenuto does not cancel it', () => {
  const t = inKey([x({ step: 'C', octave: 4, notations: art('<staccato/>') }) + x({ step: 'C', octave: 4, notations: art('<staccatissimo/>') }) + x({ step: 'C', octave: 4, notations: art('<staccatissimo/><tenuto/>') })])
  assert.equal(bt(ev(t.events, 0).sounding), 1 / 2)
  assert.equal(bt(ev(t.events, 1).sounding), 1 / 4)
  assert.ok(bt(ev(t.events, 1).sounding) < bt(ev(t.events, 0).sounding))
  assert.equal(bt(ev(t.events, 2).sounding), 1 / 4, 'tenuto does not cancel staccatissimo')
  assert.equal(bt(ev(t.events, 1).length), 1)
})

test('caesura: it leaves a gap of 1/4 beat (a breath mark 1/8) and the next note is on its beat', () => {
  const t = inKey([x({ step: 'C', octave: 4, notations: art('<caesura/>') }) + x({ step: 'D', octave: 4, notations: art('<breath-mark/>') }) + x({ step: 'E', octave: 4 })])
  assert.equal(bt(ev(t.events, 0).sounding), 3 / 4)
  assert.equal(bt(ev(t.events, 1).sounding), 7 / 8)
  assert.equal(bt(ev(t.events, 1).start), 1)
  assert.equal(bt(ev(t.events, 2).start), 2)
})

test('ornaments: a trill on the top note of a chord trills that note while the others are held (C4-E4 held, G4 trills with A4)', () => {
  const t = inKey([x({ step: 'C', octave: 4, type: 'half' }) + x({ step: 'E', octave: 4, type: 'half', chord: true }) + x({ step: 'G', octave: 4, type: 'half', chord: true, notations: orn('<trill-mark/>') }) + x({ step: 'C', octave: 4, type: 'half' })])
  const e = ev(t.events, 0)
  const s = soundsOf(e)
  const held = s.filter((x) => x.midi === 60 || x.midi === 64)
  assert.equal(held.length, 2, 'C4 and E4 sound once each')
  for (const h of held) {
    assert.equal(bt(h.offset), 0)
    assert.equal(bt(h.length), bt(e.sounding), 'held for the chord')
  }
  const trill = s.filter((x) => x.midi !== 60 && x.midi !== 64).map((x) => x.midi)
  assert.deepEqual([...new Set(trill)].sort(), [67, 69], 'G4 and A4')
  assert.equal(trill[0], 67)
  assert.equal(trill.at(-1), 67)
  assert.equal(bt(ev(t.events, 1).start), 2, 'the next note is on its beat')
})

test('ornaments: a mordent on the first note of a chord is played on it, the other note held', () => {
  const t = inKey([x({ step: 'G', octave: 4, notations: orn('<mordent/>') }) + x({ step: 'B', octave: 4, chord: true }) + x({ step: 'C', octave: 4, type: 'half' }) + x({ step: 'C', octave: 4 })])
  const s = soundsOf(ev(t.events, 0))
  assert.deepEqual(s.map((x) => x.midi), [71, 67, 65, 67], 'B4 held, then G4 F4 G4')
})

/** A quarter-note chord C4-E4 (the mark on the first note, on the top note, or on neither) and a quarter note after it. */
const markedChord = (notations: string, on: 'first' | 'top' | 'none') =>
  inKey([
    x({ step: 'C', octave: 4, ...(on === 'first' ? { notations } : {}) }) +
      x({ step: 'E', octave: 4, chord: true, ...(on === 'top' ? { notations } : {}) }) +
      x({ step: 'G', octave: 4 }),
  ])

test('chord marks: staccato on the top note of a chord shortens the chord as it does on the first note', () => {
  const top = ev(markedChord(art('<staccato/>'), 'top').events, 0)
  const first = ev(markedChord(art('<staccato/>'), 'first').events, 0)
  assert.equal(bt(first.sounding), 1 / 2, 'on the first note: half the value')
  assert.equal(bt(top.sounding), 1 / 2, 'on the top note: half the value too')
  assert.equal(top.staccato, true)
  assert.equal(bt(top.length), 1)
})

test('chord marks: every articulation on a chord member is played as on the first note (staccatissimo, tenuto, breath, caesura)', () => {
  const cases: { mark: string; notations: string; sounding: number }[] = [
    { mark: 'staccato', notations: art('<staccato/>'), sounding: 1 / 2 },
    { mark: 'staccatissimo', notations: art('<staccatissimo/>'), sounding: 1 / 4 },
    { mark: 'breath', notations: art('<breath-mark/>'), sounding: 7 / 8 },
    { mark: 'caesura', notations: art('<caesura/>'), sounding: 3 / 4 },
  ]
  for (const c of cases) {
    const first = ev(markedChord(c.notations, 'first').events, 0)
    const top = ev(markedChord(c.notations, 'top').events, 0)
    assert.equal(bt(first.sounding), c.sounding, `${c.mark} on the first note`)
    assert.equal(bt(top.sounding), c.sounding, `${c.mark} on the top note`)
    assert.equal(top.staccato, first.staccato, `${c.mark}: the same release`)
  }
  // Tenuto on the top note takes away the staccato of the first note, as both marks on one note do.
  const both = inKey([x({ step: 'C', octave: 4, notations: art('<staccato/>') }) + x({ step: 'E', octave: 4, chord: true, notations: art('<tenuto/>') }) + x({ step: 'G', octave: 4 })])
  assert.equal(bt(ev(both.events, 0).sounding), 1, 'tenuto on the top note: the chord is held for its whole value')
  assert.equal(ev(both.events, 0).staccato, false)
  // A plain chord member does not take away the first note's breath mark or caesura.
  for (const mark of ['<breath-mark/>', '<caesura/>']) {
    const kept = markedChord(art(mark), 'first')
    assert.ok(bt(ev(kept.events, 0).sounding) < 1, `${mark} on the first note still leaves its gap`)
  }
  assert.equal(bt(ev(markedChord(art('<staccato/>'), 'none').events, 0).sounding), 1, 'a plain chord sounds its whole value')
})

test('chord marks: a single tremolo on the top note of a chord repeats the chord, as on the first note', () => {
  const first = soundsOf(ev(markedChord(orn('<tremolo type="single">3</tremolo>'), 'first').events, 0))
  const top = soundsOf(ev(markedChord(orn('<tremolo type="single">3</tremolo>'), 'top').events, 0))
  assert.equal(first.length, 16, 'C4 and E4 in eight thirty-second notes')
  assert.deepEqual(
    top.map((k) => [k.midi, bt(k.offset), bt(k.length)]),
    first.map((k) => [k.midi, bt(k.offset), bt(k.length)]),
  )
  assert.equal(ev(markedChord(orn('<tremolo type="single">3</tremolo>'), 'none').events, 0).sounds, undefined)
})

// ---------------------------------------------------------------------------------------------------
// Parts and accompaniment (change parts-and-accompaniment, group 4): one timeline from every part.
// ---------------------------------------------------------------------------------------------------

const melodyPiano = () => parseMusicXml(read(MELODY_PIANO_FIXTURE))
const beatOf = (e: PlaybackEvent): number => e.start.n / e.start.d
const lengthOf = (e: PlaybackEvent): number => e.length.n / e.length.d
const partOf = (e: PlaybackEvent): string => e.voice.part

test('timeline (parts): the events of every part are in time order, then part, staff and voice, and index is the position', () => {
  const t = buildTimeline(melodyPiano(), TENOR_SAX)
  t.events.forEach((e, i) => assert.equal(e.index, i))
  for (let i = 1; i < t.events.length; i++) {
    const a = t.events[i - 1]!
    const b = t.events[i]!
    const key = (e: PlaybackEvent): number[] => [beatOf(e), e.voice.part === 'P1' ? 0 : 1, e.voice.staff, e.voice.voice]
    const [ka, kb] = [key(a), key(b)]
    const firstDifferent = ka.findIndex((x, k) => x !== kb[k])
    assert.ok(firstDifferent < 0 || ka[firstDifferent]! < kb[firstDifferent]!, `event ${i} is not before event ${i - 1}`)
  }
  // The bars are shared: the first event of each bar is the first that starts in it, whichever part it is of.
  for (const span of t.bars) {
    const first = t.events[span.firstEvent]
    assert.ok(first && beatOf(first) >= span.start.n / span.start.d)
    if (span.firstEvent > 0) assert.ok(beatOf(t.events[span.firstEvent - 1]!) < span.start.n / span.start.d)
  }
})

test('timeline (parts): a repeat plays both parts twice', () => {
  const t = buildTimeline(melodyPiano(), TENOR_SAX)
  const firstBar = t.events.filter((e) => e.barIndex === 0)
  for (const part of ['P1', 'P2']) {
    assert.deepEqual([...new Set(firstBar.filter((e) => partOf(e) === part).map((e) => e.pass))], [1, 2], `${part} plays bar 1 on both passes`)
  }
  assert.deepEqual(t.bars.map((b) => `${b.bar}.${b.pass}`), ['1.1', '2.1', '3.1', '4.1', '1.2', '2.2', '3.2', '4.2', '5.1', '6.1', '7.1', '8.1'])
  assert.equal(t.events.filter((e) => e.barIndex === 7).length, 3, 'the last bar is played once: a melody note and the piano chord and bass')
})

test('timeline (parts): the melody sounds a major ninth below written on the tenor saxophone, the piano at written pitch, each with its sound', () => {
  const t = buildTimeline(melodyPiano(), TENOR_SAX)
  const melody = t.events.find((e) => partOf(e) === 'P1')!
  assert.deepEqual(melody.written, [67])
  assert.deepEqual(melody.pitches, [53], 'written G4, sounding F3')
  assert.equal(melody.sound, 'tenor-sax')
  const chord = t.events.find((e) => partOf(e) === 'P2' && e.voice.staff === 0)!
  assert.deepEqual(chord.written, [60, 64, 67])
  assert.deepEqual(chord.pitches, [60, 64, 67], 'the piano is not transposed')
  assert.equal(chord.sound, 'piano')
  // On the alto saxophone the melody moves with the instrument and the piano does not.
  const alto = buildTimeline(melodyPiano(), ALTO_SAX)
  assert.deepEqual(alto.events.find((e) => partOf(e) === 'P1')!.pitches, [58])
  assert.deepEqual(alto.events.find((e) => partOf(e) === 'P2')!.pitches, [60, 64, 67])
})

test('timeline (parts): your part is own, the others play along; a hand is your line, the other hand plays along (Left hand plays along)', () => {
  const t = buildTimeline(melodyPiano(), TENOR_SAX)
  assert.ok(t.events.every((e) => e.own === (partOf(e) === 'P1')), 'default: the first part')

  const right = buildTimeline(melodyPiano(), TENOR_SAX, { part: { id: 'P2', hand: 'right' } })
  assert.ok(right.events.some((e) => e.voice.staff === 1), 'the left hand is in the stream')
  for (const e of right.events) {
    assert.equal(e.own, partOf(e) === 'P2' && e.voice.staff === 0, `${e.voice.part}/${e.voice.staff} own`)
    if (e.voice.part === 'P2' && e.voice.staff === 1) assert.equal(e.sound, 'piano')
  }
  const left = buildTimeline(melodyPiano(), TENOR_SAX, { part: { id: 'P2', hand: 'left' } })
  assert.ok(left.events.every((e) => e.own === (partOf(e) === 'P2' && e.voice.staff === 1)))
  const both = buildTimeline(melodyPiano(), TENOR_SAX, { part: { id: 'P2' } })
  assert.ok(both.events.every((e) => e.own === (partOf(e) === 'P2')), 'a two-staff part without a hand is your line on both staves')
})

test('timeline (parts): a silent part or hand leaves no events at all, and the timing does not change', () => {
  const all = buildTimeline(melodyPiano(), TENOR_SAX)
  const noPiano = buildTimeline(melodyPiano(), TENOR_SAX, { silent: ['P2'] })
  assert.ok(noPiano.events.length > 0 && noPiano.events.every((e) => partOf(e) === 'P1'))
  assert.deepEqual(noPiano.bars.map((b) => [b.start.n / b.start.d, b.end.n / b.end.d]), all.bars.map((b) => [b.start.n / b.start.d, b.end.n / b.end.d]))
  const noLeft = buildTimeline(melodyPiano(), TENOR_SAX, { silent: ['P2:left'] })
  assert.ok(noLeft.events.some((e) => e.voice.part === 'P2' && e.voice.staff === 0))
  assert.ok(!noLeft.events.some((e) => e.voice.part === 'P2' && e.voice.staff === 1))
  assert.ok(!buildTimeline(melodyPiano(), TENOR_SAX, { silent: ['P2:right'] }).events.some((e) => e.voice.part === 'P2' && e.voice.staff === 0))
  // Your own line is never left out by it.
  assert.ok(buildTimeline(melodyPiano(), TENOR_SAX, { silent: ['P1'] }).events.some((e) => e.voice.part === 'P1'))
  // A tap on a note of a silent part finds nothing.
  const leftNote = all.events.find((e) => e.voice.part === 'P2' && e.voice.staff === 1)!.noteIds[0]!
  assert.equal(noLeft.eventOfNote(leftNote), undefined)
})

test('timeline (parts): the melody slur is not broken by the piano events between its notes; legato follows the voice', () => {
  const t = buildTimeline(melodyPiano(), TENOR_SAX)
  const slur = t.events.filter((e) => partOf(e) === 'P1' && e.barIndex === 5)
  assert.equal(slur.length, 4)
  assert.deepEqual(slur.map((e) => [e.legatoNext, e.attack]), [[true, true], [true, false], [false, false], [false, true]])
  for (const e of slur.slice(0, 3)) {
    const next = t.events[e.nextInVoice!]!
    assert.equal(partOf(next), 'P1')
    assert.ok(beatOf(next) > beatOf(e))
  }
  assert.ok(slur.slice(0, 3).some((e) => e.nextInVoice !== e.index + 1), 'a piano chord lies between two of the slurred notes, and the slur is not broken by it')
  // The piano's notes are not slurred.
  assert.ok(t.events.filter((e) => partOf(e) === 'P2').every((e) => !e.legatoNext && e.attack))
  // nextInVoice stays within one voice, for every event.
  for (const e of t.events) {
    if (e.nextInVoice === undefined) continue
    const next = t.events[e.nextInVoice]!
    assert.deepEqual(next.voice, e.voice)
    assert.ok(e.nextInVoice > e.index)
  }
})

test('timeline (parts): the chord notes of a guitar sound an octave below written', () => {
  const score = scoreOf([{ body: n({ step: 'C', octave: 4 }) + inChord(n({ step: 'E', octave: 4 })) + inChord(n({ step: 'G', octave: 4 })) + n({ rest: true }) + n({ step: 'A', octave: 4 }) + n({ step: 'B', octave: 4 }) }])
  const t = buildTimeline(score, GUITAR)
  assert.deepEqual(t.events[0]!.written, [60, 64, 67])
  assert.deepEqual(t.events[0]!.pitches, [48, 52, 55])
  assert.equal(t.events[0]!.sound, 'guitar')
  // The same through a guitar melody in a score with a piano.
  const withPiano = buildTimeline(melodyPiano(), GUITAR)
  assert.deepEqual(withPiano.events.find((e) => partOf(e) === 'P1')!.pitches, [55])
  assert.equal(withPiano.events.find((e) => partOf(e) === 'P1')!.sound, 'guitar')
  assert.deepEqual(withPiano.events.find((e) => partOf(e) === 'P2')!.pitches, [60, 64, 67])
})

test('timeline (parts): a one-line score read by the score builder is the same as by its view', () => {
  const score = scoreOf([{ body: n({ step: 'C', slur: 'start' }) + n({ step: 'D' }) + n({ step: 'E', slur: 'stop', fermata: true }) + n({ step: 'F', accent: true }) }, { body: n({ step: 'G', type: 'whole' }) }])
  const a = buildTimeline(score, TENOR_SAX)
  const b = buildTimeline(firstLine(score), TENOR_SAX)
  const plain = (t: ReturnType<typeof buildTimeline>) => JSON.stringify([t.events.map((e) => ({ ...e, voice: undefined })), t.bars, t.clicks, t.end])
  assert.equal(plain(a), plain(b))
})

// Fermata map (design D6.2)

test('timeline (parts): a fermata in one part holds the other parts too, and both go on together after it', () => {
  const t = buildTimeline(melodyPiano(), TENOR_SAX)
  // Bar 3: the fermata is on the melody's half note on beat 3; the piano plays chords and a bass there.
  const bar3 = t.events.filter((e) => e.barIndex === 2 && e.pass === 1)
  const held = (part: string) => bar3.filter((e) => partOf(e) === part && beatOf(e) === 10)
  assert.ok(held('P1').length === 1 && held('P2').length >= 3)
  for (const e of [...held('P1'), ...held('P2')]) assert.equal(lengthOf(e), 4, `${e.voice.part} is held for twice its value`)
  // Before it nothing moves; after it both parts start bar 4 together, 2 beats later than written.
  assert.deepEqual(bar3.filter((e) => beatOf(e) < 10).map(beatOf), [8, 8, 8, 8, 9, 9], 'the melody, the chord and two left-hand voices (one a rest) on beat 1, and two on beat 2')
  const bar4 = t.events.filter((e) => e.barIndex === 3 && e.pass === 1)
  assert.deepEqual([...new Set(bar4.map(beatOf))], [14])
  assert.equal(bar4.length, 3)
  // The bar spans and the next pass carry the same stretch; the repeat holds it again.
  assert.deepEqual(t.bars.slice(0, 5).map((b) => [b.start.n, b.end.n]), [[0, 4], [4, 8], [8, 14], [14, 18], [18, 22]])
  assert.equal(t.bars[6]!.end.n - t.bars[6]!.start.n, 6, 'the held bar on the second pass')
  assert.equal(t.end.n, 52)
})

test('timeline (parts): a note across a fermata of another part is stretched with it', () => {
  // Melody: four quarters, the second held. Piano: a whole note over the bar.
  const score = partsOf([
    { id: 'P1', bars: [n({ step: 'C' }) + n({ step: 'D', fermata: true }) + n({ step: 'E' }) + n({ step: 'F' })] },
    { id: 'P2', bars: [n({ step: 'C', octave: 3, type: 'whole' })] },
  ])
  const t = buildTimeline(score, TENOR_SAX)
  const piano = t.events.find((e) => partOf(e) === 'P2')!
  assert.equal(lengthOf(piano), 5, 'a whole note is 4 beats written, and 5 with one of its quarters held')
  assert.deepEqual(t.events.filter((e) => partOf(e) === 'P1').map((e) => [beatOf(e), lengthOf(e)]), [[0, 1], [1, 2], [3, 1], [4, 1]])
  assert.equal(t.end.n, 5)
})

test('timeline (parts): overlapping fermatas of several parts are one hold, stretched once', () => {
  // The melody holds its first quarter; the piano holds a half note over it: the union is the half note's two beats.
  const score = partsOf([
    { id: 'P1', bars: [n({ step: 'C', fermata: true }) + n({ step: 'D' }) + n({ step: 'E' }) + n({ step: 'F' }), n({ step: 'G', type: 'whole' })] },
    { id: 'P2', bars: [n({ step: 'C', octave: 3, type: 'half', fermata: true }) + n({ step: 'G', octave: 2, type: 'half' }), n({ step: 'C', octave: 3, type: 'whole' })] },
  ])
  const t = buildTimeline(score, TENOR_SAX)
  const melody = t.events.filter((e) => partOf(e) === 'P1')
  assert.deepEqual(melody.map(beatOf), [0, 2, 4, 5, 6], 'the quarter after the held one starts after the whole hold of two beats written, doubled')
  assert.deepEqual(melody.map(lengthOf), [2, 2, 1, 1, 4], 'the first quarter is stretched with the whole hold: 1 beat written inside [0, 2)')
  const piano = t.events.filter((e) => partOf(e) === 'P2')
  assert.deepEqual(piano.map((e) => [beatOf(e), lengthOf(e)]), [[0, 4], [4, 2], [6, 4]])
  assert.deepEqual(t.bars.map((b) => [b.start.n, b.end.n]), [[0, 6], [6, 10]], 'written 2 + 2 + 4 = 4 beats, with the 2-beat hold doubled: +2')
})

test('timeline (parts): a tapped note starts every part at its time; clicks are laid once from the shared bars', () => {
  const t = buildTimeline(melodyPiano(), TENOR_SAX)
  const bar1 = t.clicks.filter((c) => c.barIndex === 0 && c.start.n < 4)
  assert.deepEqual(bar1.map((c) => c.start.n), [0, 1, 2, 3], 'one click per beat, not one per voice')
  // The fermata of bar 3 stops the clicks inside the hold, whichever part holds.
  assert.deepEqual(t.clicks.filter((c) => c.barIndex === 2 && c.start.n < 14).map((c) => c.start.n), [8, 9, 10])
  const tapped = t.eventOfNote(t.events.find((e) => partOf(e) === 'P1' && e.barIndex === 1 && beatOf(e) === 6)!.noteIds[0]!)!
  assert.equal(beatOf(tapped), 6)
  assert.ok(t.events.filter((e) => beatOf(e) === 6).length > 1, 'other parts have events at that time')
})

// Dynamics of a staff (design D6.3)

test('timeline (parts): a dynamic in one voice applies to every voice of its staff, a hairpin too', () => {
  const score = partsOf([
    {
      id: 'P1',
      bars: [
        dyn('p') + n({ step: 'C' }) + n({ step: 'D' }) + n({ step: 'E' }) + n({ step: 'F' }) + backup(4) + inVoice(n({ step: 'C', octave: 3, type: 'half' }) + n({ step: 'G', octave: 2, type: 'half' }), 2),
        wedge('crescendo') + n({ step: 'C' }) + n({ step: 'D' }) + n({ step: 'E' }) + n({ step: 'F' }) + wedge('stop') + backup(4) + inVoice(n({ step: 'C', octave: 3, type: 'half' }) + n({ step: 'G', octave: 2, type: 'half' }), 2),
      ],
    },
  ])
  const t = buildTimeline(score, TENOR_SAX)
  const voice = (k: number) => t.events.filter((e) => e.voice.voice === k)
  assert.equal(voice(1).length, 4)
  assert.ok(voice(0).concat(voice(1)).filter((e) => e.barIndex === 0).every((e) => e.gain === DYNAMIC_GAIN.p!), 'p is in force in both voices')
  const second = voice(1).filter((e) => e.barIndex === 1)
  assert.ok(second[1]!.gain > second[0]!.gain, 'the hairpin, written in the first voice, also lifts the second voice')
  assert.ok(voice(0).filter((e) => e.barIndex === 1).at(-1)!.gain > DYNAMIC_GAIN.p!)
})

test('timeline (parts): the staves of a part have their own dynamics', () => {
  const rh = n({ step: 'C', type: 'whole' })
  const lh = onLeftHand(n({ step: 'C', octave: 3, type: 'whole' }))
  const score = partsOf([{ id: 'P1', staves: 2, bars: [dyn('ff') + rh + backup(4) + lh, rh + backup(4) + lh] }])
  const t = buildTimeline(score, TENOR_SAX)
  const gains = (staff: number) => t.events.filter((e) => e.voice.staff === staff).map((e) => e.gain)
  assert.deepEqual(gains(0), [DYNAMIC_GAIN.ff, DYNAMIC_GAIN.ff], 'the staff of the mark')
  assert.deepEqual(gains(1), [DYNAMIC_GAIN.mf, DYNAMIC_GAIN.mf], 'the other staff is not touched')
})

test('timeline (parts): what sounds at a time is every event under it, a line of yours first, and the bar comes from the bar spans', () => {
  const score = partsOf([{ id: 'P1', staves: 2, bars: [n({ step: 'C' }) + n({ step: 'D' }) + n({ step: 'E' }) + n({ step: 'F' }) + backup(4) + onLeftHand(n({ step: 'C', octave: 3, type: 'whole' })), n({ step: 'G', type: 'whole' }) + backup(4) + onLeftHand(n({ step: 'C', octave: 3, type: 'whole' }))] }])
  const t = buildTimeline(score, TENOR_SAX)
  assert.deepEqual(t.ownAt(2.5).map((e) => [e.voice.staff, beatOf(e)]), [[0, 2], [1, 0]], 'the quarter that began last, then the whole note')
  assert.equal(t.eventAtBeat(2.5)!.voice.staff, 0)
  assert.equal(t.barAt(2.5)!.barIndex, 0)
  assert.equal(t.barAt(4)!.barIndex, 1)
  assert.deepEqual(t.ownAt(4.5).map((e) => e.voice.staff), [0, 1])
  assert.deepEqual(t.ownAt(8), [], 'nothing after the end')
  assert.equal(t.eventAtBeat(8), undefined)
})
