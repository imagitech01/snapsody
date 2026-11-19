import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { Page } from 'playwright'
import { parseMusicXml } from '../../src/core/score/musicxml.ts'
import { isNote, isWedge } from '../../src/core/score/model.ts'
import type { Score } from '../../src/core/score/model.ts'
import { withApp } from './app.ts'
import type { App } from './app.ts'
import { noteIdsByBar, tab, tapNote, textOf } from './journey.ts'
import { BUILD_DIR } from './paths.ts'
import { ID } from './pieces.ts'
import { barsScore, elementsScore } from './scores.ts'

// The edit journey (practice-app design D15, "edit: note, mark, preview, save & practice"; tasks 15.1 to
// 15.4; specs `score-editing`, `score-capture` "Add pages to a piece", `piece-library` "Rename"). The seeded
// piece is "Ode to Joy": three pages (bars 1-4, 5-8, 9-12), twelve bars of C5 D5 E5 F5 in 4/4 at 60 BPM, with no staff
// positions, so its photo strip shows the whole photo. A piece with staff positions and a real picture is made
// through the library where a journey needs one.
//
// Nothing opens the editor from a screen yet (the tools sheet of the practice screen is task 13.2), so the
// journeys push the editor on the router, as the tools sheet does.

const ODE = noteIdsByBar(barsScore(12, 60))

/** Opens the editor on a piece the way the tools sheet will, over what is on the stack. */
async function openEditor(page: Page, pieceId: string): Promise<void> {
  await page.evaluate((id) => window.__test!.shell.router.push({ name: 'editor', pieceId: id }), pieceId)
  await page.getByRole('heading', { name: 'Edit score', level: 1 }).waitFor()
  await page.locator('.score-view[data-rendered="true"]').waitFor()
}

/** Waits until the router shows this screen on top (the editor is replaced or popped when Save & practice has saved). */
const onScreen = (page: Page, name: string) => page.waitForFunction((n) => window.__test!.shell.router.screen.value.name === n, name)

const title = (page: Page) => page.getByRole('textbox', { name: 'Title' })
const save = (page: Page) => page.getByRole('button', { name: 'Save & practice' })
const tabs = (page: Page, name: 'Note' | 'Marks' | 'Score') => page.getByRole('radio', { name })
/** "Bar 3 · Note 4": what the tools say is selected. */
const selection = (page: Page) => textOf(page.locator('.editor-selection'))
const pitch = (page: Page) => textOf(page.getByRole('group', { name: 'Pitch' }).getByRole('status'))
const photoLabel = (page: Page) => textOf(page.locator('.editor-photo-label'))
const warnings = (page: Page) => page.getByRole('group', { name: 'Things to check' })

/** The notes of the stored score of a piece, as the library keeps them now. */
async function stored(app: App, pieceId: string): Promise<Score> {
  const info = JSON.parse((await app.file(`pieces/${pieceId}/piece.json`)) ?? '{}') as { score: string }
  return parseMusicXml((await app.file(`pieces/${pieceId}/${info.score}`)) ?? '')
}
const noteOf = (score: Score, id: string) => score.measures.flatMap((m) => m.items.filter(isNote)).find((n) => n.id === id)!

/** Waits until the score has this many of something drawn (the score is laid out again a moment after each edit). */
async function drawn(page: Page, selector: string, count: number): Promise<void> {
  await page.waitForFunction(([css, n]) => document.querySelectorAll(css as string).length === n, [selector, count] as const, { timeout: 5000 }).catch(async () => {
    assert.equal(await page.locator(selector).count(), count, `${selector} drawn`)
  })
}

/**
 * The seeded page is served from a folder below the root, so the sound it asks for (`samples/<sound>/`, next to the page)
 * is not there; serve it from the root of the build, where the app has it.
 */
async function serveSamples(app: App): Promise<void> {
  await app.context.route('https://localhost/test/ui/samples/**', (route) => {
    const file = `${BUILD_DIR}${new URL(route.request().url()).pathname.slice('/test/ui/'.length)}`
    if (!existsSync(file)) return route.fulfill({ status: 404, body: 'Not Found' })
    return route.fulfill({ status: 200, contentType: file.endsWith('.json') ? 'application/json' : 'audio/ogg', body: readFileSync(file) as never })
  })
}

/**
 * A piece that has staff positions and pictures to show: "Ode to Joy" again, three pages of four bars, each page
 * with one staff of two bars twice over, and a picture drawn here for every page. The page photos are blob URLs
 * of those pictures: the fake platform's own URLs are not images a page can load.
 */
async function makePhotoPiece(page: Page): Promise<string> {
  return page.evaluate(
    async ({ xml, bars }) => {
      const { platform, shell } = window.__test!
      const canvas = document.createElement('canvas')
      canvas.width = 800
      canvas.height = 1100
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#e9e3d3'
      ctx.fillRect(0, 0, 800, 1100)
      ctx.strokeStyle = '#2b2b2b'
      ctx.fillStyle = '#2b2b2b'
      // Two staves: the first at 22% to 32% of the height, the second at 52% to 62%.
      for (const top of [242, 572]) {
        for (let line = 0; line < 5; line++) {
          ctx.beginPath()
          ctx.moveTo(60, top + line * 22)
          ctx.lineTo(740, top + line * 22)
          ctx.stroke()
        }
        for (let n = 0; n < 8; n++) {
          ctx.beginPath()
          ctx.ellipse(130 + n * 80, top + 22 * (n % 5), 12, 9, -0.3, 0, Math.PI * 2)
          ctx.fill()
        }
      }
      const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.8))
      platform.files.seed('scans/test/page.jpg', new Uint8Array(await blob.arrayBuffer()))
      const files = platform.files as unknown as { imageUrl: (path: string) => Promise<string>; bytes: (path: string) => Uint8Array | undefined }
      files.imageUrl = async (path) => URL.createObjectURL(new Blob([files.bytes(path)! as BlobPart], { type: 'image/jpeg' }))
      const first = { x: 0.075, y: 0.22, width: 0.85, height: 0.1 }
      const second = { x: 0.075, y: 0.52, width: 0.85, height: 0.1 }
      const info = await shell.library.create({
        name: 'Ode to Joy',
        musicxml: xml,
        bars,
        repairs: [],
        pages: [0, 1, 2].map((p) => ({
          source: 'scans/test/page.jpg',
          recognised: xml,
          firstBar: p * 4 + 1,
          lastBar: p * 4 + 4,
          staves: [
            { box: first, firstBar: p * 4 + 1, lastBar: p * 4 + 2 },
            { box: second, firstBar: p * 4 + 3, lastBar: p * 4 + 4 },
          ],
        })),
      })
      return info.id
    },
    { xml: barsScore(12, 60), bars: 12 },
  )
}

