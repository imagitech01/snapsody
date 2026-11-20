import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const here = (rel: string): string => fileURLToPath(new URL(rel, import.meta.url))

export const COMMITTED_FIXTURE = here('./fixtures/all-elements.musicxml')
/** A single-part piece with the marks homr 0.7.1 reads, written the way homr writes them (change more-marks). */
export const HOMR_MARKS_FIXTURE = here('./fixtures/homr-marks.musicxml')
/** Local-only, copyrighted material; tests that need it skip when it is absent. */
export const LOCAL_PAGE = here('../../fixtures/local/page.musicxml')
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
