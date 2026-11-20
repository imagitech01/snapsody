// What the UI tests' own entry (seeded.tsx) leaves on `window` for the journeys. Only the test build has it:
// the app's entry (src/main.tsx) never imports the fake platform or anything under web/test/.

import type { Shell } from '../../src/app/shell.ts'
import type { FakePlatform } from '../../src/platform/fake/index.ts'

export interface TestHooks {
  /** The fake platform the app runs on: the device (back, pause, resume), the scanner and reader scripts, the files. */
  platform: FakePlatform
  /** The shell the app started: its router (which screen is open), library and settings. */
  shell: Shell
  /** Where the open practice session is (the header no longer shows it, design D19), or null when no piece is open. */
  practice(): { bar: number; bars: number; shownBar: number | null; following: boolean } | null
  /** The parts of the open practice session (change parts-and-accompaniment): your part, what plays along, and the voices of the scheduled notes. Null when no piece is open. */
  practiceParts(): {
    part: { id: string; hand?: 'right' | 'left' }
    silent: readonly string[]
    ownLine: boolean
    instrument: string
    /** The distinct "part/staff" of the events the player has scheduled (after Play), with `*` after the ones of your line: ["P1/0*", "P2/0", "P2/1"]. */
    scheduled: string[]
  } | null
  /** Writes the fake files to sessionStorage, so that a reload of the page finds them (a phone keeps its files). */
  snapshot(): void
}

declare global {
  interface Window {
    __test?: TestHooks
  }
}
