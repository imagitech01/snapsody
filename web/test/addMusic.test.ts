import assert from 'node:assert/strict'
import { test } from 'node:test'
import { signal } from '@preact/signals'
import { MAX_PAGES, createAddMusic, pageLayoutOf, scanFolderOf, stavesForPiece } from '../src/app/addMusic.ts'
import type { AddMusicDeps, AddMusicFlow, AddMusicState, ReadingProgress } from '../src/app/addMusic.ts'
import { createI18n } from '../src/app/i18n/index.ts'
import type { Language } from '../src/app/i18n/index.ts'
import { LibraryError, createLibrary } from '../src/app/library.ts'
import type { Library, Staff } from '../src/app/library.ts'
import { loadSettings } from '../src/app/settings.ts'
import { notesOf } from '../src/core/score/model.ts'
import { parseMusicXml } from '../src/core/score/musicxml.ts'
import { createFakePlatform } from '../src/platform/fake/index.ts'
import type { FakePageOutcome, FakePlatform } from '../src/platform/fake/index.ts'
import type { Reader, ReaderEvent } from '../src/platform/port.ts'
import { eighths, quarters, score } from './helpers.ts'

// Adding music (practice-app task 9.5, design D6; specs `score-capture`, `score-recognition`) with
// the fake scanner and reader: the hint, progress, pages combined into one piece, adding pages to a
// piece, cancel, no music on a page, a page that fails, the scanner unavailable, and the scanner's
// files removed afterwards.

/** Page 1: three bars of 3/4 (G G G | A A A | B B B). */
const PAGE_1 = score([quarters(3, 'G'), quarters(3, 'A'), quarters(3, 'B')], [3, 4])
/**
 * Page 2: two bars and no time signature. The second has nine plain eighths: against page 1's 3/4
 * they are three triplets, which the bar-length repair makes of them.
 */
const PAGE_2 = score([quarters(3, 'C'), eighths(9, 'D')])
/** Page 3: one bar. */
const PAGE_3 = score([quarters(3, 'E')], [3, 4])

const ADDED = new Date(2026, 10, 18, 14, 5)

async function setup(options: { hintSeen?: boolean; autoRun?: boolean } = {}) {
  const platform = createFakePlatform({ musicxml: PAGE_1, autoRun: options.autoRun ?? true })
  let ids = 0
  const library = createLibrary(platform.files, { newId: () => `piece-${++ids}`, now: () => ADDED })
  const settings = await loadSettings(platform.files)
  if (options.hintSeen ?? true) await settings.setScanHintSeen(true)
  const i18n = createI18n(signal<Language | null>('en'))
  const deps: AddMusicDeps = {
    scanner: platform.scanner,
    reader: platform.reader,
    files: platform.files,
    library,
    settings,
    defaultName: (date) => i18n.defaultPieceName(date),
    now: () => ADDED,
  }
  return { platform, library, settings, deps, i18n }
}

/** Lets queued microtasks and promise chains run. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

const scans = (platform: FakePlatform): string[] => platform.files.paths().filter((p) => p.startsWith('scans/'))
const pieceFiles = (platform: FakePlatform): Array<[string, string]> =>
  platform.files.paths().filter((p) => p.startsWith('pieces/')).map((p) => [p, [...platform.files.bytes(p)!].join(',')])
const stepOf = (flow: AddMusicFlow): AddMusicState['step'] => flow.state.value.step
const progressOf = (flow: AddMusicFlow): ReadingProgress => {
  const state = flow.state.value
  assert.equal(state.step, 'reading')
  return (state as Extract<AddMusicState, { step: 'reading' }>).progress
}

/** Delivers the events of the last reader job until [until] says stop (or there are none). */
function stepUntil(platform: FakePlatform, until: (event: ReaderEvent) => boolean): void {
  const job = platform.reader.jobs.at(-1)!
  while (job.step()) if (until(job.delivered.at(-1)!)) return
}

/** Makes a one-page piece of PAGE_1 (3 bars) and returns its id. */
async function onePagePiece(s: Awaited<ReturnType<typeof setup>>): Promise<string> {
  s.platform.scanner.willReturn(1)
  s.platform.reader.willRead([{ result: 'done', musicxml: PAGE_1 }])
  const flow = createAddMusic(s.deps)
  await flow.start()
  const state = flow.state.value
  assert.equal(state.step, 'saved')
  return (state as Extract<AddMusicState, { step: 'saved' }>).pieceId
}

