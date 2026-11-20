import { signal } from '@preact/signals'
import type { ReadonlySignal, Signal } from '@preact/signals'
import { appendPages, preparePages } from '../core/pages/pages.ts'
import type { PageOptions, PageRange, PreparedPages } from '../core/pages/pages.ts'
import type { Files, Reader, ReaderEvent, ReaderJob, Scanner } from '../platform/port.ts'
import { parseMusicXml } from '../core/score/musicxml.ts'
import type { Score } from '../core/score/model.ts'
import { DEFAULT_PRACTICE, LibraryError } from './library.ts'
import type { Library, NewPage, PieceInfo, Staff } from './library.ts'
import type { Settings } from './settings.ts'

/*
 * Adding music (practice-app task 9.5, design D6; specs `score-capture` and `score-recognition`):
 * the hint, the page scanner, reading the pages, and saving them as a new piece or after the last
 * bar of an existing one.
 *
 *   hint ──► scanning ──► reading ──► [parts] ──► saving ──► saved
 *     │          │           │            │
 *     │          │           │            └──► cancelled  (Back: nothing created)
 *     │          │           ├──► no-music (page N)  ──► scanAgain() ──► scanning
 *     │          │           ├──► failed   (page N, or the reader)  ──► scanAgain()
 *     │          │           └──► cancelled  (cancel(): nothing created, the piece unchanged)
 *     │          ├──► cancelled  (the user left the scanner without pages)
 *     │          └──► unavailable  (the scanner cannot run; no other way is offered)
 *     └──► cancelled
 *
 * - The hint is shown every time until the user ticks "don't show this again" (`scanHintSeen`).
 * - The scanned pages are read as ONE Reader job, in order (design D6). Each page's raw reading is
 *   kept, and the pages are merged after the last one: `preparePages` for a new piece, and for an
 *   existing piece `appendPages` on its current score, loaded right before appending, so the bars it
 *   has are never prepared again. The save then names the score it was built on (`basedOn`), and
 *   the library refuses it when the piece was saved in between (`conflict`): the flow then loads
 *   the piece again and appends once more.
 * - No music on a page (spec `score-recognition` "Recognition failure"): the reading stops, no
 *   piece is created and no page is kept, and the flow offers to scan again. A page that failed to
 *   read is handled the same way (the spec has no scenario for it; the catalogue's `add.failed.*`
 *   says "Page N could not be read ... Nothing was added"). The first such page ends the job: the
 *   rest is not read.
 * - The parts step (spec `score-recognition` "Choose the parts to keep", design D4): when the combined pages of a NEW
 *   piece hold more than one part, the flow waits in `parts` with every part kept and the first one chosen as the
 *   user's. `setKept`, `setPlay` and `continueParts` drive it; Continue is refused while no part is kept. The piece is
 *   then saved with the kept parts only, and `practice.json` gets the chosen part. Back is `cancel()`. With one part, and
 *   for pages added to a piece (matched against `partsRead`), there is no step.
 * - A part found only on a later page is left out of the combined score with a warning; the `saved` state tells it
 *   (`partDropped`) so the screen can say so.
 * - Cancel works while the pages are being read. Once saving has started it is too late.
 * - The scanner's files (the paths it returned in this flow, and only those) are removed whenever
 *   the flow ends, after the piece is saved (the save copies them) or when nothing is saved.
 *   Removing is best effort: a file that stays never fails a saved piece.
 * - This module does not navigate. On `saved` the screen hands off (to practice for a new piece,
 *   back to the editor for added pages); on `cancelled` it goes back to where adding started.
 */

/** The most pages one scan may give (spec `score-capture`, "Several pages in one piece"). */
export const MAX_PAGES = 10

/** Where one page is while the pages are read. */
export type PageState = 'done' | 'current' | 'waiting'

export interface ReadingProgress {
  /** The page being read now, 1-based: "Reading page {page} of {pages}". */
  page: number
  pages: number
  /** 0..1 over all the pages; it never moves backwards. */
  fraction: number
  /** Each page, in order. */
  states: readonly PageState[]
}

