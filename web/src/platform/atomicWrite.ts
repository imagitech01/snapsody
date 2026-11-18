import type { Files } from './port.ts'

/**
 * The suffix of a temp file: the time of the write as nine base-36 digits of milliseconds since
 * 1970, "-", and eight random characters. A later temp of the same target sorts after an earlier
 * one by name, which is how the start-up recovery picks the newest (see `Files.writeTextAtomic`).
 */
export function tempSuffix(now: number = Date.now()): string {
  const time = Math.max(0, Math.floor(now)).toString(36).padStart(9, '0')
  const random = Math.random().toString(36).slice(2, 10).padEnd(8, '0')
  return `${time}-${random}`
}

/**
 * Writes a text file atomically over the port's own calls: the text goes to `<path>.tmp-<suffix>`
 * (see `tempSuffix`), which is then renamed over the target. A crash before the rename leaves the
 * old file, or none, and a stray temp file; a failure the code can still see removes the temp file
 * again (practice-app design D4).
 *
 * This is the atomic write of the adapters whose `rename` replaces a file in one step: the fake
 * platform and browser-dev (`KeyValueFiles`). It is not for an adapter whose rename deletes the
 * target first, such as Capacitor's `Filesystem.rename` on Android: the Capacitor adapter has a
 * native write of its own (practice-app task 10.5) that names its temp files the same way.
 */
export async function atomicWriteText(
  files: Pick<Files, 'writeText' | 'rename' | 'remove'>,
  path: string,
  text: string,
  suffix: string = tempSuffix(),
): Promise<void> {
  const temp = `${path}.tmp-${suffix}`
  await files.writeText(temp, text)
  try {
    await files.rename(temp, path)
  } catch (error) {
    await files.remove(temp).catch(() => undefined)
    throw error
  }
}
