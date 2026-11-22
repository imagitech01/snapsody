import type { Platform } from '../port.ts'
import { BrowserDevDevice } from './device.ts'
import { BrowserDevFiles } from './files.ts'
import { BrowserDevReader } from './reader.ts'
import type { BrowserDevReaderOptions } from './reader.ts'
import { BrowserDevScanner } from './scanner.ts'

export interface BrowserDevOptions extends BrowserDevReaderOptions {
  /** The IndexedDB database that holds the files. */
  databaseName?: string
}

/**
 * The MusicXML every page is read as: with `?reading=melody-piano` in the page's address the
 * melody-and-piano fixture, to try the parts step; otherwise the recognised practice exercise (what homr
 * made of the self-engraved practice exercise). Only in `npm run dev`: the fixtures are imported behind
 * `import.meta.env.DEV`, so they are not in the build the app ships.
 */
async function committedScore(): Promise<string | undefined> {
  if (!import.meta.env.DEV) return undefined
  const reading = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('reading')
  if (reading === 'melody-piano') return (await import('../../../test/fixtures/melody-piano.musicxml?raw')).default
  return (await import('../../../test/fixtures/practice-exercise.recognised.musicxml?raw')).default
}

/**
 * The platform of `npm run dev` in desktop Chrome (practice-app design D2): IndexedDB files, the
 * browser's file dialog as the scanner, and a reader that answers with committed MusicXML (the
 * melody-and-piano fixture with `?reading=melody-piano`).
 */
export async function createBrowserDevPlatform(options: BrowserDevOptions = {}): Promise<Platform> {
  const files = new BrowserDevFiles(options.databaseName ?? 'snapsody-browser-dev')
  const musicxml = options.musicxml ?? (await committedScore())
  return {
    files,
    scanner: new BrowserDevScanner(files),
    reader: new BrowserDevReader(musicxml === undefined ? options : { ...options, musicxml }),
    device: new BrowserDevDevice(),
  }
}
