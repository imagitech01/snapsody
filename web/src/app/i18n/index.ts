import { computed } from '@preact/signals'
import type { ReadonlySignal } from '@preact/signals'
import { instrumentById } from '../../core/instruments/instruments.ts'
import type { InstrumentFamily } from '../../core/instruments/instruments.ts'
import { midiName } from '../../core/score/repairs.ts'
import type { ScoreWarning } from '../../core/score/warnings.ts'
import type { Device } from '../../platform/port.ts'
import type { Language, Settings } from '../settings.ts'
import { en } from './en.ts'
import type { Catalogue, MessageKey } from './en.ts'
import { capitalise, fill, pickForm, relativeParts, toDate } from './format.ts'
import type { Params } from './format.ts'
import { nl } from './nl.ts'

export type { Language } from '../settings.ts'
export type { Catalogue, MessageKey, PluralForms } from './en.ts'
export type { Params } from './format.ts'

/*
 * English and Dutch without a library (practice-app design D13, spec `app-shell` "English and Dutch").
 *
 *   const i18n = await loadI18n(settings, platform.device)
 *   i18n.t('tab.library')                                   // "Library" / "Bibliotheek"
 *   i18n.t('unit.pages', { count: 2 })                      // "2 pages" / "2 pagina's"
 *   i18n.practised('2026-11-17T09:00:00Z')                  // "Practised yesterday" / "Gisteren geoefend"
 *
 * - The language is a signal: the user's choice in the settings, else the device's language (Dutch
 *   when its tag starts with "nl"), else English. Everything here reads it when it is called, so a
 *   component or effect that calls `t` re-renders when the language changes, at once and without a restart.
 * - `t` takes exactly the `{placeholders}` of the message (read from `en.ts` by the type checker)
 *   and picks the plural form with `Intl.PluralRules`. A missing key does not compile.
 * - Dates and times use `Intl.RelativeTimeFormat` and `Intl.DateTimeFormat`, and the calendar days
 *   are the phone's local days. Every function that depends on the time takes `now`, for tests.
 * - Instrument names are not copied here: `core/instruments` has them in both languages.
 */

/** The BCP 47 locale each language is formatted with: dates as "18 Nov, 14:05", Flemish Dutch. */
const LOCALES: Readonly<Record<Language, string>> = { en: 'en-GB', nl: 'nl-BE' }

const CATALOGUES: Readonly<Record<Language, Catalogue>> = { en, nl }

// ---- Choosing the language -----------------------------------------------------------------

/** The language of a device tag like "nl-BE", "nl_NL" or "en-US": Dutch when it starts with "nl", English for anything else. */
export function languageFromTag(tag: string | null | undefined): Language {
  return typeof tag === 'string' && /^nld?(?:[-_]|$)/i.test(tag.trim()) ? 'nl' : 'en'
}

/** The user's choice when there is one, else the device's language, else English. */
export function resolveLanguage(chosen: Language | null, deviceTag?: string | null): Language {
  return chosen ?? languageFromTag(deviceTag)
}

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
  /** The language in use. */
  readonly language: ReadonlySignal<Language>
  /** The language the device's own language resolves to (what "same as the phone" means). */
  readonly deviceLanguage: Language
  /** A message in the current language, with its parameters filled in (and the plural form chosen from `count`). */
  t<K extends MessageKey>(key: K, ...params: ParamsArgs<K>): string
  /** An instrument's name in the current language, from `core/instruments` (the id itself for an id that does not exist). */
  instrumentName(id: string): string
  /** The label of an instrument family ("Woodwind", "Houtblazers"). */
  familyName(family: InstrumentFamily): string
  /**
   * What a score warning says, in the current language, built from its `kind`, `bar`, `pitch`,
   * `instrument` (and the instrument's written range), `counted` and `time`. The warning's own English `message` is used
   * for a kind or a field this does not know.
   */
  warning(warning: ScoreWarning): string
  /** How long ago, in words and without a capital: "today", "yesterday", "3 days ago", "last week" ("gisteren", "3 dagen geleden"). Empty for a time that is not valid. */
  relativeTime(when: Date | string, now?: Date): string
  /** "Practised yesterday" / "Gisteren geoefend". */
  practised(when: Date | string, now?: Date): string
  /** "Added today" / "Vandaag toegevoegd". */
  added(when: Date | string, now?: Date): string
  /** The library's summary line: "2 pages · 24 bars · Practised yesterday" (pages only above one; "Added …" when never practised). */
  pieceSummary(piece: PieceSummaryInput, now?: Date): string
  /** The name a new piece gets: the date and time it was added, like "18 Nov, 14:05" / "18 nov, 14:05". */
  defaultPieceName(added: Date): string
}