// ---- the hint ------------------------------------------------------------------------------

test('hint: shown before the scanner until the user switches it off; then the scanner opens directly', async () => {
  const s = await setup({ hintSeen: false })
  const flow = createAddMusic(s.deps)
  await flow.start()
  assert.equal(stepOf(flow), 'hint')
  assert.equal(s.platform.scanner.calls.length, 0, 'the scanner is not open yet')

  s.platform.scanner.willCancel()
  await flow.continueFromHint()
  assert.equal(stepOf(flow), 'cancelled')
  assert.equal(s.settings.scanHintSeen.value, false, 'without the tick the hint stays')

  const again = createAddMusic(s.deps)
  await again.start()
  assert.equal(stepOf(again), 'hint')
  s.platform.scanner.willCancel()
  await again.continueFromHint({ dontShowAgain: true })
  assert.equal(s.settings.scanHintSeen.value, true)
  assert.deepEqual(JSON.parse(s.platform.files.text('settings.json')!).scanHintSeen, true)

  s.platform.scanner.willCancel()
  const third = createAddMusic(s.deps)
  await third.start()
  assert.equal(s.platform.scanner.calls.length, 3, 'the scanner opened at once')
  assert.deepEqual(s.platform.scanner.calls.at(-1), { maxPages: MAX_PAGES })
  assert.equal(MAX_PAGES, 10)
})

test('hint: cancelling on the hint goes back, and a switch-off that cannot be saved still opens the scanner', async () => {
  const s = await setup({ hintSeen: false })
  const flow = createAddMusic(s.deps)
  await flow.start()
  assert.equal(await flow.cancel(), true)
  assert.equal(stepOf(flow), 'cancelled')

  const failing = createAddMusic({ ...s.deps, settings: { scanHintSeen: s.settings.scanHintSeen, setScanHintSeen: () => Promise.reject(new Error('read-only')) } })
  await failing.start()
  s.platform.scanner.willCancel()
  await failing.continueFromHint({ dontShowAgain: true })
  assert.equal(stepOf(failing), 'cancelled', 'the scanner opened and was left')
  // a second tap on the hint's button, or a cancel, while the setting is saved does not start a second scan
  let release: (() => void) | undefined
  const slow = createAddMusic({
    ...s.deps,
    settings: {
      scanHintSeen: signal(false),
      setScanHintSeen: () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
    },
  })
  await slow.start()
  const calls = s.platform.scanner.calls.length
  s.platform.scanner.willCancel()
  const first = slow.continueFromHint({ dontShowAgain: true })
  await slow.continueFromHint({ dontShowAgain: true })
  assert.equal(await slow.cancel(), false, 'the scanner is about to open')
  release!()
  await first
  assert.equal(s.platform.scanner.calls.length, calls + 1)
  assert.equal(stepOf(slow), 'cancelled')
})

// ---- reading -------------------------------------------------------------------------------

test('progress: "page 2 of 3" with each page done, current or waiting, and the progress never moves backwards', async () => {
  const s = await setup({ autoRun: false })
  s.platform.scanner.willReturn(3)
  s.platform.reader.willRead([{ result: 'done', musicxml: PAGE_1 }, { result: 'done', musicxml: PAGE_2 }, { result: 'done', musicxml: PAGE_3 }])
  const flow = createAddMusic(s.deps)
  const running = flow.start()
  await settle()
  assert.deepEqual(progressOf(flow), { page: 1, pages: 3, fraction: 0, states: ['waiting', 'waiting', 'waiting'] })

  const seen: ReadingProgress[] = []
  const job = s.platform.reader.jobs[0]!
  assert.deepEqual(job.pages, ['scans/1/page-1.jpg', 'scans/1/page-2.jpg', 'scans/1/page-3.jpg'], 'one job for the pages in order')
  assert.deepEqual(flow.pagePaths, job.pages, 'the screen can show the page being read')
  while (!job.delivered.some((e) => e.type === 'done' && e.page === 2)) {
    job.step()
    seen.push(progressOf(flow))
  }
  const atPage2 = seen.find((p) => p.page === 2)!
  assert.deepEqual(atPage2.states, ['done', 'current', 'waiting'])
  assert.equal(s.i18n.t('add.reading.page', { page: atPage2.page, pages: atPage2.pages }), 'Reading page 2 of 3')
  for (let i = 1; i < seen.length; i++) {
    assert.ok(seen[i]!.fraction >= seen[i - 1]!.fraction, 'the progress never moves backwards')
    assert.ok(seen[i]!.page >= seen[i - 1]!.page)
  }
  assert.deepEqual(seen.at(-1), { page: 3, pages: 3, fraction: 1, states: ['done', 'done', 'done'] })

  job.flush()
  await running
  assert.equal(stepOf(flow), 'saved')
  assert.deepEqual(flow.pagePaths, [], 'the page images are gone once the flow has ended')
})

