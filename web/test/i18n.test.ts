import assert from 'node:assert/strict'
import { test } from 'node:test'
import { signal } from '@preact/signals'
import { createI18n } from '../src/app/i18n/index.ts'
import type { I18n, MessageKey, PluralForms } from '../src/app/i18n/index.ts'
import { en } from '../src/app/i18n/en.ts'
import { calendarDaysBetween, capitalise, fill, pickForm, relativeParts } from '../src/app/i18n/format.ts'
import { ALTO_SAX, GUITAR, INSTRUMENTS, PIANO, TENOR_SAX } from '../src/core/instruments/instruments.ts'
import type { InstrumentFamily } from '../src/core/instruments/instruments.ts'
import { parseMusicXml } from '../src/core/score/musicxml.ts'
import type { NoteNameStyle } from '../src/core/score/noteNames.ts'
import { prepareRecognisedScore } from '../src/core/score/prepare.ts'
import type { GridRefusal, NoteValue } from '../src/core/score/edit.ts'
import { firstVoice } from '../src/core/score/model.ts'
import { suggestRepairs } from '../src/core/score/suggest.ts'
import type { ScoreWarning, ScoreWarningKind } from '../src/core/score/warnings.ts'
import { eighths, note, quarters, score } from './helpers.ts'
import { firstLine, warningsFor } from './helpers.ts'

// The English texts (practice-app task 9.1, design D13; English only since `paper-and-ink-and-about` D11):
// the catalogue, plurals, relative dates and the warning messages. Every date is built with the local constructor and `now` is passed in, so
// "yesterday" (a local calendar day) comes out the same in any time zone.

const entries = (catalogue: typeof en): Array<[string, string | PluralForms]> => Object.entries(catalogue)
const textsOf = (value: string | PluralForms): string[] => (typeof value === 'string' ? [value] : [value.one, value.other])
const placeholdersOf = (value: string | PluralForms): string[] =>
  [...new Set(textsOf(value).flatMap((text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!)))].sort()
const iso = (...local: [number, number, number, number?, number?]): string => new Date(...local).toISOString()
const NOW = new Date(2026, 10, 18, 14, 5) // 18 November 2026, 14:05

// ---- The catalogues --------------------------------------------------------------------------

test('catalogues: no message is empty or has stray whitespace', () => {
  for (const [key, value] of entries(en)) {
    for (const text of textsOf(value)) {
      assert.ok(text.length > 0, `${key} is empty`)
      assert.equal(text, text.trim(), `${key} has leading or trailing space`)
    }
  }
})

test('catalogues: no technical term shows (spec `app-shell` "Name and words")', () => {
  const technical = /recogni[sz]|musicxml|\bmodel\b|\bgpu\b|accelerat/i
  for (const [key, value] of entries(en)) {
    for (const text of textsOf(value)) assert.ok(!technical.test(text), `${key}: ${text}`)
  }
})

test('catalogues: a piece is a "piece"', () => {
  assert.match(en['library.delete.title'] as string, /piece/)
})

// Compile-time checks: `npm run typecheck` fails when an `@ts-expect-error` below stops being an
// error, so these prove that the types catch what the runtime checks above can only observe.
// The function is never called.
export function typeChecks(i18n: I18n): void {
  // @ts-expect-error a message that does not exist
  i18n.t('no.such.key')
  // @ts-expect-error a message with placeholders needs its parameters
  i18n.t('bar.position')
  // @ts-expect-error a parameter that the message does not have
  i18n.t('bar.position', { bar: 1, bars: 2, extra: 3 })
  // @ts-expect-error a message without placeholders takes no parameters
  i18n.t('tab.library', { bar: 1 })
  i18n.t('bar.position', { bar: 2, bars: 12 })
  i18n.t('unit.pages', { count: 2 })
  i18n.t('tab.library')
}

test('catalogues: every kind of warning has a message (a compile-time check, and a look at the keys)', () => {
  const covered: `warning.${ScoreWarningKind}` extends MessageKey ? true : never = true
  assert.equal(covered, true)
  for (const kind of ['bar-length', 'out-of-range', 'time-signature-inferred', 'time-signature-missing'] as const) {
    assert.ok(`warning.${kind}` in en)
  }
})

