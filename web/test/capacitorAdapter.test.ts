import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createCapacitorPlatformWith } from '../src/platform/capacitor/platform.ts'
import { PlatformError } from '../src/platform/port.ts'
import type { Platform, ReaderEvent } from '../src/platform/port.ts'
import { DATA_ROOT, PluginRejection, mockPlugins } from './capacitorMocks.ts'
import type { MockPlugins } from './capacitorMocks.ts'
import { eventErrors } from './contract.ts'
import { call, event, loadExamples } from './contractFixtures.ts'

// The Capacitor adapter of the platform port (practice-app task 10.5) against mock plugins that
// behave like the real ones on Android (web/test/capacitorMocks.ts): the Filesystem plugin's
// delete-then-rename, DoesNotExist on missing paths, NoParentDirectory and
// DestinationDirectoryExists, mapped to the port's documented semantics (port.ts, the same rules
// fakePlatform.test.ts pins for the fake); the atomic write and a file rename through our own
// AtomicFiles plugin; the Scanner and Reader against the contract examples (fixtures/bridge/);
// and the device.

const examples = loadExamples()

function setUp(): { plugins: MockPlugins; platform: Platform } {
  const plugins = mockPlugins()
  return { plugins, platform: createCapacitorPlatformWith(plugins) }
}

async function rejectionCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    assert.ok(error instanceof PlatformError, `rejected with ${String(error)}`)
    return error.code
  }
  throw new Error('did not reject')
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

// ---- files ---------------------------------------------------------------------------------

test('capacitor files: text round trip, replacing a file, folders created on the way', async () => {
  const { platform: { files }, plugins } = setUp()
  await files.writeText('pieces/a/piece.json', '{"n":1}')
  assert.equal(await files.readText('pieces/a/piece.json'), '{"n":1}')
  await files.writeText('pieces/a/piece.json', 'één ♯ 𝄞')
  assert.equal(await files.readText('pieces/a/piece.json'), 'één ♯ 𝄞')
  assert.deepEqual(await files.list('pieces'), [{ name: 'a', kind: 'folder' }])
  assert.deepEqual(plugins.disk.files(), ['pieces/a/piece.json'])
})

test('capacitor files: a missing file, bad paths and a folder where a file is wanted', async () => {
  const { platform: { files } } = setUp()
  assert.equal(await rejectionCode(files.readText('nope.json')), 'not-found')
  assert.equal(await rejectionCode(files.readText('../outside.json')), 'invalid')
  assert.equal(await rejectionCode(files.writeText('a/../b', 'x')), 'invalid')
  assert.equal(await rejectionCode(files.writeText('', 'x')), 'invalid')
  await files.writeText('pieces/a/piece.json', '1')
  assert.equal(await rejectionCode(files.writeText('pieces/a', 'x')), 'exists')
  assert.equal(await rejectionCode(files.readText('pieces/a')), 'not-found')
  await files.writeText('./x//y.txt', 'same')
  assert.equal(await files.readText('x/y.txt'), 'same')
})

test('capacitor files: list maps DoesNotExist to empty, sorts by name, shows hidden entries', async () => {
  const { platform: { files }, plugins } = setUp()
  assert.deepEqual(await files.list('pieces'), [], 'a missing folder (DoesNotExist) is empty')
  plugins.disk.seed('pieces/b/piece.json', '{}')
  plugins.disk.seed('pieces/.tmp-c/piece.json', '{}')
  plugins.disk.seed('pieces/a.json', '{}')
  assert.deepEqual(await files.list('pieces'), [
    { name: '.tmp-c', kind: 'folder' },
    { name: 'a.json', kind: 'file' },
    { name: 'b', kind: 'folder' },
  ])
  assert.deepEqual(await files.list('pieces/a.json'), [], 'a file is not a folder')
  assert.deepEqual((await files.list('')).map((e) => e.name), ['pieces'])
})

test('capacitor files: remove deletes a file or a whole folder, and a missing path is a no-op', async () => {
  const { platform: { files }, plugins } = setUp()
  await files.remove('nothing/here.json')
  plugins.disk.seed('pieces/a/piece.json', '{}')
  plugins.disk.seed('pieces/a/pages/1/source.jpg', 'jpg')
  plugins.disk.seed('settings.json', '{}')
  await files.remove('settings.json')
  await files.remove('pieces/a')
  assert.deepEqual(plugins.disk.files(), [])
  assert.ok(plugins.filesystem.calls.includes('deleteFile settings.json'))
  assert.ok(plugins.filesystem.calls.includes('rmdir pieces/a'), 'a folder with files inside goes through rmdir (recursive), not deleteFile')
  assert.equal(await rejectionCode(files.remove('../x')), 'invalid')
})