test('edit: the frame shows the title, the score and the photo of the selected bar; a tap selects, Preview bar plays that bar', async () => {
  await withApp({ seed: 'library' }, async (app) => {
    const { page } = app
    await serveSamples(app)
    await openEditor(page, ID.ode)
    assert.equal(await title(page).inputValue(), 'Ode to Joy')
    assert.equal(await page.locator('.score-view svg g.note').count(), 48, 'the twelve bars are drawn')
    assert.equal(await selection(page), 'Tap a note to edit it.')
    await page.locator('.editor-photo--empty').waitFor()
    assert.equal(await page.getByRole('button', { name: /^Preview bar/ }).count(), 0, 'nothing to preview before a bar is chosen')
    assert.equal(await warnings(page).count(), 0, 'nothing to check: no warning and no mark')
    assert.equal(await page.locator('.score-view g.note.mk-flag, .score-view g.note.mk-flagbar').count(), 0)

    // A tap on a note selects it and its bar; the whole photo of page 1 shows (no staff positions are known).
    await tapNote(page, ODE[2]![3]!)
    assert.equal(await selection(page), 'Bar 3 · Note 4')
    assert.equal(await page.locator('.score-view g.note.mk-sel').count(), 1)
    assert.equal(await photoLabel(page), 'Photo 1 · Bar 3', 'the whole photo of the page, labelled with the bar')
    assert.equal(await page.locator('.editor-photo-crop').count(), 0)
    await page.getByRole('button', { name: 'Pages 1 / 3' }).waitFor()

    // Another page: the label and the page counter follow.
    await tapNote(page, ODE[5]![0]!)
    assert.equal(await selection(page), 'Bar 6 · Note 1')
    assert.equal(await photoLabel(page), 'Photo 2 · Bar 6')
    await page.getByRole('button', { name: 'Pages 2 / 3' }).waitFor()

    // Preview: the bar plays on its own, the button says Stop while it does, then it is a button to play again.
    await tapNote(page, ODE[2]![3]!)
    await page.evaluate(() => {
      const w = window as unknown as { __starts: number }
      w.__starts = 0
      const start = AudioBufferSourceNode.prototype.start
      AudioBufferSourceNode.prototype.start = function (...args: Parameters<typeof start>) {
        w.__starts++
        return start.apply(this, args)
      }
    })
    await page.getByRole('button', { name: 'Preview bar 3' }).click()
    await page.getByRole('button', { name: 'Stop preview' }).waitFor()
    // The sound loads in real time, and the notes are scheduled on the test clock: let it run until they are.
    const starts = () => page.evaluate(() => (window as unknown as { __starts: number }).__starts)
    for (let i = 0; i < 60 && (await starts()) === 0; i++) {
      await page.clock.runFor(250)
      await page.waitForTimeout(100)
    }
    assert.ok((await starts()) >= 1, 'a note of the bar sounded')
    await page.clock.runFor(6000)
    await page.getByRole('button', { name: 'Preview bar 3' }).waitFor()
    assert.equal(await starts(), 4, 'the four notes of bar 3, and no others')
    assert.deepEqual(await app.screen(), { name: 'editor', pieceId: ID.ode }, 'previewing leaves the editor open')
  })
})

test('edit: with staff positions the strip shows the staff of the bar with its margin, labelled with the page and the bar', async () => {
  await withApp({ seed: '' }, async (app) => {
    const { page } = app
    const id = await makePhotoPiece(page)
    await openEditor(page, id)
    const ids = noteIdsByBar(barsScore(12, 60))

    await tapNote(page, ids[2]![3]!)
    assert.equal(await photoLabel(page), 'Photo 1 · Bar 3')
    const crop = page.locator('.editor-photo-crop')
    await crop.waitFor()
    await page.waitForFunction(() => {
      const img = document.querySelector<HTMLImageElement>('.editor-photo-crop img')
      return !!img && img.complete && img.naturalWidth > 0
    })
    // The second staff of the page is at 52% to 62% of its height: the crop starts a little above it, and spans the width.
    const geometry = await crop.evaluate((element) => {
      const img = element.querySelector('img')!
      const frame = element.getBoundingClientRect()
      const drawn = img.getBoundingClientRect()
      return { frameWidth: frame.width, frameHeight: frame.height, left: (frame.left - drawn.left) / drawn.width, top: (frame.top - drawn.top) / drawn.height, bottom: (frame.bottom - drawn.top) / drawn.height }
    })
    assert.ok(Math.abs(geometry.top - (0.52 - 0.1 * 0.5)) < 0.01, `the strip starts above the staff (${geometry.top})`)
    assert.ok(Math.abs(geometry.bottom - (0.62 + 0.1 * 0.5)) < 0.01, `and ends below it (${geometry.bottom})`)
    assert.ok(geometry.left < 0.06, 'and starts at the left edge of the staff, with its margin')
    // The crop keeps the proportions of the photo (800 x 1100): no stretching.
    const expected = (0.2 * 1100) / (0.89 * 800)
    assert.ok(Math.abs(geometry.frameHeight / geometry.frameWidth - expected) < 0.05, `proportions ${geometry.frameHeight / geometry.frameWidth} against ${expected}`)

    // Bar 1 is on the first staff: the strip moves up the page.
    await tapNote(page, ids[0]![0]!)
    assert.equal(await photoLabel(page), 'Photo 1 · Bar 1')
    const first = await crop.evaluate((element) => {
      const frame = element.getBoundingClientRect()
      const drawn = element.querySelector('img')!.getBoundingClientRect()
      return (frame.top - drawn.top) / drawn.height
    })
    assert.ok(Math.abs(first - (0.22 - 0.1 * 0.5)) < 0.01, `the first staff (${first})`)
    await tapNote(page, ids[9]![1]!)
    assert.equal(await photoLabel(page), 'Photo 3 · Bar 10')
    await page.getByRole('button', { name: 'Pages 3 / 3' }).waitFor()
  })
})