/** Why adding music failed. */
export type FailReason =
  /** A page could not be read (`page` says which). */
  | 'page'
  /** The reader broke or could not start, or the readings could not be combined. */
  | 'reading'
  /** The piece could not be saved (a full disk, for example). */
  | 'save'

export type AddMusicState =
  /** Not started. */
  | { readonly step: 'idle' }
  /** The hint before the scanner (spec "Hint before scanning"). */
  | { readonly step: 'hint' }
  /** The scanner is open. */
  | { readonly step: 'scanning' }
  /** The page scanner cannot run on this phone right now. */
  | { readonly step: 'unavailable' }
  | { readonly step: 'reading'; readonly progress: ReadingProgress }
  | { readonly step: 'saving' }
  /**
   * The parts step: one entry of `parts` per part of the combined score, in order. `keep` says which are kept (at least
   * one to continue) and `play` is the index of the part the user plays (always a kept one). `score` is the whole combined
   * score, for drawing the first line of each part.
   */
  | { readonly step: 'parts'; readonly parts: readonly PartChoice[]; readonly keep: readonly boolean[]; readonly play: number; readonly score: Score }
  /** No music on page [page] (1-based): nothing was saved; offer `scanAgain`. */
  | { readonly step: 'no-music'; readonly page: number; readonly pages: number }
  /** Nothing was saved; offer `scanAgain`. `page` (1-based) for reason `page`. */
  | { readonly step: 'failed'; readonly reason: FailReason; readonly page?: number; readonly message: string }
  /** Nothing was saved and the existing piece, if any, is unchanged: go back to where adding started. */
  | { readonly step: 'cancelled' }
  /** The piece was made (`added` false) or the pages were added to it (`added` true). */
  | { readonly step: 'saved'; readonly pieceId: string; readonly added: boolean; readonly info: PieceInfo; readonly partDropped: boolean }

export type AddMusicStep = AddMusicState['step']

/** A part of the combined score, as the parts step lists it. */
export interface PartChoice {
  readonly id: string
  readonly name: string
  readonly staves: 1 | 2
}

/** What the reader reports for a page next to its MusicXML (design D7), when it knows it. */
export interface PageLayout {
  /**
   * The staves on the page photo, in reading order, with the page's OWN bar numbers (its first bar
   * is 1). `addMusic` turns them into bar numbers of the piece and stores them with the page.
   */
  staves?: Staff[]
  /**
   * The time signature at the start of the page's MusicXML was estimated, not printed (design D7).
   * `core/pages` then treats it as absent (`PageOptions`).
   */
  timeEstimated?: boolean
}

/** The D7 extras of a `done` event, when the reader sends them. */
export function pageLayoutOf(event: Extract<ReaderEvent, { type: 'done' }>): PageLayout {
  const layout: PageLayout = {}
  if (event.staves) layout.staves = event.staves.map((s) => ({ box: { ...s.box }, firstBar: s.firstBar, lastBar: s.lastBar }))
  if (event.timeEstimated !== undefined) layout.timeEstimated = event.timeEstimated
  return layout
}

/** What `core/pages` takes from the reader's report on each page: whether its time was estimated. */
function pageOptions(layouts: readonly PageLayout[]): PageOptions[] {
  return layouts.map((layout) => (layout.timeEstimated === undefined ? {} : { timeEstimated: layout.timeEstimated }))
}

/**
 * A page's staves with bar numbers of the piece, or undefined (the editor then shows the whole
 * photo) when they do not cover the page's bars exactly, in order, or a box is not four fractions
 * from 0 to 1 (design D7: wrong counts store no positions).
 */
