import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import type { Page } from 'playwright'
import { dynamicOf } from '../../src/core/score/edit.ts'
import { parseMusicXml, serializeMusicXml } from '../../src/core/score/musicxml.ts'
import { isNote, isWedge } from '../../src/core/score/model.ts'
import type { Score } from '../../src/core/score/model.ts'
import { withApp } from './app.ts'
import type { App } from './app.ts'
import { noteIdsByBar, tab, textOf } from './journey.ts'
import { BUILD_DIR } from './paths.ts'
import { ID } from './pieces.ts'
import { barsScore, elementsScore } from './scores.ts'
import { MELODY_PIANO_FIXTURE, firstLine, note as noteXml, score as scoreXml } from '../helpers.ts'

// The edit journey (practice-app design D15, "edit: note, mark, preview, save & practice"; tasks 15.1 to
// 15.4; specs `score-editing`, `score-capture` "Add pages to a piece", `piece-library` "Rename"; change
// simplify-editor-and-name-new-pieces). The seeded piece is "Ode to Joy": three pages (bars 1-4, 5-8, 9-12), twelve
// bars of C5 D5 E5 F5 in 4/4 at 60 BPM. A copy of it is made through the library where a journey saves the piece.
//
// The journeys push the editor on the router, as the tools sheet of the practice screen does.
//
// The editor shows one bar at a time (change redesign-score-editor, group 6): the large bar is a score of its own (`BIG`),
// and the overview above it is the score island of the whole part, clipped to the line of the current bar, which becomes
// the full score on "Full score" (`OVERVIEW`). Both draw the notes with their ids, so a journey looks in one of them: notes
// are tapped in the large bar (`tapNote` goes to their bar first), and what the whole part holds is counted in the
// overview, which keeps every bar in its drawing.

const ODE = noteIdsByBar(barsScore(12, 60))

/** The large bar, and the overview (and full score). */
const BIG = '.editor-bar-host .score-view'
const OVERVIEW = '.editor-overview .score-view'

/** Opens the editor on a piece the way the tools sheet does, over what is on the stack. */
async function openEditor(page: Page, pieceId: string): Promise<void> {
  await page.evaluate((id) => window.__test!.shell.router.push({ name: 'editor', pieceId: id }), pieceId)
  await page.getByRole('heading', { name: 'Edit score', level: 1 }).waitFor()
  await page.locator(`${BIG}[data-rendered="true"]`).waitFor()
  await page.locator(`${OVERVIEW}[data-rendered="true"]`).waitFor()
}

/** "Bar 3 of 12": the bar the editor shows large, from the bar row. */
const barRow = (page: Page) => textOf(page.locator('.editor-bar-position'))

/** Waits until the editor shows bar `bar` large, drawn (the large bar says which bar it has drawn last). */
async function onBar(page: Page, bar: number): Promise<void> {
  await page.locator('.editor-bar-position').filter({ hasText: new RegExp(`^Bar ${bar} of `) }).waitFor()
  await page.locator(`.editor-bar-host[data-bar="${bar}"] .score-view[data-rendered="true"]`).waitFor()
}

/**
 * Whether the large bar and the overview are drawn for the size they have now: each is laid out again a moment after its
 * size changes (the large bar for its width and height, the overview for its width), and the frame itself may change after
 * an edit or a part switch (design D13).
 */
const drawnForSize = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.editor .score-view')].every((view) => {
      const fit = view.closest('.editor-bar-host') !== null
      const size = fit ? `${Math.floor(view.clientWidth)}x${Math.floor(view.clientHeight)}` : String(Math.floor(view.clientWidth))
      return view.dataset.size === size
    }),
  )

/** Waits until the large bar and the overview are drawn for the size they have now, and still are 200 ms later. */
async function laidOut(page: Page): Promise<void> {
  for (let i = 0, still = 0; i < 50; i++) {
    still = (await drawnForSize(page)) ? still + 1 : 0
    if (still >= 2) return
    await page.waitForTimeout(still > 0 ? 200 : 100)
  }
}

/**
 * A drawn thing's box once it stops moving: the score is drawn for its size (`laidOut`) at two looks 200 ms apart, and the
 * box is the same at both.
 */
async function settledBox(page: Page, locator: ReturnType<Page['locator']>): Promise<{ x: number; y: number; width: number; height: number }> {
  let last: Awaited<ReturnType<typeof locator.boundingBox>> = null
  for (let i = 0; i < 50; i++) {
    const drawnNow = await drawnForSize(page)
    const box = drawnNow ? await locator.boundingBox() : null
    if (box && last && Math.abs(box.x - last.x) < 0.5 && Math.abs(box.y - last.y) < 0.5 && Math.abs(box.width - last.width) < 0.5) return box
    last = box
    await page.waitForTimeout(box ? 200 : 100)
  }
  const box = await locator.boundingBox()
  assert.ok(box, 'drawn')
  return box
}

/** Waits until the overview (or full score) is laid out for the width it has now: it is laid out again a moment after the width changes. */
const overviewLaidOut = (page: Page) =>
  page.waitForFunction((css) => {
    const view = document.querySelector<HTMLElement>(css)
    return view !== null && view.dataset.size === String(Math.floor(view.clientWidth))
  }, OVERVIEW)

/** Opens "Full score", taps `target` in it (a drawn bar, or something drawn in one), and waits for the bar view of that bar. */
async function pickInFullScore(page: Page, target: string, bar: number): Promise<void> {
  if (!(await fullScoreShown(page))) await page.getByRole('button', { name: 'Full score' }).click()
  await page.locator('.editor[data-layout="full"]').waitFor()
  await overviewLaidOut(page)
  const there = page.locator(`${OVERVIEW} ${target}`).first()
  await there.scrollIntoViewIfNeeded()
  const box = await settledBox(page, there)
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
  await page.locator('.editor:not([data-layout="full"])').waitFor()
  await onBar(page, bar)
}

const fullScoreShown = (page: Page) => page.locator('.editor[data-layout="full"]').count().then((n) => n > 0)

/**
 * Makes bar `bar` (from 1) current: a bar or two away with the bar row's Previous bar and Next bar keys, as a user steps
 * through bars; farther through a tap in it in "Full score", as a user gets to another section. Both go to the bar the same
 * way (the session's `goToBar`); the journeys of "Full score" itself use `pickInFullScore`.
 */
async function goToBar(page: Page, bar: number): Promise<void> {
  const now = Number(/^Bar (\d+) of /.exec(await barRow(page))?.[1])
  if (now === bar) return
  if (!(await fullScoreShown(page)) && Math.abs(bar - now) <= 2) {
    const key = page.getByRole('button', { name: bar > now ? 'Next bar' : 'Previous bar' })
    for (let at = now; at !== bar; ) {
      at += bar > now ? 1 : -1
      await key.click()
      await onBar(page, at)
    }
    return
  }
  await pickInFullScore(page, `g.measure >> nth=${bar - 1}`, bar)
}

/** The bar (from 1) of a note, from the overview's drawing (every bar is a `g.measure`, in order). */
const barOfNote = (page: Page, id: string) =>
  page.evaluate(([css, noteId]) => {
    const measures = [...document.querySelectorAll(`${css} g.measure`)]
    return measures.findIndex((m) => m.querySelector(`g.note[id="${CSS.escape(noteId!)}"], g.rest[id="${CSS.escape(noteId!)}"]`) !== null) + 1
  }, [OVERVIEW, id] as const)

/** Taps the note `id` in the large bar, going to its bar first when it is not the current one. */
async function tapNote(page: Page, id: string): Promise<void> {
  await page.locator(`${BIG}[data-rendered="true"]`).waitFor()
  await page.locator(`${OVERVIEW}[data-rendered="true"]`).waitFor()
  const note = page.locator(`${BIG} g.note[id="${id}"], ${BIG} g.rest[id="${id}"]`)
  if ((await note.count()) === 0) {
    const bar = await barOfNote(page, id)
    assert.ok(bar > 0, `note ${id} is in the score`)
    await goToBar(page, bar)
    await note.waitFor()
  }
  const box = await settledBox(page, note)
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
}

/** Waits until the router shows this screen on top (the editor is replaced or popped when Save & practice has saved). */
const onScreen = (page: Page, name: string) => page.waitForFunction((n) => window.__test!.shell.router.screen.value.name === n, name)

const title = (page: Page) => page.getByRole('textbox', { name: 'Title' })
const save = (page: Page) => page.getByRole('button', { name: 'Save & practice' })
const tabs = (page: Page, name: 'Notes' | 'Marks' | 'Bars' | 'Score') => page.getByRole('radiogroup', { name: 'Editing tools' }).getByRole('radio', { name })
/**
 * The Bars tray (task 9.1): "Repeat from" (how the bar starts), the keys of how it ends (Normal, Double, Repeat, End) with
 * the ones that are on, and the passes of an end-repeat.
 */
function barTools(page: Page) {
  const tray = page.getByRole('region', { name: 'Bar tools' })
  const ends = tray.getByRole('group', { name: 'Ends with' })
  return {
    tray,
    start: tray.getByRole('group', { name: 'Starts with' }).getByRole('button', { name: 'Repeat from' }),
    end: (name: 'Normal' | 'Double' | 'Repeat' | 'End') => ends.getByRole('button', { name, exact: true }),
    endPressed: () => ends.getByRole('button', { pressed: true }).evaluateAll((keys) => keys.map((k) => k.querySelector('.editor-mark-name')?.textContent ?? '')),
    passes: tray.getByRole('group', { name: 'Played' }),
  }
}

/** The scissors of the Bars tools (task 9.2), by their names ("Bar line before E5 (3)"), in the order of the bar. */
const cuts = (page: Page) => page.getByRole('group', { name: 'Places for a bar line' }).getByRole('button')
const cutNames = (page: Page) => cuts(page).evaluateAll((keys) => keys.map((k) => k.getAttribute('aria-label') ?? ''))

/** "Bar 3 · Note 4": what the tools say is selected. */
const selection = (page: Page) => textOf(page.locator('.editor-selection'))
const pitch = (page: Page) => textOf(page.getByRole('group', { name: 'Pitch' }).getByRole('status'))
const warnings = (page: Page) => page.getByRole('group', { name: 'Things to check' })

/** The notes of the stored score of a piece, as the library keeps them now. */
async function stored(app: App, pieceId: string): Promise<Score> {
  const info = JSON.parse((await app.file(`pieces/${pieceId}/piece.json`)) ?? '{}') as { score: string }
  return parseMusicXml((await app.file(`pieces/${pieceId}/${info.score}`)) ?? '')
}
const noteOf = (score: Score, id: string) => firstLine(score).measures.flatMap((m) => m.items.filter(isNote)).find((n) => n.id === id)!

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

/** A copy of "Ode to Joy" made through the library: three pages of four bars. */
async function makeOdePiece(page: Page): Promise<string> {
  return page.evaluate(
    async ({ xml, bars }) => {
      const { platform, shell } = window.__test!
      platform.files.seed('scans/test/page.jpg', Uint8Array.of(0xff, 0xd8, 0xff, 0xe0))
      const info = await shell.library.create({
        name: 'Ode to Joy',
        musicxml: xml,
        bars,
        repairs: [],
        pages: [0, 1, 2].map((p) => ({ source: 'scans/test/page.jpg', recognised: xml, firstBar: p * 4 + 1, lastBar: p * 4 + 4 })),
      })
      return info.id
    },
    { xml: barsScore(12, 60), bars: 12 },
  )
}

test('edit: the frame shows the title, the photo line, the line of the current bar and the bar large, with no pills; a tap selects, and Preview plays the current bar', async () => {
  await withApp({ seed: 'library' }, async (app) => {
    const { page } = app
    await serveSamples(app)
    await openEditor(page, ID.ode)
    assert.equal(await title(page).inputValue(), 'Ode to Joy')
    assert.equal(await page.locator(`${OVERVIEW} svg g.note`).count(), 48, 'the overview holds the twelve bars')
    assert.deepEqual(await page.locator(`${BIG} svg g.note`).evaluateAll((notes) => notes.map((n) => n.id)), ODE[0], 'the large bar is bar 1')
    assert.equal(await barRow(page), 'Bar 1 of 12')
    assert.equal(await selection(page), 'Tap a note to edit it.')
    assert.equal(await page.getByRole('button', { name: /^Pages|Go to bar|Add pages/ }).count(), 0, 'no pills above the score')
    // The photo line of bar 1 above the overview (task 11.2): the seeded page has no positions for its lines, so it is the
    // whole page, which the seeded stand-in picture cannot show; it keeps its place and says the page.
    const photoLine = page.getByRole('button', { name: 'Photo of bar 1, page 1' })
    assert.equal(await textOf(photoLine), 'Page 1')
    assert.ok((await photoLine.boundingBox())!.y + 44 <= (await page.locator('.editor-overview').boundingBox())!.y, 'above the overview')
    assert.equal(await warnings(page).count(), 0, 'nothing to check: no warning and no mark')
    assert.equal(await page.locator('.editor .score-view g.note.mk-flag, .editor .score-view g.note.mk-flagbar').count(), 0)
    // There is always a current bar (design D1): Preview plays it, also with nothing selected.
    const toolbar = page.locator('.editor-toolbar')
    assert.deepEqual(await toolbar.getByRole('button').evaluateAll((buttons) => buttons.map((b) => b.getAttribute('aria-label'))), ['Preview bar 1', 'Undo', 'Redo'])

    // A tap on a note in bar 3 (gone to through the full score) selects it; Preview names its bar.
    await tapNote(page, ODE[2]![3]!)
    assert.equal(await selection(page), 'Bar 3 · Note 4')
    assert.equal(await page.locator(`${BIG} g.note.mk-sel`).count(), 1)
    await toolbar.getByRole('button', { name: 'Preview bar 3' }).waitFor()

    // Preview: the bar plays on its own, the button says Stop while it does, then it is a button to play again.
    await page.evaluate(() => {
      const w = window as unknown as { __starts: number }
      w.__starts = 0
      const start = AudioBufferSourceNode.prototype.start
      AudioBufferSourceNode.prototype.start = function (...args: Parameters<typeof start>) {
        w.__starts++
        return start.apply(this, args)
      }
    })
    await toolbar.getByRole('button', { name: 'Preview bar 3' }).click()
    await toolbar.getByRole('button', { name: 'Stop preview' }).waitFor()
    // The sound loads in real time, and the notes are scheduled on the test clock: let it run until they are.
    const starts = () => page.evaluate(() => (window as unknown as { __starts: number }).__starts)
    for (let i = 0; i < 60 && (await starts()) === 0; i++) {
      await page.clock.runFor(250)
      await page.waitForTimeout(100)
    }
    assert.ok((await starts()) >= 1, 'a note of the bar sounded')
    await page.clock.runFor(6000)
    await toolbar.getByRole('button', { name: 'Preview bar 3' }).waitFor()
    assert.equal(await starts(), 4, 'the four notes of bar 3, and no others')
    assert.deepEqual(await app.screen(), { name: 'editor', pieceId: ID.ode }, 'previewing leaves the editor open')
  })
})

test('edit: a new piece named before "Add pages" is not asked for its name again when the editor comes back', async () => {
  await withApp({ seed: '' }, async (app) => {
    const { page } = app
    const id = await makeDatedPiece(page)
    await openNew(page, id)
    await naming(page).tap()
    await page.keyboard.type('Ode to Joy')
    await tabs(page, 'Score').click()
    await page.locator('.editor-add-pages').getByRole('button', { name: 'Add pages' }).click()
    await page.getByRole('alertdialog', { name: 'Save your edits first?' }).getByRole('button', { name: 'Save and add pages' }).click()
    await onScreen(page, 'add-music')
    await app.back()
    await page.getByRole('heading', { name: 'Edit score', level: 1 }).waitFor()
    assert.equal(await title(page).inputValue(), 'Ode to Joy')
    assert.equal(await page.getByText('Name this piece').count(), 0, 'named: not asked again')
    assert.deepEqual(await app.stack(), [{ name: 'home' }, { name: 'editor', pieceId: id }])
  })
})

// ---- One bar at a time (change redesign-score-editor, tasks 6.1 and 6.6) -----------------------------------
// These replace the journeys of "One line while editing" (change simplify-editor-and-name-new-pieces), a requirement the
// change removes: the editor no longer starts on the whole sheet and shrinks it to a line on a tap.

/** The overview's line of music. */
const overview = (page: Page) => page.getByRole('group', { name: 'Line of music' })

/**
 * What the overview shows: the line its island is clipped to (`data-line`, from 0; null for the whole part), the bars (from
 * 1) whose drawing has its middle in view, the bar the tinted box is on, and how many staves each bar in view has.
 */
