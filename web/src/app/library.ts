import type { PageRange, PartRead } from '../core/pages/pages.ts'
import type { BarMap } from '../core/score/model.ts'
import { parseMusicXml } from '../core/score/musicxml.ts'
import type { Repair } from '../core/score/repairs.ts'
import { PlatformError } from '../platform/port.ts'
import type { Files } from '../platform/port.ts'
import { isJson, settleTemps } from './strayTemps.ts'

/*
 * The piece library (practice-app design D4, spec `piece-library`): the pieces kept on the phone,
 * in storage format 2, written through the platform port's file calls and nothing else.
 *
 *   pieces/<id>/
 *     piece.json                      PieceInfo: name, flags, the score file, pages with their staves, repairs, bars
 *     practice.json                   PracticeState: what the practice session remembers
 *     score-<rev>.musicxml            the corrected, combined score; piece.json's `score` names it
 *     pages/<n>/source.jpg            the page's photo, as the scanner gave it
 *     pages/<n>/recognised.musicxml   the page's raw reading, written once and never changed
 *
 * Rules the store keeps:
 *
 * - Every JSON and score file is written with `Files.writeTextAtomic`: a crash leaves the old file
 *   (or none) and at worst a stray `<name>.tmp-<suffix>`. A new piece is built in the hidden folder
 *   `pieces/.tmp-<id>/` and renamed into place, so a half-built piece is never listed.
 * - One commit point per piece change: piece.json. A change of the score or the pages first writes
 *   the new files under names nothing refers to yet (a new `score-<rev>.musicxml`, new
 *   `pages/<n>/` folders), then replaces piece.json, which names them, then removes the old score
 *   file. A crash leaves the old piece or the new one, never a mix, and at worst files that
 *   piece.json does not refer to.
 * - Cleaning up is one explicit call at start-up, `sweep()`; list, create and the rest never delete
 *   such leftovers, so they cannot remove the files of a write that is still going on. The sweep
 *   removes the hidden entries of `pieces/`; settles the temp files in each piece folder (removed
 *   next to their target, and promoted when the target is missing and the content is whole, since
 *   then the temp may be the only copy); and removes the score files and page folders piece.json
 *   does not refer to, but only in a piece whose piece.json reads and whose own files are there. It
 *   never removes a piece folder that is not hidden and never cleans inside a damaged one: that may
 *   be someone's music.
 * - Operations that change something run one at a time, in the order they were called (a promise
 *   chain, like the `@Synchronized` of the first version's store). Two quick updates of piece.json
 *   (a star and `lastPracticed`) both land, and two saves of one file cannot overtake each other.
 *   Reads do not wait: each file they read is whole, because every write is atomic. A read can
 *   still fall between two steps of a change: `list` skips a folder without piece.json (a piece
 *   being made or deleted), and `load` reads piece.json again once when its score file has just
 *   been replaced.
 * - Ids are made here (a UUID) and checked on every call, so no id can leave `pieces/` or name a
 *   hidden folder. The id in piece.json must equal the folder's name.
 * - Warnings are not stored: they are computed from the score and the instrument (design D4).
 *
 * Bad pieces: `list` skips a folder that cannot be read as a piece, and says so in `problems` with
 * the reason ("damaged" or "unsupported-format", for example a piece a newer version wrote). It
 * never throws for one piece and never deletes one. `load` of such a piece rejects with the same
 * `LibraryError` code.
 *
 * Errors: a `LibraryError` for what the store itself finds wrong (code: not-found, invalid, damaged,
 * unsupported-format, conflict). A `PlatformError` from the port (a failed copy, a full disk) passes through
 * unchanged; whatever was half done is cleaned up where the store can.
 *
 * Stale changes: `writeScore` and `addPages` take the whole new score, so a caller holding an old
 * score could write over a newer save. Both take `basedOn`, the score file (`PieceInfo.score`) the
 * caller loaded and built its change on, and reject with `conflict` when piece.json names another
 * one by the time the change runs. The check uses the piece.json each change reads anyway.
 *
 * Not here: the scanner's `scans/<id>/` folders. Add music (task 9.5) removes what it scanned.
 */

/** The storage format this code reads and writes. A piece of any other format is not read (design D5). */
export const PIECE_FORMAT = 2

// ---- What is stored ------------------------------------------------------------------------

/** A rectangle on a page photo as fractions of its width and height, from the top left corner: all four in 0..1. */
export interface StaffBox {
  x: number
  y: number
  width: number
  height: number
}

/** Where one staff is on the page photo and which bars of the piece it holds (design D7). */
export interface Staff {
  box: StaffBox
  /** Bar numbers of the whole piece, like `PageRange`; first and last included. */
  firstBar: number
  lastBar: number
}

/** One page of a piece: the bars it gave (`firstBar`, `lastBar`, of the whole piece) and where its staves are. */
export interface PageInfo extends PageRange {
  /** The folder `pages/<n>/`: 1, 2, 3 ... in reading order, each used once. */
  n: number
  /** Empty when no positions are known: the editor then shows the whole photo. */
  staves: Staff[]
}

/** piece.json: all the library list needs, without reading the score. */
export interface PieceInfo {
  format: typeof PIECE_FORMAT
  id: string
  name: string
  /** When the piece was added, an ISO 8601 UTC time. */
  created: string
  /** When playback last started in it (ISO 8601 UTC), or null when it was never practised. */
  lastPracticed: string | null
  favorite: boolean
  /** The file of the corrected score in the piece folder: `score-<rev>.musicxml`. A new file for every change. */
  score: string
  /** In reading order. Their bar ranges follow each other and cover 1..bars exactly. */
  pages: PageInfo[]
  /** The automatic repairs made when the pages were read: the record only, warnings are computed. */
  repairs: Repair[]
  /** The number of bars in the score. */
  bars: number
  /**
   * What the first reading found, one entry per part in reading order: the staves of the part and whether the
   * piece kept it (change parts-and-accompaniment, design D4). Pages added later are matched against it and the
   * parts not kept are dropped again. Absent in a piece saved before parts: it keeps only its first part from added pages.
   */
  partsRead?: PartRead[]
}

/** A piece as opened: its info and its corrected score (MusicXML). */
export interface Piece {
  info: PieceInfo
  musicxml: string
}

