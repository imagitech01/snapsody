// Generates the committed practice-exercise scores for the UI tests (openspec test-pyramid
// design T6): a self-made exercise like the method-book one the app was built for, without being it.
//
//   node test/fixtures/make-practice-exercise.ts      (from web/) rewrites both files
//
// - practice-exercise.musicxml: tenor sax, 3/4, G major, 19 bars, a tempo word, triplets, slurs,
//   staccato, and a repeat with first and second endings; beamed as an engraved page is.
// - practice-exercise.recognised.musicxml: the same music in homr's output style: no beams, the
//   triplet marking lost in bar 10 (the repairs restore it), and bar 18's F♯4 misread as A3
//   (below the tenor saxophone's range, so it is flagged).
// test/practiceExercise.test.ts checks that the committed files are this generator's output.

import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * One note: "<pitch>:<value>[marks]". Pitch is like G4, F#5 or r (rest). Value: h. (dotted half),
 * h, q., q, e, t (a triplet eighth). Marks: ( slur start, ) slur stop, ! staccato.
 */
type Token = string

/** The music, bar by bar (3/4). */
const BARS: Token[][] = [
  ['G4:q', 'B4:q', 'D5:q'],
  ['E5:e(', 'D5:e', 'C5:e', 'B4:e)', 'A4:q'],
  ['G4:q!', 'G4:q!', 'A4:q'],
  ['B4:h.'],
  ['D5:t(', 'E5:t', 'D5:t)', 'C5:q', 'B4:q'], // bar 5: the repeat starts
  ['A4:e(', 'B4:e', 'C5:e', 'D5:e)', 'E5:q'],
  ['D5:q.', 'C5:e', 'B4:q'],
  ['A4:h.'],
  ['B4:q!', 'C5:q!', 'D5:q!'],
  ['E5:t', 'F#5:t', 'G5:t', 'F#5:t', 'E5:t', 'D5:t', 'C5:q'], // bar 10: the triplets homr loses
  ['B4:q', 'A4:q', 'G4:q'],
  ['D5:h.'], // bar 12: first ending, back to bar 5
  ['G4:h.'], // bar 13: second ending
  ['B4:e(', 'C5:e', 'D5:e', 'E5:e)', 'F#5:q'],
  ['G5:q.', 'F#5:e', 'E5:q'],
  ['D5:q!', 'B4:q!', 'G4:q'],
  ['A4:t(', 'B4:t', 'C5:t)', 'D5:h'],
  ['E5:q', 'D5:q', 'F#4:q'], // bar 18: F♯4, misread as A3 in the recognised variant
  ['G4:h.'],
]

const DIVISIONS = 6 // quarter = 6, so a triplet eighth is 2
const VALUES: Record<string, { type: string; dots: number; ticks: number; triplet?: boolean }> = {
  'h.': { type: 'half', dots: 1, ticks: 18 },
  h: { type: 'half', dots: 0, ticks: 12 },
  'q.': { type: 'quarter', dots: 1, ticks: 9 },
  q: { type: 'quarter', dots: 0, ticks: 6 },
  e: { type: 'eighth', dots: 0, ticks: 3 },
  t: { type: 'eighth', dots: 0, ticks: 2, triplet: true },
}

interface Parsed {
  step: string
  alter: number
  octave: number
  rest: boolean
  value: (typeof VALUES)[string]
  slurStart: boolean
  slurStop: boolean
  staccato: boolean
}

