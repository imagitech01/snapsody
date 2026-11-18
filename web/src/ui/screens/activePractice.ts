import { signal } from '@preact/signals'
import type { PracticeSession } from '../../app/practiceSession.ts'

/*
 * The practice session that is open now, for the sheets over the practice screen. `Overlays` draws a
 * sheet without props and outside the screen's own tree, so the screen (`PracticeScreen.tsx`) publishes
 * its session here when it has opened one and takes it back when it closes. The sheets (tools, loop,
 * instrument) read it and call its intents. It is the UI's own state: nothing in `app/` knows it.
 */

/** The session of the practice screen on top, or null while none is open (or still opening). */
export const activePractice = signal<PracticeSession | null>(null)

/**
 * What went wrong with the sound of this session, to be told on the practice screen: a Play or an
 * instrument switch whose sound could not be loaded. Cleared when a session opens and by a Play that works.
 */
export const soundProblem = signal(false)
