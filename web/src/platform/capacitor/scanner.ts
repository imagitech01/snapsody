import { PlatformError } from '../port.ts'
import type { ScanResult, Scanner } from '../port.ts'
import { portError } from './files.ts'
import type { ScannerPlugin } from './plugins.ts'

/**
 * The scanner on the phone: our Scanner plugin (ML Kit's document scanner, android/.../scanner/).
 * It returns the pages as data-relative paths (`scans/<id>/page-<n>.jpg`), which `Files` and the
 * Reader take as they are. Rejects with `unavailable` when ML Kit cannot run.
 */
export class CapacitorScanner implements Scanner {
  private readonly plugin: ScannerPlugin

  constructor(plugin: ScannerPlugin) {
    this.plugin = plugin
  }

  async scan(options: { maxPages: number }): Promise<ScanResult> {
    let reply: Awaited<ReturnType<ScannerPlugin['scan']>>
    try {
      reply = await this.plugin.scan({ maxPages: options.maxPages })
    } catch (error) {
      throw portError(error)
    }
    if (reply.cancelled || reply.pages.length === 0) return { cancelled: true, pages: [] }
    for (const page of reply.pages) {
      if (typeof page.path !== 'string' || !(page.width > 0) || !(page.height > 0)) {
        throw new PlatformError('failed', `the scanner returned a page without a path or size: ${JSON.stringify(page)}`)
      }
    }
    return { cancelled: false, pages: reply.pages.map(({ path, width, height }) => ({ path, width, height })) }
  }
}
