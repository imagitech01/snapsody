import assert from 'node:assert/strict'
import { test } from 'node:test'
import { effect } from '@preact/signals'
import { connectBackButton, createRouter, isStartScreen, startScreen } from '../src/app/router.ts'
import type { ConfirmOptions, LeaveGuard, Overlay, Router, Screen } from '../src/app/router.ts'
import { createFakePlatform } from '../src/platform/fake/index.ts'

// Navigation (practice-app task 9.2, design D12, specs `app-shell` "Main tabs" and "Back closes the
// top layer first", `score-editing` "Save and practice"). The editor session is task 9.6 and does
// not exist yet, so a small stub stands in for it: it has unsaved edits or not, and registers the
// leave guard the way the real session will.

/** Lets a guard that waits for a dialog finish: its promise resolves a few microtasks after the answer. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

const names = (router: Router): string[] => router.stack.value.map((s) => s.name)
const overlayKinds = (router: Router): string[] => router.overlays.value.map((o) => (o.kind === 'sheet' ? o.sheet : 'dialog'))

const DISCARD: ConfirmOptions = { title: 'Discard your edits?', confirmLabel: 'Discard', cancelLabel: 'Keep editing', destructive: true }

/**
 * What the editor session will do (task 9.6): once its screen is open it registers a guard that
 * lets the user leave when nothing is unsaved, and else asks whether to discard.
 */
function stubEditor(router: Router): { dirty: boolean; asked: number; dispose: () => void } {
  const stub = {
    dirty: false,
    asked: 0,
    dispose: () => {},
  }
  stub.dispose = router.setLeaveGuard(() => {
    stub.asked += 1
    return stub.dirty ? router.confirm(DISCARD) : true
  })
  return stub
}

// ---- Tabs and screens ------------------------------------------------------------------------

test('start: the Practice tab and its start screen, with the tab bar', () => {
  const router = createRouter()
  assert.equal(router.tab.value, 'practice')
  assert.deepEqual(names(router), ['home'])
  assert.equal(router.screen.value.name, 'home')
  assert.equal(router.tabBarVisible.value, true)
  assert.deepEqual(router.overlays.value, [])
  assert.deepEqual(createRouter('library').stack.value, [{ name: 'library' }])
  assert.deepEqual(startScreen('settings'), { name: 'settings' })
  assert.equal(isStartScreen({ name: 'home' }), true)
  assert.equal(isStartScreen({ name: 'favorites' }), false)
  assert.equal(isStartScreen({ name: 'practice', pieceId: 'p' }), false)
})

test('tabs: choosing a tab shows its start screen and marks it (spec "Switch area")', () => {
  const router = createRouter()
  router.selectTab('library')
  assert.equal(router.tab.value, 'library')
  assert.deepEqual(names(router), ['library'])
  router.selectTab('settings')
  assert.equal(router.tab.value, 'settings')
  assert.deepEqual(names(router), ['settings'])
  router.selectTab('practice')
  assert.deepEqual(names(router), ['home'])
  assert.equal(router.tabBarVisible.value, true)
})

test('tabs: one stack, and a tab switch resets it to the start screen of the tab (no stack per tab)', () => {
  const router = createRouter('library')
  router.push({ name: 'practice', pieceId: 'ode' })
  assert.deepEqual(names(router), ['library', 'practice'])
  router.selectTab('settings')
  assert.deepEqual(names(router), ['settings'], 'what was above the library is gone')
  router.selectTab('library')
  assert.deepEqual(names(router), ['library'], 'and the library starts at its start screen again')

  // Choosing the tab that is already shown changes nothing, so the screen is not shown anew.
  let runs = 0
  const stop = effect(() => {
    void router.stack.value
    runs += 1
  })
  router.selectTab('library')
  assert.equal(runs, 1)
  stop()
})

test('practising hides the tab bar until the user goes back (spec "Practising hides the tabs")', () => {
  const router = createRouter()
  router.selectTab('library')
  const seen: boolean[] = []
  const stop = effect(() => {
    seen.push(router.tabBarVisible.value)
  })
  router.push({ name: 'practice', pieceId: 'ode' })
  assert.equal(router.tabBarVisible.value, false)
  assert.equal(router.tab.value, 'library', 'the Library tab stays the current one underneath')
  assert.equal(router.back(), true)
  assert.equal(router.tabBarVisible.value, true)
  assert.deepEqual(seen, [true, false, true])
  stop()
})

