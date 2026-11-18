import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Page } from 'playwright'
import { withApp } from './app.ts'
import { tab, textOf } from './journey.ts'
import { ID } from './pieces.ts'
import { review } from './review.ts'

// The library journey (practice-app design D15, "library: search, star, delete"; task 12.2; specs
// `piece-library` "Library list", "Search", "Favorites", "Delete a piece" and `practice-home`): the
// pieces seeded by `library` (pieces.ts), through the Library tab, the favorites and the home.

/** A piece's row in a list: the button that opens it (its name, then its summary line). */
const row = (page: Page, name: string) => page.getByRole('button', { name: new RegExp(`^${name}\\b`) })

const star = (page: Page, name: string, on: boolean) =>
  page.getByRole('button', { name: on ? `Remove “${name}” from favorites` : `Add “${name}” to favorites` })

/** The names of the rows in the list, top to bottom. */
const names = (page: Page): Promise<string[]> =>
  page.locator('.list-row-title').evaluateAll((titles) => titles.map((title) => title.textContent ?? ''))

test('library: it lists the pieces, the latest practised or added first, each with its summary line', async () => {
  await withApp({ seed: 'library' }, async ({ page }) => {
    await tab(page, 'Library').click()
    await page.getByRole('heading', { name: 'My music', level: 1 }).waitFor()
    assert.deepEqual(await names(page), ['Ode to Joy', 'C major warm-up', 'Even eighths', 'Étude in D'])
    assert.equal(await textOf(row(page, 'Ode to Joy')), 'Ode to Joy 3 pages · 12 bars · Practised today')
    assert.equal(await textOf(row(page, 'C major warm-up')), 'C major warm-up 4 bars · Practised yesterday')
    assert.equal(await textOf(row(page, 'Even eighths')), 'Even eighths 8 bars · Added 6 days ago', 'never practised: when it was added')
    // The star shows who is a favorite.
    await star(page, 'C major warm-up', true).waitFor()
    await star(page, 'Ode to Joy', false).waitFor()
    await review(page, '03.1 · Music library')
  })
})

test('library: search filters the list while typing, ignoring case and accents, and says when nothing matches', async () => {
  await withApp({ seed: 'library' }, async ({ page }) => {
    await tab(page, 'Library').click()
    const field = page.getByRole('searchbox', { name: 'Search your music' })

    await field.fill('ode')
    assert.deepEqual(await names(page), ['Ode to Joy'])
    await field.fill('ODE')
    assert.deepEqual(await names(page), ['Ode to Joy'], 'case is ignored')
    await field.fill('etude')
    assert.deepEqual(await names(page), ['Étude in D'], 'accents are ignored')
    await field.fill('eighths')
    assert.deepEqual(await names(page), ['Even eighths'])

    await field.fill('zzz')
    await page.getByRole('status').filter({ hasText: 'Nothing matches “zzz”.' }).waitFor()
    assert.deepEqual(await names(page), [])

    await page.getByRole('button', { name: 'Clear search' }).click()
    assert.equal(await field.inputValue(), '')
    assert.deepEqual(await names(page), ['Ode to Joy', 'C major warm-up', 'Even eighths', 'Étude in D'])
    assert.equal(await page.getByRole('button', { name: 'Clear search' }).count(), 0)
  })
})

test('library: a star puts a piece in the favorites and the rotation at once, and unstarring takes it out again', async () => {
  await withApp({ seed: 'library' }, async (app) => {
    const { page } = app
    await tab(page, 'Library').click()
    await star(page, 'Even eighths', false).click()
    await star(page, 'Even eighths', true).waitFor()
    assert.match((await app.file(`pieces/${ID.eighths}/piece.json`)) ?? '', /"favorite": true/, 'the star is saved')

    // The favorites list has it, next to the one that was already a favorite.
    await page.getByRole('button', { name: 'Favorites', exact: true }).click()
    await page.getByRole('heading', { name: 'Favorites', level: 1 }).waitFor()
    await page.getByRole('heading', { name: '2 favorites' }).waitFor()
    assert.deepEqual(await names(page), ['C major warm-up', 'Even eighths'])
    assert.equal(await page.getByRole('navigation').count(), 0, 'opened over the library: no tab bar, a Back button instead')

    // So does the rotation on the home.
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await tab(page, 'Practice').click()
    await page.getByRole('button', { name: 'Play “Even eighths”' }).waitFor()
    await page.getByRole('button', { name: 'Play “C major warm-up”' }).waitFor()

    // Unstar from the favorites list: the piece leaves the list and stays in the library.
    await page.getByRole('button', { name: 'See all' }).click()
    await review(page, '03.2 · Favorites')
    await star(page, 'Even eighths', true).click()
    await page.getByRole('heading', { name: '1 favorite' }).waitFor()
    assert.deepEqual(await names(page), ['C major warm-up'])
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await tab(page, 'Library').click()
    assert.equal(await row(page, 'Even eighths').count(), 1, 'still in the library')
    await star(page, 'Even eighths', false).waitFor()
    assert.match((await app.file(`pieces/${ID.eighths}/piece.json`)) ?? '', /"favorite": false/)
  })
})

