import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Page } from 'playwright'
import { withApp } from './app.ts'
import { tab, textOf } from './journey.ts'

// The settings journey (practice-app design D15 and D19, "settings: default instrument"; tasks 12.3, 13.6; specs
// `app-shell` "General settings", `instruments` "Default instrument" and "Recorded instrument
// sounds"): the Settings tab on an empty phone, and on the committed store's settings (clarinet, and an old
// pitchReference and language that are ignored). The default instrument is one line that opens a sheet. There is no language
// setting: the app is English only (`paper-and-ink-and-about` D11).

const choice = (page: Page, group: string, name: string) => page.getByRole('radiogroup', { name: group }).getByRole('radio', { name, exact: true })
/** The one-line row of a setting on the Settings screen ("Default instrument  B♭ clarinet ›"). */
const line = (page: Page, title: string) => page.getByRole('button', { name: new RegExp(`^${title}`) })

/** The saved settings.json, parsed. */
async function saved(app: { file(path: string): Promise<string | undefined> }): Promise<unknown> {
  const text = await app.file('settings.json')
  return text === undefined ? undefined : JSON.parse(text)
}

test('settings: the default instrument is one line that opens a sheet with all instruments, starts with the tenor saxophone and is kept', async () => {
  await withApp({ seed: '' }, async (app) => {
    const { page } = app
    await tab(page, 'Settings').click()
    await page.getByRole('heading', { name: 'Settings', level: 1 }).waitFor()
    assert.equal(await page.getByRole('radio').count(), 0, 'the lists are behind their lines')
    assert.equal(await page.getByText('Pitch reference').count(), 0, 'no pitch reference any more')
    assert.match(await textOf(line(page, 'Default instrument')), /Tenor saxophone/, 'until the user chooses, the tenor saxophone')

    await line(page, 'Default instrument').click()
    const group = page.getByRole('dialog').getByRole('radiogroup', { name: 'Default instrument' })
    await group.waitFor()
    await page.waitForTimeout(450)
    assert.deepEqual(
      (await group.getByRole('radio').allTextContents()).map((text) => text.replace(/Woodwind|Keyboard|Strings|Brass/, '').trim()),
      ['Tenor saxophone', 'Alto saxophone', 'B♭ clarinet', 'Piano', 'Guitar', 'Violin', 'Trumpet'],
    )
    assert.equal(await choice(page, 'Default instrument', 'Tenor saxophone Woodwind').getAttribute('aria-checked'), 'true')
    assert.equal(await saved(app), undefined, 'nothing is written until something changes')

    // Back with the sheet open closes it and changes nothing.
    assert.equal(await app.back(), true)
    await page.getByRole('dialog').waitFor({ state: 'detached' })
    assert.equal(await saved(app), undefined)
    assert.match(await textOf(line(page, 'Default instrument')), /Tenor saxophone/)

    // Close leaves it as it was, too.
    await line(page, 'Default instrument').click()
    await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click()
    await page.getByRole('dialog').waitFor({ state: 'detached' })
    assert.equal(await saved(app), undefined)

    // Picking one saves it at once and closes the sheet.
    await line(page, 'Default instrument').click()
    await page.getByRole('radio', { name: /^B♭ clarinet/ }).click()
    await page.getByRole('dialog').waitFor({ state: 'detached' })
    assert.match(await textOf(line(page, 'Default instrument')), /B♭ clarinet/)
    assert.deepEqual(await saved(app), { defaultInstrument: 'clarinet', countIn: false, scanHintSeen: false })
    assert.ok(!('pitchReference' in ((await saved(app)) as object)), 'the pitch reference is not written')
    // It is what every practice session starts with: the setting is read from the shell, no restart needed.
    assert.equal(await app.page.evaluate(() => window.__test!.shell.settings.defaultInstrument.value), 'clarinet')

    // The sheet shows the new choice.
    await line(page, 'Default instrument').click()
    assert.equal(await page.getByRole('radio', { name: /^B♭ clarinet/ }).getAttribute('aria-checked'), 'true')
    assert.equal(await page.getByRole('radio', { name: /^Tenor saxophone/ }).getAttribute('aria-checked'), 'false')
  })
})

