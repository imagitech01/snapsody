import { computed, signal } from '@preact/signals'
import type { ReadonlySignal, Signal } from '@preact/signals'
import type { I18n } from './i18n/index.ts'
import type { Library, PieceInfo, PieceProblem } from './library.ts'
import { matchesSearch } from './search.ts'

/*
 * The library as the screens see it (practice-app design D11, spec `piece-library` "Library list",
 * "Search", "Favorites", "Rename" and "Delete a piece"): the list of `piece.json` files as one
 * signal, with everything else derived from it. The library screen, the favorites screen and the
 * start screen (`home.ts`) all read this one store, so a star tapped in one place is in the others
 * at once.
 *
 * - `refresh()` reads the list again. The store refreshes itself after what it changes (star,
 *   rename, delete). Whatever else changes a piece must call `refresh()` too: adding music, when a
 *   piece is made or pages are added, and leaving a practice session, which sets `lastPracticed`.
 *   A refresh that is overtaken by a later one is dropped, so a slow read never overwrites a newer list.
 * - The list is in the library's order: the most recently practised or added piece first.
 * - A row carries the text the screens show, made with `i18n`: the summary line ("2 pages · 24 bars
 *   · Practised yesterday") and the length ("24 bars"). Rows are made again
 *   on every refresh, so "yesterday" is right the next time the screen is shown.
 * - Search matches the name, ignoring case and accents (`search.ts`). It filters the library list
 *   (`visible`); the favorites list is not filtered.
 */

/** What the store calls on the library. */
export type LibraryStore = Pick<Library, 'list' | 'update' | 'remove'>

/** A piece as a list shows it. */
export interface PieceRow {
  info: PieceInfo
  /** "2 pages · 24 bars · Practised yesterday". */
  summary: string
  /** "24 bars". */
  length: string
}

export interface LibraryViewDeps {
  library: LibraryStore
  i18n: Pick<I18n, 'pieceSummary' | 't'>
  /** The time "yesterday" is counted from; the phone's clock by default. */
  now?: () => Date
}

export class LibraryView {
  /** True once the list has been read once. Until then the screens show nothing rather than an invitation to add music. */
  readonly loaded: ReadonlySignal<boolean>
  /** Every piece, in the library's order. */
  readonly pieces: ReadonlySignal<readonly PieceInfo[]>
  /** The folders that could not be read as pieces; they are not listed and are left alone. */
  readonly problems: ReadonlySignal<readonly PieceProblem[]>
  /** What the user typed in the search field. */
  readonly query: Signal<string>
  /** Every piece as a row. */
  readonly rows: ReadonlySignal<readonly PieceRow[]>
  /** The rows whose name matches `query`, ignoring case and accents; all of them when it is empty. */
  readonly visible: ReadonlySignal<readonly PieceRow[]>
  /** The favorite pieces, in the library's order. */
  readonly favorites: ReadonlySignal<readonly PieceRow[]>
  /** The list has been read and there are no pieces at all: the library invites the user to add music. */
  readonly isEmpty: ReadonlySignal<boolean>
  /** There are pieces, a search text, and nothing matches: the library says so. */
  readonly noMatch: ReadonlySignal<boolean>

  private readonly library: LibraryStore
  private readonly loadedSignal: Signal<boolean>
  private readonly piecesSignal: Signal<readonly PieceInfo[]>
  private readonly problemsSignal: Signal<readonly PieceProblem[]>
  /** The number of the latest refresh; an older one that finishes later is dropped. */
  private latest = 0

  constructor(deps: LibraryViewDeps) {
    const { library, i18n } = deps
    const now = deps.now ?? (() => new Date())
    this.library = library
    this.loadedSignal = signal(false)
    this.piecesSignal = signal<readonly PieceInfo[]>([])
    this.problemsSignal = signal<readonly PieceProblem[]>([])
    this.query = signal('')
    this.loaded = this.loadedSignal
    this.pieces = this.piecesSignal
    this.problems = this.problemsSignal
    this.rows = computed(() => {
      const at = now()
      return this.piecesSignal.value.map(
        (info): PieceRow => ({
          info,
          summary: i18n.pieceSummary({ pages: info.pages.length, bars: info.bars, lastPracticed: info.lastPracticed, created: info.created }, at),
          length: i18n.t('unit.bars', { count: info.bars }),
        }),
      )
    })
    this.visible = computed(() => {
      const rows = this.rows.value
      const wanted = this.query.value
      return rows.filter((row) => matchesSearch(row.info.name, wanted))
    })
    this.favorites = computed(() => this.rows.value.filter((row) => row.info.favorite))
    this.isEmpty = computed(() => this.loadedSignal.value && this.piecesSignal.value.length === 0)
    this.noMatch = computed(() => this.piecesSignal.value.length > 0 && this.visible.value.length === 0)
  }

  /** Reads the list again. Rejects when the library cannot be read, and then leaves the list as it was. */
  async refresh(): Promise<void> {
    const mine = ++this.latest
    const listing = await this.library.list()
    if (mine !== this.latest) return
    this.piecesSignal.value = listing.pieces
    this.problemsSignal.value = listing.problems
    this.loadedSignal.value = true
  }

  /** Stars or unstars a piece. */
  setFavorite(id: string, favorite: boolean): Promise<void> {
    return this.changed(() => this.library.update(id, { favorite }))
  }

  /** Flips the star of a piece, as it is in the list now. A piece that is not in the list is left alone. */
  toggleFavorite(id: string): Promise<void> {
    const piece = this.piecesSignal.value.find((p) => p.id === id)
    return piece ? this.setFavorite(id, !piece.favorite) : Promise.resolve()
  }

  /** Renames a piece. Rejects, and changes nothing, for an empty name. */
  rename(id: string, name: string): Promise<void> {
    return this.changed(() => this.library.update(id, { name }))
  }

  /** Deletes a piece with its files; asking the user first is the screen's job. */
  remove(id: string): Promise<void> {
    return this.changed(() => this.library.remove(id))
  }

  /** Runs a change and then refreshes, also when the change failed (the list may be out of date because of why); the first failure is the one thrown. */
  private async changed(change: () => Promise<unknown>): Promise<void> {
    let failure: { error: unknown } | undefined
    try {
      await change()
    } catch (error) {
      failure = { error }
    }
    try {
      await this.refresh()
    } catch (error) {
      failure ??= { error }
    }
    if (failure) throw failure.error
  }
}

export function createLibraryView(deps: LibraryViewDeps): LibraryView {
  return new LibraryView(deps)
}