test('t: the translator can be used without `this` (destructured, as a component would)', () => {
  const { t } = createI18n()
  assert.equal(t('common.cancel'), 'Cancel')
})

// ---- Plurals and placeholders ---------------------------------------------------------------

test('plurals: 1 page and 2 pages, 1 pagina and 2 pagina\'s', () => {
  const english = createI18n()
  assert.equal(english.t('unit.pages', { count: 1 }), '1 page')
  assert.equal(english.t('unit.pages', { count: 2 }), '2 pages')
  assert.equal(english.t('unit.pages', { count: 0 }), '0 pages')
  assert.equal(english.t('unit.bars', { count: 1 }), '1 bar')
  assert.equal(english.t('unit.bars', { count: 24 }), '24 bars')
  assert.equal(english.t('favorites.count', { count: 2 }), '2 favorites')
  assert.equal(english.t('favorites.count', { count: 1 }), '1 favorite')
})

test('placeholders: filled in, numbers without a thousands separator, a missing one left as written', () => {
  const english = createI18n()
  assert.equal(english.t('bar.position', { bar: 2, bars: 12 }), 'Bar 2 of 12')
  assert.equal(english.t('bar.range', { from: 9, to: 12 }), 'Bars 9–12')
  assert.equal(english.t('editor.preview', { bar: '3' }), 'Preview bar 3')
  assert.equal(english.t('unit.bars', { count: 1200 }), '1200 bars')
  assert.equal(english.t('library.noMatch', { query: '{count}' }), 'Nothing matches “{count}”.', 'a value is never filled in again')
  assert.equal(fill('{a} and {b}', { a: 'x' }, new Intl.NumberFormat('en')), 'x and {b}')
  assert.equal(fill('{constructor}', {}, new Intl.NumberFormat('en')), '{constructor}', 'only the parameters that were given')
  assert.equal(pickForm({ one: 'a', other: 'b' }, { count: 'many' }, new Intl.PluralRules('en')), 'b')
})

// ---- Relative dates --------------------------------------------------------------------------

test('dates: "Practised yesterday" and "Gisteren geoefend"', () => {
  const english = createI18n()
  const yesterday = iso(2026, 10, 17, 9, 30)
  assert.equal(english.practised(yesterday, NOW), 'Practised yesterday')
  assert.equal(english.added(yesterday, NOW), 'Added yesterday')
  assert.equal(english.relativeTime(yesterday, NOW), 'yesterday')
})

test('dates: today, days, weeks, months and years, in both languages', () => {
  const english = createI18n()
  const cases: Array<[Date, string, string]> = [
    [new Date(2026, 10, 18, 0, 1), 'Practised today', 'Vandaag geoefend'],
    [new Date(2026, 10, 18, 14, 5), 'Practised today', 'Vandaag geoefend'],
    [new Date(2026, 10, 16, 20, 0), 'Practised 2 days ago', 'Eergisteren geoefend'],
    [new Date(2026, 10, 15, 8, 0), 'Practised 3 days ago', '3 dagen geleden geoefend'],
    [new Date(2026, 10, 12, 8, 0), 'Practised 6 days ago', '6 dagen geleden geoefend'],
    [new Date(2026, 10, 11, 8, 0), 'Practised last week', 'Vorige week geoefend'],
    [new Date(2026, 10, 4, 8, 0), 'Practised 2 weeks ago', '2 weken geleden geoefend'],
    [new Date(2026, 9, 10, 8, 0), 'Practised last month', 'Vorige maand geoefend'],
    [new Date(2026, 7, 18, 8, 0), 'Practised 3 months ago', '3 maanden geleden geoefend'],
    [new Date(2025, 10, 10, 8, 0), 'Practised last year', 'Vorig jaar geoefend'],
    [new Date(2024, 5, 1, 8, 0), 'Practised 2 years ago', '2 jaar geleden geoefend'],
  ]
  for (const [when, expectedEn, expectedNl] of cases) {
    assert.equal(english.practised(when, NOW), expectedEn, when.toString())
  }
})