export function stavesForPiece(staves: readonly Staff[] | undefined, range: PageRange): Staff[] | undefined {
  if (!staves || staves.length === 0) return undefined
  const offset = range.firstBar - 1
  const bars = range.lastBar - range.firstBar + 1
  let next = 1
  const fraction = (v: unknown): boolean => typeof v === 'number' && v >= 0 && v <= 1
  for (const staff of staves) {
    const box = staff?.box
    if (!box || ![box.x, box.y, box.width, box.height].every(fraction)) return undefined
    if (!Number.isInteger(staff.firstBar) || !Number.isInteger(staff.lastBar)) return undefined
    if (staff.firstBar !== next || staff.lastBar < staff.firstBar) return undefined
    next = staff.lastBar + 1
  }
  if (next !== bars + 1) return undefined
  return staves.map((s) => ({ box: { ...s.box }, firstBar: s.firstBar + offset, lastBar: s.lastBar + offset }))
}

export interface AddMusicDeps {
  scanner: Scanner
  reader: Reader
  /** For removing the scanner's files. */
  files: Pick<Files, 'remove'>
  /** `writePractice` stores the part the user plays after the parts step; without it that choice is not stored. */
  library: Pick<Library, 'create' | 'load' | 'addPages'> & Partial<Pick<Library, 'writePractice'>>
  settings: Pick<Settings, 'scanHintSeen' | 'setScanHintSeen'>
  /** The name of a new piece: `i18n.defaultPieceName`. */
  defaultName: (added: Date) => string
  /** The clock for the default name. */
  now?: () => Date
}

/** Where the pages go: a new piece, or after the last bar of the piece [pieceId]. */
export interface AddMusicTarget {
  pieceId?: string
}

/** How a reading job ended, as far as the flow is concerned. */
type Stop = { kind: 'cancel' } | { kind: 'no-music'; page: number } | { kind: 'page-failed'; page: number; message: string }

interface Reading {
  readonly paths: string[]
  readonly raws: Array<string | undefined>
  readonly layouts: PageLayout[]
  readonly states: PageState[]
  current: number
  fraction: number
  stop: Stop | undefined
  job: ReaderJob | undefined
  finished: (event: Extract<ReaderEvent, { type: 'finished' }>) => void
}

export class AddMusicFlow {
  /** Where the flow is; the screens follow it. */
  readonly state: ReadonlySignal<AddMusicState>
  /** The piece the pages are added to; undefined for a new piece. */
  readonly pieceId: string | undefined
  /**
   * The scanner's image of each page while the pages are read, in order (the reading screen shows the
   * page being read, `ReadingProgress.page`); empty before and after. The files are removed when the
   * flow ends, so a screen shows them only while the step is `reading`.
   */
  get pagePaths(): readonly string[] {
    return this.reading?.paths ?? []
  }

  private readonly deps: AddMusicDeps
  private readonly now: () => Date
  private readonly current: Signal<AddMusicState>
  /** The reading in progress, if any. */
  private reading: Reading | undefined
  /** The scanner's paths of this flow that are not removed yet. */
  private scans: string[] = []
  /** What the parts step is waiting on: the readings to be combined again with the parts that are kept. */
  private pending: { paths: string[]; raws: string[]; layouts: PageLayout[]; prepared: PreparedPages; score: Score } | undefined

  constructor(deps: AddMusicDeps, target: AddMusicTarget = {}) {
    this.deps = deps
    this.now = deps.now ?? (() => new Date())
    this.pieceId = target.pieceId
    this.current = signal<AddMusicState>({ step: 'idle' })
    this.state = this.current
  }

  /**
   * Starts adding music: the hint while the user has not switched it off, else the scanner at
   * once. Resolves when the flow waits for the user again (the hint) or has ended.
   */
  async start(): Promise<void> {
    if (this.current.value.step !== 'idle') return
    if (!this.deps.settings.scanHintSeen.value) {
      this.current.value = { step: 'hint' }
      return
    }
    await this.run()
  }