/**
 * practice.json: what the practice session restores when the piece is opened again (spec
 * `practice-controls`, "Practice settings remembered"). The default instrument and the count-in are general
 * settings (`settings.json`), and the view always follows the music, so neither is in it (design D17). A piece
 * can have an instrument of its own (`instrument`, change parts-and-accompaniment); without one it follows the
 * default. Older files may still carry `countIn` and `follow`; they are ignored.
 */
export interface PracticeState {
  /** The bar the user was at. */
  bar: number
  /** Beats per minute the user chose, or null while they have not chosen one (the piece's marking decides then). */
  tempo: number | null
  loop: { start: number; end: number } | null
  /** Bars of rest between loop repeats. */
  loopRest: 0 | 1 | 2
  metronome: boolean
  /** Your part (change parts-and-accompaniment, design D5): a part id, and for a two-staff part the hand. Absent: the first part, both hands. */
  part?: { id: string; hand?: 'right' | 'left' }
  /** Parts or hands switched off under "Plays along": 'P1', 'P2:left' ... Absent: none. */
  silent?: string[]
  /** Whether your own line sounds. Absent: true. */
  ownLine?: boolean
  /** The instrument chosen for this piece. Absent or null: the default from Settings. */
  instrument?: string | null
  /** The parts hint was shown for this piece. */
  partsHintSeen?: boolean
}

/**
 * What a piece starts with; what a missing or damaged field falls back to. The fields of parts-and-accompaniment
 * (`part`, `silent`, `ownLine`, `instrument`, `partsHintSeen`) are not here: absent means the first part with both hands,
 * nothing switched off, your line on, the default instrument, and the hint not yet seen.
 */
export const DEFAULT_PRACTICE: Readonly<PracticeState> = {
  bar: 1,
  tempo: null,
  loop: null,
  loopRest: 0,
  metronome: false,
}

// ---- What the store is given and gives back ------------------------------------------------

/** A page of a piece that is being made, or added to a piece. */
export interface NewPage extends PageRange {
  /** The scanned page as `Scanner.scan` returned it (a path the port's `copy` accepts); it is copied into the piece. */
  source: string
  /** The page's raw reading (MusicXML), stored as it is and never changed. */
  recognised: string
  /** Staff positions from the reader; none until it reports them (task 10.4). */
  staves?: Staff[]
}

/**
 * A piece that is being made, as the result of `preparePages` and the reader gives it:
 * `musicxml`, `repairs`, `bars` and the page ranges, with each page's photo and raw reading.
 */
export interface NewPiece {
  /** What the user sees; trimmed, and not empty. The default name (the date and time) is made by the caller. */
  name: string
  /** The corrected, combined score. */
  musicxml: string
  bars: number
  repairs: Repair[]
  /** At least one, in reading order; the pages are numbered 1, 2, ... Their ranges follow each other and cover 1..bars. */
  pages: NewPage[]
  /** What the first reading found and which parts were kept (`PieceInfo.partsRead`). */
  partsRead?: PartRead[]
}

/**
 * Pages added after the last bar of a piece (spec `score-capture`, "Add pages to a piece"; design
 * D6): the new pages, and the piece's whole score with their music appended.
 */
export interface NewPages {
  /** The whole corrected score: the piece's current score with the new pages' music after its last bar. */
  musicxml: string
  /** The bars of that score: the piece's bars plus the new pages' bars. */
  bars: number
  /** The automatic repairs made reading the new pages; they are added after the piece's own. */
  repairs: Repair[]
  /**
   * At least one, in reading order, with bar numbers of the whole piece: the first starts at the bar
   * after the piece's last, and the last ends at `bars`. They are numbered after the piece's pages.
   */
  pages: NewPage[]
}

/** What `update` can change in piece.json. */
export interface PiecePatch {
  /** Trimmed; an empty name is not accepted. */
  name?: string
  favorite?: boolean
  /** An ISO 8601 time, or null. */
  lastPracticed?: string | null
}

/** A folder in `pieces/` that is not listed, and why. */
export interface PieceProblem {
  id: string
  reason: 'damaged' | 'unsupported-format'
  message: string
}

export interface LibraryListing {
  /** Most recently practised or added first. */
  pieces: PieceInfo[]
  /** The folders that could not be read as pieces; they are left alone. */
  problems: PieceProblem[]
}

/** What `sweep` did. */
export interface SweepReport {
  /** The paths it removed: hidden entries of `pieces/`, temp files, score files and page folders no piece.json refers to. */
  removed: string[]
  /** The paths a temp file was promoted to, because the file itself was missing (see `Files.writeTextAtomic`). */
  restored: string[]
}

/**
 * - `conflict`: the score the caller based a change on (`basedOn`) is no longer the one piece.json
 *   names: someone saved in between. Nothing is written; the caller loads the piece again.
 */
export type LibraryErrorCode = 'not-found' | 'invalid' | 'damaged' | 'unsupported-format' | 'conflict'

/** What the store reports about a piece or an argument. Callers branch on `code`, never on the message. */
export class LibraryError extends Error {
  readonly code: LibraryErrorCode
  /** The piece it is about, when there is one. */
  readonly pieceId: string | undefined

  constructor(code: LibraryErrorCode, message: string, pieceId?: string) {
    super(message)
    this.name = 'LibraryError'
    this.code = code
    this.pieceId = pieceId
  }
}

export interface LibraryOptions {
  /** Makes the id of a new piece. A UUID by default; a test passes its own. */
  newId?: () => string
  /** The time for `created`. */
  now?: () => Date
}

// ---- Paths ---------------------------------------------------------------------------------

const PIECES = 'pieces'

/** What an id looks like: a UUID, or anything of letters, digits, "_" and "-" that does not start with one of the last two. */
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
/**
 * The name of a score file: `score-<rev>.musicxml` with a revision of at most nine digits, never a
 * path. Bounded so that the next revision is always an exact, different number (a crafted
 * `score-9007199254740992.musicxml` would otherwise give itself as the next one).
 */
const SCORE_FILE = /^score-([0-9]{1,9})\.musicxml$/
/** The name of a page folder in `pages/`. */
const PAGE_FOLDER = /^[1-9][0-9]*$/

