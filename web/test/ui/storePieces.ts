// The pieces for the Google Play Store screenshots (tools/store/capture.ts), seeded by the `store`
// part of seeds.ts. "Ode to Joy" (Beethoven, public domain) is typed in note by note; the other
// pieces are only list items, so they are placeholder bars. Nothing here comes from a method book.
// The clock of the harness is 18 Nov 2026 10:00 UTC (`CLOCK_START`).

import type { PracticeState } from '../../src/app/library.ts'

export interface StorePiece {
  id: string
  name: string
  /** The bars of each page, in order. */
  pages: number[]
  created: string
  lastPracticed: string | null
  favorite: boolean
  practice?: Partial<PracticeState>
  /** The piece has the real melody (`odeScore`) instead of placeholder bars. */
  ode?: boolean
}

export const STORE_PIECES: readonly StorePiece[] = [
  { id: '00000000-0000-4000-8000-0000000005a1', name: 'Ode to Joy', pages: [8, 8], created: '2026-11-16T08:00:00.000Z', lastPracticed: '2026-11-18T09:30:00.000Z', favorite: false, practice: { bar: 5, tempo: 72, metronome: true }, ode: true },
  { id: '00000000-0000-4000-8000-0000000005a2', name: 'Greensleeves', pages: [8, 8], created: '2026-11-05T08:00:00.000Z', lastPracticed: '2026-11-17T17:00:00.000Z', favorite: true },
  { id: '00000000-0000-4000-8000-0000000005a3', name: 'Frère Jacques', pages: [8], created: '2026-11-08T08:00:00.000Z', lastPracticed: '2026-11-16T18:00:00.000Z', favorite: false },
  { id: '00000000-0000-4000-8000-0000000005a4', name: 'Amazing Grace', pages: [8, 8], created: '2026-11-14T08:00:00.000Z', lastPracticed: null, favorite: false },
  { id: '00000000-0000-4000-8000-0000000005a5', name: 'Scarborough Fair', pages: [12], created: '2026-11-12T08:00:00.000Z', lastPracticed: null, favorite: true },
]

// Ode to Joy, 16 bars of 4/4 in C major. q = quarter, h = half, Q = dotted quarter, e = eighth.
const ODE: readonly string[] = [
  'E5q E5q F5q G5q', 'G5q F5q E5q D5q', 'C5q C5q D5q E5q', 'E5Q D5e D5h',
  'E5q E5q F5q G5q', 'G5q F5q E5q D5q', 'C5q C5q D5q E5q', 'D5Q C5e C5h',
  'D5q D5q E5q C5q', 'D5q E5e F5e E5q C5q', 'D5q E5e F5e E5q D5q', 'C5q D5q G4h',
  'E5q E5q F5q G5q', 'G5q F5q E5q D5q', 'C5q C5q D5q E5q', 'D5Q C5e C5h',
]

const DURATION: Record<string, [number, string, string]> = { q: [2, 'quarter', ''], h: [4, 'half', ''], Q: [3, 'quarter', '<dot/>'], e: [1, 'eighth', ''] }

/** Bars [from]..[to] (from 1) of Ode to Joy as MusicXML; the first bar written carries clef, key, time and the tempo marking 72. */
export function odeScore(from = 1, to = 16, header?: { title: string; composer: string; systemBreaks?: boolean }): string {
  const measures = ODE.slice(from - 1, to).map((bar, index) => {
    const notes = bar
      .split(' ')
      .map((token) => {
        const [divisions, type, dot] = DURATION[token[2]!]!
        return `<note><pitch><step>${token[0]}</step><octave>${token[1]}</octave></pitch><duration>${divisions}</duration><voice>1</voice><type>${type}</type>${dot}</note>`
      })
      .join('')
    const first = index === 0
      ? '<attributes><divisions>2</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>72</per-minute></metronome></direction-type><sound tempo="72"/></direction>'
      : ''
    const newSystem = header?.systemBreaks && index > 0 && index % 4 === 0 ? '<print new-system="yes"/>' : ''
    return `<measure number="${index + 1}">${newSystem}${first}${notes}</measure>`
  })
  const work = header
    ? `<work><work-title>${header.title}</work-title></work><identification><creator type="composer">${header.composer}</creator></identification><credit page="1"><credit-type>title</credit-type><credit-words default-x="600" default-y="1500" justify="center" valign="top" font-size="24">${header.title}</credit-words></credit><credit page="1"><credit-type>composer</credit-type><credit-words default-x="1100" default-y="1430" justify="right" valign="top" font-size="11">${header.composer}</credit-words></credit>`
    : ''
  return `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0">${work}<part-list><score-part id="P1"><part-name>Tenor Saxophone</part-name></score-part></part-list><part id="P1">${measures.join('')}</part></score-partwise>`
}