test('push, replace and pop: the add-music flow ends in practice and back goes to where it began', () => {
  const router = createRouter()
  router.selectTab('library')
  router.push({ name: 'add-music' })
  router.replace({ name: 'reading' }) // the scanner opened and the pages are being read
  router.replace({ name: 'editor', pieceId: 'new' })
  router.replace({ name: 'practice', pieceId: 'new' }) // Save & practice
  assert.deepEqual(names(router), ['library', 'practice'])
  assert.deepEqual(router.screen.value, { name: 'practice', pieceId: 'new' })
  assert.equal(router.pop(), true)
  assert.deepEqual(names(router), ['library'])
  assert.equal(router.pop(), false, 'nothing below a start screen')
  assert.deepEqual(names(router), ['library'])
})

test('the tab bar is for start screens only, also when a full-screen screen is the only one', () => {
  const router = createRouter()
  router.replace({ name: 'practice', pieceId: 'ode' }) // a piece opened at launch, say
  assert.equal(router.tabBarVisible.value, false)
  router.selectTab('library')
  assert.equal(router.tabBarVisible.value, true)
})

test('screens carry what they need: the piece, and whether to start playing', () => {
  const router = createRouter()
  const play: Screen = { name: 'practice', pieceId: 'c-major', autoplay: true }
  router.push(play)
  assert.deepEqual(router.screen.value, play)
  router.push({ name: 'editor', pieceId: 'c-major' })
  router.push({ name: 'add-music', pieceId: 'c-major' })
  assert.deepEqual(router.screen.value, { name: 'add-music', pieceId: 'c-major' })
})

// ---- Back: sheets first, then screens --------------------------------------------------------

test('back with a sheet open closes the sheet and the piece stays open (spec "Back with the tools sheet open")', () => {
  const router = createRouter()
  router.push({ name: 'practice', pieceId: 'ode' })
  router.openSheet('tools')
  assert.deepEqual(overlayKinds(router), ['tools'])
  assert.equal(router.back(), true)
  assert.deepEqual(overlayKinds(router), [])
  assert.deepEqual(names(router), ['home', 'practice'], 'the piece stays open')
  assert.equal(router.back(), true)
  assert.deepEqual(names(router), ['home'], 'the next back goes back a screen')
  assert.equal(router.back(), false, 'at the start screen the platform may leave the app')
})

test('back at the start screen of every tab returns false and changes nothing', () => {
  for (const tab of ['practice', 'library', 'settings'] as const) {
    const router = createRouter(tab)
    assert.equal(router.back(), false, tab)
    assert.deepEqual(names(router), [startScreen(tab).name])
  }
  const router = createRouter()
  router.selectTab('settings')
  assert.equal(router.back(), false, 'also after switching tab: no hidden previous tab to go back to')
  assert.equal(router.tab.value, 'settings')
})

test('sheets: stacked ones close one by one, and opening one twice opens it once', () => {
  const router = createRouter()
  router.push({ name: 'practice', pieceId: 'ode' })
  router.openSheet('tools')
  router.openSheet('tools')
  assert.deepEqual(overlayKinds(router), ['tools'])
  router.openSheet('loop')
  assert.deepEqual(overlayKinds(router), ['tools', 'loop'])
  assert.equal(router.back(), true)
  assert.deepEqual(overlayKinds(router), ['tools'], 'the top sheet first')
  assert.equal(router.back(), true)
  assert.deepEqual(overlayKinds(router), [])
  assert.deepEqual(names(router), ['home', 'practice'])
})

test('sheets: closing one closes what was opened over it, and a sheet that is not open is ignored', () => {
  const router = createRouter()
  router.push({ name: 'practice', pieceId: 'ode' })
  router.openSheet('tools')
  router.openSheet('loop')
  router.closeSheet('instrument')
  assert.deepEqual(overlayKinds(router), ['tools', 'loop'])
  router.closeSheet('tools')
  assert.deepEqual(overlayKinds(router), [], 'the loop sheet was opened over the tools sheet')
})

