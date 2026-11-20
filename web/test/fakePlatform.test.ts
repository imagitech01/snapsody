import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PlatformError } from '../src/platform/port.ts'
import type { Platform, ReaderEvent } from '../src/platform/port.ts'
import { createFakePlatform } from '../src/platform/fake/index.ts'

// The fake platform (practice-app task 2.4, design D2): what app/ tests run against. These tests
// pin the port's rules (atomic write, copy, rename, list, remove) and the scripted scanner, reader
// and device. The browser-dev adapter shares the files' behaviour (platform/keyValueFiles.ts).

/** The code of the PlatformError a promise rejects with. */
async function rejectionCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    assert.ok(error instanceof PlatformError, `rejected with ${String(error)}`)
    return error.code
  }
  throw new Error('did not reject')
}

const BINARY = Uint8Array.of(0xff, 0x00, 0xd8, 0x80, 0x00, 0x0a)

test('fake platform: is a whole Platform', () => {
  const platform: Platform = createFakePlatform()
  assert.deepEqual(Object.keys(platform).sort(), ['device', 'files', 'reader', 'scanner'])
})

// ---- files -------------------------------------------------------------------------------

test('files: text round trip, replacing a file, folders created on the way', async () => {
  const { files } = createFakePlatform()
  await files.writeText('pieces/a/piece.json', '{"n":1}')
  assert.equal(await files.readText('pieces/a/piece.json'), '{"n":1}')
  await files.writeText('pieces/a/piece.json', 'één ♯ 𝄞')
  assert.equal(await files.readText('pieces/a/piece.json'), 'één ♯ 𝄞', 'UTF-8 survives')
  assert.deepEqual(await files.list('pieces'), [{ name: 'a', kind: 'folder' }])
})

test('files: a missing file, bad paths and a folder where a file is wanted', async () => {
  const { files } = createFakePlatform()
  assert.equal(await rejectionCode(files.readText('nope.json')), 'not-found')
  assert.equal(await rejectionCode(files.readText('../outside.json')), 'invalid')
  assert.equal(await rejectionCode(files.writeText('a/../b', 'x')), 'invalid')
  assert.equal(await rejectionCode(files.writeText('', 'x')), 'invalid')
  await files.writeText('pieces/a/piece.json', '1')
  assert.equal(await rejectionCode(files.writeText('pieces/a', 'x')), 'exists')
  assert.equal(await rejectionCode(files.readText('pieces/a')), 'not-found')
  // "./a//b" and "a/b" are the same file
  await files.writeText('./x//y.txt', 'same')
  assert.equal(await files.readText('x/y.txt'), 'same')
})

test('files: atomic write replaces the content and leaves no temp file', async () => {
  const { files } = createFakePlatform()
  await files.writeText('p/current.musicxml', 'old')
  await files.writeTextAtomic('p/current.musicxml', 'new')
  assert.equal(await files.readText('p/current.musicxml'), 'new')
  assert.deepEqual(files.paths(), ['p/current.musicxml'])
  await files.writeTextAtomic('p/fresh.json', 'first')
  assert.equal(await files.readText('p/fresh.json'), 'first')
  assert.deepEqual(files.paths(), ['p/current.musicxml', 'p/fresh.json'])
})

test('files: an atomic write that fails at the rename leaves the old content, and no half file', async () => {
  const { files } = createFakePlatform()
  await files.writeText('p/current.musicxml', 'old')
  files.fault = (operation) => {
    if (operation === 'rename') throw new Error('disk full')
  }
  await assert.rejects(files.writeTextAtomic('p/current.musicxml', 'new'), /disk full/)
  files.fault = undefined
  assert.equal(await files.readText('p/current.musicxml'), 'old')
  assert.deepEqual(files.paths(), ['p/current.musicxml'], 'the temp file is removed again')
  // a file that did not exist is not there after the failure either
  files.fault = (operation) => {
    if (operation === 'rename') throw new Error('disk full')
  }
  await assert.rejects(files.writeTextAtomic('p/new.json', 'x'), /disk full/)
  files.fault = undefined
  assert.equal(await rejectionCode(files.readText('p/new.json')), 'not-found')
})

test('files: a crash between the temp file and the rename leaves the old content and a stray temp file', async () => {
  const { files } = createFakePlatform()
  await files.writeText('p/current.musicxml', 'old')
  // a crash: the rename fails and nothing gets to clean up
  files.fault = (operation) => {
    if (operation === 'rename' || operation === 'remove') throw new Error('process died')
  }
  await assert.rejects(files.writeTextAtomic('p/current.musicxml', 'new'), /process died/)
  files.fault = undefined
  assert.equal(await files.readText('p/current.musicxml'), 'old')
  const names = (await files.list('p')).map((entry) => entry.name)
  assert.equal(names.length, 2)
  const stray = names.find((name) => name !== 'current.musicxml')!
  // the temp name the start-up recovery sorts by (Files.writeTextAtomic): the time, then random characters
  const match = /^current\.musicxml\.tmp-([0-9a-z]{9})-[0-9a-z]{8}$/.exec(stray)
  assert.ok(match, `names: ${names.join(', ')}`)
  assert.ok(Math.abs(Number.parseInt(match[1]!, 36) - Date.now()) < 60_000, `the suffix starts with the time of the write: ${stray}`)
})

