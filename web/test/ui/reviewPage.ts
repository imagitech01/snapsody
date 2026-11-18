// make ui-review: writes build/ui-review/index.html, each app screen captured by review() beside
// its Figma frame, with an overlay toggle and the deviations recorded in docs/design/deviations.md.
// For review by eye; it never fails.

import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import { DESIGN_DIR, REVIEW_DIR } from './paths.ts'
import { fileName, frames, hasReference } from './review.ts'

/** The size of a PNG file, from its header. */
function pngSize(path: string): { width: number; height: number } | undefined {
  if (!existsSync(path)) return undefined
  const head = readFileSync(path).subarray(0, 24)
  if (head.length < 24) return undefined
  const view = new DataView(head.buffer, head.byteOffset, 24)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

const escape = (text: string) => text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const href = (path: string) => path.split('/').map(encodeURIComponent).join('/')

/** The bullet lines under each "## <frame>" heading of deviations.md. */
function deviations(): Map<string, string[]> {
  const notes = new Map<string, string[]>()
  let current: string[] | undefined
  let item: string | undefined
  for (const line of readFileSync(`${DESIGN_DIR}deviations.md`, 'utf8').split('\n')) {
    const heading = /^## (.+)$/.exec(line)
    if (heading) notes.set(heading[1]!.trim(), (current = []))
    else if (current && /^- /.test(line)) current.push((item = line.slice(2)))
    else if (current && item !== undefined && /^\s+\S/.test(line)) current[current.length - 1] += ` ${line.trim()}`
  }
  return notes
}

mkdirSync(REVIEW_DIR, { recursive: true })
const captured = readdirSync(REVIEW_DIR)
  .filter((name) => name.endsWith('.json'))
  .map((name) => (JSON.parse(readFileSync(REVIEW_DIR + name, 'utf8')) as { frame: string }).frame)
const known = Object.keys(frames()).filter(hasReference)
const names = [...new Set([...captured, ...known])].sort()
const notes = deviations()

const sections = names.map((frame) => {
  const file = fileName(frame)
  const app = existsSync(`${REVIEW_DIR}${file}.png`) ? href(`${file}.png`) : undefined
  const figma = hasReference(frame) ? href(`../../docs/design/figma/${file}.png`) : undefined
  const list = notes.get(frame)
  // The app is captured at the phone's size (360 x 780); the frame is shown at the same height, so that the two compare.
  const appSize = pngSize(`${REVIEW_DIR}${file}.png`)
  const figmaSize = pngSize(`${DESIGN_DIR}figma/${file}.png`)
  const figmaWidth = appSize && figmaSize ? Math.round((appSize.height * figmaSize.width) / figmaSize.height) : undefined
  const appStyle = appSize ? ` style="width:${appSize.width}px"` : ''
  const figmaStyle = figmaWidth ? ` style="width:${figmaWidth}px"` : ''
  const figure = (caption: string, src: string | undefined, missing: string, style = '') =>
    `<figure><figcaption>${caption}</figcaption>${src ? `<img src="${src}"${style} alt="${escape(caption)}: ${escape(frame)}">` : `<div class="missing">${missing}</div>`}</figure>`
  return `<section>
  <h2>${escape(frame)}</h2>
  <label><input type="checkbox" class="toggle"> Overlay (Figma at 50% over the app)</label>
  <div class="pair">
    ${figure(`App (${appSize ? `${appSize.width} × ${appSize.height}` : 'not captured'})`, app, 'No app screenshot: run make test-mac', appStyle)}
    ${figure('Figma', figma, 'no reference', figmaStyle)}
    ${app && figma ? `<figure class="overlay"><figcaption>Overlay</figcaption><div class="stack"${appStyle}><img src="${app}"${appStyle} alt=""><img class="over" src="${figma}" style="height:${appSize?.height ?? 0}px;width:auto" alt=""></div></figure>` : ''}
  </div>
  ${list?.length ? `<ul class="notes">${list.map((n) => `<li>${escape(n).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')}</li>`).join('')}</ul>` : '<p class="notes">No deviations recorded.</p>'}
</section>`
})

writeFileSync(
  `${REVIEW_DIR}index.html`,
  `<!doctype html>
<meta charset="utf-8">
<title>UI review</title>
<style>
  body { font: 14px/1.4 system-ui, sans-serif; margin: 24px; color: #222; background: #fafafa; }
  section { margin-bottom: 40px; }
  .pair { display: flex; gap: 16px; flex-wrap: wrap; align-items: flex-start; }
  figure { margin: 0; }
  figcaption { font-weight: 600; margin-bottom: 4px; }
  img, .missing { max-width: none; border: 1px solid #ccc; background: #fff; }
  .missing { width: 360px; }
  .missing { height: 300px; display: grid; place-items: center; color: #888; }
  .overlay { display: none; }
  section.on .overlay { display: block; }
  .stack { position: relative; }
  .stack img { display: block; }
  .stack .over { position: absolute; top: 0; left: 0; opacity: 0.5; }
  .notes { max-width: 820px; }
</style>
<h1>UI review</h1>
<p>Each screen a journey test names, beside its Figma frame (docs/design/figma/), with the deviations recorded in docs/design/deviations.md. For review by eye; nothing here fails a build.</p>
${sections.join('\n')}
<script>
  for (const toggle of document.querySelectorAll('.toggle'))
    toggle.addEventListener('change', () => toggle.closest('section').classList.toggle('on', toggle.checked));
</script>
`,
)
console.log(`UI review: ${REVIEW_DIR}index.html (${sections.length} screens)`)
