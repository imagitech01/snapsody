// The pieces the seeds make (seeds.ts) and the journeys look for. Plain TypeScript, so the tests (node) and the
// seeded app (the browser) read the same list.

import type { PracticeState } from '../../src/app/library.ts'

export interface SeedPiece {
  id: string
  name: string
  /** The bars of each page, in order; the piece has their sum. */
  pages: number[]
  created: string
  lastPracticed: string | null
  favorite: boolean
  practice?: Partial<PracticeState>
}

/**
 * The pieces of the spec's scenarios and of the Figma frames: "Ode to Joy" (3 pages, 12 bars, practised
 * today, left in bar 2 at 60 BPM, metronome on), "C major warm-up" (4 bars, practised yesterday, a favorite),
 * "Even eighths" (8 bars, never practised, not a favorite) and "Étude in D" (an accent for the search). The clock
 * of the journeys is 18 Nov 2026 10:00 UTC (`CLOCK_START`).
 */
export const LIBRARY: readonly SeedPiece[] = [
  { id: '00000000-0000-4000-8000-0000000000a1', name: 'Ode to Joy', pages: [4, 4, 4], created: '2026-11-18T08:00:00.000Z', lastPracticed: '2026-11-18T09:30:00.000Z', favorite: false, practice: { bar: 2, tempo: 60, metronome: true } },
  { id: '00000000-0000-4000-8000-0000000000a2', name: 'C major warm-up', pages: [4], created: '2026-11-10T08:00:00.000Z', lastPracticed: '2026-11-17T17:00:00.000Z', favorite: true },
  { id: '00000000-0000-4000-8000-0000000000a3', name: 'Even eighths', pages: [8], created: '2026-11-12T08:00:00.000Z', lastPracticed: null, favorite: false },
  { id: '00000000-0000-4000-8000-0000000000a4', name: 'Étude in D', pages: [6], created: '2026-11-01T08:00:00.000Z', lastPracticed: null, favorite: false },
]

/** One piece that was never practised and is not a favorite: a library with nothing to continue and no rotation. */
export const UNPRACTISED: readonly SeedPiece[] = [LIBRARY[2]!]

/** The ids by name, for the journeys. */
export const ID = {
  ode: LIBRARY[0]!.id,
  warmUp: LIBRARY[1]!.id,
  eighths: LIBRARY[2]!.id,
  etude: LIBRARY[3]!.id,
  /** "Waltz study in G" of the committed format 2 store (seed `v2`). */
  waltz: '00000000-0000-4000-8000-000000000002',
} as const
