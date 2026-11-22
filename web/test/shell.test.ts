import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_PRACTICE, createLibrary } from '../src/app/library.ts'
import { startShell } from '../src/app/shell.ts'
import { createFakePlatform } from '../src/platform/fake/index.ts'
import type { FakePlatform } from '../src/platform/fake/index.ts'
import { PlatformError } from '../src/platform/port.ts'
import { n, scoreXml } from './playbackHelpers.ts'

// The app shell (practice-app task 12, design D2, D4, D11, D12; specs `app-shell`, `practice-home`): the
// start-up in its order, the list refreshed when a screen that shows it comes back, the background, the
// back button, and what is reported when a save or a read fails. Against the fake platform; the screens
// that draw it are the browser layer's journeys (web/test/ui/).

/** Lets what the shell started on its own finish: the fake files answer in microtasks, so a few milliseconds is plenty. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 10))

const SCORE = scoreXml([{ body: n({ step: 'C', type: 'whole' }) }, { body: n({ step: 'D', type: 'whole' }) }], [4, 4])

/** A piece in the files, made by the library itself. */
async function addPiece(platform: FakePlatform, name: string, id: string, practised?: string): Promise<void> {
  platform.files.seed('scans/1/page-1.jpg', Uint8Array.of(0xff, 0xd8))
  const library = createLibrary(platform.files, { newId: () => id, now: () => new Date(Date.UTC(2026, 10, 10)) })
  await library.create({ name, musicxml: SCORE, bars: 2, repairs: [], pages: [{ source: 'scans/1/page-1.jpg', recognised: '<score-partwise/>', firstBar: 1, lastBar: 2 }] })
  if (practised) await library.update(id, { lastPracticed: practised })
}

test('shell: start-up reads the settings, sweeps the library, then lists it, in that order', async () => {
  const platform = createFakePlatform()
  await addPiece(platform, 'Ode to Joy', 'ode')
  // What an interrupted run left: a hidden folder of a piece that was being built.
  platform.files.seed('pieces/.tmp-half/piece.json', '{}')
  const seen: string[] = []
  platform.files.fault = (operation, paths) => {
    const path = paths[0] ?? ''
    if (operation === 'read' && path === 'settings.json') seen.push('settings')
    else if (operation === 'remove' && path === 'pieces/.tmp-half') seen.push('sweep')
    else if (operation === 'read' && path === 'pieces/ode/piece.json') seen.push('list')
  }
  const shell = await startShell(platform)
  try {
    assert.deepEqual([...new Set(seen)], ['settings', 'sweep', 'list'], 'settings, then the sweep, then the first list')
    assert.equal(platform.files.text('pieces/.tmp-half/piece.json'), undefined, 'the sweep removed what was left')
    // The first screen is drawn with the list in it.
    assert.equal(shell.view.loaded.value, true)
    assert.deepEqual(shell.view.pieces.value.map((p) => p.name), ['Ode to Joy'])
  } finally {
    shell.stop()
  }
})

test('shell: a piece whose piece.json only survived as a temp file is recovered before the first list (design D4)', async () => {
  const platform = createFakePlatform()
  await addPiece(platform, 'Ode to Joy', 'ode')
  await platform.files.rename('pieces/ode/piece.json', 'pieces/ode/piece.json.tmp-0123456789-abc')
  const shell = await startShell(platform)
  try {
    assert.deepEqual(shell.view.pieces.value.map((p) => p.name), ['Ode to Joy'])
    assert.ok(platform.files.text('pieces/ode/piece.json') !== undefined, 'promoted to piece.json')
  } finally {
    shell.stop()
  }
})

test('shell: it starts on the Practice tab, and an empty phone is a first launch', async () => {
  const shell = await startShell(createFakePlatform())
  try {
    assert.deepEqual(shell.router.screen.value, { name: 'home' })
    assert.equal(shell.router.tab.value, 'practice')
    assert.equal(shell.router.tabBarVisible.value, true)
    assert.equal(shell.home.firstLaunch.value, true)
    assert.equal(shell.notice.value, null)
  } finally {
    shell.stop()
  }
})

test('shell: the list is read again when a screen that shows it comes back, not only on start', async () => {
  const platform = createFakePlatform()
  await addPiece(platform, 'Ode to Joy', 'ode', '2026-11-17T09:00:00.000Z')
  await addPiece(platform, 'C major warm-up', 'warm', '2026-11-16T09:00:00.000Z')
  const shell = await startShell(platform)
  try {
    assert.equal(shell.home.continuePiece.value?.name, 'Ode to Joy')

    // The user practises the other piece: a session sets lastPracticed while its screen is open.
    shell.router.push({ name: 'practice', pieceId: 'warm' })
    await shell.library.update('warm', { lastPracticed: '2026-11-18T09:00:00.000Z' })
    await settle()
    assert.equal(shell.home.continuePiece.value?.name, 'Ode to Joy', 'nothing reads the list while a screen that does not show it is on top')

    shell.router.back()
    await settle() // the shell reads the list by itself; nothing here asks it to
    assert.equal(shell.home.continuePiece.value?.name, 'C major warm-up')
    assert.equal(shell.home.continueCard.value?.piece.name, 'C major warm-up')

    // The library and the favorites are screens that show the list too.
    await shell.library.update('ode', { favorite: true })
    shell.router.selectTab('library')
    await settle()
    assert.deepEqual(shell.view.favorites.value.map((r) => r.info.name), ['Ode to Joy'])
    await shell.library.update('ode', { favorite: false })
    shell.router.push({ name: 'favorites' })
    await settle()
    assert.deepEqual(shell.view.favorites.value.map((r) => r.info.name), [])
  } finally {
    shell.stop()
  }
})

