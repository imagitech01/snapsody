import type { ReaderEvent, ReaderJob, ReaderStaff, ReaderStage } from './port.ts'

/**
 * A reading job that follows a script instead of recognising anything. The fake platform and the
 * browser-dev adapter both use it, so they send the same events in the same order as the real
 * Reader (see `ReaderEvent`): progress for each page, then its result, then `finished`.
 */

/** What a scripted job makes of one page. */
export type PageOutcome =
  /** `staves` and `timeEstimated` (design D7) are sent only when given, as the real reader does when it knows them. */
  | { result: 'done'; musicxml?: string; staves?: ReaderStaff[]; timeEstimated?: boolean }
  | { result: 'no-music'; message?: string }
  | { result: 'failed'; message?: string }
  /** The job itself breaks while reading this page: `finished` with status `failed`, and no later page. */
  | { result: 'job-failed'; message?: string }

/** The events a job over [count] pages sends, given each page's outcome (a missing one is `done` with [musicxml]). */
export function scriptedEvents(count: number, script: PageOutcome[], musicxml: string): ReaderEvent[] {
  if (count === 0) return [{ type: 'finished', pages: 0, status: 'failed', message: 'no pages' }]
  const events: ReaderEvent[] = []
  const progress = (page: number, stage: ReaderStage, fraction: number) =>
    events.push({ type: 'progress', page, pages: count, stage, fraction })
  for (let page = 0; page < count; page += 1) {
    const outcome: PageOutcome = script[page] ?? { result: 'done' }
    if (page === 0) progress(page, 'queued', 0)
    progress(page, 'prepare', 0.1)
    progress(page, 'segment', 0.4)
    if (outcome.result === 'no-music') {
      events.push({ type: 'no-music', page, pages: count, message: outcome.message ?? 'No noteheads or clefs found' })
    } else if (outcome.result === 'failed') {
      events.push({ type: 'failed', page, pages: count, message: outcome.message ?? 'The reading failed' })
    } else if (outcome.result === 'job-failed') {
      events.push({ type: 'finished', pages: count, status: 'failed', message: outcome.message ?? 'The reader stopped' })
      return events
    } else {
      progress(page, 'read', 0.8)
      progress(page, 'write', 0.95)
      const done: Extract<ReaderEvent, { type: 'done' }> = { type: 'done', page, pages: count, musicxml: outcome.musicxml ?? musicxml }
      if (outcome.staves) done.staves = structuredClone(outcome.staves)
      if (outcome.timeEstimated !== undefined) done.timeEstimated = outcome.timeEstimated
      events.push(done)
    }
  }
  events.push({ type: 'finished', pages: count, status: 'done' })
  return events
}

/** A job with its events ready: whoever owns it decides when each one is delivered (`step`, `flush`). */
export class ScriptedReaderJob implements ReaderJob {
  /** The page paths the job was started with. */
  readonly pages: string[]
  /** The events delivered so far, in order. */
  readonly delivered: ReaderEvent[] = []
  private readonly pending: ReaderEvent[]
  private readonly onEvent: (event: ReaderEvent) => void
  private done = false

  constructor(pages: string[], events: ReaderEvent[], onEvent: (event: ReaderEvent) => void) {
    this.pages = pages
    this.pending = events
    this.onEvent = onEvent
  }

  /** True once `finished` has been delivered. */
  get finished(): boolean {
    return this.done
  }

  /** Delivers the next event. Returns false when there is none left. */
  step(): boolean {
    const event = this.pending.shift()
    if (!event) return false
    this.deliver(event)
    return true
  }

  /** Delivers all remaining events. */
  flush(): void {
    while (this.step()) {
      // each step delivers one event
    }
  }

  async cancel(): Promise<void> {
    if (this.done) return
    this.pending.length = 0
    this.deliver({ type: 'finished', pages: this.pages.length, status: 'cancelled' })
  }

  private deliver(event: ReaderEvent): void {
    this.delivered.push(event)
    if (event.type === 'finished') this.done = true
    this.onEvent(event)
  }
}
