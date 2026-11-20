// Composes the Google Play graphics from the raw app screenshots (tools/store/capture.ts):
//
//   node tools/store/compose.ts
//
// reads    build/store/raw/NN-<screen>.png             (capture.ts)
//          docs/store/listing.md                       (the captions and the feature graphic's line)
//          docs/design/icon/snapsody-icon.svg          (the app icon)
// writes   build/store/play/screenshot-N-<screen>.png   1080 x 1920, one per caption row
//          build/store/play/feature-graphic.png         1024 x 500
//          build/store/play/icon-512.png                512 x 512, 32-bit
//
//          build/store/github/social-preview.png        1280 x 640, the repository's social preview
//
// Each graphic is an HTML page rendered by Playwright's Chromium (web/node_modules). The pages use
// Public Sans, embedded from web/src/ui/fonts/ as a data: URI, so compose needs no network.
// The colours are the app's (web/src/ui/styles/tokens.css). See tools/store/README.md.

import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const RAW = process.env.STORE_RAW ?? join(ROOT, 'build/store/raw')
const OUT = process.env.STORE_OUT ?? join(ROOT, 'build/store/play')
const GITHUB = join(OUT, '..', 'github')
const FONT = join(ROOT, 'web/src/ui/fonts/PublicSans-Variable.woff2')
const WORK = join(ROOT, 'build/store/work')
const LISTING = join(ROOT, 'docs/store/listing.md')
const ICON_SVG = readFileSync(join(ROOT, 'docs/design/icon/snapsody-icon.svg'), 'utf8')

/** The raw screenshots' size (capture.ts: 360 x 780 at 3x), and the status bar drawn above them, in the same pixels (28 dp). */
const SHOT = { width: 1080, height: 2340 }
const STATUS_BAR = 84

const { chromium } = createRequire(join(ROOT, 'web/package.json'))('playwright') as typeof import('playwright')

// ---- The texts, from docs/store/listing.md --------------------------------------------------------

interface Caption { n: number; screen: string; headline: string; subline: string }
interface Texts { captions: Caption[]; feature: string }

/** The listing's English section (the app is English only). */
const SECTION = '## English'

