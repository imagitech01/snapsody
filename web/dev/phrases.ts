// The phrases of the listening page (dev/listen.html): short pieces of music, as MusicXML in the written
// pitch of an instrument, that exercise what the by-ear check of docs/samples.md asks for. They go through
// the real parser, timeline, scheduler and sampler like any piece, so what is heard is what a piece sounds like.

import type { Instrument } from '../src/core/instruments/instruments.ts'

export type PhraseId = 'legato' | 'staccato' | 'held-low' | 'held-mid' | 'held-high' | 'accent' | 'crescendo'

export interface Phrase {
  id: PhraseId
  /** The button's label. */
  label: string
  /** What to listen for. */
  hint: string
  xml: string
  /** A tempo the phrase needs (quarter notes per minute); without one the page's tempo field applies. */
  bpm?: number
  /** The written MIDI notes, in order, of what is played (for tests and the page's text). */
  written: number[]
}

/** Divisions per quarter note in the generated MusicXML. */
const DIV = 12
const TICKS = { whole: 4 * DIV, half: 2 * DIV, quarter: DIV, eighth: DIV / 2 } as const
type Length = keyof typeof TICKS

const SHARPS: readonly (readonly [string, number])[] = [
  ['C', 0], ['C', 1], ['D', 0], ['D', 1], ['E', 0], ['F', 0], ['F', 1], ['G', 0], ['G', 1], ['A', 0], ['A', 1], ['B', 0],
]

/** The major scale from the root: its eight notes, as offsets in semitones. */
const SCALE = [0, 2, 4, 5, 7, 9, 11, 12]

interface Note {
  midi: number
  length: Length
  slur?: 'start' | 'stop'
  tie?: 'start' | 'stop'
  staccato?: boolean
  accent?: boolean
}

const noteXml = (n: Note): string => {
  const [step, alter] = SHARPS[n.midi % 12]!
  const pitch = `<pitch><step>${step}</step>${alter ? `<alter>${alter}</alter>` : ''}<octave>${Math.floor(n.midi / 12) - 1}</octave></pitch>`
  const tie = n.tie ? `<tie type="${n.tie}"/>` : ''
  const tied = n.tie ? `<tied type="${n.tie}"/>` : ''
  const slur = n.slur ? `<slur type="${n.slur}" number="1"/>` : ''
  const articulations = n.staccato || n.accent ? `<articulations>${n.staccato ? '<staccato/>' : ''}${n.accent ? '<accent/>' : ''}</articulations>` : ''
  const notations = `${tied}${slur}${articulations}`
  return (
    `<note>${pitch}<duration>${TICKS[n.length]}</duration>${tie}<voice>1</voice><type>${n.length}</type>` +
    `${notations ? `<notations>${notations}</notations>` : ''}<staff>1</staff></note>`
  )
}

const dynamicXml = (mark: string): string => `<direction placement="below"><direction-type><dynamics><${mark}/></dynamics></direction-type></direction>`
const wedgeXml = (type: 'crescendo' | 'stop'): string => `<direction placement="below"><direction-type><wedge type="${type}" number="1"/></direction-type></direction>`

/** A score in 4/4 from the bars' contents (notes and directions as MusicXML). */
function scoreXml(bars: string[]): string {
  return (
    `<?xml version="1.0"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name/></score-part></part-list><part id="P1">` +
    bars
      .map(
        (body, i) =>
          `<measure number="${i + 1}">${i === 0 ? `<attributes><divisions>${DIV}</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>` : ''}${body}</measure>`,
      )
      .join('') +
    `</part></score-partwise>`
  )
}

/** The written C an octave of the scale fits above, nearest the middle of the instrument's written range. */
export function scaleRoot(instrument: Pick<Instrument, 'writtenRange'>): number {
  const { low, high } = instrument.writtenRange
  const middle = (low + high) / 2
  let best: number | undefined
  for (let c = Math.ceil(low / 12) * 12; c + 12 <= high; c += 12) {
    if (best === undefined || Math.abs(c + 6 - middle) < Math.abs(best + 6 - middle)) best = c
  }
  if (best === undefined) throw new Error('the written range has no octave from a C')
  return best
}

