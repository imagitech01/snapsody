import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Page } from 'playwright'
import { withApp } from './app.ts'
import { tab, tabBar, textOf } from './journey.ts'

// The settings journey (practice-app design D15 and D19, "settings: default instrument, language"; tasks 12.3, 13.6; specs
// `app-shell` "English and Dutch" and "General settings", `instruments` "Default instrument" and "Recorded instrument
// sounds"): the Settings tab on an empty phone, and on the committed store's settings (clarinet, Dutch, and an old
// pitchReference that is ignored). The default instrument and the language are one line each that opens a sheet.

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
    assert.deepEqual(await saved(app), { defaultInstrument: 'clarinet', countIn: false, language: null, scanHintSeen: false })
    assert.ok(!('pitchReference' in ((await saved(app)) as object)), 'the pitch reference is not written')
    // It is what every practice session starts with: the setting is read from the shell, no restart needed.
    assert.equal(await app.page.evaluate(() => window.__test!.shell.settings.defaultInstrument.value), 'clarinet')

    // The sheet shows the new choice.
    await line(page, 'Default instrument').click()
    assert.equal(await page.getByRole('radio', { name: /^B♭ clarinet/ }).getAttribute('aria-checked'), 'true')
    assert.equal(await page.getByRole('radio', { name: /^Tenor saxophone/ }).getAttribute('aria-checked'), 'false')
  })
})

test('settings: switching to Dutch changes the texts at once, and it persists across a reload', async () => {
  await withApp({ seed: '' }, async (app) => {
    const { page } = app
    await page.getByRole('heading', { name: 'Let’s practise' }).waitFor()
    await tab(page, 'Settings').click()
    assert.match(await textOf(line(page, 'Language')), /Same as the phone/, 'no choice yet')
    await line(page, 'Language').click()
    assert.equal(await choice(page, 'Language', 'Same as the phone (English)').getAttribute('aria-checked'), 'true', 'the phone is English: no choice yet')
    await page.waitForTimeout(450)
    // Back closes the sheet and changes nothing.
    assert.equal(await app.back(), true)
    await page.getByRole('dialog').waitFor({ state: 'detached' })
    assert.equal(await saved(app), undefined)

    await line(page, 'Language').click()
    await choice(page, 'Language', 'Nederlands').click()
    // No restart: the heading, the tab bar and the page language follow.
    await page.getByRole('heading', { name: 'Instellingen', level: 1 }).waitFor()
    await tabBar(page, 'Hoofdonderdelen').getByRole('button', { name: 'Oefenen' }).waitFor()
    await tabBar(page, 'Hoofdonderdelen').getByRole('button', { name: 'Bibliotheek' }).waitFor()
    assert.equal(await page.locator('html').getAttribute('lang'), 'nl')
    await page.getByRole('dialog').waitFor({ state: 'detached' })
    assert.match(await textOf(line(page, 'Taal')), /Nederlands/)
    assert.equal(((await saved(app)) as { language: string }).language, 'nl')
    await line(page, 'Standaardinstrument').waitFor()

    // Every screen speaks Dutch, a piece is a "muziekstuk".
    await tabBar(page, 'Hoofdonderdelen').getByRole('button', { name: 'Oefenen' }).click()
    await page.getByRole('heading', { name: 'Laten we oefenen', level: 1 }).waitFor()
    await page.getByRole('region', { name: 'Voeg je eerste muziek toe' }).waitFor()

    // The activity is recreated: the phone is still English, the app is still Dutch.
    await app.reload()
    await page.getByRole('heading', { name: 'Laten we oefenen', level: 1 }).waitFor()
    assert.equal(await page.locator('html').getAttribute('lang'), 'nl')
    await tabBar(page, 'Hoofdonderdelen').getByRole('button', { name: 'Instellingen' }).click()
    assert.match(await textOf(line(page, 'Taal')), /Nederlands/)

    // "Same as the phone" gives the phone's language back.
    await line(page, 'Taal').click()
    await choice(page, 'Taal', 'Zoals de telefoon (English)').click()
    await page.getByRole('heading', { name: 'Settings', level: 1 }).waitFor()
    assert.equal(((await saved(app)) as { language: string | null }).language, null)
  })
})

test('settings: on a Dutch phone the app is Dutch until the user chooses English, which stays after a restart', async () => {
  await withApp({ seed: '', language: 'nl-BE' }, async (app) => {
    const { page } = app
    await page.getByRole('heading', { name: 'Laten we oefenen', level: 1 }).waitFor()
    await tabBar(page, 'Hoofdonderdelen').getByRole('button', { name: 'Instellingen' }).click()
    assert.match(await textOf(line(page, 'Taal')), /Zoals de telefoon/)
    await line(page, 'Taal').click()
    assert.equal(await choice(page, 'Taal', 'Zoals de telefoon (Nederlands)').getAttribute('aria-checked'), 'true')
    await choice(page, 'Taal', 'English').click()
    await page.getByRole('heading', { name: 'Settings', level: 1 }).waitFor()
    await app.reload()
    await page.getByRole('heading', { name: 'Let’s practise', level: 1 }).waitFor()
  })
})

