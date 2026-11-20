import type { Device } from '../port.ts'

/** The fake device: records what the app asks for, and lets a test send the events a phone sends. */
export class FakeDevice implements Device {
  /** Whether the screen is being kept on, and every change so far. */
  keepAwake = false
  readonly keepAwakeLog: boolean[] = []
  private readonly pauseListeners: Array<() => void> = []
  private readonly resumeListeners: Array<() => void> = []
  private readonly backHandlers: Array<() => boolean> = []

  async setKeepAwake(on: boolean): Promise<void> {
    this.keepAwake = on
    this.keepAwakeLog.push(on)
  }

  onPause(listener: () => void): () => void {
    return subscribe(this.pauseListeners, listener)
  }

  onResume(listener: () => void): () => void {
    return subscribe(this.resumeListeners, listener)
  }

  onBackButton(handler: () => boolean): () => void {
    return subscribe(this.backHandlers, handler)
  }

  /** The app goes to the background. */
  pause(): void {
    for (const listener of [...this.pauseListeners]) listener()
  }

  /** The app comes back. */
  resume(): void {
    for (const listener of [...this.resumeListeners]) listener()
  }

  /** The user presses back. The newest handler answers; with none, or when it says false, the app would be left: returns false. */
  pressBack(): boolean {
    const handler = this.backHandlers[this.backHandlers.length - 1]
    return handler ? handler() : false
  }
}

function subscribe<T>(list: T[], item: T): () => void {
  list.push(item)
  return () => {
    const index = list.indexOf(item)
    if (index >= 0) list.splice(index, 1)
  }
}