test('sheets belong to their screen: any navigation closes them', () => {
  const router = createRouter()
  router.push({ name: 'practice', pieceId: 'ode' })
  router.openSheet('tools')
  router.push({ name: 'editor', pieceId: 'ode' }) // "Edit this piece" in the tools sheet
  assert.deepEqual(overlayKinds(router), [])
  router.openSheet('loop')
  router.replace({ name: 'practice', pieceId: 'ode' })
  assert.deepEqual(overlayKinds(router), [])
  router.openSheet('loop')
  assert.equal(router.pop(), true)
  assert.deepEqual(overlayKinds(router), [])
  router.openSheet('loop')
  router.selectTab('library')
  assert.deepEqual(overlayKinds(router), [])
})

test('the overlays are a signal, in the order they were opened', () => {
  const router = createRouter()
  router.push({ name: 'practice', pieceId: 'ode' })
  const seen: string[][] = []
  const stop = effect(() => {
    seen.push(router.overlays.value.map((o: Overlay) => (o.kind === 'sheet' ? o.sheet : 'dialog')))
  })
  router.openSheet('tools')
  router.openSheet('loop')
  router.back()
  router.back()
  assert.deepEqual(seen, [[], ['tools'], ['tools', 'loop'], ['tools'], []])
  stop()
})

// ---- Dialogs ---------------------------------------------------------------------------------

test('a dialog is answered by its buttons, and back, a new screen or a tab switch answer "no"', async () => {
  const router = createRouter()
  router.push({ name: 'practice', pieceId: 'ode' })

  const yes = router.confirm({ title: 'Delete this piece?', confirmLabel: 'Delete', cancelLabel: 'Cancel', destructive: true })
  const dialog = router.overlays.value[0]!
  assert.equal(dialog.kind, 'dialog')
  assert.deepEqual(dialog.kind === 'dialog' && dialog.options.title, 'Delete this piece?')
  router.answerDialog(true)
  assert.equal(await yes, true)
  assert.deepEqual(router.overlays.value, [])

  const no = router.confirm(DISCARD)
  router.answerDialog(false)
  assert.equal(await no, false)

  const byBack = router.confirm(DISCARD)
  assert.equal(router.back(), true)
  assert.equal(await byBack, false)
  assert.deepEqual(names(router), ['home', 'practice'], 'back closed the dialog and went no further')

  const byPush = router.confirm(DISCARD)
  router.push({ name: 'editor', pieceId: 'ode' })
  assert.equal(await byPush, false)
  assert.deepEqual(router.overlays.value, [])

  router.answerDialog(true) // nothing is open: ignored
  router.openSheet('loop')
  router.answerDialog(true) // the top overlay is a sheet: ignored
  assert.deepEqual(overlayKinds(router), ['loop'])
})

test('a dialog opened over a sheet is closed first, and the sheet stays', async () => {
  const router = createRouter()
  router.push({ name: 'practice', pieceId: 'ode' })
  router.openSheet('tools')
  const answer = router.confirm(DISCARD)
  assert.deepEqual(overlayKinds(router), ['tools', 'dialog'])
  router.back()
  assert.equal(await answer, false)
  assert.deepEqual(overlayKinds(router), ['tools'])
})

// ---- Back in the editor with unsaved edits ----------------------------------------------------

test('editor, nothing unsaved: back leaves at once', () => {
  const router = createRouter()
  router.push({ name: 'editor', pieceId: 'ode' })
  const editor = stubEditor(router)
  assert.equal(router.back(), true)
  assert.deepEqual(names(router), ['home'])
  assert.equal(editor.asked, 1)
  assert.deepEqual(router.overlays.value, [])
})

test('editor with unsaved edits: back asks first, and confirming leaves (spec "Leave without saving")', async () => {
  const router = createRouter()
  router.push({ name: 'editor', pieceId: 'ode' })
  const editor = stubEditor(router)
  editor.dirty = true

  assert.equal(router.back(), true, 'handled: the question is on screen')
  assert.deepEqual(names(router), ['home', 'editor'], 'not left yet')
  assert.deepEqual(overlayKinds(router), ['dialog'])
  const question = router.overlays.value[0]!
  assert.deepEqual(question.kind === 'dialog' && question.options, DISCARD)

  router.answerDialog(true) // Discard
  await settle()
  assert.deepEqual(names(router), ['home'], 'popped after the answer')
  assert.deepEqual(router.overlays.value, [])
})

