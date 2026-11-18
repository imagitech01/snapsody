import type { Device } from '../port.ts'

/** The browser-dev device: what a desktop browser has. Escape stands in for the back button. */
export class BrowserDevDevice implements Device {
  private lock: WakeLockSentinel | undefined

  async setKeepAwake(on: boolean): Promise<void> {
    try {
      if (on) {
        if (!this.lock && 'wakeLock' in navigator) this.lock = await navigator.wakeLock.request('screen')
      } else {
        await this.lock?.release()
        this.lock = undefined
      }
    } catch {
      // the browser may refuse (the tab is hidden, or there is no wake lock): the screen may sleep, nothing else
      this.lock = undefined
    }
  }

  onPause(listener: () => void): () => void {
    return onDocument('visibilitychange', () => {
      if (document.visibilityState === 'hidden') listener()
    })
  }

  onResume(listener: () => void): () => void {
    return onDocument('visibilitychange', () => {
      if (document.visibilityState === 'visible') listener()
    })
  }

  onBackButton(handler: () => boolean): () => void {
    return onDocument('keydown', (event) => {
      if ((event as KeyboardEvent).key === 'Escape' && handler()) event.preventDefault()
    })
  }

  async language(): Promise<string> {
    return navigator.language || 'en'
  }
}

function onDocument(type: string, listener: (event: Event) => void): () => void {
  document.addEventListener(type, listener)
  return () => document.removeEventListener(type, listener)
}
