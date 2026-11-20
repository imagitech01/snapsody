import assert from 'node:assert/strict'
import { test } from 'node:test'
import { effect } from '@preact/signals'
import { continuePieceOf, createHome } from '../src/app/home.ts'
import { createI18n } from '../src/app/i18n/index.ts'
import { DEFAULT_PRACTICE, createLibrary } from '../src/app/library.ts'
import type { Library, LibraryListing, PieceInfo, PracticeState } from '../src/app/library.ts'
import { createLibraryView } from '../src/app/libraryView.ts'
import { loadSettings } from '../src/app/settings.ts'
import { createFakePlatform } from '../src/platform/fake/index.ts'
import { n, scoreXml } from './playbackHelpers.ts'

// The start screen and the library as derived signals (practice-app task 9.4, design D11, specs
// `practice-home` and `piece-library`): the continue piece, the rotation, first launch, the summary
// line, and the refresh after a star, a rename, a delete and a new piece. Pieces are made through
// `library.create`; "now" is 18 November 2026, 14:05 local time.

const NOW = new Date(2026, 10, 18, 14, 5)
const local = (...parts: [number, number, number, number?, number?]): string => new Date(...parts).toISOString()
const HOUR = 3_600_000

/** A piece's score with a Moderato marking (a tempo of 108 for its beat), so a tempo that was never chosen has something to show. */
const MODERATO = '<direction placement="above"><direction-type><words>Moderato</words></direction-type></direction>'
const SCORE = scoreXml([{ body: n({ step: 'C', type: 'whole' }) }, { body: n({ step: 'D', type: 'whole' }) }], [4, 4], MODERATO)

async function setup() {
  const { files } = createFakePlatform()
  files.seed('scans/1/page-1.jpg', Uint8Array.of(0xff, 0xd8))
  files.seed('scans/1/page-2.jpg', Uint8Array.of(0xff, 0xd9))
  let counter = 0
  let clock = new Date(2026, 10, 10, 9, 0).getTime()
  const library = createLibrary(files, { newId: () => `piece-${++counter}`, now: () => new Date(clock) })
  const settings = await loadSettings(files)
  const i18n = createI18n()
  const view = createLibraryView({ library, i18n, now: () => NOW })
  const home = createHome({ view, library, i18n })

  /** Adds a piece; each one is added an hour after the one before. */
  const add = async (name: string, options: { bars?: number; pages?: 1 | 2; musicxml?: string } = {}): Promise<PieceInfo> => {
    clock += HOUR
    const bars = options.bars ?? 8
    const pages =
      options.pages === 2
        ? [
            { source: 'scans/1/page-1.jpg', recognised: '<score-partwise/>', firstBar: 1, lastBar: bars / 2 },
            { source: 'scans/1/page-2.jpg', recognised: '<score-partwise/>', firstBar: bars / 2 + 1, lastBar: bars },
          ]
        : [{ source: 'scans/1/page-1.jpg', recognised: '<score-partwise/>', firstBar: 1, lastBar: bars }]
    return library.create({ name, musicxml: options.musicxml ?? SCORE, bars, repairs: [], pages })
  }
  const practise = (id: string, when: string, state?: Partial<PracticeState>): Promise<unknown> =>
    Promise.all([library.update(id, { lastPracticed: when }), state ? library.writePractice(id, { ...DEFAULT_PRACTICE, ...state }) : undefined])
  /** Sets the time the library gives to the pieces added from now on. */
  const clockTo = (date: Date): void => {
    clock = date.getTime()
  }
  return { files, library, settings, i18n, view, home, add, practise, clockTo }
}

// ---- The continue piece -----------------------------------------------------------------------------------

test('continue is the piece practised last, not the one added last (spec "Pick up where you left off")', async () => {
  const s = await setup()
  const ode = await s.add('Ode to Joy')
  const warm = await s.add('C major warm-up')
  s.clockTo(new Date(2026, 10, 18, 12, 0))
  const fresh = await s.add('Even eighths') // added today, never practised: first in the list
  await s.practise(ode.id, local(2026, 10, 17, 9, 0))
  await s.practise(warm.id, local(2026, 10, 16, 9, 0))
  await s.home.refresh()
  assert.equal(s.view.pieces.value[0]!.id, fresh.id, 'the list is by recency of use or adding, so a new piece leads it')
  assert.equal(s.home.continuePiece.value?.id, ode.id)
  assert.equal(s.home.continueCard.value?.piece.name, 'Ode to Joy')

  // Practising the other one makes it the continue piece.
  await s.practise(warm.id, local(2026, 10, 18, 13, 0))
  await s.home.refresh()
  assert.equal(s.home.continuePiece.value?.id, warm.id)
  assert.equal(s.home.continueCard.value?.piece.id, warm.id)
})