test('shell: the back button closes a dialog, goes back a screen, and at a start screen is left to the phone', async () => {
  const platform = createFakePlatform()
  const shell = await startShell(platform)
  try {
    shell.router.push({ name: 'add-music' })
    const answer = shell.router.confirm({ title: 'Leave?', confirmLabel: 'Leave', cancelLabel: 'Stay' })
    assert.equal(platform.device.pressBack(), true)
    assert.equal(await answer, false, 'back answers "no"')
    assert.deepEqual(shell.router.screen.value, { name: 'add-music' }, 'the screen stays')
    assert.equal(platform.device.pressBack(), true)
    assert.deepEqual(shell.router.screen.value, { name: 'home' })
    assert.equal(platform.device.pressBack(), false, 'nothing to go back to: the phone leaves the app')
  } finally {
    shell.stop()
  }

  // Stopped, the shell no longer holds the back button.
  const stopped = createFakePlatform()
  const other = await startShell(stopped)
  other.router.push({ name: 'add-music' })
  other.stop()
  assert.equal(stopped.device.pressBack(), false)
  assert.deepEqual(other.router.screen.value, { name: 'add-music' })
})

test('shell: it follows the background, and reads the list when the app comes back to a screen that shows it', async () => {
  const platform = createFakePlatform()
  await addPiece(platform, 'Ode to Joy', 'ode')
  const shell = await startShell(platform)
  try {
    assert.equal(shell.foreground.value, true)
    platform.device.pause()
    assert.equal(shell.foreground.value, false)

    // A day turns over while the app is away; a piece changes on the way (the rows say "yesterday" only when made again).
    await shell.library.update('ode', { favorite: true })
    platform.device.resume()
    assert.equal(shell.foreground.value, true)
    await settle()
    assert.deepEqual(shell.view.favorites.value.map((r) => r.info.name), ['Ode to Joy'])
  } finally {
    shell.stop()
  }
})

test('shell: a save that is rejected is the notice, the value stays set for this run, and the notice ends with the screen', async () => {
  const platform = createFakePlatform()
  // settings.json is there but cannot be read: the settings are read-only for this run.
  platform.files.seed('settings.json', '{"countIn":false}')
  platform.files.fault = (operation, paths) => {
    if (operation === 'read' && paths[0] === 'settings.json') throw new PlatformError('failed', 'cannot read')
  }
  const shell = await startShell(platform)
  try {
    assert.equal(shell.settings.readOnly, true)
    shell.router.selectTab('settings')
    assert.equal(await shell.run(() => shell.settings.setCountIn(true), 'settings.saveFailed'), false, 'run never throws')
    assert.equal(shell.notice.value, 'settings.saveFailed')
    assert.equal(shell.i18n.t('settings.saveFailed'), 'This setting could not be saved, so it will be lost when you close the app.')
    assert.equal(shell.settings.countIn.value, true, 'still in effect')
    assert.equal(platform.files.text('settings.json'), '{"countIn":false}', 'not written over')

    shell.dismissNotice()
    assert.equal(shell.notice.value, null)

    await shell.run(() => shell.settings.setCountIn(false), 'settings.saveFailed')
    assert.equal(shell.notice.value, 'settings.saveFailed')
    shell.router.selectTab('practice')
    assert.equal(shell.notice.value, null, 'going to another screen ends it')
  } finally {
    shell.stop()
  }
})

test('shell: a success clears the notice of its own kind only', async () => {
  const shell = await startShell(createFakePlatform())
  try {
    assert.equal(await shell.run(() => Promise.reject(new Error('no'))), false)
    assert.equal(shell.notice.value, 'error.generic')
    assert.equal(await shell.run(() => shell.settings.setCountIn(true), 'settings.saveFailed'), true)
    assert.equal(shell.notice.value, 'error.generic', 'another kind of success leaves it')
    assert.equal(await shell.run(() => Promise.resolve()), true)
    assert.equal(shell.notice.value, null)
  } finally {
    shell.stop()
  }
})

test('shell: a library that cannot be read does not stop the app from starting; it is the notice, and the next screen tries again', async () => {
  const platform = createFakePlatform()
  await addPiece(platform, 'Ode to Joy', 'ode')
  platform.files.fault = (operation, paths) => {
    if (operation === 'list' && paths[0] === 'pieces') throw new PlatformError('failed', 'storage is not available')
  }
  const shell = await startShell(platform)
  try {
    assert.equal(shell.view.loaded.value, false, 'no invitation to add music over a list that was not read')
    assert.equal(shell.home.firstLaunch.value, false)
    assert.equal(shell.notice.value, 'error.generic')

    platform.files.fault = undefined
    shell.router.selectTab('library')
    await settle()
    assert.equal(shell.view.loaded.value, true)
    assert.deepEqual(shell.view.pieces.value.map((p) => p.name), ['Ode to Joy'])
    assert.equal(shell.notice.value, null)
  } finally {
    shell.stop()
  }
})

test('shell: it hands the screens what they need of the app', async () => {
  const platform = createFakePlatform()
  const shell = await startShell(platform)
  try {
    assert.equal(shell.platform, platform)
    assert.ok(shell.library && shell.settings && shell.view && shell.home && shell.router && shell.i18n)
    // `home` and `view` share one list: what the library screens star, the home shows.
    assert.equal(shell.home.view, shell.view)
    assert.deepEqual(DEFAULT_PRACTICE.bar, 1)
  } finally {
    shell.stop()
  }
})