async function shownLine(page: Page): Promise<{ line: number | null; visibleBars: number[]; tinted: number | null; staves: number[] }> {
  assert.notEqual(await page.locator('.editor').getAttribute('data-layout'), 'numbers', 'the overview is a line of music, not bar numbers')
  return page.evaluate(() => {
    const island = document.querySelector<HTMLElement>('.editor-overview .score-island')!
    const line = island.dataset.line === undefined ? null : Number(island.dataset.line)
    const view = island.getBoundingClientRect()
    const measures = [...island.querySelectorAll('g.measure')]
    const inView = measures.flatMap((m, index) => {
      const r = m.getBoundingClientRect()
      const middle = r.top + r.height / 2
      return middle > view.top && middle < view.bottom ? [{ m, bar: index + 1, r }] : []
    })
    const box = island.querySelector<HTMLElement>('.score-bar')
    const b = box && !box.hidden ? box.getBoundingClientRect() : undefined
    const tinted = b ? (inView.find(({ r }) => r.left + r.width / 2 > b.left && r.left + r.width / 2 < b.right && r.top + r.height / 2 > b.top && r.top + r.height / 2 < b.bottom)?.bar ?? null) : null
    return { line, visibleBars: inView.map((v) => v.bar), tinted, staves: inView.map(({ m }) => m.querySelectorAll(':scope > g.staff').length) }
  })
}

/** Waits until the overview is clipped to a line other than `not` (or to any line). */
const lineShown = (page: Page, not?: number) =>
  page.waitForFunction((n) => {
    const shown = document.querySelector<HTMLElement>('.editor-overview .score-island')?.dataset.line
    return shown !== undefined && shown !== String(n)
  }, not ?? -1)

/** Waits until the overview shows the line that holds bar `bar` (from 1), with that bar tinted: it is laid out again a moment after its width changes. */
async function lineHolds(page: Page, bar: number): Promise<Awaited<ReturnType<typeof shownLine>>> {
  await overviewLaidOut(page)
  let shown = await shownLine(page)
  for (let i = 0; i < 40 && !(shown.line !== null && shown.visibleBars.includes(bar) && shown.tinted === bar); i++) {
    await page.waitForTimeout(100)
    shown = await shownLine(page)
  }
  assert.ok(shown.line !== null && shown.visibleBars.includes(bar) && shown.tinted === bar, `the overview shows the line of bar ${bar}, tinted (${JSON.stringify(shown)})`)
  return shown
}

/** Taps the middle of bar `bar` (from 1) in the overview's line. */
async function tapInOverview(page: Page, bar: number): Promise<void> {
  await overviewLaidOut(page)
  const box = await settledBox(page, page.locator(`${OVERVIEW} g.measure`).nth(bar - 1))
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
}

/** "Ode to Joy" with one note missing in bar 3 and in bar 12, so those two bars do not add up. */
async function makeFlaggedPiece(page: Page): Promise<string> {
  const xml = barsScore(12, 60).replace(/(<measure number="(?:3|12)">)<note>.*?<\/note>/g, '$1')
  return page.evaluate(
    async ({ xml }) => {
      const { platform, shell } = window.__test!
      platform.files.seed('scans/test/page.jpg', Uint8Array.of(0xff, 0xd8, 0xff, 0xe0))
      const info = await shell.library.create({ name: 'Two short bars', musicxml: xml, bars: 12, repairs: [], pages: [{ source: 'scans/test/page.jpg', recognised: xml, firstBar: 1, lastBar: 12 }] })
      return info.id
    },
    { xml },
  )
}

test('edit: one bar at a time; it opens on the bar of the first flag, else on bar 1 of 12, with its line as the overview and the bar highlighted; a piano bar shows both hands', async () => {
  await withApp({ seed: 'library' }, async (app) => {
    const { page } = app
    // A flag in bar 3: bar 3 is current, shown large, and the overview is its line with bar 3 tinted.
    const flagged = await makeFlaggedPiece(page)
    await openEditor(page, flagged)
    await lineHolds(page, 3)
    assert.equal(await barRow(page), 'Bar 3 of 12')
    const ids = noteIdsByBar(barsScore(12, 60).replace(/(<measure number="(?:3|12)">)<note>.*?<\/note>/g, '$1'))
    assert.deepEqual(await page.locator(`${BIG} svg g.note`).evaluateAll((notes) => notes.map((n) => n.id)), ids[2], 'bar 3 is the large bar')
    let shown = await shownLine(page)
    assert.ok(shown.visibleBars.includes(3) && shown.visibleBars.length < 12, `the overview is the line of bar 3 (${shown.visibleBars.join(', ')})`)
    assert.equal(shown.tinted, 3, 'bar 3 is highlighted in it')
    assert.equal(await textOf(page.locator('.editor-beats')), '3 of 4 beats', 'the beats chip says what the bar adds up to')
    assert.match(await textOf(warnings(page)), /^2 to check · Next$/)
    assert.ok((await page.locator(`${OVERVIEW} g.note.mk-flagbar`).count()) >= 3, 'the flags are in the overview')
    assert.equal(await page.locator(`${BIG} g.note.mk-flagbar`).count(), 3, 'and on the large bar')
    // A bar that does not add up shows its suggested repairs in the row of what the editor says (design D6, D13).
    assert.match(await textOf(page.locator('.editor-fix')), /^Did you mean Add a quarter rest at the end /)
    await page.getByRole('button', { name: 'Back', exact: true }).click()

    // Nothing to check: bar 1 of 12, and a bar that adds up says so in green.
    await openEditor(page, ID.ode)
    assert.equal(await barRow(page), 'Bar 1 of 12')
    assert.equal(await page.locator('.editor-beats--ok').count(), 1)
    shown = await lineHolds(page, 1)
    assert.deepEqual([shown.line, shown.tinted, shown.visibleBars[0]], [0, 1, 1])
    // The overview ends a few pixels under the first line, so nothing of the second line shows at its foot (Verovio's empty
    // markers above the first line, and its tempo marking, which reaches above the drawing, once made it taller).
    const edges = await page.evaluate(() => {
      const island = document.querySelector<HTMLElement>('.editor-overview .score-island')!
      const window = island.getBoundingClientRect()
      const [first, second] = [...island.querySelectorAll('g.system')].map((line) => [...line.querySelectorAll(':scope > g.measure')].map((bar) => bar.getBoundingClientRect()))
      return { top: window.top, bottom: window.bottom, firstTop: Math.min(...first!.map((b) => b.top)), firstBottom: Math.max(...first!.map((b) => b.bottom)), secondTop: Math.min(...second!.map((b) => b.top)) }
    })
    assert.ok(edges.firstBottom <= edges.bottom && edges.bottom - edges.firstBottom <= 6, `a few pixels under the first line (${JSON.stringify(edges)})`)
    assert.ok(edges.secondTop >= edges.bottom, `and nothing of the second line (${JSON.stringify(edges)})`)
  })

  // A piano bar: the overview and the large bar both have the right hand and the left hand (a piece of the piano alone:
  // with a part switch above it, a piano line leaves the large bar too little room at 360 x 780, see the next journey).
  await withApp({ seed: '' }, async (app) => {
    const { page } = app
    await openEditor(page, await makePiano(page))
    await page.locator(`${BIG} g.note[id="lc1"]`).waitFor()
    assert.equal(await page.locator('.editor').getAttribute('data-layout'), 'line')
    const bar = Number((await barRow(page)).split(' ')[1])
    assert.ok((await lineHolds(page, bar)).staves.every((n) => n === 2), 'every bar of the overview has two staves')
    assert.equal(await page.locator(`${BIG} g.measure > g.staff`).count(), 2, 'the large bar has two staves')
    assert.ok((await page.locator('.editor-surface').boundingBox())!.height >= 170, 'the large bar keeps its 170 px')
  })
})

test('edit: when the large bar would get less than 170 px, the overview is the line\'s bar numbers with the flags; they and the line arrows go to another bar (design D13)', async () => {
  await withApp({ seed: '' }, async (app) => {
    const { page } = app
    await openEditor(page, await makeDuet(page))
    await partSwitch(page).getByRole('radio', { name: 'Piano' }).click()
    await page.locator(`${BIG} g.note[id="lc1"]`).waitFor()
    // A part switch and a piano line: the overview gives way first.
    await page.locator('.editor[data-layout="numbers"]').waitFor()
    assert.ok((await page.locator('.editor-surface').boundingBox())!.height >= 170, 'the large bar keeps its 170 px')
    const numbers = overview(page).locator('.editor-overview-numbers').getByRole('button')
    const shown = await numbers.evaluateAll((buttons) => buttons.map((b) => Number(b.textContent)))
    assert.ok(shown.length >= 2 && shown[0] === 1, `the numbers of the first line (${shown.join(', ')})`)
    assert.equal(await overview(page).getByRole('button', { name: 'Bar 1', exact: true }).getAttribute('aria-current'), 'true')

    // A tap on a number makes that bar current; a bar to check says so in its name.
    await numbers.nth(1).click()
    await onBar(page, shown[1]!)
    await tapNote(page, 'lc1')
    await page.getByRole('button', { name: '+ After' }).click()
    await overview(page).getByRole('button', { name: 'Bar 1, to check' }).waitFor()

    // The arrows step from line to line.
    await overview(page).getByRole('button', { name: 'Next line' }).click()
    await onBar(page, shown.at(-1)! + 1)
    await overview(page).getByRole('button', { name: `Bar ${shown.at(-1)! + 1}`, exact: true }).waitFor()
    await overview(page).getByRole('button', { name: 'Previous line' }).click()
    await onBar(page, 1)
  })
})

test('edit: go to another bar; next, a tap in the overview, across to the next line, a line ahead, and a warning on another line', async () => {
  await withApp({ seed: 'library' }, async (app) => {
    const { page } = app
    await openEditor(page, ID.ode)
    await lineHolds(page, 1)
    const lines = await page.evaluate(() => document.querySelectorAll('.editor-overview g.system').length)
    assert.ok(lines >= 3, `twelve bars take several lines of the overview at 360px (${lines})`)

    // Next: bar 3 of 12 becomes bar 4 of 12.
    await goToBar(page, 3)
    await page.getByRole('button', { name: 'Next bar' }).click()
    await onBar(page, 4)
    assert.equal(await barRow(page), 'Bar 4 of 12')
    assert.deepEqual(await page.locator(`${BIG} svg g.note`).evaluateAll((notes) => notes.map((n) => n.id)), ODE[3])

    // A tap on another bar of the overview's line makes it current (and selects nothing).
    let shown = await lineHolds(page, 4)
    const other = shown.visibleBars.find((b) => b !== 4)!
    await tapInOverview(page, other)
    await onBar(page, other)
    assert.equal(await selection(page), 'Tap a note to edit it.')
    await lineHolds(page, other)

    // Across to the next line: from the last bar of a line, Next shows the bar after it and the line that holds it.
    const last = shown.visibleBars.at(-1)!
    if (last !== other) {
      await tapInOverview(page, last)
      await onBar(page, last)
    }
    const line = (await lineHolds(page, last)).line!
    await page.getByRole('button', { name: 'Next bar' }).click()
    await onBar(page, last + 1)
    shown = await lineHolds(page, last + 1)
    assert.deepEqual([shown.line, shown.visibleBars[0]], [line + 1, last + 1], 'the next line, starting with that bar')

    // A line ahead: the arrow shows the next line, and its first bar is current.
    await overview(page).getByRole('button', { name: 'Next line' }).click()
    await lineShown(page, line + 1)
    shown = await shownLine(page)
    assert.equal(shown.line, line + 2)
    await onBar(page, shown.visibleBars[0]!)
    await lineHolds(page, shown.visibleBars[0]!)
    await overview(page).getByRole('button', { name: 'Previous line' }).click()
    await onBar(page, last + 1)
    assert.equal((await lineHolds(page, last + 1)).line, line + 1)
    await goToBar(page, 1)
    assert.equal(await overview(page).getByRole('button', { name: 'Previous line' }).isDisabled(), true, 'the first line has no line before it')
  })

  // A warning on another line: from bar 5, stepping to the warning about bar 12 shows bar 12 and its line.
  await withApp({ seed: 'library' }, async (app) => {
    const { page } = app
    await openEditor(page, await makeFlaggedPiece(page))
    await goToBar(page, 5)
    const line = (await lineHolds(page, 5)).line!
    await warnings(page).getByRole('button', { name: 'Next' }).click()
    await onBar(page, 12)
    assert.notEqual((await lineHolds(page, 12)).line, line, 'another line')
    assert.match(await textOf(page.locator('.editor-fix')), /^Did you mean Add a quarter rest at the end /, 'the suggested repairs of bar 12')
  })
})

test('edit: a slur is picked from the last note of a line to a note of the next, with the line arrow between the two taps', async () => {
  await withApp({ seed: 'library' }, async (app) => {
    const { page } = app
    await openEditor(page, ID.ode)
    const lastBar = (await lineHolds(page, 1)).visibleBars.at(-1)!

    await tabs(page, 'Marks').click()
    await page.getByRole('button', { name: 'Slur', exact: true }).click()
    await tapNote(page, ODE[lastBar - 1]![3]!)
    const waiting = page.locator('.editor-waiting').filter({ hasText: `Slur from bar ${lastBar} · tap the last note` })
    await waiting.waitFor()
    await overview(page).getByRole('button', { name: 'Next line' }).click()
    await onBar(page, lastBar + 1)
    await waiting.waitFor() // the arrow keeps the pick
    await tapNote(page, ODE[lastBar]![1]!)
    await drawn(page, `${OVERVIEW} g.slur`, 2) // drawn in two pieces, one on each line
    await save(page).click()
    await onScreen(page, 'practice')
    const score = await stored(app, ID.ode)
    assert.deepEqual(noteOf(score, ODE[lastBar - 1]![3]!).slurs, [{ type: 'start', number: 1 }])
    assert.deepEqual(noteOf(score, ODE[lastBar]![1]!).slurs, [{ type: 'stop', number: 1 }])
  })
})

// ---- Full score (change redesign-score-editor, task 6.6) -------------------------------------------------

/** "Ode to Joy" over 48 bars: more than a screen of full score. */
async function makeLongPiece(page: Page): Promise<string> {
  return page.evaluate(
    async ({ xml }) => {
      const { platform, shell } = window.__test!
      platform.files.seed('scans/test/page.jpg', Uint8Array.of(0xff, 0xd8, 0xff, 0xe0))
      const info = await shell.library.create({ name: 'Long ode', musicxml: xml, bars: 48, repairs: [], pages: [{ source: 'scans/test/page.jpg', recognised: xml, firstBar: 1, lastBar: 48 }] })
      return info.id
    },
    { xml: barsScore(48, 60) },
  )
}

test('edit: Full score shows the whole part, scrolled to the current bar; a tap in bar 41 goes there, Back and the back button keep the bar and the selection', async () => {
  await withApp({ seed: '' }, async (app) => {
    const { page } = app
    const id = await makeLongPiece(page)
    const ids = noteIdsByBar(barsScore(48, 60))
    await openEditor(page, id)
    await goToBar(page, 3)
    await tapNote(page, ids[2]![1]!)
    assert.equal(await selection(page), 'Bar 3 · Note 2')

    // Go to another section: the whole part, in place of the bar view and the tools; bar 3 is tinted and in view.
    await page.getByRole('button', { name: 'Full score' }).click()
    await page.locator('.editor[data-layout="full"]').waitFor()
    assert.equal(await page.getByRole('button', { name: 'Full score' }).getAttribute('aria-pressed'), 'true')
    assert.equal(await page.locator('.editor-surface, .editor-tools, .editor-barrow').count(), 0, 'no large bar, bar row or tools')
    await page.getByRole('button', { name: 'Back to bar 3' }).waitFor()
    await page.getByText('Tap a bar to go there.').waitFor()
    const island = page.locator('.editor-overview .score-island')
    await overviewLaidOut(page)
    const shown = await shownLine(page)
    assert.equal(shown.line, null, 'not clipped to a line')
    assert.ok(shown.visibleBars.includes(3) && shown.tinted === 3, `bar 3 is in view and highlighted (${JSON.stringify(shown)})`)
    assert.ok(await island.evaluate((e) => e.scrollHeight > e.clientHeight + 100), 'a piece long enough to scroll')
    assert.equal(await page.locator(`${OVERVIEW} g.measure`).count(), 48)
    await pickInFullScore(page, 'g.measure >> nth=40', 41)
    assert.equal(await barRow(page), 'Bar 41 of 48')
    assert.deepEqual(await page.locator(`${BIG} svg g.note`).evaluateAll((notes) => notes.map((n) => n.id)), ids[40])
    await lineHolds(page, 41)
    assert.equal(await selection(page), 'Tap a note to edit it.', 'a bar is picked, not a note')

    // Look and go back: from bar 41 the full score opens scrolled to it; Back to bar 41 keeps the bar; so does the system
    // back button, which does not leave the editor.
    await tapNote(page, ids[40]![2]!)
    await page.getByRole('button', { name: 'Full score' }).click()
    await page.locator('.editor[data-layout="full"]').waitFor()
    await overviewLaidOut(page)
    const far = await shownLine(page)
    assert.ok(far.visibleBars.includes(41) && far.tinted === 41 && !far.visibleBars.includes(1), `scrolled to bar 41 (${far.visibleBars.join(', ')})`)
    assert.ok(await island.evaluate((e) => e.scrollTop > 0), 'scrolled')
    await page.getByRole('button', { name: 'Back to bar 41' }).click()
    await onBar(page, 41)
    assert.equal(await selection(page), 'Bar 41 · Note 3', 'the selection stays')
    await page.getByRole('button', { name: 'Full score' }).click()
    await page.locator('.editor[data-layout="full"]').waitFor()
    assert.equal(await app.back(), true)
    await page.locator('.editor:not([data-layout="full"])').waitFor()
    await onBar(page, 41)
    assert.deepEqual(await app.screen(), { name: 'editor', pieceId: id }, 'the back button closed the full score, not the editor')
    assert.equal(await selection(page), 'Bar 41 · Note 3')
    // The "Full score" key closes it too.
    await page.getByRole('button', { name: 'Full score' }).click()
    await page.getByRole('button', { name: 'Full score' }).click()
    await onBar(page, 41)
  })
})

