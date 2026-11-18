import type { Reader, ReaderEvent, ReaderJob, ReaderStaff, ReaderStage } from '../port.ts'
import type { DataPaths } from './files.ts'
import type { ListenerHandle, ReaderPlugin, ReaderPluginEvent } from './plugins.ts'
import { errorMessage } from './plugins.ts'

const STAGES: readonly string[] = ['queued', 'prepare', 'segment', 'detect', 'read', 'write'] satisfies ReaderStage[]

/** The plugin's event as the port's `ReaderEvent` (without the wire-only `jobId`), or undefined when it is not one. */
export function toReaderEvent(event: ReaderPluginEvent): ReaderEvent | undefined {
  const { type, page, pages } = event
  if (typeof pages !== 'number') return undefined
  const message = typeof event.message === 'string' ? event.message : undefined
  if (type === 'finished') {
    const status = event.status
    if (status !== 'done' && status !== 'cancelled' && status !== 'failed') return undefined
    return message === undefined ? { type, pages, status } : { type, pages, status, message }
  }
  if (typeof page !== 'number') return undefined
  switch (type) {
    case 'progress':
      if (typeof event.stage !== 'string' || !STAGES.includes(event.stage) || typeof event.fraction !== 'number') return undefined
      return { type, page, pages, stage: event.stage as ReaderStage, fraction: event.fraction }
    case 'done': {
      if (typeof event.musicxml !== 'string') return undefined
      const done: Extract<ReaderEvent, { type: 'done' }> = { type, page, pages, musicxml: event.musicxml }
      const staves = readerStaves(event.staves)
      if (staves) done.staves = staves
      if (typeof event.timeEstimated === 'boolean') done.timeEstimated = event.timeEstimated
      return done
    }
    case 'no-music':
      return message === undefined ? { type, page, pages } : { type, page, pages, message }
    case 'failed':
      return { type, page, pages, message: message ?? 'The reading failed' }
    default:
      return undefined
  }
}

/**
 * The `staves` of a `done` event as the port's `ReaderStaff`s, or undefined when they are missing or
 * one is not well formed (a box value that is not a number from 0 to 1, a bar that is not a whole
 * number): the page is then kept without positions, never dropped.
 */
function readerStaves(value: unknown): ReaderStaff[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined
  const fraction = (v: unknown): v is number => typeof v === 'number' && v >= 0 && v <= 1
  const staves: ReaderStaff[] = []
  for (const item of value) {
    const staff = item as { box?: Record<string, unknown>; firstBar?: unknown; lastBar?: unknown } | null
    const box = staff?.box
    if (!box || typeof box !== 'object') return undefined
    const { x, y, width, height } = box
    if (!fraction(x) || !fraction(y) || !fraction(width) || !fraction(height)) return undefined
    if (!Number.isInteger(staff.firstBar) || !Number.isInteger(staff.lastBar)) return undefined
    staves.push({ box: { x, y, width, height }, firstBar: staff.firstBar as number, lastBar: staff.lastBar as number })
  }
  return staves
}

function newJobId(): string {
  const random = globalThis.crypto?.randomUUID?.()
  return random ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

/**
 * The reader on the phone: our Reader plugin (homr through Chaquopy, android/.../reader/). One
 * `read` is one native job under one foreground service (design D6).
 *
 * The adapter names the job and listens to `readerEvent` before it starts the job, so the first
 * event is not missed; it passes on only its own job's events, without `jobId`, and stops after
 * `finished`. A job that cannot start (the plugin rejects: no pages, a missing image, another job
 * running) gives one `finished` with status `failed`.
 */
export class CapacitorReader implements Reader {
  private readonly plugin: ReaderPlugin
  private readonly paths: DataPaths

  constructor(plugin: ReaderPlugin, paths: DataPaths) {
    this.plugin = plugin
    this.paths = paths
  }

  read(pages: string[], onEvent: (event: ReaderEvent) => void): ReaderJob {
    const jobId = newJobId()
    let finished = false
    let handle: Promise<ListenerHandle> | undefined
    const deliver = (event: ReaderEvent): void => {
      if (finished) return
      if (event.type === 'finished') {
        finished = true
        void handle?.then((h) => h.remove()).catch(() => undefined)
      }
      onEvent(event)
    }
    const fail = (message: string): void => deliver({ type: 'finished', pages: pages.length, status: 'failed', message })

    const started = (async () => {
      handle = this.plugin.addListener('readerEvent', (raw) => {
        if (raw.jobId !== jobId) return
        const event = toReaderEvent(raw)
        if (event) deliver(event)
      })
      await handle
      const resolved = await Promise.all(pages.map((page) => this.paths.readable(page)))
      await this.plugin.read({ jobId, pages: resolved })
    })().catch((error: unknown) => fail(`the reading could not start: ${errorMessage(error)}`))

    return {
      cancel: async () => {
        await started
        if (finished) return
        await this.plugin.cancel({ jobId }).catch(() => undefined)
      },
    }
  }
}
