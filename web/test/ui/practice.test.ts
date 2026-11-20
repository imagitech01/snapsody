import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Page } from 'playwright'
import { withApp } from './app.ts'
import { highlighted, noteIdsByBar, tab, tabBar, tapNote, textOf } from './journey.ts'
import { ID } from './pieces.ts'
import { HOMR_MARKS_FIXTURE, read } from '../helpers.ts'
import { barsScore } from './scores.ts'

// The practice journey (practice-app design D15, "practise: home, continue, play, loop with rest, metronome,
// show bar"). Its first part is the home (task 12.1; specs `practice-home`, `app-shell` "Main tabs"): what the
// start screen shows from the seeded store, and where its buttons go. The second part, below the home tests, is
// practising itself (task 13; frames 02.1 to 02.4, and design D17): the practice screen, its sheets and the session behind them.

test('practice home: it continues the last piece, lists the rotation and links to the library and to adding music', async () => {
  await withApp({ seed: 'library' }, async (app) => {
    const { page } = app
    await page.getByRole('heading', { name: 'Let’s practise', level: 1 }).waitFor()
    await page.getByText('Pick up where you left off.').waitFor()

    // Pick up where you left off: "Ode to Joy", bar 2 of its 12 bars, 60 BPM, metronome on, no loop.
    const card = page.getByRole('region', { name: 'Continue practising' })
    assert.equal(await card.getByRole('heading', { name: 'Ode to Joy' }).count(), 1)
    assert.match(await textOf(card), /Bar 2 of 12 · 60 BPM/)
    assert.match(await textOf(card), /Metronome on · Loop off/)

    // The rotation is the favorites, with their length and a play button each; the others are not in it.
    await page.getByRole('heading', { name: 'In your rotation' }).waitFor()
    await page.getByRole('button', { name: 'Play “C major warm-up”' }).waitFor()
    assert.match(await textOf(page.getByRole('button', { name: /^C major warm-up/ })), /4 bars/)
    assert.equal(await page.getByRole('button', { name: /Play “Even eighths”/ }).count(), 0)
    assert.equal(await page.getByRole('button', { name: /Play “Ode to Joy”/ }).count(), 0)

    // The tab bar is there, and Practice is the current tab.
    assert.equal(await tab(page, 'Practice').getAttribute('aria-current'), 'page')

    // Continue opens that piece, and practising hides the tabs until the user goes back.
    await card.getByRole('button', { name: 'Continue practising' }).click()
    assert.deepEqual(await app.screen(), { name: 'practice', pieceId: ID.ode })
    await page.locator('[data-screen="practice"]').waitFor()
    assert.equal(await tabBar(page).count(), 0, 'no tab bar while practising')
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await page.getByRole('heading', { name: 'Let’s practise' }).waitFor()
    assert.equal(await tabBar(page).count(), 1)

    // The play button of a rotation entry opens the piece and starts it.
    await page.getByRole('button', { name: 'Play “C major warm-up”' }).click()
    assert.deepEqual(await app.screen(), { name: 'practice', pieceId: ID.warmUp, autoplay: true })
    assert.equal(await app.back(), true, 'the system back button goes back a screen')
    await page.getByRole('heading', { name: 'Let’s practise' }).waitFor()

    // The row itself opens the piece without playing.
    await page.getByRole('button', { name: /^C major warm-up/ }).click()
    assert.deepEqual(await app.screen(), { name: 'practice', pieceId: ID.warmUp })
    await app.back()

    // "See all" opens the favorites, "Browse all music" the library, "Add music" starts adding music.
    await page.getByRole('button', { name: 'See all' }).click()
    assert.deepEqual(await app.screen(), { name: 'favorites' })
    await page.getByRole('heading', { name: 'Favorites', level: 1 }).waitFor()
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await page.getByRole('button', { name: 'Add music' }).click()
    assert.deepEqual(await app.screen(), { name: 'add-music' })
    await app.back()
    await page.getByRole('button', { name: 'Browse all music' }).click()
    await page.getByRole('heading', { name: 'My music', level: 1 }).waitFor()
    assert.equal(await tab(page, 'Library').getAttribute('aria-current'), 'page')

    // At a start screen with nothing open, back is for the phone: the app is left.
    assert.equal(await app.back(), false)
  })
})

test('practice home: the card shows the loop, tempo and bar the piece was left with (the committed store)', async () => {
  await withApp({ seed: 'v2' }, async ({ page }) => {
    const card = page.getByRole('region', { name: 'Continue practising' })
    await card.getByRole('heading', { name: 'Waltz study in G' }).waitFor()
    assert.match(await textOf(card), /Bar 10 of 14 · 72 BPM/)
    assert.match(await textOf(card), /Metronome on · Loop 9–12/)
    // It is a favorite too, so it is also in the rotation.
    await page.getByRole('button', { name: 'Play “Waltz study in G”' }).waitFor()
  })
})

test('practice home: with pieces but none practised there is no continue card, and an empty rotation says how to fill it', async () => {
  await withApp({ seed: 'unpractised' }, async ({ page }) => {
    await page.getByText('Choose a piece to start.').waitFor()
    assert.equal(await page.getByRole('region', { name: 'Continue practising' }).count(), 0)
    await page.getByText('Star a piece and it appears here.').waitFor()
    assert.equal(await page.getByRole('button', { name: 'See all' }).count(), 0, 'no link to an empty list')
    await page.getByRole('button', { name: 'Add music' }).waitFor()
  })
})

