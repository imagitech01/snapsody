import { computed, signal } from '@preact/signals'
import type { ReadonlySignal, Signal } from '@preact/signals'
import { DEFAULT_TEMPO, clampTempo, startingTempo, tempoSetup } from '../core/playback/tempo.ts'
import { parseMusicXml } from '../core/score/musicxml.ts'
import type { I18n } from './i18n/index.ts'
import { DEFAULT_PRACTICE } from './library.ts'
import type { Library, PieceInfo, PracticeState } from './library.ts'
import type { LibraryView, PieceRow } from './libraryView.ts'

/*
 * The Practice tab's start screen (practice-app design D11, spec `practice-home`): which piece to
 * continue, the rotation of favorites, and whether this is the first launch. All of it is derived
 * from the `LibraryView`'s list, which the library and favorites screens share, so starring a piece
 * puts it in the rotation at once and deleting it takes it out of the rotation and the continue card.
 *
 * - The continue piece is the one with the latest `lastPracticed`. A piece that was only added is
 *   not one: with nothing practised yet there is no continue piece (and no card).
 * - The card adds what `practice.json` remembers of that piece: the bar, the tempo, the metronome and
 *   the loop. They are read in `refresh()`, together with the list, so the card never shows a piece
 *   with another piece's settings; it is null until the first refresh has read them.
 * - The tempo on the card is the one the piece opens with: the user's choice (`tempoChosen`), else
 *   the tempo its marking gives (the score is read for that).
 * - The rotation is the favorites, in the library's order, with their name, length and summary.
 *
 * `refresh()` is for when the screen is shown: a practice session changes `lastPracticed` and the
 * settings of the piece it was on, which nothing else tells the store about.
 */

/** The continue card: the piece and how the user left it. */
export interface ContinueCard {
  piece: PieceInfo
  /** The bar the user was at, from 1, held to the piece's bars. */
  bar: number
  /** The number of bars of the piece. */
  bars: number
  /** Beats per minute the piece opens at. */
  tempo: number
  /** The user chose this tempo (otherwise it is the piece's marking, or 80). */
  tempoChosen: boolean
  metronome: boolean
  /** The bars looping, or null. */
  loop: { start: number; end: number } | null
}

/** What the card needs of the library. */
export type HomeLibrary = Pick<Library, 'readPractice' | 'load'>

export interface HomeDeps {
  /** The store the library screens share. */
  view: LibraryView
  library: HomeLibrary
  i18n: Pick<I18n, 'pieceSummary' | 't'>
}

/** The piece practised last: the latest `lastPracticed` (the first in the list's order on a tie), or undefined when none was practised. */
export function continuePieceOf(pieces: readonly PieceInfo[]): PieceInfo | undefined {
  let best: PieceInfo | undefined
  let bestTime = Number.NEGATIVE_INFINITY
  for (const piece of pieces) {
    if (piece.lastPracticed === null) continue
    const time = Date.parse(piece.lastPracticed)
    if (Number.isNaN(time) || time <= bestTime) continue
    best = piece
    bestTime = time
  }
  return best
}

/** What was read for the card of one piece. */
interface CardDetails {
  id: string
  practice: PracticeState
  tempo: number
  tempoChosen: boolean
}

export class Home {
  /** The store the library screens share. */
  readonly view: LibraryView
  /** The list has been read and there are no pieces: the start screen invites the user to add the first music. */
  readonly firstLaunch: ReadonlySignal<boolean>
  /** The piece practised last, or undefined. */
  readonly continuePiece: ReadonlySignal<PieceInfo | undefined>
  /** The continue card, or null when there is no continue piece or its settings have not been read yet. */
  readonly continueCard: ReadonlySignal<ContinueCard | null>
  /** The favorite pieces. */
  readonly rotation: ReadonlySignal<readonly PieceRow[]>
  /** There are pieces but no favorites: the rotation explains that starring a piece adds it here. */
  readonly rotationEmpty: ReadonlySignal<boolean>

  private readonly library: HomeLibrary
  private readonly details: Signal<CardDetails | null>
  private latest = 0

  constructor(deps: HomeDeps) {
    const { view } = deps
    this.view = view
    this.library = deps.library
    this.details = signal(null)
    this.firstLaunch = view.isEmpty
    this.continuePiece = computed(() => continuePieceOf(view.pieces.value))
    this.rotation = view.favorites
    this.rotationEmpty = computed(() => view.loaded.value && !view.isEmpty.value && view.favorites.value.length === 0)
    this.continueCard = computed(() => {
      const piece = this.continuePiece.value
      const details = this.details.value
      if (!piece || !details || details.id !== piece.id) return null
      const { practice } = details
      const bar = Math.min(piece.bars, Math.max(1, practice.bar))
      return { piece, bar, bars: piece.bars, tempo: details.tempo, tempoChosen: details.tempoChosen, metronome: practice.metronome, loop: practice.loop }
    })
  }

  /** Reads the list again, and the settings of the continue piece. Rejects when the library cannot be read. */
  async refresh(): Promise<void> {
    await this.view.refresh()
    const mine = ++this.latest
    const piece = this.continuePiece.value
    const details = piece ? await this.readDetails(piece) : null
    if (mine === this.latest) this.details.value = details
  }

  /** What `practice.json` remembers of a piece (the defaults when it has none) and the tempo it opens at. */
  private async readDetails(piece: PieceInfo): Promise<CardDetails> {
    let practice: PracticeState = DEFAULT_PRACTICE
    try {
      practice = (await this.library.readPractice(piece.id)) ?? DEFAULT_PRACTICE
    } catch {
      // Only a convenience: the card shows the defaults.
    }
    if (practice.tempo !== null) return { id: piece.id, practice, tempo: clampTempo(practice.tempo), tempoChosen: true }
    // No tempo chosen yet: the one the score's marking gives, as the practice session starts it.
    let tempo = DEFAULT_TEMPO
    try {
      tempo = startingTempo(null, tempoSetup(parseMusicXml((await this.library.load(piece.id)).musicxml)))
    } catch {
      // A score that cannot be read: the card shows the default tempo; opening the piece says what is wrong.
    }
    return { id: piece.id, practice, tempo, tempoChosen: false }
  }
}

export function createHome(deps: HomeDeps): Home {
  return new Home(deps)
}