test('settings: there is no Language row and no language sheet', async () => {
  await withApp({ seed: '' }, async (app) => {
    const { page } = app
    await tab(page, 'Settings').click()
    await page.getByRole('heading', { name: 'Settings', level: 1 }).waitFor()
    assert.equal(await line(page, 'Language').count(), 0, 'no Language row')
    assert.equal(await page.getByText(/Language|Nederlands|Same as the phone/).count(), 0)
    assert.equal(await page.locator('html').getAttribute('lang'), 'en')
    await page.getByRole('switch', { name: /Count-in/ }).click()
    await page.waitForFunction(() => window.__test!.shell.settings.countIn.value === true)
    assert.ok(!('language' in ((await saved(app)) as object)), 'a language is never written')
  })
})

test('settings: they are read at start and kept across a reload (the committed store: clarinet; its old pitch reference and language are ignored)', async () => {
  await withApp({ seed: 'v2-settings' }, async (app) => {
    const { page } = app
    await page.getByRole('heading', { name: 'Let’s practise', level: 1 }).waitFor()
    await tab(page, 'Settings').click()
    assert.match(await textOf(line(page, 'Default instrument')), /B♭ clarinet/)
    assert.equal(await line(page, 'Language').count(), 0, 'no Language row')
    assert.equal(await page.getByText('Pitch reference').count(), 0)

    await line(page, 'Default instrument').click()
    await choice(page, 'Default instrument', 'Alto saxophone Woodwind').click()
    await page.getByRole('dialog').waitFor({ state: 'detached' })
    await app.reload()
    await tab(page, 'Settings').click()
    assert.match(await textOf(line(page, 'Default instrument')), /Alto saxophone/, 'the new choice is still set after a restart')
    const stored = (await saved(app)) as Record<string, unknown>
    assert.equal(stored.defaultInstrument, 'alto-sax')
    assert.ok(!('pitchReference' in stored), 'the old pitch reference is dropped by the next save')
    assert.ok(!('language' in stored), 'the old language is dropped by the next save')
  })
})

const PLAY = 'https://play.google.com/store/apps/details?id=be.imagitech.snapsody'
/** The one pushed screen's heading; the tab bar is gone on it. */
const heading = (page: Page, name: string) => page.getByRole('heading', { name, level: 1, exact: true })
const back = (page: Page) => page.getByRole('button', { name: 'Back', exact: true })

test('settings: after the count-in come Rate on Google Play (a link) and About Snapsody (the version); no credits, privacy or source rows', async () => {
  // The links are not clicked: in the harness that would really load the pages (every other host is refused anyway).
  await withApp({ seed: '' }, async ({ page }) => {
    await tab(page, 'Settings').click()
    await page.getByRole('heading', { name: 'Settings', level: 1 }).waitFor()
    const rate = page.getByRole('link', { name: 'Rate on Google Play', exact: true })
    assert.equal(await rate.count(), 1)
    assert.equal(await rate.getAttribute('href'), PLAY)
    assert.equal(await rate.getAttribute('target'), '_blank', 'never replaces the app')
    assert.equal(await rate.getAttribute('rel'), 'noopener noreferrer')
    const about = page.getByRole('button', { name: /^About Snapsody/ })
    assert.match(await textOf(about), /0\.1\.2/)
    const order = await page.locator('.screen-body').innerText()
    assert.ok(order.indexOf('Count-in') < order.indexOf('Rate on Google Play') && order.indexOf('Rate on Google Play') < order.indexOf('About Snapsody'))
    for (const gone of ['Credits', 'Privacy policy', 'Source code', 'Language']) {
      assert.equal(await page.getByText(gone, { exact: false }).count(), 0, `no ${gone} on Settings`)
    }
  })
})