test('dates: yesterday is a calendar day, not 24 hours, and a clock set back is today', () => {
  const english = createI18n()
  // 23:50 on the 17th is yesterday at 00:10 on the 18th, though only 20 minutes passed.
  assert.equal(english.relativeTime(new Date(2026, 10, 17, 23, 50), new Date(2026, 10, 18, 0, 10)), 'yesterday')
  // 00:10 on the 17th is still yesterday at 23:50 on the 18th, with almost two days passed.
  assert.equal(english.relativeTime(new Date(2026, 10, 17, 0, 10), new Date(2026, 10, 18, 23, 50)), 'yesterday')
  assert.equal(english.relativeTime(new Date(2026, 10, 19, 10, 0), NOW), 'today', 'a time in the future')
  assert.equal(calendarDaysBetween(new Date(2026, 2, 28, 12), new Date(2026, 2, 30, 12)), 2, 'over a change to summer time')
  assert.deepEqual(relativeParts(new Date(2026, 10, 18, 9), NOW), { value: 0, unit: 'day' })
  assert.equal(english.relativeTime('not a date', NOW), '')
})

test('dates: the stored ISO time is read as the instant it names', () => {
  const english = createI18n()
  const stored = new Date(2026, 10, 17, 9, 30).toISOString() // what piece.json holds: UTC
  assert.match(stored, /Z$/)
  assert.equal(english.practised(stored, NOW), 'Practised yesterday')
  assert.equal(capitalise('éclair', 'en-GB'), 'Éclair')
})

test('summary line: "2 pages · 24 bars · Practised yesterday"', () => {
  const english = createI18n()
  const piece = { pages: 2, bars: 24, lastPracticed: iso(2026, 10, 17, 9, 30), created: iso(2026, 10, 1, 8, 0) }
  assert.equal(english.pieceSummary(piece, NOW), '2 pages · 24 bars · Practised yesterday')
  // One page is not mentioned; a piece never practised shows when it was added.
  const added = { pages: 1, bars: 8, lastPracticed: null, created: iso(2026, 10, 18, 9, 0) }
  assert.equal(english.pieceSummary(added, NOW), '8 bars · Added today')
  assert.equal(english.pieceSummary({ ...added, bars: 1 }, NOW), '1 bar · Added today')
  assert.equal(english.pieceSummary({ ...added, lastPracticed: 'broken', created: 'broken' }, NOW), '8 bars', 'no time that can be read: no time shown')
})

test('default name: the date and time the piece was added', () => {
  const i18n = createI18n()
  const added = new Date(2026, 10, 18, 14, 5)
  // The exact separators belong to the ICU version, so only what must be there is checked.
  const name = i18n.defaultPieceName(added)
  assert.match(name, /18/)
  assert.match(name, /Nov/)
  assert.match(name, /14:05/)
})

// ---- Instruments and families ----------------------------------------------------------------

test('instrument names come from core/instruments', () => {
  const i18n = createI18n()
  for (const instrument of INSTRUMENTS) assert.equal(i18n.instrumentName(instrument.id), instrument.name)
  assert.equal(i18n.instrumentName('tenor-sax'), 'Tenor saxophone')
  assert.equal(i18n.instrumentName('theremin'), 'theremin', 'an id that does not exist is shown as it is')
})

test('instrument families have a label', () => {
  const i18n = createI18n()
  const families = [...new Set(INSTRUMENTS.map((i) => i.family))] satisfies InstrumentFamily[]
  assert.deepEqual(families.map((f) => i18n.familyName(f)), ['Woodwind', 'Keyboard', 'Strings', 'Brass'])
})

// ---- Score warnings --------------------------------------------------------------------------

/** The warnings of a score as the editor computes them, for the tenor saxophone unless said otherwise. */
const warningsOf = (xml: string, instrument = TENOR_SAX): ScoreWarning[] => warningsFor(parseMusicXml(xml), instrument)
const a3 = note({ step: 'A', octave: 3, type: 'quarter' })

test('warnings: a note outside the range reads the same as core says it', () => {
  const [warning] = warningsOf(score([a3 + note({ step: 'B', octave: 3, type: 'quarter' }) + note({ step: 'C', octave: 4, type: 'quarter' })], [3, 4]))
  assert.equal(warning!.kind, 'out-of-range')
  const i18n = createI18n()
  assert.equal(i18n.warning(warning!), 'Bar 1: A3 is outside the written range of the instrument (Tenor saxophone, B♭3–F♯6); it may be a misread.')
  assert.ok(i18n.warning(warning!).startsWith(warning!.message), 'the English text is the one core builds, with a full stop')
})