test('nothing practised yet: no continue piece and no card (spec "Nothing practised yet")', async () => {
  const s = await setup()
  await s.add('Ode to Joy')
  await s.add('C major warm-up')
  await s.home.refresh()
  assert.equal(s.home.continuePiece.value, undefined)
  assert.equal(s.home.continueCard.value, null)
  assert.equal(s.home.firstLaunch.value, false, 'there are pieces')
})

test('the card shows the bar, the tempo, the metronome and the loop the user left (spec "Pick up where you left off")', async () => {
  const s = await setup()
  const ode = await s.add('Ode to Joy', { bars: 12 })
  await s.practise(ode.id, local(2026, 10, 17, 9, 0), { bar: 2, tempo: 60, metronome: true, loop: { start: 2, end: 4 } })
  await s.home.refresh()
  assert.deepEqual(s.home.continueCard.value, {
    piece: s.view.pieces.value[0],
    bar: 2,
    bars: 12,
    tempo: 60,
    tempoChosen: true,
    metronome: true,
    loop: { start: 2, end: 4 },
  })
})

test('a tempo that was never chosen shows the one the piece opens at: its marking, or 80 when its score cannot be read', async () => {
  const marked = await setup()
  const a = await marked.add('Marked')
  await marked.practise(a.id, local(2026, 10, 17, 9, 0), { bar: 2 })
  await marked.home.refresh()
  assert.equal(marked.home.continueCard.value!.tempo, 108, 'a typical Moderato')
  assert.equal(marked.home.continueCard.value!.tempoChosen, false)
  assert.equal(marked.home.continueCard.value!.metronome, false)
  assert.equal(marked.home.continueCard.value!.loop, null)

  const broken = await setup()
  const b = await broken.add('Odd', { musicxml: '<not-music/>' })
  await broken.practise(b.id, local(2026, 10, 17, 9, 0))
  await broken.home.refresh()
  assert.equal(broken.home.continueCard.value!.tempo, 80)
  assert.equal(broken.home.continueCard.value!.bar, 1, 'a piece with no practice.json is at its first bar')
})

test('the bar on the card is held to the piece, and the card is never another piece\'s settings', async () => {
  const s = await setup()
  const a = await s.add('Short', { bars: 4 })
  const b = await s.add('Other', { bars: 4 })
  await s.practise(a.id, local(2026, 10, 16, 9, 0), { bar: 40, tempo: 70 })
  await s.practise(b.id, local(2026, 10, 17, 9, 0), { bar: 3, tempo: 90 })
  await s.home.refresh()
  assert.equal(s.home.continueCard.value!.piece.id, b.id)
  assert.equal(s.home.continueCard.value!.tempo, 90)
  // The piece that is "continue" changes under the card (it is deleted): the card goes until its settings are read.
  await s.view.remove(b.id)
  assert.equal(s.home.continuePiece.value?.id, a.id)
  assert.equal(s.home.continueCard.value, null, 'not the deleted piece\'s settings')
  await s.home.refresh()
  assert.equal(s.home.continueCard.value!.bar, 4, 'held to its 4 bars')
  assert.equal(s.home.continueCard.value!.tempo, 70)
})

test('continuePieceOf: the latest time wins, the first in the list on a tie, and a time that is not valid never does', () => {
  const piece = (id: string, lastPracticed: string | null): PieceInfo => ({
    format: 2,
    id,
    name: id,
    created: '2026-11-01T00:00:00.000Z',
    lastPracticed,
    favorite: false,
    score: 'score-1.musicxml',
    pages: [],
    repairs: [],
    bars: 4,
  })
  assert.equal(continuePieceOf([]), undefined)
  assert.equal(continuePieceOf([piece('a', null), piece('b', null)]), undefined)
  assert.equal(continuePieceOf([piece('a', null), piece('b', '2026-11-02T00:00:00.000Z'), piece('c', '2026-11-03T00:00:00.000Z')])!.id, 'c')
  assert.equal(continuePieceOf([piece('a', '2026-11-03T00:00:00.000Z'), piece('b', '2026-11-03T00:00:00.000Z')])!.id, 'a', 'a tie: the list\'s order')
  assert.equal(continuePieceOf([piece('a', 'yesterday'), piece('b', '2026-11-02T00:00:00.000Z')])!.id, 'b')
  assert.equal(continuePieceOf([piece('a', 'yesterday')]), undefined)
})

