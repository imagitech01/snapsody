import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import type { Page } from 'playwright'
import { CLOCK_START, GALLERY, START_URL, withApp } from './app.ts'
import { highlighted, noteIdsByBar, tapNote } from './journey.ts'

// The UI test harness itself (openspec test-pyramid task 4.2, practice-app D15): the built app
// starts in headless Chromium at Capacitor's local origin, Preact and signals run in it, a .wasm
// file loads, and the test clock moves the audio clock. The journeys of the screens are in their own
// files (practice, library, settings; practice-app groups 12 to 15), on the test entry with the fake platform.
//
// These tests start the app's own entry (`/`, src/main.tsx with the browser-dev platform), which is
// what the phone boots: no journey covers that entry, so they do. A fresh browser context has no
// files, so the app shows the first-launch screen.
//
// Also here: the shared components (practice-app task 11.2) and the score island (11.3), mounted by
// role and accessible name on the component gallery (web/dev/gallery.tsx, built into the test build
// only). Component names are the ones the gallery gives them.

/** The app's own entry has started: the first screen of an empty phone is drawn. */
async function started(page: Page): Promise<void> {
  await page.getByRole('heading', { name: 'Let’s practise' }).waitFor()
}

test('ui harness: the app starts on its own entry, with signals and the shell running, and an empty phone gets the invitation', async () => {
  await withApp({}, async ({ page }) => {
    await started(page)
    assert.equal(page.url(), START_URL)
    assert.equal(await page.locator('html').getAttribute('lang'), 'en', 'the page language follows the app')
    await page.getByRole('region', { name: 'Add your first music' }).waitFor()
    // A tap on a tab changes what the signals of the router show (Preact and signals run in the real build).
    await page.getByRole('navigation', { name: 'Main areas' }).getByRole('button', { name: 'Settings' }).click()
    await page.getByRole('heading', { name: 'Settings', level: 1 }).waitFor()
    assert.equal(await page.getByRole('navigation', { name: 'Main areas' }).getByRole('button', { name: 'Settings' }).getAttribute('aria-current'), 'page')
  })
})

test('ui harness: a .wasm file is served as application/wasm and instantiates from the stream', async () => {
  await withApp({}, async ({ page }) => {
    await started(page)
    const result = await page.evaluate(async () => {
      const response = await fetch('test.wasm')
      const type = response.headers.get('content-type')
      const { instance } = await WebAssembly.instantiateStreaming(response)
      return { type, sum: (instance.exports.add as (a: number, b: number) => number)(2, 3) }
    })
    assert.deepEqual(result, { type: 'application/wasm', sum: 5 })
  })
})

test('ui harness: other hosts are refused', async () => {
  await withApp({}, async ({ page }) => {
    await started(page)
    const reached = await page.evaluate(() => fetch('https://example.com/').then(() => true, () => false))
    assert.equal(reached, false)
  })
})

test('ui harness: the test AudioContext follows page.clock', async () => {
  await withApp({}, async ({ page }) => {
    await started(page)
    await page.evaluate(() => {
      ;(window as unknown as { __ctx: AudioContext }).__ctx = new AudioContext()
    })
    await page.clock.pauseAt(new Date(CLOCK_START.getTime() + 60_000))
    const before = await page.evaluate(() => (window as unknown as { __ctx: AudioContext }).__ctx.currentTime)
    await page.clock.runFor(1500)
    const after = await page.evaluate(() => (window as unknown as { __ctx: AudioContext }).__ctx.currentTime)
    assert.ok(Math.abs(after - before - 1.5) < 0.05, `the audio clock moved by ${after - before} s, expected 1.5 s`)
  })
})

// ---- The shared components (task 11.2), on the gallery -----------------------------------------------

/** Opens the gallery; reduced motion makes the sheet and the scrolling settle at once. */
async function gallery(page: Page, view = ''): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(`${START_URL}${GALLERY}${view}`)
}

const events = async (page: Page): Promise<string> => (await page.getByRole('log', { name: 'Events' }).textContent()) ?? ''