test('warnings: the instrument in the warning decides the name and the range', () => {
  const xml = score([a3 + note({ step: 'B', octave: 3, type: 'quarter' }) + note({ step: 'C', octave: 4, type: 'quarter' })], [3, 4])
  const i18n = createI18n()
  assert.match(i18n.warning(warningsOf(xml, ALTO_SAX)[0]!), /\(Alto saxophone, B♭3–F♯6\)/)
  assert.deepEqual(warningsOf(xml, PIANO), [])
})

test('warnings: with do re mi, a range warning names the note and the ends of the range in do re mi (change redesign-score-editor, D9)', () => {
  // C6 is above the guitar's written range (E3–B5).
  const [warning] = warningsOf(score([note({ step: 'C', octave: 6, type: 'whole' })], [4, 4]), GUITAR)
  assert.equal(warning!.kind, 'out-of-range')
  const style = signal<NoteNameStyle>('solfege')
  const i18n = createI18n({ noteNames: style })
  assert.equal(i18n.warning(warning!), 'Bar 1: Do6 is outside the written range of the instrument (Guitar, Mi3–Si5); it may be a misread.')
  assert.match(warning!.message, /C6 is outside the written range of the instrument \(Guitar, E3–B5\)/, 'the English message keeps letters')
  // The style is read each time: a change of the setting shows at once.
  style.value = 'letters'
  assert.equal(i18n.warning(warning!), 'Bar 1: C6 is outside the written range of the instrument (Guitar, E3–B5); it may be a misread.')
  assert.equal(createI18n().warning(warning!), i18n.warning(warning!), 'letters without the setting')
  // A flat, and the saxophone's range with its accidentals.
  const [low] = warningsOf(score([note({ step: 'A', alter: -1, octave: 3, type: 'whole' })], [4, 4]))
  assert.equal(createI18n({ noteNames: signal<NoteNameStyle>('solfege') }).warning(low!), 'Bar 1: La♭3 is outside the written range of the instrument (Tenor saxophone, Si♭3–Fa♯6); it may be a misread.')
  assert.equal(createI18n({ noteNames: signal<NoteNameStyle>('solfege') }).noteName({ step: 'E', octave: 4 }), 'Mi4')
})

test('warnings: a bar that does not add up, and the two time-signature warnings', () => {
  const english = createI18n()
  const barLength = warningsOf(score([quarters(3), eighths(6) + note({ step: 'G', type: 'quarter' }), quarters(3)], [3, 4]))
  assert.deepEqual(barLength.map((w) => [w.kind, w.bar]), [['bar-length', '2']])
  assert.deepEqual([barLength[0]!.counted, barLength[0]!.time], ['4', { beats: 3, beatType: 4 }])
  assert.equal(english.warning(barLength[0]!), 'Bar 2 adds up to 4 beats but 3/4 needs 3.')
  assert.ok(english.warning(barLength[0]!).startsWith(barLength[0]!.message), 'the English text is the one core builds, with a full stop')
  // a part of a beat is shown as a person reads it
  const short = warningsOf(score([quarters(3), eighths(5)], [3, 4]))
  assert.equal(english.warning(short[0]!), 'Bar 2 adds up to 2½ beats but 3/4 needs 3.')
  const sixEight = warningsOf(score([eighths(6), eighths(5)], [6, 8]))
  assert.equal(english.warning(sixEight[0]!), 'Bar 2 adds up to 5 beats but 6/8 needs 6.')

  const inferred = warningsFor(parseMusicXml(prepareRecognisedScore(score([quarters(3), quarters(3)])).musicxml), TENOR_SAX)
  assert.deepEqual(inferred.map((w) => w.kind), ['time-signature-inferred'])
  assert.deepEqual(inferred[0]!.time, { beats: 3, beatType: 4 })
  assert.equal(english.warning(inferred[0]!), 'No time signature was found, so 3/4 was worked out from the bar lengths. Check that it is right.')

  const missing = warningsFor(parseMusicXml(prepareRecognisedScore(score([quarters(2), quarters(3), quarters(4)])).musicxml), TENOR_SAX)
  assert.deepEqual(missing.map((w) => w.kind), ['time-signature-missing'])
})

