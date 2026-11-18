import assert from 'node:assert/strict'
import { test } from 'node:test'
import { effect } from '@preact/signals'
import { createI18n } from '../src/app/i18n/index.ts'
import { createLibrary } from '../src/app/library.ts'
import { createLibraryView } from '../src/app/libraryView.ts'
import { loadSettings } from '../src/app/settings.ts'
import { filterByName, matchesSearch, searchKey } from '../src/app/search.ts'
import { createFakePlatform } from '../src/platform/fake/index.ts'

// Searching the library by name (practice-app task 9.4, design D11, spec `piece-library` "Search"):
// the plain form names and search texts are compared in, and the library view's filtered list.

// ---- The plain form --------------------------------------------------------------------------

test('searchKey: lower case, no accents, plain spelling of the special letters, single spaces', () => {
  assert.equal(searchKey('Ode to Joy'), 'ode to joy')
  assert.equal(searchKey('ÖDÉ'), 'ode')
  assert.equal(searchKey('Café au lait'), 'cafe au lait')
  assert.equal(searchKey('Één, twee, drie'), 'een, twee, drie')
  assert.equal(searchKey('Zoë’s Lied'), 'zoe’s lied')
  assert.equal(searchKey('Ørsted'), 'orsted')
  assert.equal(searchKey('Straße'), 'strasse')
  assert.equal(searchKey('Œuvre'), 'oeuvre')
  assert.equal(searchKey('Łódź'), 'lodz')
  assert.equal(searchKey('İstanbul'), 'istanbul', 'a dotted capital I is an i')
  assert.equal(searchKey('ﬁne'), 'fine', 'a ligature is its letters')
  assert.equal(searchKey('  Ode \t to\n Joy  '), 'ode to joy')
  assert.equal(searchKey(''), '')
  assert.equal(searchKey('   '), '')
})

test('searchKey: a name typed with combining accents is the same as one with the precomposed letters', () => {
  const precomposed = 'café'
  const decomposed = 'café'
  assert.notEqual(precomposed, decomposed)
  assert.equal(searchKey(decomposed), searchKey(precomposed))
  assert.equal(searchKey(decomposed), 'cafe')
})

test('searchKey does not depend on the phone: a Turkish dotless i is an i, not a locale lookup', () => {
  assert.equal(searchKey('IJSVOGEL'), 'ijsvogel')
  assert.equal(searchKey('ısı'), 'isi')
})

// ---- Matching -------------------------------------------------------------------------------

test('a name matches when it has the text anywhere in it (spec scenario "Find a piece")', () => {
  assert.ok(matchesSearch('Ode to Joy', 'ode'))
  assert.ok(matchesSearch('Ode to Joy', 'to j'), 'across words')
  assert.ok(matchesSearch('Ode to Joy', 'joy'), 'at the end')
  assert.ok(matchesSearch('Antonio Carlos Jobim', 'carlos'))
  assert.ok(matchesSearch('Ode to Joy', 'y'), 'any part')
  assert.ok(!matchesSearch('Even eighths', 'ode'))
  assert.ok(!matchesSearch('C major warm-up', 'ode'))
  assert.ok(!matchesSearch('Ode to Joy', 'odes'))
})

test('case and accents do not matter, on either side', () => {
  assert.ok(matchesSearch('Ode to Joy', 'ODE'))
  assert.ok(matchesSearch('ODE TO JOY', 'ode'))
  assert.ok(matchesSearch('Café', 'cafe'))
  assert.ok(matchesSearch('Cafe', 'CAFÉ'))
  assert.ok(matchesSearch('Étude no. 3', 'etude'))
  assert.ok(matchesSearch('Étude no. 3', 'ÉTUDE'))
  assert.ok(matchesSearch('Sérénade', 'serenade'))
  assert.ok(matchesSearch('Één voor één', 'een'))
  assert.ok(!matchesSearch('Café', 'cafes'))
})

test('white space in the search text is forgiven; an empty text matches everything', () => {
  assert.ok(matchesSearch('Ode to Joy', ' ode '), 'a space typed after the word')
  assert.ok(matchesSearch('Ode to Joy', 'ode   to'))
  assert.ok(matchesSearch('Ode to Joy', ''))
  assert.ok(matchesSearch('Ode to Joy', '   '))
  assert.ok(matchesSearch('', ''))
  assert.ok(!matchesSearch('', 'a'))
})