  /**
   * The hint's button: opens the scanner. With [dontShowAgain] the hint is not shown again; when
   * that setting cannot be saved, the hint still goes for this run and the scan goes ahead.
   */
  async continueFromHint(options: { dontShowAgain?: boolean } = {}): Promise<void> {
    if (this.current.value.step !== 'hint') return
    // Leave the hint before anything is awaited, so a second tap or a cancel cannot start another run.
    this.current.value = { step: 'scanning' }
    if (options.dontShowAgain) await this.deps.settings.setScanHintSeen(true).catch(() => undefined)
    await this.run()
  }

  /** After no music on a page, or a failure: opens the scanner again for all the pages. */
  async scanAgain(): Promise<void> {
    const step = this.current.value.step
    if (step !== 'no-music' && step !== 'failed') return
    await this.run()
  }

  /**
   * Leaves adding music. While the pages are read it stops the reading: nothing is created and a
   * piece that pages were added to stays unchanged; the flow ends `cancelled` once the reader has
   * stopped. Returns false, changing nothing, while the scanner is open (the user leaves it there)
   * and once saving has started.
   */
  async cancel(): Promise<boolean> {
    const step = this.current.value.step
    if (step === 'scanning' || step === 'saving' || step === 'saved' || step === 'cancelled') return false
    const reading = this.reading
    if (step === 'reading' && reading) {
      reading.stop ??= { kind: 'cancel' }
      await reading.job?.cancel()
      return true
    }
    await this.end({ step: 'cancelled' })
    return true
  }

  /** The parts step: keeps or drops part [index]. The part the user plays moves to the first kept part when it is dropped. */
  setKept(index: number, kept: boolean): void {
    const state = this.current.value
    if (state.step !== 'parts' || !(index >= 0 && index < state.parts.length)) return
    const keep = state.keep.map((k, i) => (i === index ? kept : k))
    let play = state.play
    if (!keep[play]) play = Math.max(0, keep.indexOf(true))
    this.current.value = { ...state, keep, play }
  }

  /** The parts step: the user plays part [index]. Only a kept part can be chosen. */
  setPlay(index: number): void {
    const state = this.current.value
    if (state.step !== 'parts' || !state.keep[index]) return
    this.current.value = { ...state, play: index }
  }

  /** The parts step's Continue: saves the piece with the kept parts. Does nothing while no part is kept. */
  async continueParts(): Promise<void> {
    const state = this.current.value
    const pending = this.pending
    if (state.step !== 'parts' || !pending || !state.keep.some(Boolean)) return
    this.pending = undefined
    this.current.value = { step: 'saving' }
    try {
      const prepared = preparePages(pending.raws, pageOptions(pending.layouts), state.keep)
      await this.create(prepared, pending.paths, pending.raws, pending.layouts, state.parts[state.play]!.id)
    } catch (error) {
      await this.end({ step: 'failed', reason: 'save', message: messageOf(error) })
    }
  }

  // ---- inside --------------------------------------------------------------------------------

  /** Scan, read, save: one pass, ending in a state that waits for the user or ends the flow. */
  private async run(): Promise<void> {
    this.current.value = { step: 'scanning' }
    let paths: string[]
    try {
      const result = await this.deps.scanner.scan({ maxPages: MAX_PAGES })
      if (result.cancelled || result.pages.length === 0) {
        await this.end({ step: 'cancelled' })
        return
      }
      paths = result.pages.map((page) => page.path)
    } catch {
      // `unavailable`, or any other way the scanner fails: the spec treats both alike.
      this.current.value = { step: 'unavailable' }
      return
    }
    this.scans.push(...paths)

    const finished = await this.read(paths)
    const reading = this.reading!
    this.reading = undefined
    const stop = reading.stop
    if (stop?.kind === 'cancel' || (stop === undefined && finished.status === 'cancelled')) {
      await this.end({ step: 'cancelled' })
    } else if (stop?.kind === 'no-music') {
      await this.end({ step: 'no-music', page: stop.page, pages: paths.length })
    } else if (stop?.kind === 'page-failed') {
      await this.end({ step: 'failed', reason: 'page', page: stop.page, message: stop.message })
    } else if (finished.status !== 'done' || reading.raws.some((raw) => raw === undefined)) {
      await this.end({ step: 'failed', reason: 'reading', message: finished.message ?? 'the reading stopped' })
    } else {
      await this.save(paths, reading.raws as string[], reading.layouts)
    }
  }

