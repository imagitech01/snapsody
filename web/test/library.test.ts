import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isDeepStrictEqual } from 'node:util'
import { DEFAULT_PRACTICE, LibraryError, PIECE_FORMAT, createLibrary, normalisePractice } from '../src/app/library.ts'
import type { Library, NewPage, NewPages, NewPiece, Piece, PracticeState } from '../src/app/library.ts'
import { tempSuffix } from '../src/platform/atomicWrite.ts'
import { PlatformError } from '../src/platform/port.ts'
import { createFakePlatform } from '../src/platform/fake/index.ts'
import type { FakeFiles } from '../src/platform/fake/index.ts'
import type { FileOperation } from '../src/platform/keyValueFiles.ts'

// The piece library (practice-app task 8.1, design D4, spec `piece-library`) against the fake
// platform: the format 2 layout, atomic writes, a new piece built in a hidden folder, the start-up
// sweep, bad pieces in the list, adding pages, and what a change that is cut off at any step leaves
// behind (piece.json is the one commit point of a change, design D4). A "restart" is a
// new `Library` on the same files.

const PAGE_1 = Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01)
const PAGE_2 = Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x02)
const T0 = Date.parse('2026-11-18T14:05:00.000Z')
const HOUR = 3_600_000

/** The code of the error a promise rejects with (LibraryError or PlatformError). */
async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    assert.ok(error instanceof LibraryError || error instanceof PlatformError, `rejected with ${String(error)}`)
    return error.code
  }
  throw new Error('did not reject')
}

function setup() {
  const { files } = createFakePlatform()
  let counter = 0
  let clock = T0
  const library = createLibrary(files, { newId: () => `piece-${++counter}`, now: () => new Date(clock) })
  return {
    files,
    library,
    /** Moves the clock on. */
    later: (ms: number) => {
      clock += ms
    },
    /** A second library on the same files, as after a restart. */
    restart: () => createLibrary(files),
  }
}

/** Scanned pages as the scanner leaves them, and a two-page piece made from them. */
function twoPages(files: FakeFiles, overrides: Partial<NewPiece> = {}): NewPiece {
  files.seed('scans/1/page-1.jpg', PAGE_1)
  files.seed('scans/1/page-2.jpg', PAGE_2)
  return {
    name: 'Ode to Joy',
    musicxml: '<score-partwise><!-- current --></score-partwise>',
    bars: 14,
    repairs: [{ bar: '3', message: 'Filled the bar with a rest' }],
    pages: [
      { source: 'scans/1/page-1.jpg', recognised: '<score-partwise><!-- raw 1 --></score-partwise>', firstBar: 1, lastBar: 8 },
      {
        source: 'scans/1/page-2.jpg',
        recognised: '<score-partwise><!-- raw 2 --></score-partwise>',
        firstBar: 9,
        lastBar: 14,
        staves: [
          { box: { x: 0.03, y: 0.15, width: 0.94, height: 0.3 }, firstBar: 9, lastBar: 13 },
          { box: { x: 0.03, y: 0.58, width: 0.2, height: 0.3 }, firstBar: 14, lastBar: 14 },
        ],
      },
    ],
    ...overrides,
  }
}

/** A page from the first scan with the bar range [firstBar]..[lastBar]. */
const page = (firstBar: number, lastBar: number): NewPage => ({ source: 'scans/1/page-1.jpg', recognised: '<score-partwise/>', firstBar, lastBar })

/** Makes the operations of [operations] on a path for which [matches] says so fail with [message]. */
function failWhen(files: FakeFiles, operations: FileOperation[], matches: (paths: string[]) => boolean, message = 'disk full'): void {
  files.fault = (operation, paths) => {
    if (operations.includes(operation) && matches(paths)) throw new Error(message)
  }
}

const strayTemps = (files: FakeFiles): string[] => files.paths().filter((p) => /\.tmp-/.test(p))

// ---- create and load -----------------------------------------------------------------------

test('create: builds the format 2 layout, copies the photos byte for byte and leaves the scans alone', async () => {
  const { files, library } = setup()
  const info = await library.create(twoPages(files))
  assert.equal(info.id, 'piece-1')
  assert.deepEqual(files.paths().filter((p) => p.startsWith('pieces/')), [
    'pieces/piece-1/pages/1/recognised.musicxml',
    'pieces/piece-1/pages/1/source.jpg',
    'pieces/piece-1/pages/2/recognised.musicxml',
    'pieces/piece-1/pages/2/source.jpg',
    'pieces/piece-1/piece.json',
    'pieces/piece-1/score-1.musicxml',
  ])
  assert.deepEqual([...files.bytes('pieces/piece-1/pages/1/source.jpg')!], [...PAGE_1])
  assert.deepEqual([...files.bytes('pieces/piece-1/pages/2/source.jpg')!], [...PAGE_2])
  assert.deepEqual([...files.bytes('scans/1/page-1.jpg')!], [...PAGE_1], 'the scan is not the library\'s to delete')
  assert.equal(files.text('pieces/piece-1/pages/2/recognised.musicxml'), '<score-partwise><!-- raw 2 --></score-partwise>')
  assert.equal(files.text('pieces/piece-1/score-1.musicxml'), '<score-partwise><!-- current --></score-partwise>')

  const stored = JSON.parse(files.text('pieces/piece-1/piece.json')!)
  assert.deepEqual(stored, {
    format: 2,
    id: 'piece-1',
    name: 'Ode to Joy',
    created: '2026-11-18T14:05:00.000Z',
    lastPracticed: null,
    favorite: false,
    score: 'score-1.musicxml',
    pages: [
      { n: 1, firstBar: 1, lastBar: 8, staves: [] },
      {
        n: 2,
        firstBar: 9,
        lastBar: 14,
        staves: [
          { box: { x: 0.03, y: 0.15, width: 0.94, height: 0.3 }, firstBar: 9, lastBar: 13 },
          { box: { x: 0.03, y: 0.58, width: 0.2, height: 0.3 }, firstBar: 14, lastBar: 14 },
        ],
      },
    ],
    repairs: [{ bar: '3', message: 'Filled the bar with a rest' }],
    bars: 14,
  })
  assert.equal(PIECE_FORMAT, 2)
  assert.deepEqual(info, stored)
  assert.equal(strayTemps(files).length, 0)
})

test('create then load: the piece opens with its score, and again after a restart', async () => {
  const { files, library, restart } = setup()
  await library.create(twoPages(files))
  const piece = await restart().load('piece-1')
  assert.equal(piece.info.name, 'Ode to Joy')
  assert.equal(piece.info.bars, 14)
  assert.equal(piece.musicxml, '<score-partwise><!-- current --></score-partwise>')
  assert.deepEqual(piece.info.pages.map((p) => [p.n, p.firstBar, p.lastBar, p.staves.length]), [[1, 1, 8, 0], [2, 9, 14, 2]])
})

