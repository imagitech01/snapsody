// Runs the built web app in headless Chromium as the Capacitor WebView would (openspec
// test-pyramid design T4, practice-app D15): the same build, served at Capacitor's local origin, a
// phone-sized touch screen, page.clock for timers and Date, and a test AudioContext whose clock
// follows page.clock.
//
// Two ways to start the app (practice-app groups 12 onwards):
//  - `App.start()`: the app's own entry, `/`, as the phone runs it (main.tsx, with the browser-dev platform);
//  - `App.start({ seed })`: the test entry, test/ui/seeded.html: the same `mount` on the fake platform, with
//    the files a seed names (seeds.ts). The journeys use this one. The fake platform, the shell and
//    the device's events are then reachable with `back()`, `pause()`, `resume()`, `screen()` and `file()`.

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { BUILD_DIR } from './paths.ts'

/** Where Capacitor serves the app from on the phone (https://localhost). */
export const HOST = 'localhost'
export const START_URL = `https://${HOST}/`

/** The Galaxy S24's CSS viewport as its WebView reports it (360 x 780, evidence/device-checks.md), and turned on its side. */
export const PHONE = { width: 360, height: 780 }
export const PHONE_LANDSCAPE = { width: 780, height: 360 }

/** Fixed start of page.clock, so dates in the UI are the same on every run. */
export const CLOCK_START = new Date('2026-11-18T10:00:00Z')

// The MIME types Capacitor's local server gives the app's files.
const MIME: Record<string, string> = {
  html: 'text/html', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css', json: 'application/json',
  wasm: 'application/wasm', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  mp3: 'audio/mpeg', ogg: 'audio/ogg', flac: 'audio/flac', wav: 'audio/wav', woff2: 'font/woff2', txt: 'text/plain',
}

/**
 * Runs in the page before its own scripts: an AudioContext whose currentTime follows
 * performance.now() (which page.clock controls) instead of the audio hardware, with no output
 * latency.
 */
function pageSetup(): void {
  const Real = window.AudioContext
  class TestAudioContext extends Real {
    private startedAt = performance.now()
    private frozenAt: number | null = null
    override get currentTime(): number {
      return this.frozenAt ?? (performance.now() - this.startedAt) / 1000
    }
    override get outputLatency(): number {
      return 0
    }
    override get baseLatency(): number {
      return 0
    }
    override async suspend(): Promise<void> {
      this.frozenAt = this.currentTime
      await super.suspend()
    }
    override async resume(): Promise<void> {
      await super.resume()
      if (this.frozenAt !== null) {
        this.startedAt = performance.now() - this.frozenAt * 1000
        this.frozenAt = null
      }
    }
  }
  window.AudioContext = TestAudioContext
}

/** The test entry: the app on the fake platform (seeded.tsx). */
export const SEEDED = 'test/ui/seeded.html'

export interface AppOptions {
  /**
   * Start the test entry with these seed parts (seeds.ts; '' for an empty phone) instead of the app's own entry.
   * The fake files survive `reload()`; they are gone with the app.
   */
  seed?: string
  /** What the fake device says its language is (the seeded entry only); English by default. */
  language?: string
  /** `manual`: the fake reader's jobs send their events only when the journey steps them (the seeded entry only). */
  reader?: 'manual'
  /** Viewport; the S24's by default. */
  viewport?: { width: number; height: number }
  /** What to open instead of the app, as a path under the build, e.g. the component gallery (GALLERY). */
  path?: string
}

/** The component gallery (web/dev/gallery.html), in the test build only. `?view=` picks one part of it. */
export const GALLERY = 'dev/gallery.html'

/** One app session: a fresh browser context, at the app's start URL. */
export class App {
  private readonly browser: Browser
  readonly context: BrowserContext
  readonly page: Page
  readonly pageErrors: string[]
  /** Whether this is the test entry, which has the hooks. */
  private readonly seeded: boolean

  private constructor(browser: Browser, context: BrowserContext, page: Page, pageErrors: string[], seeded: boolean) {
    this.browser = browser
    this.context = context
    this.page = page
    this.pageErrors = pageErrors
    this.seeded = seeded
  }