  /** Runs the Reader job over [paths] and resolves with its `finished` event. */
  private read(paths: string[]): Promise<Extract<ReaderEvent, { type: 'finished' }>> {
    return new Promise((resolve) => {
      const reading: Reading = {
        paths,
        raws: paths.map(() => undefined),
        layouts: paths.map(() => ({})),
        states: paths.map(() => 'waiting'),
        current: 0,
        fraction: 0,
        stop: undefined,
        job: undefined,
        finished: resolve,
      }
      this.reading = reading
      this.publish(reading)
      let ended = false
      const job = this.deps.reader.read(paths, (event) => {
        if (ended) return
        if (event.type === 'finished') ended = true
        this.onEvent(reading, event)
      })
      reading.job = job
      // A stop that came before `read` returned (an event delivered at once, or a cancel).
      if (reading.stop && !ended) void job.cancel()
    })
  }

  private onEvent(reading: Reading, event: ReaderEvent): void {
    if (event.type === 'finished') {
      reading.finished(event)
      return
    }
    if (reading.stop) return // what arrives after a stop is not used
    const index = event.page
    if (!(index >= 0 && index < reading.paths.length)) return
    switch (event.type) {
      case 'progress':
        for (let i = 0; i < index; i++) reading.states[i] = 'done'
        if (reading.states[index] !== 'done') reading.states[index] = 'current'
        reading.current = Math.max(reading.current, index)
        reading.fraction = Math.max(reading.fraction, Math.min(1, (index + clamp01(event.fraction)) / reading.paths.length))
        break
      case 'done':
        reading.raws[index] = event.musicxml
        reading.layouts[index] = pageLayoutOf(event)
        reading.states[index] = 'done'
        reading.fraction = Math.max(reading.fraction, (index + 1) / reading.paths.length)
        if (index + 1 < reading.paths.length) {
          reading.current = Math.max(reading.current, index + 1)
          if (reading.states[index + 1] === 'waiting') reading.states[index + 1] = 'current'
        }
        break
      case 'no-music':
        this.stopReading(reading, { kind: 'no-music', page: index + 1 })
        return
      case 'failed':
        this.stopReading(reading, { kind: 'page-failed', page: index + 1, message: event.message })
        return
    }
    this.publish(reading)
  }

  /** The first page without music, or that failed, ends the job: the rest is not read. */
  private stopReading(reading: Reading, stop: Stop): void {
    reading.stop = stop
    void reading.job?.cancel()
  }

  private publish(reading: Reading): void {
    this.current.value = {
      step: 'reading',
      progress: { page: reading.current + 1, pages: reading.paths.length, fraction: reading.fraction, states: [...reading.states] },
    }
  }

  /** The pages as the library stores them, in the ranges `prepared` gives. */
  private pageList(prepared: PreparedPages, paths: string[], raws: string[], layouts: PageLayout[]): NewPage[] {
    return paths.map((source, i) => {
      const range = prepared.pages[i]!
      const page: NewPage = { source, recognised: raws[i]!, firstBar: range.firstBar, lastBar: range.lastBar }
      const staves = stavesForPiece(layouts[i]!.staves, range)
      if (staves) page.staves = staves
      return page
    })
  }

