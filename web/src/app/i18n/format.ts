import type { PluralForms } from './en.ts'

/*
 * The pure helpers behind `i18n/index.ts` (practice-app design D13): filling in `{placeholders}`,
 * choosing a plural form with `Intl.PluralRules`, and working out "yesterday" for a date. They take
 * the `Intl` objects and the clock as arguments, so tests can fix both.
 */

/** The values a message is filled in with. A number is formatted for the language (no thousands separator). */
export type Params = Readonly<Record<string, string | number>>

/** Replaces each `{name}` with its parameter; a name without a parameter stays as written, so the gap is easy to see. */
export function fill(template: string, params: Params, numbers: Intl.NumberFormat): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    if (!Object.hasOwn(params, name)) return whole
    const value = params[name]
    return typeof value === 'number' ? numbers.format(value) : String(value)
  })
}

/** The form of a message for these parameters: a plain message as it is, a plural one by the language's rule for `count`. */
export function pickForm(message: string | PluralForms, params: Params, plural: Intl.PluralRules): string {
  if (typeof message === 'string') return message
  const count = Number(params.count)
  return Number.isNaN(count) ? message.other : message[plural.select(count) === 'one' ? 'one' : 'other']
}

/** The first letter in upper case, by the rules of the language ("gisteren geoefend" becomes "Gisteren geoefend"). */
export function capitalise(text: string, locale: string): string {
  return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1)
}

const MS_PER_DAY = 86_400_000

function startOfLocalDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/** How many calendar days in the phone's time zone `now` is after `date`: 0 for the same day, 1 for the day before, negative for a later date. */
export function calendarDaysBetween(date: Date, now: Date): number {
  return Math.round((startOfLocalDay(now) - startOfLocalDay(date)) / MS_PER_DAY)
}

/**
 * How long ago `date` is, in the unit a person would say it in: days up to a week, then weeks,
 * months and years (30 and 365 days). The count is of calendar days, not of 24 hours, so a piece
 * practised at 23:50 is "yesterday" at 00:10. A date in the future (a clock that was set back) counts as today.
 */
export function relativeParts(date: Date, now: Date): { value: number; unit: 'day' | 'week' | 'month' | 'year' } {
  const days = Math.max(0, calendarDaysBetween(date, now))
  if (days < 7) return { value: days === 0 ? 0 : -days, unit: 'day' }
  if (days < 30) return { value: -Math.floor(days / 7), unit: 'week' }
  if (days < 365) return { value: -Math.floor(days / 30), unit: 'month' }
  return { value: -Math.floor(days / 365), unit: 'year' }
}

/** A `Date` from a stored ISO time or a `Date`; undefined for a value that is not a valid time. */
export function toDate(value: Date | string): Date | undefined {
  const date = typeof value === 'string' ? new Date(value) : value
  return Number.isNaN(date.getTime()) ? undefined : date
}
