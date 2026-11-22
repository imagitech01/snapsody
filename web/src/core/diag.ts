/*
 * Diagnostics for the dev build (app id `be.imagitech.snapsody.dev`, docs/testing.md "Dev build on the phone"):
 * one line per event that matters to playback and the cursor, as `[diag] <tag> <json>`, which Capacitor sends
 * to logcat in a debug build. Off everywhere else (the Play app, the browser, the tests): every call is then a
 * single check of a flag. `ui/diagnostics.ts` turns it on and adds the heartbeat while a piece plays.
 */

let on = false
const counters = new Map<string, number>()
let nextId = 0

export const diag = {
  get on(): boolean {
    return on
  },
  enable(): void {
    on = true
  },
  /** A number to tell sessions, players and audio contexts apart in the log. */
  id(): number {
    return ++nextId
  },
  log(tag: string, data?: Record<string, unknown>): void {
    if (!on) return
    let text = ''
    try {
      text = data === undefined ? '' : ` ${JSON.stringify(data)}`
    } catch {
      text = ' <unserialisable>'
    }
    console.info(`[diag] ${tag}${text}`)
  },
  count(name: string): void {
    if (on) counters.set(name, (counters.get(name) ?? 0) + 1)
  },
  /** The count since the last `take`, and starts again from 0. */
  take(name: string): number {
    const n = counters.get(name) ?? 0
    counters.delete(name)
    return n
  },
}

/** The audio contexts made and not yet closed, for the heartbeat: is an old one still running? */
export interface DiagContext {
  id: number
  ctx: { readonly state: string; readonly currentTime: number; readonly outputLatency?: number; readonly baseLatency?: number }
}
export const diagContexts = new Set<DiagContext>()