test('settings: they are read at start and kept across a reload (the committed store: clarinet, Dutch; its old pitch reference is ignored)', async () => {
  await withApp({ seed: 'v2-settings' }, async (app) => {
    const { page } = app
    await page.getByRole('heading', { name: 'Laten we oefenen', level: 1 }).waitFor()
    await tabBar(page, 'Hoofdonderdelen').getByRole('button', { name: 'Instellingen' }).click()
    assert.match(await textOf(line(page, 'Standaardinstrument')), /B♭-klarinet/)
    assert.match(await textOf(line(page, 'Taal')), /Nederlands/)
    assert.equal(await page.getByText('Stemtoon').count(), 0)

    await line(page, 'Standaardinstrument').click()
    await choice(page, 'Standaardinstrument', 'Altsaxofoon Houtblazers').click()
    await page.getByRole('dialog').waitFor({ state: 'detached' })
    await app.reload()
    await tabBar(page, 'Hoofdonderdelen').getByRole('button', { name: 'Instellingen' }).click()
    assert.match(await textOf(line(page, 'Standaardinstrument')), /Altsaxofoon/, 'the new choice is still set after a restart')
    const stored = (await saved(app)) as Record<string, unknown>
    assert.equal(stored.defaultInstrument, 'alto-sax')
    assert.ok(!('pitchReference' in stored), 'the old pitch reference is dropped by the next save')
  })
})

test('settings: the credits name the source and licence of the instrument sounds', async () => {
  await withApp({ seed: '' }, async ({ page }) => {
    await tab(page, 'Settings').click()
    const credits = page.getByRole('button', { name: 'Credits' })
    assert.equal(await credits.getAttribute('aria-expanded'), 'false')
    assert.equal(await page.getByRole('region', { name: 'Credits' }).count(), 0)

    await credits.click()
    assert.equal(await credits.getAttribute('aria-expanded'), 'true')
    const panel = page.getByRole('region', { name: 'Credits' })
    const text = await textOf(panel)
    assert.match(text, /Instrument sounds/)
    assert.match(text, /MuseScore_General 0\.2/)
    assert.match(text, /Licence: MIT License/)
    assert.match(text, /Source: https:\/\/ftp\.osuosl\.org\/pub\/musescore\/soundfont\/MuseScore_General\//)
    // The licence's own acknowledgements, as it asks.
    assert.match(text, /FluidR3 \(original version\) by Frank Wen Copyright \(c\) 2000-02/)
    assert.match(text, /Adaptation for MuseScore_General\.sf2 by S\. Christian Collins Copyright \(c\) 2018-19/)

    await credits.click()
    assert.equal(await page.getByRole('region', { name: 'Credits' }).count(), 0)
  })
})

test('settings: the privacy policy and the source code are links that open outside the app, in English and in Dutch', async () => {
  // Spec `app-shell` "Privacy policy and source code" (change add-privacy-policy). The links are not clicked: in the
  // harness that would really load the pages. On the phone, Capacitor hands them to the browser (design D4).
  const check = async (page: Page, privacy: string, source: RegExp): Promise<void> => {
    const rows = [
      { link: page.getByRole('link', { name: privacy, exact: true }), href: 'https://imagitech.be/snapsody/privacy/' },
      { link: page.getByRole('link', { name: source }), href: 'https://github.com/imagitech01/snapsody' },
    ]
    for (const { link, href } of rows) {
      assert.equal(await link.count(), 1)
      assert.equal(await link.getAttribute('href'), href)
      assert.equal(await link.getAttribute('target'), '_blank', 'never replaces the app')
      assert.equal(await link.getAttribute('rel'), 'noopener noreferrer')
    }
  }
  await withApp({ seed: '' }, async ({ page }) => {
    await tab(page, 'Settings').click()
    await page.getByRole('heading', { name: 'Settings', level: 1 }).waitFor()
    await check(page, 'Privacy policy', /^Source code/)
    assert.match(await textOf(page.getByRole('link', { name: /^Source code/ })), /AGPL-3\.0/)
  })
  await withApp({ seed: '', language: 'nl-BE' }, async ({ page }) => {
    await tabBar(page, 'Hoofdonderdelen').getByRole('button', { name: 'Instellingen' }).click()
    await page.getByRole('heading', { name: 'Instellingen', level: 1 }).waitFor()
    await check(page, 'Privacybeleid', /^Broncode/)
  })
})

test('settings: when they could not be read at start a change works for this run, and the user is told it will not be kept', async () => {
  await withApp({ seed: 'settings-unreadable' }, async (app) => {
    const { page } = app
    await tab(page, 'Settings').click()
    await line(page, 'Language').click()
    await choice(page, 'Language', 'Nederlands').click()
    // The change is in effect (the app is Dutch) ...
    await page.getByRole('heading', { name: 'Instellingen', level: 1 }).waitFor()
    // ... and the notice says it is lost when the app is closed.
    const notice = page.getByRole('status').filter({ hasText: 'Deze instelling kon niet worden bewaard en gaat verloren als je de app sluit.' })
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
