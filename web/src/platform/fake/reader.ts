import type { Reader, ReaderEvent } from '../port.ts'
import { ScriptedReaderJob, scriptedEvents } from '../scriptedReader.ts'
import type { PageOutcome } from '../scriptedReader.ts'

/** What the fake reader makes of one page. */
export type FakePageOutcome = PageOutcome

/**
 * A job of the fake reader: the events it will send, those it has sent, and the controls to step
 * through them: `step()` delivers one, `flush()` all, `cancel()` ends it.
 */
export type FakeReaderJob = ScriptedReaderJob

export interface FakeReaderOptions {
  /** The MusicXML of a page that is `done` without its own (a test passes a committed score). */
  musicxml?: string
  /**
   * True (the default): a job delivers all its events on its own, in a microtask after `read` returns.
   * False: the test delivers them one by one with `job.step()` or all with `job.flush()`.
   */
  autoRun?: boolean
}

/**
 * The fake reader: a test scripts what each page gives (`willRead`), and the job sends the events
 * the real one does, in the same order: progress for each page, then its result, then `finished`
 * (see `ReaderEvent`). A job without a script reads every page as `done`.
 */
export class FakeReader implements Reader {
  /** Every job started so far. */
  readonly jobs: FakeReaderJob[] = []
  private readonly options: FakeReaderOptions
  private readonly scripts: FakePageOutcome[][] = []

  constructor(options: FakeReaderOptions = {}) {
    this.options = options
  }

  /** The outcome of each page of the next job (pages beyond the list are `done`). */
  willRead(outcomes: FakePageOutcome[]): void {
    this.scripts.push(outcomes)
  }

  read(pages: string[], onEvent: (event: ReaderEvent) => void): FakeReaderJob {
    const script = this.scripts.shift() ?? []
    const events = scriptedEvents(pages.length, script, this.options.musicxml ?? '<score-partwise version="4.0"/>')
    const job = new ScriptedReaderJob([...pages], events, onEvent)
    this.jobs.push(job)
    if (pages.length === 0) {
      // the real reader refuses an empty job
      job.flush()
    } else if (this.options.autoRun ?? true) {
      queueMicrotask(() => job.flush())
    }
    return job
  }
}