test('practice home: a first launch invites the user to add the first music, with no empty lists', async () => {
  await withApp({ seed: '' }, async (app) => {
    const { page } = app
    await page.getByRole('heading', { name: 'Let’s practise', level: 1 }).waitFor()
    const invitation = page.getByRole('region', { name: 'Add your first music' })
    await invitation.getByRole('heading', { name: 'Add your first music' }).waitFor()
    assert.match(await textOf(invitation), /Photograph the pages, and Snapsody plays them\./)
    assert.equal(await page.getByRole('heading', { name: 'In your rotation' }).count(), 0, 'no empty rotation')
    assert.equal(await page.getByRole('region', { name: 'Continue practising' }).count(), 0)
    await invitation.getByRole('button', { name: 'Add music' }).click()
    assert.deepEqual(await app.screen(), { name: 'add-music' })
  })
})

test('practice home: it is read again when it is shown again, so a practised piece becomes the continue piece', async () => {
  await withApp({ seed: 'library' }, async (app) => {
    const { page } = app
    await page.getByRole('region', { name: 'Continue practising' }).getByRole('heading', { name: 'Ode to Joy' }).waitFor()
    // The user opens another piece; while it is open a practice session sets lastPracticed (nothing else tells the store).
    await page.getByRole('button', { name: 'Play “C major warm-up”' }).click()
    await page.locator('[data-screen="practice"]').waitFor()
    await page.evaluate(
      (id) => window.__test!.shell.library.update(id, { lastPracticed: new Date().toISOString() }),
      ID.warmUp,
    )
    await app.back()
    await page.getByRole('region', { name: 'Continue practising' }).getByRole('heading', { name: 'C major warm-up' }).waitFor()
  })
})

// ---- Practising a piece (task 13.1) --------------------------------------------------------------------------

/** Freezes the page's clock where it is: from here on time moves only with `page.clock.runFor`, so the music is exactly where a test puts it. */
async function freeze(page: Page): Promise<void> {
  // The margin has to outlast the round trip between the two calls, also while the page is busy decoding
  // samples (the metronome switched on just before): pausing at a time already past is an error.
  const now = await page.evaluate(() => Date.now())
  await page.clock.pauseAt(new Date(now + 250))
}

/** Runs the clock on in steps until [done] holds (the sound loads in real time, the music in fake time). */
async function until(page: Page, done: () => Promise<boolean>, what: string, step = 100): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (await done()) return
    await page.clock.runFor(step)
    await page.waitForTimeout(5)
  }
  throw new Error(`never: ${what}`)
}

/** The score has been drawn. */
const scoreDrawn = (page: Page) => page.locator('.score-view svg g.note').first().waitFor()
/**
 * Where the music is, from the session ("Bar 2 of 12 Following" or "Bar 3 of 12 Showing bar 11"): the header shows only the
 * title (design D19), so the position is read from the open session through the test hook.
 */
const where = (page: Page) =>
  page.evaluate(() => {
    const p = window.__test!.practice()
    return p ? `Bar ${p.bar} of ${p.bars} ${p.following ? 'Following' : `Showing bar ${p.shownBar}`}` : ''
  })
const tempoOf = (page: Page) => page.getByRole('group', { name: 'Tempo' }).locator('.stepper-number').textContent()

/** The sheet that is open, by its title. */
const sheet = (page: Page, name: string) => page.getByRole('dialog', { name })
const openTools = async (page: Page) => {
  await page.getByRole('button', { name: 'Practice tools' }).click()
  await sheet(page, 'Practice tools').waitFor()
}
const piece = (app: { file(path: string): Promise<string | undefined> }, id: string) => app.file(`pieces/${id}/piece.json`)
const practiceJson = async (app: { file(path: string): Promise<string | undefined> }, id: string) =>
  JSON.parse((await app.file(`pieces/${id}/practice.json`)) ?? 'null') as Record<string, unknown> | null
/** The bar (from 1) of the note that the score highlights, or null. */
const highlightedBar = (page: Page): Promise<number | null> =>
  page.evaluate(() => {
    const note = document.querySelector('.score-view g.note.hl')
    const bars = [...document.querySelectorAll('.score-view g.measure')]
    const bar = note ? bars.findIndex((m) => m.contains(note)) : -1
    return bar < 0 ? null : bar + 1
  })

