// Raw Play Store screenshots of the real web app, in English: node tools/store/capture.ts (from the repo root).
//
// Builds the seeded test build into build/web-test/ (as web/test/ui/run.ts does), engraves the page photo
// (photo.ts) into it as store-photo.jpg, then drives the app in headless Chromium with the UI-test harness
// (web/test/ui/app.ts) at 360 x 780 CSS pixels, device scale factor 3: 1080 x 2340 PNGs in
// build/store/raw/. Pass `--no-build` to reuse the build that is already in build/web-test/ (it needs
// the store seed parts and the photo, which this script writes, so a build made by this script).
// Only the pieces of web/test/ui/storePieces.ts are used (public domain, typed in); nothing from fixtures/local/.

import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Page } from 'playwright'
import { en } from '../../web/src/app/i18n/en.ts'
import { App } from '../../web/test/ui/app.ts'
import { noteIdsByBar } from '../../web/test/ui/journey.ts'
import { BUILD_DIR } from '../../web/test/ui/paths.ts'
import { odeScore, STORE_PIECES } from '../../web/test/ui/storePieces.ts'
import { makePhoto } from './photo.ts'

const WEB = fileURLToPath(new URL('../../web/', import.meta.url))
const OUT = fileURLToPath(new URL('../../build/store/raw/', import.meta.url))
const ODE = STORE_PIECES[0]!

const catalogue: Record<string, unknown> = en
/** A message of the app, with its {placeholders} filled in. */
function text(key: string, params: Record<string, string | number> = {}): string {
  const message = catalogue[key]
  if (typeof message !== 'string') throw new Error(`no plain message ${key}`)
  return message.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name]))
}

function build(): void {
  const result = spawnSync('npx', ['vite', 'build', '--config', 'test/ui/vite.config.ts', '--outDir', BUILD_DIR, '--emptyOutDir', '--logLevel', 'warn'], { cwd: WEB, stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

// ---- Helpers (as in the journeys of web/test/ui) ---------------------------------------------------

/** Runs the clock on in steps until [done] holds (the sound loads in real time, the music in fake time). */
async function until(page: Page, done: () => Promise<boolean>, what: string, step = 100): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (await done()) return
    await page.clock.runFor(step)
    await page.waitForTimeout(5)
  }
  throw new Error(`never: ${what}`)
}

/** Freezes the page's clock where it is: time moves only with `page.clock.runFor`. */
async function freeze(page: Page): Promise<void> {
  const now = await page.evaluate(() => Date.now())
  await page.clock.pauseAt(new Date(now + 10))
}

const highlightedBar = (page: Page): Promise<number | null> =>
  page.evaluate(() => {
    const note = document.querySelector('.score-view g.note.hl')
    const bars = [...document.querySelectorAll('.score-view g.measure')]
    const bar = note ? bars.findIndex((m) => m.contains(note)) : -1
    return bar < 0 ? null : bar + 1
  })

/** The fake files give a placeholder URL for an image; a browser needs a real one to show a page photo. */
const realPhotos = (page: Page): Promise<void> =>
  page.evaluate(() => {
    const files = window.__test!.platform.files
    files.imageUrl = async (path) => URL.createObjectURL(new Blob([new Uint8Array(files.bytes(path)!)], { type: 'image/jpeg' }))
  })

/** The seeded page is served from a folder below the root: serve the instrument sound from the root of the build. */
async function serveSamples(app: App): Promise<void> {
  await app.context.route('https://localhost/test/ui/samples/**', (route) => {
    const file = `${BUILD_DIR}${new URL(route.request().url()).pathname.slice('/test/ui/'.length)}`
    if (!existsSync(file)) return route.fulfill({ status: 404, body: 'Not Found' })
    return route.fulfill({ status: 200, contentType: file.endsWith('.json') ? 'application/json' : 'audio/ogg', body: readFileSync(file) as never })
  })
}

const scoreDrawn = (page: Page) => page.locator('.score-view svg g.note').first().waitFor()

/** Waits for fonts, the score and every image, drops the focus and takes the PNG. */
async function shoot(page: Page, name: string): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready
    ;(document.activeElement as HTMLElement | null)?.blur?.()
    await Promise.all([...document.images].map((img) => (img.complete ? undefined : img.decode().catch(() => undefined))))
  })
  await page.waitForFunction(() => [...document.images].every((img) => img.complete && img.naturalWidth > 0))
  await page.waitForTimeout(300)
  const toasts = await page.locator('[role="status"]:visible, [role="alert"]:visible, .toast:visible').count()
  if (toasts > 0) console.warn(`  note: ${name} has a visible status/alert element (${toasts})`)
  mkdirSync(OUT, { recursive: true })
  await page.screenshot({ path: `${OUT}${name}.png`, animations: 'disabled', caret: 'hide' })
  console.log(`  ${name}.png`)
}

