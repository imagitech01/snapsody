import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Page } from 'playwright'
import { PHONE, PHONE_LANDSCAPE, withApp } from './app.ts'
import { ID } from './pieces.ts'

// The density guard (practice-app design D18, task 11.4): the app at a typical phone WebView size (360 x 780 CSS px, and on its
// side 780 x 360), shows every main screen and sheet without sideways scroll, and every control
// that is tapped has a touch box of at least 44 x 44. The screens are opened through the router, as the journeys of the
// edit tests do; what each screen does is tested in its own journey.

/**
 * Controls that are allowed to be smaller than 44 x 44, each with its reason. A control that looks small gets its 44 from
 * padding or from a larger hit area instead (the toggle's button is 44 x 44 around its 36 x 22 track), so this list is
 * meant to stay empty.
 */
const EXCEPTIONS: readonly { selector: string; reason: string }[] = []

const VIEWPORTS = [
  { name: 'portrait 360 x 780', size: PHONE },
  { name: 'landscape 780 x 360', size: PHONE_LANDSCAPE },
] as const

interface Finding {
  kind: 'overflow' | 'sticks-out' | 'touch-box'
  what: string
  detail: string
}

/** Looks at the page as it is and returns what breaks the two rules (runs in the page). */
async function audit(page: Page, exceptions: readonly string[]): Promise<Finding[]> {
  return page.evaluate((exceptionSelectors) => {
    const found: Finding[] = []
    const width = document.documentElement.clientWidth
    const describe = (element: Element): string => {
      const label = element.getAttribute('aria-label') ?? (element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40)
      return `<${element.tagName.toLowerCase()}${element.className && typeof element.className === 'string' ? `.${element.className.trim().split(/\s+/).join('.')}` : ''}> "${label}"`
    }
    const shown = (element: Element): boolean => {
      const rect = element.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return false
      const style = getComputedStyle(element)
      return style.visibility !== 'hidden' && style.display !== 'none'
    }

    // 1. The page does not scroll sideways.
    for (const element of [document.documentElement, document.body, ...document.querySelectorAll('.app, .app-main, [data-screen], .screen, .screen-body, .sheet')]) {
      if (element.scrollWidth > element.clientWidth + 0.5 && getComputedStyle(element).overflowX === 'visible')
        found.push({ kind: 'overflow', what: describe(element), detail: `scrollWidth ${element.scrollWidth} > clientWidth ${element.clientWidth}` })
    }

    // 2. No visible element sticks out past the right edge, unless an ancestor that is inside the window clips it.
    const clipped = (element: Element): boolean => {
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent)
        if (style.overflowX !== 'visible' && parent.getBoundingClientRect().right <= width + 0.5) return true
      }
      return false
    }
    for (const element of document.querySelectorAll('body *')) {
      if (element.closest('svg') && element.tagName.toLowerCase() !== 'svg') continue
      const rect = element.getBoundingClientRect()
      if (rect.right <= width + 0.5 || !shown(element) || getComputedStyle(element).clipPath !== 'none' || clipped(element)) continue
      found.push({ kind: 'sticks-out', what: describe(element), detail: `right edge ${Math.round(rect.right)} > ${width}` })
    }

    // 3. Every control has a touch box of at least 44 x 44.
    const controls = 'button, a[href], [role="button"], [role="tab"], [role="switch"], [role="radio"], select, input:not([type="hidden"])'
    for (const element of document.querySelectorAll(controls)) {
      if (!shown(element) || exceptionSelectors.some((selector) => element.matches(selector))) continue
      const rect = element.getBoundingClientRect()
      if (rect.width < 43.5 || rect.height < 43.5) found.push({ kind: 'touch-box', what: describe(element), detail: `${rect.width.toFixed(1)} x ${rect.height.toFixed(1)}` })
    }
    return found
  }, exceptions)
}

/** Looks at the screen and adds what it finds to [problems], named by [where]; the test fails at its end with all of them. */
async function check(page: Page, where: string, problems: string[]): Promise<void> {
  for (const f of await audit(page, EXCEPTIONS.map((e) => e.selector))) problems.push(`${where}: ${f.kind}: ${f.what} (${f.detail})`)
}

type RouterMethod = 'selectTab' | 'push' | 'openSheet' | 'closeSheet'
/** Calls a method of the app's router, as a button would. */
const go = (page: Page, method: RouterMethod, arg: unknown): Promise<void> =>
  page.evaluate(([m, a]) => (window.__test!.shell.router as unknown as Record<string, (x: unknown) => void>)[m as string]!(a), [method, arg] as const)