test('ui components: buttons are found by role and name, and a press reaches the screen', async () => {
  await withApp({}, async ({ page }) => {
    await gallery(page)
    await page.getByRole('button', { name: 'Start looping bars 2–3' }).click()
    await page.getByRole('button', { name: 'Add music', exact: true }).click()
    await page.getByRole('button', { name: '+ Add music' }).click()
    await page.getByRole('button', { name: 'Delete note' }).click()
    await page.getByRole('button', { name: 'See all' }).click()
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await page.getByRole('button', { name: 'More tools' }).click()
    assert.equal(await events(page), 'primary | add music | secondary | danger | link | back | more')
    assert.equal(await page.getByRole('button', { name: 'Not now' }).isDisabled(), true)
    // An icon button that switches something says whether it is on.
    const favorite = page.getByRole('button', { name: 'Favorite', exact: true, pressed: false })
    await favorite.click()
    await page.getByRole('button', { name: 'Favorite', exact: true, pressed: true }).waitFor()
    // Every icon is decorative: the button holds the name.
    assert.equal(await page.locator('svg.icon:not([aria-hidden="true"])').count(), 0)
  })
})

test('ui components: the tab bar is a navigation with the current tab marked', async () => {
  await withApp({}, async ({ page }) => {
    await gallery(page)
    const bar = page.getByRole('navigation', { name: 'Main' })
    const tab = (name: string) => bar.getByRole('button', { name })
    assert.equal(await tab('Practice').getAttribute('aria-current'), 'page')
    assert.equal(await tab('Library').getAttribute('aria-current'), null)
    await tab('Library').click()
    assert.equal(await tab('Library').getAttribute('aria-current'), 'page')
    assert.equal(await tab('Practice').getAttribute('aria-current'), null)
    assert.match(await events(page), /tab library/)
  })
})

test('ui components: stepper, toggle and segmented control have roles, names and state', async () => {
  await withApp({}, async ({ page }) => {
    await gallery(page)

    const tempo = page.getByRole('group', { name: 'Tempo' })
    assert.equal(await tempo.getByRole('status').textContent(), '60')
    await tempo.getByRole('button', { name: 'Faster' }).click()
    assert.equal(await tempo.getByRole('status').textContent(), '65')
    await tempo.getByRole('button', { name: 'Slower' }).click()
    assert.equal(await tempo.getByRole('status').textContent(), '60')
    const pitch = page.getByRole('group', { name: 'Pitch' })
    assert.equal(await pitch.getByRole('button', { name: 'Semitone down' }).isDisabled(), true, 'the end of the range disables the button')
    await pitch.getByRole('button', { name: 'Semitone up' }).click()
    assert.equal(await pitch.getByRole('status').textContent(), 'F5')

    const metronome = page.getByRole('switch', { name: 'Metronome' })
    assert.equal(await metronome.getAttribute('aria-checked'), 'false')
    await metronome.click()
    assert.equal(await metronome.getAttribute('aria-checked'), 'true')

    const rest = page.getByRole('radiogroup', { name: 'Rest between repeats' })
    assert.equal(await rest.getByRole('radio', { name: 'Off' }).getAttribute('aria-checked'), 'true')
    await rest.getByRole('radio', { name: '1 bar' }).click()
    assert.equal(await rest.getByRole('radio', { name: '1 bar' }).getAttribute('aria-checked'), 'true')
    assert.equal(await rest.getByRole('radio', { name: 'Off' }).getAttribute('aria-checked'), 'false')
    // The arrow keys move the selection and the focus, and only the selected radio is in the tab order.
    await page.keyboard.press('ArrowRight')
    assert.equal(await rest.getByRole('radio', { name: '2 bars' }).getAttribute('aria-checked'), 'true')
    assert.equal(await rest.getByRole('radio', { name: '2 bars' }).getAttribute('tabindex'), '0')
    assert.equal(await rest.getByRole('radio', { name: 'Off' }).getAttribute('tabindex'), '-1')
    const mode = page.getByRole('radiogroup', { name: 'Editing mode' })
    await mode.getByRole('radio', { name: 'Marks' }).click()
    assert.match(await events(page), /mode marks/)
  })
})

