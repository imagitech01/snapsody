import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import type { Page } from 'playwright'
import type { FakePageOutcome } from '../../src/platform/fake/index.ts'
import { withApp } from './app.ts'
import type { App } from './app.ts'
import { tab, textOf } from './journey.ts'
import { ID } from './pieces.ts'
import { barsScore } from './scores.ts'
import { MELODY_PIANO_FIXTURE } from '../helpers.ts'

// The add-music journey (practice-app design D15, "add music: hint, fake scan of 2 pages, reading, one piece";
// task 14.1; specs `score-capture` "Hint before scanning" and "Page scanner cannot run", `score-recognition`
// "Progress and cancel" and "Recognition failure"): the hint, the fake scanner's pages, the reading screen
// stepped by hand, and where each ending leads. The fake reader is `manual` here: it sends its events when the
// journey steps it, so the reading screen can be looked at and cancelled.

const MELODY_PIANO = readFileSync(MELODY_PIANO_FIXTURE, 'utf8')

const PHOTO = readFileSync(fileURLToPath(new URL('../fixtures/page.jpg', import.meta.url))).toString('base64')

/** The pages' scores: 3 bars and 2 bars. */
const PAGE_A = barsScore(3)
const PAGE_B = barsScore(2)

/** The next scan returns [count] pages (a real photo each); nothing is read until the journey says so. */
const scanReturns = (page: Page, count: number): Promise<void> =>
  page.evaluate(
    ({ count, photo }) => {
      const bytes = Uint8Array.from(atob(photo), (c) => c.charCodeAt(0))
      window.__test!.platform.scanner.willReturn(Array.from({ length: count }, () => ({ bytes })))
    },
    { count, photo: PHOTO },
  )

/** What the fake reader makes of each page of the next job. */
const readerWill = (page: Page, outcomes: FakePageOutcome[]): Promise<void> => page.evaluate((o) => window.__test!.platform.reader.willRead(o), outcomes)

/** The reading job started last sends its events up to and including `done` of page [index] (0-based). */
const readerThroughPage = (page: Page, index: number): Promise<void> =>
  page.evaluate((i) => {
    const job = window.__test!.platform.reader.jobs.at(-1)!
    while (job.step()) {
      const event = job.delivered.at(-1)!
      if (event.type === 'done' && event.page === i) return
    }
  }, index)

/** The reading job started last sends its events up to the first of page [index] (0-based): the page is being read. */
const readerToPage = (page: Page, index: number): Promise<void> =>
  page.evaluate((i) => {
    const job = window.__test!.platform.reader.jobs.at(-1)!
    while (job.step()) {
      const event = job.delivered.at(-1)!
      if (event.type === 'progress' && event.page === i) return
    }
  }, index)

/** The rest of the job's events at once. */
const readerFinishes = (page: Page): Promise<void> => page.evaluate(() => window.__test!.platform.reader.jobs.at(-1)!.flush())

/** The fake files give a placeholder URL for an image; a browser needs a real one to show the page being read. */
const realPhotos = (page: Page): Promise<void> =>
  page.evaluate(() => {
    const files = window.__test!.platform.files
    files.imageUrl = async (path) => URL.createObjectURL(new Blob([new Uint8Array(files.bytes(path)!)], { type: 'image/jpeg' }))
  })

const screenIs = (page: Page, name: string) => page.waitForFunction((n) => window.__test!.shell.router.screen.value.name === n, name)

const hintStays = (app: App) => app.page.getByRole('heading', { name: 'Before you scan', level: 1 })

/** The ids of the pieces in the fake files. */
const pieceIds = async (app: App): Promise<string[]> => [...new Set((await app.filePaths()).filter((p) => p.startsWith('pieces/')).map((p) => p.split('/')[1]!))]