test('files: copy is byte for byte, keeps the source and creates folders', async () => {
  const { files } = createFakePlatform()
  files.seed('scans/1/page-1.jpg', BINARY)
  await files.copy('scans/1/page-1.jpg', 'pieces/a/pages/1/source.jpg')
  assert.deepEqual([...files.bytes('pieces/a/pages/1/source.jpg')!], [...BINARY])
  assert.deepEqual([...files.bytes('scans/1/page-1.jpg')!], [...BINARY])
  // a copy is a copy: changing the target does not change the source
  await files.writeText('pieces/a/pages/1/source.jpg', 'text now')
  assert.deepEqual([...files.bytes('scans/1/page-1.jpg')!], [...BINARY])
  assert.equal(await rejectionCode(files.copy('scans/none.jpg', 'x.jpg')), 'not-found')
})

test('files: rename moves a file over an existing one', async () => {
  const { files } = createFakePlatform()
  await files.writeText('a.txt', 'A')
  await files.writeText('b.txt', 'B')
  await files.rename('a.txt', 'b.txt')
  assert.equal(await files.readText('b.txt'), 'A')
  assert.equal(await rejectionCode(files.readText('a.txt')), 'not-found')
  await files.rename('b.txt', 'deep/er/c.txt')
  assert.equal(await files.readText('deep/er/c.txt'), 'A')
  assert.equal(await rejectionCode(files.rename('missing.txt', 'x.txt')), 'not-found')
})

test('files: rename moves a whole folder, as a new piece is built in a hidden folder and renamed into place', async () => {
  const { files } = createFakePlatform()
  await files.writeText('pieces/.tmp-1/piece.json', '{}')
  await files.writeText('pieces/.tmp-1/pages/1/recognised.musicxml', '<x/>')
  files.seed('pieces/.tmp-1/pages/1/source.jpg', BINARY)
  await files.rename('pieces/.tmp-1', 'pieces/1')
  assert.deepEqual(files.paths(), ['pieces/1/pages/1/recognised.musicxml', 'pieces/1/pages/1/source.jpg', 'pieces/1/piece.json'])
  assert.deepEqual([...files.bytes('pieces/1/pages/1/source.jpg')!], [...BINARY])
  // not onto a folder that exists, and not into itself
  await files.writeText('pieces/.tmp-2/piece.json', '{}')
  assert.equal(await rejectionCode(files.rename('pieces/.tmp-2', 'pieces/1')), 'exists')
  assert.equal(await files.readText('pieces/1/piece.json'), '{}')
  assert.equal(await rejectionCode(files.rename('pieces/1', 'pieces/1/inside')), 'invalid')
  assert.equal(await rejectionCode(files.rename('pieces/none', 'pieces/x')), 'not-found')
})

test('files: list gives the entries of one folder, sorted, with kinds, hidden ones too', async () => {
  const { files } = createFakePlatform()
  await files.writeText('pieces/b/piece.json', '{}')
  await files.writeText('pieces/b/pages/1/x.txt', 'x')
  await files.writeText('pieces/a/piece.json', '{}')
  await files.writeText('pieces/.tmp-9/piece.json', '{}')
  await files.writeText('pieces/readme.txt', 'r')
  assert.deepEqual(await files.list('pieces'), [
    { name: '.tmp-9', kind: 'folder' },
    { name: 'a', kind: 'folder' },
    { name: 'b', kind: 'folder' },
    { name: 'readme.txt', kind: 'file' },
  ])
  assert.deepEqual(await files.list('pieces/b'), [
    { name: 'pages', kind: 'folder' },
    { name: 'piece.json', kind: 'file' },
  ])
  assert.deepEqual(await files.list('pieces/none'), [], 'a folder that does not exist is empty')
  assert.deepEqual(await files.list(''), [{ name: 'pieces', kind: 'folder' }], 'the root')
  assert.deepEqual(await files.list('pie'), [], 'a name prefix is not a folder')
})