/** Up the major scale in eighth notes and down again to the root, two bars: 8 + 6 eighths and a quarter. */
function scaleNotes(root: number, style: { slurred?: boolean; staccato?: boolean }): Note[] {
  const up = SCALE.map((s) => root + s)
  const down = [11, 9, 7, 5, 4, 2].map((s) => root + s)
  const notes: Note[] = [...up, ...down].map((midi) => ({ midi, length: 'eighth' as const, ...(style.staccato ? { staccato: true } : {}) }))
  notes.push({ midi: root, length: 'quarter', ...(style.staccato ? { staccato: true } : {}) })
  if (style.slurred) {
    notes[0]!.slur = 'start'
    notes[notes.length - 1]!.slur = 'stop'
  }
  return notes
}

const barsOf = (notes: Note[]): Note[][] => {
  const bars: Note[][] = []
  let ticks = 0
  for (const n of notes) {
    if (bars.length === 0 || ticks >= 4 * DIV) {
      bars.push([])
      ticks = 0
    }
    bars[bars.length - 1]!.push(n)
    ticks += TICKS[n.length]
  }
  return bars
}

const phrase = (id: PhraseId, label: string, hint: string, bars: string[], written: number[], bpm?: number): Phrase => ({
  id,
  label,
  hint,
  xml: scoreXml(bars),
  written,
  ...(bpm === undefined ? {} : { bpm }),
})

/** The phrases for an instrument, in its own written register. */
export function phrasesFor(instrument: Pick<Instrument, 'writtenRange'>): Phrase[] {
  const root = scaleRoot(instrument)
  const { low, high } = instrument.writtenRange
  const out: Phrase[] = []

  const slurred = scaleNotes(root, { slurred: true })
  out.push(
    phrase(
      'legato',
      'Legato',
      'A slurred scale: notes connect with no gap and no bump; piano and guitar notes are each struck.',
      barsOf(slurred).map((bar) => bar.map(noteXml).join('')),
      slurred.map((n) => n.midi),
    ),
  )

  const short = scaleNotes(root, { staccato: true })
  out.push(
    phrase(
      'staccato',
      'Staccato',
      'The same scale staccato: clearly short, no tail, click or thump at the release.',
      barsOf(short).map((bar) => bar.map(noteXml).join('')),
      short.map((n) => n.midi),
    ),
  )

  // A held note: two tied whole notes at 60 bpm, 8 s, so that a loop wrap, a pulse or the end of a short sample can be heard.
  const held = (id: PhraseId, label: string, midi: number): Phrase => {
    const a: Note = { midi, length: 'whole', tie: 'start' }
    const b: Note = { midi, length: 'whole', tie: 'stop' }
    return phrase(id, label, 'Held for 8 s at 60 bpm: no tick at each loop wrap, no slow pulse; a decaying instrument dies away.', [noteXml(a), noteXml(b)], [midi], 60)
  }
  out.push(held('held-low', 'Held low', low + 3))
  out.push(held('held-mid', 'Held mid', Math.round((low + high) / 2)))
  out.push(held('held-high', 'Held high', high - 3))

  // Accents: quarter notes with an accent on the first and third beat, at mf (the accent is 4 dB) then at ff (it has less room).
  const accentBar = (steps: number[]): string =>
    steps
      .map((s, i) => noteXml({ midi: root + s, length: 'quarter', ...(i % 2 === 0 ? { accent: true } : {}) }))
      .join('')
  out.push(
    phrase(
      'accent',
      'Accent',
      'Accents on beats 1 and 3, at mf and then at ff: a clear emphasis that falls back within 150 ms; at ff it has less room (the peak never exceeds full scale).',
      [dynamicXml('mf') + accentBar([0, 2, 4, 5]), dynamicXml('ff') + accentBar([7, 9, 11, 12])],
      [0, 2, 4, 5, 7, 9, 11, 12].map((s) => root + s),
    ),
  )

  // A crescendo from pp, over two bars of quarter notes, to ff.
  const quarters = (steps: number[]): string => steps.map((s) => noteXml({ midi: root + s, length: 'quarter' })).join('')
  out.push(
    phrase(
      'crescendo',
      'Crescendo',
      'From pp to ff over eight notes: each note louder than the one before, no step in loudness.',
      [dynamicXml('pp') + wedgeXml('crescendo') + quarters([0, 2, 4, 5]), quarters([7, 9, 11, 12]) + wedgeXml('stop'), dynamicXml('ff') + noteXml({ midi: root + 12, length: 'whole' })],
      [0, 2, 4, 5, 7, 9, 11, 12, 12].map((s) => root + s),
    ),
  )
  return out
}
