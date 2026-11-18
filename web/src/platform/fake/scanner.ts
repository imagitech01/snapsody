import { PlatformError } from '../port.ts'
import type { ScanResult, ScannedPage, Scanner } from '../port.ts'
import type { FakeFiles } from './files.ts'

/** One page a test makes the next scan return. */
export interface FakeScannedPage {
  width?: number
  height?: number
  /** The image bytes put in the fake files; a few bytes by default. */
  bytes?: Uint8Array
}

type Outcome = { kind: 'pages'; pages: FakeScannedPage[] } | { kind: 'cancelled' } | { kind: 'unavailable' }

/**
 * The fake scanner: a test says what the next scan gives (pages, the user cancelling, or the
 * scanner being unavailable), one outcome per `scan` call. The pages' files are put in the fake
 * files, at `scans/<scan>/page-<n>.jpg`, so they can be copied and shown like real ones.
 */
export class FakeScanner implements Scanner {
  /** The options of every scan call so far. */
  readonly calls: Array<{ maxPages: number }> = []
  private readonly files: FakeFiles
  private readonly queue: Outcome[] = []
  private scans = 0

  constructor(files: FakeFiles) {
    this.files = files
  }

  /** The next scan returns these pages, or [count] default ones. */
  willReturn(pages: FakeScannedPage[] | number): void {
    this.queue.push({ kind: 'pages', pages: typeof pages === 'number' ? Array.from({ length: pages }, () => ({})) : pages })
  }

  /** The next scan ends with the user leaving the scanner without pages. */
  willCancel(): void {
    this.queue.push({ kind: 'cancelled' })
  }

  /** The next scan rejects with `unavailable`. */
  willBeUnavailable(): void {
    this.queue.push({ kind: 'unavailable' })
  }

  async scan(options: { maxPages: number }): Promise<ScanResult> {
    this.calls.push({ maxPages: options.maxPages })
    const outcome = this.queue.shift()
    if (!outcome) throw new Error('FakeScanner: scan() was called with no outcome scripted')
    if (outcome.kind === 'unavailable') throw new PlatformError('unavailable', 'the page scanner is not available')
    if (outcome.kind === 'cancelled') return { cancelled: true, pages: [] }
    if (outcome.pages.length === 0) return { cancelled: true, pages: [] }
    if (outcome.pages.length > options.maxPages) {
      throw new Error(`FakeScanner: ${outcome.pages.length} pages scripted but maxPages is ${options.maxPages}; the real scanner stops at the limit`)
    }
    this.scans += 1
    const pages: ScannedPage[] = outcome.pages.map((page, index) => {
      const path = `scans/${this.scans}/page-${index + 1}.jpg`
      this.files.seed(path, page.bytes ?? Uint8Array.of(0xff, 0xd8, 0xff, index + 1))
      return { path, width: page.width ?? 1000, height: page.height ?? 1400 }
    })
    return { cancelled: false, pages }
  }
}