function parse(token: Token): Parsed {
  const match = /^(r|([A-G])(#|b)?(\d)):(h\.|h|q\.|q|e|t)([()!]*)$/.exec(token)
  if (!match) throw new Error(`bad token ${token}`)
  const marks = match[6]!
  return {
    step: match[2] ?? '',
    alter: match[3] === '#' ? 1 : match[3] === 'b' ? -1 : 0,
    octave: Number(match[4] ?? 0),
    rest: match[1] === 'r',
    value: VALUES[match[5]!]!,
    slurStart: marks.includes('('),
    slurStop: marks.includes(')'),
    staccato: marks.includes('!'),
  }
}

interface Style {
  /** Engraved: beams by beat. Recognised (homr): none. */
  beams: boolean
  /** Bars whose triplet marking is lost (written as plain eighths). */
  lostTriplets: number[]
  /** Pitch replacements: [bar, note index, new pitch token]. */
  misreads: [number, number, string][]
}

function noteXml(p: Parsed, bar: number, beam: string | undefined, style: Style, tuplet: 'start' | 'stop' | undefined): string {
  const lost = p.value.triplet && style.lostTriplets.includes(bar)
  const ticks = p.value.triplet && !lost ? p.value.ticks : p.value.triplet ? 3 : p.value.ticks
  const parts = [
    p.rest ? '<rest/>' : `<pitch><step>${p.step}</step>${p.alter ? `<alter>${p.alter}</alter>` : ''}<octave>${p.octave}</octave></pitch>`,
    `<duration>${ticks}</duration>`,
    '<voice>1</voice>',
    `<type>${p.value.type}</type>`,
    ...(p.value.dots ? ['<dot/>'] : []),
    ...(p.alter === 1 && !inKey(p) ? ['<accidental>sharp</accidental>'] : []),
    ...(p.value.triplet && !lost ? ['<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>'] : []),
    ...(beam && style.beams ? [`<beam number="1">${beam}</beam>`] : []),
  ]
  const notations = [
    ...(p.slurStart ? ['<slur type="start" number="1"/>'] : []),
    ...(p.slurStop ? ['<slur type="stop" number="1"/>'] : []),
    ...(tuplet && !lost ? [`<tuplet type="${tuplet}" number="1"/>`] : []),
    ...(p.staccato ? ['<articulations><staccato/></articulations>'] : []),
  ]
  if (notations.length) parts.push(`<notations>${notations.join('')}</notations>`)
  return `      <note>${parts.join('')}</note>`
}

/** F♯ is in G major; nothing else here is sharpened. */
const inKey = (p: Parsed) => p.step === 'F' && p.alter === 1

function generate(style: Style): string {
  const measures = BARS.map((tokens, index) => {
    const bar = index + 1
    const notes = tokens.map((token, i) => {
      const misread = style.misreads.find(([b, n]) => b === bar && n === i)
      return parse(misread ? token.replace(/^[^:]+/, misread[2]) : token)
    })
    // Beams and tuplet brackets by beat (a quarter's worth of eighths or triplet eighths).
    const xml: string[] = []
    let beat: number[] = []
    let ticks = 0
    const flush = () => {
      beat.forEach((n, k) => {
        const p = notes[n]!
        const beam = beat.length < 2 ? undefined : k === 0 ? 'begin' : k === beat.length - 1 ? 'end' : 'continue'
        const tuplet = p.value.triplet ? (k === 0 ? 'start' : k === beat.length - 1 ? 'stop' : undefined) : undefined
        xml.push(noteXml(p, bar, beam, style, tuplet))
      })
      beat = []
    }
    notes.forEach((p, n) => {
      const short = p.value.type === 'eighth'
      if (!short) {
        flush()
        xml.push(noteXml(p, bar, undefined, style, undefined))
      } else {
        beat.push(n)
        if ((ticks + p.value.ticks) % DIVISIONS === 0) flush()
      }
      ticks += p.value.ticks
    })
    flush()
    if (ticks !== 18) throw new Error(`bar ${bar} has ${ticks} ticks, not 18`)

    const head: string[] = []
    if (bar === 5) head.push('      <barline location="left"><bar-style>heavy-light</bar-style><repeat direction="forward"/></barline>')
    if (bar === 12) head.push('      <barline location="left"><ending number="1" type="start"/></barline>')
    if (bar === 13) head.push('      <barline location="left"><ending number="2" type="start"/></barline>')
    if (bar === 1) {
      head.push(
        `      <attributes><divisions>${DIVISIONS}</divisions><key><fifths>1</fifths><mode>major</mode></key><time><beats>3</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>`,
        '      <direction placement="above"><direction-type><words>Moderato</words></direction-type><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>96</per-minute></metronome></direction-type><sound tempo="96"/></direction>',
      )
    }
    const tail: string[] = []
    if (bar === 12) tail.push('      <barline location="right"><bar-style>light-heavy</bar-style><ending number="1" type="stop"/><repeat direction="backward"/></barline>')
    if (bar === 13) tail.push('      <barline location="right"><ending number="2" type="discontinue"/></barline>')
    if (bar === 19) tail.push('      <barline location="right"><bar-style>light-heavy</bar-style></barline>')
    return [`    <measure number="${bar}">`, ...head, ...xml, ...tail, '    </measure>'].join('\n')
  })
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!-- Generated by test/fixtures/make-practice-exercise.ts; self-made test material. -->',
    '<score-partwise version="4.0">',
    '  <work><work-title>Practice exercise</work-title></work>',
    '  <part-list><score-part id="P1"><part-name>Tenor Saxophone</part-name></score-part></part-list>',
    '  <part id="P1">',
    ...measures,
    '  </part>',
    '</score-partwise>',
    '',
  ].join('\n')
}

/** The engraved exercise. */
export function practiceExercise(): string {
  return generate({ beams: true, lostTriplets: [], misreads: [] })
}

/** The same music as homr reads it. */
export function recognisedVariant(): string {
  return generate({ beams: false, lostTriplets: [10], misreads: [[18, 2, 'A3']] })
}

export const PRACTICE_EXERCISE = fileURLToPath(new URL('./practice-exercise.musicxml', import.meta.url))
export const PRACTICE_EXERCISE_RECOGNISED = fileURLToPath(new URL('./practice-exercise.recognised.musicxml', import.meta.url))

if ((import.meta as { main?: boolean }).main) {
  writeFileSync(PRACTICE_EXERCISE, practiceExercise())
  writeFileSync(PRACTICE_EXERCISE_RECOGNISED, recognisedVariant())
}