/** What the scanner left in the fake files (`scans/<n>/…`); the pages of the seeded pieces are elsewhere. */
const scanFiles = async (app: App): Promise<string[]> => (await app.filePaths()).filter((p) => /^scans\/\d+\//.test(p))

const pieceJson = async (app: App, id: string): Promise<{ bars: number; pages: unknown[]; name: string }> =>
  JSON.parse((await app.file(`pieces/${id}/piece.json`)) ?? 'null')

test('add music: the hint, a scan of two pages, the pages being read, and one piece that opens in the editor, asking for its name', async () => {
  await withApp({ seed: '', reader: 'manual' }, async (app) => {
    const { page } = app
    await realPhotos(page)

    // The first launch invites; "Add music" opens the hint, not the scanner.
    await page.getByRole('button', { name: 'Add music' }).click()
    assert.deepEqual(await app.screen(), { name: 'add-music' })
    await hintStays(app).waitFor()
    const hint = await textOf(page.locator('[data-screen="add-music"]'))
    assert.match(hint, /Crop each page to the music you want to practise\./)
    assert.match(hint, /If the music continues on the next page, add that page too\./)
    assert.equal(await page.getByRole('navigation').count(), 0, 'no tab bar while adding music')

    // The user switches the hint off for the next time and opens the scanner; two pages come back.
    await scanReturns(page, 2)
    await readerWill(page, [
      { result: 'done', musicxml: PAGE_A },
      { result: 'done', musicxml: PAGE_B },
    ])
    await page.getByRole('switch', { name: "Don't show this again" }).click()
    await page.getByRole('button', { name: 'Open the scanner' }).click()

    // Reading: which page of how many, the page's own photo, and every page in its place.
    await page.getByRole('heading', { name: 'Reading page 1 of 2', level: 2 }).waitFor()
    assert.deepEqual(await app.screen(), { name: 'add-music' }, 'the route stays while the pages are read')
    await readerThroughPage(page, 0)
    await page.getByRole('heading', { name: 'Reading page 2 of 2', level: 2 }).waitFor()
    const pages = page.getByRole('list', { name: 'Reading your pages' }).getByRole('listitem')
    assert.deepEqual(
      await Promise.all([0, 1].map((i) => textOf(pages.nth(i)))),
      ['Page 1 Read', 'Page 2 Reading…'],
    )
    const progress = page.getByRole('progressbar')
    assert.equal(Number(await progress.getAttribute('aria-valuenow')) > 0, true, 'some of the reading is done')
    const photo = page.getByRole('img', { name: 'Page 2' })
    await photo.waitFor()
    assert.equal(await photo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0), true, 'the page photo loads')

    // The rest is read: one piece of both pages is saved, and the editor opens for it, asking for its name.
    await readerFinishes(page)
    await screenIs(page, 'editor')
    const [id, ...others] = await pieceIds(app)
    assert.deepEqual(others, [], 'one piece')
    assert.deepEqual(await app.stack(), [{ name: 'home' }, { name: 'editor', pieceId: id, isNew: true }])
    const name = page.getByRole('textbox', { name: 'Name this piece' })
    await name.waitFor()
    assert.equal(await name.inputValue(), (await pieceJson(app, id!)).name, 'the date name, to type over')

    // Save & practice opens it for practice in the editor's place.
    await page.getByRole('button', { name: 'Save & practice' }).click()
    await screenIs(page, 'practice')
    assert.deepEqual(await app.stack(), [{ name: 'home' }, { name: 'practice', pieceId: id }])
    const saved = await pieceJson(app, id!)
    assert.equal(saved.bars, 5, 'page 1 has three bars, page 2 two')
    assert.equal(saved.pages.length, 2)
    assert.deepEqual(await scanFiles(app), [], 'the scanner’s images are removed')
    assert.equal(JSON.parse((await app.file('settings.json'))!).scanHintSeen, true, 'the hint is switched off')

    // Back at the home the new piece is in the library, and the next "Add music" goes straight to the scanner.
    await app.back()
    await tab(page, 'Library').click()
    await page.getByRole('button', { name: /2 pages · 5 bars · Added today/ }).waitFor()
    await tab(page, 'Practice').click()
    await page.evaluate(() => window.__test!.platform.scanner.willCancel())
    await page.getByRole('button', { name: 'Add music' }).click()
    await page.waitForFunction(() => window.__test!.platform.scanner.calls.length === 2)
    await page.getByRole('heading', { name: 'Let’s practise', level: 1 }).waitFor()
    assert.deepEqual(await app.stack(), [{ name: 'home' }], 'the user left the scanner: back where adding started')
    assert.equal((await pieceIds(app)).length, 1, 'still one piece')
  })
})