test('editor with unsaved edits: cancelling the question keeps the editor open, and back asks again next time', async () => {
  const router = createRouter()
  router.push({ name: 'editor', pieceId: 'ode' })
  const editor = stubEditor(router)
  editor.dirty = true

  router.back()
  router.answerDialog(false) // Keep editing
  await settle()
  assert.deepEqual(names(router), ['home', 'editor'])
  assert.deepEqual(router.overlays.value, [])
  assert.equal(editor.asked, 1)

  assert.equal(router.back(), true, 'back works again after a "no"')
  assert.deepEqual(overlayKinds(router), ['dialog'])
  assert.equal(editor.asked, 2)
  router.answerDialog(true)
  await settle()
  assert.deepEqual(names(router), ['home'])
})

test('editor with unsaved edits: a second back while the question is open cancels it and the editor stays', async () => {
  const router = createRouter()
  router.push({ name: 'editor', pieceId: 'ode' })
  const editor = stubEditor(router)
  editor.dirty = true

  router.back()
  assert.deepEqual(overlayKinds(router), ['dialog'])
  assert.equal(router.back(), true, 'the question is the top layer: back closes it')
  await settle()
  assert.deepEqual(overlayKinds(router), [])
  assert.deepEqual(names(router), ['home', 'editor'], 'a "no", not a way out')
  assert.equal(editor.asked, 1, 'the guard was not asked a second time')

  // And the editor can still be left once the edits are saved.
  editor.dirty = false
  assert.equal(router.back(), true)
  assert.deepEqual(names(router), ['home'])
})

test('editor: after the edits are saved, Save & practice replaces the screen without asking, and practice is not guarded', async () => {
  const router = createRouter()
  router.push({ name: 'editor', pieceId: 'ode' })
  const editor = stubEditor(router)
  editor.dirty = true
  // The session saves, clears its dirty state and replaces the screen; replace never asks.
  editor.dirty = false
  router.replace({ name: 'practice', pieceId: 'ode' })
  assert.deepEqual(names(router), ['home', 'practice'])
  editor.dirty = true // whatever the old session does now, the practice screen has no guard
  assert.equal(router.back(), true)
  await settle()
  assert.deepEqual(names(router), ['home'])
  assert.equal(editor.asked, 0)
})

test('editor with edits and a sheet open: back closes the sheet and does not ask', () => {
  const router = createRouter()
  router.push({ name: 'editor', pieceId: 'ode' })
  const editor = stubEditor(router)
  editor.dirty = true
  router.openSheet('tools')
  assert.equal(router.back(), true)
  assert.deepEqual(overlayKinds(router), [])
  assert.equal(editor.asked, 0)
  assert.deepEqual(names(router), ['home', 'editor'])
})

test('a guard belongs to its screen: a screen pushed over the editor leaves without asking, and the editor asks when it is on top again', async () => {
  const router = createRouter()
  router.push({ name: 'editor', pieceId: 'ode' })
  const editor = stubEditor(router)
  editor.dirty = true
  router.push({ name: 'add-music', pieceId: 'ode' }) // "+ Add pages"
  router.replace({ name: 'reading', pieceId: 'ode' })
  assert.equal(router.back(), true, 'cancel reading')
  assert.deepEqual(names(router), ['home', 'editor'])
  assert.equal(editor.asked, 0, 'the editor was not asked about leaving the reading screen')
  router.back()
  assert.equal(editor.asked, 1)
  assert.deepEqual(overlayKinds(router), ['dialog'])
  router.answerDialog(true)
  await settle()
  assert.deepEqual(names(router), ['home'])
})

test('a guard is dropped when it is unregistered or when its screen is replaced, and a new one replaces the old', () => {
  const router = createRouter()
  router.push({ name: 'editor', pieceId: 'ode' })
  const editor = stubEditor(router)
  editor.dirty = true
  editor.dispose()
  assert.equal(router.back(), true)
  assert.deepEqual(names(router), ['home'], 'no guard: left without asking')
  assert.equal(editor.asked, 0)

  router.push({ name: 'editor', pieceId: 'ode' })
  const calls: string[] = []
  router.setLeaveGuard(() => (calls.push('old'), false))
  const dropNew = router.setLeaveGuard(() => (calls.push('new'), false))
  router.back()
  assert.deepEqual(calls, ['new'])
  dropNew()
  router.back()
  assert.deepEqual(names(router), ['home'], 'the old guard was replaced, not kept beneath the new one')
})

