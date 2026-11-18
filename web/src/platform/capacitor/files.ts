import { tempSuffix } from '../atomicWrite.ts'
import { normalisePath } from '../keyValueFiles.ts'
import { PlatformError } from '../port.ts'
import type { FileEntry, Files, PlatformErrorCode } from '../port.ts'
import { DATA, FILESYSTEM_ERRORS, UTF8, errorCode, errorMessage } from './plugins.ts'
import type { AtomicFilesPlugin, FilesystemPlugin } from './plugins.ts'

const PORT_CODES: readonly string[] = ['unavailable', 'not-found', 'exists', 'invalid', 'failed'] satisfies PlatformErrorCode[]

/** A rejection of one of our own plugins (its code is a port code) as a `PlatformError`. */
export function portError(error: unknown): PlatformError {
  if (error instanceof PlatformError) return error
  const code = errorCode(error)
  return new PlatformError(code !== undefined && PORT_CODES.includes(code) ? (code as PlatformErrorCode) : 'failed', errorMessage(error))
}

function isAbsolute(path: string): boolean {
  return path.startsWith('/') || path.startsWith('file:')
}

function withoutScheme(uri: string): string {
  return uri.startsWith('file://') ? decodeURI(uri.slice('file://'.length)) : uri.startsWith('file:') ? decodeURI(uri.slice('file:'.length)) : uri
}

function parentOf(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash < 0 ? '' : path.slice(0, slash)
}

/**
 * The port's paths on the phone: relative to the app's data folder (Capacitor's `Directory.Data`,
 * Android's `filesDir`). Where a file is read, and by `remove`, a scanned page's path is accepted
 * as it is, also when it is absolute: it must then lie inside the data folder (port.ts, `Files`).
 */
export class DataPaths {
  private readonly filesystem: FilesystemPlugin
  private root: Promise<string> | undefined

  constructor(filesystem: FilesystemPlugin) {
    this.filesystem = filesystem
  }

  /** A path the port writes to: relative, normalised, not empty. Absolute paths are refused. */
  relative(path: string): string {
    if (isAbsolute(path)) throw new PlatformError('invalid', `an absolute path is only accepted where a file is read: ${path}`)
    const normal = normalisePath(path)
    if (normal === '') throw new PlatformError('invalid', 'a file path is needed')
    return normal
  }

  /** A folder to list: relative and normalised; "" is the data folder itself. */
  folder(path: string): string {
    if (isAbsolute(path)) throw new PlatformError('invalid', `an absolute path is not accepted here: ${path}`)
    return normalisePath(path)
  }

  /** A path the port reads (or removes): relative, or absolute inside the data folder. Gives the relative path. */
  async readable(path: string): Promise<string> {
    if (!isAbsolute(path)) return this.relative(path)
    const absolute = withoutScheme(path)
    const root = await this.dataRoot()
    if (!absolute.startsWith(`${root}/`)) throw new PlatformError('invalid', `outside the app's files: ${path}`)
    return this.relative(absolute.slice(root.length + 1).replace(/^\/+/, ''))
  }

  private dataRoot(): Promise<string> {
    this.root ??= this.filesystem.getUri({ path: '', directory: DATA }).then(
      ({ uri }) => withoutScheme(uri).replace(/\/+$/, ''),
      (error: unknown) => {
        this.root = undefined
        throw new PlatformError('failed', `the app's files folder is unknown: ${errorMessage(error)}`)
      },
    )
    return this.root
  }
}

/**
 * `Files` on the phone (practice-app task 10.5). Everything goes through Capacitor's Filesystem
 * plugin, mapped to the port's semantics, except what must be atomic: `writeTextAtomic`, and
 * `rename` of a file, which go through our AtomicFiles plugin (design D4). The Filesystem plugin's
 * `rename` deletes an existing target before renaming, so it is only used for folders, where the
 * port refuses an existing target anyway.
 *
 * How the Filesystem plugin's behaviour on Android is mapped:
 * - DoesNotExist on a missing path: `list` gives [], `remove` does nothing, reads give `not-found`.
 * - NoParentDirectory (copy, rename): the folders are created and the call is made again.
 * - Files and folders are removed with `deleteFile` and `rmdir` (recursive) after a `stat`.
 * - A rename onto an existing folder (DestinationDirectoryExists, or a file onto a folder) gives `exists`.
 */
export class CapacitorFiles implements Files {
  private readonly filesystem: FilesystemPlugin
  private readonly atomic: AtomicFilesPlugin
  private readonly paths: DataPaths
  private readonly convertFileSrc: (uri: string) => string

  constructor(filesystem: FilesystemPlugin, atomic: AtomicFilesPlugin, paths: DataPaths, convertFileSrc: (uri: string) => string) {
    this.filesystem = filesystem
    this.atomic = atomic
    this.paths = paths
    this.convertFileSrc = convertFileSrc
  }

  async readText(path: string): Promise<string> {
    const p = await this.paths.readable(path)
    try {
      const { data } = await this.filesystem.readFile({ path: p, directory: DATA, encoding: UTF8 })
      return typeof data === 'string' ? data : await data.text()
    } catch (error) {
      if (errorCode(error) === FILESYSTEM_ERRORS.doesNotExist || (await this.kind(p)) !== 'file') {
        throw new PlatformError('not-found', `no file at ${p}`)
      }
      throw this.failed('read', p, error)
    }
  }