test('capacitor files: a file renamed over a file is replaced in one step, never by the plugin\'s delete-then-rename', async () => {
  const { platform: { files }, plugins } = setUp()
  // The real plugin deletes the target first: cut off between the two, the target is gone.
  plugins.disk.seed('a/target.json', 'old')
  plugins.disk.seed('a/source.json', 'new')
  plugins.filesystem.faultBetweenDeleteAndRename = () => {
    throw new PluginRejection('OS-PLUG-FILE-0013', 'crash')
  }
  await assert.rejects(plugins.filesystem.rename({ from: 'a/source.json', to: 'a/target.json', directory: 'DATA' as never, toDirectory: 'DATA' as never }))
  assert.equal(plugins.disk.text('a/target.json'), undefined, 'what the adapter must avoid')

  plugins.disk.seed('p/piece.json', 'old')
  plugins.disk.seed('p/piece.json.tmp-0mwm3nbwg-k3j5h2q9', 'new')
  const before = plugins.filesystem.calls.length
  await files.rename('p/piece.json.tmp-0mwm3nbwg-k3j5h2q9', 'p/piece.json')
  assert.equal(plugins.disk.text('p/piece.json'), 'new')
  assert.ok(!plugins.filesystem.calls.slice(before).some((c) => c.startsWith('rename')), 'Filesystem.rename is not used for a file')
  assert.deepEqual(plugins.atomicFiles.calls.at(-1), 'moveFile p/piece.json.tmp-0mwm3nbwg-k3j5h2q9 -> p/piece.json')

  await files.rename('p/piece.json', 'q/r/moved.json')
  assert.equal(plugins.disk.text('q/r/moved.json'), 'new', 'the folders above the target are created')
  assert.equal(await rejectionCode(files.rename('p/nothing.json', 'x.json')), 'not-found')
  plugins.disk.seed('folder/inside.txt', 'x')
  assert.equal(await rejectionCode(files.rename('q/r/moved.json', 'folder')), 'exists', 'a file onto a folder')
})

test('capacitor files: a folder rename creates the folders above (NoParentDirectory) and refuses an existing target (DestinationDirectoryExists)', async () => {
  const { platform: { files }, plugins } = setUp()
  plugins.disk.seed('pieces/.tmp-p1/piece.json', '{"id":"p1"}')
  plugins.disk.seed('pieces/.tmp-p1/pages/1/source.jpg', 'jpg')
  await files.rename('pieces/.tmp-p1', 'library/2026/p1')
  assert.deepEqual(plugins.disk.files(), ['library/2026/p1/pages/1/source.jpg', 'library/2026/p1/piece.json'])
  assert.ok(plugins.filesystem.calls.includes('mkdir library/2026'), 'created after NoParentDirectory')

  plugins.disk.seed('pieces/.tmp-p2/piece.json', '{"id":"p2"}')
  assert.equal(await rejectionCode(files.rename('pieces/.tmp-p2', 'library/2026/p1')), 'exists')
  assert.equal(plugins.disk.text('library/2026/p1/piece.json'), '{"id":"p1"}', 'the existing folder is not touched')
  plugins.disk.seed('a-file.json', '{}')
  assert.equal(await rejectionCode(files.rename('pieces/.tmp-p2', 'a-file.json')), 'exists', 'a folder onto a file')
  assert.equal(await rejectionCode(files.rename('pieces/.tmp-p2', 'pieces/.tmp-p2/inner')), 'invalid')
  assert.equal(await rejectionCode(files.rename('pieces/.tmp-none', 'pieces/x')), 'not-found')
  await files.rename('pieces/.tmp-p2', 'pieces/.tmp-p2')
  assert.equal(plugins.disk.text('pieces/.tmp-p2/piece.json'), '{"id":"p2"}')
})

test('capacitor files: copy creates the folders above, replaces a file, and refuses a missing source or a folder target', async () => {
  const { platform: { files }, plugins } = setUp()
  plugins.disk.seed('scans/s1/page-1.jpg', 'JPEG-1')
  await files.copy('scans/s1/page-1.jpg', 'pieces/p1/pages/1/source.jpg')
  assert.equal(plugins.disk.text('pieces/p1/pages/1/source.jpg'), 'JPEG-1')
  plugins.disk.seed('scans/s1/page-2.jpg', 'JPEG-2')
  await files.copy('scans/s1/page-2.jpg', 'pieces/p1/pages/1/source.jpg')
  assert.equal(plugins.disk.text('pieces/p1/pages/1/source.jpg'), 'JPEG-2')
  assert.equal(await rejectionCode(files.copy('scans/s1/page-9.jpg', 'x.jpg')), 'not-found')
  assert.equal(await rejectionCode(files.copy('scans/s1', 'x')), 'not-found', 'a folder is not a file')
  assert.equal(await rejectionCode(files.copy('scans/s1/page-1.jpg', 'pieces/p1')), 'exists')
})