test('edit: go to bar, the page photos and the sheets close with the back button; the pages sheet shows every photo', async () => {
  await withApp({ seed: 'library' }, async (app) => {
    const { page } = app
    await openEditor(page, ID.ode)

    await page.getByRole('button', { name: 'Go to bar…' }).click()
    const sheet = page.getByRole('dialog', { name: 'Go to bar' })
    await sheet.waitFor()
    const field = sheet.getByRole('textbox', { name: 'Bar number' })
    await field.fill('13')
    await sheet.getByRole('button', { name: 'Show' }).click()
    await sheet.getByRole('alert').waitFor()
    assert.match(await textOf(sheet), /Enter a bar from 1 to 12\./)
    await field.fill('7')
    await sheet.getByRole('button', { name: 'Show' }).click()
    await sheet.waitFor({ state: 'detached' })
    assert.equal(await photoLabel(page), 'Photo 2 · Bar 7', 'bar 7 is on page 2')
    assert.equal(await selection(page), 'Tap a note to edit it.', 'a bar, not a note, is selected')
    await page.getByRole('button', { name: 'Preview bar 7' }).waitFor()

    // The back button closes the sheet before it leaves the editor.
    await page.getByRole('button', { name: 'Pages 2 / 3' }).click()
    const pages = page.getByRole('dialog', { name: 'Page photos' })
    await pages.waitFor()
    assert.equal(await pages.getByRole('listitem').count(), 3)
    assert.equal(await app.back(), true)
    await pages.waitFor({ state: 'detached' })
    assert.deepEqual(await app.screen(), { name: 'editor', pieceId: ID.ode })

    await page.getByRole('button', { name: 'Pages 2 / 3' }).click()
    await pages.getByRole('button', { name: 'Go to bar 9' }).click()
    await pages.waitFor({ state: 'detached' })
    await page.getByRole('button', { name: 'Pages 3 / 3' }).waitFor()
    assert.equal(await photoLabel(page), 'Photo 3 · Bar 9')
  })
})

test('edit: the Note tab steps a pitch down and Save & practice stores the corrected score; the original reading stays as it was', async () => {
  await withApp({ seed: 'library' }, async (app) => {
    const { page } = app
    const reading = await app.file(`pieces/${ID.ode}/pages/1/recognised.musicxml`)
    assert.equal(reading, barsScore(4, 60), 'the raw reading of page 1')
    await openEditor(page, ID.ode)

    // "Bar 3, note 4" is F5: it is a wrong pitch; step it down once, and it is E5.
    const f5 = ODE[2]![3]!
    await tapNote(page, f5)
    assert.equal(await pitch(page), 'F5')
    await page.getByRole('button', { name: 'Pitch down' }).click()
    assert.equal(await pitch(page), 'E5')
    assert.equal(await page.getByRole('button', { name: 'Undo' }).isEnabled(), true)
    assert.equal(await page.getByRole('button', { name: 'Redo' }).isEnabled(), false)
    await page.getByRole('button', { name: 'Undo' }).click()
    assert.equal(await pitch(page), 'F5', 'undo')
    await page.getByRole('button', { name: 'Redo' }).click()
    assert.equal(await pitch(page), 'E5', 'redo')

    // The accidental, the length, a dot, and a note after it; each is one edit of the selected note.
    await page.getByRole('combobox', { name: 'Accidental' }).selectOption('sharp')
    assert.equal(await pitch(page), 'E♯5')
    await page.getByRole('combobox', { name: 'Accidental' }).selectOption('none')
    await page.getByRole('combobox', { name: 'Length' }).selectOption('half')
    assert.equal(await page.getByRole('group', { name: 'Things to check' }).count(), 1, 'a half note in a full bar: the bar no longer adds up')
    assert.match(await textOf(warnings(page)), /1 thing to check/)
    await page.getByRole('button', { name: 'Dotted' }).click()
    assert.equal(await page.getByRole('button', { name: 'Dotted' }).getAttribute('aria-pressed'), 'true')
    await page.getByRole('button', { name: 'Dotted' }).click()
    await page.getByRole('combobox', { name: 'Length' }).selectOption('quarter')
    assert.equal(await warnings(page).count(), 0, 'back to a quarter: the flag goes')

    await title(page).fill('Ode to Joy, corrected')
    await save(page).click()
    await onScreen(page, 'practice')
    assert.deepEqual(await app.screen(), { name: 'practice', pieceId: ID.ode }, 'save & practice opens practice')

    // The stored score has the correction; the page's reading does not; the name is saved.
    const score = await stored(app, ID.ode)
    assert.deepEqual(noteOf(score, f5).pitch, { step: 'E', octave: 5 })
    assert.deepEqual(noteOf(score, ODE[2]![2]!).pitch, { step: 'E', octave: 5 }, 'the neighbour is as it was')
    assert.equal(await app.file(`pieces/${ID.ode}/pages/1/recognised.musicxml`), reading)
    assert.equal(await app.file(`pieces/${ID.ode}/pages/3/recognised.musicxml`), barsScore(4, 60))
    assert.match((await app.file(`pieces/${ID.ode}/piece.json`)) ?? '', /"name": "Ode to Joy, corrected"/)

    // The library lists the new name.
    await app.back()
    await tab(page, 'Library').click()
    await page.getByRole('button', { name: /^Ode to Joy, corrected\b/ }).waitFor()
    assert.equal(await page.getByRole('button', { name: /^Ode to Joy\b(?!,)/ }).count(), 0, 'and not the old one')
  })
})

test('edit: the Note tab makes a rest, inserts notes and rests, and deletes; a rest has no pitch to step', async () => {
  await withApp({ seed: 'library' }, async (app) => {
    const { page } = app
    await openEditor(page, ID.ode)
    const notes = '.score-view svg g.note, .score-view svg g.rest'
    await drawn(page, notes, 48)

    await tapNote(page, ODE[0]![1]!)
    await page.getByRole('button', { name: 'Make rest' }).click()
    assert.equal(await selection(page), 'Bar 1 · Rest 2')
    assert.equal(await pitch(page), 'Rest')
    assert.equal(await page.getByRole('button', { name: 'Pitch up' }).isDisabled(), true)
    assert.equal(await page.getByRole('combobox', { name: 'Accidental' }).isDisabled(), true)
    await page.getByRole('button', { name: 'Make note' }).click()
    assert.equal(await selection(page), 'Bar 1 · Note 2')

    await page.getByRole('button', { name: '+ Rest after' }).click()
    assert.equal(await selection(page), 'Bar 1 · Rest 3', 'the new rest is selected')
    await drawn(page, notes, 49)
    assert.match(await textOf(warnings(page)), /1 thing to check/, 'bar 1 has five beats now')
    await page.getByRole('button', { name: 'Delete note' }).click()
    await drawn(page, notes, 48)
    assert.equal(await warnings(page).count(), 0)
    await page.getByRole('button', { name: '+ Note before' }).click()
    await drawn(page, notes, 49)
    await page.getByRole('button', { name: 'Undo' }).click()
    await drawn(page, notes, 48)
  })
})