test('two pages give one piece with continuous bars, the default name, each raw reading and photo kept', async () => {
  const s = await setup()
  s.platform.scanner.willReturn(2)
  s.platform.reader.willRead([{ result: 'done', musicxml: PAGE_1 }, { result: 'done', musicxml: PAGE_2 }])
  const flow = createAddMusic(s.deps)
  await flow.start()
  const state = flow.state.value
  assert.equal(state.step, 'saved')
  const { pieceId, added } = state as Extract<AddMusicState, { step: 'saved' }>
  assert.equal(added, false)

  const piece = await s.library.load(pieceId)
  assert.equal(piece.info.name, s.i18n.defaultPieceName(ADDED))
  assert.equal(piece.info.name, '18 Nov, 14:05')
  assert.equal(piece.info.bars, 5)
  assert.deepEqual(piece.info.pages.map((p) => [p.n, p.firstBar, p.lastBar, p.staves]), [[1, 1, 3, []], [2, 4, 5, []]])
  const merged = parseMusicXml(piece.musicxml)
  assert.deepEqual(merged.measures.map((m) => m.number), ['1', '2', '3', '4', '5'])
  assert.equal(merged.measures[3]!.time, undefined, 'page 2 brings no time change')
  assert.deepEqual(piece.info.repairs.map((r) => r.bar), ['5'], "page 2's bars are checked against page 1's 3/4")
  assert.equal(s.platform.files.text(`pieces/${pieceId}/pages/1/recognised.musicxml`), PAGE_1)
  assert.equal(s.platform.files.text(`pieces/${pieceId}/pages/2/recognised.musicxml`), PAGE_2)
  assert.ok(s.platform.files.bytes(`pieces/${pieceId}/pages/2/source.jpg`))
  assert.deepEqual(scans(s.platform), [], 'the scanner files are removed once the piece is saved')
  assert.deepEqual((await s.library.list()).pieces.map((p) => p.id), [pieceId])
})

test('cancel while page 2 of 3 is read: reading stops, no piece is made, the scans are removed', async () => {
  const s = await setup({ autoRun: false })
  s.platform.scanner.willReturn(3)
  s.platform.reader.willRead([{ result: 'done', musicxml: PAGE_1 }, { result: 'done', musicxml: PAGE_2 }, { result: 'done', musicxml: PAGE_3 }])
  const flow = createAddMusic(s.deps)
  const running = flow.start()
  await settle()
  stepUntil(s.platform, (e) => e.type === 'progress' && e.page === 1)
  assert.equal(progressOf(flow).page, 2)
  assert.equal(await flow.cancel(), true)
  await running
  assert.equal(stepOf(flow), 'cancelled')
  const job = s.platform.reader.jobs[0]!
  assert.deepEqual(job.delivered.at(-1), { type: 'finished', pages: 3, status: 'cancelled' })
  assert.ok(!job.delivered.some((e) => e.type === 'done' && e.page === 1), 'page 2 was not finished')
  assert.deepEqual(await s.library.list(), { pieces: [], problems: [] })
  assert.deepEqual(pieceFiles(s.platform), [])
  assert.deepEqual(scans(s.platform), [])
  assert.equal(await flow.cancel(), false, 'a flow that ended cannot be cancelled again')
})

