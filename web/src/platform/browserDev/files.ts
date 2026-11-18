import { KeyValueFiles, normalisePath } from '../keyValueFiles.ts'
import type { ByteStore, FileOperation } from '../keyValueFiles.ts'
import { PlatformError } from '../port.ts'

const STORE = 'files'

function wrap<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(new PlatformError('failed', request.error?.message ?? 'IndexedDB request failed'))
  })
}

/** The bytes of every file in one IndexedDB object store, keyed by path. */
class IndexedDbStore implements ByteStore {
  private readonly opened: Promise<IDBDatabase>

  constructor(name: string) {
    this.opened = new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1)
      request.onupgradeneeded = () => request.result.createObjectStore(STORE)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(new PlatformError('failed', request.error?.message ?? 'cannot open IndexedDB'))
    })
  }

  private async objects(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    return (await this.opened).transaction(STORE, mode).objectStore(STORE)
  }

  async get(key: string): Promise<Uint8Array | undefined> {
    const value = (await wrap((await this.objects('readonly')).get(key))) as Uint8Array | undefined
    return value === undefined ? undefined : new Uint8Array(value)
  }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    await wrap((await this.objects('readwrite')).put(bytes, key))
  }

  async remove(key: string): Promise<void> {
    await wrap((await this.objects('readwrite')).delete(key))
  }

  async keys(prefix: string): Promise<string[]> {
    const range = prefix === '' ? undefined : IDBKeyRange.bound(prefix, `${prefix}￿`)
    return (await wrap((await this.objects('readonly')).getAllKeys(range))) as string[]
  }
}

const MIME: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' }

/**
 * The browser-dev adapter's files: IndexedDB (the files survive a reload), with the behaviour all
 * key-value adapters share (`KeyValueFiles`).
 */
export class BrowserDevFiles extends KeyValueFiles {
  private readonly urls = new Map<string, string>()
  private readonly db: IndexedDbStore

  constructor(databaseName: string) {
    const db = new IndexedDbStore(databaseName)
    super(db)
    this.db = db
  }

  /** Stores binary content (a scanned page) without going through the port. */
  async putBytes(path: string, bytes: Uint8Array): Promise<void> {
    const p = normalisePath(path)
    this.forget([p])
    await this.db.put(p, bytes)
  }

  protected override before(operation: FileOperation, paths: string[]): void {
    if (operation === 'write' || operation === 'copy' || operation === 'rename' || operation === 'remove') this.forget(paths)
  }

  protected override async urlFor(path: string, bytes: Uint8Array): Promise<string> {
    const known = this.urls.get(path)
    if (known) return known
    const extension = path.split('.').pop()?.toLowerCase() ?? ''
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: MIME[extension] ?? 'application/octet-stream' }))
    this.urls.set(path, url)
    return url
  }

  /** Revokes the object URLs of the files at or below [paths], which are about to change. */
  private forget(paths: string[]): void {
    for (const [path, url] of this.urls) {
      if (paths.some((p) => path === p || path.startsWith(`${p}/`))) {
        URL.revokeObjectURL(url)
        this.urls.delete(path)
      }
    }
  }
}
