import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

// The layers of web/src (practice-app design D2): ui/ -> app/ -> core/, with platform/ as the one
// door to the phone. app/ and core/ import nothing from ui/ or the adapters, and from platform/
// only the port (platform/port.ts). This is a scan of the import lines, so a layer break fails the
// quick layer at once. main.tsx, outside the layers, is the only place that may pick an adapter.

const SRC = fileURLToPath(new URL('../src/', import.meta.url))
const TEST_UI = fileURLToPath(new URL('./ui/', import.meta.url))

/** The module specifiers a source text imports: `from '…'`, `import '…'` and `import('…')`. */
export function importsOf(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const found: string[] = []
  for (const match of code.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])([^'"\n]+)\1/g)) found.push(match[2]!)
  return found
}

/** The path (from src/) a relative [specifier] in [file] (from src/) points at, without its extension. */
function resolveFrom(file: string, specifier: string): string {
  const parts = file.split('/').slice(0, -1)
  for (const part of specifier.split('/')) {
    if (part === '..') parts.pop()
    else if (part !== '.' && part !== '') parts.push(part)
  }
  return parts.join('/').replace(/\.(tsx?|mjs|js)$/, '')
}

/** What is wrong with [file] (path from src/) importing [specifier], or undefined when it is fine. */
export function layerViolation(file: string, specifier: string): string | undefined {
  const layer = file.split('/')[0]
  if (layer !== 'app' && layer !== 'core') return undefined
  if (specifier === 'preact' || specifier.startsWith('preact/')) {
    return `${layer}/ must not import the UI framework (${specifier}); signals come from @preact/signals`
  }
  if (!specifier.startsWith('.')) return undefined
  const target = resolveFrom(file, specifier)
  const targetLayer = target.split('/')[0]
  if (targetLayer === 'ui') return `${layer}/ must not import ui/ (${specifier})`
  if (targetLayer === 'platform' && target !== 'platform/port') return `${layer}/ must import only platform/port, not ${specifier}`
  if (layer === 'core' && targetLayer === 'app') return `core/ must not import app/ (${specifier})`
  if (targetLayer !== 'app' && targetLayer !== 'core' && targetLayer !== 'platform') return `${layer}/ must not import outside the layers (${specifier})`
  return undefined
}

function sourceFiles(root: string): string[] {
  return existsSync(root) ? readdirSync(root, { recursive: true }).filter((name) => /\.tsx?$/.test(name)).sort() : []
}

test('layers: app/ and core/ import nothing from ui/ or the adapters (and only the port from platform/)', () => {
  const problems: string[] = []
  for (const file of sourceFiles(SRC)) {
    for (const specifier of importsOf(readFileSync(`${SRC}${file}`, 'utf8'))) {
      const problem = layerViolation(file, specifier)
      if (problem) problems.push(`${file}: ${problem}`)
    }
  }
  assert.deepEqual(problems, [])
})

test('layers: the scan itself flags a known-bad import and lets the good ones through', () => {
  assert.match(layerViolation('app/library.ts', '../ui/App.tsx')!, /must not import ui/)
  assert.match(layerViolation('app/library.ts', '../platform/fake/index.ts')!, /only platform\/port/)
  assert.match(layerViolation('app/library.ts', '../platform/browserDev/index.ts')!, /only platform\/port/)
  assert.match(layerViolation('app/library.ts', '../platform/capacitor/index.ts')!, /only platform\/port/)
  assert.match(layerViolation('core/score/edit.ts', '../../ui/scoreView.ts')!, /must not import ui/)
  assert.match(layerViolation('core/pages/merge.ts', '../../app/library.ts')!, /must not import app/)
  assert.match(layerViolation('app/router.ts', 'preact/hooks')!, /UI framework/)
  assert.match(layerViolation('app/router.ts', 'preact')!, /UI framework/)
  assert.match(layerViolation('app/router.ts', '../main.tsx')!, /outside the layers/)

  assert.equal(layerViolation('app/library.ts', '../platform/port.ts'), undefined)
  assert.equal(layerViolation('app/library.ts', '../core/score/model.ts'), undefined)
  assert.equal(layerViolation('app/library.ts', './settings.ts'), undefined)
  assert.equal(layerViolation('app/library.ts', '@preact/signals'), undefined)
  assert.equal(layerViolation('core/score/edit.ts', './model.ts'), undefined)
  assert.equal(layerViolation('core/playback/player.ts', '../score/rational.ts'), undefined)
  assert.equal(layerViolation('core/score/render.ts', 'verovio/esm'), undefined)
  assert.equal(layerViolation('ui/App.tsx', '../platform/fake/index.ts'), undefined, 'ui/ and main.tsx are not under this rule')
  assert.equal(layerViolation('main.tsx', './platform/browserDev/index.ts'), undefined)
})

test('layers: importsOf finds every kind of import and skips comments', () => {
  const source = `
    import { a } from './a.ts'
    import type { B } from "../b.ts"
    import './side.ts'
    export { c } from './c.ts'
    const d = await import('./d.ts')
    // import { x } from './in-a-comment.ts'
    /* import { y } from './in-a-block.ts' */
    const text = 'from nowhere'
  `
  assert.deepEqual(importsOf(source), ['./a.ts', '../b.ts', './side.ts', './c.ts', './d.ts'])
})

test('layers: the old bridge global is not used (Capacitor defines its own, and the old host mistook it)', () => {
  // The needle is built in pieces so that this file does not contain it.
  const needle = ['native', 'Bridge'].join('')
  const hits: string[] = []
  for (const [root, files] of [[SRC, sourceFiles(SRC)], [TEST_UI, sourceFiles(TEST_UI)]] as const) {
    for (const file of files) if (readFileSync(`${root}${file}`, 'utf8').includes(needle)) hits.push(`${root.slice(root.indexOf('web/'))}${file}`)
  }
  assert.deepEqual(hits, [])
})

test('layers: the app ships no test hooks: nothing in src/ imports the fake platform or web/test/, and index.html loads only main.tsx', () => {
  // The UI tests start the app through their own entry (test/ui/seeded.tsx), which passes the fake platform to the same
  // `mount` and is built only by test/ui/vite.config.ts. Anything in src/ that reached the fake or the tests would end up
  // in the app the phone runs.
  const problems: string[] = []
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(`${SRC}${file}`, 'utf8')
    if (file.startsWith('platform/fake/')) continue
    for (const specifier of importsOf(text)) {
      if (!specifier.startsWith('.')) continue
      const target = resolveFrom(file, specifier)
      if (target.startsWith('platform/fake') || target.startsWith('..')) problems.push(`${file}: imports ${specifier}`)
    }
    if (/__test\b|\b__fake\b/.test(text)) problems.push(`${file}: names a test hook on window`)
  }
  assert.deepEqual(problems, [])

  const index = readFileSync(`${SRC}../index.html`, 'utf8')
  assert.deepEqual([...index.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]), ['./src/main.tsx'])
})