function texts(): Texts {
  const listing = readFileSync(LISTING, 'utf8')
  const start = listing.indexOf(SECTION)
  if (start < 0) throw new Error(`${LISTING}: no section "${SECTION}"`)
  const rest = listing.slice(start)
  const end = rest.indexOf('\n---', 1)
  const section = end < 0 ? rest : rest.slice(0, end)
  const captions = section.split('\n')
    .map((line) => line.match(/^\|\s*(\d+)\s*\|\s*([a-z-]+)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|$/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => ({ n: Number(m[1]), screen: m[2]!, headline: m[3]!, subline: m[4]! }))
  const feature = section.match(/^Feature graphic: "(.+)"$/m)?.[1]
  if (captions.length === 0 || !feature) throw new Error(`${LISTING}: no captions or feature line`)
  return { captions, feature }
}

// ---- The look ---------------------------------------------------------------------------------------

const html = (body: string, width: number, height: number, extraCss = '') => `<!doctype html>
<html><head><meta charset="utf-8">
<style>
  @font-face {
    font-family: 'Public Sans'; font-style: normal; font-weight: 400 700; font-display: block;
    src: url(data:font/woff2;base64,${readFileSync(FONT).toString('base64')}) format('woff2');
  }
  :root {
    --bg: #f1f3f6; --surface: #ffffff; --ink: #1c2433; --ink-muted: #5c6472; --line: #d6dbe3; --primary: #2c5bbf;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: ${width}px; height: ${height}px; overflow: hidden; }
  body {
    font-family: 'Public Sans', system-ui, sans-serif; color: var(--ink); -webkit-font-smoothing: antialiased;
    background: var(--bg); position: relative;
  }
  .staff { position: absolute; left: 0; right: 0; display: flex; flex-direction: column; }
  .staff i { display: block; height: 3px; background: var(--line); opacity: 0.7; }
  .phone {
    position: absolute; background: var(--ink); border-radius: 68px; padding: 16px;
    box-shadow: 0 40px 80px rgba(28, 36, 51, 0.22), 0 0 0 1.5px var(--line);
  }
  .phone img { display: block; width: 100%; border-radius: 54px; }
  /* A screen: a status bar (filled in the colour of the screenshot's top edge) over the screenshot. */
  .screen { height: 100%; aspect-ratio: ${SHOT.width} / ${SHOT.height + STATUS_BAR}; border-radius: 54px; overflow: hidden; display: flex; flex-direction: column; }
  .screen img { border-radius: 0; }
  .statusbar {
    flex: none; height: ${(STATUS_BAR / (SHOT.height + STATUS_BAR)) * 100}%; display: flex; align-items: center; justify-content: space-between;
    padding: 0 7% 0 8%; color: var(--ink); font-size: 21px; font-weight: 600; font-variant-numeric: tabular-nums;
  }
  .statusbar .battery { width: 34px; height: 17px; border: 2.5px solid currentColor; border-radius: 5px; padding: 2px; opacity: 0.85; }
  .statusbar .battery i { display: block; height: 100%; width: 80%; background: currentColor; border-radius: 1.5px; }
  .icon svg { display: block; }
  ${extraCss}
</style></head><body>${body}</body></html>`

/** Five faint staff lines across the background, from [left] to the right edge. */
const staff = (top: number, gap: number, left = 0) =>
  `<div class="staff" style="top:${top}px; gap:${gap}px; left:${left}px">${'<i></i>'.repeat(5)}</div>`

/** One 1080 x 1920 screenshot: the caption on top, the phone filling the space below it. */
function screenshotPage(caption: Caption, shot: string): string {
  return html(`
    ${staff(1010, 64)}
    <header>
      <h1>${caption.headline}</h1>
      <p>${caption.subline}</p>
    </header>
    <div class="stage">
      <div class="phone">
        <div class="screen">
          <div class="statusbar"><span>10:00</span><span class="battery"><i></i></span></div>
          <img src="${shot}">
        </div>
      </div>
    </div>
    <script>
      // The status bar takes the colour of the screenshot's top edge (the screen, or a dimmed screen under a sheet).
      const img = document.querySelector('.screen img')
      const paint = () => {
        const canvas = document.createElement('canvas')
        canvas.width = img.naturalWidth; canvas.height = 8
        const context = canvas.getContext('2d')
        context.drawImage(img, 0, 0)
        const [r, g, b] = context.getImageData(Math.floor(img.naturalWidth / 2), 2, 1, 1).data
        document.querySelector('.statusbar').style.background = \`rgb(\${r}, \${g}, \${b})\`
      }
      img.complete ? paint() : img.addEventListener('load', paint)
    </script>`, 1080, 1920, `
    body { display: flex; flex-direction: column; }
    header { position: relative; padding: 112px 80px 0; text-align: center; }
    h1 { font-size: 78px; line-height: 1.06; font-weight: 700; letter-spacing: -0.02em; text-wrap: balance; }
    p { margin-top: 24px; font-size: 38px; line-height: 1.3; font-weight: 500; color: var(--ink-muted); text-wrap: balance; }
    .stage { position: relative; flex: 1; min-height: 0; display: flex; justify-content: center; padding: 60px 0 70px; }
    .stage .phone { position: relative; height: 100%; }`)
}

/** The 1024 x 500 feature graphic: icon, name and line on the left, two phones on the right. */
function featurePage(line: string, front: string, back: string): string {
  const icon = ICON_SVG.replace('<svg ', '<svg width="132" height="132" ')
  return html(`
    ${staff(160, 34, 540)}
    <div class="brand">
      <div class="icon">${icon}</div>
      <h1>Snapsody</h1>
      <p>${line}</p>
    </div>
    <div class="phone back" style="width:250px; left:590px; top:118px"><img src="${back}"></div>
    <div class="phone front" style="width:270px; left:735px; top:60px"><img src="${front}"></div>`, 1024, 500, `
    .brand { position: absolute; left: 64px; top: 0; bottom: 0; width: 470px; display: flex; flex-direction: column; justify-content: center; }
    .icon svg { border-radius: 30px; box-shadow: 0 14px 30px rgba(28, 36, 51, 0.2); }
    h1 { margin-top: 30px; font-size: 64px; font-weight: 700; letter-spacing: -0.02em; line-height: 1; }
    p { margin-top: 16px; font-size: 30px; line-height: 1.25; font-weight: 500; color: var(--ink-muted); text-wrap: balance; }
    .phone { border-radius: 34px; padding: 8px; box-shadow: 0 24px 50px rgba(28, 36, 51, 0.25), 0 0 0 1px var(--line); }
    .phone img { border-radius: 27px; }
    .back { transform: rotate(-7deg); }
    .front { transform: rotate(4deg); }`)
}

/** The 1280 x 640 GitHub social preview: icon, name and line on the left, two phones on the right. */
function socialPage(line: string, front: string, back: string): string {
  const icon = ICON_SVG.replace('<svg ', '<svg width="150" height="150" ')
  return html(`
    ${staff(210, 42, 600)}
    <div class="brand">
      <div class="icon">${icon}</div>
      <h1>Snapsody</h1>
      <p>${line}</p>
    </div>
    <div class="phone back" style="width:300px; left:700px; top:150px"><img src="${back}"></div>
    <div class="phone front" style="width:330px; left:880px; top:80px"><img src="${front}"></div>`, 1280, 640, `
    .brand { position: absolute; left: 80px; top: 0; bottom: 0; width: 540px; display: flex; flex-direction: column; justify-content: center; }
    .icon svg { border-radius: 34px; box-shadow: 0 14px 30px rgba(28, 36, 51, 0.2); }
    h1 { margin-top: 34px; font-size: 80px; font-weight: 700; letter-spacing: -0.02em; line-height: 1; }
    p { margin-top: 20px; font-size: 34px; line-height: 1.25; font-weight: 500; color: var(--ink-muted); text-wrap: balance; }
    .phone { border-radius: 40px; padding: 10px; box-shadow: 0 24px 50px rgba(28, 36, 51, 0.25), 0 0 0 1px var(--line); }
    .phone img { border-radius: 31px; }
    .back { transform: rotate(-7deg); }
    .front { transform: rotate(4deg); }`)
}

/** The 512 x 512 icon, full bleed (Play rounds it), with an alpha channel as Play asks. */
function iconPage(): string {
  const square = ICON_SVG.replace(/rx="24"/, 'rx="0"').replace('<svg ', '<svg width="512" height="512" ')
  return `<!doctype html><html><head><style>*{margin:0} body{width:512px;height:512px;background:transparent}</style></head><body>${square}</body></html>`
}

// ---- Rendering ----------------------------------------------------------------------------------------

function rawShots(): Map<string, string> {
  const dir = RAW
  if (!existsSync(dir)) throw new Error(`no raw screenshots in ${dir}: run node tools/store/capture.ts first`)
  const shots = new Map<string, string>()
  for (const file of readdirSync(dir)) {
    const m = file.match(/^\d+-([a-z-]+)\.png$/)
    if (m) shots.set(m[1]!, join(dir, file))
  }
  return shots
}

const browser = await chromium.launch()
const page = await browser.newPage({ deviceScaleFactor: 1 })

async function render(markup: string, name: string, width: number, height: number, out: string, transparent = false): Promise<void> {
  mkdirSync(WORK, { recursive: true })
  mkdirSync(dirname(out), { recursive: true })
  const file = join(WORK, `${name}.html`)
  writeFileSync(file, markup)
  await page.setViewportSize({ width, height })
  await page.goto(pathToFileURL(file).href)
  await page.evaluate(async () => {
    await document.fonts.ready
    await Promise.all([...document.images].map((img) => img.complete ? null : new Promise((done) => { img.onload = img.onerror = done })))
  })
  await page.screenshot({ path: out, omitBackground: transparent })
  console.log(`${out.slice(ROOT.length + 1)}  ${width}x${height}`)
}

try {
  const { captions, feature } = texts()
  const shots = rawShots()
  const shot = (screen: string) => {
    const path = shots.get(screen)
    if (!path) throw new Error(`no raw screenshot "${screen}" in ${RAW}`)
    // A data: URL, so the page may read its pixels (file: images taint the canvas).
    return `data:image/png;base64,${readFileSync(path).toString('base64')}`
  }
  for (const caption of captions) {
    await render(screenshotPage(caption, shot(caption.screen)), `screenshot-${caption.n}`, 1080, 1920,
      join(OUT, `screenshot-${caption.n}-${caption.screen}.png`))
  }
  await render(featurePage(feature, shot('play-along'), shot('reading')), 'feature', 1024, 500,
    join(OUT, 'feature-graphic.png'))
  await render(socialPage('Snap your sheet music. Hear it. Play along.', shot('play-along'), shot('reading')), 'social', 1280, 640,
    join(GITHUB, 'social-preview.png'))
  await render(iconPage(), 'icon', 512, 512, join(OUT, 'icon-512.png'), true)
} finally {
  await browser.close()
}