async function start(options: { reader?: 'manual' } = {}): Promise<App> {
  const app = await App.start({ seed: 'store', deviceScaleFactor: 3, ...options })
  await serveSamples(app)
  await realPhotos(app.page)
  return app
}

const tabButton = (page: Page, key: 'tab.practice' | 'tab.library' | 'tab.settings') =>
  page.getByRole('navigation', { name: text('tab.barLabel') }).getByRole('button', { name: text(key), exact: true })

async function openOde(app: App): Promise<void> {
  const { page } = app
  await page.getByRole('region', { name: text('home.continue.title') }).getByRole('button', { name: text('home.continue.action') }).click()
  await page.locator('[data-screen="practice"]').waitFor()
  await scoreDrawn(page)
}

// ---- The screens -----------------------------------------------------------------------------------

async function playAlong(): Promise<void> {
  const app = await start()
  const { page } = app
  try {
    await openOde(app)
    await page.getByRole('button', { name: text('practice.play'), exact: true }).click()
    await page.getByRole('button', { name: text('practice.pause'), exact: true }).waitFor()
    await until(page, async () => (await highlightedBar(page)) !== null, 'a note is highlighted')
    await freeze(page)
    await page.clock.runFor(4200) // 72 BPM: a bar lasts 3.33 s; the music is in bar 6 now
    await until(page, async () => (await highlightedBar(page)) !== null, 'a note is highlighted', 10)
    const bar = await highlightedBar(page)
    if (bar !== 5 && bar !== 6) throw new Error(`play-along: highlight in bar ${bar}, wanted 5 or 6`)
    await page.waitForTimeout(500)
    await shoot(page, '01-play-along')
  } finally {
    await app.close(false)
  }
}

async function reading(): Promise<void> {
  const app = await start({ reader: 'manual' })
  const { page } = app
  try {
    await page.evaluate(async (pages) => {
      const bytes = new Uint8Array(await (await fetch('/store-photo.jpg')).arrayBuffer())
      const { scanner, reader } = window.__test!.platform
      scanner.willReturn([{ bytes }, { bytes }])
      reader.willRead(pages.map((musicxml) => ({ result: 'done' as const, musicxml })))
    }, [odeScore(1, 8), odeScore(9, 16)])
    await page.getByRole('button', { name: text('home.addMusic'), exact: true }).click()
    await page.getByRole('button', { name: text('add.hint.continue'), exact: true }).click()
    await page.getByRole('heading', { name: text('add.reading.page', { page: 1, pages: 2 }), level: 2 }).waitFor()
    // Page 1 is read; page 2 is being read, about half way.
    await page.evaluate(() => {
      const job = window.__test!.platform.reader.jobs.at(-1)!
      while (job.step()) {
        const event = job.delivered.at(-1)!
        if (event.type === 'progress' && event.page === 1 && event.stage === 'prepare') return
      }
    })
    await page.getByRole('heading', { name: text('add.reading.page', { page: 2, pages: 2 }), level: 2 }).waitFor()
    await page.getByRole('img', { name: text('add.reading.pageLabel', { page: 2 }) }).waitFor()
    await shoot(page, '02-reading')
  } finally {
    await app.close(false)
  }
}