test('capacitor files: writeTextAtomic goes through AtomicFiles with the temp naming of tempSuffix', async () => {
  const { platform: { files }, plugins } = setUp()
  plugins.disk.seed('p/practice.json', 'old')
  await files.writeTextAtomic('p/practice.json', 'new')
  assert.equal(plugins.disk.text('p/practice.json'), 'new')
  assert.deepEqual(plugins.disk.files(), ['p/practice.json'])
  assert.match(plugins.atomicFiles.calls.at(-1)!, /^writeTextAtomic p\/practice\.json [0-9a-z]{9}-[0-9a-z]{8}$/)
  assert.ok(!plugins.filesystem.calls.some((c) => c.startsWith('writeFile') || c.startsWith('rename')))

  // Cut off before the replace: the old content stays, with the temp for the start-up sweep.
  plugins.atomicFiles.faultBeforeReplace = () => {
    throw new PluginRejection('failed', 'crash')
  }
  assert.equal(await rejectionCode(files.writeTextAtomic('p/practice.json', 'newer')), 'failed')
  assert.equal(plugins.disk.text('p/practice.json'), 'new')
  const temps = (await files.list('p')).filter((e) => e.name.startsWith('practice.json.tmp-'))
  assert.equal(temps.length, 1)
  plugins.atomicFiles.faultBeforeReplace = undefined

  await files.writeTextAtomic('fresh/deep/settings.json', '{}')
  assert.equal(plugins.disk.text('fresh/deep/settings.json'), '{}')
  assert.equal(await rejectionCode(files.writeTextAtomic('fresh', 'x')), 'exists')
  assert.equal(await rejectionCode(files.writeTextAtomic('../x', 'x')), 'invalid')
})

test('capacitor files: imageUrl is the WebView URL of the file', async () => {
  const { platform: { files }, plugins } = setUp()
  plugins.disk.seed('pieces/p1/pages/1/source.jpg', 'jpg')
  assert.equal(await files.imageUrl('pieces/p1/pages/1/source.jpg'), `https://localhost/_capacitor_file_${DATA_ROOT}/pieces/p1/pages/1/source.jpg`)
  assert.equal(await rejectionCode(files.imageUrl('pieces/p1/pages/2/source.jpg')), 'not-found')
  assert.equal(await rejectionCode(files.imageUrl('pieces/p1/pages')), 'not-found')
})

test('capacitor files: a scanned page path is accepted as it is, absolute too, where a file is read and by remove', async () => {
  const { platform: { files }, plugins } = setUp()
  plugins.disk.seed('scans/s1/page-1.jpg', 'JPEG-1')
  plugins.disk.seed('scans/s1/page-2.jpg', 'JPEG-2')
  const absolute = `${DATA_ROOT}/scans/s1/page-1.jpg`
  assert.equal(await files.readText(absolute), 'JPEG-1')
  assert.equal(await files.readText(`file://${absolute}`), 'JPEG-1')
  assert.equal(await files.readText(`${DATA_ROOT}//scans/s1/page-1.jpg`), 'JPEG-1', 'a doubled slash after the folder')
  await files.copy(absolute, 'pieces/p1/pages/1/source.jpg')
  assert.equal(plugins.disk.text('pieces/p1/pages/1/source.jpg'), 'JPEG-1')
  assert.equal(await files.imageUrl(absolute), `https://localhost/_capacitor_file_${absolute}`)
  await files.remove(absolute)
  assert.equal(plugins.disk.text('scans/s1/page-1.jpg'), undefined)
  await files.remove(`file://${DATA_ROOT}/scans/s1`)
  assert.deepEqual(await files.list('scans'), [])
  await files.remove(`${DATA_ROOT}/scans/s1/page-9.jpg`)

  // Outside the app's files, or escaping them: refused.
  for (const outside of ['/data/user/0/other.app/files/x.jpg', '/sdcard/DCIM/x.jpg', `${DATA_ROOT}/../other/x.jpg`, `${DATA_ROOT}x/y.jpg`, DATA_ROOT]) {
    assert.equal(await rejectionCode(files.remove(outside)), 'invalid', outside)
    assert.equal(await rejectionCode(files.readText(outside)), 'invalid', outside)
  }
  // Never where a file is written.
  assert.equal(await rejectionCode(files.writeText(`${DATA_ROOT}/x.json`, '{}')), 'invalid')
  assert.equal(await rejectionCode(files.writeTextAtomic(`${DATA_ROOT}/x.json`, '{}')), 'invalid')
  assert.equal(await rejectionCode(files.copy('pieces/p1/pages/1/source.jpg', `${DATA_ROOT}/y.jpg`)), 'invalid')
})