test('add music: no music on page 2 says which page, creates nothing, and scanning again makes the piece', async () => {
  await withApp({ seed: '', reader: 'manual' }, async (app) => {
    const { page } = app
    await page.getByRole('button', { name: 'Add music' }).click()
    await scanReturns(page, 2)
    await readerWill(page, [{ result: 'done', musicxml: PAGE_A }, { result: 'no-music' }])
    await page.getByRole('button', { name: 'Open the scanner' }).click()
    await page.getByRole('heading', { name: 'Reading page 1 of 2', level: 2 }).waitFor()
    await readerFinishes(page)

    const message = page.getByRole('region', { name: 'No music found' })
    await message.waitFor()
    assert.match(await textOf(message), /There is no music on page 2\. Scan it again, cropped to the music\./)
    assert.deepEqual(await pieceIds(app), [], 'no piece')
    assert.deepEqual(await scanFiles(app), [], 'no page is kept')

    // Scan again: the scanner opens for all the pages once more.
    await scanReturns(page, 2)
    await readerWill(page, [{ result: 'done', musicxml: PAGE_A }, { result: 'done', musicxml: PAGE_B }])
    await message.getByRole('button', { name: 'Scan again' }).click()
    await page.getByRole('heading', { name: 'Reading page 1 of 2', level: 2 }).waitFor()
    await readerFinishes(page)
    await screenIs(page, 'editor')
    assert.equal((await pieceIds(app)).length, 1)
    assert.equal((await pieceJson(app, (await pieceIds(app))[0]!)).bars, 5)
    assert.deepEqual(await scanFiles(app), [])
    // Back from the new piece's editor, with nothing changed, goes to where adding music started.
    await page.getByRole('textbox', { name: 'Name this piece' }).waitFor()
    assert.equal(await app.back(), true)
    await screenIs(page, 'home')
    assert.deepEqual(await app.stack(), [{ name: 'home' }])
  })
})

test('add music: a page that could not be read says so and offers to scan again', async () => {
  await withApp({ seed: '', reader: 'manual' }, async (app) => {
    const { page } = app
    await page.getByRole('button', { name: 'Add music' }).click()
    await scanReturns(page, 1)
    await readerWill(page, [{ result: 'failed' }])
    await page.getByRole('button', { name: 'Open the scanner' }).click()
    await page.getByRole('heading', { name: 'Reading page 1 of 1', level: 2 }).waitFor()
    await readerFinishes(page)

    const message = page.getByRole('region', { name: 'Reading did not work' })
    await message.waitFor()
    assert.match(await textOf(message), /Page 1 could not be read\. Something went wrong while reading your pages\. Nothing was added\./)
    await message.getByRole('button', { name: 'Scan again' }).waitFor()
    assert.deepEqual(await pieceIds(app), [])

    // Leaving from here goes back to where adding started.
    await message.getByRole('button', { name: 'Cancel' }).click()
    await page.getByRole('heading', { name: 'Let’s practise', level: 1 }).waitFor()
    assert.deepEqual(await app.stack(), [{ name: 'home' }])
  })
})

test('add music: a piece that could not be saved says so, keeps nothing, and offers to scan again', async () => {
  await withApp({ seed: '', reader: 'manual' }, async (app) => {
    const { page } = app
    await page.getByRole('button', { name: 'Add music' }).click()
    await scanReturns(page, 1)
    await readerWill(page, [{ result: 'done', musicxml: PAGE_A }])
    // The phone's storage refuses the page images (a full disk).
    await page.evaluate(() => {
      window.__test!.platform.files.fault = (operation) => {
        if (operation === 'copy') throw new Error('no space left')
      }
    })
    await page.getByRole('button', { name: 'Open the scanner' }).click()
    await page.getByRole('heading', { name: 'Reading page 1 of 1', level: 2 }).waitFor()
    await readerFinishes(page)

    const message = page.getByRole('region', { name: 'The piece was not saved' })
    await message.waitFor()
    assert.match(await textOf(message), /The piece could not be saved\. There may not be enough space on your phone\./)
    await message.getByRole('button', { name: 'Scan again' }).waitFor()
    assert.deepEqual(await pieceIds(app), [], 'no piece, and no half of one')
    assert.deepEqual(await scanFiles(app), [])
  })
})