  /** Saves a new piece, and the part the user plays (when the parts step was shown) in its `practice.json`. */
  private async create(prepared: PreparedPages, paths: string[], raws: string[], layouts: PageLayout[], part?: string): Promise<void> {
    const info = await this.deps.library.create({
      name: this.deps.defaultName(this.now()),
      musicxml: prepared.musicxml,
      bars: prepared.bars,
      repairs: prepared.repairs,
      pages: this.pageList(prepared, paths, raws, layouts),
      partsRead: prepared.partsRead,
    })
    // practice.json is a convenience: a piece that is saved keeps going when it cannot be written (it then opens on the first part).
    if (part !== undefined) await this.deps.library.writePractice?.(info.id, { ...DEFAULT_PRACTICE, part: { id: part } }).catch(() => undefined)
    await this.end({ step: 'saved', pieceId: info.id, added: false, info, partDropped: prepared.warnings.length > 0 })
  }

  /** Combines the readings and saves them (a new piece waits in the parts step first when it has several parts); the scans are removed afterwards in every case. */
  private async save(paths: string[], raws: string[], layouts: PageLayout[]): Promise<void> {
    const pieceId = this.pieceId
    try {
      if (pieceId === undefined) {
        let prepared: PreparedPages
        let combined: Score
        try {
          prepared = preparePages(raws, pageOptions(layouts))
          combined = parseMusicXml(prepared.musicxml)
        } catch (error) {
          await this.end({ step: 'failed', reason: 'reading', message: messageOf(error) })
          return
        }
        if (prepared.partsRead.length > 1) {
          // The parts step: wait for the user. `combined` has every part; Continue prepares the pages again with the kept ones.
          this.pending = { paths, raws, layouts, prepared, score: combined }
          this.current.value = {
            step: 'parts',
            parts: combined.parts.map((p) => ({ id: p.id, name: p.name, staves: p.staves })),
            keep: combined.parts.map(() => true),
            play: 0,
            score: combined,
          }
          return
        }
        this.current.value = { step: 'saving' }
        await this.create(prepared, paths, raws, layouts)
        return
      }
      this.current.value = { step: 'saving' }
      // The piece's current score, loaded right before appending; once more when it was saved in between.
      for (let attempt = 1; ; attempt++) {
        const piece = await this.deps.library.load(pieceId)
        let prepared: PreparedPages
        try {
          prepared = appendPages(piece.musicxml, raws, pageOptions(layouts), piece.info.partsRead)
        } catch (error) {
          await this.end({ step: 'failed', reason: 'reading', message: messageOf(error) })
          return
        }
        try {
          const info = await this.deps.library.addPages(
            pieceId,
            { musicxml: prepared.musicxml, bars: prepared.bars, repairs: prepared.repairs, pages: this.pageList(prepared, paths, raws, layouts) },
            piece.info.score,
          )
          await this.end({ step: 'saved', pieceId, added: true, info, partDropped: prepared.warnings.length > 0 })
          return
        } catch (error) {
          if (!(error instanceof LibraryError && error.code === 'conflict') || attempt >= 2) throw error
        }
      }
    } catch (error) {
      await this.end({ step: 'failed', reason: 'save', message: messageOf(error) })
    }
  }

  /** Shows [state], having removed the scanner's files first. */
  private async end(state: AddMusicState): Promise<void> {
    const scans = this.scans
    this.scans = []
    this.pending = undefined
    for (const path of scans) await this.deps.files.remove(path).catch(() => undefined)
    // The scanner puts each scan's pages in a folder of its own (`scans/<scan>/`): remove it too.
    for (const folder of new Set(scans.map(scanFolderOf))) {
      if (folder !== undefined) await this.deps.files.remove(folder).catch(() => undefined)
    }
    this.current.value = state
  }
}

/** The flow of adding music: a new piece, or pages after the last bar of `target.pieceId`. */
export function createAddMusic(deps: AddMusicDeps, target: AddMusicTarget = {}): AddMusicFlow {
  return new AddMusicFlow(deps, target)
}

/** The scan's own folder (`…scans/<scan>`) of a scanned page's path, or undefined for any other path. */
export function scanFolderOf(path: string): string | undefined {
  const folder = path.slice(0, Math.max(0, path.lastIndexOf('/')))
  return /(^|\/)scans\/[^/]+$/.test(folder) ? folder : undefined
}

function clamp01(value: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
