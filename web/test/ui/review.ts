// Design review against Figma (openspec test-pyramid design T4): a journey step can name the Figma
// frame its screen implements. The screen is then also captured at the user's phone size (360 x 780, or 780 x 360
// for a landscape frame; design D18) with the safe areas the frames leave for the phone's bars, into build/ui-review/,
// where `make ui-review` puts it beside the frame (scaled to the same height). This is for review by eye
// only: it never fails a test, and it does nothing unless UI_REVIEW is set, which only
// `make ui-review` does, so the test layers run the journeys without resizing or waiting.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import type { Page } from 'playwright'
import { PHONE, PHONE_LANDSCAPE } from './app.ts'
import { DESIGN_DIR, REVIEW_DIR } from './paths.ts'

/**
 * What the frames leave for the phone's own bars: by default a 48px status bar and a 26px strip under the tab bar.
 * A frame that leaves something else says so in frames.json (`safeTop`, `safeBottom`: the landscape frame has no
 * status bar). The headless browser has no system bars (the safe areas are 0), so the capture sets them to the
 * frame's, and the overlay on the frame lines up.
 */
const DEFAULT_SAFE = { top: 48, bottom: 26 }

interface Frame {
  nodeId: string
  width: number
  height: number
  safeTop?: number
  safeBottom?: number
}

/** The frames recorded in docs/design/figma/frames.json. */
export function frames(): Record<string, Frame> {
  return (JSON.parse(readFileSync(`${DESIGN_DIR}figma/frames.json`, 'utf8')) as { frames: Record<string, Frame> }).frames
}

/** A file name for a frame name (names hold "·" and "—", which are kept). */
export const fileName = (frame: string) => frame.replace(/[/\\:*?"<>|]/g, '_')

/**
 * Captures the current screen for comparison with the Figma frame [frame], at the S24's WebView size (design D18):
 * 360×780, or 780×360 when the frame is landscape (frames.json); then restores the viewport. The frame's own size
 * only decides which of the two, and the safe areas.
 */
export async function review(page: Page, frame: string): Promise<void> {
  // Only for make ui-review: in the test layers a journey runs without resizing or waiting.
  if (!process.env.UI_REVIEW) return
  try {
    const size: Frame = frames()[frame] ?? { nodeId: '', width: 400, height: 900 }
    const before = page.viewportSize()
    await page.setViewportSize(size.width > size.height ? PHONE_LANDSCAPE : PHONE)
    // Screens scroll inside themselves, and a journey may have left one scrolled: the frame shows the top.
    await page.evaluate(() => {
      window.scrollTo(0, 0)
      for (const element of document.querySelectorAll('*')) if (element.scrollTop > 0) element.scrollTop = 0
    })
    const safeAreas = await page.addStyleTag({ content: `:root { --safe-top: ${size.safeTop ?? DEFAULT_SAFE.top}px; --safe-bottom: ${size.safeBottom ?? DEFAULT_SAFE.bottom}px; }` })
    await page.waitForTimeout(400) // the score re-lays out after a width change (150 ms debounce)
    mkdirSync(REVIEW_DIR, { recursive: true })
    writeFileSync(`${REVIEW_DIR}${fileName(frame)}.png`, await page.screenshot())
    writeFileSync(`${REVIEW_DIR}${fileName(frame)}.json`, JSON.stringify({ frame, url: page.url() }))
    await safeAreas.evaluate((element) => (element as Element).remove())
    if (before) await page.setViewportSize(before)
    await page.waitForTimeout(400)
  } catch (error) {
    console.warn(`design review: no screenshot for '${frame}': ${error instanceof Error ? error.message : String(error)}`)
  }
}

export const hasReference = (frame: string) => existsSync(`${DESIGN_DIR}figma/${fileName(frame)}.png`)