test('settings: About Snapsody shows the version and licence, links to the privacy policy and the source, and Back returns to Settings', async () => {
  await withApp({ seed: '' }, async ({ page }) => {
    await tab(page, 'Settings').click()
    await page.getByRole('button', { name: /^About Snapsody/ }).click()
    await heading(page, 'About Snapsody').waitFor()
    assert.equal(await tab(page, 'Settings').count(), 0, 'no tab bar on About')
    const text = await textOf(page.locator('.screen'))
    assert.match(text, /Version 0\.1\.2/)
    assert.match(text, /Snapsody 0\.1\.2/)
    assert.match(text, /Free and open source \(AGPL-3\.0\)/)
    assert.match(text, /© 2026 the Snapsody authors/)
    assert.equal(await page.locator('.about-icon').getAttribute('alt'), '', 'the icon is decorative')
    const rows = [
      { link: page.getByRole('link', { name: 'Privacy policy', exact: true }), href: 'https://imagitech.be/snapsody/privacy/' },
      { link: page.getByRole('link', { name: /^Source code/ }), href: 'https://github.com/imagitech01/snapsody' },
    ]
    for (const { link, href } of rows) {
      assert.equal(await link.count(), 1)
      assert.equal(await link.getAttribute('href'), href)
      assert.equal(await link.getAttribute('target'), '_blank')
      assert.equal(await link.getAttribute('rel'), 'noopener noreferrer')
    }
    assert.match(await textOf(rows[1]!.link), /github\.com\/imagitech01\/snapsody/)
    assert.equal(await page.getByRole('button', { name: /^Credits and licences/ }).count(), 1)

    await back(page).click()
    await page.getByRole('heading', { name: 'Settings', level: 1 }).waitFor()
    assert.equal(await tab(page, 'Settings').count(), 1)
  })
})

test('settings: Credits lists the components, Licence shows homr and the SoundFont offline, ML Kit is not open source, and Back walks back', async () => {
  // Every host but the app's own is refused by the harness (app.ts), so reading a licence here is reading it offline.
  await withApp({ seed: '' }, async (app) => {
    const { page } = app
    await tab(page, 'Settings').click()
    await page.getByRole('button', { name: /^About Snapsody/ }).click()
    await page.getByRole('button', { name: /^Credits and licences/ }).click()
    await heading(page, 'Credits and licences').waitFor()
    const entry = (name: string) => page.getByRole('button', { name: new RegExp(`^${name}\\b`) })
    assert.match(await textOf(entry('homr')), /0\.7\.1 · AGPL-3\.0/)
    assert.match(await textOf(entry('Verovio')), /6\.4\.1 · LGPL-3\.0/)
    assert.match(await textOf(entry('MuseScore_General')), /0\.2 · MIT/)
    const mlkit = entry('Google ML Kit Document Scanner')
    assert.match(await textOf(mlkit), /16\.0\.0 · ML Kit Terms of Service · Not open source/)
    assert.equal(await page.getByText('Not open source').count(), 1, 'only ML Kit says it')
    for (const group of ['Reading the music', 'Showing the music', 'Instrument sounds', 'Running the models', 'Python on the phone', 'The app itself', 'Android libraries', 'Scanning pages']) {
      await page.getByRole('heading', { name: group, level: 2 }).waitFor()
    }

    await entry('homr').click()
    await heading(page, 'homr').waitFor()
    const licence = page.locator('.licence-text')
    await licence.getByText('GNU AFFERO GENERAL PUBLIC LICENSE').first().waitFor()
    const text = await textOf(page.locator('.screen'))
    assert.match(text, /Version 0\.7\.1 · AGPL-3\.0/)
    assert.match(text, /trained on datasets with non-commercial terms/, 'the training-data note')
    const source = page.getByRole('link', { name: /^Source/ })
    assert.equal(await source.getAttribute('href'), 'https://github.com/liebharc/homr')
    assert.equal(await source.getAttribute('target'), '_blank')
    assert.equal(await source.getAttribute('rel'), 'noopener noreferrer')
    assert.equal(await page.locator('.licence-text pre, .licence-text').evaluate((el) => getComputedStyle(el).overflowY), 'visible', 'no scroll area inside the screen')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'no sideways scroll')

    assert.equal(await app.back(), true)
    await heading(page, 'Credits and licences').waitFor()
    await entry('MuseScore_General').click()
    await heading(page, 'MuseScore_General').waitFor()
    await page.locator('.licence-text').getByText(/Permission is hereby granted/).waitFor()
    const sound = await textOf(page.locator('.screen'))
    for (const line of [
      'FluidR3 (original version) by Frank Wen Copyright (c) 2000-02',
      'Mono conversion (FluidR3Mono) by Michael Cowgill Copyright (c) 2014-17',
      'Adaptation for MuseScore_General.sf2 by S. Christian Collins Copyright (c) 2018-19',
      'Temple Blocks instrument provided by Ethan Winer Copyright (c) 2002',
      'Drumline Cymbals provided by Michael Schorsch Copyright (c) 2016',
    ]) assert.ok(sound.includes(line), `missing: ${line}`)

    await back(page).click()
    await entry('Google ML Kit Document Scanner').click()
    await heading(page, 'Google ML Kit Document Scanner').waitFor()
    await page.locator('.licence-text').getByText(/is not open source/).waitFor()
    assert.match(await textOf(page.locator('.screen')), /Not open source/)
    assert.equal(await page.getByRole('link', { name: /^Source/ }).getAttribute('href'), 'https://developers.google.com/ml-kit/terms')

    await back(page).click()
    await back(page).click()
    await heading(page, 'About Snapsody').waitFor()
    await back(page).click()
    await page.getByRole('heading', { name: 'Settings', level: 1 }).waitFor()
    assert.equal(await app.back(), false, 'back at Settings leaves the app')
  })
})

