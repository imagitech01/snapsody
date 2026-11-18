// Mock Capacitor plugins for web/test/capacitorAdapter.test.ts. They reproduce what the real ones do
// on Android, as read in their sources:
// - Filesystem (@capacitor/filesystem 8.1.5 over io.ionic.libs:ionfilesystem-android 1.1.1):
//   DoesNotExist (OS-PLUG-FILE-0008) on a missing path for read, list, stat, delete, copy and
//   rename; NoParentDirectory (0011) for copy and rename (and a write without `recursive`) when the
//   target's folder is missing; a file rename that DELETES the target first and then renames (with
//   `faultBetweenDeleteAndRename` to cut it off there); DestinationDirectoryExists (0010) for a folder
//   renamed onto a folder; 0009 for a rename or copy that mixes a file and a folder; 0012 for a
//   non-recursive delete of a folder with something inside; copy overwrites a file.
// - AtomicFiles, Scanner and Reader: android/app/src/main/java/app/snapsody/ (port error codes).
import type {
  AppPlugin,
  AtomicFilesPlugin,
  CapacitorPlugins,
  DevicePlugin,
  FilesystemPlugin,
  KeepAwakePlugin,
  ListenerHandle,
  ReaderPlugin,
  ReaderPluginEvent,
  ScannerPlugin,
} from '../src/platform/capacitor/plugins.ts'

/** A rejection like Capacitor's CapacitorException: a message and a code. */
export class PluginRejection extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

const ERR = {
  doesNotExist: 'OS-PLUG-FILE-0008',
  notAllowed: 'OS-PLUG-FILE-0009',
  alreadyExists: 'OS-PLUG-FILE-0010',
  noParent: 'OS-PLUG-FILE-0011',
  children: 'OS-PLUG-FILE-0012',
  failed: 'OS-PLUG-FILE-0013',
}

export const DATA_ROOT = '/data/user/0/app.snapsody/files'

type Node = { kind: 'file'; text: string } | { kind: 'dir' }

/** The app's data folder: a tree of files and folders by data-relative path ("" is the folder itself). */
export class MockDisk {
  readonly nodes = new Map<string, Node>([['', { kind: 'dir' }]])

  static parent(path: string): string {
    const slash = path.lastIndexOf('/')
    return slash < 0 ? '' : path.slice(0, slash)
  }

  static clean(path: string): string {
    return path.split('/').filter((part) => part !== '' && part !== '.').join('/')
  }

  get(path: string): Node | undefined {
    return this.nodes.get(MockDisk.clean(path))
  }

  children(path: string): string[] {
    const prefix = path === '' ? '' : `${path}/`
    return [...this.nodes.keys()].filter((key) => key !== '' && key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
  }

  below(path: string): string[] {
    return [...this.nodes.keys()].filter((key) => key.startsWith(`${path}/`))
  }

  /** Puts a file in place, with its folders (a test's arrangement). */
  seed(path: string, text: string): void {
    const p = MockDisk.clean(path)
    let folder = MockDisk.parent(p)
    while (folder !== '' && !this.nodes.has(folder)) {
      this.nodes.set(folder, { kind: 'dir' })
      folder = MockDisk.parent(folder)
    }
    this.nodes.set(p, { kind: 'file', text })
  }

  text(path: string): string | undefined {
    const node = this.get(path)
    return node?.kind === 'file' ? node.text : undefined
  }

  /** Every file path, sorted. */
  files(): string[] {
    return [...this.nodes].filter(([, node]) => node.kind === 'file').map(([key]) => key).sort()
  }

  move(from: string, to: string): void {
    const node = this.nodes.get(from)!
    for (const key of this.below(from)) {
      this.nodes.set(`${to}${key.slice(from.length)}`, this.nodes.get(key)!)
      this.nodes.delete(key)
    }
    this.nodes.delete(from)
    this.nodes.set(to, node)
  }
}

export class MockFilesystem implements FilesystemPlugin {
  readonly disk: MockDisk
  /** Every call, as "method path" (or "method from -> to"). */
  readonly calls: string[] = []
  /** Called inside a file rename after the target is deleted and before the rename; throw to cut it off there. */
  faultBetweenDeleteAndRename: (() => void) | undefined