const pieceDir = (id: string): string => `${PIECES}/${id}`
const pieceFile = (id: string): string => `${PIECES}/${id}/piece.json`
const practiceFile = (id: string): string => `${PIECES}/${id}/practice.json`
const scorePath = (id: string, score: string): string => `${PIECES}/${id}/${score}`
const pagesDir = (id: string): string => `${PIECES}/${id}/pages`
const pageDir = (id: string, n: number): string => `${PIECES}/${id}/pages/${n}`
const pageFile = (id: string, n: number, name: string): string => `${PIECES}/${id}/pages/${n}/${name}`
const hiddenDir = (id: string): string => `${PIECES}/.tmp-${id}`

/** The score file of a new piece. */
const FIRST_SCORE = 'score-1.musicxml'

/** The name for the score that replaces [score]: the next revision number. */
function nextScore(score: string): string {
  const rev = SCORE_FILE.exec(score)?.[1]
  return `score-${rev === undefined ? 1 : Number.parseInt(rev, 10) + 1}.musicxml`
}

function checkId(id: string): void {
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) throw new LibraryError('invalid', `not a piece id: ${String(id)}`)
}

function serialise(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

/** Whether a temp file's [text] is a whole [target]: the JSON parses, the score parses. Anything else is not kept. */
function wholeFile(target: string, text: string): boolean {
  if (target.endsWith('.json')) return isJson(text)
  if (target.endsWith('.musicxml')) {
    try {
      parseMusicXml(text)
      return true
    } catch {
      return false
    }
  }
  return false
}

// ---- The library ---------------------------------------------------------------------------

export class Library {
  private readonly files: Files
  private readonly newId: () => string
  private readonly now: () => Date
  /** The end of the queue of operations that change something; it never rejects. */
  private tail: Promise<unknown> = Promise.resolve()

  constructor(files: Files, options: LibraryOptions = {}) {
    this.files = files
    this.newId = options.newId ?? (() => crypto.randomUUID())
    this.now = options.now ?? (() => new Date())
  }

  /**
   * Cleans up after an interrupted run; call it once when the app starts, before anything else
   * reads the library. In `pieces/`: removes the hidden entries (a new piece that was being built,
   * a piece that was being deleted). In each piece folder: settles the temp files of cut-off atomic
   * writes (`settleTemps`: removed next to their target, promoted when the target is missing and
   * the content is whole), then, when piece.json reads and the files it names are there, removes
   * the `score-*.musicxml` files and `pages/<n>/` folders it does not name. A folder that is not
   * hidden is never removed, and an entry that cannot be removed is left for the next start.
   */
  sweep(): Promise<SweepReport> {
    return this.enqueue(async () => {
      const report: SweepReport = { removed: [], restored: [] }
      for (const entry of await this.files.list(PIECES)) {
        if (entry.name.startsWith('.')) {
          await this.drop(`${PIECES}/${entry.name}`, report)
        } else if (entry.kind === 'folder' && ID_PATTERN.test(entry.name)) {
          try {
            await this.sweepPiece(entry.name, report)
          } catch {
            // One folder that cannot be swept does not stop the others; the next start tries again.
          }
        }
      }
      return report
    })
  }

  /**
   * Every piece, most recently practised or added first, read from the piece.json files. A folder
   * that cannot be read as a piece is not listed: it is in `problems` instead. A folder without
   * piece.json is neither: it is a piece being made or deleted (or not a piece at all).
   */
  async list(): Promise<LibraryListing> {
    const entries = (await this.files.list(PIECES)).filter((e) => e.kind === 'folder' && ID_PATTERN.test(e.name))
    const pieces: PieceInfo[] = []
    const problems: PieceProblem[] = []
    await Promise.all(
      entries.map(async ({ name }) => {
        try {
          const text = await this.readInfoText(name)
          if (text !== undefined) pieces.push(parseInfo(text, name))
        } catch (error) {
          // Anything that stops one folder from being read is that folder's problem, not the list's.
          const reason = error instanceof LibraryError && error.code === 'unsupported-format' ? 'unsupported-format' : 'damaged'
          problems.push({ id: name, reason, message: error instanceof Error ? error.message : String(error) })
        }
      }),
    )
    pieces.sort(byRecency)
    problems.sort((a, b) => (a.id < b.id ? -1 : 1))
    return { pieces, problems }
  }

  /**
   * The info and the score of a piece. Rejects with `not-found`, `damaged` or `unsupported-format`.
   * When the score file piece.json named is gone by the time it is read (a change of the score
   * committed in between), piece.json is read once more and its score is read.
   */
  async load(id: string): Promise<Piece> {
    const info = await this.readInfo(id)
    const musicxml = await this.readScore(id, info.score)
    if (musicxml !== undefined) return { info, musicxml }
    const again = await this.readInfo(id)
    const retried = await this.readScore(id, again.score)
    if (retried === undefined) throw new LibraryError('damaged', `${again.score} is missing`, id)
    return { info: again, musicxml: retried }
  }

  /** The info of a piece, without its score. */
  info(id: string): Promise<PieceInfo> {
    return this.readInfo(id)
  }

  /**
   * Makes a piece: builds it in `pieces/.tmp-<id>/` (the photos copied from the scanned paths, the
   * raw readings, the score, piece.json) and renames the folder into place. Either the whole piece
   * is there afterwards or nothing is listed, and what was built is removed again when the store
   * can still run. A failed copy or a full disk rejects with the port's `PlatformError`.
   */
  create(input: NewPiece): Promise<PieceInfo> {
    return this.enqueue(async () => {
      const bad = (message: string): never => {
        throw new LibraryError('invalid', message)
      }
      const name = typeof input.name === 'string' ? input.name.trim() : ''
      if (name === '') bad('a piece needs a name')
      if (typeof input.musicxml !== 'string' || input.musicxml === '') bad('a piece needs a score')
      if (!isInt(input.bars, 1)) bad('bars must be a whole number of at least 1')
      const repairs = parseRepairs(input.repairs, bad)
      if (!Array.isArray(input.pages) || input.pages.length === 0) bad('a piece needs at least one page')
      const pages = newPageInfos(input.pages, 1, input.bars, bad)
      checkPages(pages, input.bars, bad)

      const id = this.newId()
      checkId(id)
      const info: PieceInfo = {
        format: PIECE_FORMAT,
        id,
        name,
        created: this.now().toISOString(),
        lastPracticed: null,
        favorite: false,
        score: FIRST_SCORE,
        pages,
        repairs,
        bars: input.bars,
      }
      if (input.partsRead !== undefined) info.partsRead = parsePartsRead(input.partsRead, bad)
      const temp = hiddenDir(id)
      const target = pieceDir(id)
      /** Whether this call may remove [target] when the rename fails: only when it was not there before. */
      let ours = false
      try {
        await this.files.remove(temp)
        for (const [index, page] of input.pages.entries()) {
          const n = index + 1
          await this.files.copy(page.source, `${temp}/pages/${n}/source.jpg`)
          await this.files.writeTextAtomic(`${temp}/pages/${n}/recognised.musicxml`, page.recognised)
        }
        await this.files.writeTextAtomic(`${temp}/${FIRST_SCORE}`, input.musicxml)
        await this.files.writeTextAtomic(`${temp}/piece.json`, serialise(info))
        ours = (await this.files.list(target)).length === 0
        await this.files.rename(temp, target)
      } catch (error) {
        await this.files.remove(temp).catch(() => undefined)
        // A rename that failed half way may have left part of the piece in place. Never remove a
        // folder that was there before: that is another piece (an id that is already taken).
        if (ours) await this.files.remove(target).catch(() => undefined)
        throw error
      }
      return info
    })
  }

  /**
   * Changes the name, the star or `lastPracticed` of a piece and writes piece.json atomically.
   * Returns the new info. An empty name is `invalid` and nothing is written.
   */
  update(id: string, patch: PiecePatch): Promise<PieceInfo> {
    return this.enqueue(async () => {
      const info = await this.readInfo(id)
      const next: PieceInfo = { ...info }
      if (patch.name !== undefined) {
        const name = typeof patch.name === 'string' ? patch.name.trim() : ''
        if (name === '') throw new LibraryError('invalid', 'a piece needs a name', id)
        next.name = name
      }
      if (patch.favorite !== undefined) {
        if (typeof patch.favorite !== 'boolean') throw new LibraryError('invalid', 'favorite must be true or false', id)
        next.favorite = patch.favorite
      }
      if (patch.lastPracticed !== undefined) {
        if (patch.lastPracticed !== null && (typeof patch.lastPracticed !== 'string' || Number.isNaN(Date.parse(patch.lastPracticed)))) {
          throw new LibraryError('invalid', 'lastPracticed must be a time or null', id)
        }
        next.lastPracticed = patch.lastPracticed
      }
      await this.files.writeTextAtomic(pieceFile(id), serialise(next))
      return next
    })
  }

  /**
   * Replaces the corrected score: writes it as a new `score-<rev>.musicxml`, replaces piece.json
   * (which then names it) atomically, then removes the old score file. Returns the new info. The raw
   * readings are not touched. [basedOn] is the score file the caller loaded (`PieceInfo.score`); when
   * piece.json names another one, the call rejects with `conflict` and writes nothing.
   *
   * Without [barMap] the bars of the piece do not change, and piece.json changes only in the score
   * file it names. With one (change edit-parts D10, change redesign-score-editor D8: bar lines or bars
   * were added or removed), [barMap] says for each bar of the stored piece the bars of the new score
   * that hold it (none for a deleted bar), and which bars were added next to which, and the change
   * carries the numbers along. Every new bar belongs to one old bar: the first one it holds, or for an
   * added bar the one it was added next to, never one before the bar the new bar before it belongs to
   * (`barOwners`). Each page and each staff box (a line of the photo) then holds the new bars that
   * belong to one of its old bars, so the pages follow each other and the lines do not overlap; a
   * line left without bars is dropped. practice.json follows: the bar to the first new bar of the old
   * one, or for a deleted bar to the first new bar that belongs to it or to a bar after it, else the
   * last bar; the loop from its first surviving bar's first new bar to its last surviving bar's last
   * new bar, cleared (null) when none of its bars survives. The repairs keep their numbers: they
   * record what reading changed. A map that does not fit the piece, a new bar that holds bars of two
   * pages (a join across a page), or a page left without bars, are `invalid` and nothing is written.
   * practice.json is written with the new score, before piece.json commits the change, and put back as it was when the change fails where the store can
   * see it; a crash between the two leaves it with the new numbers on the old score (it is only a
   * convenience). A practice.json that is missing or does not read is left as it is.
   */
  writeScore(id: string, musicxml: string, basedOn: string, barMap?: BarMap): Promise<PieceInfo> {
    return this.enqueue(async () => {
      if (typeof musicxml !== 'string' || musicxml === '') throw new LibraryError('invalid', 'a piece needs a score', id)
      const info = await this.readInfo(id)
      checkBase(info, basedOn)
      if (barMap === undefined) {
        const next: PieceInfo = { ...info, score: nextScore(info.score) }
        await this.commit(info, next, [scorePath(id, next.score)], async () => {
          await this.files.writeTextAtomic(scorePath(id, next.score), musicxml)
        })
        return next
      }
      const bad = (message: string): never => {
        throw new LibraryError('invalid', message, id)
      }
      const { owners, bars, pages } = mapPieceBars(info, barMap, bad)
      const next: PieceInfo = { ...info, score: nextScore(info.score), bars, pages }
      const practice = await this.readPracticeText(id)
      const mapped = practice === undefined ? undefined : mapPractice(practice, barMap, owners)
      await this.commit(
        info,
        next,
        [scorePath(id, next.score)],
        async () => {
          await this.files.writeTextAtomic(scorePath(id, next.score), musicxml)
          if (mapped !== undefined) await this.files.writeTextAtomic(practiceFile(id), mapped)
        },
        async () => {
          if (practice !== undefined && mapped !== undefined) await this.files.writeTextAtomic(practiceFile(id), practice)
        },
      )
      return next
    })
  }

  /**
   * Adds pages after the last bar of a piece (spec `score-capture`, "Add pages to a piece"): copies
   * the new pages' photos and raw readings into new `pages/<n>/` folders, writes the new whole
   * score as a new `score-<rev>.musicxml`, then replaces piece.json (pages, bars, repairs, score)
   * atomically, then removes the old score file. A crash or a failure before piece.json is replaced
   * leaves the piece as it was. Returns the new info. Rejects with `invalid` when the new pages'
   * bar ranges do not continue from the piece's last bar up to `bars`, and with `conflict` when
   * [basedOn], the score file the caller appended the new pages to, is not the one piece.json names.
   */
  addPages(id: string, input: NewPages, basedOn: string): Promise<PieceInfo> {
    return this.enqueue(async () => {
      const info = await this.readInfo(id)
      checkBase(info, basedOn)
      const bad = (message: string): never => {
        throw new LibraryError('invalid', message, id)
      }
      if (typeof input.musicxml !== 'string' || input.musicxml === '') bad('a piece needs a score')
      if (!isInt(input.bars, info.bars + 1)) bad(`bars must be more than the piece's ${info.bars}`)
      const repairs = parseRepairs(input.repairs, bad)
      if (!Array.isArray(input.pages) || input.pages.length === 0) bad('no pages to add')
      const first = Math.max(...info.pages.map((p) => p.n)) + 1
      const added = newPageInfos(input.pages, first, input.bars, bad)
      const pages = [...info.pages, ...added]
      checkPages(pages, input.bars, bad)

      const next: PieceInfo = { ...info, score: nextScore(info.score), pages, repairs: [...info.repairs, ...repairs], bars: input.bars }
      const written = [...added.map((page) => pageDir(id, page.n)), scorePath(id, next.score)]
      await this.commit(info, next, written, async () => {
        for (const [index, page] of input.pages.entries()) {
          const n = added[index]!.n
          await this.files.remove(pageDir(id, n)) // what an earlier, cut-off add left there
          await this.files.copy(page.source, pageFile(id, n, 'source.jpg'))
          await this.files.writeTextAtomic(pageFile(id, n, 'recognised.musicxml'), page.recognised)
        }
        await this.files.writeTextAtomic(scorePath(id, next.score), input.musicxml)
      })
      return next
    })
  }

  /**
   * What the practice session remembers for the piece, or null when nothing usable is stored (a
   * piece that was never practised, or a practice.json that cannot be read: it is only a
   * convenience, so the piece opens with the defaults). Fields that are wrong are replaced by their
   * defaults one by one.
   */
  async readPractice(id: string): Promise<PracticeState | null> {
    checkId(id)
    let text: string
    try {
      text = await this.files.readText(practiceFile(id))
    } catch (error) {
      if (error instanceof PlatformError && error.code === 'not-found') return null
      throw error
    }
    try {
      return normalisePractice(JSON.parse(text))
    } catch {
      return null
    }
  }

  /**
   * Saves the practice state atomically. Rejects with `not-found` when the piece does not exist
   * (it was deleted while a debounced save was waiting): the store never recreates a piece folder.
   */
  writePractice(id: string, state: PracticeState): Promise<void> {
    return this.enqueue(async () => {
      await this.readInfo(id)
      await this.files.writeTextAtomic(practiceFile(id), serialise(normalisePractice(state)))
    })
  }

  /**
   * Deletes a piece with its score, photos and practice state. The folder is first renamed to a
   * hidden one, so the piece disappears in one step even when deleting the files is cut off (the
   * next `sweep` finishes it). Nothing happens for a piece that is not there. It works on a damaged
   * piece too.
   */
  remove(id: string): Promise<void> {
    return this.enqueue(async () => {
      checkId(id)
      const doomed = hiddenDir(id)
      await this.files.remove(doomed)
      try {
        await this.files.rename(pieceDir(id), doomed)
      } catch (error) {
        if (error instanceof PlatformError && error.code === 'not-found') return
        throw error
      }
      await this.files.remove(doomed)
    })
  }

  /** A URL an `<img>` can show for the photo of page [n] (1-based). */
  async pageImageUrl(id: string, n: number): Promise<string> {
    checkId(id)
    if (!isInt(n, 1)) throw new LibraryError('invalid', `not a page number: ${String(n)}`, id)
    return this.files.imageUrl(pageFile(id, n, 'source.jpg'))
  }

  // ---- inside --------------------------------------------------------------------------------

  /** Runs [job] after every operation queued before it, whether those succeeded or not. */
  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.tail.then(job)
    this.tail = run.catch(() => undefined)
    return run
  }

  /**
   * A change with piece.json as its one commit point: [write] puts the new files in place (the
   * paths in [written], which nothing refers to yet), then piece.json is replaced by [next], then
   * the score file of [info] is removed. After a failure, what this call wrote is removed again,
   * unless piece.json already names the new score (the replace landed after all) or cannot be read
   * to tell: then the sweep sorts it out at the next start. [restore] puts back, in the same case,
   * a file [write] replaced in place (practice.json), best effort. Removing the old score is best
   * effort: the change is committed by then, and a score file nothing refers to is the sweep's.
   */
  private async commit(info: PieceInfo, next: PieceInfo, written: string[], write: () => Promise<void>, restore?: () => Promise<void>): Promise<void> {
    const id = info.id
    // The old score is removed after the commit: it must never be the file just written.
    if (next.score === info.score || !SCORE_FILE.test(next.score)) {
      throw new LibraryError('damaged', `no next score file after ${info.score}`, id)
    }
    try {
      await write()
      await this.files.writeTextAtomic(pieceFile(id), serialise(next))
    } catch (error) {
      const now = await this.readInfo(id).catch(() => undefined)
      if (now !== undefined && now.score === info.score) {
        for (const path of written) await this.files.remove(path).catch(() => undefined)
        await restore?.().catch(() => undefined)
      }
      throw error
    }
    await this.files.remove(scorePath(id, info.score)).catch(() => undefined)
  }

  /** Removes [path] for the sweep, best effort. */
  private async drop(path: string, report: SweepReport): Promise<void> {
    try {
      await this.files.remove(path)
      report.removed.push(path)
    } catch {
      // A stray that stays is harmless and is tried again at the next start.
    }
  }

  /** The sweep of one piece folder (see `sweep`). */
  private async sweepPiece(id: string, report: SweepReport): Promise<void> {
    const dir = pieceDir(id)
    const settled = await settleTemps(this.files, dir, await this.files.list(dir), wholeFile)
    report.removed.push(...settled.removed)
    report.restored.push(...settled.restored)

    // Leftovers of a change: only in a piece that reads, and whose own files are all there.
    let info: PieceInfo
    try {
      info = await this.readInfo(id)
    } catch {
      return
    }
    const entries = await this.files.list(dir)
    const pageFolders = await this.files.list(pagesDir(id))
    if (!entries.some((e) => e.kind === 'file' && e.name === info.score)) return
    if (!info.pages.every((page) => pageFolders.some((e) => e.kind === 'folder' && e.name === String(page.n)))) return
    for (const entry of entries) {
      if (entry.kind === 'file' && SCORE_FILE.test(entry.name) && entry.name !== info.score) await this.drop(`${dir}/${entry.name}`, report)
    }
    const referenced = new Set(info.pages.map((page) => String(page.n)))
    for (const entry of pageFolders) {
      if (PAGE_FOLDER.test(entry.name) && !referenced.has(entry.name)) await this.drop(`${pagesDir(id)}/${entry.name}`, report)
    }
  }

  /** The text of piece.json, or undefined when there is none. */
  private async readInfoText(id: string): Promise<string | undefined> {
    checkId(id)
    try {
      return await this.files.readText(pieceFile(id))
    } catch (error) {
      if (error instanceof PlatformError && error.code === 'not-found') return undefined
      throw error
    }
  }

  private async readInfo(id: string): Promise<PieceInfo> {
    const text = await this.readInfoText(id)
    if (text === undefined) {
      // No folder is no piece; a folder without piece.json is a damaged one.
      const there = (await this.files.list(pieceDir(id))).length > 0
      throw new LibraryError(there ? 'damaged' : 'not-found', there ? 'piece.json is missing' : `no piece ${id}`, id)
    }
    return parseInfo(text, id)
  }

  /** The text of practice.json, or undefined when there is none. */
  private async readPracticeText(id: string): Promise<string | undefined> {
    try {
      return await this.files.readText(practiceFile(id))
    } catch (error) {
      if (error instanceof PlatformError && error.code === 'not-found') return undefined
      throw error
    }
  }

  /** The score file [score] of a piece, or undefined when it is not there. */
  private async readScore(id: string, score: string): Promise<string | undefined> {
    try {
      return await this.files.readText(scorePath(id, score))
    } catch (error) {
      if (error instanceof PlatformError && error.code === 'not-found') return undefined
      throw error
    }
  }
}