test('add music: cancel while page 2 of 3 is read stops the reading and creates nothing, by the button and by Back', async () => {
  await withApp({ seed: '', reader: 'manual' }, async (app) => {
    const { page } = app
    const job = (): Promise<{ finished: boolean; last: string }> =>
      page.evaluate(() => {
        const j = window.__test!.platform.reader.jobs.at(-1)!
        const last = j.delivered.at(-1)!
        return { finished: j.finished, last: last.type === 'finished' ? `finished ${last.status}` : last.type }
      })

    for (const how of ['button', 'back'] as const) {
      await page.getByRole('button', { name: 'Add music' }).click()
      await scanReturns(page, 3)
      await readerWill(page, [{ result: 'done', musicxml: PAGE_A }, { result: 'done', musicxml: PAGE_B }, { result: 'done', musicxml: PAGE_A }])
      await page.getByRole('button', { name: 'Open the scanner' }).click()
      await page.getByRole('heading', { name: 'Reading page 1 of 3', level: 2 }).waitFor()
      await readerThroughPage(page, 0)
      await readerToPage(page, 1)
      await page.getByRole('heading', { name: 'Reading page 2 of 3', level: 2 }).waitFor()
      const pages = page.getByRole('list', { name: 'Reading your pages' }).getByRole('listitem')
      assert.deepEqual(
        await Promise.all([0, 1, 2].map((i) => textOf(pages.nth(i)))),
        ['Page 1 Read', 'Page 2 Reading…', 'Page 3 Waiting'],
        'the pages read, being read and still to come',
      )

      if (how === 'button') await page.getByRole('button', { name: 'Cancel' }).click()
      else assert.equal(await app.back(), true, 'the system Back button is handled while reading')

      // Reading stopped, and the screen where adding started is shown again.
      await page.getByRole('heading', { name: 'Let’s practise', level: 1 }).waitFor()
      assert.deepEqual(await app.stack(), [{ name: 'home' }])
      assert.deepEqual(await job(), { finished: true, last: 'finished cancelled' })
      assert.deepEqual(await pieceIds(app), [], `no piece (${how})`)
      assert.deepEqual(await scanFiles(app), [], `no page is kept (${how})`)
    }
  })
})

test('add music: the page scanner not being available is explained, and nothing else is offered', async () => {
  await withApp({ seed: 'library' }, async (app) => {
    const { page } = app
    const before = await pieceIds(app)
    await page.getByRole('button', { name: 'Add music' }).click()
    await page.evaluate(() => window.__test!.platform.scanner.willBeUnavailable())
    await page.getByRole('button', { name: 'Open the scanner' }).click()

    const message = page.getByRole('region', { name: 'The page scanner is not available' })
    await message.waitFor()
    assert.match(await textOf(message), /not available on this phone right now\. Updating Google Play services may help\./)
    assert.deepEqual(await message.getByRole('button').evaluateAll((buttons) => buttons.map((b) => b.textContent)), ['OK'], 'no other way to add music')
    assert.equal(await page.getByRole('button', { name: 'Scan again' }).count(), 0)

    await message.getByRole('button', { name: 'OK' }).click()
    await page.getByRole('heading', { name: 'Let’s practise', level: 1 }).waitFor()
    assert.deepEqual(await pieceIds(app), before, 'no piece was created')
  })
})

test('add music: pages added to a piece follow its last bar and the screen under (the editor) is shown again', async () => {
  await withApp({ seed: 'library', reader: 'manual' }, async (app) => {
    const { page } = app
    const id = ID.eighths // 8 bars, one page
    // "+ Add pages" of the editor (task 15): the editor is open and adding music is pushed over it.
    await page.evaluate((pieceId) => {
      const { router } = window.__test!.shell
      router.push({ name: 'editor', pieceId })
      router.push({ name: 'add-music', pieceId })
    }, id)
    await scanReturns(page, 1)
    await readerWill(page, [{ result: 'done', musicxml: PAGE_B }])
    await page.getByRole('button', { name: 'Open the scanner' }).click()
    await page.getByRole('heading', { name: 'Reading page 1 of 1', level: 2 }).waitFor()
    await page.getByText('Snapsody is reading the new pages and adding them to “Even eighths”.').waitFor()
    await readerFinishes(page)

    await screenIs(page, 'editor')
    assert.deepEqual(await app.stack(), [{ name: 'home' }, { name: 'editor', pieceId: id }], 'back under the screen that asked')
    const saved = await pieceJson(app, id)
    assert.equal(saved.bars, 10, '8 bars and the 2 of the new page')
    assert.equal(saved.pages.length, 2)
    assert.equal(saved.name, 'Even eighths')
    assert.equal((await pieceIds(app)).length, 4, 'no new piece')
    assert.deepEqual(await scanFiles(app), [])
  })
})