test('practise: continue opens the piece where it was left, Play moves the bar on, Pause stops it where it was', async () => {
  await withApp({ seed: 'library' }, async (app) => {
    const { page } = app
    await page.getByRole('region', { name: 'Continue practising' }).getByRole('button', { name: 'Continue practising' }).click()
    await page.locator('[data-screen="practice"]').waitFor()
    await scoreDrawn(page)

    // The note of the written tempo ("♩ = 60") is a glyph of Verovio's music font, which the SVG carries as a data: font.
    const tempoFont = await page.evaluate(async () => {
      const glyph = document.querySelector('.score-view g.tempo tspan[font-family="Leipzig"]')
      const faces = glyph ? await document.fonts.load('40px Leipzig', glyph.textContent ?? '').catch(() => []) : []
      return { glyph: !!glyph, loaded: faces.some((f) => f.status === 'loaded') }
    })
    assert.deepEqual(tempoFont, { glyph: true, loaded: true }, 'the tempo mark\'s note glyph has its font (not a box)')

    // Ode to Joy as it was left: bar 2 of 12 at 60 BPM, metronome on, nothing playing, nothing looping.
    assert.equal(await where(page), 'Bar 2 of 12 Following')
    assert.equal(await textOf(page.locator('.practice-header')), 'Ode to Joy', 'the header has only the title (design D19)')
    assert.equal(await page.getByText(/Bar \d+ of \d+|Following/).count(), 0, 'no bar position or follow state on the screen')
    assert.equal(await tempoOf(page), '60')
    assert.equal(await page.getByRole('button', { name: 'Metronome' }).getAttribute('aria-pressed'), 'true')
    await page.getByRole('button', { name: 'Loop off' }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'Back', exact: true }).isVisible(), true)
    assert.equal(await page.evaluate(() => window.__test!.platform.device.keepAwake), false, 'the screen may turn off while nothing plays')

    // Play: the label turns into Pause, and with the sound loaded the sounding note is the one of bar 2, and the screen stays on.
    await page.getByRole('button', { name: 'Play', exact: true }).click()
    await page.getByRole('button', { name: 'Pause', exact: true }).waitFor()
    await until(page, async () => (await highlighted(page)) !== null, 'a note is highlighted')
    assert.equal(await highlightedBar(page), 2)
    assert.equal(await page.evaluate(() => window.__test!.platform.device.keepAwake), true, 'the screen stays on while playing')
    await freeze(page)
    await page.clock.runFor(5000) // 60 BPM in 4/4: a bar lasts 4 s
    assert.match(await where(page), /Bar 3 of 12/)
    await page.getByRole('button', { name: 'Pause', exact: true }).click()
    await page.getByRole('button', { name: 'Play', exact: true }).waitFor()
    assert.equal(await page.evaluate(() => window.__test!.platform.device.keepAwake), false, 'paused: the phone may turn the screen off again')
    assert.match(await where(page), /Bar 3 of 12/)
    await page.clock.runFor(8000)
    assert.match(await where(page), /Bar 3 of 12/, 'paused: the bar stays')

    // Resume goes on from there, and the app going to the background pauses it with the bar kept.
    await page.getByRole('button', { name: 'Play', exact: true }).click()
    await page.getByRole('button', { name: 'Pause', exact: true }).waitFor()
    await app.pause()
    await page.getByRole('button', { name: 'Play', exact: true }).waitFor()
    assert.match(await where(page), /Bar 3 of 12/)
    assert.equal((await practiceJson(app, ID.ode))?.bar, 3, 'the bar is saved when playback pauses')

    // Back leaves the piece, and the home shows where it was left.
    await app.resume()
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    const card = page.getByRole('region', { name: 'Continue practising' })
    await card.getByRole('heading', { name: 'Ode to Joy' }).waitFor()
    assert.match(await textOf(card), /Bar 3 of 12 · 60 BPM/, 'the continue card is read after the session saved')
  })
})

test('practise: the tempo and the metronome are set at once and remembered; Restart goes back to bar 1', async () => {
  await withApp({ seed: 'library' }, async (app) => {
    const { page } = app
    await page.getByRole('button', { name: 'Continue practising' }).last().click()
    await scoreDrawn(page)

    const faster = page.getByRole('button', { name: 'Faster' })
    const slower = page.getByRole('button', { name: 'Slower' })
    await faster.click()
    await faster.click()
    await slower.click()
    assert.equal(await tempoOf(page), '61', 'one beat per minute a press')
    // A change is saved after a quiet moment.
    assert.equal((await practiceJson(app, ID.ode))?.tempo, 60)
    await page.clock.runFor(1500)
    await page.waitForTimeout(50)
    assert.equal((await practiceJson(app, ID.ode))?.tempo, 61)

    const metronome = page.getByRole('button', { name: 'Metronome' })
    await metronome.click()
    assert.equal(await metronome.getAttribute('aria-pressed'), 'false')
    assert.match(await textOf(metronome), /Metronome Off/)
    await metronome.click()
    assert.equal(await metronome.getAttribute('aria-pressed'), 'true')

    // Holding a button keeps stepping, faster the longer it is held; letting go stops it (and does not step once more).
    await freeze(page)
    await faster.hover()
    await page.mouse.down()
    assert.equal(await tempoOf(page), '62', 'a press steps at once')
    await page.clock.runFor(350)
    assert.equal(await tempoOf(page), '62', 'a short press steps once')
    await page.clock.runFor(650) // 1 s held: repeats at 400, 550, 685, 806 and 916 ms
    assert.equal(await tempoOf(page), '67')
    await page.mouse.up()
    await page.clock.runFor(1000)
    assert.equal(await tempoOf(page), '67', 'letting go stops it')
    // Held down to the end of the range: it stops there, with the button disabled.
    await slower.hover()
    await page.mouse.down()
    await page.clock.runFor(10_000)
    await page.mouse.up()
    assert.equal(await tempoOf(page), '30')
    assert.equal(await slower.isDisabled(), true)
    await faster.click()
    assert.equal(await tempoOf(page), '31', 'a click after a hold steps once')
    await page.clock.resume()

    // The ends of the range disable the buttons (30 to 200).
    while (!(await slower.isDisabled())) await slower.click()
    assert.equal(await tempoOf(page), '30')
    assert.equal(await slower.isDisabled(), true)

    // Restart: bar 1 (no loop), and the view goes with it.
    await page.getByRole('button', { name: 'Restart', exact: true }).click()
    assert.match(await where(page), /Bar 1 of 12/)

    // Back at once: the home is read after the session saved, so its card shows the new bar and tempo.
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    const card = page.getByRole('region', { name: 'Continue practising' })
    await card.getByRole('heading', { name: 'Ode to Joy' }).waitFor()
    await page.waitForFunction(() => /Bar 1 of 12 · 30 BPM/.test(document.querySelector('[aria-label="Continue practising"]')?.textContent ?? ''))
  })
})

/** Counts the clicks the app makes (each one is an oscillator, webaudio.ts) from now on, in the page. */
const countClicks = (page: Page) =>
  page.evaluate(() => {
    const proto = BaseAudioContext.prototype
    const real = proto.createOscillator
    const w = window as unknown as { clickCount: number }
    w.clickCount = 0
    proto.createOscillator = function (this: BaseAudioContext) {
      w.clickCount++
      return real.call(this)
    }
  })