/** Opens the library on the platform's files. */
export function createLibrary(files: Files, options?: LibraryOptions): Library {
  return new Library(files, options)
}

// ---- Reading what is stored ----------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isInt(value: unknown, min: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min
}

function lastActivity(info: PieceInfo): number {
  const time = Date.parse(info.lastPracticed ?? info.created)
  return Number.isNaN(time) ? 0 : time
}

/** Most recently practised or added first; the id breaks a tie, so the order is always the same. */
function byRecency(a: PieceInfo, b: PieceInfo): number {
  return lastActivity(b) - lastActivity(a) || (a.id < b.id ? -1 : 1)
}

/** piece.json as an object, or a `LibraryError`: `unsupported-format` for another format, `damaged` for anything unreadable. */
function parseInfo(text: string, id: string): PieceInfo {
  const bad = (message: string): never => {
    throw new LibraryError('damaged', message, id)
  }
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return bad('piece.json is not valid JSON')
  }
  if (!isRecord(json)) return bad('piece.json is not an object')
  if (typeof json.format !== 'number') return bad('piece.json has no format')
  if (json.format !== PIECE_FORMAT) {
    throw new LibraryError('unsupported-format', `piece.json is format ${json.format}, this app reads format ${PIECE_FORMAT}`, id)
  }
  if (json.id !== id) return bad('piece.json names another piece than its folder')
  if (typeof json.name !== 'string') return bad('piece.json has no name')
  if (typeof json.created !== 'string') return bad('piece.json has no created time')
  const lastPracticed = json.lastPracticed ?? null
  if (lastPracticed !== null && typeof lastPracticed !== 'string') return bad('lastPracticed is not a time')
  const favorite = json.favorite ?? false
  if (typeof favorite !== 'boolean') return bad('favorite is not true or false')
  if (typeof json.score !== 'string' || !SCORE_FILE.test(json.score)) return bad('piece.json names no score file')
  const score = json.score
  if (!isInt(json.bars, 1)) return bad('bars is not a whole number')
  const bars = json.bars
  if (!Array.isArray(json.pages) || json.pages.length === 0) return bad('piece.json has no pages')
  const pages: PageInfo[] = json.pages.map((page: unknown, index: number) => {
    if (!isRecord(page)) return bad(`page ${index + 1} is not an object`)
    if (!isInt(page.n, 1)) return bad(`page ${index + 1} has no number`)
    parseRange(page, bars, `page ${index + 1}`, bad)
    return { n: page.n, firstBar: page.firstBar as number, lastBar: page.lastBar as number, staves: parseStaves(page.staves ?? [], `page ${index + 1}`, bad) }
  })
  checkPages(pages, bars, bad)
  const info: PieceInfo = { format: PIECE_FORMAT, id, name: json.name, created: json.created, lastPracticed, favorite, score, pages, repairs: parseRepairs(json.repairs ?? [], bad), bars }
  if (json.partsRead !== undefined) info.partsRead = parsePartsRead(json.partsRead, bad)
  return info
}