test('add music: a melody-and-piano page shows the parts step, and keeping only the melody gives a melody-only piece that opens in the editor', async () => {
  await withApp({ seed: '', reader: 'manual' }, async (app) => {
    const { page } = app
    await realPhotos(page)
    await page.getByRole('button', { name: 'Add music' }).click()
    await scanReturns(page, 1)
    await readerWill(page, [{ result: 'done', musicxml: MELODY_PIANO }])
    await page.getByRole('button', { name: 'Open the scanner' }).click()
    await page.getByRole('heading', { name: 'Reading page 1 of 1', level: 2 }).waitFor()
    await readerFinishes(page)

    // The step: Melody and Piano, both ticked, Melody as the part played, the first bars of each drawn small.
    await page.getByRole('heading', { name: 'Your parts', level: 1 }).waitFor()
    assert.deepEqual(await app.screen(), { name: 'add-music' })
    const melody = page.getByRole('checkbox', { name: 'Melody' })
    const piano = page.getByRole('checkbox', { name: 'Piano' })
    assert.equal(await melody.getAttribute('aria-checked'), 'true')
    assert.equal(await piano.getAttribute('aria-checked'), 'true')
    assert.equal(await page.getByRole('radio', { name: /I play this Melody/ }).getAttribute('aria-checked'), 'true')
    assert.equal(await page.getByRole('radio', { name: /I play this Piano/ }).getAttribute('aria-checked'), 'false')
    await page.locator('.add-part-preview > svg').first().waitFor()
    assert.equal(await page.locator('.add-part-preview > svg').count(), 2, 'one drawing per part')
    assert.deepEqual(await pieceIds(app), [], 'nothing is saved before Continue')
    // Back from here is cancelling: checked in its own run below; here the step must fit the screen.
    const box = await page.locator('[data-screen="add-music"] .add-actions').boundingBox()
    assert.ok(box && box.y + box.height <= (page.viewportSize()?.height ?? 0), 'Continue is on the screen')

    // Piano off: its radio can no longer be chosen, and the melody goes on being the part played.
    await piano.click()
    assert.equal(await piano.getAttribute('aria-checked'), 'false')
    assert.equal(await page.getByRole('radio', { name: /I play this Piano/ }).isDisabled(), true)
    await page.getByRole('button', { name: 'Continue' }).click()

    await screenIs(page, 'editor')
    const [id, ...others] = await pieceIds(app)
    assert.deepEqual(others, [], 'one piece')
    assert.deepEqual(await app.stack(), [{ name: 'home' }, { name: 'editor', pieceId: id, isNew: true }])
    await page.getByRole('textbox', { name: 'Name this piece' }).waitFor()
    const info = JSON.parse((await app.file(`pieces/${id}/piece.json`))!) as { score: string; partsRead: unknown }
    assert.deepEqual(info.partsRead, [{ staves: 1, kept: true }, { staves: 2, kept: false }])
    const musicxml = (await app.file(`pieces/${id}/${info.score}`))!
    assert.equal((musicxml.match(/<score-part /g) ?? []).length, 1, 'a melody-only piece')
    assert.match(musicxml, /<part-name>Melody<\/part-name>/)
    assert.deepEqual(JSON.parse((await app.file(`pieces/${id}/practice.json`))!).part, { id: 'P1' })
    assert.deepEqual(await scanFiles(app), [])
  })
})

test('add music: Back from the parts step creates no piece and shows where adding started, and Continue waits while nothing is ticked', async () => {
  await withApp({ seed: '', reader: 'manual' }, async (app) => {
    const { page } = app
    await page.getByRole('button', { name: 'Add music' }).click()
    await scanReturns(page, 1)
    await readerWill(page, [{ result: 'done', musicxml: MELODY_PIANO }])
    await page.getByRole('button', { name: 'Open the scanner' }).click()
    await page.getByRole('heading', { name: 'Reading page 1 of 1', level: 2 }).waitFor()
    await readerFinishes(page)
    await page.getByRole('heading', { name: 'Your parts', level: 1 }).waitFor()

    await page.getByRole('checkbox', { name: 'Melody' }).click()
    await page.getByRole('checkbox', { name: 'Piano' }).click()
    assert.equal(await page.getByRole('button', { name: 'Continue' }).isDisabled(), true, 'nothing ticked: no way on')
    await page.getByRole('status').filter({ hasText: 'Keep at least one part.' }).waitFor()

    assert.equal(await app.back(), true)
    await page.getByRole('heading', { name: 'Let’s practise', level: 1 }).waitFor()
    assert.deepEqual(await app.stack(), [{ name: 'home' }])
    assert.deepEqual(await pieceIds(app), [], 'no piece')
    assert.deepEqual(await scanFiles(app), [], 'no page is kept')
  })
})