test('edit: the Marks tab turns marks on and off, and chooses a slur and a crescendo by their first and last note; both show after saving', async () => {
  await withApp({ seed: '' }, async (app) => {
    const { page } = app
    const ode = await makePhotoPiece(page)
    await openEditor(page, ode)
    await tabs(page, 'Marks').click()
    const mark = (name: string) => page.getByRole('button', { name, exact: true })
    const on = async (name: string) => (await mark(name).getAttribute('aria-pressed')) === 'true'

    // Staccato on the selected note, and tapping the active mark takes it off.
    assert.equal(await mark('Staccato').isDisabled(), true, 'no note, no mark')
    await tapNote(page, ODE[2]![3]!)
    await mark('Staccato').click()
    assert.equal(await on('Staccato'), true)
    await mark('Staccato').click()
    assert.equal(await on('Staccato'), false)
    for (const name of ['Tenuto', 'Accent', 'Fermata']) {
      await mark(name).click()
      assert.equal(await on(name), true, name)
      await mark(name).click()
      assert.equal(await on(name), false, `${name} off`)
    }

    // A slur: choose it, tap the first note of the phrase and then the last one.
    await mark('Slur').click()
    await page.getByText('Tap the first note.').waitFor()
    await tapNote(page, ODE[0]![0]!)
    await page.getByText('Now tap the last note.').waitFor()
    assert.equal(await page.locator('.score-view g.slur').count(), 0, 'not before the last note is chosen')
    await tapNote(page, ODE[0]![3]!)
    assert.equal(await on('Slur'), true, 'the last note has the slur')
    await drawn(page, '.score-view g.slur', 1)
    assert.equal(await page.getByText('Tap the first note.').count(), 0)

    // A crescendo over bar 3, and a diminuendo that would overlap it is refused with a reason.
    await mark('Crescendo').click()
    await tapNote(page, ODE[2]![0]!)
    await tapNote(page, ODE[2]![3]!)
    assert.equal(await on('Crescendo'), true)
    await drawn(page, '.score-view g.hairpin', 1)
    await mark('Diminuendo').click()
    await tapNote(page, ODE[2]![1]!)
    await tapNote(page, ODE[3]![0]!)
    await page.getByText('A crescendo or diminuendo needs a note under it and cannot overlap another one.').waitFor()
    assert.equal(await page.locator('.score-view g.hairpin').count(), 1)

    // A tie needs the next note to have the same pitch: C5 D5 do not.
    await mark('Tie').click()
    await tapNote(page, ODE[0]![0]!)
    await tapNote(page, ODE[0]![1]!)
    await page.getByText('A tie joins a note to the next note, and both need the same pitch.').waitFor()

    // Saved, the stored score has both, and the editor opened again draws both.
    await save(page).click()
    await onScreen(page, 'practice')
    const score = await stored(app, ode)
    assert.deepEqual(noteOf(score, ODE[0]![0]!).slurs, [{ type: 'start', number: 1 }])
    assert.deepEqual(noteOf(score, ODE[0]![3]!).slurs, [{ type: 'stop', number: 1 }])
    const wedge = score.measures[2]!.items.find(isWedge)
    assert.deepEqual([wedge?.type, wedge?.start, wedge?.stop], ['crescendo', ODE[2]![0]!, ODE[2]![3]!])
    await openEditor(page, ode)
    await drawn(page, '.score-view g.slur', 1)
    await drawn(page, '.score-view g.hairpin', 1)

    // Tapping the active mark removes the hairpin from any note under it.
    await tabs(page, 'Marks').click()
    await tapNote(page, ODE[2]![1]!)
    assert.equal(await on('Crescendo'), true, 'every note under it shows it')
    await mark('Crescendo').click()
    await drawn(page, '.score-view g.hairpin', 0)
  })
})

test('edit: the Marks tab sets how a bar starts and ends, and the passes of an end-repeat; saving stores the repeat signs (change edit-bar-lines)', async () => {
  await withApp({ seed: 'library' }, async (app) => {
    const { page } = app
    await openEditor(page, ID.ode)
    await tabs(page, 'Marks').click()
    const group = page.getByRole('region', { name: 'Bar lines' })
    const start = group.getByRole('combobox', { name: 'Starts with' })
    const end = group.getByRole('combobox', { name: 'Ends with' })
    assert.equal(await start.isDisabled(), true, 'no bar selected: the group is disabled')
    assert.equal(await end.isDisabled(), true)

    // A bar without a note ("Go to bar") has the group too.
    await page.getByRole('button', { name: 'Go to bar…' }).click()
    const sheet = page.getByRole('dialog', { name: 'Go to bar' })
    await sheet.getByRole('textbox', { name: 'Bar number' }).fill('7')
    await sheet.getByRole('button', { name: 'Show' }).click()
    await sheet.waitFor({ state: 'detached' })
    await page.getByRole('heading', { name: 'Bar 7' }).waitFor()
    assert.equal(await start.isDisabled(), false)

    await tapNote(page, ODE[2]![1]!)
    await page.getByRole('heading', { name: 'Bar 3' }).waitFor()
    assert.equal(await start.inputValue(), 'normal')
    assert.equal(await end.inputValue(), 'normal')
    const passes = group.getByRole('group', { name: 'Played' })
    assert.equal(await passes.count(), 0, 'no passes without an end-repeat')

    await start.selectOption('repeat')
    await end.selectOption('repeat')
    assert.equal(await textOf(passes.getByRole('status')), '2×')
    await passes.getByRole('button', { name: 'Play the section more times' }).click()
    assert.equal(await textOf(passes.getByRole('status')), '3×')
    await page.getByRole('button', { name: 'Undo' }).click()
    assert.equal(await textOf(passes.getByRole('status')), '2×', 'one undo takes the step back')
    assert.equal(await start.inputValue(), 'repeat')
    assert.equal(await passes.getByRole('button', { name: 'Play the section fewer times' }).isDisabled(), true, 'two passes is the fewest')

    await save(page).click()
    await onScreen(page, 'practice')
    const xml = (await app.file(`pieces/${ID.ode}/${JSON.parse((await app.file(`pieces/${ID.ode}/piece.json`))!).score}`)) ?? ''
    const bar3 = /<measure number="3"[\s\S]*?<\/measure>/.exec(xml)?.[0] ?? ''
    assert.match(bar3, /<barline location="left">\s*<bar-style>heavy-light<\/bar-style>\s*<repeat direction="forward"\/>/)
    assert.match(bar3, /<barline location="right">\s*<bar-style>light-heavy<\/bar-style>\s*<repeat direction="backward"\/>/)
    const saved = await stored(app, ID.ode)
    assert.deepEqual([saved.measures[2]!.leftBarline?.repeat, saved.measures[2]!.rightBarline?.repeat, saved.measures[2]!.rightBarline?.times], ['forward', 'backward', undefined])
  })
})

