import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { firstVoice, partIndex, voiceView } from '../src/core/score/model.ts'
import type { Measure, Score, VoiceScore } from '../src/core/score/model.ts'
import type { Instrument } from '../src/core/instruments/instruments.ts'
import type { ScoreWarning } from '../src/core/score/warnings.ts'
import { computeScoreWarnings } from '../src/core/score/warnings.ts'

const here = (rel: string): string => fileURLToPath(new URL(rel, import.meta.url))

export const COMMITTED_FIXTURE = here('./fixtures/all-elements.musicxml')
/** A single-part piece with the marks homr 0.7.1 reads, written the way homr writes them (change more-marks). */
export const HOMR_MARKS_FIXTURE = here('./fixtures/homr-marks.musicxml')
/** Local-only, copyrighted material; tests that need it skip when it is absent. */
export const LOCAL_PAGE = here('../../fixtures/local/page.musicxml')
/** A melody-and-piano page in homr 0.7.1's form, with original music (parts-and-accompaniment). */
export const MELODY_PIANO_FIXTURE = here('./fixtures/melody-piano.musicxml')
/** Local-only: a real homr 0.7.1 reading of a melody-and-piano book page (copyrighted, never committed). */
export const LOCAL_HOMR_PIANO_PAGE = here('../../prototype/out/v071/aba-mars/page.musicxml')
export const LOCAL_EXERCISE_87 = here('../../fixtures/local/exercise87_crop_padded.mac.musicxml')

export function read(path: string): string {
  return readFileSync(path, 'utf8')
}

export function skipUnless(path: string): string | false {
  return existsSync(path) ? false : `local fixture not present: ${path.split('/fixtures/')[1] ?? path}`
}

// --- tiny MusicXML builders for repair tests (divisions 12: quarter = 12) ---

const TYPE_TICKS: Record<string, number> = { whole: 48, half: 24, quarter: 12, eighth: 6, '16th': 3 }

export interface NoteSpec {
  step?: string
  octave?: number
  alter?: number
  type: string
  dots?: number
  triplet?: boolean
  rest?: boolean
}

export function note(spec: NoteSpec): string {
  let ticks = TYPE_TICKS[spec.type] ?? 12
  if (spec.dots) ticks = (ticks * 3) / 2
  if (spec.triplet) ticks = (ticks * 2) / 3
  const pitch = spec.rest
    ? '<rest/>'
    : `<pitch><step>${spec.step ?? 'C'}</step>${spec.alter ? `<alter>${spec.alter}</alter>` : ''}<octave>${spec.octave ?? 5}</octave></pitch>`
  return (
    `<note>${pitch}<duration>${ticks}</duration><voice>1</voice><type>${spec.type}</type>` +
    `${spec.dots ? '<dot/>'.repeat(spec.dots) : ''}` +
    `${spec.triplet ? '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>' : ''}` +
    `<staff>1</staff></note>`
  )
}

export const eighths = (count: number, step = 'E'): string =>
  Array.from({ length: count }, () => note({ step, type: 'eighth' })).join('')

export const quarters = (count: number, step = 'G'): string =>
  Array.from({ length: count }, () => note({ step, type: 'quarter' })).join('')

/** A score from measure bodies; `time` is e.g. [3, 4], or undefined for none. */
export function score(bodies: string[], time?: [number, number]): string {
  const attrs = (i: number): string =>
    i === 0
      ? `<attributes><divisions>12</divisions><key><fifths>0</fifths></key>${
          time ? `<time><beats>${time[0]}</beats><beat-type>${time[1]}</beat-type></time>` : ''
        }<clef><sign>G</sign><line>2</line></clef></attributes>`
      : ''
  return (
    `<?xml version="1.0"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name/></score-part></part-list>` +
    `<part id="P1">${bodies.map((b, i) => `<measure number="${i + 1}">${attrs(i)}${b}</measure>`).join('')}</part></score-partwise>`
  )
}

/** The first voice of the first part of a score as a voice view: the one line the app works on for now (change parts-and-accompaniment). */
export const firstLine = (score: Score): VoiceScore => voiceView(score, firstVoice(score))

/** The warnings of a score for its first part, played on `instrument`. */
export const warningsFor = (score: Score, instrument: Instrument): ScoreWarning[] => computeScoreWarnings(score, score.parts[0]?.id ?? '', instrument)

/**
 * Sets (or, with `undefined`, removes) a bar attribute of the first voice's bar `index` where the model keeps it: the clef on the
 * staff, the key on the part, the rest on the bar. A voice view's attributes are copies, so they cannot be set through it.
 */
export function setAttr<K extends 'clef' | 'key' | 'time' | 'leftBarline' | 'rightBarline' | 'multiRest' | 'newSystem'>(
  score: Score,
  index: number,
  name: K,
  value: Measure[K] | undefined,
): void {
  const bar = score.bars[index]
  if (!bar) throw new Error(`no bar ${index}`)
  const ref = firstVoice(score)
  const part = bar.parts[partIndex(score, ref.part)]!
  const target = (name === 'clef' ? part.staves[ref.staff]! : name === 'key' || name === 'multiRest' ? part : bar) as unknown as Record<string, unknown>
  if (value === undefined) delete target[name]
  else target[name] = value
}

/**
 * What is wrong with a piece's bar numbers (change redesign-score-editor, D8): the pages must cover bars 1 to `bars`
 * in order without a gap or an overlap; the lines of the photo (staves) of a page must be in order, not overlap and
 * lie inside the page; the practice bar and loop must lie inside the piece. Empty when all is well.
 */
export function barNumberProblems(
  info: { bars: number; pages: readonly { n: number; firstBar: number; lastBar: number; staves: readonly { firstBar: number; lastBar: number }[] }[] },
  practice?: { bar: number; loop: { start: number; end: number } | null } | null,
): string[] {
  const problems: string[] = []
  let next = 1
  for (const page of info.pages) {
    if (page.firstBar !== next || page.lastBar < page.firstBar) problems.push(`page ${page.n} is bars ${page.firstBar}-${page.lastBar}, after bar ${next - 1}`)
    let line = page.firstBar
    for (const staff of page.staves) {
      if (staff.firstBar < line || staff.lastBar < staff.firstBar || staff.lastBar > page.lastBar) problems.push(`page ${page.n} has a line ${staff.firstBar}-${staff.lastBar} out of order or outside it`)
      line = staff.lastBar + 1
    }
    next = page.lastBar + 1
  }
  if (next !== info.bars + 1) problems.push(`the pages end at bar ${next - 1}, the piece at bar ${info.bars}`)
  if (practice) {
    if (practice.bar < 1 || practice.bar > info.bars) problems.push(`the practice bar ${practice.bar} is outside the piece`)
    const loop = practice.loop
    if (loop && (loop.start < 1 || loop.end < loop.start || loop.end > info.bars)) problems.push(`the loop ${loop.start}-${loop.end} is outside the piece`)
  }
  return problems
}
