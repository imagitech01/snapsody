import type { Reader, ReaderEvent } from '../port.ts'
import { ScriptedReaderJob, scriptedEvents } from '../scriptedReader.ts'
import committedScore from '../../../test/fixtures/practice-exercise.recognised.musicxml?raw'

export interface BrowserDevReaderOptions {
  /** The MusicXML every page answers with; the committed recognised practice exercise by default. */
  musicxml?: string
  /** Milliseconds between two events, so the progress can be watched. */
  stepMs?: number
}

/**
 * The browser-dev "reader": it recognises nothing. Every page answers with the same committed
 * MusicXML (web/test/fixtures/practice-exercise.recognised.musicxml, what homr made of the
 * self-engraved practice exercise), with the events of the real Reader one after the other.
 */
export class BrowserDevReader implements Reader {
  private readonly options: BrowserDevReaderOptions

  constructor(options: BrowserDevReaderOptions = {}) {
    this.options = options
  }

  read(pages: string[], onEvent: (event: ReaderEvent) => void): ScriptedReaderJob {
    const events = scriptedEvents(pages.length, [], this.options.musicxml ?? committedScore)
    const job = new ScriptedReaderJob([...pages], events, onEvent)
    const timer = setInterval(() => {
      if (!job.step() || job.finished) clearInterval(timer)
    }, this.options.stepMs ?? 150)
    return job
  }
}
