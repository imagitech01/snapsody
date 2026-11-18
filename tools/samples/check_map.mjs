#!/usr/bin/env node
// Validates converted sample folders with the app's own parseSampleMap().
//   node tools/samples/check_map.mjs web/public/samples/tenor-sax [...]
// Each folder's name picks its instrument in tools/samples/instruments.json (sounding range and step).
// Checks: the map validates; every key of the range has a sample within step/2 semitones; every file
// exists, is in the map, decodes (ffprobe, then a full ffmpeg decode), is mono 44.1/48 kHz; the sustain
// section lies inside the file, is at least 0.3 s and sits on a whole sample; gain is in (0, 1].
// A set with "attack": "always" (piano, guitar) has notes without a loop: each of those files must be
// at least 0.5 s long and end in silence (its last 10 ms below -54 dBFS), since a held note just ends.
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { basename, join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const { parseSampleMap } = await import(join(here, '../../web/src/core/playback/samples.ts'))
const config = JSON.parse(readFileSync(join(here, 'instruments.json'), 'utf8'))
let failed = false
const dirs = process.argv.slice(2)
if (dirs.length === 0) {
  console.log('usage: node tools/samples/check_map.mjs <sample folder> [...]')
  process.exit(2)
}
for (const dir of dirs) {
  const errs = []
  const id = basename(resolve(dir))
  const instrument = config.instruments[id]
  if (!instrument) {
    console.log(`${dir}: FAIL, no instrument "${id}" in tools/samples/instruments.json`)
    failed = true
    continue
  }
  const [lo, hi] = instrument.range
  const step = instrument.step ?? config.defaults.step
  const map = parseSampleMap(JSON.parse(readFileSync(join(dir, 'map.json'), 'utf8')))
  for (let m = lo; m <= hi; m++) {
    const nearest = Math.min(...map.notes.map((n) => Math.abs(n.midi - m)))
    if (nearest > Math.floor(step / 2)) errs.push(`note ${m}: nearest sample is ${nearest} semitones away`)
  }
  const mapped = new Set(map.notes.map((n) => n.file))
  for (const f of readdirSync(dir)) {
    if (f !== 'map.json' && !mapped.has(f)) errs.push(`${f}: in the folder but not in map.json`)
  }
  let bytes = 0
  for (const n of map.notes) {
    const f = join(dir, n.file)
    if (!existsSync(f)) { errs.push(`${n.midi}: file ${n.file} missing`); continue }
    try {
      const out = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', f]).toString())
      const s = out.streams[0]
      const rate = Number(s.sample_rate)
      const dur = Number(out.format.duration)
      bytes += Number(out.format.size)
      if (s.channels !== 1) errs.push(`${n.midi}: not mono`)
      if (![44100, 48000].includes(rate)) errs.push(`${n.midi}: sample rate ${s.sample_rate}`)
      if (n.sustainStart === undefined || n.sustainEnd === undefined) {
        if (map.attack !== 'always') errs.push(`${n.midi}: no loop in a set without "attack": "always"`)
        if (dur < 0.5) errs.push(`${n.midi}: ${dur}s long, under 0.5 s`)
      } else {
        if (n.sustainEnd > dur + 0.001) errs.push(`${n.midi}: sustainEnd ${n.sustainEnd} beyond ${dur}s`)
        if (n.sustainEnd - n.sustainStart < 0.3) errs.push(`${n.midi}: loop under 0.3 s`)
        for (const [what, t] of [['sustainStart', n.sustainStart], ['sustainEnd', n.sustainEnd]]) {
          if (Math.abs(t * rate - Math.round(t * rate)) > 0.01) errs.push(`${n.midi}: ${what} ${t} is not on a whole sample at ${rate} Hz`)
        }
      }
      if (!(n.gain > 0 && n.gain <= 1)) errs.push(`${n.midi}: gain ${n.gain} is outside (0, 1]`)
      // full decode must succeed
      if (n.sustainStart === undefined) {
        const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', f, '-f', 'f32le', '-ac', '1', '-'], { maxBuffer: 1 << 29 })
        const x = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength >> 2)
        let tail = 0
        for (let i = Math.max(0, x.length - Math.round(0.01 * rate)); i < x.length; i++) tail = Math.max(tail, Math.abs(x[i]))
        if (tail > 0.002) errs.push(`${n.midi}: the file does not end in silence (last 10 ms peak ${tail.toFixed(4)})`)
      } else execFileSync('ffmpeg', ['-v', 'error', '-i', f, '-f', 'null', '-'])
    } catch (e) { errs.push(`${n.midi}: decode failed ${String(e.message).slice(0, 80)}`) }
  }
  console.log(`${dir}: ${map.notes.length} notes (${lo}..${hi}, step ${step}), ${(bytes / 1e6).toFixed(2)} MB, ${errs.length ? 'FAIL' : 'OK'}`)
  for (const e of errs) console.log('  ' + e)
  if (errs.length) failed = true
}
process.exit(failed ? 1 : 0)