// ---- scanner -------------------------------------------------------------------------------

test('capacitor scanner: the example replies become ScanResults, and the error codes PlatformErrors', async () => {
  const { platform: { scanner }, plugins } = setUp()
  const scan = call(examples, 'scanner.scan')
  const [pages, cancelled] = scan.replies as [Awaited<ReturnType<MockPlugins['scanner']['scan']>>, Awaited<ReturnType<MockPlugins['scanner']['scan']>>]
  plugins.scanner.replies.push(pages, cancelled)
  assert.deepEqual(await scanner.scan({ maxPages: 10 }), pages)
  assert.deepEqual(await scanner.scan({ maxPages: 3 }), { cancelled: true, pages: [] })
  assert.deepEqual(plugins.scanner.calls, [{ maxPages: 10 }, { maxPages: 3 }])
  for (const error of scan.errors!) {
    plugins.scanner.replies.push(new PluginRejection(error.code, error.description))
    assert.equal(await rejectionCode(scanner.scan({ maxPages: 10 })), error.code)
  }
  plugins.scanner.replies.push(new PluginRejection('UNIMPLEMENTED', 'not implemented on web'))
  assert.equal(await rejectionCode(scanner.scan({ maxPages: 10 })), 'failed')
})

// ---- reader --------------------------------------------------------------------------------

function collect(platform: Platform, pages: string[]) {
  const events: ReaderEvent[] = []
  const job = platform.reader.read(pages, (e) => events.push(e))
  return { events, job }
}

/** The example payload of `reader.<name>.json`, for job [jobId]. */
function wire(name: string, jobId: string, change: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...(event(examples, `reader.${name}`).payload as Record<string, unknown>), ...change, jobId }
}

test('capacitor reader: listens before it starts, passes on its own job\'s events without jobId, and stops after finished', async () => {
  const { platform, plugins } = setUp()
  const pages = (call(examples, 'reader.read').request as { pages: string[] }).pages
  const { events } = collect(platform, [pages[0]!, `${DATA_ROOT}/${pages[1]!}`])
  assert.deepEqual(events, [])
  await flush()
  assert.deepEqual(plugins.reader.listeningAtRead, [true], 'the listener is in place before read() is called')
  const read = plugins.reader.calls[0]!
  assert.deepEqual(read.options.pages, pages, 'absolute scan paths are sent as data-relative paths')
  const jobId = plugins.reader.jobId

  plugins.reader.emit(wire('progress', jobId, { page: 0, stage: 'queued', fraction: 0 }))
  plugins.reader.emit(wire('progress', 'another-job'))
  plugins.reader.emit(wire('done', jobId))
  plugins.reader.emit({ jobId, type: 'progress', page: 1, pages: 2, stage: 'dancing', fraction: 0.5 })
  plugins.reader.emit(wire('no-music', jobId))
  plugins.reader.emit(wire('finished', jobId, { status: 'done', message: undefined }))
  plugins.reader.emit(wire('failed', jobId))
  await flush()

  assert.deepEqual(events.map((e) => e.type), ['progress', 'done', 'no-music', 'finished'])
  for (const e of events) {
    assert.ok(!('jobId' in e), 'jobId is stripped')
    assert.deepEqual(eventErrors(event(examples, `reader.${e.type}`), e), [])
  }
  assert.deepEqual(events.at(-1), { type: 'finished', pages: 2, status: 'done' })
  assert.equal(plugins.reader.listeners.count('readerEvent'), 0, 'the listener is removed after finished')
})