test('ui components: list rows keep the row and its trailing control as two buttons, and a choice list is a radio group', async () => {
  await withApp({}, async ({ page }) => {
    await gallery(page)
    assert.equal(await page.locator('button button').count(), 0, 'no button inside a button')

    await page.getByRole('button', { name: /^Go to music/ }).click()
    // The star at the end of a row is a button of its own, with its own name; pressing it does not press the row.
    await page.getByRole('button', { name: 'Remove Ode to Joy from favorites' }).click()
    await page.getByRole('button', { name: /^Ode to Joy/ }).click()
    assert.equal(await events(page), 'go to music | unfavorite Ode to Joy | open Ode to Joy')

    // A row with a switch: the switch is named by the row's title and described by its line.
    const favorite = page.getByRole('switch', { name: 'Favorite' })
    assert.equal(await favorite.getAttribute('aria-checked'), 'true')
    const description = await favorite.evaluate((element) => document.getElementById(element.getAttribute('aria-describedby') ?? '')?.textContent)
    assert.equal(description, 'Keep in your practice rotation')
    await favorite.click()
    assert.equal(await favorite.getAttribute('aria-checked'), 'false')

    const instruments = page.getByRole('radiogroup', { name: 'Default instrument' })
    assert.equal(await instruments.getByRole('radio', { name: /^Piano/ }).getAttribute('aria-checked'), 'true')
    await instruments.getByRole('radio', { name: /^Guitar/ }).click()
    assert.equal(await instruments.getByRole('radio', { name: /^Guitar/ }).getAttribute('aria-checked'), 'true')
    assert.equal(await instruments.getByRole('radio', { name: /^Piano/ }).getAttribute('aria-checked'), 'false')
  })
})

test('ui components: a sheet closes on its scrim, on Close and on a drag of its handle, and on nothing else', async () => {
  await withApp({}, async ({ page }) => {
    await gallery(page)
    const open = page.getByRole('button', { name: 'Open the sheet' })
    const sheet = page.getByRole('dialog', { name: 'Practice tools' })
    const closed = async (): Promise<void> => {
      await sheet.waitFor({ state: 'detached' })
    }

    await open.click()
    await sheet.waitFor()
    assert.equal(await sheet.getAttribute('aria-modal'), 'true')
    assert.equal(await sheet.evaluate((element) => document.activeElement === element), true, 'the focus moves into the sheet')
    assert.ok(await sheet.getByText('Everything else, only when you need it.').isVisible())

    // A tap inside the sheet, on its title, on a row and on the sheet's own background, does not close it.
    await sheet.getByRole('heading', { name: 'Practice tools' }).tap()
    await sheet.getByRole('button', { name: /^Instrument/ }).click()
    const box = (await sheet.boundingBox())!
    await page.touchscreen.tap(box.x + 4, box.y + box.height / 2)
    assert.equal(await sheet.isVisible(), true)

    // A drag that starts on the sheet, not on the handle, is the content's own: it does not close the sheet.
    await page.mouse.move(box.x + box.width / 2, box.y + 80)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2, box.y + 400, { steps: 6 })
    await page.mouse.up()
    assert.equal(await sheet.isVisible(), true)

    // A tap on the scrim closes it, and the focus goes back to what opened it.
    await page.touchscreen.tap(box.x + box.width / 2, 8)
    await closed()
    assert.equal(await open.evaluate((element) => document.activeElement === element), true, 'the focus returns to the opener')

    // Close.
    await open.click()
    await sheet.getByRole('button', { name: 'Close' }).click()
    await closed()

    // A short drag on the handle snaps back; a long one closes.
    await open.click()
    await sheet.waitFor()
    const handle = page.locator('[data-part="handle"]')
    const grip = (await handle.boundingBox())!
    const x = grip.x + grip.width / 2
    const y = grip.y + grip.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x, y + 30, { steps: 4 })
    await page.mouse.up()
    await page.waitForTimeout(100)
    assert.equal(await sheet.isVisible(), true, 'a short drag does not close it')
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x, y + 200, { steps: 8 })
    await page.mouse.up()
    await closed()
    assert.match(await events(page), /sheet closed \| sheet closed \| sheet closed$/)
  })
})

