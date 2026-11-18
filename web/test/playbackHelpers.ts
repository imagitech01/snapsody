import { TENOR_SAX } from '../src/core/instruments/instruments.ts'
import { buildTimeline } from '../src/core/playback/timeline.ts'
import type { Timeline } from '../src/core/playback/timeline.ts'
import { parseMusicXml } from '../src/core/score/musicxml.ts'
import type { Score } from '../src/core/score/model.ts'

const TICKS: Record<string, number> = { whole: 48, half: 24, quarter: 12, eighth: 6, '16th': 3 }

export interface N {
  step?: string
  octave?: number
  alter?: number
  type?: string
  triplet?: boolean
  rest?: boolean
  stac?: boolean
  tenuto?: boolean
  accent?: boolean
  fermata?: boolean
  breath?: boolean
  slur?: 'start' | 'stop'
  tie?: 'start' | 'stop' | 'both'
  id?: string
}

/** A note element (divisions 12, so a quarter is 12 ticks). */
export function n(spec: N = {}): string {
  const type = spec.type ?? 'quarter'
  let ticks = TICKS[type] ?? 12
  if (spec.triplet) ticks = (ticks * 2) / 3
  const pitch = spec.rest
    ? '<rest/>'
    : `<pitch><step>${spec.step ?? 'G'}</step>${spec.alter ? `<alter>${spec.alter}</alter>` : ''}<octave>${spec.octave ?? 4}</octave></pitch>`
  const tie =
    spec.tie === 'start' ? '<tie type="start"/>' : spec.tie === 'stop' ? '<tie type="stop"/>' : spec.tie === 'both' ? '<tie type="stop"/><tie type="start"/>' : ''
  const tied =
    spec.tie === 'start' ? '<tied type="start"/>' : spec.tie === 'stop' ? '<tied type="stop"/>' : spec.tie === 'both' ? '<tied type="stop"/><tied type="start"/>' : ''
  const art = `${spec.stac ? '<staccato/>' : ''}${spec.tenuto ? '<tenuto/>' : ''}${spec.accent ? '<accent/>' : ''}${spec.breath ? '<breath-mark/>' : ''}`
  const notations = `${tied}${spec.slur ? `<slur type="${spec.slur}" number="1"/>` : ''}${art ? `<articulations>${art}</articulations>` : ''}${spec.fermata ? '<fermata/>' : ''}`
  return (
    `<note${spec.id ? ` id="${spec.id}"` : ''}>${pitch}<duration>${ticks}</duration>${tie}<voice>1</voice><type>${type}</type>` +
    `${spec.triplet ? '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>' : ''}` +
    `${notations ? `<notations>${notations}</notations>` : ''}<staff>1</staff></note>`
  )
}

export const dyn = (mark: string): string =>
  `<direction placement="below"><direction-type><dynamics><${mark}/></dynamics></direction-type></direction>`

/** A hairpin direction: `crescendo` or `diminuendo` before its first note, `stop` after its last one. */
export const wedge = (type: 'crescendo' | 'diminuendo' | 'stop'): string =>
  `<direction placement="below"><direction-type><wedge type="${type}" number="1"/></direction-type></direction>`

export interface Bar {
  body: string
  /** Left barline content, e.g. '<repeat direction="forward"/>' or '<ending number="1" type="start"/>'. */
  left?: string
  right?: string
}

export function scoreXml(bars: Bar[], time: [number, number] = [4, 4], directions = ''): string {
  const bl = (loc: string, inner?: string): string => (inner ? `<barline location="${loc}">${inner}</barline>` : '')
  return (
    `<?xml version="1.0"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name/></score-part></part-list><part id="P1">` +
    bars
      .map(
        (b, i) =>
          `<measure number="${i + 1}">${i === 0 ? `<attributes><divisions>12</divisions><key><fifths>0</fifths></key><time><beats>${time[0]}</beats><beat-type>${time[1]}</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>` + directions : ''}${bl('left', b.left)}${b.body}${bl('right', b.right)}</measure>`,
      )
      .join('') +
    `</part></score-partwise>`
  )
}

export const scoreOf = (bars: Bar[], time: [number, number] = [4, 4], directions = ''): Score => parseMusicXml(scoreXml(bars, time, directions))

/** One-note bars so the played bar order is visible in the events. */
export const barOf = (step: string, extra: Partial<Bar> = {}): Bar => ({ body: n({ step, type: 'whole' }), ...extra })

/** The timeline of a score as the tenor saxophone, the default instrument, plays it. Most tests do not care about the instrument. */
export const tenorTimeline = (score: Score): Timeline => buildTimeline(score, TENOR_SAX)
