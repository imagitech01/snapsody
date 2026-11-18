import type { Measure, Note, NoteType, Score, TimeSignature } from './model.ts'
import { isNote } from './model.ts'
import type { Frac } from './rational.ts'
import { ZERO, add, cmp, frac, mul, sub } from './rational.ts'
import { barLength } from './repairs.ts'

/**
 * Beams for display. homr writes no <beam> elements and Verovio does not beam MusicXML by
 * itself, so without this every eighth note has its own flag. The groups follow the usual
 * rules for printed exercises: notes of an eighth or shorter are joined within one beat (a
 * quarter in simple time, a dotted quarter in compound time such as 6/8); a rest, a longer
 * note or the next beat ends the group, and a group of one keeps its flag. Sixteenths get a
 * second beam (a hook when alone), thirty-seconds a third. The saved files are not changed:
 * the beams are only written into the MusicXML given to the renderer.
 */

export type BeamValue = 'begin' | 'continue' | 'end' | 'forward hook' | 'backward hook'

export interface BeamMark {
  /** 1 for the eighth-note beam, 2 for sixteenths, 3 for thirty-seconds. */
  number: number
  value: BeamValue
}

const LEVELS: Partial<Record<NoteType, number>> = { eighth: 1, '16th': 2, '32nd': 3, '64th': 4 }

/** How many beams a note of this type carries (0: not beamable). */
function levels(n: Note): number {
  return (n.type && LEVELS[n.type]) || 0
}

/** The length of one beam group under this time signature. */
export function beatLength(time: TimeSignature): Frac {
  // Compound time (6/8, 9/8, 12/8, 6/16 ...): beat = three of the beat unit.
  if (time.beatType >= 8 && time.beats % 3 === 0) return frac(3, time.beatType)
  // 3/8 and similar short bars: the whole bar.
  if (time.beatType >= 8 && time.beats <= 3) return frac(time.beats, time.beatType)
  // Simple time: a quarter (2/2 and 3/2 too: half-note beats still beam by quarters).
  return frac(1, 4)
}

function floorDiv(a: Frac, b: Frac): number {
  const q = mul(a, { n: b.d, d: b.n })
  return Math.floor(q.n / q.d)
}

/** Beam marks for every beamed note of the score, by note id. */
export function beamScore(score: Score): Map<string, BeamMark[]> {
  const result = new Map<string, BeamMark[]>()
  let time: TimeSignature = { beats: 4, beatType: 4 }
  score.measures.forEach((m, index) => {
    if (m.time) time = m.time
    beamMeasure(m, time, index === 0, result)
  })
  return result
}

function beamMeasure(m: Measure, time: TimeSignature, first: boolean, out: Map<string, BeamMark[]>): void {
  const beat = beatLength(time)
  // An incomplete first bar is a pickup: its notes sit at the end of a full bar.
  const full = frac(time.beats, time.beatType)
  const length = barLength(m)
  let onset = first && cmp(length, full) < 0 ? sub(full, length) : ZERO

  let group: Note[] = []
  let groupBeat = -1
  const close = () => {
    if (group.length >= 2) markGroup(group, out)
    group = []
    groupBeat = -1
  }
  for (const item of m.items) {
    if (!isNote(item) || item.grace || item.chord) continue
    const beatIndex = floorDiv(onset, beat)
    const beamable = !item.rest && levels(item) > 0
    if (!beamable || beatIndex !== groupBeat) close()
    if (beamable) {
      group.push(item)
      groupBeat = beatIndex
    }
    onset = add(onset, item.duration)
  }
  close()
}

function markGroup(group: Note[], out: Map<string, BeamMark[]>): void {
  const maxLevel = Math.max(...group.map(levels))
  for (let level = 1; level <= maxLevel; level++) {
    let i = 0
    while (i < group.length) {
      if (levels(group[i]!) < level) {
        i++
        continue
      }
      let j = i
      while (j + 1 < group.length && levels(group[j + 1]!) >= level) j++
      if (level === 1) {
        // The main beam spans the whole group.
        group.forEach((n, k) => push(out, n, level, k === 0 ? 'begin' : k === group.length - 1 ? 'end' : 'continue'))
        break
      }
      if (i === j) {
        // A lone shorter note gets a hook pointing into the group.
        push(out, group[i]!, level, i === group.length - 1 ? 'backward hook' : 'forward hook')
      } else {
        for (let k = i; k <= j; k++) push(out, group[k]!, level, k === i ? 'begin' : k === j ? 'end' : 'continue')
      }
      i = j + 1
    }
  }
}

function push(out: Map<string, BeamMark[]>, n: Note, number: number, value: BeamValue): void {
  const marks = out.get(n.id) ?? []
  marks.push({ number, value })
  out.set(n.id, marks)
}
