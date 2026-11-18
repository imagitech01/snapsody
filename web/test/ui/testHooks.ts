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
  /** Writes the fake files to sessionStorage, so that a reload of the page finds them (a phone keeps its files). */
  snapshot(): void
}

declare global {
  interface Window {
    __test?: TestHooks
  }
}