test('ui components: the handle of a sheet works by touch too, and a short drag does not swallow the next tap on the scrim', async () => {
  await withApp({}, async ({ page }) => {
    await gallery(page)
    const open = page.getByRole('button', { name: 'Open the sheet' })
    const sheet = page.getByRole('dialog', { name: 'Practice tools' })
    const client = await page.context().newCDPSession(page)
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, y: number) =>
      client.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] })
    const drag = async (distance: number): Promise<void> => {
      const grip = (await page.locator('[data-part="handle"]').boundingBox())!
      const x = Math.round(grip.x + grip.width / 2)
      const y = Math.round(grip.y + grip.height / 2)
      await touch('touchStart', x, y)
      for (let step = 1; step <= 8; step++) await touch('touchMove', x, y + Math.round((distance * step) / 8))
      await touch('touchEnd', x, y + distance)
    }

    await open.click()
    await sheet.waitFor()
    await drag(40)
    await page.waitForTimeout(100)
    assert.equal(await sheet.isVisible(), true, 'a short drag snaps back')
    // The tap on the scrim that follows is not swallowed by the drag before it.
    const box = (await sheet.boundingBox())!
    await page.touchscreen.tap(box.x + box.width / 2, 8)
    await sheet.waitFor({ state: 'detached' })

    await open.click()
    await sheet.waitFor()
    await drag(200)
    await sheet.waitFor({ state: 'detached' })
    assert.match(await events(page), /sheet closed \| sheet closed$/)
  })
})

test('ui components: a confirm dialog gives the user\'s answer, and a tap outside it is "no"', async () => {
  await withApp({}, async ({ page }) => {
    await gallery(page)
    const dialog = page.getByRole('alertdialog', { name: 'Delete Ode to Joy?' })

    await page.getByRole('button', { name: 'Delete a piece' }).click()
    await dialog.waitFor()
    assert.ok(await dialog.getByText('The piece and its practice settings are removed.').isVisible())
    await dialog.getByRole('button', { name: 'Delete' }).click()
    await dialog.waitFor({ state: 'detached' })

    await page.getByRole('button', { name: 'Delete a piece' }).click()
    await dialog.getByRole('button', { name: 'Keep' }).click()
    await dialog.waitFor({ state: 'detached' })

    await page.getByRole('button', { name: 'Ask a question' }).click()
    const question = page.getByRole('alertdialog', { name: 'Leave without saving?' })
    await question.waitFor()
    await question.getByRole('heading').tap()
    assert.equal(await question.isVisible(), true, 'a tap on the dialog itself does nothing')
    await page.touchscreen.tap(6, 6)
    await question.waitFor({ state: 'detached' })
    assert.equal(await events(page), 'dialog confirmed | dialog cancelled | dialog cancelled')
  })
})

// ---- The score island (task 11.3), on the gallery ------------------------------------------------------------

const EXERCISE = readFileSync(fileURLToPath(new URL('../fixtures/practice-exercise.musicxml', import.meta.url)), 'utf8')
/** The first note of a bar (from 1), as the gallery's fake playback hears it. */
const firstNote = (bar: number): string => noteIdsByBar(EXERCISE)[bar - 1]![0]!

const island = (page: Page) => page.getByRole('region', { name: 'Score', exact: true })
const status = async (page: Page): Promise<string> => (await page.getByRole('status', { name: 'Island' }).textContent()) ?? ''
const scrollTop = (page: Page): Promise<number> => island(page).evaluate((element) => element.scrollTop)

