// What the fake platform holds when a journey's page starts (web/test/ui/seeded.tsx, `?seed=`): a list of
// parts separated by commas, applied in order. Pieces and settings are separate parts, so a journey starts
// with exactly what it needs. An unknown part is an error, so that a typo in a test cannot pass by seeding nothing.
//
//   (nothing)      an empty phone: no pieces, default settings
//   v2             the pieces of the committed format 2 store (web/test/fixtures/stores/v2/): "Waltz study in G"
//   v2-settings    that store's settings.json (clarinet, 442 Hz, Dutch)
//   library        the pieces of the spec's scenarios, made by the library itself (pieces.ts, `LIBRARY`)
//   unpractised    one piece that was never practised and is not a favorite (`UNPRACTISED`)
//   settings-unreadable  settings.json cannot be read (the platform fails), so the settings are read-only for the run
//
// Never imported by the app: only the test entry uses it.

import { DEFAULT_PRACTICE, createLibrary } from '../../src/app/library.ts'
import type { NewPage } from '../../src/app/library.ts'
import { PlatformError } from '../../src/platform/port.ts'
import type { FakePlatform } from '../../src/platform/fake/index.ts'
import { LIBRARY, UNPRACTISED } from './pieces.ts'
import type { SeedPiece } from './pieces.ts'
import { barsScore } from './scores.ts'

const V2 = import.meta.glob('../fixtures/stores/v2/**/*', { query: '?url', import: 'default', eager: true }) as Record<string, string>
const V2_ROOT = '../fixtures/stores/v2/'

async function seedV2(platform: FakePlatform, what: 'pieces' | 'settings'): Promise<void> {
  for (const [path, url] of Object.entries(V2)) {
    const relative = path.slice(V2_ROOT.length)
    if ((relative === 'settings.json') !== (what === 'settings')) continue
    const response = await fetch(url)
    if (!response.ok) throw new Error(`seed v2: ${relative} could not be loaded (${response.status})`)
    platform.files.seed(relative, new Uint8Array(await response.arrayBuffer()))
  }
}

const PHOTO = 'scans/seed/page.jpg'

async function seedPieces(platform: FakePlatform, pieces: readonly SeedPiece[]): Promise<void> {
  platform.files.seed(PHOTO, Uint8Array.of(0xff, 0xd8, 0xff, 0xe0))
  for (const piece of pieces) {
    const bars = piece.pages.reduce((sum, n) => sum + n, 0)
    let next = 1
    const pages: NewPage[] = piece.pages.map((count) => {
      const page: NewPage = { source: PHOTO, recognised: barsScore(count), firstBar: next, lastBar: next + count - 1 }
      next += count
      return page
    })
    const library = createLibrary(platform.files, { newId: () => piece.id, now: () => new Date(piece.created) })
    await library.create({ name: piece.name, musicxml: barsScore(bars, piece.practice?.tempo ?? 60), bars, repairs: [], pages })
    if (piece.favorite || piece.lastPracticed !== null) await library.update(piece.id, { favorite: piece.favorite, lastPracticed: piece.lastPracticed })
    if (piece.practice) await library.writePractice(piece.id, { ...DEFAULT_PRACTICE, ...piece.practice })
  }
}

export async function applySeed(platform: FakePlatform, spec: string): Promise<void> {
  for (const part of spec.split(',').map((p) => p.trim()).filter((p) => p !== '')) {
    if (part === 'v2') await seedV2(platform, 'pieces')
    else if (part === 'v2-settings') await seedV2(platform, 'settings')
    else if (part === 'library') await seedPieces(platform, LIBRARY)
    else if (part === 'unpractised') await seedPieces(platform, UNPRACTISED)
    else if (part === 'settings-unreadable') {
      platform.files.fault = (operation, paths) => {
        if (operation === 'read' && paths.includes('settings.json')) throw new PlatformError('failed', 'settings.json cannot be read')
      }
    }
    else throw new Error(`unknown seed part: ${part}`)
  }
}