type Bad = (message: string) => never

/** Rejects with `conflict` when [basedOn] is not the score file piece.json names now. */
function checkBase(info: PieceInfo, basedOn: string): void {
  if (basedOn !== info.score) {
    throw new LibraryError('conflict', `the piece was saved since it was loaded (${String(basedOn)} is now ${info.score})`, info.id)
  }
}

/** The infos of [pages] that are being stored, numbered from [first]; each checked on its own. */
function newPageInfos(pages: NewPage[], first: number, bars: number, bad: Bad): PageInfo[] {
  return pages.map((page, index) => {
    const where = `page ${first + index}`
    if (!isRecord(page)) return bad(`${where} is not a page`)
    if (typeof page.source !== 'string' || page.source === '') bad(`${where} has no photo`)
    if (typeof page.recognised !== 'string') bad(`${where} has no reading`)
    parseRange(page, bars, where, bad)
    return { n: first + index, firstBar: page.firstBar, lastBar: page.lastBar, staves: parseStaves(page.staves ?? [], where, bad) }
  })
}

/**
 * Checks the pages of a piece together: no page number twice, and the bar ranges follow each other
 * in reading order and cover 1..bars exactly (no gap, no overlap). Each range is checked on its own
 * before (`parseRange`).
 */
function checkPages(pages: PageInfo[], bars: number, bad: Bad): void {
  const numbers = new Set<number>()
  let next = 1
  for (const page of pages) {
    if (numbers.has(page.n)) bad(`page number ${page.n} is used twice`)
    numbers.add(page.n)
    if (page.firstBar !== next) bad(`page ${page.n} starts at bar ${page.firstBar}, not at bar ${next}`)
    next = page.lastBar + 1
  }
  if (next !== bars + 1) bad(`the pages end at bar ${next - 1}, not at the last bar ${bars}`)
}

