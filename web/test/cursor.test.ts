import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CursorDriver, CursorTracker, heardTime, scrollDelta } from '../src/core/playback/cursor.ts'
import { Scheduler } from '../src/core/playback/scheduler.ts'
import type { NoteOutput, VoiceHandle } from '../src/core/playback/scheduler.ts'
import { TENOR_SAX } from '../src/core/instruments/instruments.ts'
import { buildTimeline } from '../src/core/playback/timeline.ts'
import { parseMusicXml } from '../src/core/score/musicxml.ts'
import { drawnBars, indexScore } from '../src/core/score/noteMap.ts'
import { renderScore } from '../src/core/score/render.ts'
import { parseXml } from '../src/core/score/xml.ts'
import type { XmlElement } from '../src/core/score/xml.ts'
import { HOMR_MARKS_FIXTURE, read } from './helpers.ts'
import { n, scoreOf, tenorTimeline } from './playbackHelpers.ts'

const silent: NoteOutput = { noteOn: (): VoiceHandle => ({ release() {}, cancel() {} }) }

function rig() {
  const clock = { currentTime: 0 }
  const timeline = tenorTimeline(scoreOf([{ body: n({ step: 'C', id: 'n1' }) + n({ rest: true, id: 'r' }) + n({ step: 'E', id: 'n3' }) + n({ step: 'F', id: 'n4' }) }]))
  const scheduler = new Scheduler(timeline, { clock, output: silent, timer: { set: () => 1, clear() {} }, bpm: 120 })
  scheduler.start() // anchored at 0.06 s; 0.5 s per beat
  return { clock, timeline, scheduler }
}

test('cursor: time maps to the event being heard (before, during, after)', () => {
  const { scheduler } = rig()
  assert.equal(scheduler.positionAt(0.01).event, undefined, 'before the first note')
  assert.equal(scheduler.positionAt(0.06).event?.noteIds[0], 'n1')
  assert.equal(scheduler.positionAt(0.55).event?.noteIds[0], 'n1')
  assert.equal(scheduler.positionAt(0.57).event?.noteIds[0], 'r', 'rests are events too')
  assert.equal(scheduler.positionAt(1.1).event?.noteIds[0], 'n3')
  assert.equal(scheduler.positionAt(1.6).event?.noteIds[0], 'n4')
  assert.equal(scheduler.positionAt(2.1).finished, true)
})

test('cursor: output latency delays the highlight so it matches what is heard', () => {
  const { clock, scheduler } = rig()
  const latency = 0.2
  const tracker = new CursorTracker((t) => scheduler.positionAt(t), () => heardTime(clock, latency))
  // The second event (rest) is scheduled at audio time 0.56; the listener hears it at 0.76.
  clock.currentTime = 0.6
  assert.equal(tracker.poll().event?.noteIds[0], 'n1', 'still the first note')
  clock.currentTime = 0.75
  assert.equal(tracker.poll().changed, false)
  clock.currentTime = 0.77
  const u = tracker.poll()
  assert.equal(u.changed, true)
  assert.equal(u.event?.noteIds[0], 'r')
  assert.equal(tracker.poll().changed, false, 'unchanged event is not reported twice')
})

test('cursor: the end of the score is reported once as finished', () => {
  const { clock, scheduler } = rig()
  const tracker = new CursorTracker((t) => scheduler.positionAt(t), () => clock.currentTime)
  clock.currentTime = 3
  const u = tracker.poll()
  assert.equal(u.finished, true)
  assert.equal(u.event, undefined)
})

test('cursor: scrollDelta leaves a visible line alone and brings an off-screen line up to a third of the height', () => {
  assert.equal(scrollDelta({ top: 100, bottom: 160, viewportHeight: 800 }), 0)
  assert.equal(scrollDelta({ top: 900, bottom: 960, viewportHeight: 800 }), 900 - 800 / 3)
  assert.equal(scrollDelta({ top: -80, bottom: -20, viewportHeight: 800 }), -80 - 800 / 3)
  assert.notEqual(scrollDelta({ top: 770, bottom: 790, viewportHeight: 800 }), 0, 'too close to the bottom edge')
})