  async writeText(path: string, text: string): Promise<void> {
    const p = this.paths.relative(path)
    try {
      await this.filesystem.writeFile({ path: p, directory: DATA, encoding: UTF8, data: text, recursive: true })
    } catch (error) {
      if ((await this.kind(p)) === 'directory') throw new PlatformError('exists', `${p} is a folder`)
      throw this.failed('write', p, error)
    }
  }

  async writeTextAtomic(path: string, text: string): Promise<void> {
    const p = this.paths.relative(path)
    try {
      await this.atomic.writeTextAtomic({ path: p, text, suffix: tempSuffix() })
    } catch (error) {
      throw portError(error)
    }
  }

  async copy(from: string, to: string): Promise<void> {
    const source = await this.paths.readable(from)
    const target = this.paths.relative(to)
    if ((await this.kind(source)) !== 'file') throw new PlatformError('not-found', `no file at ${source}`)
    if ((await this.kind(target)) === 'directory') throw new PlatformError('exists', `${target} is a folder`)
    const copy = () => this.filesystem.copy({ from: source, to: target, directory: DATA, toDirectory: DATA })
    try {
      await copy()
    } catch (error) {
      if (errorCode(error) !== FILESYSTEM_ERRORS.noParentDirectory) throw this.failed('copy', source, error)
      await this.makeFolders(parentOf(target))
      try {
        await copy()
      } catch (again) {
        throw this.failed('copy', source, again)
      }
    }
  }

  async rename(from: string, to: string): Promise<void> {
    const source = this.paths.relative(from)
    const target = this.paths.relative(to)
    const kind = await this.kind(source)
    if (kind === undefined) throw new PlatformError('not-found', `nothing at ${source}`)
    if (source === target) return
    if (kind === 'file') {
      // One atomic rename(2) that replaces a target file; never the plugin's delete-then-rename.
      try {
        await this.atomic.moveFile({ from: source, to: target })
      } catch (error) {
        throw portError(error)
      }
      return
    }
    if (target.startsWith(`${source}/`)) throw new PlatformError('invalid', `cannot move ${source} into itself`)
    const rename = () => this.filesystem.rename({ from: source, to: target, directory: DATA, toDirectory: DATA })
    try {
      await rename()
    } catch (error) {
      const code = errorCode(error)
      if (code === FILESYSTEM_ERRORS.alreadyExists || code === FILESYSTEM_ERRORS.notAllowed) throw new PlatformError('exists', `${target} already exists`)
      if (code === FILESYSTEM_ERRORS.doesNotExist) throw new PlatformError('not-found', `nothing at ${source}`)
      if (code !== FILESYSTEM_ERRORS.noParentDirectory) throw this.failed('rename', source, error)
      await this.makeFolders(parentOf(target))
      try {
        await rename()
      } catch (again) {
        throw this.failed('rename', source, again)
      }
    }
  }

  async list(folder: string): Promise<FileEntry[]> {
    const p = this.paths.folder(folder)
    let files: Array<{ name: string; type: 'file' | 'directory' }>
    try {
      files = (await this.filesystem.readdir({ path: p, directory: DATA })).files
    } catch (error) {
      if (errorCode(error) === FILESYSTEM_ERRORS.doesNotExist) return []
      throw this.failed('list', p, error)
    }
    return files
      .map((file): FileEntry => ({ name: file.name, kind: file.type === 'directory' ? 'folder' : 'file' }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  }

  async remove(path: string): Promise<void> {
    const p = await this.paths.readable(path)
    const kind = await this.kind(p)
    if (kind === undefined) return
    try {
      if (kind === 'directory') await this.filesystem.rmdir({ path: p, directory: DATA, recursive: true })
      else await this.filesystem.deleteFile({ path: p, directory: DATA })
    } catch (error) {
      if (errorCode(error) === FILESYSTEM_ERRORS.doesNotExist) return
      throw this.failed('remove', p, error)
    }
  }

  async imageUrl(path: string): Promise<string> {
    const p = await this.paths.readable(path)
    if ((await this.kind(p)) !== 'file') throw new PlatformError('not-found', `no file at ${p}`)
    try {
      const { uri } = await this.filesystem.getUri({ path: p, directory: DATA })
      return this.convertFileSrc(uri)
    } catch (error) {
      throw this.failed('imageUrl', p, error)
    }
  }

  /** What is at [path]: a file, a folder, or nothing (undefined). */
  private async kind(path: string): Promise<'file' | 'directory' | undefined> {
    try {
      return (await this.filesystem.stat({ path, directory: DATA })).type
    } catch (error) {
      if (errorCode(error) === FILESYSTEM_ERRORS.doesNotExist) return undefined
      throw this.failed('stat', path, error)
    }
  }

  private async makeFolders(folder: string): Promise<void> {
    if (folder === '') return
    try {
      await this.filesystem.mkdir({ path: folder, directory: DATA, recursive: true })
    } catch (error) {
      if (errorCode(error) === FILESYSTEM_ERRORS.alreadyExists) return
      throw this.failed('mkdir', folder, error)
    }
  }

  private failed(operation: string, path: string, error: unknown): PlatformError {
    return new PlatformError('failed', `${operation} ${path}: ${errorMessage(error)}`)
  }
}