/** Lets the frames and timers that the island runs on page.clock go by. */
const settle = async (page: Page, ms = 300): Promise<void> => {
  await page.clock.runFor(ms)
}

/** Whether the element with this note id is inside the visible part of the island. */
async function inView(page: Page, id: string): Promise<boolean> {
  return page.evaluate((noteId) => {
    const scroller = document.querySelector('.score-island')!.getBoundingClientRect()
    const note = document.querySelector(`.score-view g.note[id="${noteId}"]`)?.getBoundingClientRect()
    return !!note && note.top >= scroller.top && note.bottom <= scroller.bottom
  }, id)
}

test('score island: the SVG and the highlight appear, and the highlight moves without drawing the score again', async () => {
  await withApp({}, async ({ page }) => {
    await gallery(page, '?view=score')
    await page.locator('.score-view svg g.note').first().waitFor()
    assert.equal(await island(page).getAttribute('tabindex'), '0', 'a keyboard can scroll the score')
    // The drawing is the island's: mark the SVG, and see it is the same node at the end.
    await page.evaluate(() => {
      ;(document.querySelector('.score-view > svg') as unknown as { probe: number }).probe = 1
    })
    const same = (): Promise<boolean> => page.evaluate(() => (document.querySelector('.score-view > svg') as unknown as { probe?: number }).probe === 1)

    // Not playing: the bar the user is at is shown, with no sounding note.
    assert.equal(await highlighted(page), null)
    await page.locator('.score-bar').waitFor()
    await page.locator('.score-cursor').waitFor()

    await page.getByRole('button', { name: 'Hear bar 2' }).click()
    await settle(page)
    assert.equal(await highlighted(page), firstNote(2))
    // The box of the bar is behind the note, and the cursor line is at its head.
    const { box, note, cursor } = await page.evaluate((id) => {
      const rect = (selector: string) => document.querySelector(selector)!.getBoundingClientRect().toJSON() as { x: number; y: number; width: number; height: number }
      return { box: rect('.score-bar'), note: rect(`.score-view g.note[id="${id}"]`), cursor: rect('.score-cursor') }
    }, firstNote(2))
    assert.ok(box.x <= note.x && note.x + note.width <= box.x + box.width + 1, 'the note is inside the bar box')
    assert.ok(box.y <= note.y + 1 && note.y + note.height <= box.y + box.height + 1, 'and so, up and down, is its stem')
    assert.ok(Math.abs(cursor.x - note.x) < 8, 'the cursor line is at the note')

    // The page rendering again (the gallery's button) does not touch the drawing.
    await page.getByRole('button', { name: /^Render again/ }).click()
    await page.getByRole('button', { name: 'Render again (1)' }).waitFor()
    assert.equal(await highlighted(page), firstNote(2))

    // The sounding note moves on; the old one is no longer highlighted, and there is only one.
    await page.getByRole('button', { name: 'Hear bar 15' }).click()
    await settle(page)
    assert.equal(await highlighted(page), firstNote(15))
    assert.equal(await page.locator('.score-view g.note.hl').count(), 1)
    assert.equal(await same(), true, 'the SVG is the same node: the score was not drawn again')

    // Paused: no sounding note, and the bar box stays on the bar the user is at.
    await page.getByRole('button', { name: 'Pause' }).click()
    await settle(page)
    assert.equal(await highlighted(page), null)
    assert.equal(await page.locator('.score-bar').isVisible(), true)

    // A selection (the editor's) marks its note.
    await page.getByRole('button', { name: 'Select a note' }).click()
    assert.equal(await page.locator('.score-view g.note.mk-sel').getAttribute('id'), firstNote(4))
    assert.equal(await same(), true)
  })
})

