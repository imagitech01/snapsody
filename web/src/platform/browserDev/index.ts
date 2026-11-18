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
 * The platform of `npm run dev` in desktop Chrome (practice-app design D2): IndexedDB files, the
 * browser's file dialog as the scanner, and a reader that answers with committed MusicXML.
 */
export function createBrowserDevPlatform(options: BrowserDevOptions = {}): Platform {
  const files = new BrowserDevFiles(options.databaseName ?? 'snapsody-browser-dev')
  return {
    files,
    scanner: new BrowserDevScanner(files),
    reader: new BrowserDevReader(options),
    device: new BrowserDevDevice(),
  }
}