test('cancel while adding pages: the existing piece is unchanged', async () => {
  const s = await setup({ autoRun: false })
  // the piece, made with the reader stepped by hand
  const making = (async () => {
    s.platform.scanner.willReturn(1)
    s.platform.reader.willRead([{ result: 'done', musicxml: PAGE_1 }])
    const flow = createAddMusic(s.deps)
    const run = flow.start()
    await settle()
    s.platform.reader.jobs.at(-1)!.flush()
    await run
    return (flow.state.value as Extract<AddMusicState, { step: 'saved' }>).pieceId
  })()
  const id = await making
  const before = pieceFiles(s.platform)

  s.platform.scanner.willReturn(2)
  s.platform.reader.willRead([{ result: 'done', musicxml: PAGE_2 }, { result: 'done', musicxml: PAGE_3 }])
  const flow = createAddMusic(s.deps, { pieceId: id })
  const running = flow.start()
  await settle()
  stepUntil(s.platform, (e) => e.type === 'done' && e.page === 0)
  await flow.cancel()
  await running
  assert.equal(stepOf(flow), 'cancelled')
  assert.deepEqual(pieceFiles(s.platform), before, 'not one file of the piece changed')
  assert.deepEqual(scans(s.platform), [])
})

test('cancel is refused while the scanner is open and once saving has started', async () => {
  const s = await setup()
  // the scanner is open: the user leaves it there, not from the app
  let leaveScanner: (() => void) | undefined
  const open = createAddMusic({
    ...s.deps,
    scanner: {
      scan: () =>
        new Promise((resolve) => {
          leaveScanner = () => resolve({ cancelled: true, pages: [] })
        }),
    },
  })
  const scanning = open.start()
  await settle()
  assert.equal(stepOf(open), 'scanning')
  assert.equal(await open.cancel(), false)
  assert.equal(stepOf(open), 'scanning')
  leaveScanner!()
  await scanning
  assert.equal(stepOf(open), 'cancelled')

  let release: (() => void) | undefined
  const library = s.deps.library
  const slow: AddMusicDeps['library'] = {
    load: (id) => library.load(id),
    addPages: (id, input, basedOn) => library.addPages(id, input, basedOn),
    create: async (input) => {
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return library.create(input)
    },
  }
  s.platform.scanner.willReturn(1)
  const flow = createAddMusic({ ...s.deps, library: slow })
  const running = flow.start()
  await settle()
  assert.equal(stepOf(flow), 'saving')
  assert.equal(await flow.cancel(), false)
  release!()
  await running
  assert.equal(stepOf(flow), 'saved')
})

// ---- what goes wrong -----------------------------------------------------------------------

test('no music on page 2: says which page, makes no piece, keeps no page, stops reading, and offers to scan again', async () => {
  const s = await setup()
  s.platform.scanner.willReturn(3)
  s.platform.reader.willRead([{ result: 'done', musicxml: PAGE_1 }, { result: 'no-music' }, { result: 'done', musicxml: PAGE_3 }])
  const flow = createAddMusic(s.deps)
  await flow.start()
  assert.deepEqual(flow.state.value, { step: 'no-music', page: 2, pages: 3 })
  assert.equal(s.i18n.t('add.noMusic.body', { page: 2 }), 'There is no music on page 2. Scan it again, cropped to the music.')
  const job = s.platform.reader.jobs[0]!
  assert.ok(!job.delivered.some((e) => e.type !== 'finished' && e.page === 2), 'page 3 is not read')
  assert.equal(job.delivered.at(-1)!.type, 'finished')
  assert.deepEqual(await s.library.list(), { pieces: [], problems: [] })
  assert.deepEqual(scans(s.platform), [], 'none of the scanned pages is kept')

  // scan again: all the pages, from the scanner
  s.platform.scanner.willReturn(2)
  s.platform.reader.willRead([{ result: 'done', musicxml: PAGE_1 }, { result: 'done', musicxml: PAGE_2 }])
  await flow.scanAgain()
  assert.equal(stepOf(flow), 'saved')
  assert.equal(s.platform.scanner.calls.length, 2)
  const [piece] = (await s.library.list()).pieces
  assert.deepEqual([piece!.bars, piece!.pages.length], [5, 2])
  assert.deepEqual(scans(s.platform), [])
})