const clicks = (page: Page) => page.evaluate(() => (window as unknown as { clickCount: number }).clickCount)
/** The metronome toggle says it clicks on its own. */
const alone = async (page: Page) => /metronome-toggle--alone/.test((await page.getByRole('button', { name: 'Metronome' }).getAttribute('class')) ?? '')

test('practise: the metronome on its own: silent when the piece opens with it on, clicking when switched on while stopped, handing over to Play, and silenced by pause, the background and leaving (change steady-notes-and-free-metronome)', async () => {
  await withApp({ seed: 'library' }, async (app) => {
    const { page } = app
    await countClicks(page)
    // Ode to Joy was left with the metronome on: it shows as on and nothing sounds (spec "Reopen with the metronome on").
    await page.getByRole('button', { name: 'Continue practising' }).last().click()
    await scoreDrawn(page)
    const metronome = page.getByRole('button', { name: 'Metronome' })
    assert.equal(await metronome.getAttribute('aria-pressed'), 'true')
    await page.clock.runFor(3000)
    assert.equal(await clicks(page), 0, 'nothing sounds until a press')
    assert.equal(await alone(page), false)

    // Off and on again while stopped: it clicks on its own (the first gesture makes the sound), the Play button stays Play.
    await metronome.click()
    await metronome.click()
    await until(page, () => alone(page), 'the metronome clicks on its own')
    assert.equal(await metronome.getAttribute('aria-pressed'), 'true')
    await page.getByRole('button', { name: 'Play', exact: true }).waitFor()
    const before = await clicks(page)
    await page.clock.runFor(3000)
    assert.ok((await clicks(page)) >= before + 2, '60 BPM: about a click a second')
    assert.equal(await highlighted(page), null, 'and no music plays')

    // Play takes over: the music starts, and the toggle no longer says it clicks on its own; paused it is silent.
    await page.getByRole('button', { name: 'Play', exact: true }).click()
    await page.getByRole('button', { name: 'Pause', exact: true }).waitFor()
    assert.equal(await alone(page), false)
    await until(page, async () => (await highlighted(page)) !== null, 'a note is highlighted')
    await page.getByRole('button', { name: 'Pause', exact: true }).click()
    await page.getByRole('button', { name: 'Play', exact: true }).waitFor()
    await page.clock.runFor(200)
    const paused = await clicks(page)
    await page.clock.runFor(3000)
    assert.equal(await clicks(page), paused, 'paused: silent')
    assert.equal(await alone(page), false)

    // On its own again, then the app goes to the background: it stops, and does not come back with the app.
    await metronome.click()
    await metronome.click()
    await until(page, () => alone(page), 'the metronome clicks on its own again')
    await app.pause()
    await page.clock.runFor(200)
    assert.equal(await alone(page), false)
    const backgrounded = await clicks(page)
    await app.resume()
    await page.clock.runFor(3000)
    assert.equal(await clicks(page), backgrounded, 'silent in the background and after coming back')
    assert.equal(await metronome.getAttribute('aria-pressed'), 'true', 'still switched on')

    // On its own, then leaving the piece stops it.
    await metronome.click()
    await metronome.click()
    await until(page, () => alone(page), 'the metronome clicks on its own once more')
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await page.getByRole('region', { name: 'Continue practising' }).waitFor()
    await page.clock.runFor(200)
    const left = await clicks(page)
    await page.clock.runFor(3000)
    assert.equal(await clicks(page), left, 'no click after the practice screen is left')
  })
})

test('practise: tapping a note moves where Play starts (spec "Tap to start from a note")', async () => {
  await withApp({ seed: 'library' }, async (app) => {
    const { page } = app
    await page.getByRole('button', { name: 'Continue practising' }).last().click()
    await scoreDrawn(page)
    const bar9 = noteIdsByBar(barsScore(12, 60))[8]!
    await tapNote(page, bar9[2]!)
    assert.match(await where(page), /Bar 9 of 12/)
    await page.getByRole('button', { name: 'Play', exact: true }).click()
    await until(page, async () => (await highlighted(page)) !== null, 'a note is highlighted')
    assert.equal(await highlightedBar(page), 9)
    assert.equal(await highlighted(page), bar9[2], 'it starts at the tapped note')
  })
})