interface Tools {
  locale: string
  plural: Intl.PluralRules
  numbers: Intl.NumberFormat
  relative: Intl.RelativeTimeFormat
  dateTime: Intl.DateTimeFormat
}

function toolsFor(language: Language): Tools {
  const locale = LOCALES[language]
  return {
    locale,
    plural: new Intl.PluralRules(locale),
    numbers: new Intl.NumberFormat(locale, { useGrouping: false }),
    relative: new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }),
    dateTime: new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
  }
}

/**
 * The translator for a choice of language and the device's language tag. [chosen] is
 * `settings.language` (null follows the device); [deviceTag] is what `Device.language()` said.
 */
export function createI18n(chosen: ReadonlySignal<Language | null>, deviceTag?: string | null): I18n {
  const language = computed(() => resolveLanguage(chosen.value, deviceTag))
  const tools: Record<Language, Tools> = { en: toolsFor('en'), nl: toolsFor('nl') }

  const t = ((key: MessageKey, params: Params = {}): string => {
    const lang = language.value
    const { plural, numbers } = tools[lang]
    return fill(pickForm(CATALOGUES[lang][key], params, plural), params, numbers)
  }) as I18n['t']

  const relativeTime = (when: Date | string, now: Date = new Date()): string => {
    const date = toDate(when)
    if (!date) return ''
    const { value, unit } = relativeParts(date, now)
    return tools[language.value].relative.format(value, unit)
  }

  const sentence = (key: 'library.summary.practised' | 'library.summary.added', when: Date | string, now: Date): string =>
    capitalise(t(key, { when: relativeTime(when, now) }), tools[language.value].locale)

  const practised: I18n['practised'] = (when, now = new Date()) => sentence('library.summary.practised', when, now)
  const added: I18n['added'] = (when, now = new Date()) => sentence('library.summary.added', when, now)

  const instrumentName: I18n['instrumentName'] = (id) => instrumentById(id)?.names[language.value] ?? id

  const warning: I18n['warning'] = (w) => {
    const bar = w.bar
    switch (w.kind) {
      case 'bar-length':
        if (bar === undefined || w.counted === undefined || w.time === undefined) return w.message
        return t('warning.bar-length', { bar, counted: w.counted, beats: w.time.beats, beatType: w.time.beatType })
      case 'out-of-range': {
        const instrument = w.instrument === undefined ? undefined : instrumentById(w.instrument)
        if (bar === undefined || w.pitch === undefined || !instrument) return w.message
        const { low, high } = instrument.writtenRange
        return t('warning.out-of-range', { bar, pitch: w.pitch, instrument: instrumentName(instrument.id), low: midiName(low), high: midiName(high) })
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
    language,
    deviceLanguage: resolveLanguage(null, deviceTag),
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
    defaultPieceName: (date) => tools[language.value].dateTime.format(date),
  }
}

/**
 * The translator for the app's start: asks the device for its language once (English when it
 * cannot say) and follows `settings.language` from then on.
 */
export async function loadI18n(settings: Pick<Settings, 'language'>, device: Pick<Device, 'language'>): Promise<I18n> {
  let tag: string | undefined
  try {
    tag = await device.language()
  } catch {
    // The device could not say: English, unless the user chose.
  }
  return createI18n(settings.language, tag)
}
