import { atomicWriteText } from './atomicWrite.ts'
import { PlatformError } from './port.ts'
import type { FileEntry, Files } from './port.ts'

/**
 * `Files` over a plain key-value store of bytes, for the adapters that have no real file system:
 * the fake platform (a Map) and browser-dev (IndexedDB). Keys are file paths; folders exist only
 * as the front part of a path. Both adapters get the same behaviour from this one class, so a
 * test against the fake says something about browser-dev too.
 */

export interface ByteStore {
  get(key: string): Promise<Uint8Array | undefined>
  put(key: string, bytes: Uint8Array): Promise<void>
  remove(key: string): Promise<void>
  /** Every key that starts with [prefix] (all keys for ""), in any order. */
  keys(prefix: string): Promise<string[]>
}

export type FileOperation = 'read' | 'write' | 'copy' | 'rename' | 'list' | 'remove' | 'imageUrl'

/** A path without empty or "." parts and without a leading "/". Rejects ".." and the empty path. */
export function normalisePath(path: string): string {
  const parts = path.split('/').filter((part) => part !== '' && part !== '.')
  if (parts.includes('..') || path.includes('\0')) throw new PlatformError('invalid', `path not accepted: ${path}`)
  return parts.join('/')
}

function filePath(path: string): string {
  const normal = normalisePath(path)
  if (normal === '') throw new PlatformError('invalid', 'a file path is needed')
  return normal
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export abstract class KeyValueFiles implements Files {
  protected readonly store: ByteStore

  constructor(store: ByteStore) {
    this.store = store
  }

  /** Called before every operation, with the paths it uses. A subclass may throw to fail the operation. */
  protected before(_operation: FileOperation, _paths: string[]): void | Promise<void> {}

  /** A URL for the image [bytes] found at [path] (the path is normalised, the file exists). */
  protected abstract urlFor(path: string, bytes: Uint8Array): Promise<string>

  async readText(path: string): Promise<string> {
    const p = filePath(path)
    await this.before('read', [p])
    const bytes = await this.store.get(p)
    if (!bytes) throw new PlatformError('not-found', `no file at ${p}`)
    return decoder.decode(bytes)
  }

  async writeText(path: string, text: string): Promise<void> {
    const p = filePath(path)
    await this.before('write', [p])
    await this.assertNotFolder(p)
    await this.store.put(p, encoder.encode(text))
  }

  writeTextAtomic(path: string, text: string): Promise<void> {
    return atomicWriteText(this, path, text)
  }

  async copy(from: string, to: string): Promise<void> {
    const source = filePath(from)
    const target = filePath(to)
    await this.before('copy', [source, target])
    const bytes = await this.store.get(source)
    if (!bytes) throw new PlatformError('not-found', `no file at ${source}`)
    await this.assertNotFolder(target)
    await this.store.put(target, bytes)
  }

  async rename(from: string, to: string): Promise<void> {
    const source = filePath(from)
    const target = filePath(to)
    await this.before('rename', [source, target])
    if (source === target) {
      if (!(await this.exists(source))) throw new PlatformError('not-found', `nothing at ${source}`)
      return
    }
    const bytes = await this.store.get(source)
    if (bytes) {
      await this.assertNotFolder(target)
      await this.store.put(target, bytes)
      await this.store.remove(source)
      return
    }
    const below = await this.store.keys(`${source}/`)
    if (below.length === 0) throw new PlatformError('not-found', `nothing at ${source}`)
    if (target.startsWith(`${source}/`)) throw new PlatformError('invalid', `cannot move ${source} into itself`)
    if (await this.exists(target)) throw new PlatformError('exists', `${target} already exists`)
    for (const key of below) {
      const moved = (await this.store.get(key))!
      await this.store.put(`${target}${key.slice(source.length)}`, moved)
      await this.store.remove(key)
    }
  }

  async list(folder: string): Promise<FileEntry[]> {
    const normal = normalisePath(folder)
    await this.before('list', [normal])
    const prefix = normal === '' ? '' : `${normal}/`
    const entries = new Map<string, FileEntry>()
    for (const key of await this.store.keys(prefix)) {
      const rest = key.slice(prefix.length)
      const slash = rest.indexOf('/')
      const name = slash < 0 ? rest : rest.slice(0, slash)
      if (slash >= 0) entries.set(name, { name, kind: 'folder' })
      else if (!entries.has(name)) entries.set(name, { name, kind: 'file' })
    }
    return [...entries.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  }

  async remove(path: string): Promise<void> {
    const p = filePath(path)
    await this.before('remove', [p])
    await this.store.remove(p)
    for (const key of await this.store.keys(`${p}/`)) await this.store.remove(key)
  }

  async imageUrl(path: string): Promise<string> {
    const p = filePath(path)
    await this.before('imageUrl', [p])
    const bytes = await this.store.get(p)
    if (!bytes) throw new PlatformError('not-found', `no file at ${p}`)
    return this.urlFor(p, bytes)
  }

  private async exists(path: string): Promise<boolean> {
    return (await this.store.get(path)) !== undefined || (await this.store.keys(`${path}/`)).length > 0
  }

  private async assertNotFolder(path: string): Promise<void> {
    if ((await this.store.keys(`${path}/`)).length > 0) throw new PlatformError('exists', `${path} is a folder`)
  }
}