test('practise: the landscape layout is one bar of header and controls over a score that has the rest of the height, and turning the phone mid-play neither stops the music nor loses the bar', async () => {
  await withApp({ seed: 'library', viewport: { width: 780, height: 360 } }, async (app) => {
    const { page } = app
    await page.getByRole('button', { name: 'Continue practising' }).last().click()
    await scoreDrawn(page)
    const box = (locator: ReturnType<Page['locator']>) => locator.evaluate((element) => element.getBoundingClientRect().toJSON() as { top: number; bottom: number; left: number; right: number; height: number; width: number })

    // Landscape (frame 02.2, design D18): one bar on top, about 48 high: Back, the piece's title, Restart,
    // Play, the tempo, the metronome, Loop and the tools; no labels under the buttons.
    assert.equal(await page.locator('.practice-bar, .practice-where').count(), 0, 'no bar position in the header')
    // One row: Back, Restart, Play, the tempo, the metronome, Loop and the tools at the same height.
    const heights = await Promise.all(
      [
        page.getByRole('button', { name: 'Back', exact: true }),
        page.getByRole('button', { name: 'Restart' }),
        page.getByRole('button', { name: 'Play', exact: true }),
        page.getByRole('group', { name: 'Tempo' }),
        page.getByRole('button', { name: 'Metronome' }),
        page.getByRole('button', { name: 'Loop off' }),
        page.getByRole('button', { name: 'Practice tools' }),
      ].map(
        async (locator) => {
          const r = await box(locator)
          return Math.round((r.top + r.bottom) / 2)
        },
      ),
    )
    assert.ok(Math.max(...heights) - Math.min(...heights) <= 2, `the controls share a row: ${heights.join(', ')}`)
    assert.equal(await page.locator('.practice-action-label').first().isVisible(), false, 'no labels in landscape')
    assert.ok((await box(page.locator('.loop-label'))).width <= 2, 'Loop shows no words in landscape (they stay its name)')
    assert.equal(await page.getByRole('button', { name: 'Metronome' }).getAttribute('aria-pressed'), 'true', 'the metronome icon shows its state')
    const score = await box(page.locator('.score-island'))
    const restart = await box(page.getByRole('button', { name: 'Restart' }))
    assert.ok(score.top >= restart.bottom, 'the score is under the bar')
    assert.ok(score.top <= 60, `the bar is about 48 high (the score starts at ${score.top}px)`)
    assert.ok(score.height >= 360 - 60 - 16, `the score has all the height that is left (${score.height}px)`)

    // Play in landscape, then turn the phone to portrait while it plays: still playing, and the sounding bar stays in view.
    await page.getByRole('button', { name: 'Play', exact: true }).click()
    await until(page, async () => (await highlighted(page)) !== null, 'a note is highlighted')
    await freeze(page)
    await page.clock.runFor(6000) // bar 3 of 60 BPM, 4/4 (the music started in bar 2)
    assert.match(await where(page), /Bar 3 of 12/)
    await page.setViewportSize({ width: 360, height: 780 })
    await page.clock.runFor(1000) // the score is laid out again
    await page.getByRole('button', { name: 'Pause', exact: true }).waitFor()
    assert.match(await where(page), /Bar 3 of 12/)
    assert.equal(await page.locator('.practice-action-label').first().isVisible(), true, 'portrait: labels under Restart and Play')
    const portraitTitle = await box(page.getByRole('heading', { name: 'Ode to Joy' }))
    assert.ok(portraitTitle.height < 30, 'portrait: the title is one line, with no bar position under it')
    assert.equal(await page.locator('.practice-bar, .practice-where').count(), 0)
    const sounding = await page.evaluate(() => {
      const scroller = document.querySelector('.score-island')!.getBoundingClientRect()
      const note = document.querySelector('.score-view g.note.hl')?.getBoundingClientRect()
      return !!note && note.top >= scroller.top && note.bottom <= scroller.bottom
    })
    assert.equal(sounding, true, 'the sounding note is in view after the turn')
    await page.clock.runFor(4000)
    assert.match(await where(page), /Bar 4 of 12/, 'and the music went on')
  })
})

test('practise: scrolling to another bar leaves the music alone, and Return to playing brings the view back (spec "Look at bar 7 while playing")', async () => {
  // A low window, so that the 12 bars do not all fit and the view has somewhere to go.
  await withApp({ seed: 'library', viewport: { width: 360, height: 600 } }, async (app) => {
    const { page } = app
    await page.getByRole('button', { name: 'Continue practising' }).last().click()
    await scoreDrawn(page)
    const returnButton = page.getByRole('button', { name: 'Return to playing' })
    assert.equal(await returnButton.count(), 0, 'nothing to return from while the view follows')
    const bar11 = noteIdsByBar(barsScore(12, 60))[10]![0]!
    const inView = (id: string) =>
      page.evaluate((noteId) => {
        const scroller = document.querySelector('.score-island')!.getBoundingClientRect()
        const note = document.querySelector(`.score-view g.note[id="${noteId}"]`)?.getBoundingClientRect()
        return !!note && note.top >= scroller.top && note.bottom <= scroller.bottom
      }, id)

    await page.getByRole('button', { name: 'Play', exact: true }).click()
    await until(page, async () => (await highlighted(page)) !== null, 'a note is highlighted')
    await freeze(page)
    assert.equal(await inView(bar11), false, 'bar 11 is out of view to begin with')

    // The user scrolls the score away (design D17: there is no "Go to bar" any more): the view stays where they put it,
    // the music is not touched, and the way back is at hand.
    const scrollTop = () => page.locator('.score-island').evaluate((element) => Math.round(element.scrollTop))
    await page.locator('.score-island').hover()
    await page.mouse.wheel(0, 2000)
    await page.clock.runFor(500)
    await returnButton.waitFor()
    assert.equal(await inView(bar11), true, 'bar 11 is in view')
    assert.match(await where(page), /Showing bar \d+/)
    assert.match(await where(page), /Bar 2 of 12/, 'the music is still in bar 2')
    const away = await scrollTop()
    await page.getByRole('button', { name: 'Pause', exact: true }).waitFor()
    await page.clock.runFor(4000)
    assert.match(await where(page), /Bar 3 of 12.*Showing bar \d+/, 'it keeps playing on, and the view stays')
    assert.equal(await scrollTop(), away, 'the view did not move')

    // Return to playing: following again, and the view is where the music is.
    await returnButton.click()
    await page.clock.runFor(500)
    assert.match(await where(page), /Following/)
    assert.equal(await returnButton.count(), 0)
    assert.equal(await inView(bar11), false)
    assert.equal(await highlightedBar(page), 3)
    assert.equal(await inView(noteIdsByBar(barsScore(12, 60))[2]![0]!), true, 'bar 3 is in view again')
  })
})