test('edit: Full score of a piano part shows the whole part with both staves, and the bars to check are marked', async () => {
  await withApp({ seed: '' }, async (app) => {
    const { page } = app
    const id = await makeDuet(page)
    await openEditor(page, id)
    await partSwitch(page).getByRole('radio', { name: 'Piano' }).click()
    await page.locator(`${BIG} g.note[id="lc1"]`).waitFor()
    // A bar to check: a note more in bar 1's left hand.
    await tapNote(page, 'lc1')
    await page.getByRole('button', { name: '+ After' }).click()
    await warnings(page).waitFor()
    await page.getByRole('button', { name: 'Full score' }).click()
    await page.locator('.editor[data-layout="full"]').waitFor()
    const measures = page.locator(`${OVERVIEW} g.measure`)
    const count = await measures.count()
    assert.equal(count, DUET_SCORE.bars.length, 'every bar of the part')
    assert.deepEqual(new Set(await measures.evaluateAll((all) => all.map((m) => m.querySelectorAll(':scope > g.staff').length))), new Set([2]), 'each with both staves')
    assert.ok((await page.locator(`${OVERVIEW} g.note.mk-flagbar`).count()) >= 1, 'the bar to check is marked')
    assert.equal(await partSwitch(page).count(), 0, 'the part switch is not in the full score')
  })
})

// ---- Naming a new piece (change simplify-editor-and-name-new-pieces, task 3.4) -------------------------------

/** A piece as adding music leaves it: "Ode to Joy"'s music under the date name it was given. */
async function makeDatedPiece(page: Page): Promise<string> {
  return page.evaluate(
    async ({ xml }) => {
      const { platform, shell } = window.__test!
      platform.files.seed('scans/test/page.jpg', Uint8Array.of(0xff, 0xd8, 0xff, 0xe0))
      const info = await shell.library.create({
        name: '19 Nov, 14:05',
        musicxml: xml,
        bars: 12,
        repairs: [],
        pages: [{ source: 'scans/test/page.jpg', recognised: xml, firstBar: 1, lastBar: 12 }],
      })
      return info.id
    },
    { xml: barsScore(12, 60) },
  )
}

/** Opens the editor as adding music does for a new piece. */
async function openNew(page: Page, pieceId: string): Promise<void> {
  await page.evaluate((id) => window.__test!.shell.router.push({ name: 'editor', pieceId: id, isNew: true }), pieceId)
  await page.getByRole('heading', { name: 'Edit score', level: 1 }).waitFor()
  await page.locator(`${BIG}[data-rendered="true"]`).waitFor()
  await page.locator(`${OVERVIEW}[data-rendered="true"]`).waitFor()
}

const naming = (page: Page) => page.getByRole('textbox', { name: 'Name this piece' })
const titleFocused = (page: Page) => page.evaluate(() => document.activeElement?.classList.contains('editor-title-input') ?? false)

test('edit: a new piece asks for its name; a tap on the title and typing replaces the date name, and Save & practice stores it', async () => {
  await withApp({ seed: '' }, async (app) => {
    const { page } = app
    const id = await makeDatedPiece(page)
    await openNew(page, id)
    assert.equal(await naming(page).inputValue(), '19 Nov, 14:05')
    assert.equal(await page.locator('.editor-title-field--naming').count(), 1, 'the title is highlighted')
    assert.equal(await titleFocused(page), false, 'nothing opens the keyboard by itself')

    await naming(page).tap()
    assert.equal(await titleFocused(page), true)
    await page.keyboard.type('Ode to Joy')
    assert.equal(await title(page).inputValue(), 'Ode to Joy', 'the typing replaced the date name')
    assert.equal(await page.locator('.editor-title-field--naming').count(), 0, 'named: no highlight')
    await save(page).click()
    await onScreen(page, 'practice')
    assert.equal(JSON.parse((await app.file(`pieces/${id}/piece.json`)) ?? '{}').name, 'Ode to Joy')
  })
})

test('edit: a new piece whose notes are fixed first keeps the highlight; an editor opened from practice does not ask', async () => {
  await withApp({ seed: '' }, async (app) => {
    const { page } = app
    const id = await makeDatedPiece(page)
    await openNew(page, id)
    await tapNote(page, ODE[2]![1]!)
    assert.equal(await selection(page), 'Bar 3 · Note 2', 'the note is selected')
    assert.equal(await titleFocused(page), false, 'no keyboard')
    assert.equal(await naming(page).count(), 1, 'the caption stays')
    assert.equal(await page.locator('.editor-title-field--naming').count(), 1, 'and so does the highlight')
    await page.getByRole('button', { name: 'Pitch down' }).click()
    await save(page).click()
    await onScreen(page, 'practice')
    assert.equal(JSON.parse((await app.file(`pieces/${id}/piece.json`)) ?? '{}').name, '19 Nov, 14:05', 'an untouched date name saves as it is')

    // From practice, the editor does not ask again.
    await page.evaluate((pieceId) => window.__test!.shell.router.push({ name: 'editor', pieceId }), id)
    await page.getByRole('heading', { name: 'Edit score', level: 1 }).waitFor()
    assert.equal(await naming(page).count(), 0)
    assert.equal(await page.getByText('Name this piece').count(), 0)
    assert.equal(await title(page).inputValue(), '19 Nov, 14:05')
    await title(page).tap()
    await page.keyboard.type('x')
    assert.equal(await title(page).inputValue(), '19 Nov, 14:05x', 'no select-all: the caret goes where the tap was')
  })
})

test('edit: the Notes tray steps a pitch down and Save & practice stores the corrected score; the original reading stays as it was', async () => {
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

    // The accidental, the length, a dot, and a note after it; each is one edit of the selected note. The accidentals and
    // the lengths are keys of the Notes tray (change redesign-score-editor, spec "Notes tools"); a tap on the accidental
    // the note has takes it off.
    await page.getByRole('button', { name: 'Sharp' }).click()
    assert.equal(await pitch(page), 'E♯5')
    assert.equal(await page.getByRole('button', { name: 'Sharp' }).getAttribute('aria-pressed'), 'true')
    await page.getByRole('button', { name: 'Sharp' }).click()
    assert.equal(await pitch(page), 'E5')
    await page.getByRole('button', { name: 'Half', exact: true }).click()
    assert.equal(await page.getByRole('group', { name: 'Things to check' }).count(), 1, 'a half note in a full bar: the bar no longer adds up')
    assert.match(await textOf(warnings(page)), /1 to check/)
    await page.getByRole('button', { name: 'Dotted' }).click()
    assert.equal(await page.getByRole('button', { name: 'Dotted' }).getAttribute('aria-pressed'), 'true')
    await page.getByRole('button', { name: 'Dotted' }).click()
    await page.getByRole('button', { name: 'Quarter', exact: true }).click()
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

test('edit: the Notes tray makes a rest, inserts notes and rests, makes a triplet and deletes; a rest has no pitch to step', async () => {
  await withApp({ seed: 'library' }, async (app) => {
    const { page } = app
    await openEditor(page, ID.ode)
    const notes = `${OVERVIEW} svg g.note, ${OVERVIEW} svg g.rest`
    await drawn(page, notes, 48)
    const rest = page.getByRole('button', { name: 'Rest', exact: true })

    // Note or rest is one key of the Notes tray, on when the selection is a rest (spec "Notes tools").
    await tapNote(page, ODE[0]![1]!)
    assert.equal(await rest.getAttribute('aria-pressed'), 'false')
    await rest.click()
    assert.equal(await selection(page), 'Bar 1 · Rest 2')
    assert.equal(await pitch(page), 'Rest')
    assert.equal(await rest.getAttribute('aria-pressed'), 'true')
    assert.equal(await page.getByRole('button', { name: 'Pitch up' }).isDisabled(), true)
    for (const name of ['Flat', 'Sharp', 'Natural']) assert.equal(await page.getByRole('button', { name }).isDisabled(), true, `${name} is off for a rest`)
    await rest.click()
    assert.equal(await selection(page), 'Bar 1 · Note 2')

    // "+ After" adds one of the selected note's kind (spec "Notes tools": insert before and after); Rest makes it a rest.
    await page.getByRole('button', { name: '+ After' }).click()
    assert.equal(await selection(page), 'Bar 1 · Note 3', 'the new note is selected')
    await rest.click()
    assert.equal(await selection(page), 'Bar 1 · Rest 3', 'and it is a rest now')
    await drawn(page, notes, 49)
    assert.match(await textOf(warnings(page)), /1 to check/, 'bar 1 has five beats now')
    await page.getByRole('button', { name: 'Delete note' }).click()
    await drawn(page, notes, 48)
    assert.equal(await warnings(page).count(), 0)
    await page.getByRole('button', { name: '+ Before' }).click()
    await drawn(page, notes, 49)
    await page.getByRole('button', { name: 'Undo' }).click()
    await drawn(page, notes, 48)

    // A triplet: the selected quarter becomes a quarter triplet, named so, and back (in bar 2: a short bar 1 is a pickup).
    await tapNote(page, ODE[1]![0]!)
    const length = () => textOf(page.getByRole('group', { name: 'Length' }).getByRole('status'))
    assert.equal(await length(), 'quarter')
    await page.getByRole('button', { name: 'Triplet' }).click()
    assert.equal(await page.getByRole('button', { name: 'Triplet' }).getAttribute('aria-pressed'), 'true')
    assert.equal(await length(), 'quarter triplet')
    assert.match(await textOf(warnings(page)), /1 to check/, 'a third of a beat short')
    assert.notEqual(await textOf(page.locator('.editor-beats')), '4 of 4 beats')
    await page.getByRole('button', { name: 'Triplet' }).click()
    assert.equal(await length(), 'quarter')
    assert.equal(await warnings(page).count(), 0)
  })
})

// ---- The Notes surface (change redesign-score-editor, task 6.2) --------------------------------------------

/**
 * A finger on the screen: touches sent as the touch screen sends them (CDP touch events), so the browser makes the
 * pointer events of a touch and keeps to `touch-action`, as on a phone.
 */
async function finger(page: Page) {
  const cdp = await page.context().newCDPSession(page)
  const send = (type: 'touchStart' | 'touchMove' | 'touchEnd', points: { x: number; y: number }[]) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points })
  return {
    down: (x: number, y: number) => send('touchStart', [{ x, y }]),
    move: (x: number, y: number) => send('touchMove', [{ x, y }]),
    up: () => send('touchEnd', []),
  }
}

/** The heights of the five lines of the large bar's first staff, top to bottom, once the bar is still. */
async function staffLines(page: Page): Promise<number[]> {
  await laidOut(page)
  return page.evaluate((css) => {
    const staff = document.querySelector(`${css} g.measure > g.staff`)!
    return [...staff.querySelectorAll(':scope > path')].map((p) => {
      const r = p.getBoundingClientRect()
      return r.top + r.height / 2
    }).sort((a, b) => a - b)
  }, BIG)
}

