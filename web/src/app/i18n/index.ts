import { instrumentById } from '../../core/instruments/instruments.ts'
import type { InstrumentFamily } from '../../core/instruments/instruments.ts'
import { midiName } from '../../core/score/repairs.ts'
import type { ScoreWarning } from '../../core/score/warnings.ts'
import { en } from './en.ts'
import type { MessageKey } from './en.ts'
import { capitalise, fill, pickForm, relativeParts, toDate } from './format.ts'
import type { Params } from './format.ts'

export type { MessageKey, PluralForms } from './en.ts'
export type { Params } from './format.ts'

/*
 * The app's texts without a library (practice-app design D13; English only since `paper-and-ink-and-about` D11).
 *
 *   const i18n = createI18n()
 *   i18n.t('tab.library')                                   // "Library"
 *   i18n.t('unit.pages', { count: 2 })                      // "2 pages"
 *   i18n.practised('2026-11-17T09:00:00Z')                  // "Practised yesterday"
 *
 * - `t` takes exactly the `{placeholders}` of the message (read from `en.ts` by the type checker)
 *   and picks the plural form with `Intl.PluralRules`. A missing key does not compile.
 * - Dates and times use `Intl.RelativeTimeFormat` and `Intl.DateTimeFormat`, and the calendar days
 *   are the phone's local days. Every function that depends on the time takes `now`, for tests.
 * - Instrument names are not copied here: `core/instruments` has them.
 */

/** The BCP 47 locale everything is formatted with: dates as "18 Nov, 14:05". */
const LOCALE = 'en-GB'

// ---- Typed parameters ----------------------------------------------------------------------

/** The names between braces in a message: "Bar {bar} of {bars}" gives "bar" | "bars". */
type Placeholders<S> = S extends `${string}{${infer Name}}${infer Rest}` ? Name | Placeholders<Rest> : never

type PlaceholdersOf<M> = M extends string
  ? Placeholders<M>
  : M extends { readonly one: infer One; readonly other: infer Other }
    ? Placeholders<One> | Placeholders<Other>
    : never

/** The parameters a message needs. */
export type ParamNames<K extends MessageKey> = PlaceholdersOf<(typeof en)[K]>

/** `t`'s rest arguments: none for a message without placeholders, else one object with each of them. */
export type ParamsArgs<K extends MessageKey> = [ParamNames<K>] extends [never] ? [] : [params: { readonly [P in ParamNames<K>]: string | number }]

// ---- The translator ------------------------------------------------------------------------

/** What `pieceSummary` needs of a piece: its `piece.json` fields. */
export interface PieceSummaryInput {
  /** The number of pages; the summary says so only for more than one. */
  pages: number
  bars: number
  /** ISO 8601 time of the last practice, or null. */
  lastPracticed: string | null
  /** ISO 8601 time the piece was added. */
  created: string
}

export interface I18n {
  /** A message, with its parameters filled in (and the plural form chosen from `count`). */
  t<K extends MessageKey>(key: K, ...params: ParamsArgs<K>): string
  /** An instrument's name, from `core/instruments` (the id itself for an id that does not exist). */
  instrumentName(id: string): string
  /** The label of an instrument family ("Woodwind"). */
  familyName(family: InstrumentFamily): string
  /**
   * What a score warning says, built from its `kind`, `bar`, `pitch`,
   * `instrument` (and the instrument's written range), `counted` and `time`. The warning's own English `message` is used
   * for a kind or a field this does not know.
   */
  warning(warning: ScoreWarning): string
  /** How long ago, in words and without a capital: "today", "yesterday", "3 days ago", "last week". Empty for a time that is not valid. */
  relativeTime(when: Date | string, now?: Date): string
  /** "Practised yesterday". */
  practised(when: Date | string, now?: Date): string
  /** "Added today". */
  added(when: Date | string, now?: Date): string
  /** The library's summary line: "2 pages · 24 bars · Practised yesterday" (pages only above one; "Added …" when never practised). */
  pieceSummary(piece: PieceSummaryInput, now?: Date): string
  /** The name a new piece gets: the date and time it was added, like "18 Nov, 14:05". */
  defaultPieceName(added: Date): string
}

const plural = new Intl.PluralRules(LOCALE)
const numbers = new Intl.NumberFormat(LOCALE, { useGrouping: false })
const relative = new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto' })
const dateTime = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

/** The translator. */
export function createI18n(): I18n {
  const t = ((key: MessageKey, params: Params = {}): string => fill(pickForm(en[key], params, plural), params, numbers)) as I18n['t']

  const relativeTime = (when: Date | string, now: Date = new Date()): string => {
    const date = toDate(when)
    if (!date) return ''
    const { value, unit } = relativeParts(date, now)
    return relative.format(value, unit)
  }

  const sentence = (key: 'library.summary.practised' | 'library.summary.added', when: Date | string, now: Date): string =>
    capitalise(t(key, { when: relativeTime(when, now) }), LOCALE)

  const practised: I18n['practised'] = (when, now = new Date()) => sentence('library.summary.practised', when, now)
  const added: I18n['added'] = (when, now = new Date()) => sentence('library.summary.added', when, now)

  const instrumentName: I18n['instrumentName'] = (id) => instrumentById(id)?.name ?? id

  const warning: I18n['warning'] = (w) => {
    const bar = w.bar
    // The hand and the voice, when the part has more than one (change edit-parts, D5): "left hand, voice 2".
    const hand = w.hand ? t(`warning.hand.${w.hand}`) : undefined
    const place =
      hand && w.voiceNumber
        ? t('warning.place.handVoice', { hand, voice: w.voiceNumber })
        : hand
          ? t('warning.place.hand', { hand })
          : w.voiceNumber
            ? t('warning.place.voice', { voice: w.voiceNumber })
            : undefined
    switch (w.kind) {
      case 'bar-length':
        if (bar === undefined || w.counted === undefined || w.time === undefined) return w.message
        if (place) return t('warning.bar-length.place', { bar, place, counted: w.counted, beats: w.time.beats, beatType: w.time.beatType })
        return t('warning.bar-length', { bar, counted: w.counted, beats: w.time.beats, beatType: w.time.beatType })
      case 'out-of-range': {
        const instrument = w.instrument === undefined ? undefined : instrumentById(w.instrument)
        if (bar === undefined || w.pitch === undefined || !instrument) return w.message
        const { low, high } = instrument.writtenRange
        const params = { bar, pitch: w.pitch, instrument: instrumentName(instrument.id), low: midiName(low), high: midiName(high) }
        return place ? t('warning.out-of-range.place', { ...params, place }) : t('warning.out-of-range', params)
      }
      case 'time-signature-inferred':
        return w.time === undefined ? w.message : t('warning.time-signature-inferred', { beats: w.time.beats, beatType: w.time.beatType })
      case 'time-signature-missing':
        return t('warning.time-signature-missing')
      default:
        return w.message
    }
  }

  return {
    t,
    instrumentName,
    familyName: (family) => t(`family.${family}`),
    warning,
    relativeTime,
    practised,
    added,
    pieceSummary: (piece, now = new Date()) => {
      const parts: string[] = []
      if (piece.pages > 1) parts.push(t('unit.pages', { count: piece.pages }))
      parts.push(t('unit.bars', { count: piece.bars }))
      if (piece.lastPracticed !== null && toDate(piece.lastPracticed)) parts.push(practised(piece.lastPracticed, now))
      else if (toDate(piece.created)) parts.push(added(piece.created, now))
      return parts.join(' · ')
    },
    defaultPieceName: (date) => dateTime.format(date),
  }
}
