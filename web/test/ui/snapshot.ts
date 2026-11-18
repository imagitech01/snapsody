// The fake platform's files across a reload of the page. The phone keeps the app's files when the activity
// is recreated; the fake keeps them in memory, so the test entry writes them to sessionStorage (which
// survives a reload of the same tab, and is gone with the browser context) and reads them back at start.

import type { FakeFiles } from '../../src/platform/fake/index.ts'

const KEY = 'snapsody-test-files'

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

function fromBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0))
}

/** Stores every file. */
export function saveSnapshot(files: FakeFiles): void {
  const all = files.paths().map((path) => [path, toBase64(files.bytes(path)!)])
  sessionStorage.setItem(KEY, JSON.stringify(all))
}

/** Puts back the files of the last snapshot; false when this tab has none (a first start: the seed applies). */
export function restoreSnapshot(files: FakeFiles): boolean {
  const text = sessionStorage.getItem(KEY)
  if (text === null) return false
  for (const [path, data] of JSON.parse(text) as [string, string][]) files.seed(path, fromBase64(data))
  return true
}