test('settings: a licence text that cannot be read leaves the rest of the screen and one line saying so', async () => {
  await withApp({ seed: '' }, async ({ page }) => {
    await page.route('**/licences/*', (route) => route.abort('failed'))
    await tab(page, 'Settings').click()
    await page.getByRole('button', { name: /^About Snapsody/ }).click()
    await page.getByRole('button', { name: /^Credits and licences/ }).click()
    await page.getByRole('button', { name: /^homr\b/ }).click()
    await page.getByRole('alert').filter({ hasText: 'The licence text could not be read.' }).waitFor()
    assert.equal(await page.getByRole('link', { name: /^Source/ }).count(), 1)
  })
})

test('settings: when they could not be read at start a change works for this run, and the user is told it will not be kept', async () => {
  await withApp({ seed: 'settings-unreadable' }, async (app) => {
    const { page } = app
    await tab(page, 'Settings').click()
    const countIn = page.getByRole('switch', { name: /Count-in/ })
    await countIn.click()
    // The change is in effect ...
    assert.equal(await countIn.getAttribute('aria-checked'), 'true')
    // ... and the notice says it is lost when the app is closed.
    const notice = page.getByRole('status').filter({ hasText: 'This setting could not be saved, so it will be lost when you close the app.' })
    await notice.waitFor()
    assert.equal(await app.file('settings.json'), undefined, 'nothing was written over the file that could not be read')
    await notice.getByRole('button', { name: 'OK' }).click()
    await notice.waitFor({ state: 'detached' })
  })
})

test('settings: back at the Settings start screen leaves the app, and a notice does not follow the user to another screen', async () => {
  await withApp({ seed: 'settings-unreadable' }, async (app) => {
    const { page } = app
    await tab(page, 'Settings').click()
    await page.getByRole('switch', { name: /Count-in/ }).click()
    await page.getByRole('status').filter({ hasText: 'could not be saved' }).waitFor()
    await tab(page, 'Practice').click()
    assert.equal(await page.getByRole('status').filter({ hasText: 'could not be saved' }).count(), 0)
    assert.equal(await app.back(), false)
  })
})
