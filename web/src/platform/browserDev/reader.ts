import type { Reader, ReaderEvent } from '../port.ts'
import { ScriptedReaderJob, scriptedEvents } from '../scriptedReader.ts'
import type { PageOutcome } from '../scriptedReader.ts'

export interface BrowserDevReaderOptions {
  /** The MusicXML every page answers with. Without it every page fails: the reader has no score of its own. */
  musicxml?: string
  /** Milliseconds between two events, so the progress can be watched. */
  stepMs?: number
}

/**
 * The browser-dev "reader": it recognises nothing. Every page answers with the same MusicXML it was
 * given, with the events of the real Reader one after the other. `createBrowserDevPlatform` gives it a
 * committed fixture in `npm run dev`; the fixtures are not in the build the app ships, so there every
 * page fails.
 */
export class BrowserDevReader implements Reader {
  private readonly options: BrowserDevReaderOptions

  constructor(options: BrowserDevReaderOptions = {}) {
    this.options = options
  }

  read(pages: string[], onEvent: (event: ReaderEvent) => void): ScriptedReaderJob {
    const musicxml = this.options.musicxml
    const script: PageOutcome[] =
      musicxml === undefined ? pages.map(() => ({ result: 'failed', message: 'Browser-dev has no score to answer with' })) : []
    const events = scriptedEvents(pages.length, script, musicxml ?? '')
    const job = new ScriptedReaderJob([...pages], events, onEvent)
    const timer = setInterval(() => {
      if (!job.step() || job.finished) clearInterval(timer)
    }, this.options.stepMs ?? 150)
    return job
  }
}
