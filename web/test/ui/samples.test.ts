import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { parseSampleMap } from '../../src/core/playback/samples.ts'
import { withApp } from './app.ts'
import { BUILD_DIR } from './paths.ts'

// Every file of every bundled instrument folder decodes in Chromium and matches its map
// (practice-app task 7.3; the mac-layer "decode every sample" test of design D9). A broken, missing
// or stray file is caught here; how the sound is, is judged by ear (docs/samples.md, "Listening
// check"). The folders come from tools/samples/convert_soundfont.py.

const SAMPLES = `${BUILD_DIR}samples/`
const CONFIG = fileURLToPath(new URL('../../../tools/samples/instruments.json', import.meta.url))
const AUDIO = /\.(ogg|wav|mp3|flac)$/i
const INSTRUMENTS = ['tenor-sax', 'alto-sax', 'clarinet', 'piano', 'guitar', 'violin', 'trumpet']

interface InstrumentConfig {
  range: [number, number]
  step?: number
}
interface Config {
  defaults: { step: number }
  instruments: Record<string, InstrumentConfig>
}

test('sample sets: every instrument has a folder, whose map covers its range, whose files are all in the map', () => {
  const config = JSON.parse(readFileSync(CONFIG, 'utf8')) as Config
  const sets = readdirSync(SAMPLES).filter((name) => !name.startsWith('.'))
  assert.deepEqual([...sets].sort(), [...INSTRUMENTS].sort(), 'bundled sets')
  const problems: string[] = []
  for (const set of sets) {
    const map = parseSampleMap(JSON.parse(readFileSync(`${SAMPLES}${set}/map.json`, 'utf8')))
    const instrument = config.instruments[set]
    if (!instrument) {
      problems.push(`${set}: not in tools/samples/instruments.json`)
      continue
    }
    const [low, high] = instrument.range
    const reach = Math.floor((instrument.step ?? config.defaults.step) / 2)
    for (let midi = low; midi <= high; midi++) {
      const nearest = Math.min(...map.notes.map((entry) => Math.abs(entry.midi - midi)))
      if (nearest > reach) problems.push(`${set}: note ${midi} is ${nearest} semitones from the nearest sample`)
    }
    const mapped = new Set(map.notes.map((entry) => entry.file))
    const files = readdirSync(`${SAMPLES}${set}`).filter((name) => AUDIO.test(name))
    for (const file of mapped) if (!files.includes(file)) problems.push(`${set}/${file}: in map.json but not bundled`)
    for (const file of files) if (!mapped.has(file)) problems.push(`${set}/${file}: bundled but not in map.json`)
  }
  assert.deepEqual(problems, [], 'sample set problems')
})

test('sample sets: every bundled file decodes in Chromium, mono, with its loop inside the file, or (a note played once) ending in silence', async () => {
  const wanted: { path: string; sustainEnd: number | undefined }[] = []
  for (const set of INSTRUMENTS) {
    const map = parseSampleMap(JSON.parse(readFileSync(`${SAMPLES}${set}/map.json`, 'utf8')))
    for (const entry of map.notes) wanted.push({ path: `samples/${set}/${entry.file}`, sustainEnd: entry.sustainEnd })
  }
  assert.ok(wanted.length > 100, `only ${wanted.length} files`)
  await withApp({}, async ({ page }) => {
    await page.getByRole('heading', { name: 'Let’s practise' }).waitFor() // the app has started
    const problems = await page.evaluate(async (files) => {
      const context = new OfflineAudioContext(1, 1, 44_100)
      const failed: string[] = []
      for (const { path, sustainEnd } of files) {
        try {
          const response = await fetch(path)
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const buffer = await context.decodeAudioData(await response.arrayBuffer())
          if (buffer.numberOfChannels !== 1) throw new Error(`${buffer.numberOfChannels} channels`)
          if (buffer.duration <= 0) throw new Error('empty')
          if (sustainEnd === undefined) {
            // A note that plays once (a set with "attack": "always"): a held note just ends with the file, so the file must end in silence.
            const tail = buffer.getChannelData(0).subarray(-Math.round(0.01 * buffer.sampleRate))
            const peak = tail.reduce((max, value) => Math.max(max, Math.abs(value)), 0)
            if (buffer.duration < 0.5) throw new Error(`only ${buffer.duration} s long`)
            if (peak > 0.002) throw new Error(`does not end in silence (last 10 ms peak ${peak})`)
          } else if (sustainEnd > buffer.duration + 0.001) throw new Error(`the loop ends at ${sustainEnd} s, the file at ${buffer.duration} s`)
        } catch (e) {
          failed.push(`${path.slice('samples/'.length)}: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
      return failed
    }, wanted)
    assert.deepEqual(problems, [], 'files that do not decode')
  })
})