test('edit: the bar-line group speaks Dutch', async () => {
  await withApp({ seed: 'library', language: 'nl' }, async (app) => {
    const { page } = app
    await page.evaluate((id) => window.__test!.shell.router.push({ name: 'editor', pieceId: id }), ID.ode)
    await page.locator('.score-view[data-rendered="true"]').waitFor()
    await page.getByRole('radio', { name: 'Tekens' }).click()
    await tapNote(page, ODE[2]![1]!)
    const group = page.getByRole('region', { name: 'Maatstrepen' })
    await group.getByRole('heading', { name: 'Maat 3' }).waitFor()
    await group.getByRole('combobox', { name: 'Begint met' }).selectOption('repeat')
    await group.getByRole('combobox', { name: 'Eindigt met' }).selectOption('repeat')
    assert.equal(await textOf(group.getByRole('group', { name: 'Gespeeld' }).getByRole('status')), '2×')
    assert.match(await textOf(group), /Begin herhaling ‖:/)
  })
})

test('edit: the Score tab changes the key and the time signature, which draws the score again and checks the bars, and the written tempo', async () => {
  await withApp({ seed: '' }, async (app) => {
    const { page } = app
    const ode = await makePhotoPiece(page)
    await openEditor(page, ode)
    await tapNote(page, ODE[2]![3]!)
    await tabs(page, 'Score').click()
    assert.equal(await selection(page), 'Whole score')
    const key = page.getByRole('combobox', { name: 'Key' })
    const time = page.getByRole('combobox', { name: 'Time signature' })
    assert.equal(await key.inputValue(), '0')
    assert.equal(await time.inputValue(), '4/4')
    assert.equal(await page.locator('.score-view g.keyAccid').count(), 0, 'no sharps or flats')

    // One sharp: the score is drawn again with a key signature on every line.
    await key.selectOption('1')
    await page.waitForFunction(() => document.querySelectorAll('.score-view g.keyAccid').length > 0)
    assert.ok((await page.locator('.score-view g.keyAccid').count()) >= 1, 'a sharp in the key signature')
    assert.equal(await page.locator('.score-view g.note').count(), 48)
    await key.selectOption('-2')
    assert.equal(await key.inputValue(), '-2')
    await page.getByRole('button', { name: 'Undo' }).click()
    await page.getByRole('button', { name: 'Undo' }).click()
    assert.equal(await key.inputValue(), '0')

    // 3/4: every bar has four beats, so every bar is flagged, and Next goes from bar to bar after the selected note (bar 3).
    await time.selectOption('3/4')
    assert.match(await textOf(warnings(page)), /12 things to check/)
    await page.getByRole('button', { name: 'Next' }).click()
    assert.match(await textOf(page.locator('.editor-warnings-text')), /Bar 4 adds up to 4 beats but 3\/4 needs 3\./)
    await page.getByRole('button', { name: 'Next' }).click()
    assert.match(await textOf(page.locator('.editor-warnings-text')), /Bar 5 adds up/)
    assert.equal(await photoLabel(page), 'Photo 2 · Bar 5', 'the warning in bar 5 is on page 2')
    assert.ok((await page.locator('.score-view g.note.mk-flagbar').count()) >= 4, 'the notes of flagged bars are marked')
    await page.getByRole('button', { name: 'Previous' }).click()
    assert.match(await textOf(page.locator('.editor-warnings-text')), /Bar 4 adds up/)
    await time.selectOption('4/4')
    assert.equal(await warnings(page).count(), 0, 'fixed: the flags go')

    // The written tempo: the stepper starts from the metronome mark of the piece (60) and moves by two.
    const tempo = page.getByRole('group', { name: 'Tempo marking' })
    assert.equal(await textOf(tempo.getByRole('status')), '60 BPM')
    await tempo.getByRole('button', { name: 'Raise the written tempo' }).click()
    await tempo.getByRole('button', { name: 'Raise the written tempo' }).click()
    assert.equal(await textOf(tempo.getByRole('status')), '64 BPM')
    await tempo.getByRole('button', { name: 'Lower the written tempo' }).click()
    assert.equal(await textOf(tempo.getByRole('status')), '62 BPM')
    // Held down, it keeps stepping, and the whole hold is one undo step.
    const now = await page.evaluate(() => Date.now())
    await page.clock.pauseAt(new Date(now + 10))
    await tempo.getByRole('button', { name: 'Raise the written tempo' }).hover()
    await page.mouse.down()
    await page.clock.runFor(1000) // the press and repeats at 400, 550, 685, 806 and 916 ms
    await page.mouse.up()
    assert.equal(await textOf(tempo.getByRole('status')), '74 BPM')
    await page.getByRole('button', { name: 'Undo' }).click()
    assert.equal(await textOf(tempo.getByRole('status')), '62 BPM', 'one undo takes the whole hold back')
    await page.clock.resume()
    await save(page).click()
    await onScreen(page, 'practice')
    assert.match((await app.file(`pieces/${ode}/${JSON.parse((await app.file(`pieces/${ode}/piece.json`))!).score}`)) ?? '', /<per-minute>62<\/per-minute>/)
  })
})

