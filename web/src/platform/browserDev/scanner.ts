import { PlatformError } from '../port.ts'
import type { ScanResult, ScannedPage, Scanner } from '../port.ts'
import type { BrowserDevFiles } from './files.ts'

/** The files the user picked in the browser's file dialog, or null when the dialog was dismissed. */
function pickFiles(): Promise<File[] | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.multiple = true
    input.hidden = true
    document.body.append(input)
    const done = (files: File[] | null) => {
      input.remove()
      resolve(files)
    }
    input.addEventListener('change', () => done([...(input.files ?? [])]))
    input.addEventListener('cancel', () => done(null))
    input.click()
  })
}

function extensionOf(file: File): string {
  const fromName = /\.([A-Za-z0-9]{1,5})$/.exec(file.name)?.[1]?.toLowerCase()
  if (fromName) return fromName
  return file.type === 'image/png' ? 'png' : 'jpg'
}

/**
 * The browser-dev "scanner": the browser's file dialog. The user (or a test) picks image files,
 * which become the scanned pages in the order of the dialog. No cropping happens: the images are
 * used as they are.
 */
export class BrowserDevScanner implements Scanner {
  private readonly files: BrowserDevFiles

  constructor(files: BrowserDevFiles) {
    this.files = files
  }

  async scan(options: { maxPages: number }): Promise<ScanResult> {
    if (typeof document === 'undefined') throw new PlatformError('unavailable', 'there is no file dialog here')
    const picked = await pickFiles()
    if (!picked || picked.length === 0) return { cancelled: true, pages: [] }
    const folder = `scans/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const pages: ScannedPage[] = []
    for (const [index, file] of picked.slice(0, options.maxPages).entries()) {
      let size: { width: number; height: number }
      try {
        const bitmap = await createImageBitmap(file)
        size = { width: bitmap.width, height: bitmap.height }
        bitmap.close()
      } catch {
        throw new PlatformError('failed', `${file.name} is not an image the browser can read`)
      }
      const path = `${folder}/page-${index + 1}.${extensionOf(file)}`
      await this.files.putBytes(path, new Uint8Array(await file.arrayBuffer()))
      pages.push({ path, ...size })
    }
    return { cancelled: false, pages }
  }
}