test('filterByName keeps the order, and gives back a copy for an empty text', () => {
  const pieces = [{ name: 'Ode to Joy', n: 1 }, { name: 'Even eighths', n: 2 }, { name: 'Bode', n: 3 }, { name: 'ÖDE', n: 4 }]
  assert.deepEqual(filterByName(pieces, 'ode').map((p) => p.n), [1, 3, 4])
  assert.deepEqual(filterByName(pieces, 'zzz'), [])
  const all = filterByName(pieces, '')
  assert.deepEqual(all, pieces)
  assert.notEqual(all, pieces)
})

// ---- The library view's list -----------------------------------------------------------------

async function viewWith(names: string[]) {
  const { files } = createFakePlatform()
  files.seed('scans/1/page-1.jpg', Uint8Array.of(0xff, 0xd8))
  let counter = 0
  let clock = Date.parse('2026-11-10T09:00:00.000Z')
  const library = createLibrary(files, { newId: () => `p${++counter}`, now: () => new Date((clock += 3_600_000)) })
  for (const name of names) {
    await library.create({
      name,
      musicxml: '<score-partwise/>',
      bars: 8,
      repairs: [],
      pages: [{ source: 'scans/1/page-1.jpg', recognised: '<score-partwise/>', firstBar: 1, lastBar: 8 }],
    })
  }
  const settings = await loadSettings(files)
  const view = createLibraryView({ library, i18n: createI18n(settings.language, 'en'), now: () => new Date(2026, 10, 18, 14, 5) })
  await view.refresh()
  return { view, library, settings }
}

test('the library filters while the user types: the list follows the search text, in the same order', async () => {
  const { view } = await viewWith(['Ode to Joy', 'Even eighths', 'C major warm-up', 'Étude no. 3'])
  const names = (): string[] => view.visible.value.map((row) => row.info.name)
  const all = names()
  assert.equal(all.length, 4)
  assert.equal(view.query.value, '')

  const seen: string[][] = []
  const stop = effect(() => {
    seen.push(names())
  })
  view.query.value = 'ode'
  assert.deepEqual(names(), ['Ode to Joy'], '"Ode to Joy" is listed and the others are not')
  view.query.value = 'ETUDE'
  assert.deepEqual(names(), ['Étude no. 3'])
  view.query.value = 'e'
  assert.deepEqual(names(), all.filter((name) => matchesSearch(name, 'e')))
  view.query.value = ''
  assert.deepEqual(names(), all)
  stop()
  assert.equal(seen.length, 5, 'the list is a signal: one run for the start and each change')
})

test('nothing matches: the library says so; with no pieces at all it invites instead', async () => {
  const { view } = await viewWith(['Ode to Joy', 'Even eighths'])
  assert.equal(view.noMatch.value, false)
  view.query.value = 'zzz'
  assert.deepEqual(view.visible.value, [])
  assert.equal(view.noMatch.value, true)
  assert.equal(view.isEmpty.value, false, 'there are pieces, so this is not the empty library')
  view.query.value = 'joy'
  assert.equal(view.noMatch.value, false)

  const empty = await viewWith([])
  empty.view.query.value = 'zzz'
  assert.equal(empty.view.isEmpty.value, true)
  assert.equal(empty.view.noMatch.value, false, 'no pieces: the invitation, not "nothing matches"')
})

test('search does not filter the favorites list, and a rename is found under its new name at once', async () => {
  const { view } = await viewWith(['Ode to Joy', 'Even eighths'])
  const ode = view.pieces.value.find((p) => p.name === 'Ode to Joy')!
  const even = view.pieces.value.find((p) => p.name === 'Even eighths')!
  await view.setFavorite(ode.id, true)
  await view.setFavorite(even.id, true)
  view.query.value = 'ode'
  assert.equal(view.visible.value.length, 1)
  assert.equal(view.favorites.value.length, 2)
  await view.rename(even.id, 'Odes for Ben')
  assert.deepEqual(view.visible.value.map((row) => row.info.name).sort(), ['Ode to Joy', 'Odes for Ben'])
})
