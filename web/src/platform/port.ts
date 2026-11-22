/*
 * The platform port (practice-app design D2): everything `app/` knows about the phone. It has four
 * parts: files, the page scanner, the music reader and the device. The adapters implement it:
 *
 *   platform/capacitor/  the app on the phone (Capacitor plugins; practice-app task 10.5)
 *   platform/fake/       the quick and browser layers: in-memory files, scripted scanner and reader
 *   platform/browserDev/ `npm run dev` in desktop Chrome: IndexedDB files, a file-input "scanner",
 *                        a reader that answers with committed MusicXML
 *
 * `app/` and `core/` import this file and nothing else from `platform/`. Every call that does I/O
 * returns a promise. The event shapes follow what the real Scanner and Reader plugins return
 * (openspec/changes/archive/2026-11-18-practice-app/evidence/spike.md).
 */

export type PlatformErrorCode =
  /** The scanner cannot run on this phone right now (Google Play services missing or outdated, the camera unusable). */
  | 'unavailable'
  /** A file or folder does not exist. */
  | 'not-found'
  /** `rename` onto an existing folder. */
  | 'exists'
  /** A path or argument the port does not accept. */
  | 'invalid'
  /** Anything else the platform reports. */
  | 'failed'

/** What the port rejects with. Callers branch on `code`, never on the message. */
export class PlatformError extends Error {
  readonly code: PlatformErrorCode

  constructor(code: PlatformErrorCode, message: string) {
    super(message)
    this.name = 'PlatformError'
    this.code = code
  }
}

// ---- Files ---------------------------------------------------------------------------------

export interface FileEntry {
  /** The name inside the folder, not the whole path. Hidden entries (starting with ".") are listed too. */
  name: string
  kind: 'file' | 'folder'
}

/**
 * The app's private files. A path is relative to the app's data folder, with "/" as the separator
 * and no ".." part (rejected with `invalid`). One more kind of path is accepted wherever a file is
 * read (`readText`, the source of `copy`, `imageUrl`, `Reader.read`) and by `remove`, never where
 * one is written: the `path` of a scanned page, which an adapter may give as an absolute path
 * inside the app's own files (an absolute path outside them is rejected with `invalid`). The
 * adapter resolves both, so the path a scan returns goes as it is to `copy`, `imageUrl`,
 * `Reader.read` and `remove`.
 *
 * A folder exists while something is inside it. An adapter may keep an empty folder after its last
 * file is removed, or not; the app must not depend on either.
 */
export interface Files {
  /** The text of a file (UTF-8). Rejects with `not-found` when there is no such file. */
  readText(path: string): Promise<string>
  /** Writes a file, replacing it, and creates the folders above it. Not atomic: use `writeTextAtomic` for anything that must survive a crash. */
  writeText(path: string, text: string): Promise<void>
  /**
   * Writes a file so that a crash or failure leaves the old content, or no file when there was none,
   * never half a file: it writes `<path>.tmp-<suffix>` (flushed to the disk), then replaces the
   * target with it.
   *
   * - Replacing the target MUST be one atomic step (POSIX `rename`, `Os.rename`, iOS
   *   `Data.write(options: .atomic)`): at no moment is there no file at [path]. An adapter must not
   *   build it on a delete-then-rename, which is what Capacitor's `Filesystem.rename` does on
   *   Android (practice-app design D4); a crash between the two would leave the target missing and
   *   the temp file holding the only copy.
   * - The suffix starts with the time of the write, so the temp files of one target sort oldest
   *   first by name: nine base-36 digits of milliseconds since 1970, "-", then random characters
   *   (`tempSuffix` in `atomicWrite.ts`). The start-up recovery relies on this to pick the newest.
   * - The adapters with a key-value store use `atomicWriteText`.
   */
  writeTextAtomic(path: string, text: string): Promise<void>
  /** Copies one file, byte for byte (images included), replacing the target and creating the folders above it. `not-found` when [from] is missing. */
  copy(from: string, to: string): Promise<void>
  /**
   * Moves a file or a folder with everything in it, creating the folders above [to]. An existing
   * target file is replaced; an existing target folder is not touched and the call rejects with
   * `exists`. `not-found` when [from] is missing. A new piece is built in a hidden folder and
   * renamed into place.
   */
  rename(from: string, to: string): Promise<void>
  /** What is in a folder (not below it), sorted by name. A folder that does not exist is empty. */
  list(folder: string): Promise<FileEntry[]>
  /** Deletes a file, or a folder with everything in it. Nothing happens when it does not exist. */
  remove(path: string): Promise<void>
  /** A URL an `<img>` can show for the image file at [path]. `not-found` when there is no such file. */
  imageUrl(path: string): Promise<string>
}