test('cursor driver: highlights on change, scrolls only when the line is off screen', () => {
  const { clock, scheduler } = rig()
  const tops: Record<string, number> = { n1: 100, r: 100, n3: 1000, n4: 1000 }
  const log: string[] = []
  const view = {
    elementsFor: (id: string) => [{ getBoundingClientRect: () => ({ top: tops[id]!, bottom: tops[id]! + 50 }) }],
    highlight: (ids: string[]) => log.push(`hl ${ids.join(',')}`),
    clearHighlight: () => log.push('clear'),
  }
  const tracker = new CursorTracker((t) => scheduler.positionAt(t), () => clock.currentTime)
  const driver = new CursorDriver({ view, tracker, viewportHeight: () => 800, scrollBy: (dy) => log.push(`scroll ${Math.round(dy)}`) })
  clock.currentTime = 0.1
  driver.step()
  driver.step()
  clock.currentTime = 1.1
  driver.step()
  clock.currentTime = 3
  driver.step()
  assert.deepEqual(log, ['hl n1', 'hl n3', `scroll ${Math.round(1000 - 800 / 3)}`, 'clear'])
})

// The cursor on a collapsed multi-measure rest (change more-marks, task 2.2): the model's four rests are four
// events, and all of them are drawn by the one symbol; the note after the run is the next drawn measure.

test('cursor: through a collapsed run every bar stays on the one symbol, and the note after it is highlighted on time', async () => {
  const score = parseMusicXml(read(HOMR_MARKS_FIXTURE))
  const [svg] = await renderScore(score, { width: 360, multiRests: 'collapse' })
  const bars = drawnBars(score, 'collapse')
  const measures = (function find(node: XmlElement): XmlElement[] {
    const own = (node.attrs.class ?? '').split(/\s+/).includes('measure') ? [node] : []
    return own.length ? own : node.children.flatMap(find)
  })(parseXml(svg!))
  assert.equal(measures.length, 9)
  const hasSymbol = (m: XmlElement): boolean => (m.attrs.class ?? '').split(/\s+/).includes('multiRest') || m.children.some(hasSymbol)
  const drawnMeasure = (noteId: string) => measures[bars.measureOf[indexScore(score).get(noteId)!.barIndex]!]!

  const timeline = buildTimeline(score, TENOR_SAX)
  const clock = { currentTime: 0 }
  const scheduler = new Scheduler(timeline, { clock, output: silent, timer: { set: () => 1, clear() {} }, bpm: 120 })
  scheduler.start() // anchored at 0.06 s; 0.5 s per beat
  const at = (beats: number) => scheduler.positionAt(0.06 + beats * 0.5 + 0.01).event
  const beatOf = (barIndex: number) => {
    const e = timeline.events.find((x) => x.barIndex === barIndex && !x.rest) ?? timeline.events.find((x) => x.barIndex === barIndex)!
    return (e.start.n / e.start.d)
  }

  const shown = new Set<XmlElement>()
  for (const bar of [7, 8, 9, 10]) {
    const event = at(beatOf(bar) + 1) // inside the bar
    assert.equal(event?.barIndex, bar, `bar ${bar + 1} is heard`)
    assert.equal(event?.rest, true)
    const measure = drawnMeasure(event!.noteIds[0]!)
    assert.ok(hasSymbol(measure), `the rest of bar ${bar + 1} is drawn by the symbol`)
    shown.add(measure)
  }
  assert.equal(shown.size, 1, 'one drawn measure, so one symbol, for the four bars')

  // The note after the run, bar 12, is heard when its time comes and is in the next drawn measure.
  const last = beatOf(11)
  assert.equal(at(last - 0.1)?.barIndex, 10, 'still the run just before')
  const after = at(last + 0.01)
  assert.equal(after?.barIndex, 11)
  assert.equal(after?.rest, false)
  const next = drawnMeasure(after!.noteIds[0]!)
  assert.notEqual(next, [...shown][0])
  assert.equal(hasSymbol(next), false)
  assert.equal(measures.indexOf(next), 8)
})