test('practise: loop bars 2 to 3 with a bar of rest; the loop is kept, shown on the button, and Restart goes to its first bar', async () => {
  await withApp({ seed: 'library' }, async (app) => {
    const { page } = app
    await page.getByRole('button', { name: 'Continue practising' }).last().click()
    await scoreDrawn(page)

    // The loop sheet starts from the bar the user is at: bars 2 to 3, no rest.
    await page.getByRole('button', { name: 'Loop off' }).click()
    const loop = sheet(page, 'Repeat a passage')
    await loop.waitFor()
    assert.equal(await loop.getByLabel('From bar').inputValue(), '2')
    assert.equal(await loop.getByLabel('To bar').inputValue(), '3')
    assert.equal(await loop.getByRole('radio', { name: 'Off' }).getAttribute('aria-checked'), 'true')
    assert.equal(await loop.getByRole('button', { name: 'Switch loop off' }).count(), 0, 'no loop to switch off yet')

    // The two ends stay in order: a last bar before the first takes the first with it.
    await loop.getByLabel('To bar').selectOption('1')
    assert.equal(await loop.getByLabel('From bar').inputValue(), '1')
    await loop.getByLabel('From bar').selectOption('2')
    await loop.getByLabel('To bar').selectOption('3')
    await loop.getByRole('radio', { name: '1 bar' }).click()
    await loop.getByRole('button', { name: 'Start looping bars 2–3' }).click()
    await loop.waitFor({ state: 'detached' })
    await page.getByRole('button', { name: 'Loop 2–3' }).waitFor()
    await page.clock.runFor(1500)
    await page.waitForTimeout(50)
    const saved = await practiceJson(app, ID.ode)
    assert.deepEqual(saved?.loop, { start: 2, end: 3 })
    assert.equal(saved?.loopRest, 1)

    // Play: bars 2 and 3, a bar of silence (the bar stays at 3), and bar 2 again.
    await page.getByRole('button', { name: 'Play', exact: true }).click()
    await until(page, async () => (await highlighted(page)) !== null, 'a note is highlighted')
    assert.equal(await highlightedBar(page), 2)
    await freeze(page)
    await page.clock.runFor(6000)
    assert.equal(await highlightedBar(page), 3)
    await page.clock.runFor(4000) // 10 s in: the rest after bar 3
    assert.match(await where(page), /Bar 3 of 12/, 'in the rest the bar stays at the last one')
    await page.clock.runFor(4000) // 14 s in: the second pass
    assert.equal(await highlightedBar(page), 2)

    // Restart goes back to the first bar of the loop, and keeps playing.
    await page.clock.runFor(5000)
    await page.getByRole('button', { name: 'Restart', exact: true }).click()
    await page.clock.runFor(500)
    assert.match(await where(page), /Bar 2 of 12/)
    await page.getByRole('button', { name: 'Pause', exact: true }).click()

    // Reopening the sheet shows the loop as it is, and the loop can be switched off.
    await page.getByRole('button', { name: 'Loop 2–3' }).click()
    assert.equal(await loop.getByLabel('From bar').inputValue(), '2')
    assert.equal(await loop.getByRole('radio', { name: '1 bar' }).getAttribute('aria-checked'), 'true')
    await loop.getByRole('button', { name: 'Switch loop off' }).click()
    await page.getByRole('button', { name: 'Loop off' }).waitFor()
    await page.clock.runFor(1500)
    await page.waitForTimeout(50)
    assert.equal((await practiceJson(app, ID.ode))?.loop, null)

    // Closing the sheet without starting changes nothing.
    await page.getByRole('button', { name: 'Loop off' }).click()
    await loop.getByLabel('To bar').selectOption('5')
    await loop.getByRole('button', { name: 'Close' }).click()
    await page.getByRole('button', { name: 'Loop off' }).waitFor()
  })
})

test('practise: the count-in is switched on in Settings, for every piece, and counted out loud on the screen before the music starts (spec "Count-in")', async () => {
  await withApp({ seed: 'library' }, async (app) => {
    const { page } = app
    await page.evaluate((id) => window.__test!.shell.library.writePractice(id, { bar: 1, tempo: 120, loop: null, loopRest: 0, metronome: false }), ID.ode)

    // A general setting (design D17): switched in Settings only, kept in settings.json and not with a piece.
    await tab(page, 'Settings').click()
    await page.getByText('One bar of clicks before the music starts, in every piece').waitFor()
    await page.getByRole('switch', { name: 'Count-in', checked: false }).click()
    await page.getByRole('switch', { name: 'Count-in', checked: true }).waitFor()
    await until(page, async () => JSON.parse((await app.file('settings.json')) ?? '{}').countIn === true, 'the count-in saved with the settings')

    await page.evaluate((id) => window.__test!.shell.router.push({ name: 'practice', pieceId: id }), ID.ode)
    await scoreDrawn(page)
    const count = page.getByRole('status', { name: /^Count-in/ })
    assert.equal(await count.count(), 0, 'no count before Play')
    await page.getByRole('button', { name: 'Play', exact: true }).click()
    await count.waitFor()
    const seen = new Set<string>()
    await until(
      page,
      async () => {
        for (const label of await count.evaluateAll((elements) => elements.map((e) => e.getAttribute('aria-label') ?? ''))) seen.add(label)
        return (await highlighted(page)) !== null
      },
      'the music starts after the count',
      50,
    )
    assert.ok(seen.has('Count-in 1 of 4') && seen.has('Count-in 4 of 4'), `counted ${[...seen].join(' | ')}`)
    await page.clock.runFor(200)
    assert.equal(await count.count(), 0, 'the count is gone once the music plays')
    assert.equal(await highlightedBar(page), 1)
    assert.equal((await practiceJson(app, ID.ode))?.countIn, undefined, 'not with the piece')

    // Another piece counts in too.
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await page.evaluate((id) => window.__test!.shell.router.push({ name: 'practice', pieceId: id }), ID.warmUp)
    await scoreDrawn(page)
    await page.getByRole('button', { name: 'Play', exact: true }).click()
    await count.waitFor()
  })
})