test('a page that cannot be read: says which page, nothing is saved, and scanning again is offered', async () => {
  const s = await setup()
  s.platform.scanner.willReturn(2)
  s.platform.reader.willRead([{ result: 'failed', message: 'out of memory' }])
  const flow = createAddMusic(s.deps)
  await flow.start()
  assert.deepEqual(flow.state.value, { step: 'failed', reason: 'page', page: 1, message: 'out of memory' })
  assert.equal(s.platform.reader.jobs[0]!.delivered.filter((e) => e.type !== 'finished' && e.page === 1).length, 0, 'page 2 is not read')
  assert.deepEqual(await s.library.list(), { pieces: [], problems: [] })
  assert.deepEqual(scans(s.platform), [])

  // the reader itself breaks
  s.platform.scanner.willReturn(2)
  s.platform.reader.willRead([{ result: 'done', musicxml: PAGE_1 }, { result: 'job-failed', message: 'service killed' }] satisfies FakePageOutcome[])
  await flow.scanAgain()
  assert.deepEqual(flow.state.value, { step: 'failed', reason: 'reading', message: 'service killed' })
  assert.deepEqual(await s.library.list(), { pieces: [], problems: [] })

  // a page read without any bars cannot be combined
  s.platform.scanner.willReturn(1)
  s.platform.reader.willRead([{ result: 'done', musicxml: '<score-partwise version="4.0"/>' }])
  await flow.scanAgain()
  assert.equal(stepOf(flow), 'failed')
  assert.equal((flow.state.value as Extract<AddMusicState, { step: 'failed' }>).reason, 'reading')
  assert.deepEqual(scans(s.platform), [])
})

test('scanner unavailable: the message state, no piece, and no other way is offered', async () => {
  const s = await setup()
  s.platform.scanner.willBeUnavailable()
  const flow = createAddMusic(s.deps)
  await flow.start()
  assert.deepEqual(flow.state.value, { step: 'unavailable' })
  assert.equal(s.platform.reader.jobs.length, 0)
  assert.deepEqual(await s.library.list(), { pieces: [], problems: [] })
  await flow.scanAgain()
  assert.equal(stepOf(flow), 'unavailable', 'scanning again is not offered from here')
  assert.equal(await flow.cancel(), true)
  assert.equal(stepOf(flow), 'cancelled')

  // any other failure of the scanner reads the same
  const broken = createAddMusic({ ...s.deps, scanner: { scan: () => Promise.reject(new Error('camera in use')) } })
  await broken.start()
  assert.equal(stepOf(broken), 'unavailable')
})

test('leaving the scanner without pages goes back, with nothing made', async () => {
  const s = await setup()
  s.platform.scanner.willCancel()
  const flow = createAddMusic(s.deps)
  await flow.start()
  assert.equal(stepOf(flow), 'cancelled')
  assert.equal(s.platform.reader.jobs.length, 0)
})

test('a save that fails: nothing is listed, the scans are removed, and the failure is a save failure', async () => {
  const s = await setup()
  s.platform.files.fault = (operation, paths) => {
    if (operation === 'rename' && paths[1]?.startsWith('pieces/piece-')) throw new Error('disk full')
  }
  s.platform.scanner.willReturn(1)
  const flow = createAddMusic(s.deps)
  await flow.start()
  s.platform.files.fault = undefined
  assert.deepEqual(flow.state.value, { step: 'failed', reason: 'save', message: 'disk full' })
  assert.deepEqual(await s.library.list(), { pieces: [], problems: [] })
  assert.deepEqual(scans(s.platform), [])
})

// ---- adding pages to a piece ---------------------------------------------------------------

test('add pages: the new pages go after the last bar; the bars and corrections the piece had stay', async () => {
  const s = await setup()
  const id = await onePagePiece(s)
  // the user corrects bar 1 (G G G becomes F G G) and saves
  const before = await s.library.load(id)
  const corrected = before.musicxml.replace('<step>G</step>', '<step>F</step>')
  assert.notEqual(corrected, before.musicxml)
  await s.library.writeScore(id, corrected, before.info.score)
  const page1 = s.platform.files.paths().filter((p) => p.startsWith(`pieces/${id}/pages/1/`)).map((p) => [p, s.platform.files.text(p)])

  s.platform.scanner.willReturn(2)
  s.platform.reader.willRead([{ result: 'done', musicxml: PAGE_2 }, { result: 'done', musicxml: PAGE_3 }])
  const flow = createAddMusic(s.deps, { pieceId: id })
  assert.equal(flow.pieceId, id)
  await flow.start()
  const state = flow.state.value as Extract<AddMusicState, { step: 'saved' }>
  assert.deepEqual([state.step, state.pieceId, state.added], ['saved', id, true])

  const after = await s.library.load(id)
  assert.equal(after.info.bars, 6)
  assert.deepEqual(after.info.pages.map((p) => [p.n, p.firstBar, p.lastBar]), [[1, 1, 3], [2, 4, 5], [3, 6, 6]])
  assert.equal(after.info.name, before.info.name, 'the name is kept')
  const merged = parseMusicXml(after.musicxml)
  const old = parseMusicXml(corrected)
  assert.deepEqual(merged.measures.slice(0, 3), old.measures, 'the first bars, with their correction and note ids, are untouched')
  assert.equal(notesOf(merged.measures[0]!)[0]!.pitch!.step, 'F')
  assert.deepEqual(merged.measures.map((m) => m.number), ['1', '2', '3', '4', '5', '6'])
  assert.deepEqual(after.info.repairs.map((r) => r.bar), ['5'], 'only the new bars are repaired')
  assert.deepEqual(s.platform.files.paths().filter((p) => p.startsWith(`pieces/${id}/pages/1/`)).map((p) => [p, s.platform.files.text(p)]), page1)
  assert.equal(s.platform.files.text(`pieces/${id}/pages/3/recognised.musicxml`), PAGE_3)
  assert.deepEqual(scans(s.platform), [])
})