  constructor(disk: MockDisk) {
    this.disk = disk
  }

  private reject(code: string, message: string): never {
    throw new PluginRejection(code, message)
  }

  private dir(directory: unknown): void {
    if (directory !== 'DATA') this.reject('OS-PLUG-FILE-0005', `only DATA in these tests, not ${String(directory)}`)
  }

  async readFile(options: { path: string; directory: unknown; encoding: unknown }): Promise<{ data: string }> {
    this.dir(options.directory)
    this.calls.push(`readFile ${options.path}`)
    const node = this.disk.get(options.path)
    if (!node) this.reject(ERR.doesNotExist, `'readFile' failed because file at '${options.path}' does not exist.`)
    if (node.kind === 'dir') this.reject(ERR.failed, `'readFile' failed with: ${options.path} (Is a directory)`)
    return { data: node.text }
  }

  async writeFile(options: { path: string; directory: unknown; encoding: unknown; data: string; recursive: boolean }): Promise<{ uri: string }> {
    this.dir(options.directory)
    this.calls.push(`writeFile ${options.path}`)
    const p = MockDisk.clean(options.path)
    if (this.disk.get(p)?.kind === 'dir') this.reject(ERR.failed, `'writeFile' failed with: ${p} (Is a directory)`)
    const parent = MockDisk.parent(p)
    if (!this.disk.get(parent)) {
      if (!options.recursive) this.reject(ERR.noParent, 'Missing parent directory')
      let folder = parent
      const missing: string[] = []
      while (!this.disk.get(folder)) {
        missing.push(folder)
        folder = MockDisk.parent(folder)
      }
      if (this.disk.get(folder)?.kind === 'file') this.reject(ERR.failed, `'writeFile' failed with: ${folder} is a file`)
      for (const m of missing) this.disk.nodes.set(m, { kind: 'dir' })
    } else if (this.disk.get(parent)?.kind === 'file') {
      this.reject(ERR.failed, `'writeFile' failed with: ${parent} is a file`)
    }
    this.disk.nodes.set(p, { kind: 'file', text: options.data })
    return { uri: `file://${DATA_ROOT}/${p}` }
  }

  async copy(options: { from: string; to: string; directory: unknown; toDirectory: unknown }): Promise<{ uri: string }> {
    this.dir(options.directory)
    this.dir(options.toDirectory)
    this.calls.push(`copy ${options.from} -> ${options.to}`)
    const from = MockDisk.clean(options.from)
    const to = MockDisk.clean(options.to)
    const node = this.disk.get(from)
    if (!node) this.reject(ERR.doesNotExist, `'copy' failed because file at '${from}' does not exist.`)
    if (from === to) return { uri: `file://${DATA_ROOT}/${to}` }
    const target = this.disk.get(to)
    if (target && (target.kind === 'dir') !== (node.kind === 'dir')) this.reject(ERR.notAllowed, "'copy' not supported for the provided source and destinations.")
    if (!this.disk.get(MockDisk.parent(to))) this.reject(ERR.noParent, 'Missing parent directory')
    if (node.kind === 'dir') this.reject(ERR.failed, 'folder copies are not used by the adapter')
    this.disk.nodes.set(to, { kind: 'file', text: node.text })
    return { uri: `file://${DATA_ROOT}/${to}` }
  }