test('practise: the tools sheet has Edit and Favorite only; it stars the piece, opens the editor, and back closes the sheet before the screen (spec "Back with the tools sheet open")', async () => {
  await withApp({ seed: 'library' }, async (app) => {
    const { page } = app
    await page.getByRole('button', { name: 'Continue practising' }).last().click()
    await scoreDrawn(page)

    await openTools(page)
    const tools = sheet(page, 'Practice tools')
    await tools.getByText('Everything else, only when you need it.').waitFor()
    await tools.getByText('Your score stays open while you adjust these.').waitFor()
    // Design D17: no Go to bar, no instrument, no Follow playback, no count-in.
    const rows = await tools.locator('.sheet-rows > *').evaluateAll((elements) => elements.map((e) => e.querySelector('.list-row-title')?.textContent ?? ''))
    assert.deepEqual(rows, ['Edit score', 'Favorite'])

    // The star: "Ode to Joy" is not a favorite; the switch makes it one, in the file and everywhere that shows it.
    const favorite = tools.getByRole('switch', { name: 'Favorite' })
    assert.equal(await favorite.getAttribute('aria-checked'), 'false')
    await favorite.click()
    await tools.getByRole('switch', { name: 'Favorite', checked: true }).waitFor()
    assert.match((await piece(app, ID.ode)) ?? '', /"favorite": true/)
    await favorite.click()
    await tools.getByRole('switch', { name: 'Favorite', checked: false }).waitFor()
    await favorite.click()
    await tools.getByRole('switch', { name: 'Favorite', checked: true }).waitFor()

    // Back closes the sheet first; the piece stays open.
    assert.equal(await app.back(), true)
    await tools.waitFor({ state: 'detached' })
    assert.equal((await app.screen()).name, 'practice')
    assert.match(await where(page), /Following/)

    // Edit pushes the editor (a placeholder until group 15), and back comes back to the piece.
    await openTools(page)
    await tools.getByRole('button', { name: /^Edit score/ }).click()
    assert.deepEqual(await app.screen(), { name: 'editor', pieceId: ID.ode })
    await tools.waitFor({ state: 'detached' })
    assert.equal(await app.back(), true)
    await page.locator('[data-screen="practice"]').waitFor()
    await scoreDrawn(page)

    // Leaving: the star shows in the rotation of the home.
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await page.getByRole('button', { name: 'Play “Ode to Joy”' }).waitFor()
  })
})

test('practise: Play and the tools read the saved score again when the editor was opened over the piece (design D12)', async () => {
  await withApp({ seed: 'library' }, async (app) => {
    const { page } = app
    // "C major warm-up" is marked at 60 and has no tempo of the user's own: its marking decides.
    await page.getByRole('button', { name: 'Play “C major warm-up”' }).click()
    await page.locator('[data-screen="practice"]').waitFor()
    await scoreDrawn(page)
    assert.equal(await tempoOf(page), '60')
    // Autoplay: the music starts by itself, from the rotation's play button.
    await page.getByRole('button', { name: 'Pause', exact: true }).waitFor()
    await openTools(page)
    await sheet(page, 'Practice tools').getByRole('button', { name: /^Edit score/ }).click()
    await page.locator('[data-screen="editor"]').waitFor()
    // The editor saves a score marked at 90 and the screen under it comes back ("Save & practice" from an editor opened over practice).
    await page.evaluate(
      async ({ id, xml }) => {
        const { library, router } = window.__test!.shell
        const info = await library.info(id)
        await library.writeScore(id, xml, info.score)
        router.pop()
      },
      { id: ID.warmUp, xml: barsScore(4, 90) },
    )
    await page.locator('[data-screen="practice"]').waitFor()
    await scoreDrawn(page)
    assert.equal(await tempoOf(page), '90', 'the session was opened again on the saved score')
    await page.getByRole('button', { name: 'Play', exact: true }).waitFor()
    await page.clock.runFor(500)
    assert.equal(await page.getByRole('button', { name: 'Pause', exact: true }).count(), 0, 'it does not start playing again by itself')
  })
})

test('practise: a stopped piece shows the bar the user moves to (Restart), and the view goes there', async () => {
  await withApp({ seed: 'library', viewport: { width: 360, height: 600 } }, async (app) => {
    const { page } = app
    await page.evaluate(
      (id) => window.__test!.shell.library.writePractice(id, { bar: 11, tempo: null, loop: null, loopRest: 0, metronome: false }),
      ID.ode,
    )
    await page.evaluate((id) => window.__test!.shell.router.push({ name: 'practice', pieceId: id }), ID.ode)
    await scoreDrawn(page)
    const bars = noteIdsByBar(barsScore(12, 60))
    const inView = (id: string) =>
      page.evaluate((noteId) => {
        const scroller = document.querySelector('.score-island')!.getBoundingClientRect()
        const note = document.querySelector(`.score-view g.note[id="${noteId}"]`)?.getBoundingClientRect()
        return !!note && note.top >= scroller.top && note.bottom <= scroller.bottom
      }, id)
    await page.clock.runFor(500)
    assert.match(await where(page), /Bar 11 of 12/)
    assert.equal(await inView(bars[10]![0]!), true, 'it opens with the saved bar in view')
    assert.equal(await inView(bars[0]![0]!), false)
    await page.getByRole('button', { name: 'Restart', exact: true }).click()
    await page.clock.runFor(500)
    assert.match(await where(page), /Bar 1 of 12/)
    assert.equal(await inView(bars[0]![0]!), true, 'Restart shows bar 1')
  })
})