test('add pages: appended to the score as saved when the pages are done, and once more when it was saved in between', async () => {
  const s = await setup()
  const id = await onePagePiece(s)
  const library = s.deps.library as Library
  let interfered = false
  const racing: AddMusicDeps['library'] = {
    create: (input) => library.create(input),
    load: (pieceId) => library.load(pieceId),
    addPages: async (pieceId, input, basedOn) => {
      if (!interfered) {
        // the editor saves a correction between the flow's load and its save
        interfered = true
        const current = await library.load(pieceId)
        await library.writeScore(pieceId, current.musicxml.replace('<step>G</step>', '<step>F</step>'), current.info.score)
      }
      return library.addPages(pieceId, input, basedOn)
    },
  }
  s.platform.scanner.willReturn(1)
  s.platform.reader.willRead([{ result: 'done', musicxml: PAGE_3 }])
  const flow = createAddMusic({ ...s.deps, library: racing }, { pieceId: id })
  await flow.start()
  assert.equal(stepOf(flow), 'saved')
  const after = await s.library.load(id)
  assert.equal(after.info.bars, 4)
  assert.equal(notesOf(parseMusicXml(after.musicxml).measures[0]!)[0]!.pitch!.step, 'F', 'the correction saved in between is kept')

  // a piece that keeps changing under the flow: it gives up after the second try
  const stubborn: AddMusicDeps['library'] = {
    ...racing,
    addPages: async (pieceId) => {
      throw new LibraryError('conflict', 'saved in between', pieceId)
    },
  }
  s.platform.scanner.willReturn(1)
  const again = createAddMusic({ ...s.deps, library: stubborn }, { pieceId: id })
  await again.start()
  assert.equal((again.state.value as Extract<AddMusicState, { step: 'failed' }>).reason, 'save')
  assert.deepEqual(scans(s.platform), [])
})

test('add pages to a piece that is gone: a save failure, and nothing appears', async () => {
  const s = await setup()
  s.platform.scanner.willReturn(1)
  const flow = createAddMusic(s.deps, { pieceId: 'piece-9' })
  await flow.start()
  assert.equal((flow.state.value as Extract<AddMusicState, { step: 'failed' }>).reason, 'save')
  assert.deepEqual(pieceFiles(s.platform), [])
})

// ---- the staff positions hook (design D7, task 10.4) ---------------------------------------

const box = { x: 0.05, y: 0.1, width: 0.9, height: 0.2 }

test('staves: a reader that reports staff positions has them stored with each page, in bar numbers of the piece', async () => {
  const s = await setup()
  const staves = [{ box, firstBar: 1, lastBar: 1 }, { box: { ...box, y: 0.5 }, firstBar: 2, lastBar: 2 }]
  s.platform.scanner.willReturn(2)
  // page 2's two staves, by the page's own bars (design D7); page 1 comes without
  s.platform.reader.willRead([{ result: 'done', musicxml: PAGE_1 }, { result: 'done', musicxml: PAGE_2, staves, timeEstimated: false }])
  const flow = createAddMusic(s.deps)
  await flow.start()
  const { pieceId } = flow.state.value as Extract<AddMusicState, { step: 'saved' }>
  const info = await s.library.info(pieceId)
  assert.deepEqual(info.pages[0]!.staves, [], 'no positions for page 1: the whole photo')
  assert.deepEqual(info.pages[1]!.staves, [{ box, firstBar: 4, lastBar: 4 }, { box: { ...box, y: 0.5 }, firstBar: 5, lastBar: 5 }])
})