async function home(): Promise<void> {
  const app = await start()
  try {
    const { page } = app
    await page.getByRole('heading', { name: text('home.title'), level: 1 }).waitFor()
    await page.getByRole('heading', { name: text('home.rotation.title') }).waitFor()
    await shoot(page, '03-home')
  } finally {
    await app.close(false)
  }
}

async function loop(): Promise<void> {
  const app = await start()
  const { page } = app
  try {
    await openOde(app)
    const slower = page.getByRole('button', { name: text('practice.tempo.slower'), exact: true })
    for (let i = 0; i < 12; i++) await slower.click() // 72 -> 60
    await page.getByRole('button', { name: text('practice.loopOff'), exact: true }).click()
    const sheet = page.getByRole('dialog', { name: text('loop.title') })
    await sheet.waitFor()
    await sheet.getByLabel(text('loop.to'), { exact: true }).selectOption('12')
    await sheet.getByLabel(text('loop.from'), { exact: true }).selectOption('9')
    await sheet.getByLabel(text('loop.to'), { exact: true }).selectOption('12')
    await sheet.getByRole('button', { name: text('loop.set', { from: 9, to: 12 }), exact: true }).click()
    await sheet.waitFor({ state: 'detached' })
    await page.getByRole('button', { name: text('practice.loopOn', { from: 9, to: 12 }), exact: true }).waitFor()
    await scoreDrawn(page)
    await page.waitForTimeout(500)
    await shoot(page, '04-loop')
  } finally {
    await app.close(false)
  }
}

async function editor(): Promise<void> {
  const app = await start()
  const { page } = app
  try {
    await serveSamples(app)
    await page.evaluate((id) => window.__test!.shell.router.push({ name: 'editor', pieceId: id }), ODE.id)
    await page.getByRole('heading', { name: text('editor.title'), level: 1 }).waitFor()
    await page.locator('.score-view[data-rendered="true"]').waitFor()
    const id = noteIdsByBar(odeScore())[5]![2]! // bar 6, note 3
    const note = page.locator(`.score-view svg g.note[id="${id}"]`)
    await note.scrollIntoViewIfNeeded()
    const box = (await note.boundingBox())!
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
    await page.locator('.score-view g.note.mk-sel').waitFor()
    await page.waitForTimeout(600)
    await shoot(page, '05-editor')
  } finally {
    await app.close(false)
  }
}

async function instruments(): Promise<void> {
  const app = await start()
  const { page } = app
  try {
    await tabButton(page, 'tab.settings').click()
    await page.getByRole('heading', { name: text('settings.title'), level: 1 }).waitFor()
    await page.getByRole('button', { name: new RegExp(`^${text('settings.instrument')}`) }).click()
    const group = page.getByRole('dialog').getByRole('radiogroup', { name: text('settings.instrument') })
    await group.waitFor()
    if ((await group.getByRole('radio').count()) !== 7) throw new Error('instrument sheet does not list seven instruments')
    await page.waitForTimeout(700) // the sheet slides in
    await shoot(page, '06-instruments')
  } finally {
    await app.close(false)
  }
}

async function library(): Promise<void> {
  const app = await start()
  const { page } = app
  try {
    await tabButton(page, 'tab.library').click()
    await page.getByRole('heading', { name: text('library.title'), level: 1 }).waitFor()
    await page.waitForTimeout(300)
    await shoot(page, '07-library')
  } finally {
    await app.close(false)
  }
}

// ---- Main ------------------------------------------------------------------------------------------

if (!process.argv.includes('--no-build')) build()
writeFileSync(`${BUILD_DIR}store-photo.jpg`, await makePhoto())
await playAlong()
await reading()
await home()
await loop()
await editor()
await instruments()
await library()