test('edit: a warning is marked on the note and goes when the note is fixed (the range of the tenor saxophone)', async () => {
  await withApp({ seed: 'library' }, async (app) => {
    const { page } = app
    await openEditor(page, ID.ode)
    // C5 down to A3: nine steps, and the written A3 is below the tenor saxophone's B♭3.
    await tapNote(page, ODE[0]![0]!)
    for (let i = 0; i < 9; i++) await page.getByRole('button', { name: 'Pitch down' }).click()
    assert.equal(await pitch(page), 'A3')
    assert.match(await textOf(warnings(page)), /1 thing to check/)
    assert.equal(await page.locator('.score-view g.note.mk-flag').count(), 1, 'the note is marked')
    await page.getByRole('button', { name: 'Next' }).click()
    assert.match(await textOf(page.locator('.editor-warnings-text')), /A3 is outside the written range of the instrument \(Tenor saxophone/)
    await page.getByRole('button', { name: 'Pitch up' }).click()
    assert.equal(await warnings(page).count(), 0, 'the count goes down and the mark with it')
    assert.equal(await page.locator('.score-view g.note.mk-flag').count(), 0)
  })
})

test('edit: Cancel and the back button ask before throwing edits away, and not when there are none', async () => {
  await withApp({ seed: 'library' }, async (app) => {
    const { page } = app
    // No edits: Cancel leaves at once.
    await openEditor(page, ID.ode)
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await page.getByRole('heading', { name: 'Let’s practise' }).waitFor()
    assert.equal((await app.stack()).length, 1)

    // An edit: Cancel asks; "Keep editing" stays, and nothing was saved.
    await openEditor(page, ID.ode)
    await tapNote(page, ODE[0]![0]!)
    await page.getByRole('button', { name: 'Pitch down' }).click()
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    const dialog = page.getByRole('alertdialog', { name: 'Discard your edits?' })
    await dialog.waitFor()
    await dialog.getByRole('button', { name: 'Keep editing' }).click()
    await dialog.waitFor({ state: 'detached' })
    assert.deepEqual(await app.screen(), { name: 'editor', pieceId: ID.ode })
    assert.equal(await pitch(page), 'B4', 'the edit is still here')

    // The system back button asks the same question, and Discard leaves without saving.
    assert.equal(await app.back(), true)
    await dialog.waitFor()
    await dialog.getByRole('button', { name: 'Discard' }).click()
    await page.getByRole('heading', { name: 'Let’s practise' }).waitFor()
    assert.deepEqual(noteOf(await stored(app, ID.ode), ODE[0]![0]!).pitch, { step: 'C', octave: 5 }, 'nothing was saved')

    // Undoing every edit makes it clean again, and a changed title is an edit too.
    await openEditor(page, ID.ode)
    await tapNote(page, ODE[0]![0]!)
    await page.getByRole('button', { name: 'Pitch down' }).click()
    await page.getByRole('button', { name: 'Undo' }).click()
    assert.equal(await app.back(), true)
    await page.getByRole('heading', { name: 'Let’s practise' }).waitFor()
    await openEditor(page, ID.ode)
    await title(page).fill('Something else')
    assert.equal(await app.back(), true)
    await dialog.waitFor()
    await dialog.getByRole('button', { name: 'Keep editing' }).click()
  })
})

test('edit: Save & practice from an editor opened over practice goes back to practice; from anywhere else it replaces the editor', async () => {
  await withApp({ seed: 'library' }, async (app) => {
    const { page } = app
    const names = async () => (await app.stack()).map((screen) => (screen as { name: string }).name)

    // Over the practice screen of the piece: back to a practice screen of it that does not start playing again.
    await page.evaluate((id) => window.__test!.shell.router.push({ name: 'practice', pieceId: id, autoplay: true }), ID.ode)
    await openEditor(page, ID.ode)
    assert.deepEqual(await names(), ['home', 'practice', 'editor'])
    await tapNote(page, ODE[0]![0]!)
    await page.getByRole('button', { name: 'Pitch down' }).click()
    await save(page).click()
    await onScreen(page, 'practice')
    assert.deepEqual(await names(), ['home', 'practice'])
    assert.deepEqual(await app.screen(), { name: 'practice', pieceId: ID.ode })
    assert.deepEqual(noteOf(await stored(app, ID.ode), ODE[0]![0]!).pitch, { step: 'B', octave: 4 })

    // Over the home (or anything else): practice takes its place.
    await app.back()
    await openEditor(page, ID.warmUp)
    assert.deepEqual(await names(), ['home', 'editor'])
    await save(page).click()
    await onScreen(page, 'practice')
    assert.deepEqual(await names(), ['home', 'practice'])
    assert.deepEqual(await app.screen(), { name: 'practice', pieceId: ID.warmUp })
  })
})

test('edit: a new title is the practice heading at once after Save & practice, over practice and from anywhere else', async () => {
  await withApp({ seed: 'library' }, async (app) => {
    const { page } = app
    const heading = () => textOf(page.locator('.practice-title'))

    // Over the practice screen of the piece: the practice screen it goes back to has the new name.
    await page.evaluate((id) => window.__test!.shell.router.push({ name: 'practice', pieceId: id }), ID.ode)
    await page.locator('.practice-title').filter({ hasText: 'Ode to Joy' }).waitFor()
    await openEditor(page, ID.ode)
    await title(page).fill('Ode to Joy, slow')
    await save(page).click()
    await onScreen(page, 'practice')
    assert.equal(await heading(), 'Ode to Joy, slow')

    // From the home: the practice screen that takes the editor's place has it too.
    await app.back()
    await openEditor(page, ID.warmUp)
    await title(page).fill('Warm-up in C')
    await save(page).click()
    await onScreen(page, 'practice')
    assert.equal(await heading(), 'Warm-up in C')
  })
})

test('edit: a piece is renamed through its title (an empty name is refused), and a piece saved elsewhere is a conflict that keeps the edits', async () => {
  await withApp({ seed: 'library' }, async (app) => {
    const { page } = app
    await openEditor(page, ID.warmUp)
    await title(page).fill('   ')
    await save(page).click()
    await page.getByRole('alert').filter({ hasText: 'Give the piece a name.' }).waitFor()
    assert.deepEqual(await app.screen(), { name: 'editor', pieceId: ID.warmUp })
    assert.match((await app.file(`pieces/${ID.warmUp}/piece.json`)) ?? '', /"name": "C major warm-up"/)

    // The piece is saved by someone else while it is open: the edits are not written and stay in the editor.
    await title(page).fill('Ode to Joy')
    await page.evaluate(async (id) => {
      const { library } = window.__test!.shell
      const piece = await library.load(id)
      await library.writeScore(id, piece.musicxml, piece.info.score)
    }, ID.warmUp)
    await tapNote(page, noteIdsByBar(barsScore(4, 60))[0]![0]!)
    await page.getByRole('button', { name: 'Pitch down' }).click()
    await save(page).click()
    await page.getByRole('alert').filter({ hasText: 'This piece was changed since you opened it' }).waitFor()
    assert.equal(await pitch(page), 'B4', 'the edit is still here')
    assert.deepEqual(await app.screen(), { name: 'editor', pieceId: ID.warmUp })
    assert.match((await app.file(`pieces/${ID.warmUp}/piece.json`)) ?? '', /"name": "C major warm-up"/, 'nothing was written')
  })
})

test('edit: "+ Add pages" opens adding music for this piece, after asking to save the edits that would be lost', async () => {
  await withApp({ seed: 'library' }, async (app) => {
    const { page } = app
    // No edits: straight to the add-music screen for this piece.
    await openEditor(page, ID.ode)
    await page.getByRole('button', { name: '+ Add pages' }).click()
    assert.deepEqual(await app.screen(), { name: 'add-music', pieceId: ID.ode })
    await app.back()
    await page.getByRole('heading', { name: 'Edit score', level: 1 }).waitFor()

    // With edits: the question first. Cancel stays; Save and add pages saves, then goes on.
    await tapNote(page, ODE[0]![0]!)
    await page.getByRole('button', { name: 'Pitch down' }).click()
    await page.getByRole('button', { name: '+ Add pages' }).click()
    const dialog = page.getByRole('alertdialog', { name: 'Save your edits first?' })
    await dialog.waitFor()
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await dialog.waitFor({ state: 'detached' })
    assert.deepEqual(await app.screen(), { name: 'editor', pieceId: ID.ode })
    assert.deepEqual(noteOf(await stored(app, ID.ode), ODE[0]![0]!).pitch, { step: 'C', octave: 5 })

    await page.getByRole('button', { name: '+ Add pages' }).click()
    await dialog.getByRole('button', { name: 'Save and add pages' }).click()
    await page.waitForFunction(() => window.__test!.shell.router.screen.value.name === 'add-music')
    assert.deepEqual(await app.screen(), { name: 'add-music', pieceId: ID.ode })
    assert.deepEqual(noteOf(await stored(app, ID.ode), ODE[0]![0]!).pitch, { step: 'B', octave: 4 }, 'the edit was saved')

    // Back from adding music, the editor opens again on what is stored, with the correction in it.
    await app.back()
    await page.getByRole('heading', { name: 'Edit score', level: 1 }).waitFor()
    await page.locator('.score-view[data-rendered="true"]').waitFor()
    await tapNote(page, ODE[0]![0]!)
    assert.equal(await pitch(page), 'B4')
    assert.equal(await app.back(), true, 'a clean editor leaves without asking')
  })
})

// ---- Select and delete elements (change select-and-delete-elements, tasks 3.2 and 3.3) --------------------

/** A piece of `elementsScore()`: a slur in bar 1, an mf in bar 2, a misread bass clef at bar 3. */
async function makeElementsPiece(page: Page): Promise<string> {
  return page.evaluate(
    async ({ xml }) => {
      const { platform, shell } = window.__test!
      platform.files.seed('scans/test/page.jpg', Uint8Array.of(0xff, 0xd8, 0xff, 0xe0))
      const info = await shell.library.create({
        name: 'Misread clef',
        musicxml: xml,
        bars: 4,
        repairs: [],
        pages: [{ source: 'scans/test/page.jpg', recognised: xml, firstBar: 1, lastBar: 4 }],
      })
      return info.id
    },
    { xml: elementsScore() },
  )
}

/** The centre of a drawn element, scrolled into view. */
async function centre(page: Page, selector: string, nth = 0): Promise<{ x: number; y: number }> {
  const element = page.locator(selector).nth(nth)
  await element.scrollIntoViewIfNeeded()
  const box = await element.boundingBox()
  assert.ok(box, `${selector} is not drawn`)
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

/** A point on the stroke of a slur (its bounding box covers the notes under it, so its centre is not on it). */
async function onSlur(page: Page): Promise<{ x: number; y: number }> {
  await page.locator('.score-view g.slur').first().scrollIntoViewIfNeeded()
  return page.evaluate(() => {
    const path = document.querySelector<SVGGeometryElement>('.score-view g.slur path')!
    const point = path.getPointAtLength(path.getTotalLength() / 2)
    const m = path.getScreenCTM()!
    return { x: point.x * m.a + point.y * m.c + m.e, y: point.x * m.b + point.y * m.d + m.f }
  })
}

const panel = (page: Page, name = 'Selected element') => page.getByRole('region', { name })

test('edit: a tap picks the element under the finger, else the nearest note; the selected element is highlighted', async () => {
  await withApp({ seed: '' }, async (app) => {
    const { page } = app
    const id = await makeElementsPiece(page)
    await openEditor(page, id)
    const ids = noteIdsByBar(elementsScore())

    // The mf sits under the first note of bar 2: the mf is selected, not the note.
    const mf = await centre(page, '.score-view g.dynam')
    await page.touchscreen.tap(mf.x, mf.y)
    await panel(page).waitFor()
    assert.equal(await textOf(panel(page).locator('.editor-element-title')), 'Dynamic · mf · bar 2')
    assert.equal(await page.locator('.score-view g.dynam.mk-el').count(), 1, 'the mf is highlighted')
    assert.equal(await page.locator('.score-view g.note.mk-sel').count(), 0, 'no note is selected')

    // Beside the staff, near a note: the note (and the element goes).
    const note = page.locator(`.score-view svg g.note[id="${ids[0]![3]!}"]`)
    await note.scrollIntoViewIfNeeded()
    const box = (await note.boundingBox())!
    await page.touchscreen.tap(box.x + box.width / 2, box.y - 14)
    await page.waitForFunction(() => document.querySelectorAll('.score-view g.note.mk-sel').length === 1)
    assert.equal(await panel(page).count(), 0, 'a note brings the normal tabs back')
    assert.equal(await page.locator('.score-view .mk-el').count(), 0)

    // A slur's drawing covers the notes under it, but a tap on a note still selects the note.
    await tapNote(page, ids[0]![0]!)
    assert.equal(await panel(page).count(), 0)
    assert.equal(await page.locator(`.score-view g.note.mk-sel[id="${ids[0]![0]!}"]`).count(), 1)
    // And on its stroke, the slur.
    const slur = await onSlur(page)
    await page.touchscreen.tap(slur.x, slur.y)
    await panel(page).waitFor()
    assert.match(await textOf(panel(page).locator('.editor-element-title')), /^Slur · bar 1$/)

    // A staccato dot is smaller than a finger: a tap a few pixels beside it still selects it, not its note.
    const dot = page.locator('.score-view g.artic').first()
    await dot.scrollIntoViewIfNeeded()
    const dotBox = (await dot.boundingBox())!
    await page.touchscreen.tap(dotBox.x + dotBox.width + 3, dotBox.y + dotBox.height / 2)
    await page.waitForFunction(() => document.querySelector('.editor-element-title')?.textContent === 'Staccato · bar 2')
    assert.equal(await page.locator('.score-view g.artic.mk-el').count(), 1, 'the dot is highlighted')

    // An empty part of the score puts the element away, and keeps its bar.
    await page.touchscreen.tap(...(await emptySpot(page)))
    await panel(page).waitFor({ state: 'detached' })
    assert.equal(await page.locator('.score-view .mk-el').count(), 0)
  })
})

/** A point in the visible score that is on no note, element or staff line: its right margin, at the top. */
async function emptySpot(page: Page): Promise<[number, number]> {
  const box = (await page.locator('.score-island').boundingBox())!
  return [box.x + box.width - 4, box.y + 6]
}

test('edit: deleting a misread clef moves the notes up 12 steps, as one undo step, and is stored', async () => {
  await withApp({ seed: '' }, async (app) => {
    const { page } = app
    const id = await makeElementsPiece(page)
    await openEditor(page, id)
    // The clef change of bar 3 is drawn at the end of bar 2, with the drawing id `clef-2` (a bar from 0).
    const at = await centre(page, '.score-view g.clef[id="clef-2"]')
    await page.touchscreen.tap(at.x, at.y)
    await panel(page).waitFor()
    assert.equal(await textOf(panel(page).locator('.editor-element-title')), 'Clef · bass · bar 3')

    await panel(page).getByRole('button', { name: 'Delete' }).click()
    await panel(page).waitFor({ state: 'detached' })
    await save(page).click()
    await onScreen(page, 'practice')
    const saved = await stored(app, id)
    assert.equal(saved.measures[2]!.clef, undefined, 'no clef at bar 3')
    const bar3 = saved.measures[2]!.items.filter(isNote).map((n) => `${n.pitch!.step}${n.pitch!.octave}`)
    assert.deepEqual(bar3, ['B4', 'D5', 'F5', 'A5'], 'D3 is B4: twelve diatonic steps up')
    assert.deepEqual(saved.measures[3]!.items.filter(isNote).map((n) => `${n.pitch!.step}${n.pitch!.octave}`), ['B4', 'D5', 'F5', 'A5'], 'up to the end of the piece')
  })
})

test('edit: the clef select changes a clef and keeps its notes on the staff; the first clef has no Delete', async () => {
  await withApp({ seed: '' }, async (app) => {
    const { page } = app
    const id = await makeElementsPiece(page)
    await openEditor(page, id)
    const first = await centre(page, '.score-view g.clef', 0)
    await page.touchscreen.tap(first.x, first.y)
    await panel(page).waitFor()
    assert.equal(await textOf(panel(page).locator('.editor-element-title')), 'Clef · treble · bar 1')
    assert.equal(await panel(page).getByRole('button', { name: 'Delete' }).count(), 0, 'the first clef is changed, not deleted')
    const select = panel(page).getByRole('combobox', { name: 'Clef' })
    await select.selectOption('bass')
    assert.equal(await textOf(panel(page).locator('.editor-element-title')), 'Clef · bass · bar 1')
    await page.getByRole('button', { name: 'Undo' }).click()
    assert.equal(await textOf(panel(page).locator('.editor-element-title')), 'Clef · treble · bar 1', 'one undo takes it back')
  })
})

test('edit: deleting a slur through the panel is one undo step, and undo brings it back', async () => {
  await withApp({ seed: '' }, async (app) => {
    const { page } = app
    const id = await makeElementsPiece(page)
    await openEditor(page, id)
    await drawn(page, '.score-view g.slur', 1)
    const slur = await onSlur(page)
    await page.touchscreen.tap(slur.x, slur.y)
    await panel(page).waitFor()
    await panel(page).getByRole('button', { name: 'Delete' }).click()
    await drawn(page, '.score-view g.slur', 0)
    await panel(page).waitFor({ state: 'detached' })
    await page.getByRole('button', { name: 'Undo' }).click()
    await drawn(page, '.score-view g.slur', 1)
    await panel(page).waitFor()
    assert.equal(await textOf(panel(page).locator('.editor-element-title')), 'Slur · bar 1', 'the slur is selected again')
    await page.waitForFunction(() => document.querySelectorAll('.score-view g.slur.mk-el').length === 1)
  })
})

test('edit: a tap on a bar line selects its bar and shows the bar-line controls with its start and end', async () => {
  await withApp({ seed: '' }, async (app) => {
    const { page } = app
    const id = await makeElementsPiece(page)
    await openEditor(page, id)
    // The bar line that closes bar 2.
    const line = await centre(page, '.score-view g.barLine', 1)
    await page.touchscreen.tap(line.x, line.y)
    await page.getByRole('heading', { name: 'Bar 2' }).waitFor()
    assert.equal(await tabs(page, 'Marks').isChecked(), true, 'the Marks tab is shown')
    assert.equal(await panel(page).count(), 0, 'a bar line has no element panel')
    const group = page.getByRole('region', { name: 'Bar lines' })
    assert.equal(await group.getByRole('combobox', { name: 'Starts with' }).isDisabled(), false)
    assert.equal(await group.getByRole('combobox', { name: 'Ends with' }).isDisabled(), false)
  })
})

test('edit: the element panel speaks Dutch', async () => {
  await withApp({ seed: '', language: 'nl' }, async (app) => {
    const { page } = app
    const id = await makeElementsPiece(page)
    await page.evaluate((pieceId) => window.__test!.shell.router.push({ name: 'editor', pieceId }), id)
    await page.locator('.score-view[data-rendered="true"]').waitFor()
    const at = await centre(page, '.score-view g.clef[id="clef-2"]')
    await page.touchscreen.tap(at.x, at.y)
    const dutch = panel(page, 'Gekozen onderdeel')
    await dutch.waitFor()
    assert.equal(await textOf(dutch.locator('.editor-element-title')), 'Sleutel · bas · maat 3')
    assert.equal(await dutch.getByRole('button', { name: 'Verwijderen' }).count(), 1)
  })
})