/** The centre of a note's head in the large bar, once it is still. */
async function headOf(page: Page, id: string): Promise<{ x: number; y: number }> {
  const box = await settledBox(page, page.locator(`${BIG} g.note[id="${id}"] g.notehead`))
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

/** "C5 quarter", "rest eighth": the notes and rests of a bar (from 1) of a stored score. */
const storedBar = (score: Score, bar: number): string[] =>
  firstLine(score).measures[bar - 1]!.items.filter(isNote).filter((n) => !n.hidden).map((n) => `${n.rest ? 'rest' : `${n.pitch!.step}${n.pitch!.octave}`} ${n.type ?? (n.measureRest ? 'bar' : '?')}${n.dots ? '.' : ''}`)

test('edit: Notes: a bar is emptied and filled again through the slot, a note goes between two notes, a note is dragged one step down and made shorter; the stored score has it all', async () => {
  await withApp({ seed: 'library' }, async (app) => {
    const { page } = app
    await serveSamples(app)
    const id = await makeOdePiece(page)
    await openEditor(page, id)
    const touch = await finger(page)
    const slot = page.locator('.editor-slot')
    assert.equal(await slot.count(), 0, 'a full bar has no slot')

    // Empty bar 2 (spec "Empty a bar and fill it again"): every note deleted leaves a whole-bar rest, and the slot.
    await page.getByRole('button', { name: 'Next bar' }).click()
    await onBar(page, 2)
    for (const note of ODE[1]!) {
      await tapNote(page, note)
      await page.getByRole('button', { name: 'Delete note' }).click()
    }
    await drawn(page, `${BIG} g.note`, 0)
    await slot.waitFor()
    assert.equal(await page.locator(`${BIG} g.mRest, ${BIG} g.rest`).count(), 1, 'a whole-bar rest')
    // A tap on nothing puts the rest away: the Notes tools set what a tap adds again.
    await page.touchscreen.tap(...(await emptySpot(page)))
    await page.waitForFunction(() => document.querySelector('.editor-selection')?.textContent === 'Tap a note to edit it.')
    assert.equal(await page.getByRole('button', { name: 'Quarter', exact: true }).getAttribute('aria-pressed'), 'true', 'a quarter note is what a tap adds')

    // The slot, on the second line (G4): one quarter note, and the slot after it (spec "Add the next note").
    let lines = await staffLines(page)
    let box = await settledBox(page, slot.locator('rect'))
    await page.touchscreen.tap(box.x + box.width / 2, lines[3]!)
    await drawn(page, `${BIG} g.note`, 1)
    assert.equal(await selection(page), 'Bar 2 · Note 1', 'the new note is selected')
    assert.equal(await pitch(page), 'G4')
    assert.equal(await textOf(page.locator('.editor-beats')), '1 of 4 beats')
    const first = (await page.locator(`${BIG} g.note`).first().boundingBox())!
    box = await settledBox(page, slot.locator('rect'))
    assert.ok(box.x > first.x + first.width - 1, 'the slot is after the new note')
    await page.touchscreen.tap(box.x + box.width / 2, lines[3]!)
    await drawn(page, `${BIG} g.note`, 2)
    assert.equal(await selection(page), 'Bar 2 · Note 2')
    // With nothing selected, Eighth and Rest set what a tap adds (spec "Choose what a tap adds").
    await page.touchscreen.tap(...(await emptySpot(page)))
    await page.waitForFunction(() => document.querySelector('.editor-selection')?.textContent === 'Tap a note to edit it.')
    await page.getByRole('button', { name: 'Eighth', exact: true }).click()
    await page.getByRole('button', { name: 'Rest', exact: true }).click()
    box = await settledBox(page, slot.locator('rect'))
    await page.touchscreen.tap(box.x + box.width / 2, lines[2]!)
    await page.waitForFunction(() => document.querySelector('.editor-selection')?.textContent === 'Bar 2 · Rest 3')
    assert.equal(await textOf(page.locator('.editor-beats')), '2½ of 4 beats')
    await page.touchscreen.tap(...(await emptySpot(page)))
    await page.getByRole('button', { name: 'Quarter', exact: true }).click()
    await page.getByRole('button', { name: 'Rest', exact: true }).click()
    assert.equal(await page.getByRole('button', { name: 'Rest', exact: true }).getAttribute('aria-pressed'), 'false')

    // Between C5 and D5 of bar 3, on the middle line (spec "Add a note between two notes"): B4 goes between them, selected.
    await page.getByRole('button', { name: 'Next bar' }).click()
    await onBar(page, 3)
    lines = await staffLines(page)
    const c5 = await headOf(page, ODE[2]![0]!)
    const d5 = await headOf(page, ODE[2]![1]!)
    await page.touchscreen.tap((c5.x + d5.x) / 2, lines[2]!)
    await drawn(page, `${BIG} g.note`, 5)
    assert.equal(await selection(page), 'Bar 3 · Note 2')
    assert.equal(await pitch(page), 'B4')

    // Drag F5 of bar 4 one staff step down (spec "Drag a note down"): the ghost says E5, and a note sounds on the step.
    await page.getByRole('button', { name: 'Next bar' }).click()
    await onBar(page, 4)
    const f5 = ODE[3]![3]!
    lines = await staffLines(page)
    const step = (lines[4]! - lines[0]!) / 8
    const head = await headOf(page, f5)
    await page.evaluate(() => {
      const w = window as unknown as { __starts: number }
      w.__starts = 0
      const start = AudioBufferSourceNode.prototype.start
      AudioBufferSourceNode.prototype.start = function (...args: Parameters<typeof start>) {
        w.__starts++
        return start.apply(this, args)
      }
    })
    await touch.down(head.x, head.y)
    await touch.move(head.x, head.y + 9) // past the 8 px that decide a drag: from here it counts
    await touch.move(head.x, head.y + 9 + step + 1)
    await page.locator('.editor-drag-name').filter({ hasText: /^E5$/ }).waitFor()
    assert.equal(await page.locator('.editor-ghost ellipse').count(), 1, 'the ghost notehead')
    assert.equal(await page.locator(`${BIG} g.note.is-dragged[id="${f5}"]`).count(), 1, 'the note itself is faded')
    const starts = () => page.evaluate(() => (window as unknown as { __starts: number }).__starts)
    for (let i = 0; i < 60 && (await starts()) === 0; i++) {
      await page.clock.runFor(250)
      await page.waitForTimeout(100)
    }
    assert.ok((await starts()) >= 1, 'the note sounded')
    await touch.up()
    await page.locator('.editor-drag-name').waitFor({ state: 'detached' })
    assert.equal(await pitch(page), 'E5')
    assert.equal(await selection(page), 'Bar 4 · Note 4', 'the dragged note is selected')
    await page.getByRole('button', { name: 'Undo' }).click()
    assert.equal(await pitch(page), 'F5', 'one undo')
    await page.getByRole('button', { name: 'Redo' }).click()
    assert.equal(await pitch(page), 'E5')

    // Shorter (spec "Shorter"): a quarter note of bar 4 is an eighth, and the bar half a beat less.
    assert.equal(await textOf(page.locator('.editor-beats')), '4 of 4 beats')
    await page.getByRole('button', { name: 'Shorter' }).click()
    assert.equal(await textOf(page.getByRole('group', { name: 'Length' }).getByRole('status')), 'eighth')
    assert.equal(await textOf(page.locator('.editor-beats')), '3½ of 4 beats')

    await save(page).click()
    await onScreen(page, 'practice')
    const score = await stored(app, id)
    assert.deepEqual(storedBar(score, 2), ['G4 quarter', 'G4 quarter', 'rest eighth'])
    assert.deepEqual(storedBar(score, 3), ['C5 quarter', 'B4 quarter', 'D5 quarter', 'E5 quarter', 'F5 quarter'])
    assert.deepEqual(storedBar(score, 4), ['C5 quarter', 'D5 quarter', 'E5 quarter', 'E5 eighth'])
    assert.deepEqual(storedBar(score, 5), ['C5 quarter', 'D5 quarter', 'E5 quarter', 'F5 quarter'], 'the bars around are as they were')
  })
})

test('edit: Notes: a new note follows the finger to its pitch before it lifts, as one undo step; the Marks tools add no note; a piano bar takes a note in the hand tapped', async () => {
  await withApp({ seed: '' }, async (app) => {
    const { page } = app
    const ode = await makeOdePiece(page)
    await openEditor(page, ode)
    const touch = await finger(page)
    // Bar 1 emptied: a touch in the slot on the second line, dragged up two steps before it lifts, is B4 (design D2).
    for (const note of ODE[0]!) {
      await tapNote(page, note)
      await page.getByRole('button', { name: 'Delete note' }).click()
    }
    await page.locator('.editor-slot').waitFor()
    const lines = await staffLines(page)
    const step = (lines[4]! - lines[0]!) / 8
    const box = await settledBox(page, page.locator('.editor-slot rect'))
    const x = box.x + box.width * 0.7
    await touch.down(x, lines[3]!)
    await touch.move(x, lines[3]! - step - 1)
    await touch.move(x, lines[3]! - 2 * step)
    await page.locator('.editor-drag-name').filter({ hasText: /^B4$/ }).waitFor()
    await touch.up()
    await page.locator('.editor-drag-name').waitFor({ state: 'detached' })
    assert.equal(await pitch(page), 'B4')
    await page.getByRole('button', { name: 'Undo' }).click()
    await drawn(page, `${BIG} g.note`, 0)
    assert.equal(await page.locator(`${BIG} g.mRest, ${BIG} g.rest`).count(), 1, 'one undo takes the note and its drag away together')

    // With the Marks tools open, a tap on the staff adds nothing (spec "No stray note").
    await tabs(page, 'Marks').click()
    await page.touchscreen.tap(x, lines[3]!)
    await page.waitForTimeout(300)
    assert.equal(await page.locator(`${BIG} g.note`).count(), 0)
    await tabs(page, 'Notes').click()
  })

  // A piano bar (spec "Tap in the left hand"): a tap on the lower staff where there is no note adds to the left hand.
  await withApp({ seed: '' }, async (app) => {
    const { page } = app
    const id = await makeDuet(page)
    await openEditor(page, id)
    await partSwitch(page).getByRole('radio', { name: 'Piano' }).click()
    await page.locator(`${BIG} g.note[id="lc1"]`).waitFor()
    await laidOut(page)
    const before = await storedPart(app, id, 'P2')
    const right = await page.locator(`${BIG} g.measure > g.staff`).nth(0).locator('g.note').count()
    const left = page.locator(`${BIG} g.measure > g.staff`).nth(1)
    const leftCount = await left.locator('g.note').count()
    const staff = (await left.boundingBox())!
    const lastHead = await left.locator('g.notehead').evaluateAll((heads) => Math.max(...heads.map((h) => h.getBoundingClientRect().right)))
    const lineYs = await left.evaluate((g) => [...g.querySelectorAll(':scope > path')].map((p) => p.getBoundingClientRect().top).sort((a, b) => a - b))
    await page.touchscreen.tap((lastHead + staff.x + staff.width) / 2, lineYs[2]!)
    const leftNow = () => page.locator(`${BIG} g.measure > g.staff`).nth(1).locator('g.note').count()
    for (let i = 0; i < 50 && (await leftNow()) === leftCount; i++) await page.waitForTimeout(100)
    assert.equal(await page.locator(`${BIG} g.measure > g.staff`).nth(1).locator('g.note').count(), leftCount + 1, 'one note more in the left hand')
    assert.equal(await page.locator(`${BIG} g.measure > g.staff`).nth(0).locator('g.note').count(), right, 'the right hand is unchanged')
    assert.match(await selection(page), /^Bar 1 · Left hand · /)
    await save(page).click()
    await onScreen(page, 'practice')
    assert.notEqual(await storedPart(app, id, 'P2'), before, 'the piano part is stored with it')
  })
})

test('edit: the Marks tray: Staccato painted on four notes, marks and a p on a selected note, a slur and a crescendo by their first and last note, a slur across a bar line listed in the next bar and removed there; all stored', async () => {
  await withApp({ seed: '' }, async (app) => {
    const { page } = app
    const ode = await makeOdePiece(page)
    await openEditor(page, ode)
    await tabs(page, 'Marks').click()
    const mark = (name: string) => page.getByRole('button', { name, exact: true })
    const on = async (name: string) => (await mark(name).getAttribute('aria-pressed')) === 'true'
    const armed = async (name: string) => (await mark(name).getAttribute('class'))?.includes('is-armed') === true
    const notice = (text: string) => page.locator('.editor-waiting').filter({ hasText: text })

    // Mark first (spec "Paint staccato on a line"): with nothing selected, Staccato is armed and goes on every note tapped,
    // which is not selected; it stays armed until it is tapped again (task 7.1).
    assert.equal(await mark('Staccato').isDisabled(), false, 'with no note, a mark is armed')
    await mark('Staccato').click()
    await page.getByText('Now tap every note that gets it. Tap the mark again to stop.').waitFor()
    for (const note of ODE[0]!) await tapNote(page, note)
    await drawn(page, `${BIG} g.artic`, 4)
    assert.deepEqual([await on('Staccato'), await armed('Staccato')], [true, true], 'still armed')
    assert.equal(await page.locator(`${BIG} g.note.mk-sel`).count(), 0, 'no note is selected')
    await mark('Staccato').click()
    assert.deepEqual([await on('Staccato'), await armed('Staccato')], [false, false], 'a second tap disarms it')

    // Note first: Staccato on the selected note, and tapping the active mark takes it off.
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
    // A p on the selected note (spec "Add a missed piano"), drawn under it.
    await mark('p, soft').click()
    assert.equal(await on('p, soft'), true)
    await drawn(page, `${BIG} g.dynam`, 1)

    // A slur: choose it, tap the first note of the phrase and then the last one. A selected note would be its first, so
    // the selection is put away first (design D14).
    await page.touchscreen.tap(...(await emptySpot(page)))
    await page.getByText('Tap a note, then a mark. Or a mark, then the notes.').waitFor()
    await mark('Slur').click()
    await page.getByText('Tap the first note, then the last. The last one can be in another bar.').waitFor()
    await tapNote(page, ODE[0]![0]!)
    await notice('Slur from bar 1 · tap the last note').waitFor()
    assert.equal(await page.locator(`${OVERVIEW} g.slur`).count(), 0, 'not before the last note is chosen')
    await tapNote(page, ODE[0]![3]!)
    assert.equal(await on('Slur'), true, 'still armed for the next one')
    await drawn(page, `${OVERVIEW} g.slur`, 1)
    assert.equal(await page.locator('.editor-waiting').count(), 0, 'the notice is gone')

    // A crescendo over bar 3, and a diminuendo that would overlap it is refused with a reason.
    await mark('Crescendo').click()
    await tapNote(page, ODE[2]![0]!)
    await tapNote(page, ODE[2]![3]!)
    assert.equal(await on('Crescendo'), true)
    await drawn(page, `${OVERVIEW} g.hairpin`, 1)
    await mark('Diminuendo').click()
    await tapNote(page, ODE[2]![1]!)
    await tapNote(page, ODE[3]![0]!)
    await page.getByText('A crescendo or diminuendo needs a note under it and cannot overlap another one.').waitFor()
    assert.equal(await page.locator(`${OVERVIEW} g.hairpin`).count(), 1)

    // A tie needs the next note to have the same pitch: C5 D5 do not.
    await mark('Tie').click()
    await tapNote(page, ODE[0]![0]!)
    await tapNote(page, ODE[0]![1]!)
    await page.getByText('A tie joins a note to the next note, and both need the same pitch.').waitFor()

    // A slur from the last note of bar 1 (where the first slur ends) to the first of bar 2, by two taps with Next between
    // them (spec "A slur into the next bar"); bar 2 lists it, and Remove there takes it off both notes and leaves the
    // first slur as it was (spec "A slur from the bar before").
    await mark('Slur').click()
    await tapNote(page, ODE[0]![3]!)
    await page.getByRole('button', { name: 'Next bar' }).click()
    await onBar(page, 2)
    await notice('Slur from bar 1 · tap the last note').waitFor()
    await tapNote(page, ODE[1]![0]!)
    const listed = page.getByRole('region', { name: 'Slurs and hairpins of this bar' }).getByRole('group', { name: 'Slur, bars 1 to 2' })
    await listed.waitFor()
    await page.locator('.editor-span-hint--slur').waitFor() // drawn in from the edge of bar 2
    await listed.getByRole('button', { name: 'Remove' }).click()
    await drawn(page, `${OVERVIEW} g.slur`, 1)
    await drawn(page, '.editor-span-hint', 0)
    assert.equal(await page.getByRole('region', { name: 'Slurs and hairpins of this bar' }).count(), 0, 'nothing left to list')

    // Saved, the stored score has them all, and the editor opened again draws the slur and the crescendo.
    await save(page).click()
    await onScreen(page, 'practice')
    const score = await stored(app, ode)
    assert.deepEqual(ODE[0]!.map((id) => noteOf(score, id).staccato === true), [true, true, true, true], 'the four painted notes')
    assert.equal(noteOf(score, ODE[2]![3]!).staccato, undefined)
    assert.equal(dynamicOf(score, ODE[2]![3]!)?.mark, 'p')
    assert.deepEqual(noteOf(score, ODE[0]![0]!).slurs, [{ type: 'start', number: 1 }])
    assert.deepEqual(noteOf(score, ODE[0]![3]!).slurs, [{ type: 'stop', number: 1 }])
    assert.deepEqual(noteOf(score, ODE[1]![0]!).slurs, [], 'the removed slur is on neither note')
    const wedge = firstLine(score).measures[2]!.items.find(isWedge)
    assert.deepEqual([wedge?.type, wedge?.start, wedge?.stop], ['crescendo', ODE[2]![0]!, ODE[2]![3]!])
    await openEditor(page, ode)
    await drawn(page, `${OVERVIEW} g.slur`, 1)
    await drawn(page, `${OVERVIEW} g.hairpin`, 1)

    // Tapping the active mark removes the hairpin from any note under it.
    await tabs(page, 'Marks').click()
    await tapNote(page, ODE[2]![1]!)
    assert.equal(await on('Crescendo'), true, 'every note under it shows it')
    await mark('Crescendo').click()
    await drawn(page, `${OVERVIEW} g.hairpin`, 0)
  })
})

test('edit: a slide in Notes joins three notes with a slur and changes no pitch; a slur from bar 2 waits through "Full score" to bar 5, is drawn to the edge of bar 3, and its key goes to its last bar', async () => {
  await withApp({ seed: '' }, async (app) => {
    const { page } = app
    const ode = await makeOdePiece(page)
    await openEditor(page, ode)
    const touch = await finger(page)

    // A slide from the first note of bar 1 to its third, with the Notes tools open (spec "Slide a slur", task 7.2): the
    // first 8 px sideways make it a slide, an arc follows the finger, and a finger that drifts a little up or down on
    // the way changes no pitch.
    const first = await headOf(page, ODE[0]![0]!)
    const third = await headOf(page, ODE[0]![2]!)
    await touch.down(first.x, first.y)
    await touch.move(first.x + 12, first.y)
    await page.locator('.editor-slide').waitFor()
    await touch.move((first.x + third.x) / 2, first.y - 6)
    await touch.move(third.x, third.y + 5)
    assert.equal(await page.locator('.editor-drag-name').count(), 0, 'no pitch drag')
    await touch.up()
    await drawn(page, `${BIG} g.slur`, 1)
    assert.equal(await page.locator('.editor-slide').count(), 0, 'the arc goes with the finger')
    assert.equal(await page.getByRole('button', { name: 'Undo' }).isDisabled(), false)

    // Slur armed, the first note tapped in bar 2: the notice says so above the bar, and the note is drawn as picked
    // (spec "A mark that waits for its last note", task 7.5).
    await tabs(page, 'Marks').click()
    await page.getByRole('button', { name: 'Slur', exact: true }).click()
    await tapNote(page, ODE[1]![1]!)
    const notice = page.locator('.editor-waiting').filter({ hasText: 'Slur from bar 2 · tap the last note' })
    await notice.waitFor()
    await page.locator(`${BIG} g.note.mk-pick[id="${ODE[1]![1]!}"]`).waitFor()
    // Through "Full score" to bar 5: the notice stays, and the first note is picked in the full score too.
    await page.getByRole('button', { name: 'Full score' }).click()
    await page.locator('.editor[data-layout="full"]').waitFor()
    await notice.waitFor()
    assert.equal(await page.locator(`${OVERVIEW} g.note.mk-pick[id="${ODE[1]![1]!}"]`).count(), 1, 'picked in the full score')
    await pickInFullScore(page, 'g.measure >> nth=4', 5)
    await notice.waitFor()
    await tapNote(page, ODE[4]![2]!)
    await notice.waitFor({ state: 'detached' })
    await page.locator('.editor-span-hint--slur').waitFor() // drawn in from the edge of bar 5 at once
    await page.waitForFunction((css) => document.querySelectorAll(`${css} g.note.mk-pick`).length === 0, OVERVIEW)

    // Bar 3 lists it (spec "A slur that passes through"); the large bar draws it from the start of its notes to the bar
    // line, over the staff.
    for (const bar of [4, 3]) {
      await page.getByRole('button', { name: 'Previous bar' }).click()
      await onBar(page, bar)
    }
    const listed = page.getByRole('region', { name: 'Slurs and hairpins of this bar' }).getByRole('group', { name: 'Slur, bars 2 to 5' })
    await listed.waitFor()
    await laidOut(page)
    const hint = (await page.locator('.editor-span-hint--slur').boundingBox())!
    const heads = await page.locator(`${BIG} g.notehead`).evaluateAll((all) => all.map((h) => h.getBoundingClientRect()).map((r) => [r.left, r.right, r.top]))
    const lines = await staffLines(page)
    assert.ok(hint.x < Math.min(...heads.map((h) => h[0]!)), 'in from before the first note')
    assert.ok(hint.x + hint.width > Math.max(...heads.map((h) => h[1]!)), 'out past the last note')
    assert.ok(hint.y + hint.height < lines[0]!, 'over the staff')
    // Its key for the last bar goes to bar 5, with the slur's last note selected (spec "Go to the other end").
    await listed.getByRole('button', { name: 'Go to its last bar' }).click()
    await onBar(page, 5)
    assert.equal(await selection(page), 'Bar 5 · Note 3')
    await page.locator('.editor-span-hint--slur').waitFor()

    await save(page).click()
    await onScreen(page, 'practice')
    const score = await stored(app, ode)
    assert.deepEqual(storedBar(score, 1), ['C5 quarter', 'D5 quarter', 'E5 quarter', 'F5 quarter'], 'no pitch changed')
    assert.deepEqual([ODE[0]![0]!, ODE[0]![1]!, ODE[0]![2]!].map((id) => noteOf(score, id).slurs.map((x) => x.type)), [['start'], [], ['stop']], 'the slid slur')
    assert.deepEqual([ODE[1]![1]!, ODE[4]![2]!].map((id) => noteOf(score, id).slurs.map((x) => x.type)), [['start'], ['stop']], 'the slur from bar 2 to bar 5')
  })
})

// ---- Grid (change redesign-score-editor, tasks 8.1 to 8.3) ----------------------------------------------------

/**
 * The Grid: one voice of the bar as blocks (design D3). It is drawn by the app, not by Verovio, and has no accessible
 * structure of its own (like the engraved score), so a journey finds a block by its note's id (`data-note`) and a cell by
 * the name of its row and the lines of its columns.
 */
const GRID = '.editor-blocks'
const view = (page: Page, name: 'Notes' | 'Grid') => page.getByRole('radiogroup', { name: 'View' }).getByRole('radio', { name })
const block = (page: Page, id: string) => page.locator(`${GRID} g.editor-blocks-block[data-note="${id}"]`)
/** What the editor's message row says. */
const said = (page: Page) => textOf(page.locator('.editor-say'))

/** Waits until the Grid shows bar `bar`; to measure in it, until the frame around it (the overview's line) is laid out too. */
async function onGridBar(page: Page, bar: number, measure = true): Promise<void> {
  await page.locator('.editor-bar-position').filter({ hasText: new RegExp(`^Bar ${bar} of `) }).waitFor()
  await page.locator(`${GRID}[data-bar="${bar}"]`).waitFor()
  if (measure) await laidOut(page)
}

/** The centre of the cell of the row named `row`, in column `col` (sixteenths from 0), and the height of a row. */
async function cellOf(page: Page, row: string, col: number): Promise<{ x: number; y: number; rowH: number }> {
  return page.evaluate(
    ([css, name, k]) => {
      const names = [...document.querySelectorAll(`${css} .editor-blocks-name`)]
      const label = names.find((t) => t.textContent === name)!.getBoundingClientRect()
      const next = names[1]!.getBoundingClientRect().top - names[0]!.getBoundingClientRect().top
      const xs = [...document.querySelectorAll(`${css} line.editor-blocks-column`)].map((l) => l.getBoundingClientRect().left).sort((a, b) => a - b)
      return { x: (xs[k as number]! + xs[(k as number) + 1]!) / 2, y: label.top + label.height / 2, rowH: next }
    },
    [GRID, row, col] as const,
  )
}

/** The left edge of column `col` (its line). */
const columnX = (page: Page, col: number) =>
  page.evaluate(([css, k]) => [...document.querySelectorAll(`${css} line.editor-blocks-column`)].map((l) => l.getBoundingClientRect().left).sort((a, b) => a - b)[k as number]!, [GRID, col] as const)

/** A block's box (the whole note, a staccato one too), once it is still: the Grid is drawn again when a row above it comes or goes. */
async function blockBox(page: Page, id: string): Promise<{ x: number; y: number; width: number; height: number }> {
  const rect = block(page, id).locator('rect').first()
  let last = await rect.boundingBox()
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(50)
    const box = await rect.boundingBox()
    if (box && last && box.x === last.x && box.y === last.y && box.width === last.width && box.height === last.height) return box
    last = box
  }
  assert.ok(last, `block ${id} drawn`)
  return last
}