  async rename(options: { from: string; to: string; directory: unknown; toDirectory: unknown }): Promise<void> {
    this.dir(options.directory)
    this.dir(options.toDirectory)
    this.calls.push(`rename ${options.from} -> ${options.to}`)
    const from = MockDisk.clean(options.from)
    const to = MockDisk.clean(options.to)
    const node = this.disk.get(from)
    if (!node) this.reject(ERR.doesNotExist, `'rename' failed because file at '${from}' does not exist.`)
    if (from === to) return
    const target = this.disk.get(to)
    if (node.kind === 'file') {
      if (target?.kind === 'dir') this.reject(ERR.notAllowed, "'rename' not supported for the provided source and destinations.")
      if (!this.disk.get(MockDisk.parent(to))) this.reject(ERR.noParent, 'Missing parent directory')
      // IONFILELocalFilesHelper.renameFile: destination.delete(), then source.renameTo(destination).
      this.disk.nodes.delete(to)
      this.faultBetweenDeleteAndRename?.()
      this.disk.move(from, to)
      return
    }
    if (target?.kind === 'file') this.reject(ERR.notAllowed, "'rename' not supported for the provided source and destinations.")
    if (target?.kind === 'dir') this.reject(ERR.alreadyExists, `Directory at '${to}' already exists, cannot be overwritten.`)
    if (!this.disk.get(MockDisk.parent(to))) this.reject(ERR.noParent, 'Missing parent directory')
    this.disk.move(from, to)
  }

  async readdir(options: { path: string; directory: unknown }): Promise<{ files: Array<{ name: string; type: 'file' | 'directory' }> }> {
    this.dir(options.directory)
    this.calls.push(`readdir ${options.path}`)
    const p = MockDisk.clean(options.path)
    if (this.disk.get(p)?.kind !== 'dir') this.reject(ERR.doesNotExist, `'readdir' failed because file at '${p}' does not exist.`)
    // File.listFiles() has no order; reversed here so the adapter has to sort.
    const files = this.disk.children(p).map((key) => ({
      name: key.slice(p === '' ? 0 : p.length + 1),
      type: this.disk.get(key)!.kind === 'dir' ? ('directory' as const) : ('file' as const),
    }))
    return { files: files.sort((a, b) => (a.name < b.name ? 1 : -1)) }
  }

  async stat(options: { path: string; directory: unknown }): Promise<{ type: 'file' | 'directory' }> {
    this.dir(options.directory)
    this.calls.push(`stat ${options.path}`)
    const node = this.disk.get(options.path)
    if (!node) this.reject(ERR.doesNotExist, `'stat' failed because file at '${options.path}' does not exist.`)
    return { type: node.kind === 'dir' ? 'directory' : 'file' }
  }

  async mkdir(options: { path: string; directory: unknown; recursive: boolean }): Promise<void> {
    this.dir(options.directory)
    this.calls.push(`mkdir ${options.path}`)
    const p = MockDisk.clean(options.path)
    if (this.disk.get(p)) this.reject(ERR.alreadyExists, `Directory at '${p}' already exists, cannot be overwritten.`)
    const missing: string[] = []
    let folder = p
    while (!this.disk.get(folder)) {
      missing.push(folder)
      folder = MockDisk.parent(folder)
    }
    if (missing.length > 1 && !options.recursive) this.reject(ERR.noParent, 'Missing parent directory')
    if (this.disk.get(folder)?.kind === 'file') this.reject(ERR.failed, `${folder} is a file`)
    for (const m of missing) this.disk.nodes.set(m, { kind: 'dir' })
  }

  private delete(method: string, path: string, recursive: boolean): void {
    const p = MockDisk.clean(path)
    const node = this.disk.get(p)
    if (!node) this.reject(ERR.doesNotExist, `'${method}' failed because file at '${p}' does not exist.`)
    if (node.kind === 'dir' && this.disk.below(p).length > 0 && !recursive) this.reject(ERR.children, 'Cannot delete directory with children')
    for (const key of this.disk.below(p)) this.disk.nodes.delete(key)
    this.disk.nodes.delete(p)
  }