test('files: remove deletes a file, or a folder with everything in it, and is quiet about nothing', async () => {
  const { files } = createFakePlatform()
  await files.writeText('pieces/a/piece.json', '{}')
  await files.writeText('pieces/a/pages/1/x.txt', 'x')
  await files.writeText('pieces/ab/piece.json', '{}')
  await files.remove('pieces/a/piece.json')
  assert.deepEqual(files.paths(), ['pieces/a/pages/1/x.txt', 'pieces/ab/piece.json'])
  await files.remove('pieces/a')
  assert.deepEqual(files.paths(), ['pieces/ab/piece.json'], 'a sibling with the same name start stays')
  await files.remove('pieces/a')
  await files.remove('nothing/at/all')
})

test('files: an image has a URL when it exists', async () => {
  const { files } = createFakePlatform()
  files.seed('pieces/a/pages/1/source.jpg', BINARY)
  assert.match(await files.imageUrl('pieces/a/pages/1/source.jpg'), /^fake:\/\/image\/pieces\/a\/pages\/1\/source\.jpg$/)
  assert.equal(await rejectionCode(files.imageUrl('pieces/a/pages/2/source.jpg')), 'not-found')
})

// ---- scanner -----------------------------------------------------------------------------

test('scanner: scripted pages come back as files that copy and show as they are', async () => {
  const { scanner, files } = createFakePlatform()
  scanner.willReturn([{ width: 900, height: 1200 }, { bytes: BINARY }])
  const result = await scanner.scan({ maxPages: 10 })
  assert.deepEqual(scanner.calls, [{ maxPages: 10 }])
  assert.equal(result.cancelled, false)
  assert.equal(result.pages.length, 2)
  assert.deepEqual(result.pages.map((p) => [p.width, p.height]), [[900, 1200], [1000, 1400]])
  const [first, second] = result.pages
  await files.copy(first!.path, 'pieces/a/pages/1/source.jpg')
  await files.copy(second!.path, 'pieces/a/pages/2/source.jpg')
  assert.deepEqual([...files.bytes('pieces/a/pages/2/source.jpg')!], [...BINARY])
  assert.ok(await files.imageUrl(first!.path))
  // the next scan is a new folder
  scanner.willReturn(1)
  const again = await scanner.scan({ maxPages: 10 })
  assert.notEqual(again.pages[0]!.path, first!.path)
})

test('scanner: cancelled is a result, unavailable is an error with a code', async () => {
  const { scanner } = createFakePlatform()
  scanner.willCancel()
  assert.deepEqual(await scanner.scan({ maxPages: 10 }), { cancelled: true, pages: [] })
  scanner.willReturn([])
  assert.deepEqual(await scanner.scan({ maxPages: 10 }), { cancelled: true, pages: [] }, 'leaving with no pages is cancelling')
  scanner.willBeUnavailable()
  assert.equal(await rejectionCode(scanner.scan({ maxPages: 10 })), 'unavailable')
})

test('scanner: a script that gives more pages than maxPages, or none, is a test mistake and says so', async () => {
  const { scanner } = createFakePlatform()
  scanner.willReturn(3)
  await assert.rejects(scanner.scan({ maxPages: 2 }), /maxPages is 2/)
  await assert.rejects(scanner.scan({ maxPages: 2 }), /no outcome scripted/)
})

// ---- reader ------------------------------------------------------------------------------

/** Starts a job and collects its events; resolves when `finished` arrives. */
function collect(platform: ReturnType<typeof createFakePlatform>, pages: string[]) {
  const events: ReaderEvent[] = []
  const finished = new Promise<void>((resolve) => {
    platform.reader.read(pages, (event) => {
      events.push(event)
      if (event.type === 'finished') resolve()
    })
  })
  return { events, finished }
}

const results = (events: ReaderEvent[]) => events.filter((e) => e.type !== 'progress').map((e) => (e.type === 'finished' ? `finished:${e.status}` : `${e.type}:${e.page}`))

test('reader: per-page events in order, page 2 without music, and the job still ends done', async () => {
  const platform = createFakePlatform({ musicxml: '<default/>' })
  platform.reader.willRead([{ result: 'done', musicxml: '<page1/>' }, { result: 'no-music' }, { result: 'done' }])
  const { events, finished } = collect(platform, ['scans/1/page-1.jpg', 'scans/1/page-2.jpg', 'scans/1/page-3.jpg'])
  assert.deepEqual(events, [], 'nothing is delivered before read() has returned')
  await finished
  assert.deepEqual(results(events), ['done:0', 'no-music:1', 'done:2', 'finished:done'])
  const done = events.filter((e) => e.type === 'done')
  assert.deepEqual(done.map((e) => e.musicxml), ['<page1/>', '<default/>'])
  assert.ok(events.every((e) => e.pages === 3))
  assert.deepEqual(platform.reader.jobs[0]!.pages, ['scans/1/page-1.jpg', 'scans/1/page-2.jpg', 'scans/1/page-3.jpg'])
})

