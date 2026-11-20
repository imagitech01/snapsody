import type { Platform } from '../port.ts'
import { BrowserDevDevice } from './device.ts'
import { BrowserDevFiles } from './files.ts'
import { BrowserDevReader } from './reader.ts'
import type { BrowserDevReaderOptions } from './reader.ts'
import { BrowserDevScanner } from './scanner.ts'
import melodyPiano from '../../../test/fixtures/melody-piano.musicxml?raw'

export interface BrowserDevOptions extends BrowserDevReaderOptions {
  /** The IndexedDB database that holds the files. */
  databaseName?: string
}

/** `?reading=melody-piano` in the page's address: pages read as the melody-and-piano fixture, to try the parts step. */
function readingFromAddress(): string | undefined {
  const reading = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('reading')
  return reading === 'melody-piano' ? melodyPiano : undefined
}

/**
 * The platform of `npm run dev` in desktop Chrome (practice-app design D2): IndexedDB files, the
 * browser's file dialog as the scanner, and a reader that answers with committed MusicXML (the
 * melody-and-piano fixture with `?reading=melody-piano`).
 */
export function createBrowserDevPlatform(options: BrowserDevOptions = {}): Platform {
  const files = new BrowserDevFiles(options.databaseName ?? 'snapsody-browser-dev')
  const musicxml = options.musicxml ?? readingFromAddress()
  return {
    files,
    scanner: new BrowserDevScanner(files),
    reader: new BrowserDevReader(musicxml === undefined ? options : { ...options, musicxml }),
    device: new BrowserDevDevice(),
  }
}