  async deleteFile(options: { path: string; directory: unknown }): Promise<void> {
    this.dir(options.directory)
    this.calls.push(`deleteFile ${options.path}`)
    this.delete('deleteFile', options.path, false)
  }

  async rmdir(options: { path: string; directory: unknown; recursive: boolean }): Promise<void> {
    this.dir(options.directory)
    this.calls.push(`rmdir ${options.path}`)
    this.delete('rmdir', options.path, options.recursive)
  }

  async getUri(options: { path: string; directory: unknown }): Promise<{ uri: string }> {
    this.dir(options.directory)
    const p = MockDisk.clean(options.path)
    return { uri: p === '' ? `file://${DATA_ROOT}` : `file://${DATA_ROOT}/${p}` }
  }
}

/** Our AtomicFiles plugin (AtomicFiles.kt): a temp file, then one atomic replace; port error codes. */
export class MockAtomicFiles implements AtomicFilesPlugin {
  readonly disk: MockDisk
  readonly calls: string[] = []
  /** Called after the temp is written and before the replace; throw to "crash" there. */
  faultBeforeReplace: (() => void) | undefined

  constructor(disk: MockDisk) {
    this.disk = disk
  }

  private resolve(path: string): string {
    const parts = path.split('/').filter((part) => part !== '' && part !== '.')
    if (parts.length === 0 || parts.includes('..') || path.startsWith('/')) throw new PluginRejection('invalid', `path not accepted: ${path}`)
    return parts.join('/')
  }

  private folders(folder: string): void {
    if (folder === '' || this.disk.get(folder)?.kind === 'dir') return
    if (this.disk.get(folder)?.kind === 'file') throw new PluginRejection('exists', `${folder} is a file`)
    this.folders(MockDisk.parent(folder))
    this.disk.nodes.set(folder, { kind: 'dir' })
  }

  async writeTextAtomic(options: { path: string; text: string; suffix: string }): Promise<object> {
    this.calls.push(`writeTextAtomic ${options.path} ${options.suffix}`)
    const target = this.resolve(options.path)
    if (!/^[0-9a-z]{9}-[0-9a-z]{1,32}$/.test(options.suffix)) throw new PluginRejection('invalid', `temp suffix not accepted: ${options.suffix}`)
    if (this.disk.get(target)?.kind === 'dir') throw new PluginRejection('exists', `${target} is a folder`)
    this.folders(MockDisk.parent(target))
    const temp = `${target}.tmp-${options.suffix}`
    this.disk.nodes.set(temp, { kind: 'file', text: options.text })
    this.faultBeforeReplace?.()
    this.disk.move(temp, target) // rename(2): the target is replaced in one step
    return {}
  }

  async moveFile(options: { from: string; to: string }): Promise<object> {
    this.calls.push(`moveFile ${options.from} -> ${options.to}`)
    const from = this.resolve(options.from)
    const to = this.resolve(options.to)
    const node = this.disk.get(from)
    if (!node) throw new PluginRejection('not-found', `nothing at ${from}`)
    if (node.kind === 'dir') throw new PluginRejection('invalid', `${from} is a folder`)
    if (this.disk.get(to)?.kind === 'dir') throw new PluginRejection('exists', `${to} is a folder`)
    if (from === to) return {}
    this.folders(MockDisk.parent(to))
    this.disk.move(from, to)
    return {}
  }
}

type ScanReply = Awaited<ReturnType<ScannerPlugin['scan']>>

/** Our Scanner plugin: answers each scan with the next scripted reply or rejection. */
export class MockScanner implements ScannerPlugin {
  readonly calls: Array<{ maxPages: number }> = []
  readonly replies: Array<ScanReply | PluginRejection> = []

  async scan(options: { maxPages: number }): Promise<ScanReply> {
    this.calls.push(options)
    const next = this.replies.shift()
    if (!next) throw new Error('MockScanner: no reply scripted')
    if (next instanceof PluginRejection) throw next
    return next
  }
}

class Listeners<T> {
  readonly list: Array<{ event: string; listener: (value: T) => void }> = []