// ---- The rotation and first launch -----------------------------------------------------------------------------

test('the rotation is the favorites, with name and length, in the list\'s order (spec "Play a favorite")', async () => {
  const s = await setup()
  const ode = await s.add('Ode to Joy', { bars: 24, pages: 2 })
  const warm = await s.add('C major warm-up', { bars: 8 })
  await s.add('Even eighths')
  await s.library.update(ode.id, { favorite: true })
  await s.library.update(warm.id, { favorite: true })
  await s.home.refresh()
  assert.deepEqual(s.home.rotation.value.map((row) => [row.info.name, row.length]), [['C major warm-up', '8 bars'], ['Ode to Joy', '24 bars']], 'the later one first')
  assert.equal(s.home.rotationEmpty.value, false)
  assert.equal(s.home.rotation.value.length, 2)
  assert.deepEqual(s.view.favorites.value, s.home.rotation.value, 'the favorites list is the same list')
})

test('no favorites: the rotation explains that starring adds one; no pieces: first launch, no empty lists (specs "No favorites", "Empty app")', async () => {
  const s = await setup()
  assert.equal(s.home.firstLaunch.value, false, 'not before the list has been read')
  assert.equal(s.home.rotationEmpty.value, false)
  await s.home.refresh()
  assert.equal(s.home.firstLaunch.value, true, 'no pieces: invite the user to add music')
  assert.equal(s.home.rotationEmpty.value, false, 'and no "no favorites" message on top of it')
  assert.equal(s.home.continueCard.value, null)
  assert.deepEqual(s.home.rotation.value, [])

  await s.add('Ode to Joy')
  await s.home.refresh()
  assert.equal(s.home.firstLaunch.value, false)
  assert.equal(s.home.rotationEmpty.value, true, 'pieces, none starred')
})

// ---- Refreshing after a change ------------------------------------------------------------------------------------

test('a star reaches the rotation and the favorites list at once, and unstarring takes it out again (specs "Star a piece", "Unstar from the favorites list")', async () => {
  const s = await setup()
  const even = await s.add('Even eighths')
  await s.add('Ode to Joy')
  await s.home.refresh()
  assert.deepEqual(s.home.rotation.value, [])
  const rotations: string[][] = []
  const stop = effect(() => {
    rotations.push(s.home.rotation.value.map((r) => r.info.name))
  })

  await s.view.toggleFavorite(even.id)
  assert.deepEqual(s.home.rotation.value.map((r) => r.info.name), ['Even eighths'])
  assert.equal(s.view.visible.value.find((r) => r.info.id === even.id)!.info.favorite, true, 'the star is filled in the library')
  assert.equal(s.view.pieces.value.length, 2)

  await s.view.toggleFavorite(even.id)
  assert.deepEqual(s.home.rotation.value, [])
  assert.equal(s.view.visible.value.length, 2, 'it stays in the library')
  assert.equal((await s.library.info(even.id)).favorite, false, 'and the file says so')
  stop()
  assert.deepEqual(rotations, [[], ['Even eighths'], []])

  await s.view.toggleFavorite('no-such-piece') // a piece that is not in the list: nothing happens
  await s.view.setFavorite(even.id, true)
  assert.equal(s.home.rotation.value.length, 1)
})

test('a rename shows in every list and on the card (spec "Rename in the editor"); an empty name is refused and nothing changes', async () => {
  const s = await setup()
  const piece = await s.add('18 Nov, 14:05')
  await s.practise(piece.id, local(2026, 10, 17, 9, 0), { bar: 2 })
  await s.library.update(piece.id, { favorite: true })
  await s.home.refresh()
  await s.view.rename(piece.id, '  Ode to Joy ')
  assert.equal(s.view.visible.value[0]!.info.name, 'Ode to Joy', 'trimmed')
  assert.equal(s.home.rotation.value[0]!.info.name, 'Ode to Joy')
  assert.equal(s.home.continueCard.value!.piece.name, 'Ode to Joy')

  await assert.rejects(s.view.rename(piece.id, '   '))
  assert.equal(s.view.visible.value[0]!.info.name, 'Ode to Joy')
  assert.equal((await s.library.info(piece.id)).name, 'Ode to Joy')
})