/**
 * What a save with a bar map makes of a piece's bars (change edit-parts D10, change redesign-score-editor D8): the old bar
 * each new bar belongs to (`owners`, by index, from 1), the number of bars, and the pages with the lines of their photos
 * over the new bars. Calls [bad] for what `writeScore` refuses: a map that does not fit the piece (`checkBarMap`), a new
 * bar that holds bars of two pages, a page left without bars, and pages that do not cover the piece.
 */
function mapPieceBars(info: PieceInfo, barMap: BarMap, bad: Bad): { owners: number[]; bars: number; pages: PageInfo[] } {
  const holders = checkBarMap(barMap, info.bars, bad)
  const pageOf = (old: number): number | undefined => info.pages.find((page) => page.firstBar <= old && old <= page.lastBar)?.n
  holders.forEach((olds, b) => {
    if (new Set(olds.map(pageOf)).size > 1) bad(`bar ${b + 1} would hold bars of two pages`)
  })
  const owners = barOwners(barMap, holders)
  const bars = owners.length
  const pages: PageInfo[] = info.pages.map((page) => {
    const range = ownedRange(owners, page) ?? bad(`page ${page.n} would hold no bars`)
    const staves = page.staves.flatMap((staff) => {
      const own = ownedRange(owners, staff)
      const firstBar = Math.max(own?.firstBar ?? Infinity, range.firstBar)
      const lastBar = Math.min(own?.lastBar ?? -Infinity, range.lastBar)
      return firstBar <= lastBar ? [{ ...staff, firstBar, lastBar }] : []
    })
    return { ...page, ...range, staves }
  })
  checkPages(pages, bars, bad)
  return { owners, bars, pages }
}