test('score island: leaving the page before it is drawn, or while it plays, leaves nothing running; it can come back', async () => {
  await withApp({}, async ({ page }) => {
    await gallery(page, '?view=score')
    // Gone before the first drawing is finished (Verovio is still loading).
    await page.getByRole('button', { name: 'Remove the score' }).click()
    assert.equal(await page.locator('.score-island').count(), 0)
    await settle(page, 500)

    // Back, drawn, playing: and gone again while the cursor runs.
    await page.getByRole('button', { name: 'Show the score' }).click()
    await page.locator('.score-view svg g.note').first().waitFor()
    await page.getByRole('button', { name: 'Hear bar 2' }).click()
    await settle(page)
    assert.equal(await highlighted(page), firstNote(2))
    await page.getByRole('button', { name: 'Remove the score' }).click()
    await settle(page, 500)
    assert.equal(await page.locator('.score-island').count(), 0)

    // And again: a new island, with its own highlight (the page's fake playback goes on).
    await page.getByRole('button', { name: 'Show the score' }).click()
    await page.locator('.score-view svg g.note').first().waitFor()
    await settle(page)
    assert.equal(await highlighted(page), firstNote(2))
  })
})

test('score island: a tap on a note is reported with its id, and moves the bar the user is at', async () => {
  await withApp({}, async ({ page }) => {
    await gallery(page, '?view=score')
    await page.locator('.score-view svg g.note').first().waitFor()
    const id = firstNote(3)
    await tapNote(page, id)
    assert.match(await status(page), new RegExp(`tapped ${id}$`))
    await settle(page)
    // The gallery sets the bar to the tapped note's, as the session does for a seek: the box is on bar 3.
    const { box, note } = await page.evaluate((noteId) => {
      const rect = (selector: string) => document.querySelector(selector)!.getBoundingClientRect().toJSON() as { x: number; width: number }
      return { box: rect('.score-bar'), note: rect(`.score-view g.note[id="${noteId}"]`) }
    }, id)
    assert.ok(box.x <= note.x && note.x + note.width <= box.x + box.width + 1)
    assert.equal(await highlighted(page), null, 'a tap highlights nothing by itself: the sounding note is the cursor\'s')
  })
})