test('practise: a piece that is not there, or whose sound will not load, is said so on the screen and nothing breaks', async () => {
  await withApp({ seed: 'library' }, async (app) => {
    const { page } = app
    await page.evaluate(() => window.__test!.shell.router.push({ name: 'practice', pieceId: '00000000-0000-4000-8000-0000000000ff' }))
    await page.getByRole('alert').filter({ hasText: 'This piece no longer exists.' }).waitFor()
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await page.getByRole('heading', { name: 'Let’s practise' }).waitFor()

    await page.route('**/samples/tenor-sax/map.json', (route) => route.fulfill({ status: 404, body: 'Not Found' }))
    await page.getByRole('button', { name: 'Continue practising' }).last().click()
    await scoreDrawn(page)
    // The metronome switched on while stopped is the first press that needs the sound: it is told the same way.
    const metronome = page.getByRole('button', { name: 'Metronome' })
    await metronome.click()
    await metronome.click()
    await page.getByRole('alert').filter({ hasText: 'The sound of this instrument could not be loaded.' }).waitFor()
    assert.equal(await alone(page), false)
    assert.equal(await metronome.getAttribute('aria-pressed'), 'true', 'the switch stays on')
    await page.getByRole('button', { name: 'Play', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: 'The sound of this instrument could not be loaded.' }).waitFor()
    await page.getByRole('button', { name: 'Play', exact: true }).waitFor()
    assert.equal(await page.evaluate(() => window.__test!.platform.device.keepAwake), false, 'a Play that failed does not hold the screen on')
  })
})

// ---- A multi-measure rest in practice (change more-marks, task 2.2; spec "Multi-measure rest in practice") ----------------

/** A piece made from the marks fixture: 12 bars, bars 8 to 11 one multi-measure rest. Practised at 120 BPM, two seconds a bar. */
async function makeMarksPiece(page: Page, practice: Record<string, unknown>): Promise<string> {
  const xml = read(HOMR_MARKS_FIXTURE)
  return page.evaluate(
    async ({ xml, practice }) => {
      const { platform, shell } = window.__test!
      platform.files.seed('scans/test/page.jpg', Uint8Array.of(0xff, 0xd8, 0xff, 0xe0))
      const info = await shell.library.create({ name: 'Long rest', musicxml: xml, bars: 12, repairs: [], pages: [{ source: 'scans/test/page.jpg', recognised: xml, firstBar: 1, lastBar: 12 }] })
      await shell.library.writePractice(info.id, { bar: 1, tempo: 120, loop: null, loopRest: 0, metronome: false, ...practice })
      await shell.router.push({ name: 'practice', pieceId: info.id })
      return info.id
    },
    { xml, practice },
  )
}

test('practise: a loop that starts after a multi-measure rest starts on its bar, and the bar box is over the bar after the symbol', async () => {
  await withApp({ seed: 'library' }, async (app) => {
    const { page } = app
    await makeMarksPiece(page, { loop: { start: 12, end: 12 } })
    await scoreDrawn(page)
    assert.equal(await page.locator('.score-view svg g.multiRest').count(), 1, 'the four bars are one symbol')
    assert.equal(await page.locator('.score-view svg g.measure').count(), 9, 'drawn as 9 measures for 12 bars')
    assert.equal(await where(page), 'Bar 1 of 12 Following')

    await page.getByRole('button', { name: 'Restart', exact: true }).click()
    assert.equal(await where(page), 'Bar 12 of 12 Following')
    // The bar box is over the last drawn measure (not one of the measures before it).
    const boxes = await page.evaluate(() => {
      const box = document.querySelector('.score-bar')!.getBoundingClientRect()
      const last = [...document.querySelectorAll('.score-view svg g.measure')].at(-1)!.getBoundingClientRect()
      return { dx: Math.abs(box.left - last.left), dy: Math.abs(box.top + 4 - last.top), width: Math.abs(box.width - last.width) }
    })
    assert.ok(boxes.dx < 3 && boxes.dy < 3 && boxes.width < 3, `the bar box covers the last measure: ${JSON.stringify(boxes)}`)

    await page.getByRole('button', { name: 'Play', exact: true }).click()
    await until(page, async () => (await highlighted(page)) !== null, 'a note is highlighted')
    assert.equal(await highlighted(page), noteIdsByBar(read(HOMR_MARKS_FIXTURE))[11]![0], 'the note of bar 12 sounds first')
    assert.equal(await page.locator('.score-view svg g.multiRest.hl').count(), 0)
  })
})

test('practise: a tap on the multi-measure rest starts at its first bar, and the symbol stays highlighted through its bars until the next note', async () => {
  await withApp({ seed: 'library' }, async (app) => {
    const { page } = app
    await makeMarksPiece(page, {})
    await scoreDrawn(page)
    const symbol = page.locator('.score-view svg g.multiRest')
    await symbol.scrollIntoViewIfNeeded()
    const box = await symbol.boundingBox()
    assert.ok(box, 'the symbol is drawn')
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
    assert.equal(await where(page), 'Bar 8 of 12 Following', 'a tap on the symbol goes to its first bar')

    await page.getByRole('button', { name: 'Play', exact: true }).click()
    await until(page, async () => (await page.locator('.score-view svg g.multiRest.hl').count()) === 1, 'the symbol is highlighted')
    await freeze(page)
    await page.clock.runFor(5000) // 5 s in: bar 10 of 12
    assert.match(await where(page), /Bar (9|10) of 12/)
    assert.equal(await page.locator('.score-view svg g.multiRest.hl').count(), 1, 'still the one symbol')
    await page.clock.runFor(4000) // 9 s in: bar 12
    assert.equal(await highlighted(page), noteIdsByBar(read(HOMR_MARKS_FIXTURE))[11]![0], 'the note after the run is highlighted on time')
    assert.equal(await page.locator('.score-view svg g.multiRest.hl').count(), 0)
  })
})