const settle = (page: Page): Promise<void> => page.waitForTimeout(450) // a sheet's slide-in is 220 ms; the score lays out after 150

// Public Sans is bundled (design D4): once the app has started, the font has loaded from the app's own origin.
test('the bundled Public Sans loads from the app itself', async () => {
  await withApp({ seed: 'library', viewport: PHONE }, async ({ page }) => {
    await page.locator('.home-rotation .list-row').first().waitFor()
    const loaded = await page.evaluate(async () => {
      await document.fonts.ready
      return document.fonts.check('16px "Public Sans"')
    })
    assert.equal(loaded, true)
  })
})

for (const viewport of VIEWPORTS) {
  {
    test(`density: every screen and sheet at ${viewport.name} has no sideways scroll and no touch box under 44 x 44`, async () => {
      const at = (screen: string): string => `${screen} (${viewport.name})`
      const problems: string[] = []

      await withApp({ seed: 'library', viewport: viewport.size }, async ({ page }) => {
        await page.locator('.home-rotation .list-row').first().waitFor()
        await check(page, at('home'), problems)

        await go(page, 'selectTab', 'library')
        await page.locator('.library-section .list-row').first().waitFor()
        await check(page, at('library'), problems)

        // The confirmation of a delete.
        await page.locator('.list-row-trailing .icon-button--quiet').first().click()
        await page.getByRole('alertdialog').waitFor()
        await settle(page)
        await check(page, at('delete confirmation'), problems)
        await page.getByRole('alertdialog').locator('button').first().click()
        await page.getByRole('alertdialog').waitFor({ state: 'detached' })

        await go(page, 'push', { name: 'favorites' })
        await page.locator('.favorites-section').first().waitFor()
        await check(page, at('favorites'), problems)

        await go(page, 'selectTab', 'settings')
        await page.locator('.settings-section').first().waitFor()
        await check(page, at('settings'), problems)
        // Its list, one sheet (design D19).
        for (const sheet of ['instrument'] as const) {
          await go(page, 'openSheet', sheet)
          await page.getByRole('dialog').waitFor()
          await settle(page)
          await check(page, at(`${sheet} sheet`), problems)
          await go(page, 'closeSheet', sheet)
          await page.getByRole('dialog').waitFor({ state: 'detached' })
        }

        // Practice, and its two sheets.
        await go(page, 'push', { name: 'practice', pieceId: ID.ode })
        await page.locator('.score-view svg g.note').first().waitFor()
        await settle(page)
        await check(page, at('practice'), problems)
        await go(page, 'openSheet', 'loop')
        await page.getByRole('dialog').waitFor()
        await settle(page)
        await check(page, at('loop sheet'), problems)
        await go(page, 'closeSheet', 'loop')
        await page.getByRole('dialog').waitFor({ state: 'detached' })
        await go(page, 'openSheet', 'tools')
        await page.getByRole('dialog').waitFor()
        await settle(page)
        await check(page, at('tools sheet'), problems)
        await go(page, 'closeSheet', 'tools')
        await page.getByRole('dialog').waitFor({ state: 'detached' })

        // The editor: its three tabs.
        await go(page, 'push', { name: 'editor', pieceId: ID.ode })
        await page.locator('.score-view[data-rendered="true"]').waitFor()
        await settle(page)
        const tabs = page.locator('.editor-tools [role="radio"]')
        assert.equal(await tabs.count(), 3)
        for (const [index, name] of ['notes', 'marks', 'score settings'].entries()) {
          await tabs.nth(index).click()
          await settle(page)
          await check(page, at(`editor, ${name}`), problems)
        }
      })

      // A phone with no music yet: the invitation, the empty library, and the hint before the scanner.
      await withApp({ seed: '', viewport: viewport.size }, async ({ page }) => {
        await page.locator('.invite-title').waitFor()
        await check(page, at('first launch'), problems)
        await go(page, 'selectTab', 'library')
        await page.locator('.library-empty, .invite-title').first().waitFor()
        await check(page, at('empty library'), problems)
        await go(page, 'push', { name: 'add-music' })
        await page.locator('[data-screen="add-music"]').waitFor()
        await settle(page)
        await check(page, at('add music'), problems)
      })

      assert.deepEqual(problems, [])
    })
  }
}