test('capacitor reader: a page\'s staves and time flag (design D7) reach the port; staves that are not well formed are left out, not the page', async () => {
  const { platform, plugins } = setUp()
  const { events } = collect(platform, ['scans/s1/page-1.jpg'])
  await flush()
  const jobId = plugins.reader.jobId
  const example = wire('done', jobId)
  const staves = example.staves as Array<{ box: Record<string, number> }>
  plugins.reader.emit(example)
  plugins.reader.emit(wire('done', jobId, { staves: [staves[0], { ...staves[1], box: { ...staves[1]!.box, height: 1.5 } }], timeEstimated: 'yes' }))
  plugins.reader.emit(wire('done', jobId, { staves: [{ ...staves[0], firstBar: 1.5 }], timeEstimated: true }))
  plugins.reader.emit(wire('done', jobId, { staves: undefined, timeEstimated: undefined }))
  await flush()
  const done = events.filter((e) => e.type === 'done')
  assert.equal(done.length, 4, 'every page is passed on')
  const { jobId: _, ...expected } = example
  assert.deepEqual(done[0], expected)
  assert.deepEqual(done[1], { type: 'done', page: 0, pages: 2, musicxml: example.musicxml })
  assert.deepEqual(done[2], { type: 'done', page: 0, pages: 2, musicxml: example.musicxml, timeEstimated: true })
  assert.deepEqual(done[3], { type: 'done', page: 0, pages: 2, musicxml: example.musicxml })
  for (const e of done) assert.deepEqual(eventErrors(event(examples, 'reader.done'), e), [])
})

test('capacitor reader: a job the plugin refuses gives exactly one finished failed', async () => {
  for (const error of call(examples, 'reader.read').errors!) {
    const { platform, plugins } = setUp()
    plugins.reader.rejectNextRead = new PluginRejection(error.code, error.description)
    const { events } = collect(platform, ['scans/s1/page-1.jpg'])
    await flush()
    assert.equal(events.length, 1, error.description)
    assert.equal(events[0]!.type, 'finished')
    assert.deepEqual({ ...events[0]!, message: undefined }, { type: 'finished', pages: 1, status: 'failed', message: undefined })
    assert.deepEqual(eventErrors(event(examples, 'reader.finished'), events[0]), [])
  }
  const { platform } = setUp()
  const { events } = collect(platform, ['/elsewhere/page-1.jpg'])
  await flush()
  assert.deepEqual(events.map((e) => e.type === 'finished' && e.status), ['failed'], 'a path outside the app fails the job')
})

test('capacitor reader: cancel is sent after the start, even when asked for before it, and not after finished', async () => {
  const { platform, plugins } = setUp()
  const { events, job } = collect(platform, ['scans/s1/page-1.jpg'])
  const cancelled = job.cancel()
  await cancelled
  assert.deepEqual(plugins.reader.calls.map((c) => c.method), ['read', 'cancel'])
  assert.equal(plugins.reader.calls[1]!.options.jobId, plugins.reader.jobId)
  plugins.reader.emit(wire('finished', plugins.reader.jobId, { pages: 1, status: 'cancelled', message: undefined }))
  assert.deepEqual(events, [{ type: 'finished', pages: 1, status: 'cancelled' }])
  await job.cancel()
  assert.equal(plugins.reader.calls.length, 2, 'nothing to cancel after finished')
})

// ---- device --------------------------------------------------------------------------------

test('capacitor device: keep awake, pause and resume, language', async () => {
  const { platform: { device }, plugins } = setUp()
  await device.setKeepAwake(true)
  await device.setKeepAwake(false)
  assert.deepEqual(plugins.keepAwake.log, ['keepAwake', 'allowSleep'])
  const log: string[] = []
  const stopPause = device.onPause(() => log.push('pause'))
  device.onResume(() => log.push('resume'))
  plugins.app.fire('pause')
  plugins.app.fire('resume')
  stopPause()
  await flush()
  plugins.app.fire('pause')
  assert.deepEqual(log, ['pause', 'resume'])
  assert.equal(await device.language(), 'nl-BE')
})

test('capacitor device: the newest back handler answers; false or no handler leaves the app', async () => {
  const { platform: { device }, plugins } = setUp()
  let screens = 2
  const removeFirst = device.onBackButton(() => false)
  const removeSecond = device.onBackButton(() => {
    if (screens === 1) return false
    screens -= 1
    return true
  })
  plugins.app.fire('backButton')
  assert.equal(screens, 1)
  assert.equal(plugins.app.minimized, 0, 'handled: the app stays')
  plugins.app.fire('backButton')
  assert.equal(plugins.app.minimized, 1, 'not handled: the app is left')
  removeSecond()
  removeFirst()
  plugins.app.fire('backButton')
  assert.equal(plugins.app.minimized, 2, 'no handler: the app is left too (the App plugin alone would do nothing)')
  assert.equal(plugins.app.listeners.count('backButton'), 1, 'one native listener for the life of the app')
  device.onBackButton(() => true)
  plugins.app.fire('backButton')
  assert.equal(plugins.app.minimized, 2)
})