test('time: an estimated time signature at the top of a page counts as absent, for a new piece and for added pages', async () => {
  // Page 2 as homr reads a page without a printed meter: an n/4 from the median bar length (here 4/4: the nine eighths are the longest bar).
  const estimated = score([quarters(3, 'C'), eighths(9, 'D')], [4, 4])
  const times = (musicxml: string) => parseMusicXml(musicxml).measures.flatMap((m, i) => (m.time ? [`${i + 1}:${m.time.beats}/${m.time.beatType}`] : []))

  const s = await setup()
  s.platform.scanner.willReturn(2)
  s.platform.reader.willRead([{ result: 'done', musicxml: PAGE_1, timeEstimated: false }, { result: 'done', musicxml: estimated, timeEstimated: true }])
  const flow = createAddMusic(s.deps)
  await flow.start()
  const { pieceId } = flow.state.value as Extract<AddMusicState, { step: 'saved' }>
  const piece = await s.library.load(pieceId)
  assert.deepEqual(times(piece.musicxml), ['1:3/4'], "page 2 goes on in page 1's 3/4")
  assert.deepEqual(piece.info.repairs.map((r) => r.bar), ['5'], 'and its nine eighths are triplets in 3/4')

  s.platform.scanner.willReturn(1)
  s.platform.reader.willRead([{ result: 'done', musicxml: estimated, timeEstimated: true }])
  const adding = createAddMusic(s.deps, { pieceId })
  await adding.start()
  assert.deepEqual(times((await s.library.load(pieceId)).musicxml), ['1:3/4'], 'the added page too')
})

test('staves: positions that do not cover the page bars exactly, or a box that is not fractions, are not stored', () => {
  const range = { firstBar: 9, lastBar: 14 }
  const staff = (firstBar: number, lastBar: number, b = box): Staff => ({ box: b, firstBar, lastBar })
  assert.deepEqual(stavesForPiece([staff(1, 4), staff(5, 6)], range), [staff(9, 12), staff(13, 14)])
  assert.equal(stavesForPiece(undefined, range), undefined)
  assert.equal(stavesForPiece([], range), undefined)
  assert.equal(stavesForPiece([staff(1, 4), staff(5, 5)], range), undefined, 'one bar short')
  assert.equal(stavesForPiece([staff(1, 4), staff(6, 6)], range), undefined, 'a gap')
  assert.equal(stavesForPiece([staff(1, 7)], range), undefined, 'too many bars')
  assert.equal(stavesForPiece([staff(1, 6, { ...box, width: 1.2 })], range), undefined, 'a box wider than the photo')

  const done = { type: 'done', page: 0, pages: 1, musicxml: '<x/>' } as const
  assert.deepEqual(pageLayoutOf(done), {}, 'a reader that knows neither')
  assert.deepEqual(pageLayoutOf({ ...done, staves: [staff(1, 1)], timeEstimated: false }), { staves: [staff(1, 1)], timeEstimated: false })
})

test('a fresh flow is idle, and its buttons do nothing out of turn', async () => {
  const s = await setup()
  const flow = createAddMusic(s.deps)
  assert.deepEqual(flow.state.value, { step: 'idle' })
  await flow.continueFromHint()
  await flow.scanAgain()
  assert.deepEqual(flow.state.value, { step: 'idle' })
  assert.equal(s.platform.scanner.calls.length, 0)
})

test('scanFolderOf: the scan folder of a scanned page is removed with it, and no other folder', () => {
  assert.equal(scanFolderOf('scans/1/page-1.jpg'), 'scans/1')
  assert.equal(scanFolderOf('/data/user/0/be.imagitech.snapsody/files/scans/ab12/page-2.jpg'), '/data/user/0/be.imagitech.snapsody/files/scans/ab12')
  assert.equal(scanFolderOf('scans/page-1.jpg'), undefined, 'never the scans folder itself')
  assert.equal(scanFolderOf('pieces/p1/pages/1/source.jpg'), undefined)
  assert.equal(scanFolderOf('page-1.jpg'), undefined)
})