test('reader: progress stays inside its page and never goes backwards, the first event is progress and the last is finished', async () => {
  const platform = createFakePlatform()
  platform.reader.willRead([{ result: 'done' }, { result: 'no-music' }])
  const { events, finished } = collect(platform, ['a', 'b'])
  await finished
  let lastPage = -1
  let lastFraction = 0
  for (const event of events) {
    if (event.type !== 'progress') continue
    assert.ok(event.fraction >= 0 && event.fraction <= 1)
    if (event.page === lastPage) assert.ok(event.fraction >= lastFraction, 'progress within a page moves forward')
    else assert.ok(event.page > lastPage, 'pages are read in order')
    lastPage = event.page
    lastFraction = event.fraction
  }
  assert.equal(events[0]!.type, 'progress')
  assert.equal(events.at(-1)!.type, 'finished')
  const finishedIndex = events.findIndex((e) => e.type === 'finished')
  assert.equal(finishedIndex, events.length - 1, 'nothing follows finished')
})

test('reader: a page that failed does not stop the job; a job that breaks ends failed', async () => {
  const platform = createFakePlatform()
  platform.reader.willRead([{ result: 'failed', message: 'out of memory' }, { result: 'done' }])
  const first = collect(platform, ['a', 'b'])
  await first.finished
  assert.deepEqual(results(first.events), ['failed:0', 'done:1', 'finished:done'])
  assert.equal(first.events.find((e) => e.type === 'failed')!.message, 'out of memory')

  platform.reader.willRead([{ result: 'done' }, { result: 'job-failed', message: 'the service was killed' }, { result: 'done' }])
  const second = collect(platform, ['a', 'b', 'c'])
  await second.finished
  assert.deepEqual(results(second.events), ['done:0', 'finished:failed'])
  const end = second.events.at(-1)!
  assert.equal(end.type === 'finished' && end.message, 'the service was killed')

  const empty = collect(platform, [])
  await empty.finished
  assert.deepEqual(results(empty.events), ['finished:failed'], 'an empty job cannot start')
})

test('reader: stepping one event at a time, and cancel while page 2 of 3 is being read', async () => {
  const platform = createFakePlatform({ autoRun: false })
  const events: ReaderEvent[] = []
  const job = platform.reader.read(['a', 'b', 'c'], (event) => events.push(event))
  await Promise.resolve()
  assert.deepEqual(events, [], 'with autoRun off nothing is delivered until a step')
  // queued, prepare, segment, read, write, done:0 ...
  for (let i = 0; i < 6; i += 1) assert.ok(job.step())
  assert.deepEqual(events.at(-1), { type: 'done', page: 0, pages: 3, musicxml: '<score-partwise version="4.0"/>' })
  // page 2 starts
  assert.ok(job.step())
  assert.deepEqual(events.at(-1), { type: 'progress', page: 1, pages: 3, stage: 'prepare', fraction: 0.1 })
  const before = events.length
  await job.cancel()
  assert.equal(events.length, before + 1)
  assert.deepEqual(events.at(-1), { type: 'finished', pages: 3, status: 'cancelled' })
  assert.equal(job.step(), false, 'the rest of the pages are skipped')
  job.flush()
  await job.cancel()
  assert.equal(events.length, before + 1, 'nothing after finished, and cancelling twice does nothing')
  assert.equal(platform.reader.jobs.length, 1)
})

test('reader: cancel before the first event, with autoRun on, ends with finished cancelled and no page', async () => {
  const platform = createFakePlatform()
  const events: ReaderEvent[] = []
  const job = platform.reader.read(['a'], (event) => events.push(event))
  await job.cancel()
  await Promise.resolve()
  assert.deepEqual(events, [{ type: 'finished', pages: 1, status: 'cancelled' }])
})

// ---- device ------------------------------------------------------------------------------

test('device: keep awake, pause and resume, back button', async () => {
  const { device } = createFakePlatform()

  await device.setKeepAwake(true)
  await device.setKeepAwake(false)
  assert.deepEqual(device.keepAwakeLog, [true, false])
  assert.equal(device.keepAwake, false)

  const seen: string[] = []
  const offPause = device.onPause(() => seen.push('pause'))
  device.onResume(() => seen.push('resume'))
  device.pause()
  device.resume()
  offPause()
  device.pause()
  assert.deepEqual(seen, ['pause', 'resume'])

  assert.equal(device.pressBack(), false, 'with no handler the platform leaves the app')
  const offOuter = device.onBackButton(() => {
    seen.push('outer')
    return true
  })
  device.onBackButton(() => {
    seen.push('inner')
    return false
  })
  assert.equal(device.pressBack(), false, 'the newest handler answers; false lets the platform leave')
  assert.equal(seen.at(-1), 'inner')
  offOuter()
})