/** Where a block is: its left edge and the name of its row ("E5 at 56"); a message row above the Grid may change the rows' height. */
async function blockPlace(page: Page, id: string): Promise<string> {
  return page.evaluate(
    ([css, note]) => {
      const r = document.querySelector(`${css} g.editor-blocks-block[data-note="${note}"] rect`)!.getBoundingClientRect()
      const mid = r.top + r.height / 2
      const names = [...document.querySelectorAll(`${css} .editor-blocks-name`)].map((t) => ({ name: t.textContent, d: Math.abs(t.getBoundingClientRect().top + t.getBoundingClientRect().height / 2 - mid) }))
      return `${names.sort((a, b) => a.d - b.d)[0]!.name} at ${Math.round(r.left)}`
    },
    [GRID, id] as const,
  )
}

/** A finger dragged from one point to another in small steps, past the 8 px that decide a drag. */
async function dragFinger(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  const touch = await finger(page)
  await touch.down(from.x, from.y)
  for (let k = 1; k <= 6; k++) await touch.move(from.x + ((to.x - from.x) * k) / 6, from.y + ((to.y - from.y) * k) / 6)
  await touch.up()
}

/** Bar 1: C5 D5 E5 F5; bar 2: a half note C5 and a half rest; bar 3: an eighth-note triplet E5 F5 G5 and C5 D5 E5. */
const GRID_SCORE = scoreXml(
  [
    ['C', 'D', 'E', 'F'].map((step) => noteXml({ step, type: 'quarter' })).join(''),
    noteXml({ step: 'C', type: 'half' }) + noteXml({ type: 'half', rest: true }),
    ['E', 'F', 'G'].map((step) => noteXml({ step, type: 'eighth', triplet: true })).join('') + ['C', 'D', 'E'].map((step) => noteXml({ step, type: 'quarter' })).join(''),
  ],
  [4, 4],
)
const GRID_IDS = noteIdsByBar(GRID_SCORE)

test('edit: Grid adds a note on beat 3 and lengthens it by its end, refuses to drag a triplet and moves the note beside it, and the loudness strip gives an mf and a crescendo; all stored', async () => {
  await withApp({ seed: '' }, async (app) => {
    const { page } = app
    const id = await page.evaluate(
      async ({ xml }) => {
        const { platform, shell } = window.__test!
        platform.files.seed('scans/test/page.jpg', Uint8Array.of(0xff, 0xd8, 0xff, 0xe0))
        const info = await shell.library.create({ name: 'Grid', musicxml: xml, bars: 3, repairs: [], pages: [{ source: 'scans/test/page.jpg', recognised: xml, firstBar: 1, lastBar: 3 }] })
        return info.id
      },
      { xml: GRID_SCORE },
    )
    await openEditor(page, id)
    await view(page, 'Grid').click()
    await onGridBar(page, 1)
    assert.equal(await page.locator(`${GRID} g.editor-blocks-block`).count(), 4)
    assert.equal(await page.locator(`${GRID} .editor-blocks-head text`).allTextContents().then((t) => t.join(' ')), '1 2 3 4', 'four beats over sixteen columns')

    // The loudness strip (task 8.2, spec "Loudness strip in Grid"): two taps under D5 give an mf; a slide from under the
    // first note to under the last a crescendo between them.
    const [c5, d5, , f5] = GRID_IDS[0]!
    const strip = (await page.locator(`${GRID} .editor-blocks-strip`).boundingBox())!
    const under = async (note: string) => {
      const b = await blockBox(page, note)
      return { x: b.x + b.width / 2, y: strip.y + strip.height / 2 }
    }
    const atD5 = await under(d5!)
    await page.touchscreen.tap(atD5.x, atD5.y)
    await page.locator(`${GRID} .editor-blocks-dynamic`).filter({ hasText: /^p$/ }).waitFor()
    await page.touchscreen.tap(atD5.x, atD5.y)
    await page.locator(`${GRID} .editor-blocks-dynamic`).filter({ hasText: /^mf$/ }).waitFor()
    await dragFinger(page, await under(c5!), await under(f5!))
    await page.locator(`${GRID} path[data-hairpin="crescendo"]`).waitFor()

    // Bar 2, a half note and a half rest; with a quarter chosen, a tap on G4 at beat 3 (spec "Add a note on beat 3").
    await page.getByRole('button', { name: 'Next bar' }).click()
    await onGridBar(page, 2)
    assert.equal(await page.getByRole('button', { name: 'Quarter', exact: true }).getAttribute('aria-pressed'), 'true', 'a quarter is what a tap adds')
    const g4 = await cellOf(page, 'G4', 8)
    await page.touchscreen.tap(g4.x, g4.y)
    await page.waitForFunction(() => document.querySelector('.editor-selection')?.textContent === 'Bar 2 · Note 2')
    assert.equal(await pitch(page), 'G4')
    assert.equal(await textOf(page.locator('.editor-beats')), '4 of 4 beats')
    const added = await page.locator(`${GRID} g.editor-blocks-block.is-selected`).getAttribute('data-note')
    assert.ok(added)
    assert.equal(await page.locator(`${GRID} g.editor-blocks-block`).count(), 2)

    // Its end dragged to the end of the bar (spec "Lengthen by dragging the end"): a half note.
    const box = await blockBox(page, added)
    await dragFinger(page, { x: box.x + box.width - 3, y: box.y + box.height / 2 }, { x: (await columnX(page, 16)) + 2, y: box.y + box.height / 2 })
    await page.waitForFunction(() => document.querySelector('.editor-selection')?.textContent === 'Bar 2 · Note 2')
    await page.getByRole('group', { name: 'Length' }).getByRole('status').filter({ hasText: /^half$/ }).waitFor()
    assert.equal(await textOf(page.locator('.editor-beats')), '4 of 4 beats')

    // Bar 3: a triplet block does not follow the finger, and the Grid says where triplets are edited (spec "Try to drag
    // a locked block"); the last quarter goes a step up and the triplet stays (spec "A triplet in the bar").
    await page.getByRole('button', { name: 'Next bar' }).click()
    await onGridBar(page, 3)
    const triplet = GRID_IDS[2]!
    assert.equal(await page.locator(`${GRID} g.editor-blocks-block.is-locked`).count(), 3, 'the triplet is locked')
    const places = () => Promise.all(triplet.slice(0, 3).map((n) => blockPlace(page, n)))
    const before = await places()
    assert.deepEqual(before.map((p) => p.split(' ')[0]), ['E5', 'F5', 'G5'])
    const first = await blockBox(page, triplet[0]!)
    await dragFinger(page, { x: first.x + first.width / 2, y: first.y + first.height / 2 }, { x: first.x + first.width / 2 + 60, y: first.y + first.height / 2 })
    await page.locator('.editor-say').filter({ hasText: 'Edit triplets and grace notes in Notes.' }).waitFor()
    assert.deepEqual(await places(), before, 'the triplet blocks are where they were')
    const last = await blockBox(page, triplet[5]!)
    const { rowH } = await cellOf(page, 'E5', 0)
    const touch = await finger(page)
    await touch.down(last.x + last.width / 2, last.y + last.height / 2)
    await touch.move(last.x + last.width / 2, last.y + last.height / 2 - 9)
    await touch.move(last.x + last.width / 2, last.y + last.height / 2 - rowH - 1)
    await page.locator(`${GRID} .editor-blocks-ghost`).filter({ hasText: /^F5$/ }).waitFor()
    await touch.up()
    await page.locator(`${GRID} .editor-blocks-ghost`).waitFor({ state: 'detached' })
    await page.waitForFunction(() => document.querySelector('.editor-selection')?.textContent === 'Bar 3 · Note 6')
    assert.equal(await pitch(page), 'F5')
    assert.equal(await said(page), '', 'the refusal went with the next change')

    await save(page).click()
    await onScreen(page, 'practice')
    const score = await stored(app, id)
    assert.equal(dynamicOf(score, d5!)?.mark, 'mf')
    const wedge = firstLine(score).measures[0]!.items.find(isWedge)
    assert.deepEqual([wedge?.type, wedge?.start, wedge?.stop], ['crescendo', c5, f5])
    assert.deepEqual(storedBar(score, 2), ['C5 half', 'G4 half'])
    assert.deepEqual(storedBar(score, 3), ['E5 eighth', 'F5 eighth', 'G5 eighth', 'C5 quarter', 'D5 quarter', 'F5 quarter'])
    assert.deepEqual(
      firstLine(score).measures[2]!.items.filter(isNote).slice(0, 3).map((n) => [n.id, n.timeMod?.actual, n.timeMod?.normal]),
      triplet.slice(0, 3).map((n) => [n, 3, 2]),
      'the triplet is unchanged',
    )
  })
})

test('edit: Notes and Grid show the same bar and selection; a staccato put on in Notes stays when the block is dragged up in Grid; the editor of another piece opens in Grid', async () => {
  await withApp({ seed: 'library' }, async (app) => {
    const { page } = app
    await openEditor(page, ID.ode)
    // Spec "Switch with a note selected": the second note of bar 2, then Grid, shows bar 2 with its block selected.
    await page.getByRole('button', { name: 'Next bar' }).click()
    await onBar(page, 2)
    const second = ODE[1]![1]!
    await tapNote(page, second)
    assert.equal(await selection(page), 'Bar 2 · Note 2')
    await view(page, 'Grid').click()
    await onGridBar(page, 2, false)
    assert.equal(await block(page, second).getAttribute('class'), 'editor-blocks-block is-selected')
    assert.equal(await selection(page), 'Bar 2 · Note 2')
    // And back: Notes shows the same bar and note.
    await view(page, 'Notes').click()
    await onBar(page, 2)
    await page.locator(`${BIG} g.note.mk-sel[id="${second}"]`).waitFor()

    // Spec "A mark survives the other view": Staccato on the note in Notes, then its block one step up in Grid.
    await tabs(page, 'Marks').click()
    await page.getByRole('button', { name: 'Staccato', exact: true }).click()
    await drawn(page, `${BIG} g.artic`, 1)
    await view(page, 'Grid').click()
    await onGridBar(page, 2)
    assert.equal(await block(page, second).locator('rect.editor-blocks-block-faint').count(), 1, 'drawn as a staccato block')
    const box = await blockBox(page, second)
    const { rowH } = await cellOf(page, 'D5', 0)
    await dragFinger(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, { x: box.x + box.width / 2, y: box.y + box.height / 2 - rowH - 1 })
    await page.waitForFunction(([css, id]) => document.querySelector(`${css} g.editor-blocks-block[data-note="${id}"] text`)?.textContent === 'E5', [GRID, second] as const)

    // Spec "The view is remembered": saved in Grid, the editor of another piece opens in Grid.
    await save(page).click()
    await onScreen(page, 'practice')
    const score = await stored(app, ID.ode)
    assert.deepEqual([noteOf(score, second).pitch, noteOf(score, second).staccato], [{ step: 'E', octave: 5 }, true])
    await page.evaluate((pieceId) => window.__test!.shell.router.push({ name: 'editor', pieceId }), ID.warmUp)
    await page.getByRole('heading', { name: 'Edit score', level: 1 }).waitFor()
    await onGridBar(page, 1, false)
    assert.equal(await view(page, 'Grid').getAttribute('aria-checked'), 'true')
    assert.equal(await page.locator(BIG).count(), 0, 'no bar in Notes')
  })
})

test('edit: the Bars tray sets how the current bar starts and ends, and the passes of an end-repeat; saving stores the repeat signs (change edit-bar-lines)', async () => {
  await withApp({ seed: 'library' }, async (app) => {
    const { page } = app
    await openEditor(page, ID.ode)
    await tabs(page, 'Bars').click()
    const { start, end, endPressed, passes } = barTools(page)
    // There is always a current bar (change redesign-score-editor, D1): with nothing selected the tray is bar 1's.
    await page.getByRole('heading', { name: 'Bar 1' }).waitFor()
    assert.equal(await start.isDisabled(), false)
    assert.equal(await end('Normal').isDisabled(), false)

    // A tap on the bar line that closes bar 7 makes bar 7 current, with no note.
    await goToBar(page, 7)
    await tapBarLine(page)
    await page.getByRole('heading', { name: 'Bar 7' }).waitFor()
    assert.equal(await start.isDisabled(), false)

    await tapNote(page, ODE[2]![1]!)
    await page.getByRole('heading', { name: 'Bar 3' }).waitFor()
    assert.equal(await start.getAttribute('aria-pressed'), 'false', 'a plain start')
    assert.deepEqual(await endPressed(), ['Normal'])
    // The passes are off without an end-repeat (the mock's tray keeps the row).
    assert.deepEqual([await passes.getByRole('button', { name: 'Play the section fewer times' }).isDisabled(), await passes.getByRole('button', { name: 'Play the section more times' }).isDisabled()], [true, true], 'no passes without an end-repeat')

    await start.click()
    await end('Repeat').click()
    assert.deepEqual(await endPressed(), ['Repeat'])
    assert.equal(await textOf(passes.getByRole('status')), '2×')
    await passes.getByRole('button', { name: 'Play the section more times' }).click()
    assert.equal(await textOf(passes.getByRole('status')), '3×')
    await page.getByRole('button', { name: 'Undo' }).click()
    assert.equal(await textOf(passes.getByRole('status')), '2×', 'one undo takes the step back')
    assert.equal(await start.getAttribute('aria-pressed'), 'true')
    assert.equal(await passes.getByRole('button', { name: 'Play the section fewer times' }).isDisabled(), true, 'two passes is the fewest')

    await save(page).click()
    await onScreen(page, 'practice')
    const xml = (await app.file(`pieces/${ID.ode}/${JSON.parse((await app.file(`pieces/${ID.ode}/piece.json`))!).score}`)) ?? ''
    const bar3 = /<measure number="3"[\s\S]*?<\/measure>/.exec(xml)?.[0] ?? ''
    assert.match(bar3, /<barline location="left">\s*<bar-style>heavy-light<\/bar-style>\s*<repeat direction="forward"\/>/)
    assert.match(bar3, /<barline location="right">\s*<bar-style>light-heavy<\/bar-style>\s*<repeat direction="backward"\/>/)
    const saved = await stored(app, ID.ode)
    assert.deepEqual([firstLine(saved).measures[2]!.leftBarline?.repeat, firstLine(saved).measures[2]!.rightBarline?.repeat, firstLine(saved).measures[2]!.rightBarline?.times], ['forward', 'backward', undefined])
  })
})