test('create: the name is trimmed, and a piece needs a name, a score, pages whose bar ranges follow each other over every bar', async () => {
  const { files, library } = setup()
  assert.equal((await library.create(twoPages(files, { name: '  Etude  ' }))).name, 'Etude')
  const cases: Array<[string, Partial<NewPiece>]> = [
    ['blank name', { name: '   ' }],
    ['no score', { musicxml: '' }],
    ['no pages', { pages: [] }],
    ['no bars', { bars: 0 }],
    ['a range past the last bar', { bars: 10 }],
    ['a range backwards', { pages: [{ source: 'scans/1/page-1.jpg', recognised: '<x/>', firstBar: 5, lastBar: 2 }], bars: 14 }],
    ['a gap between the pages', { pages: [page(1, 8), page(10, 14)] }],
    ['pages that overlap', { pages: [page(1, 8), page(8, 14)] }],
    ['the first page not at bar 1', { pages: [page(2, 8), page(9, 14)] }],
    ['the pages stop before the last bar', { bars: 15 }],
    ['the pages out of order', { pages: [page(9, 14), page(1, 8)] }],
    ['a box outside the page', { pages: [{ source: 'scans/1/page-1.jpg', recognised: '<x/>', firstBar: 1, lastBar: 2, staves: [{ box: { x: 0, y: 0, width: 1.5, height: 1 }, firstBar: 1, lastBar: 2 }] }], bars: 2 }],
  ]
  for (const [what, overrides] of cases) {
    const error = await library.create(twoPages(files, overrides)).catch((e: unknown) => e)
    assert.ok(error instanceof LibraryError && error.code === 'invalid', `${what}: ${String(error)}`)
  }
  assert.deepEqual((await library.list()).pieces.map((p) => p.id), ['piece-1'], 'only the first piece was made')
  assert.deepEqual(files.paths().filter((p) => p.includes('.tmp-')), [], 'nothing was built for the invalid ones')
})

