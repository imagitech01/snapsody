// The page photo of the store screenshots: Ode to Joy engraved by Verovio (the engine the app uses), on an
// off-white sheet of A4 proportions, shot as a JPEG in headless Chromium. Made at capture time; nothing is committed.

import { chromium } from '../../web/node_modules/playwright/index.mjs'
import createVerovioModule from '../../web/node_modules/verovio/dist/verovio-module.mjs'
import { VerovioToolkit } from '../../web/node_modules/verovio/dist/verovio.mjs'
import { odeScore } from '../../web/test/ui/storePieces.ts'

export const PHOTO_WIDTH = 1240
export const PHOTO_HEIGHT = 1754

export async function makePhoto(): Promise<Buffer> {
  const toolkit = new VerovioToolkit(await createVerovioModule())
  // A4 proportions (1 : 1.414) at about half A4's size in Verovio units, so the notes come out
  // large, as in a beginner's method book, and the 16 bars fill the page instead of its top third.
  toolkit.setOptions({
    scale: 100,
    pageWidth: 1100,
    pageHeight: 1556,
    spacingSystem: 16,
    spacingStaff: 12,
    adjustPageHeight: false,
    breaks: 'auto',
    header: 'auto',
    footer: 'none',
    svgViewBox: true,
    pageMarginLeft: 80,
    pageMarginRight: 80,
    pageMarginTop: 110,
    pageMarginBottom: 110,
  })
  if (!toolkit.loadData(odeScore(1, 16, { title: 'Ode to Joy', composer: 'L. van Beethoven', systemBreaks: true }))) throw new Error('Verovio could not read Ode to Joy')
  const svg = toolkit.renderToSVG(1)
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: { width: PHOTO_WIDTH, height: PHOTO_HEIGHT }, deviceScaleFactor: 1 })
    await page.setContent(
      `<!doctype html><html><body style="margin:0;background:#f4f1ea"><div id="sheet" style="width:${PHOTO_WIDTH}px;height:${PHOTO_HEIGHT}px;background:#f7f4ee;overflow:hidden">${svg.replace('<svg ', '<svg style="width:100%;height:100%;display:block" ')}</div></body></html>`,
    )
    await page.evaluate(() => document.fonts.ready)
    return await page.screenshot({ type: 'jpeg', quality: 90 })
  } finally {
    await browser.close()
  }
}