test('score island: it follows the sounding bar, stops when the user moves the score, and comes back on request', async () => {
  await withApp({}, async ({ page }) => {
    await gallery(page, '?view=score')
    await page.locator('.score-view svg g.note').first().waitFor()
    assert.equal(await scrollTop(page), 0)

    // Following: a bar that is off screen is scrolled into view.
    await page.getByRole('button', { name: 'Hear bar 15' }).click()
    await settle(page)
    await page.waitForFunction(() => document.querySelector('.score-island')!.scrollTop > 0)
    assert.equal(await inView(page, firstNote(15)), true)

    await page.getByRole('button', { name: 'Hear bar 2' }).click()
    await settle(page)
    await page.waitForFunction(() => document.querySelector('.score-island')!.scrollTop < 20)
    assert.equal(await inView(page, firstNote(2)), true)
    assert.match(await status(page), /^following on · showing none · scrolled away none/)

    // The user turns the wheel over the score: following stops, the island reports the bar at the top.
    const box = (await island(page).boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.wheel(0, 150)
    await page.waitForFunction(() => document.querySelector('.score-island')!.scrollTop > 100)
    await settle(page)
    const away = await status(page)
    assert.match(away, /^following off · showing \d+ · scrolled away \d+/, away)
    const shown = /showing (\d+)/.exec(away)![1]!
    assert.ok(Number(shown) > 2, 'the bar at the top is not the sounding one any more')
    // Reporting the bar must not make the island scroll again to put that bar at the top: it stays where the wheel left it.
    await settle(page, 600)
    assert.ok(Math.abs((await scrollTop(page)) - 150) < 2, `the view stays where the user left it: ${await scrollTop(page)}`)

    // The music goes on and the highlight with it, but the view stays where the user put it.
    const stayed = await scrollTop(page)
    await page.getByRole('button', { name: 'Hear bar 18' }).click()
    await settle(page, 600)
    assert.equal(await highlighted(page), firstNote(18))
    assert.equal(await scrollTop(page), stayed, 'the view did not follow')
    assert.equal(await inView(page, firstNote(18)), false)

    // "Return to playing": back to the sounding bar, following again.
    await page.getByRole('button', { name: 'Return to playing' }).click()
    await settle(page)
    await page.waitForFunction((id) => {
      const scroller = document.querySelector('.score-island')!.getBoundingClientRect()
      const note = document.querySelector(`.score-view g.note[id="${id}"]`)!.getBoundingClientRect()
      return note.top >= scroller.top && note.bottom <= scroller.bottom
    }, firstNote(18))
    assert.match(await status(page), /^following on · showing none/)

    // "Go to bar 12", set from elsewhere: the island scrolls there and does not report its own scroll as the user's.
    await page.getByRole('button', { name: 'Go to bar 12' }).click()
    await settle(page)
    await page.waitForFunction((id) => {
      const scroller = document.querySelector('.score-island')!.getBoundingClientRect()
      const note = document.querySelector(`.score-view g.note[id="${id}"]`)!.getBoundingClientRect()
      return note.top >= scroller.top && note.top < scroller.top + 120
    }, firstNote(12))
    assert.match(await status(page), /^following off · showing 12 · scrolled away none/)
  })
})

test('score island: a touch drag of the score also ends following', async () => {
  await withApp({}, async ({ page }) => {
    await gallery(page, '?view=score')
    await page.locator('.score-view svg g.note').first().waitFor()
    await page.getByRole('button', { name: 'Hear bar 2' }).click()
    await settle(page)
    assert.match(await status(page), /^following on/)

    // A real touch gesture (touchstart, touchmove, a scroll of the island), as a finger on the phone does it.
    const box = (await island(page).boundingBox())!
    const client = await page.context().newCDPSession(page)
    await client.send('Input.synthesizeScrollGesture', {
      x: Math.round(box.x + box.width / 2),
      y: Math.round(box.y + box.height / 2),
      yDistance: -150,
      speed: 600,
      gestureSourceType: 'touch',
    })
    await page.waitForFunction(() => document.querySelector('.score-island')!.scrollTop > 50)
    await settle(page, 600)
    assert.match(await status(page), /^following off · showing \d+ · scrolled away \d+/)
    // The sounding note went on being highlighted, and the view did not jump back.
    assert.equal(await highlighted(page), firstNote(2))
    assert.ok((await scrollTop(page)) > 50)
  })
})

test('score island: a turn to landscape lays the bars out again and keeps the highlight and the bar in view', async () => {
  await withApp({}, async ({ page }) => {
    await gallery(page, '?view=score')
    await page.locator('.score-view svg g.note').first().waitFor()
    const systems = (): Promise<number> => page.locator('.score-view g.system').count()
    const portrait = await systems()
    const portraitWidth = await page.locator('.score-view > svg').evaluate((svg) => svg.getBoundingClientRect().width)

    await page.getByRole('button', { name: 'Hear bar 15' }).click()
    await settle(page)
    assert.equal(await highlighted(page), firstNote(15))

    await page.setViewportSize({ width: 780, height: 360 })
    // The layout is redone after the width settles (150 ms), and Verovio takes a moment.
    await page.waitForFunction((count) => document.querySelectorAll('.score-view g.system').length < count, portrait, { timeout: 10_000 }).catch(() => settle(page, 400))
    for (let i = 0; i < 20 && (await systems()) >= portrait; i++) {
      await settle(page, 200)
      await page.waitForTimeout(100)
    }
    assert.ok((await systems()) < portrait, `fewer lines in landscape: ${await systems()} against ${portrait}`)
    assert.ok((await page.locator('.score-view > svg').evaluate((svg) => svg.getBoundingClientRect().width)) > portraitWidth * 1.5)
    await settle(page)
    assert.equal(await highlighted(page), firstNote(15), 'the sounding note is highlighted again in the new drawing')
    assert.equal(await inView(page, firstNote(15)), true, 'and its bar is still in view')
    assert.equal(await page.locator('.score-bar').isVisible(), true)
  })
})