// ---- Scanner -------------------------------------------------------------------------------

export interface ScannedPage {
  /** Where the cropped page image is. See `Files` for what accepts it. */
  path: string
  /** Pixels. */
  width: number
  height: number
}

/**
 * Not cancelled: at least one page, in the order the user left them in the scanner.
 * Cancelled: the user left the scanner without pages. That is a result, not an error.
 */
export type ScanResult = { cancelled: false; pages: ScannedPage[] } | { cancelled: true; pages: [] }

export interface Scanner {
  /**
   * Opens the phone's page scanner for up to [maxPages] pages (the user crops, reorders and
   * retakes in the scanner itself). Rejects with a `PlatformError` of code `unavailable` when the
   * scanner cannot run.
   */
  scan(options: { maxPages: number }): Promise<ScanResult>
}

// ---- Reader --------------------------------------------------------------------------------

/** The steps of reading one page, in this order. */
export type ReaderStage = 'queued' | 'prepare' | 'segment' | 'detect' | 'read' | 'write'

/**
 * One staff of a page that was read, in reading order (design D7). `box` is the system's staff
 * lines (no ledger lines, stems or text) as fractions 0..1 of the page image the reader was given,
 * with `x`, `y` its top left. `firstBar` and `lastBar` are bar numbers of that page (its first bar
 * is 1), first and last included; the staves of a page run on without a gap.
 */
export interface ReaderStaff {
  box: { x: number; y: number; width: number; height: number }
  firstBar: number
  lastBar: number
}

/**
 * What a reading job sends. `page` is the 0-based index into the list given to `read`, and `pages`
 * is the length of that list.
 *
 * For each page, in order: any number of `progress` events, then one of `done`, `no-music` or
 * `failed`. A page without music or one that failed does not stop the job: the next page is still
 * read, unless the app cancels. The job's last event is `finished`, exactly once, and nothing
 * follows it.
 *
 * - `progress.fraction` goes from 0 to 1 within that page and never moves backwards.
 * - `finished.status` is `done` when the job ran through every page (whatever each page gave),
 *   `cancelled` after `cancel`, and `failed` when the job itself broke or could not start (with a
 *   message).
 * - `done` carries the page's raw MusicXML and, next to it (design D7, outside the MusicXML), when
 *   the reader knows them: `staves`, where the page's staves are, and `timeEstimated`, true when
 *   the page's time signature was not read but estimated by the reader (homr writes n/4 from the
 *   median bar length when none is printed). `staves` is left out when the reader's bar counts per
 *   staff do not add up.
 */
export type ReaderEvent =
  | { type: 'progress'; page: number; pages: number; stage: ReaderStage; fraction: number }
  | { type: 'done'; page: number; pages: number; musicxml: string; staves?: ReaderStaff[]; timeEstimated?: boolean }
  | { type: 'no-music'; page: number; pages: number; message?: string }
  | { type: 'failed'; page: number; pages: number; message: string }
  | { type: 'finished'; pages: number; status: 'done' | 'cancelled' | 'failed'; message?: string }

export interface ReaderJob {
  /**
   * Stops the job: the page being read is abandoned, the rest are skipped, and `finished` with
   * status `cancelled` follows. Page events already on their way may still arrive first. Does
   * nothing once the job has finished.
   */
  cancel(): Promise<void>
}

export interface Reader {
  /**
   * Reads the pages (paths as `Scanner.scan` returns them) in order, as ONE job. [onEvent] is
   * called for every event, including the first, so none is missed. A job that cannot start
   * reports it as `finished` with status `failed`.
   */
  read(pages: string[], onEvent: (event: ReaderEvent) => void): ReaderJob
}

// ---- Device --------------------------------------------------------------------------------

export interface Device {
  /** Keeps the screen on while the player is playing (design D12). */
  setKeepAwake(on: boolean): Promise<void>
  /** The app goes to the background (Capacitor's pause event; `visibilitychange` in a browser). Returns the function that removes the listener. */
  onPause(listener: () => void): () => void
  /** The app comes back to the foreground. Returns the function that removes the listener. */
  onResume(listener: () => void): () => void
  /**
   * The back button (Android). The handler returns true when the app dealt with it; on false the
   * platform does what it does without a handler (leave the app). Returns the function that
   * removes the handler.
   */
  onBackButton(handler: () => boolean): () => void
}

// ---- The whole port ------------------------------------------------------------------------

export interface Platform {
  files: Files
  scanner: Scanner
  reader: Reader
  device: Device
}