test('create: ids are UUIDs and unique by default, and created comes from the clock', async () => {
  const { files } = createFakePlatform()
  const library = createLibrary(files)
  const a = await library.create(twoPages(files))
  const b = await library.create(twoPages(files))
  assert.match(a.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  assert.notEqual(a.id, b.id)
  assert.ok(Math.abs(Date.parse(a.created) - Date.now()) < 60_000)
})

test('create: a photo that is not there fails the whole piece and removes what was built', async () => {
  const { files, library } = setup()
  files.seed('scans/1/page-1.jpg', PAGE_1)
  const input = twoPages(files)
  input.pages[1]!.source = 'scans/1/gone.jpg'
  assert.equal(await codeOf(library.create(input)), 'not-found')
  assert.deepEqual(files.paths().filter((p) => p.startsWith('pieces/')), [])
  assert.deepEqual((await library.list()).pieces, [])
})

test('create: the copy of page 2 fails half way and the piece is never listed', async () => {
  const { files, library } = setup()
  const input = twoPages(files)
  failWhen(files, ['copy'], (paths) => paths[0] === 'scans/1/page-2.jpg')
  await assert.rejects(library.create(input), /disk full/)
  files.fault = undefined
  assert.deepEqual(files.paths().filter((p) => p.startsWith('pieces/')), [], 'the hidden folder is removed again')
  assert.deepEqual(await library.list(), { pieces: [], problems: [] })

  // the same, and then the app dies before it can clean up: the hidden folder stays, but is not a piece
  let crashed = false
  files.fault = (operation, paths) => {
    if (operation === 'copy' && paths[0] === 'scans/1/page-2.jpg') {
      crashed = true
      throw new Error('disk full')
    }
    if (crashed && operation === 'remove') throw new Error('process died')
  }
  await assert.rejects(library.create(input), /disk full/)
  files.fault = undefined
  assert.ok(files.paths().some((p) => p.startsWith('pieces/.tmp-piece-2/')), 'a half-built folder is left')
  assert.deepEqual(await library.list(), { pieces: [], problems: [] })
  assert.deepEqual(await library.sweep(), { removed: ['pieces/.tmp-piece-2'], restored: [] })
  assert.deepEqual(files.paths().filter((p) => p.startsWith('pieces/')), [])
})

test('create: the rename into place fails, and the other pieces are untouched', async () => {
  const { files, library } = setup()
  await library.create(twoPages(files))
  const before = files.paths().filter((p) => p.startsWith('pieces/piece-1/'))
  const input = twoPages(files, { name: 'Second' })
  failWhen(files, ['rename'], (paths) => paths[1] === 'pieces/piece-2')
  await assert.rejects(library.create(input), /disk full/)
  files.fault = undefined
  assert.deepEqual((await library.list()).pieces.map((p) => p.name), ['Ode to Joy'])
  assert.deepEqual(files.paths().filter((p) => p.startsWith('pieces/')), before, 'no hidden folder, nothing new')
  assert.equal((await library.load('piece-1')).info.name, 'Ode to Joy')
})

test('create: a rename into place that fails half way removes the part that arrived, but never a folder that was there before', async () => {
  const { files, library } = setup()
  await library.create(twoPages(files))
  // the rename moved one file of the new piece and then failed
  files.fault = (operation, paths) => {
    if (operation === 'rename' && paths[1] === 'pieces/piece-2') {
      files.seed('pieces/piece-2/pages/1/source.jpg', PAGE_1)
      throw new Error('disk full')
    }
  }
  await assert.rejects(library.create(twoPages(files, { name: 'Second' })), /disk full/)
  files.fault = undefined
  assert.deepEqual(files.paths().filter((p) => p.startsWith('pieces/') && !p.startsWith('pieces/piece-1/')), [], 'the part that arrived is removed')

  // an id that is already taken: the rename refuses, and the piece that has the id is untouched
  const before = files.paths().filter((p) => p.startsWith('pieces/piece-1/')).map((p) => [p, files.text(p)])
  const taken = createLibrary(files, { newId: () => 'piece-1', now: () => new Date(T0) })
  assert.equal(await codeOf(taken.create(twoPages(files, { name: 'Impostor' }))), 'exists')
  assert.deepEqual(files.paths().filter((p) => p.startsWith('pieces/piece-1/')).map((p) => [p, files.text(p)]), before)
  assert.equal((await library.load('piece-1')).info.name, 'Ode to Joy')
  assert.deepEqual(files.paths().filter((p) => p.startsWith('pieces/.')), [])
})

test('load: not found, and ids that could leave pieces/ or name a hidden folder are refused', async () => {
  const { files, library } = setup()
  await library.create(twoPages(files))
  assert.equal(await codeOf(library.load('piece-9')), 'not-found')
  files.seed('outside.json', '{}')
  for (const id of ['', '.', '..', '../outside', 'a/b', '.tmp-piece-1', 'a b', 'x'.repeat(65)]) {
    const where = JSON.stringify(id)
    assert.equal(await codeOf(library.load(id)), 'invalid', `load ${where}`)
    assert.equal(await codeOf(library.update(id, { favorite: true })), 'invalid', `update ${where}`)
    assert.equal(await codeOf(library.writeScore(id, '<x/>', 'score-1.musicxml')), 'invalid', `writeScore ${where}`)
    assert.equal(await codeOf(library.readPractice(id)), 'invalid', `readPractice ${where}`)
    assert.equal(await codeOf(library.writePractice(id, DEFAULT_PRACTICE)), 'invalid', `writePractice ${where}`)
    assert.equal(await codeOf(library.remove(id)), 'invalid', `remove ${where}`)
    assert.equal(await codeOf(library.pageImageUrl(id, 1)), 'invalid', `pageImageUrl ${where}`)
  }
  assert.ok(files.paths().includes('outside.json'))
})

test('load: a piece that lost its score is damaged, and one of another format is not read', async () => {
  const { files, library } = setup()
  await library.create(twoPages(files))
  files.seed('pieces/piece-1/piece.json', JSON.stringify({ ...JSON.parse(files.text('pieces/piece-1/piece.json')!), format: 3 }))
  const unsupported = await library.load('piece-1').catch((e: unknown) => e)
  assert.ok(unsupported instanceof LibraryError)
  assert.equal(unsupported.code, 'unsupported-format')
  assert.match(unsupported.message, /format 3/)

  const second = setup()
  await second.library.create(twoPages(second.files))
  await second.files.remove('pieces/piece-1/score-1.musicxml')
  assert.equal(await codeOf(second.library.load('piece-1')), 'damaged')
})

test('load: when the score file is replaced between reading piece.json and reading the score, piece.json is read again', async () => {
  const { files, library } = setup()
  await library.create(twoPages(files))
  const info = await library.info('piece-1')
  // a change of the score commits just as load reads the old score file
  let reads = 0
  files.fault = (operation, paths) => {
    if (operation === 'read' && paths[0] === 'pieces/piece-1/score-1.musicxml') {
      reads++
      files.seed('pieces/piece-1/score-2.musicxml', '<score-partwise><!-- edited --></score-partwise>')
      files.seed('pieces/piece-1/piece.json', JSON.stringify({ ...info, score: 'score-2.musicxml' }))
      throw new PlatformError('not-found', 'removed just now')
    }
  }
  const piece = await library.load('piece-1')
  files.fault = undefined
  assert.equal(reads, 1)
  assert.equal(piece.info.score, 'score-2.musicxml')
  assert.equal(piece.musicxml, '<score-partwise><!-- edited --></score-partwise>')

  // a score that stays missing is damage, not a race: read again once, then rejected
  await files.remove('pieces/piece-1/score-2.musicxml')
  assert.equal(await codeOf(library.load('piece-1')), 'damaged')
})

// ---- list ----------------------------------------------------------------------------------

test('list: the most recently practised or added first, and a piece\'s info has what the summary line needs', async () => {
  const { files, library, later } = setup()
  await library.create(twoPages(files, { name: 'A' }))
  later(HOUR)
  await library.create(twoPages(files, { name: 'B' }))
  later(HOUR)
  await library.create(twoPages(files, { name: 'C' }))
  assert.deepEqual((await library.list()).pieces.map((p) => p.name), ['C', 'B', 'A'])
  await library.update('piece-1', { lastPracticed: new Date(T0 + 5 * HOUR).toISOString() })
  const { pieces, problems } = await library.list()
  assert.deepEqual(pieces.map((p) => p.name), ['A', 'C', 'B'], 'practising moves a piece to the front')
  assert.deepEqual(problems, [])
  const a = pieces[0]!
  assert.equal(a.pages.length, 2)
  assert.equal(a.bars, 14)
  assert.equal(a.lastPracticed, '2026-11-18T19:05:00.000Z')
})

test('list: an empty library, and entries that are not pieces are ignored', async () => {
  const { files, library } = setup()
  assert.deepEqual(await library.list(), { pieces: [], problems: [] })
  await library.create(twoPages(files))
  files.seed('pieces/.tmp-piece-7/piece.json', files.text('pieces/piece-1/piece.json')!)
  files.seed('pieces/readme.txt', 'not a piece')
  files.seed('pieces/not an id/piece.json', '{}')
  const { pieces, problems } = await library.list()
  assert.deepEqual(pieces.map((p) => p.id), ['piece-1'])
  assert.deepEqual(problems, [])
})

test('list: a damaged or unknown-format piece is skipped and reported, the others are listed, nothing is deleted', async () => {
  const { files, library } = setup()
  await library.create(twoPages(files, { name: 'Good' }))
  const good = JSON.parse(files.text('pieces/piece-1/piece.json')!)
  const variants: Record<string, string | undefined> = {
    'bad-json': '{nope',
    'not-object': '[1, 2]',
    'no-format': JSON.stringify({ ...good, id: 'no-format', format: undefined }),
    'format-1': JSON.stringify({ ...good, id: 'format-1', format: 1 }),
    'format-3': JSON.stringify({ ...good, id: 'format-3', format: 3 }),
    moved: JSON.stringify({ ...good, id: 'piece-1' }),
    'no-pages': JSON.stringify({ ...good, id: 'no-pages', pages: [] }),
    'bad-range': JSON.stringify({ ...good, id: 'bad-range', pages: [{ n: 1, firstBar: 3, lastBar: 99, staves: [] }] }),
    'bad-name': JSON.stringify({ ...good, id: 'bad-name', name: 42 }),
    gap: JSON.stringify({ ...good, id: 'gap', pages: [good.pages[0], { ...good.pages[1], firstBar: 10 }] }),
    overlap: JSON.stringify({ ...good, id: 'overlap', pages: [good.pages[0], { ...good.pages[1], firstBar: 8 }] }),
    short: JSON.stringify({ ...good, id: 'short', bars: 15 }),
    'twice-n': JSON.stringify({ ...good, id: 'twice-n', pages: [good.pages[0], { ...good.pages[1], n: 1 }] }),
    'no-score': JSON.stringify({ ...good, id: 'no-score', score: undefined }),
    'score-path': JSON.stringify({ ...good, id: 'score-path', score: '../piece-1/score-1.musicxml' }),
    'no-json': undefined, // a folder with other files only, like the first version's meta.json
  }
  for (const [id, text] of Object.entries(variants)) {
    if (text === undefined) files.seed(`pieces/${id}/meta.json`, '{"name":"old"}')
    else files.seed(`pieces/${id}/piece.json`, text)
  }
  const { pieces, problems } = await library.list()
  assert.deepEqual(pieces.map((p) => p.id), ['piece-1'])
  assert.deepEqual(
    problems.map((p) => [p.id, p.reason]),
    [
      ['bad-json', 'damaged'],
      ['bad-name', 'damaged'],
      ['bad-range', 'damaged'],
      ['format-1', 'unsupported-format'],
      ['format-3', 'unsupported-format'],
      ['gap', 'damaged'],
      ['moved', 'damaged'],
      ['no-format', 'damaged'],
      ['no-pages', 'damaged'],
      ['no-score', 'damaged'],
      ['not-object', 'damaged'],
      ['overlap', 'damaged'],
      ['score-path', 'damaged'],
      ['short', 'damaged'],
      ['twice-n', 'damaged'],
    ],
    'a folder without piece.json (no-json) is neither listed nor a problem: it is a piece being made or deleted, or no piece',
  )
  assert.equal(await codeOf(library.load('no-json')), 'damaged', 'opening it says what is wrong')
  assert.ok(problems.every((p) => p.message.length > 0))
  // reported, not removed: not by list, and not by the start-up sweep either
  await library.sweep()
  for (const id of Object.keys(variants)) assert.ok(files.paths().some((p) => p.startsWith(`pieces/${id}/`)), `${id} is still there`)
  // such a piece can still be deleted by the user
  await library.remove('format-3')
  assert.ok(!files.paths().some((p) => p.startsWith('pieces/format-3/')))
})

// ---- update, score, practice ---------------------------------------------------------------

test('update: rename, star and lastPracticed change piece.json and nothing else', async () => {
  const { files, library } = setup()
  await library.create(twoPages(files))
  const before = Object.fromEntries(files.paths().filter((p) => !p.endsWith('piece.json')).map((p) => [p, files.text(p)]))
  const renamed = await library.update('piece-1', { name: '  Ode to Joy (easy)  ' })
  assert.equal(renamed.name, 'Ode to Joy (easy)')
  await library.update('piece-1', { favorite: true })
  const practised = await library.update('piece-1', { lastPracticed: '2026-11-19T08:00:00.000Z' })
  assert.equal(practised.favorite, true)
  assert.equal(practised.lastPracticed, '2026-11-19T08:00:00.000Z')
  const info = (await library.load('piece-1')).info
  assert.deepEqual(info, practised)
  assert.equal(info.name, 'Ode to Joy (easy)')
  assert.equal(info.created, '2026-11-18T14:05:00.000Z', 'created never changes')
  assert.equal(info.id, 'piece-1')
  assert.deepEqual(Object.fromEntries(files.paths().filter((p) => !p.endsWith('piece.json')).map((p) => [p, files.text(p)])), before)
  await library.update('piece-1', { favorite: false, lastPracticed: null })
  assert.deepEqual([(await library.info('piece-1')).favorite, (await library.info('piece-1')).lastPracticed], [false, null])
  assert.equal(strayTemps(files).length, 0)
})

test('update: an empty name is not accepted and nothing is written; an unknown piece is not found and not created', async () => {
  const { files, library } = setup()
  await library.create(twoPages(files))
  const before = files.text('pieces/piece-1/piece.json')
  assert.equal(await codeOf(library.update('piece-1', { name: '  ' })), 'invalid')
  assert.equal(await codeOf(library.update('piece-1', { lastPracticed: 'yesterday' })), 'invalid')
  assert.equal(files.text('pieces/piece-1/piece.json'), before)
  assert.equal(await codeOf(library.update('piece-2', { favorite: true })), 'not-found')
  assert.ok(!files.paths().some((p) => p.startsWith('pieces/piece-2')))
})

test('update: changes made at the same time all land, and a failed one does not block the next', async () => {
  const { files, library } = setup()
  await library.create(twoPages(files))
  const results = await Promise.allSettled([
    library.update('piece-1', { favorite: true }),
    library.update('piece-1', { name: '' }),
    library.update('piece-1', { lastPracticed: '2026-11-19T08:00:00.000Z' }),
    library.update('piece-1', { name: 'Third' }),
  ])
  assert.deepEqual(results.map((r) => r.status), ['fulfilled', 'rejected', 'fulfilled', 'fulfilled'])
  const info = await library.info('piece-1')
  assert.deepEqual([info.favorite, info.lastPracticed, info.name], [true, '2026-11-19T08:00:00.000Z', 'Third'])
})

test('a write cut off between the temp file and the rename leaves the old piece', async () => {
  const { files, library, restart } = setup()
  await library.create(twoPages(files))
  // a crash: the rename never happens and nothing gets to clean up
  failWhen(files, ['rename', 'remove'], (paths) => paths.some((p) => p.startsWith('pieces/piece-1/piece.json')), 'process died')
  await assert.rejects(library.update('piece-1', { name: 'New name', favorite: true }), /process died/)
  files.fault = undefined
  assert.equal(strayTemps(files).length, 1, 'the temp file is left behind')
  assert.match(strayTemps(files)[0]!, /^pieces\/piece-1\/piece\.json\.tmp-/)

  const stray = strayTemps(files)[0]!
  const after = restart()
  const { pieces, problems } = await after.list()
  assert.deepEqual(problems, [])
  assert.deepEqual(pieces.map((p) => [p.name, p.favorite]), [['Ode to Joy', false]], 'the piece is as it was')
  assert.equal((await after.load('piece-1')).musicxml, '<score-partwise><!-- current --></score-partwise>')
  assert.deepEqual(await after.sweep(), { removed: [stray], restored: [] }, 'the next start sweeps the stray file: its target is there')
  assert.deepEqual(strayTemps(files), [])
  assert.equal((await after.info('piece-1')).name, 'Ode to Joy')
})

test('a write that fails where the store can still see it leaves the old piece and no temp file', async () => {
  const { files, library } = setup()
  await library.create(twoPages(files))
  failWhen(files, ['rename'], (paths) => paths[1] === 'pieces/piece-1/piece.json')
  await assert.rejects(library.update('piece-1', { name: 'New name' }), /disk full/)
  files.fault = undefined
  assert.equal(strayTemps(files).length, 0)
  assert.equal((await library.info('piece-1')).name, 'Ode to Joy')
  // and the next update works
  assert.equal((await library.update('piece-1', { name: 'Fine' })).name, 'Fine')
})

test('writeScore: replaces the corrected score and leaves the original readings unchanged; a cut-off write leaves the old score', async () => {
  const { files, library } = setup()
  await library.create(twoPages(files))
  const readings = [files.text('pieces/piece-1/pages/1/recognised.musicxml'), files.text('pieces/piece-1/pages/2/recognised.musicxml')]
  const info = await library.info('piece-1')
  const written = await library.writeScore('piece-1', '<score-partwise><!-- corrected --></score-partwise>', info.score)
  assert.deepEqual(written, { ...info, score: 'score-2.musicxml' }, 'piece.json changes only in the score file it names')
  assert.deepEqual(await library.info('piece-1'), written)
  assert.equal((await library.load('piece-1')).musicxml, '<score-partwise><!-- corrected --></score-partwise>')
  assert.deepEqual([files.text('pieces/piece-1/pages/1/recognised.musicxml'), files.text('pieces/piece-1/pages/2/recognised.musicxml')], readings)
  assert.deepEqual(files.paths().filter((p) => /score-/.test(p)), ['pieces/piece-1/score-2.musicxml'], 'the old score file is removed')
  assert.equal(strayTemps(files).length, 0)

  // a crash while the new score is written: its temp file is left, piece.json still names score-2
  failWhen(files, ['rename', 'remove'], (paths) => paths.some((p) => p.includes('score-3.musicxml')), 'process died')
  await assert.rejects(library.writeScore('piece-1', '<score-partwise><!-- lost --></score-partwise>', 'score-2.musicxml'), /process died/)
  files.fault = undefined
  assert.equal((await library.load('piece-1')).musicxml, '<score-partwise><!-- corrected --></score-partwise>')
  assert.equal(strayTemps(files).length, 1)
  // its target is missing and it parses, so the sweep promotes it, and then removes it: nothing names it
  assert.deepEqual(await library.sweep(), { removed: ['pieces/piece-1/score-3.musicxml'], restored: ['pieces/piece-1/score-3.musicxml'] })
  assert.equal(strayTemps(files).length, 0)
  assert.deepEqual(files.paths().filter((p) => /score-/.test(p)), ['pieces/piece-1/score-2.musicxml'])
  assert.equal((await library.load('piece-1')).musicxml, '<score-partwise><!-- corrected --></score-partwise>')
})

test('writeScore: a failure the store can see removes the new score file and keeps the old piece', async () => {
  const { files, library } = setup()
  await library.create(twoPages(files))
  failWhen(files, ['rename'], (paths) => paths[1] === 'pieces/piece-1/piece.json')
  await assert.rejects(library.writeScore('piece-1', '<score-partwise><!-- new --></score-partwise>', 'score-1.musicxml'), /disk full/)
  files.fault = undefined
  assert.deepEqual(files.paths().filter((p) => /score-/.test(p)), ['pieces/piece-1/score-1.musicxml'], 'score-2 is removed again')
  assert.equal(strayTemps(files).length, 0)
  assert.equal((await library.load('piece-1')).musicxml, '<score-partwise><!-- current --></score-partwise>')
  // removing the old score after the commit is best effort: a failure there does not undo or reject the change
  failWhen(files, ['remove'], (paths) => paths[0] === 'pieces/piece-1/score-1.musicxml')
  assert.equal((await library.writeScore('piece-1', '<score-partwise><!-- new --></score-partwise>', 'score-1.musicxml')).score, 'score-2.musicxml')
  files.fault = undefined
  assert.equal((await library.load('piece-1')).musicxml, '<score-partwise><!-- new --></score-partwise>')
  assert.deepEqual((await library.sweep()).removed, ['pieces/piece-1/score-1.musicxml'], 'the sweep removes the old score')
})

test('writeScore: an unknown piece is not found and no folder appears; an empty score is refused', async () => {
  const { files, library } = setup()
  await library.create(twoPages(files))
  assert.equal(await codeOf(library.writeScore('piece-9', '<x/>', 'score-1.musicxml')), 'not-found')
  assert.equal(await codeOf(library.writeScore('piece-1', '', 'score-1.musicxml')), 'invalid')
  assert.ok(!files.paths().some((p) => p.startsWith('pieces/piece-9')))
})

test('writeScore: a change based on a score that was replaced since is a conflict, and nothing is written', async () => {
  const { files, library } = setup()
  await library.create(twoPages(files))
  const loaded = await library.load('piece-1')
  // someone else saves first
  await library.writeScore('piece-1', '<score-partwise><!-- theirs --></score-partwise>', loaded.info.score)
  const before = files.paths().map((p) => [p, files.text(p)])
  const error = await library.writeScore('piece-1', '<score-partwise><!-- mine --></score-partwise>', loaded.info.score).catch((e: unknown) => e)
  assert.ok(error instanceof LibraryError && error.code === 'conflict' && error.pieceId === 'piece-1', String(error))
  assert.deepEqual(files.paths().map((p) => [p, files.text(p)]), before)
  assert.equal((await library.load('piece-1')).musicxml, '<score-partwise><!-- theirs --></score-partwise>')
  // based on the score that is there now, it goes through
  assert.equal((await library.writeScore('piece-1', '<score-partwise><!-- mine --></score-partwise>', 'score-2.musicxml')).score, 'score-3.musicxml')
})

test('writeScore: a crafted score name is never read, and a next revision that would not be a new score file is refused', async () => {
  const { files, library } = setup()
  await library.create(twoPages(files))
  const info = JSON.parse(files.text('pieces/piece-1/piece.json')!)
  // 2^53: one more is the same number, so the "next" score would be the current one and the commit would delete it
  files.seed('pieces/piece-1/score-9007199254740992.musicxml', '<score-partwise><!-- crafted --></score-partwise>')
  files.seed('pieces/piece-1/piece.json', JSON.stringify({ ...info, score: 'score-9007199254740992.musicxml' }))
  assert.equal(await codeOf(library.load('piece-1')), 'damaged')
  assert.equal(await codeOf(library.writeScore('piece-1', '<score-partwise/>', 'score-9007199254740992.musicxml')), 'damaged')
  assert.ok(files.paths().includes('pieces/piece-1/score-9007199254740992.musicxml'), 'nothing was removed')

  // the largest revision that reads: its next one would not, so nothing is written or removed
  files.seed('pieces/piece-1/score-999999999.musicxml', '<score-partwise><!-- last --></score-partwise>')
  files.seed('pieces/piece-1/piece.json', JSON.stringify({ ...info, score: 'score-999999999.musicxml' }))
  assert.equal((await library.load('piece-1')).musicxml, '<score-partwise><!-- last --></score-partwise>')
  const before = files.paths().map((p) => [p, files.text(p)])
  assert.equal(await codeOf(library.writeScore('piece-1', '<score-partwise/>', 'score-999999999.musicxml')), 'damaged')
  assert.deepEqual(files.paths().map((p) => [p, files.text(p)]), before)
})

test('practice: none until saved, then restored as saved, atomically, and it survives other updates', async () => {
  const { files, library, restart } = setup()
  await library.create(twoPages(files))
  assert.equal(await library.readPractice('piece-1'), null)
  const state: PracticeState = { bar: 10, tempo: 60, loop: { start: 9, end: 12 }, loopRest: 1, metronome: true }
  await library.writePractice('piece-1', state)
  assert.deepEqual(JSON.parse(files.text('pieces/piece-1/practice.json')!), state)
  await library.update('piece-1', { name: 'Renamed' })
  await library.writeScore('piece-1', '<score-partwise><!-- edited --></score-partwise>', 'score-1.musicxml')
  assert.deepEqual(await restart().readPractice('piece-1'), state)
  await library.writePractice('piece-1', { ...state, tempo: null, loop: null, loopRest: 0 })
  assert.deepEqual(await library.readPractice('piece-1'), { ...state, tempo: null, loop: null, loopRest: 0 })
  assert.equal(strayTemps(files).length, 0)
})

test('practice: a save that is cut off leaves the old state', async () => {
  const { files, library } = setup()
  await library.create(twoPages(files))
  await library.writePractice('piece-1', { ...DEFAULT_PRACTICE, bar: 3 })
  failWhen(files, ['rename', 'remove'], (paths) => paths.some((p) => p.includes('practice.json')), 'process died')
  await assert.rejects(library.writePractice('piece-1', { ...DEFAULT_PRACTICE, bar: 9 }), /process died/)
  files.fault = undefined
  assert.equal((await library.readPractice('piece-1'))!.bar, 3)
})

test('practice: a practice.json that cannot be used gives null or the defaults, field by field', async () => {
  const { files, library } = setup()
  await library.create(twoPages(files))
  files.seed('pieces/piece-1/practice.json', '{broken')
  assert.equal(await library.readPractice('piece-1'), null)
  files.seed('pieces/piece-1/practice.json', JSON.stringify({ bar: 7, tempo: 'fast', loop: { start: 5, end: 2 }, loopRest: 3, countIn: true, follow: false, metronome: true }))
  assert.deepEqual(await library.readPractice('piece-1'), { ...DEFAULT_PRACTICE, bar: 7, metronome: true })
  assert.deepEqual(normalisePractice(null), DEFAULT_PRACTICE)
  assert.deepEqual(normalisePractice({ bar: 0, tempo: -5, loop: { start: 1, end: 1 }, loopRest: 2 }), { ...DEFAULT_PRACTICE, loop: { start: 1, end: 1 }, loopRest: 2 })
})

test('practice: a late save for a piece that was deleted does not bring its folder back', async () => {
  const { files, library } = setup()
  await library.create(twoPages(files))
  await library.remove('piece-1')
  assert.equal(await codeOf(library.writePractice('piece-1', DEFAULT_PRACTICE)), 'not-found')
  assert.equal(await library.readPractice('piece-1'), null)
  assert.deepEqual(files.paths().filter((p) => p.startsWith('pieces/')), [])
  assert.deepEqual(await library.list(), { pieces: [], problems: [] })
})

// ---- add pages -----------------------------------------------------------------------------

/** A one-page piece of 8 bars (the first page of `twoPages`). */
function onePage(files: FakeFiles): NewPiece {
  const input = twoPages(files)
  return { ...input, musicxml: '<score-partwise><!-- 8 bars --></score-partwise>', bars: 8, pages: [input.pages[0]!] }
}

/** The page that adds bars 9..14 to `onePage`, with the whole score after it. */
function secondPage(overrides: Partial<NewPages> = {}): NewPages {
  return {
    musicxml: '<score-partwise><!-- 14 bars --></score-partwise>',
    bars: 14,
    repairs: [{ bar: '12', message: 'Filled the bar with a rest' }],
    pages: [
      {
        source: 'scans/1/page-2.jpg',
        recognised: '<score-partwise><!-- raw 2 --></score-partwise>',
        firstBar: 9,
        lastBar: 14,
        staves: [{ box: { x: 0.03, y: 0.15, width: 0.94, height: 0.3 }, firstBar: 9, lastBar: 14 }],
      },
    ],
    ...overrides,
  }
}

test('addPages: a page added after the last bar gives 14 bars; the first 8, their page and their corrections stay', async () => {
  const { files, library, restart } = setup()
  await library.create(onePage(files))
  await library.update('piece-1', { name: 'Renamed', favorite: true })
  await library.writeScore('piece-1', '<score-partwise><!-- 8 bars, corrected --></score-partwise>', 'score-1.musicxml')
  const page1 = files.paths().filter((p) => p.startsWith('pieces/piece-1/pages/1/')).map((p) => [p, files.text(p)])
  const before = await library.info('piece-1')
  assert.equal(before.score, 'score-2.musicxml')

  const info = await library.addPages('piece-1', secondPage(), before.score)
  assert.deepEqual(info, {
    ...before,
    score: 'score-3.musicxml',
    pages: [before.pages[0]!, { n: 2, firstBar: 9, lastBar: 14, staves: [{ box: { x: 0.03, y: 0.15, width: 0.94, height: 0.3 }, firstBar: 9, lastBar: 14 }] }],
    repairs: [...before.repairs, { bar: '12', message: 'Filled the bar with a rest' }],
    bars: 14,
  })
  assert.deepEqual(await restart().load('piece-1'), { info, musicxml: '<score-partwise><!-- 14 bars --></score-partwise>' })
  assert.deepEqual(files.paths().filter((p) => p.startsWith('pieces/')), [
    'pieces/piece-1/pages/1/recognised.musicxml',
    'pieces/piece-1/pages/1/source.jpg',
    'pieces/piece-1/pages/2/recognised.musicxml',
    'pieces/piece-1/pages/2/source.jpg',
    'pieces/piece-1/piece.json',
    'pieces/piece-1/score-3.musicxml',
  ])
  assert.deepEqual([...files.bytes('pieces/piece-1/pages/2/source.jpg')!], [...PAGE_2])
  assert.equal(files.text('pieces/piece-1/pages/2/recognised.musicxml'), '<score-partwise><!-- raw 2 --></score-partwise>')
  assert.deepEqual(files.paths().filter((p) => p.startsWith('pieces/piece-1/pages/1/')).map((p) => [p, files.text(p)]), page1)
  assert.equal(await library.pageImageUrl('piece-1', 2), 'fake://image/pieces/piece-1/pages/2/source.jpg')

  // and again: page 3 is numbered after page 2
  const third = await library.addPages('piece-1', secondPage({ bars: 16, repairs: [], pages: [{ ...secondPage().pages[0]!, firstBar: 15, lastBar: 16, staves: [] }] }), info.score)
  assert.deepEqual(third.pages.map((p) => [p.n, p.firstBar, p.lastBar]), [[1, 1, 8], [2, 9, 14], [3, 15, 16]])
  assert.equal(third.score, 'score-4.musicxml')
})

test('addPages: pages that do not continue from the last bar are refused, and nothing is written', async () => {
  const { files, library } = setup()
  await library.create(onePage(files))
  const before = files.paths().map((p) => [p, files.text(p)])
  const added = (firstBar: number, lastBar: number): NewPage[] => [{ ...secondPage().pages[0]!, firstBar, lastBar, staves: [] }]
  const cases: Array<[string, Partial<NewPages>]> = [
    ['a gap after the last bar', { pages: added(10, 14) }],
    ['an overlap with the last bar', { pages: added(8, 14) }],
    ['the new pages stop before the last bar', { bars: 15 }],
    ['no more bars than before', { bars: 8, pages: added(9, 8) }],
    ['no pages', { pages: [] }],
    ['no score', { musicxml: '' }],
    ['a page without a photo', { pages: [{ ...added(9, 14)[0]!, source: '' }] }],
  ]
  for (const [what, overrides] of cases) {
    const error = await library.addPages('piece-1', secondPage(overrides), 'score-1.musicxml').catch((e: unknown) => e)
    assert.ok(error instanceof LibraryError && error.code === 'invalid', `${what}: ${String(error)}`)
  }
  assert.equal(await codeOf(library.addPages('piece-9', secondPage(), 'score-1.musicxml')), 'not-found')
  assert.deepEqual(files.paths().map((p) => [p, files.text(p)]), before)
})

test('addPages: a failure the store can see removes what it wrote; a later add replaces what a crash left in the page folder', async () => {
  const { files, library } = setup()
  await library.create(onePage(files))
  const before = files.paths().map((p) => [p, files.text(p)])
  failWhen(files, ['rename'], (paths) => paths[1] === 'pieces/piece-1/piece.json')
  await assert.rejects(library.addPages('piece-1', secondPage(), 'score-1.musicxml'), /disk full/)
  files.fault = undefined
  assert.deepEqual(files.paths().map((p) => [p, files.text(p)]), before, 'the new page folder and score file are removed again')

  // a crash that left a page folder with something else in it
  files.seed('pieces/piece-1/pages/2/source.jpg', PAGE_1)
  files.seed('pieces/piece-1/pages/2/left-over.txt', 'x')
  await library.addPages('piece-1', secondPage(), 'score-1.musicxml')
  assert.deepEqual(files.paths().filter((p) => p.startsWith('pieces/piece-1/pages/2/')), ['pieces/piece-1/pages/2/recognised.musicxml', 'pieces/piece-1/pages/2/source.jpg'])
  assert.deepEqual([...files.bytes('pieces/piece-1/pages/2/source.jpg')!], [...PAGE_2])
})

test('addPages: pages appended to a score that was replaced since are a conflict, and nothing is written', async () => {
  const { files, library } = setup()
  await library.create(onePage(files))
  await library.writeScore('piece-1', '<score-partwise><!-- corrected --></score-partwise>', 'score-1.musicxml')
  const before = files.paths().map((p) => [p, files.text(p)])
  const error = await library.addPages('piece-1', secondPage(), 'score-1.musicxml').catch((e: unknown) => e)
  assert.ok(error instanceof LibraryError && error.code === 'conflict', String(error))
  // a stale caller learns of the conflict even when its pages are also wrong
  assert.equal(await codeOf(library.addPages('piece-1', secondPage({ pages: [] }), 'score-1.musicxml')), 'conflict')
  assert.deepEqual(files.paths().map((p) => [p, files.text(p)]), before)
  assert.equal((await library.addPages('piece-1', secondPage(), 'score-2.musicxml')).bars, 14)
})

// ---- a change cut off at every step --------------------------------------------------------

type Setup = ReturnType<typeof setup>

const unexpected = (message: string): never => {
  throw new Error(message)
}

/** The files under `pieces/`, with their content. */
const snapshot = (files: FakeFiles): Array<[string, string]> =>
  files.paths().filter((p) => p.startsWith('pieces/')).map((p) => [p, [...files.bytes(p)!].join(',')])

/**
 * Runs [change] on the piece [arrange] made once cleanly, recording its port operations. Then, for
 * every k, runs it again where operation k and every one after it fails, as when the process dies
 * there: nothing after it reaches the disk, not even the clean-up. After each crash a restart must
 * load exactly the old piece or the new one, and after the sweep the piece folder must hold
 * exactly the files of the old or of the new piece. When operation k is the rename of piece.json,
 * it also runs the crash of a rename that deleted the target first (Capacitor's rename on
 * Android): the folder is skipped by the list, and the sweep promotes the temp file.
 */
async function crashAtEveryStep(arrange: (s: Setup) => Promise<void>, change: (library: Library) => Promise<unknown>): Promise<Record<'old' | 'new' | 'deletedFirst', number>> {
  const clean = setup()
  await arrange(clean)
  const old = { piece: await clean.library.load('piece-1'), files: snapshot(clean.files) }
  const operations: Array<[FileOperation, string[]]> = []
  clean.files.fault = (operation, paths) => {
    operations.push([operation, paths])
  }
  await change(clean.library)
  clean.files.fault = undefined
  const fresh = { piece: await clean.library.load('piece-1'), files: snapshot(clean.files) }
  assert.notDeepEqual(fresh.piece, old.piece)

  const outcomes = { old: 0, new: 0, deletedFirst: 0 }
  const which = (piece: Piece, where: string): typeof old =>
    isDeepStrictEqual(piece, old.piece) ? old : isDeepStrictEqual(piece, fresh.piece) ? fresh : unexpected(`${where}: neither the old nor the new piece`)
  for (let k = 0; k < operations.length; k++) {
    const [operation, paths] = operations[k]!
    const variants = operation === 'rename' && paths[1] === 'pieces/piece-1/piece.json' ? [false, true] : [false]
    for (const deletedFirst of variants) {
      const where = `crash at operation ${k} (${operation} ${paths.join(' -> ')})${deletedFirst ? ', target deleted first' : ''}`
      const s = setup()
      await arrange(s)
      let count = 0
      s.files.fault = () => {
        if (count++ >= k) throw new Error('process died')
      }
      await change(s.library).catch(() => undefined)
      s.files.fault = undefined
      if (deletedFirst) await s.files.remove('pieces/piece-1/piece.json')

      const after = s.restart()
      let expected: typeof old
      if (deletedFirst) {
        assert.deepEqual(await after.list(), { pieces: [], problems: [] }, `${where}: skipped by the list before the sweep`)
        expected = fresh
        outcomes.deletedFirst++
      } else {
        expected = which(await after.load('piece-1'), where)
        outcomes[expected === old ? 'old' : 'new']++
      }
      await after.sweep()
      assert.deepEqual(await after.load('piece-1'), expected.piece, `${where}: after the sweep`)
      assert.deepEqual(snapshot(s.files), expected.files, `${where}: exactly the files of that piece after the sweep`)
    }
  }
  return outcomes
}

test('crash at every step: writeScore leaves the old piece or the new one, and the sweep leaves exactly its files', async () => {
  const outcomes = await crashAtEveryStep(
    async ({ files, library }) => {
      await library.create(twoPages(files))
    },
    (library) => library.writeScore('piece-1', '<score-partwise><!-- corrected --></score-partwise>', 'score-1.musicxml'),
  )
  // read piece.json, write and rename the new score's temp, write and rename piece.json's (the
  // commit), remove the old score: only the crash at that last step comes after the commit
  assert.deepEqual(outcomes, { old: 5, new: 1, deletedFirst: 1 })
})

test('crash at every step: addPages leaves the old piece or the new one, and the sweep leaves exactly its files', async () => {
  const outcomes = await crashAtEveryStep(
    async ({ files, library }) => {
      await library.create(onePage(files))
      await library.writePractice('piece-1', { ...DEFAULT_PRACTICE, bar: 4 })
    },
    (library) => library.addPages('piece-1', secondPage(), 'score-1.musicxml'),
  )
  assert.ok(outcomes.old >= 8 && outcomes.new === 1 && outcomes.deletedFirst === 1, JSON.stringify(outcomes))
})

test('crash at every step: update of piece.json leaves the old info or the new one', async () => {
  const outcomes = await crashAtEveryStep(
    async ({ files, library }) => {
      await library.create(twoPages(files))
    },
    (library) => library.update('piece-1', { name: 'Renamed', favorite: true }),
  )
  // the rename is the last step: only a target deleted before it gives the new info
  assert.deepEqual(outcomes, { old: 3, new: 0, deletedFirst: 1 })
})

// ---- delete, sweep, photos -----------------------------------------------------------------

test('remove: the piece, its photos and practice state are gone and the others stay', async () => {
  const { files, library } = setup()
  await library.create(twoPages(files, { name: 'One' }))
  await library.create(twoPages(files, { name: 'Two' }))
  await library.writePractice('piece-1', DEFAULT_PRACTICE)
  const second = files.paths().filter((p) => p.startsWith('pieces/piece-2/'))
  await library.remove('piece-1')
  assert.deepEqual((await library.list()).pieces.map((p) => p.name), ['Two'])
  assert.deepEqual(files.paths().filter((p) => p.startsWith('pieces/')), second)
  assert.equal(await codeOf(library.load('piece-1')), 'not-found')
  await library.remove('piece-1') // nothing to remove is not an error
  await library.remove('piece-5')
  assert.equal((await library.list()).pieces.length, 1)
})

test('remove: cut off after the piece left the library, it is gone and the next sweep finishes the job', async () => {
  const { files, library, restart } = setup()
  await library.create(twoPages(files))
  let removes = 0
  files.fault = (operation, paths) => {
    // the first remove clears a stale folder, the second is the delete itself
    if (operation === 'remove' && paths[0] === 'pieces/.tmp-piece-1' && ++removes === 2) throw new Error('process died')
  }
  await assert.rejects(library.remove('piece-1'), /process died/)
  files.fault = undefined
  assert.deepEqual((await restart().list()).pieces, [])
  assert.ok(files.paths().some((p) => p.startsWith('pieces/.tmp-piece-1/')), 'the hidden folder is still there')
  assert.deepEqual(await restart().sweep(), { removed: ['pieces/.tmp-piece-1'], restored: [] })
  assert.deepEqual(files.paths().filter((p) => p.startsWith('pieces/')), [])
})

test('sweep: removes hidden entries, settles temp files, removes what piece.json does not name, and nothing else', async () => {
  const { files, library, restart } = setup()
  await library.create(twoPages(files, { name: 'One' }))
  await library.create(twoPages(files, { name: 'Two' }))
  // hidden entries of pieces/: a piece being built or deleted, and anything else hidden (design D4)
  files.seed('pieces/.tmp-piece-8/piece.json', '{}')
  files.seed('pieces/.tmp-piece-8/pages/1/source.jpg', PAGE_1)
  files.seed('pieces/.old-thing', 'x')
  // temp files next to their target: removed, whole or not
  files.seed('pieces/piece-1/piece.json.tmp-k3j9x', '{"half"')
  files.seed('pieces/piece-2/piece.json.tmp-whole', '{"whole": true}')
  // temp files whose target is missing: removed when they are not whole ...
  files.seed('pieces/piece-2/current.musicxml.tmp-abc', '<half')
  files.seed('pieces/piece-2/practice.json.tmp-', '{')
  files.seed('pieces/piece-2/notes.txt.tmp-1', 'no way to tell')
  // ... and promoted when they are
  files.seed('pieces/piece-1/practice.json.tmp-0', JSON.stringify({ ...DEFAULT_PRACTICE, bar: 5 }))
  // what a cut-off change left: a score file and a page folder piece.json does not name
  files.seed('pieces/piece-1/score-7.musicxml', '<score-partwise/>')
  files.seed('pieces/piece-1/pages/3/source.jpg', PAGE_1)
  // not the sweep's: other files, a damaged piece with the same kind of leftovers, scans, settings
  files.seed('pieces/piece-1/pages/notes.txt', 'mine')
  files.seed('pieces/readme.txt', 'mine')
  files.seed('pieces/damaged/piece.json', '{nope')
  files.seed('pieces/damaged/score-9.musicxml', '<score-partwise/>')
  files.seed('pieces/damaged/pages/5/source.jpg', PAGE_1)
  files.seed('scans/4/page-1.jpg', PAGE_1)
  files.seed('settings.json.tmp-zz', '{')
  const before = files.paths().filter((p) => !/\.tmp-|\/\.old-|piece-1\/score-7|piece-1\/pages\/3\//.test(p))
  const report = await restart().sweep()
  assert.deepEqual(report.removed.sort(), [
    'pieces/.old-thing',
    'pieces/.tmp-piece-8',
    'pieces/piece-1/pages/3',
    'pieces/piece-1/piece.json.tmp-k3j9x',
    'pieces/piece-1/score-7.musicxml',
    'pieces/piece-2/current.musicxml.tmp-abc',
    'pieces/piece-2/notes.txt.tmp-1',
    'pieces/piece-2/piece.json.tmp-whole',
    'pieces/piece-2/practice.json.tmp-',
  ])
  assert.deepEqual(report.restored, ['pieces/piece-1/practice.json'])
  assert.deepEqual(files.paths(), [...before, 'pieces/piece-1/practice.json', 'settings.json.tmp-zz'].sort(), 'the pieces, the damaged folder, other files and scans/ stay; settings sweeps its own')
  assert.equal((await library.readPractice('piece-1'))!.bar, 5)
  assert.deepEqual((await restart().list()).pieces.map((p) => p.name).sort(), ['One', 'Two'])
  assert.deepEqual(await restart().sweep(), { removed: [], restored: [] }, 'a clean library has nothing to sweep')
})

test('sweep: no leftovers are removed in a piece whose own score file or page folder is missing', async () => {
  const { files, library } = setup()
  await library.create(twoPages(files))
  files.seed('pieces/piece-1/score-7.musicxml', '<score-partwise/>')
  files.seed('pieces/piece-1/pages/3/source.jpg', PAGE_1)
  await files.remove('pieces/piece-1/score-1.musicxml')
  assert.deepEqual(await library.sweep(), { removed: [], restored: [] }, 'piece.json names a score that is not there')
  files.seed('pieces/piece-1/score-1.musicxml', '<score-partwise/>')
  await files.remove('pieces/piece-1/pages/2')
  assert.deepEqual(await library.sweep(), { removed: [], restored: [] }, 'piece.json names a page that is not there')
  assert.ok(files.paths().includes('pieces/piece-1/score-7.musicxml'))
})

test('sweep: a lone temp file is promoted when its target is missing (a rename that deleted the target first), and the piece loads', async () => {
  const { files, library, restart } = setup()
  await library.create(twoPages(files))
  // Capacitor's rename on Android deletes the target, then renames; a crash in between leaves the
  // temp file holding the only copy of piece.json
  failWhen(files, ['rename', 'remove'], (paths) => paths.some((p) => p.startsWith('pieces/piece-1/piece.json')), 'process died')
  await assert.rejects(library.update('piece-1', { name: 'New name', favorite: true }), /process died/)
  files.fault = undefined
  await files.remove('pieces/piece-1/piece.json')
  const [temp] = strayTemps(files)
  assert.match(temp!, /^pieces\/piece-1\/piece\.json\.tmp-/)

  const after = restart()
  assert.deepEqual(await after.list(), { pieces: [], problems: [] }, 'before the sweep the folder is skipped, not reported as damaged')
  assert.deepEqual(await after.sweep(), { removed: [], restored: ['pieces/piece-1/piece.json'] })
  const piece = await after.load('piece-1')
  assert.deepEqual([piece.info.name, piece.info.favorite], ['New name', true], 'the write that was cut off is the one that stays')
  assert.equal(piece.musicxml, '<score-partwise><!-- current --></score-partwise>')
  assert.deepEqual(strayTemps(files), [])
})

test('sweep: of several temp files of a missing target, the newest whole one is promoted and the rest removed', async () => {
  const { files, library } = setup()
  await library.create(twoPages(files))
  const info = JSON.parse(files.text('pieces/piece-1/piece.json')!)
  await files.remove('pieces/piece-1/piece.json')
  // the random part sorts the other way round: the time decides
  const name = (ms: number, random: string): string => `pieces/piece-1/piece.json.tmp-${tempSuffix(T0 + ms).slice(0, 9)}-${random}`
  const [older, newer, newest] = [name(1000, 'zzzzzzzz'), name(2000, 'yyyyyyyy'), name(3000, 'xxxxxxxx')]
  files.seed(older, JSON.stringify({ ...info, name: 'Older' }))
  files.seed(newer, JSON.stringify({ ...info, name: 'Newer' }))
  files.seed(newest, '{"cut off')
  const report = await library.sweep()
  assert.deepEqual(report.restored, ['pieces/piece-1/piece.json'])
  assert.deepEqual(report.removed.sort(), [older, newest].sort())
  assert.equal((await library.info('piece-1')).name, 'Newer')
  assert.deepEqual(strayTemps(files), [])
})

test('sweep: a temp whose suffix is not of the known format counts as oldest, and a temp of a temp is never promoted', async () => {
  const { files, library } = setup()
  await library.create(twoPages(files))
  const info = JSON.parse(files.text('pieces/piece-1/piece.json')!)
  await files.remove('pieces/piece-1/piece.json')
  const timed = `pieces/piece-1/piece.json.tmp-${tempSuffix(T0)}`
  const crafted = 'pieces/piece-1/piece.json.tmp-zzzzzzzzzzzzzzzz' // sorts after every timed suffix by name
  const tempOfTemp = `pieces/piece-1/piece.json.tmp-x.tmp-${tempSuffix(T0 + 1000)}`
  files.seed(timed, JSON.stringify({ ...info, name: 'Timed' }))
  files.seed(crafted, JSON.stringify({ ...info, name: 'Crafted' }))
  files.seed(tempOfTemp, JSON.stringify({ ...info, name: 'Temp of a temp' }))
  const report = await library.sweep()
  assert.deepEqual(report.restored, ['pieces/piece-1/piece.json'])
  assert.deepEqual(report.removed.sort(), [crafted, tempOfTemp].sort())
  assert.equal((await library.info('piece-1')).name, 'Timed')
  assert.ok(!files.paths().includes('pieces/piece-1/piece.json.tmp-x'), 'the temp of a temp was not promoted')
})

test('sweep: a lone temp of the score piece.json names is promoted when it parses; one that does not is removed', async () => {
  const { files, library } = setup()
  await library.create(twoPages(files))
  await files.remove('pieces/piece-1/score-1.musicxml')
  files.seed('pieces/piece-1/score-1.musicxml.tmp-b', '<score-partwise><measure')
  files.seed('pieces/piece-1/score-1.musicxml.tmp-a', '<score-partwise><!-- kept --></score-partwise>')
  const report = await library.sweep()
  assert.deepEqual(report, { removed: ['pieces/piece-1/score-1.musicxml.tmp-b'], restored: ['pieces/piece-1/score-1.musicxml'] })
  assert.equal((await library.load('piece-1')).musicxml, '<score-partwise><!-- kept --></score-partwise>')
})

test('sweep: a stray that cannot be removed is left for the next start and does not stop the rest', async () => {
  const { files, library } = setup()
  files.seed('pieces/.tmp-a/x', 'x')
  files.seed('pieces/.tmp-b/x', 'x')
  failWhen(files, ['remove'], (paths) => paths[0] === 'pieces/.tmp-a')
  assert.deepEqual((await library.sweep()).removed, ['pieces/.tmp-b'])
  files.fault = undefined
  assert.deepEqual((await library.sweep()).removed, ['pieces/.tmp-a'])
})

test('sweep: on a library that does not exist yet, nothing happens', async () => {
  const { files, library } = setup()
  assert.deepEqual(await library.sweep(), { removed: [], restored: [] })
  assert.deepEqual(files.paths(), [])
})

test('pageImageUrl: the photo of a page by its number', async () => {
  const { files, library } = setup()
  await library.create(twoPages(files))
  assert.equal(await library.pageImageUrl('piece-1', 2), 'fake://image/pieces/piece-1/pages/2/source.jpg')
  assert.equal(await codeOf(library.pageImageUrl('piece-1', 3)), 'not-found')
  assert.equal(await codeOf(library.pageImageUrl('piece-1', 0)), 'invalid')
})