test('library: with no favorite left, the favorites list explains how to fill it', async () => {
  await withApp({ seed: 'library' }, async ({ page }) => {
    await tab(page, 'Library').click()
    await page.getByRole('button', { name: 'Favorites', exact: true }).click()
    await star(page, 'C major warm-up', true).click()
    await page.getByRole('region', { name: 'No favorites yet' }).waitFor()
    await page.getByText('Star a piece in the library, or while you practise, and it appears here.').waitFor()
  })
})

test('library: delete asks first; cancelling or pressing back removes nothing, confirming removes the piece and its files', async () => {
  await withApp({ seed: 'library' }, async (app) => {
    const { page } = app
    await tab(page, 'Library').click()
    const dialog = page.getByRole('alertdialog', { name: 'Delete this piece?' })

    // Change of mind: Cancel.
    await page.getByRole('button', { name: 'Delete “Even eighths”' }).click()
    await dialog.waitFor()
    assert.match(await textOf(dialog), /“Even eighths”, its photos and its practice settings will be removed from this phone\./)
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await dialog.waitFor({ state: 'detached' })
    assert.equal(await row(page, 'Even eighths').count(), 1)

    // The system back button answers "no" to the question first.
    await page.getByRole('button', { name: 'Delete “Even eighths”' }).click()
    await dialog.waitFor()
    assert.equal(await app.back(), true)
    await dialog.waitFor({ state: 'detached' })
    assert.equal(await row(page, 'Even eighths').count(), 1)
    assert.ok((await app.filePaths()).some((path) => path.startsWith(`pieces/${ID.eighths}/`)), 'nothing was removed')

    // Confirm: the piece is gone from the list, and its files from the phone.
    await page.getByRole('button', { name: 'Delete “Even eighths”' }).click()
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click()
    await dialog.waitFor({ state: 'detached' })
    await row(page, 'Even eighths').waitFor({ state: 'detached' })
    assert.deepEqual(await names(page), ['Ode to Joy', 'C major warm-up', 'Étude in D'])
    assert.deepEqual((await app.filePaths()).filter((path) => path.startsWith(`pieces/${ID.eighths}`)), [], 'its files are removed')
  })
})

test('library: deleting the piece that was being practised takes it out of the continue card and the rotation', async () => {
  await withApp({ seed: 'library' }, async ({ page }) => {
    await tab(page, 'Library').click()
    await page.getByRole('button', { name: 'Delete “Ode to Joy”' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click()
    await row(page, 'Ode to Joy').waitFor({ state: 'detached' })

    await tab(page, 'Practice').click()
    // The piece practised before it is the one to continue now.
    const card = page.getByRole('region', { name: 'Continue practising' })
    await card.getByRole('heading', { name: 'C major warm-up' }).waitFor()
    assert.equal(await page.getByText('Ode to Joy').count(), 0)

    // Deleting the favorite leaves the rotation empty.
    await tab(page, 'Library').click()
    await page.getByRole('button', { name: 'Delete “C major warm-up”' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click()
    await tab(page, 'Practice').click()
    assert.equal(await page.getByRole('region', { name: 'Continue practising' }).count(), 0, 'nothing practised is left')
    await page.getByText('Star a piece and it appears here.').waitFor()
  })
})

test('library: pressing a piece opens it for practice', async () => {
  await withApp({ seed: 'library' }, async (app) => {
    await tab(app.page, 'Library').click()
    await row(app.page, 'Étude in D').click()
    assert.deepEqual(await app.screen(), { name: 'practice', pieceId: ID.etude })
  })
})

test('library: with no pieces it invites the user to add music instead of showing an empty list', async () => {
  await withApp({ seed: '' }, async (app) => {
    const { page } = app
    await tab(page, 'Library').click()
    const invitation = page.getByRole('region', { name: 'No music yet' })
    await invitation.waitFor()
    assert.match(await textOf(invitation), /Add music to start practising\./)
    assert.equal(await page.getByRole('searchbox').count(), 0, 'no search over nothing')
    await invitation.getByRole('button', { name: 'Add music' }).click()
    assert.deepEqual(await app.screen(), { name: 'add-music' })
  })
})

test('library: "Add music" at the foot of the list starts adding music', async () => {
  await withApp({ seed: 'library' }, async (app) => {
    await tab(app.page, 'Library').click()
    await app.page.getByText('Scan full pages or just the part you need.').waitFor()
    await app.page.getByRole('button', { name: 'Add music' }).click()
    assert.deepEqual(await app.screen(), { name: 'add-music' })
  })
})