test('warnings: a warning this cannot build from its fields shows the English message it came with', () => {
  const i18n = createI18n()
  const base = { message: 'English text from core' }
  assert.equal(i18n.warning({ ...base, kind: 'out-of-range', bar: '1', pitch: 'A3', instrument: 'theremin' as ScoreWarning['instrument'] }), base.message)
  assert.equal(i18n.warning({ ...base, kind: 'out-of-range', bar: '1', pitch: 'A3' }), base.message, 'no instrument')
  assert.equal(i18n.warning({ ...base, kind: 'bar-length' }), base.message, 'no bar')
  assert.equal(i18n.warning({ ...base, kind: 'bar-length', bar: '2' }), base.message, 'no counted length or time signature')
  assert.equal(i18n.warning({ ...base, kind: 'time-signature-inferred' }), base.message, 'no inferred time signature')
  assert.equal(i18n.warning({ ...base, kind: 'from-the-future' as ScoreWarningKind, bar: '1' }), base.message, 'a kind that is not known')
})

// ---- Suggested repairs and Grid refusals (change redesign-score-editor, D4, D6) -------------------------------------

test('suggestions: each label names the note in the settings\' note names (mock: "E4 (1) → dotted quarter")', () => {
  // Bar 2: E4 quarter, G4 eighth, C5 half, 3½ beats.
  const s = parseMusicXml(score([quarters(4), note({ step: 'E', octave: 4, type: 'quarter' }) + note({ step: 'G', octave: 4, type: 'eighth' }) + note({ step: 'C', octave: 5, type: 'half' })], [4, 4]))
  const found = suggestRepairs(s, firstVoice(s), 1)
  const style = signal<NoteNameStyle>('letters')
  const i18n = createI18n({ noteNames: style })
  assert.deepEqual(found.map(i18n.suggestion), ['Add an eighth rest at the end', 'E4 (1) → dotted quarter', 'G4 (2) → quarter'])
  style.value = 'solfege'
  assert.deepEqual(found.map(i18n.suggestion), ['Add an eighth rest at the end', 'Mi4 (1) → dotted quarter', 'Sol4 (2) → quarter'])
  const short = parseMusicXml(score([quarters(4), quarters(3)], [4, 4]))
  assert.equal(createI18n().suggestion(suggestRepairs(short, firstVoice(short), 1)[0]!), 'Add a quarter rest at the end')
  const run = (): void => undefined
  const english = createI18n()
  assert.equal(english.suggestion({ kind: 'barLine', noteId: 'a', pitch: { step: 'B', alter: -1, octave: 4 }, place: 3, run }), 'Bar line after B♭4 (3)')
  assert.equal(english.suggestion({ kind: 'barLine', noteId: 'r', place: 3, run }), 'Bar line after the rest (3)')
  assert.equal(english.suggestion({ kind: 'length', noteId: 'r', place: 2, length: { type: 'half', dots: 0 }, run }), 'Rest (2) → half')
  assert.equal(english.suggestion({ kind: 'removeRest', noteId: 'r', place: 4, run }), 'Remove the rest (4)')
  assert.equal(english.suggestion({ kind: 'join', run }), 'Join with the next bar')
  assert.deepEqual(
    [{ type: '16th', dots: 0 }, { type: 'half', dots: 1 }, { type: 'quarter', dots: 2 }, { type: 'whole', dots: 0 }].map((v) => english.noteValue(v as NoteValue)),
    ['sixteenth', 'dotted half', 'double-dotted quarter', 'whole'],
  )
})

test('grid refusals: every reason has a text, and a locked block says where it is edited', () => {
  const reasons: GridRefusal[] = ['overlap', 'end', 'locked', 'length', 'room', 'chord', 'rest', 'gap']
  const i18n = createI18n()
  for (const reason of reasons) assert.ok(i18n.t(`grid.error.${reason}`).endsWith('.'), reason)
  assert.equal(i18n.t('grid.error.locked'), 'Edit triplets and grace notes in Notes.')
})