/**
 * The bars of a piece after a save with [barMap], as `writeScore` would write them (see `mapPieceBars`), or why it would
 * refuse the save: what the editor checks before it offers a change of bars (change redesign-score-editor, task 5.3),
 * so that a save never fails over one. `owners` gives, for each new bar (by index), the old bar (from 1) it belongs to:
 * the page and the line of the photo it is in. Does not read or write anything.
 */
export function barsAfterSave(info: PieceInfo, barMap: BarMap): { ok: true; owners: number[]; pages: PageInfo[] } | { ok: false; reason: string } {
  try {
    const { owners, pages } = mapPieceBars(info, barMap, (message) => {
      throw new LibraryError('invalid', message, info.id)
    })
    return { ok: true, owners, pages }
  } catch (error) {
    if (error instanceof LibraryError) return { ok: false, reason: error.message }
    throw error
  }
}

/**
 * Checks a bar map (change edit-parts D10, change redesign-score-editor D8) against a piece of [bars] bars and returns,
 * for each new bar (by index), the old bars that hold it. One entry per old bar: a range of new bars or null (deleted);
 * the ranges in order, each starting at or after the end of the one before (two old bars joined share one new bar).
 * The added bars are new bars of the piece, each listed once, that belong to an old bar; one may lie inside an old
 * bar's range (a bar added between the halves of a split bar). Every new bar, from 1 to the last, is in a range or
 * added.
 */
function checkBarMap(map: BarMap, bars: number, bad: Bad): number[][] {
  if (!isRecord(map) || !Array.isArray(map.bars) || !Array.isArray(map.added)) return bad('the bar map is not a bar map')
  if (map.bars.length !== bars) return bad(`the bar map has ${map.bars.length} bars, the piece ${bars}`)
  let count = 0
  let before: { first: number; last: number } | undefined
  map.bars.forEach((range: unknown, k) => {
    if (range === null) return
    if (!isRecord(range) || !isInt(range.first, 1) || !isInt(range.last, 1) || range.last < range.first) bad(`the bar map's bar ${k + 1} is not a range`)
    const r = range as { first: number; last: number }
    if (before !== undefined && r.first < before.last) bad(`the bar map's bar ${k + 1} does not follow the one before`)
    count = Math.max(count, r.last)
    before = r
  })
  const added = new Set<number>()
  map.added.forEach((entry: unknown) => {
    if (!isRecord(entry) || !isInt(entry.bar, 1) || !isInt(entry.of, 1) || entry.of > bars) return bad('an added bar of the bar map is not a bar of the piece')
    if (added.has(entry.bar)) bad(`the bar map lists added bar ${entry.bar} twice`)
    added.add(entry.bar)
    count = Math.max(count, entry.bar)
  })
  if (count === 0) return bad('the bar map leaves no bars')
  const holders: number[][] = Array.from({ length: count }, () => [])
  map.bars.forEach((r, k) => {
    if (r) for (let b = r.first; b <= r.last; b++) holders[b - 1]!.push(k + 1)
  })
  holders.forEach((h, b) => {
    if (h.length === 0 && !added.has(b + 1)) bad(`the bar map leaves out bar ${b + 1}`)
  })
  return holders
}

/**
 * The old bar each new bar belongs to (by index), from a bar map checked by `checkBarMap` and the old bars that hold
 * each new bar ([holders]): an added bar's own (`of`), else the first old bar that holds it, and never one before the
 * bar the new bar before it belongs to. So the bars they belong to run in order, and a page or a line of the photo
 * holds one stretch of new bars.
 */
