/*
 * The parts of the Capacitor plugins the adapter uses, as plain interfaces. The adapter takes them
 * as arguments (`createCapacitorPlatformWith`), so the quick layer runs it in node against mocks
 * that behave like the real plugins (web/test/capacitorAdapter.test.ts); `index.ts` passes the real
 * ones and is the only file here that imports the @capacitor packages.
 *
 * A plugin call rejects with an error whose `code` says what happened: the Filesystem plugin's
 * "OS-PLUG-FILE-00NN" codes (FILESYSTEM_ERRORS), and for our own plugins (android/app/src/main/
 * java/be/imagitech/snapsody/) the port's error codes ("unavailable", "not-found", "exists", "invalid",
 * "failed"). Examples of our plugins' calls and events: fixtures/bridge/.
 */

import type { Directory, Encoding } from '@capacitor/filesystem'

export interface ListenerHandle {
  remove(): Promise<void>
}

/** The Filesystem plugin's error codes on Android (@capacitor/filesystem 8.1.5, FilesystemErrors.kt). */
export const FILESYSTEM_ERRORS = {
  invalidInput: 'OS-PLUG-FILE-0005',
  invalidPath: 'OS-PLUG-FILE-0006',
  /** DoesNotExist: a missing file or folder (read, list, stat, delete, rename and copy sources). */
  doesNotExist: 'OS-PLUG-FILE-0008',
  /** Not allowed: for example a rename or copy that mixes a file and a folder. */
  notAllowed: 'OS-PLUG-FILE-0009',
  /** mkdir on an existing folder, or a folder rename onto an existing folder (DestinationDirectoryExists). */
  alreadyExists: 'OS-PLUG-FILE-0010',
  /** NoParentDirectory: the folder above a write, copy or rename target is missing. */
  noParentDirectory: 'OS-PLUG-FILE-0011',
  /** A folder delete with recursive false and something inside. */
  cannotDeleteChildren: 'OS-PLUG-FILE-0012',
  /** Anything else (an IOException). */
  operationFailed: 'OS-PLUG-FILE-0013',
} as const

/**
 * Capacitor's `Directory.Data`: the app's private files folder (`Context.filesDir` on Android).
 * The enum's value, without importing the plugin at run time (a type-only import keeps this file
 * loadable in node).
 */
export const DATA = 'DATA' as unknown as Directory

/** Capacitor's `Encoding.UTF8`, likewise. */
export const UTF8 = 'utf8' as unknown as Encoding

export interface FilesystemPlugin {
  readFile(options: { path: string; directory: Directory; encoding: Encoding }): Promise<{ data: string | Blob }>
  writeFile(options: { path: string; directory: Directory; encoding: Encoding; data: string; recursive: boolean }): Promise<unknown>
  copy(options: { from: string; to: string; directory: Directory; toDirectory: Directory }): Promise<unknown>
  rename(options: { from: string; to: string; directory: Directory; toDirectory: Directory }): Promise<void>
  readdir(options: { path: string; directory: Directory }): Promise<{ files: Array<{ name: string; type: 'file' | 'directory' }> }>
  stat(options: { path: string; directory: Directory }): Promise<{ type: 'file' | 'directory' }>
  mkdir(options: { path: string; directory: Directory; recursive: boolean }): Promise<void>
  deleteFile(options: { path: string; directory: Directory }): Promise<void>
  rmdir(options: { path: string; directory: Directory; recursive: boolean }): Promise<void>
  getUri(options: { path: string; directory: Directory }): Promise<{ uri: string }>
}

/** Our AtomicFiles plugin (android/.../files/AtomicFilesPlugin.kt); paths relative to the data folder. */
export interface AtomicFilesPlugin {
  writeTextAtomic(options: { path: string; text: string; suffix: string }): Promise<unknown>
  moveFile(options: { from: string; to: string }): Promise<unknown>
}

/** Our Scanner plugin (android/.../scanner/ScannerPlugin.kt). */
export interface ScannerPlugin {
  scan(options: { maxPages: number }): Promise<{ cancelled: boolean; pages: Array<{ path: string; width: number; height: number }> }>
}

/** What our Reader plugin sends as `readerEvent`: the port's `ReaderEvent` plus the job's id. */
export type ReaderPluginEvent = Record<string, unknown> & { jobId?: string; type?: string }

/** Our Reader plugin (android/.../reader/ReaderPlugin.kt). */
export interface ReaderPlugin {
  read(options: { jobId: string; pages: string[] }): Promise<unknown>
  cancel(options: { jobId: string }): Promise<unknown>
  addListener(event: 'readerEvent', listener: (event: ReaderPluginEvent) => void): Promise<ListenerHandle>
}

/** @capacitor/app. */
export interface AppPlugin {
  addListener(event: 'pause' | 'resume', listener: () => void): Promise<ListenerHandle>
  addListener(event: 'backButton', listener: (event: { canGoBack: boolean }) => void): Promise<ListenerHandle>
  minimizeApp(): Promise<void>
}

/** @capacitor-community/keep-awake. */
export interface KeepAwakePlugin {
  keepAwake(): Promise<void>
  allowSleep(): Promise<void>
}

export interface CapacitorPlugins {
  filesystem: FilesystemPlugin
  atomicFiles: AtomicFilesPlugin
  scanner: ScannerPlugin
  reader: ReaderPlugin
  app: AppPlugin
  keepAwake: KeepAwakePlugin
  /** `Capacitor.convertFileSrc`: a file:// URI as a URL the WebView can load. */
  convertFileSrc(uri: string): string
}

/** The `code` of a plugin rejection, or undefined. */
export function errorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' ? code : undefined
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