test('a guard that says yes or no at once (no dialog)', () => {
  const router = createRouter()
  router.push({ name: 'editor', pieceId: 'ode' })
  router.setLeaveGuard(() => false)
  assert.equal(router.back(), true, 'handled: the user stays')
  assert.deepEqual(names(router), ['home', 'editor'])
  router.setLeaveGuard(() => true)
  assert.equal(router.back(), true)
  assert.deepEqual(names(router), ['home'])
})

test('a guard that throws or rejects keeps the user on the screen and does not kill back', async () => {
  const router = createRouter()
  router.push({ name: 'editor', pieceId: 'ode' })

  let mode: 'throw' | 'reject' | 'ok' = 'throw'
  const guard: LeaveGuard = () => {
    if (mode === 'throw') throw new Error('broken guard')
    return mode === 'reject' ? Promise.reject(new Error('broken guard')) : Promise.resolve(true)
  }
  router.setLeaveGuard(guard)

  assert.equal(router.back(), true, 'handled, so the app is not left')
  assert.deepEqual(names(router), ['home', 'editor'])

  mode = 'reject'
  assert.equal(router.back(), true)
  await settle()
  assert.deepEqual(names(router), ['home', 'editor'])

  mode = 'ok'
  assert.equal(router.back(), true, 'back still works after the failures')
  await settle()
  assert.deepEqual(names(router), ['home'])
})

test('a slow guard: more backs wait for the answer, and a screen that is no longer on top is not popped', async () => {
  const router = createRouter()
  router.push({ name: 'editor', pieceId: 'ode' })
  let answer: (leave: boolean) => void = () => {}
  let asked = 0
  router.setLeaveGuard(() => {
    asked += 1
    return new Promise<boolean>((resolve) => {
      answer = resolve
    })
  })
  assert.equal(router.back(), true)
  assert.equal(router.back(), true, 'still waiting: handled, and the guard is not asked again')
  assert.equal(asked, 1)
  // Meanwhile something else happens: the editor is replaced.
  router.replace({ name: 'practice', pieceId: 'ode' })
  answer(true)
  await settle()
  assert.deepEqual(names(router), ['home', 'practice'], 'the answer was for a screen that is gone')
  assert.equal(router.back(), true, 'and back is not stuck waiting')
  assert.deepEqual(names(router), ['home'])
})

// ---- The platform's back button -----------------------------------------------------------------

test('connectBackButton: the device back button closes the sheet, then pops, then lets the app go', () => {
  const { device } = createFakePlatform()
  const router = createRouter()
  const disconnect = connectBackButton(router, device)

  router.push({ name: 'practice', pieceId: 'ode' })
  router.openSheet('tools')
  assert.equal(device.pressBack(), true)
  assert.deepEqual(overlayKinds(router), [])
  assert.deepEqual(names(router), ['home', 'practice'])
  assert.equal(device.pressBack(), true)
  assert.deepEqual(names(router), ['home'])
  assert.equal(device.pressBack(), false, 'the root: the platform leaves the app')

  disconnect()
  router.push({ name: 'practice', pieceId: 'ode' })
  assert.equal(device.pressBack(), false, 'disconnected: the router is not asked')
  assert.deepEqual(names(router), ['home', 'practice'])
})

test('connectBackButton: in the editor with unsaved edits the device back button asks first', async () => {
  const { device } = createFakePlatform()
  const router = createRouter()
  connectBackButton(router, device)
  router.push({ name: 'editor', pieceId: 'ode' })
  const editor = stubEditor(router)
  editor.dirty = true

  assert.equal(device.pressBack(), true)
  assert.deepEqual(overlayKinds(router), ['dialog'])
  assert.deepEqual(names(router), ['home', 'editor'])
  router.answerDialog(true)
  await settle()
  assert.deepEqual(names(router), ['home'])
  assert.equal(device.pressBack(), false)
})
