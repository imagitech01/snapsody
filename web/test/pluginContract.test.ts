import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createFakePlatform } from '../src/platform/fake/index.ts'
import type { FakePageOutcome } from '../src/platform/fake/index.ts'
import { PlatformError } from '../src/platform/port.ts'
import type { ReaderEvent, ReaderStaff } from '../src/platform/port.ts'
import { eventErrors, replyErrors, requestErrors } from './contract.ts'
import { call, event, loadExamples } from './contractFixtures.ts'

// The plugin contract (fixtures/bridge/, practice-app tasks 10.2 and 10.3, design D15): the fake
// platform's scanner and reader give what the examples show. The Kotlin handlers are checked
// against the same examples (android/app/src/test/), and the Capacitor adapter in
// capacitorAdapter.test.ts.

const examples = loadExamples()

/** The port's reader event types, each with its example `reader.<type>.json`. */
const READER_EVENTS: ReaderEvent['type'][] = ['progress', 'done', 'no-music', 'failed', 'finished']

test('plugin contract: the examples are well formed and cover every call and event', () => {
  assert.deepEqual([...examples.calls.keys()], [
    'atomicFiles.moveFile',
    'atomicFiles.writeTextAtomic',
    'reader.cancel',
    'reader.read',
    'scanner.scan',
  ])
  assert.deepEqual([...examples.events.keys()].sort(), READER_EVENTS.map((type) => `reader.${type}`).sort())
  for (const [name, example] of examples.calls) {
    assert.equal(name, `${example.plugin[0]!.toLowerCase()}${example.plugin.slice(1)}.${example.method}`, `${name}: file name`)
    assert.ok(example.description.length > 0, `${name}: description`)
    assert.ok((example.reply === undefined) !== (example.replies === undefined), `${name}: reply or replies`)
    assert.deepEqual(requestErrors(example, example.request), [], `${name}: request`)
    for (const reply of example.replies ?? [example.reply]) assert.deepEqual(replyErrors(example, reply), [], `${name}: reply`)
    for (const error of example.errors ?? []) {
      assert.ok(['unavailable', 'not-found', 'exists', 'invalid', 'failed'].includes(error.code), `${name}: ${error.code} is a port error code`)
    }
  }
  for (const type of READER_EVENTS) {
    const example = event(examples, `reader.${type}`)
    assert.equal(example.event, 'readerEvent')
    assert.equal((example.payload as { type: string }).type, type)
    assert.deepEqual(eventErrors(example, example.payload), [])
  }
})

test('plugin contract: the fake scanner answers like scanner.scan', async () => {
  const scan = call(examples, 'scanner.scan')
  const request = scan.request as { maxPages: number }
  const platform = createFakePlatform()

  platform.scanner.willReturn([{ width: 3721, height: 349 }, { width: 3625, height: 392 }])
  const pages = await platform.scanner.scan(request)
  assert.deepEqual(replyErrors(scan, pages), [])
  assert.equal(pages.cancelled, false)

  platform.scanner.willCancel()
  assert.deepEqual(replyErrors(scan, await platform.scanner.scan(request)), [])

  platform.scanner.willBeUnavailable()
  const unavailable = scan.errors!.find((error) => error.request === undefined)!
  await assert.rejects(platform.scanner.scan(request), (error: unknown) => error instanceof PlatformError && error.code === unavailable.code)
})

/** Every event of a fake job, checked against `reader.<type>.json`. */
async function fakeJob(outcomes: FakePageOutcome[], cancelAfter?: number): Promise<ReaderEvent[]> {
  const pages = call(examples, 'reader.read').request as { pages: string[] }
  const platform = createFakePlatform({ autoRun: false })
  platform.reader.willRead(outcomes)
  const events: ReaderEvent[] = []
  const paths = outcomes.map((_, index) => pages.pages[index % pages.pages.length]!)
  const job = platform.reader.read(paths, (e) => events.push(e))
  const fake = platform.reader.jobs[0]!
  if (cancelAfter === undefined) fake.flush()
  else {
    for (let i = 0; i < cancelAfter; i += 1) fake.step()
    await job.cancel()
  }
  for (const e of events) assert.deepEqual(eventErrors(event(examples, `reader.${e.type}`), e), [], `${e.type}: ${JSON.stringify(e)}`)
  return events
}

test('plugin contract: every event of the fake reader has the shape of its example', async () => {
  const done = await fakeJob([{ result: 'done' }, { result: 'no-music' }, { result: 'failed' }])
  assert.deepEqual(new Set(done.map((e) => e.type)), new Set(READER_EVENTS))
  const failedJob = await fakeJob([{ result: 'done' }, { result: 'job-failed', message: 'Python could not start' }])
  assert.deepEqual(failedJob.at(-1), { type: 'finished', pages: 2, status: 'failed', message: 'Python could not start' })
  const cancelled = await fakeJob([{ result: 'done' }, { result: 'done' }], 3)
  assert.deepEqual(cancelled.at(-1), { type: 'finished', pages: 2, status: 'cancelled' })
  // A page with the D7 extras (staves, timeEstimated) has the example's shape too.
  const payload = event(examples, 'reader.done').payload as { staves: ReaderStaff[] }
  const extras = await fakeJob([{ result: 'done', staves: payload.staves, timeEstimated: true }])
  assert.deepEqual(extras.find((e) => e.type === 'done'), { type: 'done', page: 0, pages: 1, musicxml: '<score-partwise version="4.0"/>', staves: payload.staves, timeEstimated: true })
})