test('edit: the Score tab changes the key and the time signature, which draws the score again and checks the bars, and the written tempo', async () => {
  await withApp({ seed: '' }, async (app) => {
    const { page } = app
    const ode = await makeOdePiece(page)
    await openEditor(page, ode)
    await tapNote(page, ODE[2]![3]!)
    await tabs(page, 'Score').click()
    assert.equal(await selection(page), 'Whole score')
    const key = page.getByRole('combobox', { name: 'Key' })
    const time = page.getByRole('combobox', { name: 'Time signature' })
    assert.equal(await key.inputValue(), '0')
    assert.equal(await time.inputValue(), '4/4')
    assert.equal(await page.locator(`${OVERVIEW} g.keyAccid`).count(), 0, 'no sharps or flats')

    // One sharp: the score is drawn again with a key signature on every line.
    await key.selectOption('1')
    await page.waitForFunction((css) => document.querySelectorAll(`${css} g.keyAccid`).length > 0, OVERVIEW)
    assert.ok((await page.locator(`${OVERVIEW} g.keyAccid`).count()) >= 1, 'a sharp in the key signature')
    assert.ok((await page.locator(`${BIG} g.keyAccid`).count()) >= 1, 'and in the large bar')
    assert.equal(await page.locator(`${OVERVIEW} g.note`).count(), 48)
    await key.selectOption('-2')
    assert.equal(await key.inputValue(), '-2')
    await page.getByRole('button', { name: 'Undo' }).click()
    await page.getByRole('button', { name: 'Undo' }).click()
    assert.equal(await key.inputValue(), '0')

    // 3/4: every bar has four beats, so every bar is flagged, and Next goes from bar to bar after the selected note (bar 3).
    await time.selectOption('3/4')
    assert.match(await textOf(warnings(page)), /12 to check/)
    await warnings(page).getByRole('button', { name: 'Next' }).click()
    assert.match(await textOf(page.locator('.editor-warnings-text')), /Bar 4 adds up to 4 beats but 3\/4 needs 3\./)
    await warnings(page).getByRole('button', { name: 'Next' }).click()
    assert.match(await textOf(page.locator('.editor-warnings-text')), /Bar 5 adds up/)
    await page.getByRole('button', { name: 'Preview bar 5' }).waitFor() // the warning selected bar 5
    assert.ok((await page.locator(`${OVERVIEW} g.note.mk-flagbar`).count()) >= 4, 'the notes of flagged bars are marked')
    assert.equal(await page.locator(`${BIG} g.note.mk-flagbar`).count(), 4, 'in the overview and on the large bar')
    await warnings(page).getByRole('button', { name: 'Previous' }).click()
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
    assert.match(await textOf(warnings(page)), /1 to check/)
    assert.equal(await page.locator(`${BIG} g.note.mk-flag`).count(), 1, 'the note is marked on the large bar')
    assert.equal(await page.locator(`${OVERVIEW} g.note.mk-flag`).count(), 1, 'and in the overview')
    await warnings(page).getByRole('button', { name: 'Next' }).click()
    assert.match(await textOf(page.locator('.editor-warnings-text')), /A3 is outside the written range of the instrument \(Tenor saxophone/)
    await page.getByRole('button', { name: 'Pitch up' }).click()
    assert.equal(await warnings(page).count(), 0, 'the count goes down and the mark with it')
    assert.equal(await page.locator('.editor .score-view g.note.mk-flag').count(), 0)
  })
})

test('edit: the header\'s Back and the back button ask before throwing edits away, and not when there are none', async () => {
  await withApp({ seed: 'library' }, async (app) => {
    const { page } = app
    // No edits: Back leaves at once. (The header has Back, not Cancel, since change redesign-score-editor, D1.)
    await openEditor(page, ID.ode)
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await page.getByRole('heading', { name: 'Let’s practise' }).waitFor()
    assert.equal((await app.stack()).length, 1)

    // An edit: Back asks; "Keep editing" stays, and nothing was saved.
    await openEditor(page, ID.ode)
    await tapNote(page, ODE[0]![0]!)
    await page.getByRole('button', { name: 'Pitch down' }).click()
    await page.getByRole('button', { name: 'Back', exact: true }).click()
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

test('edit: "Add pages" at the foot of the Score tab opens adding music for this piece, after asking to save the edits that would be lost', async () => {
  await withApp({ seed: 'library' }, async (app) => {
    const { page } = app
    const addPages = page.locator('.editor-add-pages').getByRole('button', { name: 'Add pages' })
    // No edits: straight to the add-music screen for this piece.
    await openEditor(page, ID.ode)
    assert.equal(await addPages.count(), 0, 'only on the Score tab')
    await tabs(page, 'Score').click()
    assert.equal(await textOf(page.locator('.editor-add-pages .editor-hint')), 'Scan more pages; they go after bar 12.')
    await addPages.click()
    assert.deepEqual(await app.screen(), { name: 'add-music', pieceId: ID.ode })
    await app.back()
    await page.getByRole('heading', { name: 'Edit score', level: 1 }).waitFor()

    // With edits: the question first. Cancel stays; Save and add pages saves, then goes on.
    await tapNote(page, ODE[0]![0]!)
    await tabs(page, 'Notes').click()
    await page.getByRole('button', { name: 'Pitch down' }).click()
    await tabs(page, 'Score').click()
    await addPages.click()
    const dialog = page.getByRole('alertdialog', { name: 'Save your edits first?' })
    await dialog.waitFor()
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await dialog.waitFor({ state: 'detached' })
    assert.deepEqual(await app.screen(), { name: 'editor', pieceId: ID.ode })
    assert.deepEqual(noteOf(await stored(app, ID.ode), ODE[0]![0]!).pitch, { step: 'C', octave: 5 })

    await addPages.click()
    await dialog.getByRole('button', { name: 'Save and add pages' }).click()
    await page.waitForFunction(() => window.__test!.shell.router.screen.value.name === 'add-music')
    assert.deepEqual(await app.screen(), { name: 'add-music', pieceId: ID.ode })
    assert.deepEqual(noteOf(await stored(app, ID.ode), ODE[0]![0]!).pitch, { step: 'B', octave: 4 }, 'the edit was saved')

    // Back from adding music, the editor opens again on what is stored, with the correction in it.
    await app.back()
    await page.getByRole('heading', { name: 'Edit score', level: 1 }).waitFor()
    await page.locator(`${BIG}[data-rendered="true"]`).waitFor()
    await page.locator(`${OVERVIEW}[data-rendered="true"]`).waitFor()
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

/** Taps the bar line at the end of the large bar. */
async function tapBarLine(page: Page): Promise<void> {
  const line = page.locator(`${BIG} g.barLine`).last()
  const box = await settledBox(page, line)
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
}

/** The centre of a drawn element, once it is still. */
async function centre(page: Page, selector: string, nth = 0): Promise<{ x: number; y: number }> {
  const element = page.locator(selector).nth(nth)
  await element.waitFor()
  const box = await settledBox(page, element)
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

/** A point on the stroke of the slur in the large bar (its bounding box covers the notes under it, so its centre is not on it). */
async function onSlur(page: Page): Promise<{ x: number; y: number }> {
  await settledBox(page, page.locator(`${BIG} g.slur`).first())
  return page.evaluate((css) => {
    const path = document.querySelector<SVGGeometryElement>(`${css} g.slur path`)!
    const point = path.getPointAtLength(path.getTotalLength() / 2)
    const m = path.getScreenCTM()!
    return { x: point.x * m.a + point.y * m.c + m.e, y: point.x * m.b + point.y * m.d + m.f }
  }, BIG)
}

const panel = (page: Page, name = 'Selected element') => page.getByRole('region', { name })

test('edit: a tap picks the element under the finger, else the nearest note; the selected element is highlighted', async () => {
  await withApp({ seed: '' }, async (app) => {
    const { page } = app
    const id = await makeElementsPiece(page)
    await openEditor(page, id)
    const ids = noteIdsByBar(elementsScore())

    // The mf sits under the first note of bar 2: the mf is selected, not the note.
    await goToBar(page, 2)
    const mf = await centre(page, `${BIG} g.dynam`)
    await page.touchscreen.tap(mf.x, mf.y)
    await panel(page).waitFor()
    assert.equal(await textOf(panel(page).locator('.editor-element-title')), 'Dynamic · mf · bar 2')
    assert.equal(await page.locator(`${BIG} g.dynam.mk-el`).count(), 1, 'the mf is highlighted')
    assert.equal(await page.locator('.editor .score-view g.note.mk-sel').count(), 0, 'no note is selected')

    // Beside the staff, near a note: the note (and the element goes).
    await goToBar(page, 1)
    const note = page.locator(`${BIG} svg g.note[id="${ids[0]![3]!}"]`)
    const box = await settledBox(page, note)
    await page.touchscreen.tap(box.x + box.width / 2, box.y - 14)
    await page.waitForFunction((css) => document.querySelectorAll(`${css} g.note.mk-sel`).length === 1, BIG)
    assert.equal(await panel(page).count(), 0, 'a note brings the normal tabs back')
    assert.equal(await page.locator('.editor .score-view .mk-el').count(), 0)

    // A slur's drawing covers the notes under it, but a tap on a note still selects the note.
    await tapNote(page, ids[0]![0]!)
    assert.equal(await panel(page).count(), 0)
    assert.equal(await page.locator(`${BIG} g.note.mk-sel[id="${ids[0]![0]!}"]`).count(), 1)
    // And on its stroke, the slur.
    const slur = await onSlur(page)
    await page.touchscreen.tap(slur.x, slur.y)
    await panel(page).waitFor()
    assert.match(await textOf(panel(page).locator('.editor-element-title')), /^Slur · bar 1$/)

    // A staccato dot is smaller than a finger: a tap a few pixels beside it still selects it, not its note.
    await goToBar(page, 2)
    const dot = page.locator(`${BIG} g.artic`).first()
    const dotBox = await settledBox(page, dot)
    await page.touchscreen.tap(dotBox.x + dotBox.width + 3, dotBox.y + dotBox.height / 2)
    await page.waitForFunction(() => document.querySelector('.editor-element-title')?.textContent === 'Staccato · bar 2')
    assert.equal(await page.locator(`${BIG} g.artic.mk-el`).count(), 1, 'the dot is highlighted')

    // An empty part of the bar puts the element away, and keeps its bar.
    await page.touchscreen.tap(...(await emptySpot(page)))
    await panel(page).waitFor({ state: 'detached' })
    assert.equal(await page.locator('.editor .score-view .mk-el').count(), 0)
    assert.equal(await barRow(page), 'Bar 2 of 4')
  })
})

/** A point in the large bar that is on no note, element or staff line: its right margin, at the top. */
async function emptySpot(page: Page): Promise<[number, number]> {
  const box = (await page.locator('.editor-bar-host').boundingBox())!
  return [box.x + box.width - 4, box.y + 6]
}

test('edit: deleting a misread clef moves the notes up 12 steps, as one undo step, and is stored', async () => {
  await withApp({ seed: '' }, async (app) => {
    const { page } = app
    const id = await makeElementsPiece(page)
    await openEditor(page, id)
    // The clef change of bar 3 is drawn at the start of bar 3's large bar, as the clef of that bar.
    await goToBar(page, 3)
    const at = await centre(page, `${BIG} g.clef`)
    await page.touchscreen.tap(at.x, at.y)
    await panel(page).waitFor()
    assert.equal(await textOf(panel(page).locator('.editor-element-title')), 'Clef · bass · bar 3')

    await panel(page).getByRole('button', { name: 'Delete' }).click()
    await panel(page).waitFor({ state: 'detached' })
    await save(page).click()
    await onScreen(page, 'practice')
    const saved = await stored(app, id)
    assert.equal(firstLine(saved).measures[2]!.clef, undefined, 'no clef at bar 3')
    const bar3 = firstLine(saved).measures[2]!.items.filter(isNote).map((n) => `${n.pitch!.step}${n.pitch!.octave}`)
    assert.deepEqual(bar3, ['B4', 'D5', 'F5', 'A5'], 'D3 is B4: twelve diatonic steps up')
    assert.deepEqual(firstLine(saved).measures[3]!.items.filter(isNote).map((n) => `${n.pitch!.step}${n.pitch!.octave}`), ['B4', 'D5', 'F5', 'A5'], 'up to the end of the piece')
  })
})

test('edit: the clef select changes a clef and keeps its notes on the staff; the first clef has no Delete', async () => {
  await withApp({ seed: '' }, async (app) => {
    const { page } = app
    const id = await makeElementsPiece(page)
    await openEditor(page, id)
    await goToBar(page, 1)
    const first = await centre(page, `${BIG} g.clef`, 0)
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
    await goToBar(page, 1)
    await drawn(page, `${BIG} g.slur`, 1)
    const slur = await onSlur(page)
    await page.touchscreen.tap(slur.x, slur.y)
    await panel(page).waitFor()
    await panel(page).getByRole('button', { name: 'Delete' }).click()
    await drawn(page, `${BIG} g.slur`, 0)
    await panel(page).waitFor({ state: 'detached' })
    await page.getByRole('button', { name: 'Undo' }).click()
    await drawn(page, `${BIG} g.slur`, 1)
    await panel(page).waitFor()
    assert.equal(await textOf(panel(page).locator('.editor-element-title')), 'Slur · bar 1', 'the slur is selected again')
    await page.waitForFunction((css) => document.querySelectorAll(`${css} g.slur.mk-el`).length === 1, BIG)
  })
})

test('edit: a tap on a bar line makes its bar current and opens the Bars tools with its start and end (spec "Remove a bar line", "From the bar line itself")', async () => {
  await withApp({ seed: '' }, async (app) => {
    const { page } = app
    const id = await makeElementsPiece(page)
    await openEditor(page, id)
    // The bar line that closes bar 2.
    await goToBar(page, 2)
    await tapBarLine(page)
    await page.getByRole('heading', { name: 'Bar 2' }).waitFor()
    assert.equal(await tabs(page, 'Bars').isChecked(), true, 'the Bars tools are open')
    assert.equal(await barRow(page), 'Bar 2 of 4')
    assert.equal(await panel(page).count(), 0, 'a bar line has no element panel')
    const { start, end, endPressed } = barTools(page)
    assert.equal(await start.isDisabled(), false)
    assert.equal(await end('Double').isDisabled(), false)
    assert.deepEqual(await endPressed(), ['Normal'], 'its end is shown')
    assert.equal(await page.getByRole('button', { name: 'Join with next' }).getAttribute('aria-disabled'), null, '"Join with next" is offered')
  })
})

test('edit: Trill from the Marks tab is stored as <trill-mark/> on its note, a tap on the trill selects it and Delete removes it; Arpeggio needs a chord (change more-marks)', async () => {
  await withApp({ seed: '' }, async (app) => {
    const { page } = app
    const ode = await makeOdePiece(page)
    await openEditor(page, ode)
    await tabs(page, 'Marks').click()
    const mark = (name: string) => page.getByRole('button', { name, exact: true })
    const on = async (name: string) => (await mark(name).getAttribute('aria-pressed')) === 'true'
    const names = ['Staccatissimo', 'Strong accent', 'Trill', 'Turn', 'Mordent', 'Tremolo', 'Arpeggio']
    for (const name of names) assert.equal(await mark(name).count(), 1, `${name} chip`)

    // A single note has no chord: Arpeggio is disabled, and the others are not.
    const target = ODE[1]![1]!
    await tapNote(page, target)
    assert.equal(await mark('Arpeggio').isDisabled(), true, 'Arpeggio is disabled on a single note')
    for (const name of names.slice(0, 6)) assert.equal(await mark(name).isDisabled(), false, `${name} is enabled`)

    // Trill, then Turn replaces it, then Trill again.
    await mark('Trill').click()
    assert.equal(await on('Trill'), true)
    await drawn(page, `${BIG} g.trill`, 1)
    await mark('Turn').click()
    assert.deepEqual([await on('Trill'), await on('Turn')], [false, true], 'a turn replaces the trill')
    await mark('Trill').click()
    assert.deepEqual([await on('Trill'), await on('Turn'), await on('Mordent')], [true, false, false])
    await drawn(page, `${BIG} g.turn`, 0)

    await save(page).click()
    await onScreen(page, 'practice')
    const info = JSON.parse((await app.file(`pieces/${ode}/piece.json`)) ?? '{}') as { score: string }
    const xml = (await app.file(`pieces/${ode}/${info.score}`)) ?? ''
    const own = new RegExp(`<note id="${target}"[^>]*>(?:(?!</note>).)*</note>`, 's').exec(xml)?.[0] ?? ''
    assert.match(own, /<trill-mark\/>/, 'the stored note has the trill')
    assert.equal(xml.match(/<trill-mark\/>/g)?.length, 1, 'and no other note has one')
    assert.equal(noteOf(await stored(app, ode), target).ornament, 'trill')

    // Tap the trill on the score: it is selected and named with its bar; Delete removes it, and the note keeps its place.
    await openEditor(page, ode)
    await goToBar(page, 2)
    await drawn(page, `${BIG} g.trill`, 1)
    const trill = await centre(page, `${BIG} g.trill`)
    await page.touchscreen.tap(trill.x, trill.y)
    await panel(page).waitFor()
    assert.equal(await textOf(panel(page).locator('.editor-element-title')), 'Trill · bar 2')
    assert.equal(await page.locator(`${BIG} g.trill.mk-el`).count(), 1, 'the trill is highlighted')
    await panel(page).getByRole('button', { name: 'Delete' }).click()
    await drawn(page, `${BIG} g.trill`, 0)
    await panel(page).waitFor({ state: 'detached' })
    await save(page).click()
    await onScreen(page, 'practice')
    assert.equal(noteOf(await stored(app, ode), target).ornament, undefined)
    assert.ok(!((await app.file(`pieces/${ode}/${info.score}`)) ?? '').includes('trill-mark'), 'the stored file has no trill')
  })
})

// ---- editing every part (change edit-parts, tasks 4.1 and 4.2) -----------------------------------

/** The melody-and-piano fixture with a chord in the left hand of bar 1: C3 with E3 (`lc1`) on it. */
const DUET = readFileSync(MELODY_PIANO_FIXTURE, 'utf8').replace(
  '<note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><type>half</type><voice>5</voice><staff>2</staff></note>',
  (c3) => `${c3}<note id="lc1"><chord/><pitch><step>E</step><octave>3</octave></pitch><duration>4</duration><type>half</type><voice>5</voice><staff>2</staff></note>`,
)
const DUET_SCORE = parseMusicXml(DUET)
/** The id of the `k`th note (from 0, chord notes counted) of a voice in a bar (from 1) of the duet. */
const duetNote = (part: string, staff: number, bar: number, k: number): string => {
  const pi = DUET_SCORE.parts.findIndex((p) => p.id === part)
  return DUET_SCORE.bars[bar - 1]!.parts[pi]!.staves[staff]!.voices[0]!.filter(isNote)[k]!.id
}

/** The duet made through the library, as reading would leave it. */
async function makeDuet(page: Page): Promise<string> {
  return page.evaluate(
    async ({ xml }) => {
      const { platform, shell } = window.__test!
      platform.files.seed('scans/test/page.jpg', Uint8Array.of(0xff, 0xd8, 0xff, 0xe0))
      const info = await shell.library.create({ name: 'Duet', musicxml: xml, bars: 8, repairs: [], pages: [{ source: 'scans/test/page.jpg', recognised: xml, firstBar: 1, lastBar: 8 }] })
      return info.id
    },
    { xml: DUET },
  )
}

/** The duet's piano alone: one part of two staves. */
async function makePiano(page: Page): Promise<string> {
  const xml = DUET.replace(/<score-part id="P1">[\s\S]*?<\/score-part>/, '').replace(/<part id="P1">[\s\S]*?<\/part>/, '')
  return page.evaluate(
    async ({ xml }) => {
      const { platform, shell } = window.__test!
      platform.files.seed('scans/test/page.jpg', Uint8Array.of(0xff, 0xd8, 0xff, 0xe0))
      const info = await shell.library.create({ name: 'Piano', musicxml: xml, bars: 8, repairs: [], pages: [{ source: 'scans/test/page.jpg', recognised: xml, firstBar: 1, lastBar: 8 }] })
      return info.id
    },
    { xml },
  )
}

/** One part of a stored MusicXML file, as the app writes it. */
async function storedPart(app: App, pieceId: string, part: string): Promise<string> {
  const info = JSON.parse((await app.file(`pieces/${pieceId}/piece.json`)) ?? '{}') as { score: string }
  const xml = serializeMusicXml(parseMusicXml((await app.file(`pieces/${pieceId}/${info.score}`)) ?? ''))
  return new RegExp(`<part id="${part}">[\\s\\S]*?</part>`).exec(xml)![0]
}

const partSwitch = (page: Page) => page.getByRole('radiogroup', { name: 'Part to edit' })

test('edit parts: switch to the piano, fix a note of a left-hand chord, save: the piano changes, the melody does not', async () => {
  await withApp({ seed: '' }, async (app) => {
    const { page } = app
    const id = await makeDuet(page)
    await openEditor(page, id)
    const melodyBefore = await storedPart(app, id, 'P1')
    // The editor opens on the melody; the switch offers both parts.
    assert.equal(await partSwitch(page).getByRole('radio', { name: 'Melody' }).getAttribute('aria-checked'), 'true')
    assert.equal(await page.locator(`${BIG} g.staff`).count() > 0, true)
    await partSwitch(page).getByRole('radio', { name: 'Piano' }).click()
    await page.locator(`${OVERVIEW} g.note[id="lc1"]`).waitFor()
    // The piano is drawn as a grand staff: two staves in every bar.
    assert.equal(await page.locator(`${OVERVIEW} g.measure`).first().locator(':scope > g.staff').count(), 2)
    await tapNote(page, 'lc1')
    assert.equal(await selection(page), 'Bar 1 · Left hand · Chord, note 2 of 2')
    assert.equal(await pitch(page), 'E3')
    await page.getByRole('button', { name: 'Pitch up' }).click()
    assert.equal(await pitch(page), 'F3')
    await save(page).click()
    await onScreen(page, 'practice')
    const saved = await stored(app, id)
    const pi = saved.parts.findIndex((p) => p.id === 'P2')
    const chord = saved.bars[0]!.parts[pi]!.staves[1]!.voices[0]!.filter(isNote)
    assert.deepEqual(chord.map((n) => `${n.chord ? '+' : ''}${n.pitch!.step}${n.pitch!.octave}`).slice(0, 2), ['C3', '+F3'], 'the chord note is F3 in P2')
    assert.equal(await storedPart(app, id, 'P1'), melodyBefore, 'P1 is unchanged')
  })
})

test('edit parts: "+ Chord note" adds and selects the note; "To other hand" says why it cannot; a one-line piece has no "To other hand"', async () => {
  await withApp({ seed: '' }, async (app) => {
    const { page } = app
    const id = await makeDuet(page)
    await openEditor(page, id)
    await partSwitch(page).getByRole('radio', { name: 'Piano' }).click()
    // The right hand's first chord, C4–E4–G4: a fourth note a third above G4.
    const middle = duetNote('P2', 0, 1, 1)
    await page.locator(`${OVERVIEW} g.note[id="${middle}"]`).waitFor()
    await tapNote(page, middle)
    assert.equal(await selection(page), 'Bar 1 · Right hand · Chord, note 2 of 3')
    await page.getByRole('button', { name: '+ Chord note' }).click()
    assert.equal(await selection(page), 'Bar 1 · Right hand · Chord, note 4 of 4', 'the new note is selected')
    assert.equal(await pitch(page), 'B4')
    // Bar 2: the right hand's second chord, on beat 3, where the left hand holds a whole note.
    const held = duetNote('P2', 0, 2, 3)
    await tapNote(page, held)
    await page.getByRole('button', { name: 'To other hand' }).click()
    assert.equal(await textOf(page.locator('.editor-message')), 'The other hand has no rest or chord of the same length there. Make room for it first.')
    // The Score tab names the part whose key it sets.
    await tabs(page, 'Score').click()
    await page.getByText('Key of Piano').first().waitFor()
  })
  await withApp({ seed: 'library' }, async (app) => {
    const { page } = app
    await openEditor(page, ID.ode)
    await tapNote(page, ODE[0]![0]!)
    await page.getByRole('button', { name: '+ Chord note' }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'To other hand' }).count(), 0)
    assert.equal(await partSwitch(page).count(), 0, 'one part: no part switch')
  })
})

// ---- adding and removing a bar line (change edit-parts, task 5.3) --------------------------------

/** piece.json of a piece. */
async function pieceJson(app: App, pieceId: string): Promise<{ bars: number; pages: { firstBar: number; lastBar: number }[] }> {
  return JSON.parse((await app.file(`pieces/${pieceId}/piece.json`)) ?? '{}') as { bars: number; pages: { firstBar: number; lastBar: number }[] }
}

test('edit parts: tap a bar line, "Join with next", save: one bar fewer in the score and in piece.json; not at the end of a page', async () => {
  await withApp({ seed: '' }, async (app) => {
    const { page } = app
    const id = await makeOdePiece(page)
    await openEditor(page, id)
    // The bar line that closes bar 4 ends the first page: it stays. "Join with next" is off, and a tap on it says why.
    await goToBar(page, 4)
    await tapBarLine(page)
    await page.getByRole('heading', { name: 'Bar 4' }).waitFor()
    const join = page.getByRole('button', { name: 'Join with next' })
    assert.equal(await join.getAttribute('aria-disabled'), 'true')
    await join.click({ force: true })
    assert.equal(await textOf(page.locator('.editor-message')), 'This bar ends a line of the printed page, so its bar line stays.')
    assert.equal(await page.getByRole('button', { name: 'Undo' }).isDisabled(), true, 'nothing changed')
    // The bar line that closes bar 1 goes.
    await goToBar(page, 1)
    await tapBarLine(page)
    await page.getByRole('heading', { name: 'Bar 1' }).waitFor()
    await join.click()
    await save(page).click()
    await onScreen(page, 'practice')
    const saved = await stored(app, id)
    assert.equal(saved.bars.length, 11)
    assert.deepEqual(firstLine(saved).measures[0]!.items.filter(isNote).map((n) => n.id), [...ODE[0]!, ...ODE[1]!], 'bar 1 holds the notes of both')
    const info = await pieceJson(app, id)
    assert.equal(info.bars, 11)
    assert.deepEqual(info.pages.map((p) => [p.firstBar, p.lastBar]), [[1, 3], [4, 7], [8, 11]])
  })
})

test('edit parts: add a bar line with the scissors, Save & practice: the loop is over the same music', async () => {
  await withApp({ seed: '' }, async (app) => {
    const { page } = app
    const id = await makeOdePiece(page)
    await page.evaluate((pieceId) => window.__test!.shell.library.writePractice(pieceId, { bar: 9, tempo: null, loop: { start: 9, end: 12 }, loopRest: 0, metronome: false }), id)
    await openEditor(page, id)
    // Bar 6, before its third note: the Bars tools show a scissors mark between every two notes, none before the first.
    await tapNote(page, ODE[5]![2]!)
    await tabs(page, 'Bars').click()
    assert.deepEqual(await cutNames(page), ['Bar line before D5 (2)', 'Bar line before E5 (3)', 'Bar line before F5 (4)'])
    await page.getByRole('button', { name: 'Bar line before E5 (3)' }).tap()
    assert.equal(await selection(page), 'Bar 7 · Note 1', 'the note stays selected, now the first of the new bar 7')
    await onBar(page, 7)
    // Not offered before the first note of a bar.
    await tapNote(page, ODE[5]![0]!)
    await onBar(page, 6)
    assert.deepEqual(await cutNames(page), ['Bar line before D5 (2)'], 'bar 6 is C5 D5 now: one mark, between them')
    await save(page).click()
    await onScreen(page, 'practice')
    await page.getByRole('button', { name: 'Loop 10–13' }).waitFor()
    const saved = await stored(app, id)
    assert.equal(saved.bars.length, 13)
    assert.equal(firstLine(saved).measures[9]!.items.filter(isNote)[0]!.id, ODE[8]![0], 'bar 10 is the old bar 9')
    assert.equal((await pieceJson(app, id)).bars, 13)
  })
})

test('edit parts: a bar line that would cut a note of the other part is refused, with its explanation, from the scissors in Notes and in Grid', async () => {
  await withApp({ seed: '' }, async (app) => {
    const { page } = app
    const id = await makeDuet(page)
    await openEditor(page, id)
    // The melody's second note: the right hand holds a half-note chord across it.
    await tapNote(page, duetNote('P1', 0, 1, 1))
    await tabs(page, 'Bars').click()
    const refused = 'A note in the right hand sounds across that point, so a bar line cannot go there.'
    await page.getByRole('button', { name: 'Bar line before A4 (2)' }).tap()
    assert.equal(await textOf(page.locator('.editor-message')), refused)
    assert.equal(await page.getByRole('button', { name: 'Undo' }).isDisabled(), true, 'nothing changed')
    // In Grid the scissors stand above the grid: the same mark, the same refusal.
    await page.getByRole('radiogroup', { name: 'View' }).getByRole('radio', { name: 'Grid' }).click()
    await page.locator('.editor-blocks-cutrow .editor-cut').first().waitFor()
    await tabs(page, 'Notes').click()
    await tabs(page, 'Bars').click()
    assert.equal(await page.locator('.editor-message').count(), 0, 'another tab took the message away')
    assert.deepEqual(await cutNames(page), ['Bar line before A4 (2)', 'Bar line before B4 (3)', 'Bar line before C5 (4)'])
    await page.locator('.editor-blocks-cutrow').getByRole('button', { name: 'Bar line before A4 (2)' }).tap()
    assert.equal(await textOf(page.locator('.editor-message')), refused)
    assert.equal(await page.getByRole('button', { name: 'Undo' }).isDisabled(), true, 'nothing changed')
  })
})

// ---- the Bars tools and the suggested repairs (change redesign-score-editor, group 9) ------------------------------

test('edit: Bars: a first and a second ending, a bar added after bar 8 and the old bar 10 deleted; the score, piece.json and the loop follow (tasks 9.1, spec "First and second endings", "Add a bar", "Delete a bar", "Bar numbers follow a bar-line change")', async () => {
  await withApp({ seed: '' }, async (app) => {
    const { page } = app
    const id = await makeOdePiece(page)
    await page.evaluate((pieceId) => window.__test!.shell.library.writePractice(pieceId, { bar: 9, tempo: null, loop: { start: 9, end: 12 }, loopRest: 0, metronome: false }), id)
    await openEditor(page, id)
    await tabs(page, 'Bars').click()
    const { tray, endPressed } = barTools(page)
    const next = async (bar: number) => {
      await page.getByRole('button', { name: 'Next bar' }).click()
      await onBar(page, bar)
    }
    for (const bar of [2, 3, 4]) await next(bar)
    // Bar 4 "1st time only": its bracket, and the end-repeat comes along in the same step.
    await tray.getByRole('button', { name: '1st time only' }).click()
    assert.equal(await tray.getByRole('button', { name: '1st time only' }).getAttribute('aria-pressed'), 'true')
    assert.deepEqual(await endPressed(), ['Repeat'], 'the end-repeat comes along')
    await drawn(page, `${BIG} g.ending`, 1)
    await next(5)
    await tray.getByRole('button', { name: '2nd time only' }).click()
    assert.equal(await tray.getByRole('button', { name: '2nd time only' }).getAttribute('aria-pressed'), 'true')
    // "+ Bar after" bar 8: the new bar 9 is current and empty; the old bar 9 is bar 10.
    for (const bar of [6, 7, 8]) await next(bar)
    await tray.getByRole('button', { name: '+ Bar after' }).click()
    await onBar(page, 9)
    assert.equal(await barRow(page), 'Bar 9 of 13')
    assert.equal(await page.locator(`${BIG} g.note`).count(), 0, 'the added bar holds no note')
    // Delete the old bar 10, now bar 11.
    for (const bar of [10, 11]) await next(bar)
    await tray.getByRole('button', { name: 'Delete bar' }).click()
    await page.locator('.editor-bar-position').filter({ hasText: /^Bar 11 of 12$/ }).waitFor()

    await save(page).click()
    await onScreen(page, 'practice')
    // The loop was bars 9 to 12: the old bar 10 is gone, and the bar added before them moves them on by one.
    await page.getByRole('button', { name: 'Loop 10–12' }).waitFor()
    const saved = await stored(app, id)
    const bars = firstLine(saved).measures
    assert.equal(bars.length, 12)
    assert.deepEqual([bars[3]!.leftBarline?.ending, bars[3]!.rightBarline?.ending, bars[3]!.rightBarline?.repeat], [{ number: '1', type: 'start' }, { number: '1', type: 'stop' }, 'backward'], 'bar 4 is the first ending, with its end-repeat')
    assert.deepEqual([bars[4]!.leftBarline?.ending, bars[4]!.rightBarline?.ending], [{ number: '2', type: 'start' }, { number: '2', type: 'discontinue' }], 'bar 5 the second')
    assert.deepEqual(bars[8]!.items.filter(isNote).map((n) => [n.rest, n.measureRest]), [[true, true]], 'bar 9 is the added bar, a whole-bar rest')
    assert.deepEqual([bars[9]!, bars[10]!, bars[11]!].map((m) => m.items.filter(isNote)[0]!.id), [ODE[8]![0], ODE[10]![0], ODE[11]![0]], 'bars 10 to 12 are the old bars 9, 11 and 12')
    const info = await pieceJson(app, id)
    assert.equal(info.bars, 12)
    assert.deepEqual(info.pages.map((p) => [p.firstBar, p.lastBar]), [[1, 4], [5, 9], [10, 12]], 'the added bar is on the page of bar 8')
    const practice = JSON.parse((await app.file(`pieces/${id}/practice.json`)) ?? '{}') as { bar: number; loop?: { start: number; end: number } }
    assert.deepEqual([practice.bar, practice.loop], [10, { start: 10, end: 12 }])
  })
})

/** A 4/4 piece whose bar 2 is a quarter note E4, an eighth note and a half note: 3½ beats (the spec's "A missed dot"). */
const MISSED_DOT = scoreXml(
  [
    ['C', 'D', 'E', 'F'].map((step) => noteXml({ step, type: 'quarter' })).join(''),
    noteXml({ step: 'E', octave: 4, type: 'quarter' }) + noteXml({ step: 'G', octave: 4, type: 'eighth' }) + noteXml({ step: 'A', octave: 4, type: 'half' }),
    ['C', 'D', 'E', 'F'].map((step) => noteXml({ step, type: 'quarter' })).join(''),
  ],
  [4, 4],
)

test('edit: a bar of 3½ beats offers "E4 (1) → dotted quarter" under the bar row; a tap makes it add up and takes the flag away, and one undo brings both back (task 9.3, spec "Suggested repairs")', async () => {
  await withApp({ seed: '' }, async (app) => {
    const { page } = app
    const id = await page.evaluate(async (xml) => {
      const { platform, shell } = window.__test!
      platform.files.seed('scans/test/page.jpg', Uint8Array.of(0xff, 0xd8, 0xff, 0xe0))
      return (await shell.library.create({ name: 'A missed dot', musicxml: xml, bars: 3, repairs: [], pages: [{ source: 'scans/test/page.jpg', recognised: xml, firstBar: 1, lastBar: 3 }] })).id
    }, MISSED_DOT)
    await openEditor(page, id)
    // The editor opens on the bar to check.
    await onBar(page, 2)
    assert.equal(await textOf(page.locator('.editor-beats')), '3½ of 4 beats')
    const chips = page.getByRole('group', { name: 'Did you mean' })
    assert.deepEqual(await chips.getByRole('button').allInnerTexts(), ['Add an eighth rest at the end', 'E4 (1) → dotted quarter', 'G4 (2) → quarter'])
    await chips.getByRole('button', { name: 'E4 (1) → dotted quarter' }).tap()
    await page.locator('.editor-beats--ok').filter({ hasText: '4 of 4 beats' }).waitFor()
    assert.equal(await warnings(page).count(), 0, 'nothing left to check')
    assert.equal(await chips.count(), 0, 'and nothing to suggest')
    await drawn(page, `${BIG} g.note.mk-flagbar`, 0)
    await drawn(page, `${BIG} g.dots`, 1)
    // One undo: the bar is as it was, flagged, with its suggestions.
    await page.getByRole('button', { name: 'Undo' }).click()
    await page.locator('.editor-beats--off').filter({ hasText: '3½ of 4 beats' }).waitFor()
    assert.match(await textOf(warnings(page)), /^1 to check · Next$/)
    assert.equal(await chips.getByRole('button').count(), 3)
    assert.equal(await page.getByRole('button', { name: 'Undo' }).isDisabled(), true, 'it was one undo step')
  })
})

// ---- the photo line (change redesign-score-editor, task 11.2; design D10, D13; spec "Line from the photo") ------------

/** The page photo of the fixtures (1240 x 1754 pixels, drawn, not of a published score): eight lines of four bars. */
const PAGE_PHOTO = readFileSync(fileURLToPath(new URL('../fixtures/page.jpg', import.meta.url))).toString('base64')
const PAGE_SIZE = { width: 1240, height: 1754 }
/** Where line `k` (from 0) of the fixture photo is, as the reader reports a staff: its five staff lines, as fractions of the photo. */
const photoLine = (k: number) => ({ x: 90 / 1240, y: (220 + 170 * k) / 1754, width: 1062 / 1240, height: 57 / 1754 })

/**
 * Puts the fixture photo in the fake files, as `source`, and makes the fake files give a picture's own bytes as its URL
 * (as the add-music journey does): they name it `fake://…`, which a browser cannot show.
 */
async function realPhoto(page: Page, source: string): Promise<void> {
  await page.evaluate(
    ({ photo, path }) => {
      const files = window.__test!.platform.files
      files.imageUrl = async (file) => URL.createObjectURL(new Blob([new Uint8Array(files.bytes(file)!)], { type: 'image/jpeg' }))
      files.seed(path, Uint8Array.from(atob(photo), (c) => c.charCodeAt(0)))
    },
    { photo: PAGE_PHOTO, path: source },
  )
}

/** "Ode to Joy" on one page of the fixture photo, with its lines: bars 1-4 on line 1, 5-8 on line 2, 9-12 on line 3. */
async function makeEtude(page: Page): Promise<string> {
  await realPhoto(page, 'scans/test/etude.jpg')
  return page.evaluate(
    async ({ xml, lines }) => {
      const staves = lines.map((box, k) => ({ box, firstBar: 4 * k + 1, lastBar: 4 * k + 4 }))
      const page = { source: 'scans/test/etude.jpg', recognised: xml, firstBar: 1, lastBar: 12, staves }
      return (await window.__test!.shell.library.create({ name: 'Etude', musicxml: xml, bars: 12, repairs: [], pages: [page] })).id
    },
    { xml: barsScore(12, 60), lines: [0, 1, 2].map(photoLine) },
  )
}

/** Where a line of the photo (fractions) is drawn on the screen, given where the picture is drawn. */
const drawnAt = (picture: { x: number; y: number; width: number; height: number }, line: { x: number; y: number; width: number; height: number }) => ({
  left: picture.x + line.x * picture.width,
  right: picture.x + (line.x + line.width) * picture.width,
  top: picture.y + line.y * picture.height,
  bottom: picture.y + (line.y + line.height) * picture.height,
})

/** Waits until an image has loaded, and returns its box. */
async function loadedBox(page: Page, locator: ReturnType<Page['locator']>): Promise<{ x: number; y: number; width: number; height: number }> {
  await locator.waitFor()
  await page.waitForFunction((image) => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0, await locator.elementHandle())
  return (await locator.boundingBox())!
}

/** Two fingers, or one, put down at `from`, moved in steps to `to`, and lifted (Chrome's touch input, as a phone sends it). */
async function fingers(page: Page, from: { x: number; y: number }[], to: { x: number; y: number }[]): Promise<void> {
  const cdp = await page.context().newCDPSession(page)
  const points = (t: number) => from.map((p, id) => ({ id, x: p.x + (to[id]!.x - p.x) * t, y: p.y + (to[id]!.y - p.y) * t }))
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(0) })
  for (let step = 1; step <= 6; step++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(step / 6) })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await cdp.detach()
}

test('edit: the photo line is the line of bar 6\'s staff; it opens large on that line, two fingers zoom and one moves it, and Close and the back button close it; a piano part has the "Photo" key, with the whole page where the lines are not known (task 11.2)', async () => {
  await withApp({ seed: '' }, async (app) => {
    const { page } = app
    await openEditor(page, await makeEtude(page))
    await goToBar(page, 6)

    // Above the overview, across the width, 44 px high (a control): line 2 of the page, its middle at the line's middle.
    const strip = page.getByRole('button', { name: 'Photo of bar 6, page 1' })
    const stripBox = (await strip.boundingBox())!
    const overviewBox = (await page.locator('.editor-overview').boundingBox())!
    assert.ok(stripBox.y + stripBox.height <= overviewBox.y, 'above the overview')
    assert.equal(stripBox.height, 44)
    assert.equal(Math.round(stripBox.width), Math.round(overviewBox.width), 'as wide as the overview')
    assert.equal(await page.locator('.editor').getAttribute('data-layout'), 'line', 'with room for the overview as a line')
    assert.ok((await page.locator('.editor-surface').boundingBox())!.height >= 170, 'the large bar keeps its 170 px')
    let staff = drawnAt(await loadedBox(page, strip.locator('img')), photoLine(1))
    assert.ok(Math.abs((staff.top + staff.bottom) / 2 - (stripBox.y + stripBox.height / 2)) < 1, 'the staff of line 2 in the middle')
    assert.ok(staff.top > stripBox.y && staff.bottom < stripBox.y + stripBox.height, `the whole staff in view (${staff.top} to ${staff.bottom})`)
    assert.ok(staff.left > stripBox.x && staff.left < stripBox.x + 15 && staff.right < stripBox.x + stripBox.width && staff.right > stripBox.x + stripBox.width - 15, 'from end to end')
    // Bar 4 is on line 1.
    await page.getByRole('button', { name: 'Previous bar' }).click()
    await page.getByRole('button', { name: 'Previous bar' }).click()
    await onBar(page, 4)
    staff = drawnAt((await page.getByRole('button', { name: 'Photo of bar 4, page 1' }).locator('img').boundingBox())!, photoLine(0))
    assert.ok(Math.abs((staff.top + staff.bottom) / 2 - (stripBox.y + stripBox.height / 2)) < 1, 'bar 4: the staff of line 1')
    await page.getByRole('button', { name: 'Next bar' }).click()
    await page.getByRole('button', { name: 'Next bar' }).click()
    await onBar(page, 6)

    // Large: over the editor, on line 2, larger than across the width, from its left edge, in the middle.
    await page.getByRole('button', { name: 'Photo of bar 6, page 1' }).click()
    const large = page.getByRole('dialog', { name: 'From your photo · bars 5 to 8' })
    const zoom = large.locator('.editor-photo-zoom')
    await zoom.locator('img[style*="translate"]').waitFor()
    const area = (await zoom.boundingBox())!
    const picture = zoom.getByRole('img', { name: 'Photo of page 1' })
    staff = drawnAt((await loadedBox(page, picture))!, photoLine(1))
    // In the middle as far as the page allows: line 2 is high on the page, so the page's top edge is at the top of the view.
    const pictureTop = (await picture.boundingBox())!.y
    assert.ok(Math.abs((staff.top + staff.bottom) / 2 - (area.y + area.height / 2)) < 1 || Math.abs(pictureTop - area.y) < 0.5, 'line 2 in the middle, or the page from its top')
    assert.ok(staff.top > area.y && staff.bottom < area.y + area.height, 'line 2 in view')
    assert.ok(staff.left >= area.x && staff.left < area.x + 30, 'from its left edge')
    assert.ok(staff.bottom - staff.top > 40, `the staff is ${staff.bottom - staff.top} px high, against ${(57 / 1754) * ((await picture.boundingBox())!.height) } now`)
    const scale = Number(await zoom.getAttribute('data-scale'))
    assert.ok(Math.abs(scale - (await picture.boundingBox())!.width / PAGE_SIZE.width) < 0.001, 'the scale is the picture\'s')

    // Two fingers apart zoom in about them: the point between them stays there.
    const middle = { x: area.x + area.width / 2, y: area.y + area.height / 2 }
    const before = (await picture.boundingBox())!
    const held = { x: (middle.x - before.x) / before.width, y: (middle.y - before.y) / before.height }
    await fingers(page, [{ x: middle.x - 40, y: middle.y }, { x: middle.x + 40, y: middle.y }], [{ x: middle.x - 80, y: middle.y }, { x: middle.x + 80, y: middle.y }])
    await page.waitForFunction((s) => Number(document.querySelector('.editor-photo-zoom')!.getAttribute('data-scale')) > s * 1.9, scale)
    const zoomed = (await picture.boundingBox())!
    assert.ok(Math.abs(Number(await zoom.getAttribute('data-scale')) / scale - 2) < 0.05, 'twice as large')
    assert.ok(Math.abs(zoomed.x + held.x * zoomed.width - middle.x) < 2 && Math.abs(zoomed.y + held.y * zoomed.height - middle.y) < 2, 'the point between the fingers stays')
    // One finger moves it.
    await fingers(page, [{ x: middle.x + 60, y: middle.y + 50 }], [{ x: middle.x - 40, y: middle.y + 10 }])
    const moved = (await picture.boundingBox())!
    assert.ok(Math.abs(moved.x - (zoomed.x - 100)) < 2 && Math.abs(moved.y - (zoomed.y - 40)) < 2, `moved with the finger (${moved.x - zoomed.x}, ${moved.y - zoomed.y})`)
    assert.equal(moved.width, zoomed.width, 'without zooming')

    // Close closes it, and the editor is as it was.
    await large.getByRole('button', { name: 'Close' }).click()
    await large.waitFor({ state: 'detached' })
    assert.equal(await barRow(page), 'Bar 6 of 12')
    // The back button closes it first, and stays in the editor.
    await page.getByRole('button', { name: 'Photo of bar 6, page 1' }).click()
    await large.waitFor()
    assert.equal(await app.back(), true)
    await large.waitFor({ state: 'detached' })
    assert.deepEqual(await app.screen(), { name: 'editor', pieceId: await page.locator('.editor').getAttribute('data-piece-id') })
    assert.equal(await barRow(page), 'Bar 6 of 12')
    await page.getByRole('button', { name: 'Back', exact: true }).click()

    // A duet whose page has no positions for its lines: the melody has the photo line, with the whole page, and the
    // overview as bar numbers (design D13: the overview gives way first); the piano, with two staves, has the key.
    await realPhoto(page, 'scans/test/duet.jpg')
    const duet = await page.evaluate(
      async ({ xml }) => (await window.__test!.shell.library.create({ name: 'Duet', musicxml: xml, bars: 8, repairs: [], pages: [{ source: 'scans/test/duet.jpg', recognised: xml, firstBar: 1, lastBar: 8 }] })).id,
      { xml: DUET },
    )
    await openEditor(page, duet)
    const whole = await loadedBox(page, page.getByRole('button', { name: 'Photo of bar 1, page 1' }).locator('img'))
    assert.ok(Math.abs(whole.height - 42) < 1 && Math.abs(whole.width / whole.height - PAGE_SIZE.width / PAGE_SIZE.height) < 0.02, 'the whole page, small')
    await page.locator('.editor[data-layout="numbers"]').waitFor()
    assert.ok((await page.locator('.editor-surface').boundingBox())!.height >= 170, 'the large bar keeps its 170 px')
    await partSwitch(page).getByRole('radio', { name: 'Piano' }).click()
    await page.locator(`${BIG} g.note[id="lc1"]`).waitFor()
    assert.equal(await page.locator('.editor-photo-line').count(), 0, 'no photo line')
    const key = page.locator('.editor-titlebar').getByRole('button', { name: 'Photo of bar 1, page 1' })
    assert.equal(await textOf(key), 'Photo')
    const keyBox = (await key.boundingBox())!
    assert.ok(keyBox.width >= 44 && keyBox.height >= 44, 'a key to touch')
    assert.equal(await page.locator('.editor').getAttribute('data-layout'), 'numbers')
    assert.ok((await page.locator('.editor-surface').boundingBox())!.height >= 170, 'the large bar keeps its 170 px')
    await key.click()
    const page1 = page.getByRole('dialog', { name: 'From your photo · page 1' })
    await page1.locator('img[style*="translate"]').waitFor()
    const all = (await loadedBox(page, page1.getByRole('img', { name: 'Photo of page 1' })))!
    const room = (await page1.locator('.editor-photo-zoom').boundingBox())!
    assert.ok(all.x >= room.x - 0.5 && all.y >= room.y - 0.5 && all.x + all.width <= room.x + room.width + 0.5 && all.y + all.height <= room.y + room.height + 0.5, 'the whole page in view')
    assert.ok(Math.abs(all.width - room.width) < 1, 'as wide as it fits')
    await page1.getByRole('button', { name: 'Close' }).click()
    await page1.waitFor({ state: 'detached' })
  })
})
