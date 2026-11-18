#!/usr/bin/env node
// Crackle check in the real decoder and looper: renders every note of every sample folder looping in
// headless Chromium's Web Audio (a 48 kHz offline context), entering at sustainStart as a slurred note
// does, and compares the second difference at each loop wrap with its 99th percentile elsewhere.
//   node tools/samples/check_wraps.mjs [web/public/samples]     (needs `npm ci` in web/ for Playwright)
// A ratio near or below 2 means the wrap is as smooth as the rest of the sound; notes over 4 are listed.
// Notes without a loop (a set with "attack": "always": piano, guitar) play once and are not checked here.
// Complements check_loops.py (which reads the decoded file) by including Chromium's own decode and loop.
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const { chromium } = await import(join(here, '../../web/node_modules/playwright/index.mjs'))
const root = resolve(process.argv[2] ?? join(here, '../../web/public/samples'))
const browser = await chromium.launch()
const page = await browser.newPage()
await page.setContent('<html></html>')

for (const set of readdirSync(root).filter((n) => !n.startsWith('.')).sort()) {
  const map = JSON.parse(readFileSync(join(root, set, 'map.json'), 'utf8'))
  const items = Object.entries(map.notes).filter(([, e]) => e.sustainStart !== undefined).map(([key, e]) => ({
    key, start: e.sustainStart, end: e.sustainEnd, b64: readFileSync(join(root, set, e.file)).toString('base64'),
  }))
  if (items.length === 0) {
    console.log(`${set}: no loops (every note plays once), nothing to check`)
    continue
  }
  const result = await page.evaluate(async (items) => {
    const out = []
    for (const it of items) {
      const bytes = Uint8Array.from(atob(it.b64), (c) => c.charCodeAt(0))
      const ctx = new OfflineAudioContext(1, 48000 * 6, 48000)
      const buffer = await ctx.decodeAudioData(bytes.buffer)
      const src = ctx.createBufferSource()
      src.buffer = buffer
      src.loop = true
      src.loopStart = it.start
      src.loopEnd = it.end
      src.connect(ctx.destination)
      src.start(0, it.start)
      const rendered = (await ctx.startRendering()).getChannelData(0)
      const length = it.end - it.start
      const d2 = new Float64Array(rendered.length - 2)
      for (let i = 0; i < d2.length; i++) d2[i] = Math.abs(rendered[i + 2] - 2 * rendered[i + 1] + rendered[i])
      const p99 = Float64Array.from(d2).sort()[Math.floor(d2.length * 0.99)] + 1e-9
      let worst = 0
      let worstAbs = 0
      for (let k = 1; k * length < 5.9; k++) {
        const n = Math.round(k * length * 48000)
        for (let i = n - 2; i <= n + 1; i++) {
          worst = Math.max(worst, d2[i] / p99)
          worstAbs = Math.max(worstAbs, d2[i])
        }
      }
      const peak = rendered.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
      out.push([Number(it.key), Math.round(worst * 100) / 100, Math.round(20 * Math.log10(worstAbs / peak + 1e-12))])
    }
    return out
  }, items)
  const bad = result.filter(([, ratio]) => ratio > 4)
  const absolute = Math.max(...result.map((r) => r[2]))
  console.log(`${set}: ${result.length} notes, worst wrap ${Math.max(...result.map((r) => r[1]))}x (second difference at the wrap, at most ${absolute} dB re the note's peak)${bad.length ? `; over 4: ${bad.map(([k, r, db]) => `${k} (${r}x, ${db} dB)`).join(', ')}` : ''}`)
}
await browser.close()