  static async start(options: AppOptions = {}): Promise<App> {
    assert.ok(existsSync(`${BUILD_DIR}index.html`), `no web build in ${BUILD_DIR}: run the UI tests with npm run test:ui`)
    // No smooth scrolling: it runs on the compositor's clock, not page.clock, and would move notes under a tap.
    const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--disable-smooth-scrolling'] })
    const context = await browser.newContext({
      viewport: options.viewport ?? PHONE,
      hasTouch: true,
      isMobile: true,
      deviceScaleFactor: 1,
      locale: 'en-GB',
      timezoneId: 'Europe/Brussels',
    })
    const page = await context.newPage()
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))

    // The app is offline: its own origin is served from the build, all else is refused.
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url())
      if (url.host !== HOST) return route.abort('blockedbyclient')
      const path = url.pathname === '/' ? 'index.html' : url.pathname.slice(1)
      const file = `${BUILD_DIR}${path}`
      if (path.includes('..') || !existsSync(file)) return route.fulfill({ status: 404, body: 'Not Found' })
      const extension = file.split('.').pop()!.toLowerCase()
      return route.fulfill({ status: 200, contentType: MIME[extension] ?? 'application/octet-stream', body: readFileSync(file) as never })
    })

    await page.addInitScript(pageSetup)
    await page.clock.install({ time: CLOCK_START })
    const seeded = options.seed !== undefined
    const app = new App(browser, context, page, pageErrors, seeded)
    if (seeded) {
      const query = new URLSearchParams({ seed: options.seed! })
      if (options.language) query.set('language', options.language)
      if (options.reader) query.set('reader', options.reader)
      await page.goto(`${START_URL}${options.path ?? SEEDED}?${query}`)
      await page.waitForFunction(() => window.__test !== undefined)
    } else {
      await page.goto(options.path ? `${START_URL}${options.path}` : START_URL)
    }
    return app
  }

  /** Reloads the page, as when the activity is recreated. A seeded app keeps its files, as the phone does. */
  async reload(): Promise<void> {
    if (this.seeded) await this.page.evaluate(() => window.__test!.snapshot())
    await this.page.reload()
    if (this.seeded) await this.page.waitForFunction(() => window.__test !== undefined)
  }

  // ---- The seeded app's hooks (seeded.tsx) ---------------------------------------------------

  /** The user presses the system back button; whether the app dealt with it (false: the phone would leave the app). */
  back(): Promise<boolean> {
    return this.page.evaluate(() => window.__test!.platform.device.pressBack())
  }

  /** The app goes to the background. */
  pause(): Promise<void> {
    return this.page.evaluate(() => window.__test!.platform.device.pause())
  }

  /** The app comes back to the foreground. */
  resume(): Promise<void> {
    return this.page.evaluate(() => window.__test!.platform.device.resume())
  }

  /** The screens of the router's stack, the first to the top one. */
  stack(): Promise<unknown[]> {
    return this.page.evaluate(() => [...window.__test!.shell.router.stack.value])
  }

  /** The screen on top of the router's stack. */
  async screen(): Promise<{ name: string; pieceId?: string; autoplay?: boolean }> {
    return (await this.stack()).at(-1) as { name: string; pieceId?: string; autoplay?: boolean }
  }

  /** The text of a file in the fake files, or undefined when there is none. */
  file(path: string): Promise<string | undefined> {
    return this.page.evaluate((p) => window.__test!.platform.files.text(p), path)
  }

  /** Every file path in the fake files. */
  filePaths(): Promise<string[]> {
    return this.page.evaluate(() => window.__test!.platform.files.paths())
  }

  /** Closes the browser, then (with [check]) fails on any uncaught page error. */
  async close(check = true): Promise<void> {
    await this.browser.close()
    if (!check) return
    assert.deepEqual(this.pageErrors, [], 'uncaught errors in the page')
  }
}

/** Runs [fn] with a started app and always closes it. */
export async function withApp(options: AppOptions, fn: (app: App) => Promise<void>): Promise<void> {
  const app = await App.start(options)
  try {
    await fn(app)
  } catch (error) {
    await app.close(false)
    throw error
  }
  await app.close()
}