  add(event: string, listener: (value: T) => void): Promise<ListenerHandle> {
    const entry = { event, listener }
    this.list.push(entry)
    return Promise.resolve({
      remove: async () => {
        const index = this.list.indexOf(entry)
        if (index >= 0) this.list.splice(index, 1)
      },
    })
  }

  fire(event: string, value: T): void {
    for (const entry of [...this.list]) if (entry.event === event) entry.listener(value)
  }

  count(event: string): number {
    return this.list.filter((entry) => entry.event === event).length
  }
}

/** Our Reader plugin: records calls; a test sends the native events with `emit`. */
export class MockReader implements ReaderPlugin {
  readonly calls: Array<{ method: 'read' | 'cancel'; options: { jobId: string; pages?: string[] } }> = []
  readonly listeners = new Listeners<ReaderPluginEvent>()
  /** The next `read` rejects with this. */
  rejectNextRead: PluginRejection | undefined
  /** Whether the listener was in place when `read` was called. */
  listeningAtRead: boolean[] = []

  async read(options: { jobId: string; pages: string[] }): Promise<{ jobId: string }> {
    this.listeningAtRead.push(this.listeners.count('readerEvent') > 0)
    this.calls.push({ method: 'read', options })
    const rejection = this.rejectNextRead
    this.rejectNextRead = undefined
    if (rejection) throw rejection
    return { jobId: options.jobId }
  }

  async cancel(options: { jobId: string }): Promise<{ cancelled: boolean }> {
    this.calls.push({ method: 'cancel', options })
    return { cancelled: true }
  }

  addListener(event: 'readerEvent', listener: (event: ReaderPluginEvent) => void): Promise<ListenerHandle> {
    return this.listeners.add(event, listener)
  }

  emit(event: ReaderPluginEvent): void {
    this.listeners.fire('readerEvent', event)
  }

  /** The job id of the last `read`. */
  get jobId(): string {
    return this.calls.filter((c) => c.method === 'read').at(-1)!.options.jobId
  }
}

/** @capacitor/app: a test fires its events. */
export class MockApp implements AppPlugin {
  readonly listeners = new Listeners<{ canGoBack: boolean }>()
  minimized = 0

  addListener(event: 'pause' | 'resume' | 'backButton', listener: (event: { canGoBack: boolean }) => void): Promise<ListenerHandle> {
    return this.listeners.add(event, listener)
  }

  async minimizeApp(): Promise<void> {
    this.minimized += 1
  }

  fire(event: 'pause' | 'resume' | 'backButton'): void {
    this.listeners.fire(event, { canGoBack: false })
  }
}

export class MockDevice implements DevicePlugin {
  tag = 'nl-BE'
  async getLanguageTag(): Promise<{ value: string }> {
    return { value: this.tag }
  }
}

export class MockKeepAwake implements KeepAwakePlugin {
  readonly log: string[] = []
  async keepAwake(): Promise<void> {
    this.log.push('keepAwake')
  }

  async allowSleep(): Promise<void> {
    this.log.push('allowSleep')
  }
}

export interface MockPlugins extends CapacitorPlugins {
  disk: MockDisk
  filesystem: MockFilesystem
  atomicFiles: MockAtomicFiles
  scanner: MockScanner
  reader: MockReader
  app: MockApp
  device: MockDevice
  keepAwake: MockKeepAwake
}

export function mockPlugins(): MockPlugins {
  const disk = new MockDisk()
  return {
    disk,
    filesystem: new MockFilesystem(disk),
    atomicFiles: new MockAtomicFiles(disk),
    scanner: new MockScanner(),
    reader: new MockReader(),
    app: new MockApp(),
    device: new MockDevice(),
    keepAwake: new MockKeepAwake(),
    convertFileSrc: (uri) => uri.replace('file://', 'https://localhost/_capacitor_file_'),
  }
}