function barOwners(map: BarMap, holders: number[][]): number[] {
  const of = new Map(map.added.map((entry) => [entry.bar, entry.of]))
  let last = 1
  return holders.map((h, b) => {
    last = Math.max(last, of.get(b + 1) ?? h[0]!)
    return last
  })
}

/** The new bars that belong to one of the old bars of [range] (see `barOwners`), or undefined when none does. */
function ownedRange(owners: number[], range: { firstBar: number; lastBar: number }): { firstBar: number; lastBar: number } | undefined {
  const inside = (old: number): boolean => range.firstBar <= old && old <= range.lastBar
  const first = owners.findIndex(inside)
  if (first < 0) return undefined
  let last = owners.length - 1
  while (!inside(owners[last]!)) last--
  return { firstBar: first + 1, lastBar: last + 1 }
}

/**
 * practice.json's text with its bar and loop carried over a bar map, whose new bars belong to the old bars [owners]
 * (see `barOwners`): the bar to the first new bar of the old one; for a deleted bar to the first new bar that belongs
 * to it or to a bar after it (a bar added in its place, else the bar that follows), else to the last bar; the loop from
 * the first new bar of its first surviving bar to the last new bar of its last surviving bar, or no loop (null) when
 * none survived. A bar deleted and then joined across is held by the joined bar, so it survives there. Anything else
 * in it stays as it is; a bar that is not in the map stays too. Undefined when the text does not read: it is then
 * left alone.
 */
function mapPractice(text: string, map: BarMap, owners: number[]): string | undefined {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return undefined
  }
  if (!isRecord(json)) return undefined
  const state = { ...json }
  const old = map.bars
  const bar = state.bar
  if (isInt(bar, 1) && bar <= old.length) {
    const next = owners.findIndex((owner) => owner >= bar)
    state.bar = old[bar - 1]?.first ?? (next >= 0 ? next + 1 : owners.length)
  }
  const loop = state.loop
  if (isRecord(loop) && isInt(loop.start, 1) && isInt(loop.end, 1) && loop.start <= old.length && loop.end <= old.length) {
    const kept = old.slice(loop.start - 1, loop.end).filter((r) => r !== null)
    state.loop = kept.length === 0 ? null : { ...loop, start: kept[0]!.first, end: kept[kept.length - 1]!.last }
  }
  return serialise(state)
}

/** Checks that [value] has whole `firstBar` and `lastBar` with 1 <= first <= last <= bars. */
function parseRange(value: unknown, bars: number, where: string, bad: Bad): void {
  const r = value as Record<string, unknown>
  if (!isInt(r.firstBar, 1) || !isInt(r.lastBar, 1) || r.lastBar < r.firstBar || r.lastBar > bars) {
    bad(`${where}: the bar range is not 1 <= first <= last <= ${bars}`)
  }
}

function parseStaves(value: unknown, where: string, bad: Bad): Staff[] {
  if (!Array.isArray(value)) return bad(`${where}: staves is not a list`)
  return value.map((staff: unknown, index: number): Staff => {
    const at = `${where}, staff ${index + 1}`
    if (!isRecord(staff) || !isRecord(staff.box)) return bad(`${at}: no box`)
    const { x, y, width, height } = staff.box
    for (const part of [x, y, width, height]) {
      if (typeof part !== 'number' || !(part >= 0 && part <= 1)) return bad(`${at}: the box is not four fractions from 0 to 1`)
    }
    parseRange(staff, Number.MAX_SAFE_INTEGER, at, bad)
    return { box: { x: x as number, y: y as number, width: width as number, height: height as number }, firstBar: staff.firstBar as number, lastBar: staff.lastBar as number }
  })
}

function parsePartsRead(value: unknown, bad: Bad): PartRead[] {
  if (!Array.isArray(value)) return bad('partsRead is not a list')
  return value.map((part: unknown): PartRead => {
    if (!isRecord(part) || (part.staves !== 1 && part.staves !== 2) || typeof part.kept !== 'boolean') return bad('a part read needs its staves (1 or 2) and whether it was kept')
    return { staves: part.staves, kept: part.kept }
  })
}

function parseRepairs(value: unknown, bad: Bad): Repair[] {
  if (!Array.isArray(value)) return bad('repairs is not a list')
  return value.map((repair: unknown): Repair => {
    if (!isRecord(repair) || typeof repair.bar !== 'string' || typeof repair.message !== 'string') return bad('a repair needs a bar and a message')
    return { bar: repair.bar, message: repair.message }
  })
}

/** A practice state from anything that was stored: every field that is wrong becomes its default. */
export function normalisePractice(value: unknown): PracticeState {
  const o = isRecord(value) ? value : {}
  const d = DEFAULT_PRACTICE
  const loop = isRecord(o.loop) && isInt(o.loop.start, 1) && isInt(o.loop.end, 1) && o.loop.end >= o.loop.start ? { start: o.loop.start, end: o.loop.end } : null
  const state: PracticeState = {
    bar: isInt(o.bar, 1) ? o.bar : d.bar,
    tempo: typeof o.tempo === 'number' && Number.isFinite(o.tempo) && o.tempo > 0 ? o.tempo : d.tempo,
    loop,
    loopRest: o.loopRest === 1 || o.loopRest === 2 ? o.loopRest : d.loopRest,
    metronome: typeof o.metronome === 'boolean' ? o.metronome : d.metronome,
  }
  // The fields of parts-and-accompaniment are kept only when they are well formed; a bad one is as if absent.
  if (isRecord(o.part) && typeof o.part.id === 'string' && o.part.id !== '') {
    state.part = o.part.hand === 'right' || o.part.hand === 'left' ? { id: o.part.id, hand: o.part.hand } : { id: o.part.id }
  }
  if (Array.isArray(o.silent) && o.silent.every((s) => typeof s === 'string')) state.silent = [...(o.silent as string[])]
  if (typeof o.ownLine === 'boolean') state.ownLine = o.ownLine
  if (typeof o.instrument === 'string' && o.instrument !== '') state.instrument = o.instrument
  else if (o.instrument === null) state.instrument = null
  if (typeof o.partsHintSeen === 'boolean') state.partsHintSeen = o.partsHintSeen
  return state
}