test('a delete takes the piece out of the library, the rotation and the continue card (spec "Delete with confirmation")', async () => {
  const s = await setup()
  const ode = await s.add('Ode to Joy')
  const warm = await s.add('C major warm-up')
  await s.library.update(ode.id, { favorite: true })
  await s.practise(ode.id, local(2026, 10, 17, 9, 0), { bar: 2 })
  await s.practise(warm.id, local(2026, 10, 16, 9, 0), { bar: 3 })
  await s.home.refresh()
  assert.equal(s.home.continueCard.value!.piece.id, ode.id)

  await s.view.remove(ode.id)
  assert.deepEqual(s.view.visible.value.map((r) => r.info.id), [warm.id])
  assert.deepEqual(s.home.rotation.value, [])
  assert.equal(s.home.continuePiece.value?.id, warm.id, 'the continue card moves to the next piece practised')
  await assert.rejects(s.library.info(ode.id), /no piece/)

  await s.view.remove(ode.id) // already gone: nothing happens, nothing throws
  await s.view.remove(warm.id)
  assert.equal(s.view.isEmpty.value, true)
  assert.equal(s.home.firstLaunch.value, true)
  assert.equal(s.home.continuePiece.value, undefined)
})

test('a new piece is in the lists after a refresh, and not before: whoever adds it refreshes', async () => {
  const s = await setup()
  await s.home.refresh()
  assert.equal(s.home.firstLaunch.value, true)
  const made = await s.add('Scanned yesterday')
  assert.equal(s.view.pieces.value.length, 0, 'the store reads the library when it is told to')
  await s.view.refresh()
  assert.deepEqual(s.view.pieces.value.map((p) => p.id), [made.id])
  assert.equal(s.home.firstLaunch.value, false)
})

test('a failing change still refreshes, and rejects with its own error', async () => {
  const s = await setup()
  const piece = await s.add('Ode to Joy')
  await s.view.refresh()
  await s.library.remove(piece.id) // gone behind the store's back
  await assert.rejects(s.view.setFavorite(piece.id, true), /no piece/)
  assert.deepEqual(s.view.pieces.value, [], 'the list is up to date again')
})

test('a read that finishes late does not overwrite a newer one', async () => {
  const s = await setup()
  await s.add('Old')
  const first = await s.library.list()
  await s.add('New')
  const second = await s.library.list()
  const waiting: Array<(listing: LibraryListing) => void> = []
  const slow = { ...s.library, list: () => new Promise<LibraryListing>((resolve) => waiting.push(resolve)), update: s.library.update.bind(s.library), remove: s.library.remove.bind(s.library) } as Pick<Library, 'list' | 'update' | 'remove'>
  const view = createLibraryView({ library: slow, i18n: s.i18n, now: () => NOW })
  const early = view.refresh()
  const late = view.refresh()
  waiting[1]!(second) // the newer read comes back first
  await late
  assert.equal(view.pieces.value.length, 2)
  waiting[0]!(first) // and the older one after it
  await early
  assert.equal(view.pieces.value.length, 2, 'the older read is dropped')
  assert.ok(view.loaded.value)
})

test('a list that cannot be read rejects and leaves what the screens show as it was', async () => {
  const s = await setup()
  await s.add('Ode to Joy')
  await s.view.refresh()
  const broken = createLibraryView({ library: { ...s.library, list: () => Promise.reject(new Error('disk')), update: s.library.update.bind(s.library), remove: s.library.remove.bind(s.library) } as Pick<Library, 'list' | 'update' | 'remove'>, i18n: s.i18n })
  await assert.rejects(broken.refresh(), /disk/)
  assert.equal(broken.loaded.value, false, 'still nothing to show, and no invitation either')
  assert.equal(broken.isEmpty.value, false)
  assert.equal(s.view.pieces.value.length, 1)
})

// ---- The summary line ---------------------------------------------------------------------------------------------

test('the summary line: pages (above one), bars, and when it was practised or added (spec "Summary line")', async () => {
  const s = await setup()
  const ode = await s.add('Ode to Joy', { bars: 24, pages: 2 })
  await s.add('Even eighths', { bars: 8 })
  await s.practise(ode.id, local(2026, 10, 17, 9, 0))
  await s.home.refresh()
  const rows = new Map(s.view.rows.value.map((row) => [row.info.name, row]))
  assert.equal(rows.get('Ode to Joy')!.summary, '2 pages · 24 bars · Practised yesterday')
  assert.equal(rows.get('Even eighths')!.summary, '8 bars · Added last week', 'one page: no pages, and never practised: when it was added')
  assert.equal(rows.get('Ode to Joy')!.length, '24 bars')
})
