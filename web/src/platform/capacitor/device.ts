import type { Device } from '../port.ts'
import type { AppPlugin, DevicePlugin, KeepAwakePlugin, ListenerHandle } from './plugins.ts'

/** Removes a listener whose handle is still on its way. */
function remover(handle: Promise<ListenerHandle>): () => void {
  let removed = false
  return () => {
    if (removed) return
    removed = true
    void handle.then((h) => h.remove()).catch(() => undefined)
  }
}

/**
 * The device on the phone: @capacitor/app (pause, resume, back button), @capacitor/device (the
 * language) and @capacitor-community/keep-awake (the screen stays on while playing, design D12).
 */
export class CapacitorDevice implements Device {
  private readonly app: AppPlugin
  private readonly device: DevicePlugin
  private readonly keepAwake: KeepAwakePlugin
  private readonly backHandlers: Array<() => boolean> = []

  constructor(app: AppPlugin, device: DevicePlugin, keepAwake: KeepAwakePlugin) {
    this.app = app
    this.device = device
    this.keepAwake = keepAwake
    // Always listening: with @capacitor/app installed and no JS listener, its back callback only
    // steps back in the WebView's history (there is none here) and otherwise does nothing.
    void this.app.addListener('backButton', () => {
      const newest = this.backHandlers[this.backHandlers.length - 1]
      if (!newest || !newest()) void this.app.minimizeApp()
    })
  }

  async setKeepAwake(on: boolean): Promise<void> {
    await (on ? this.keepAwake.keepAwake() : this.keepAwake.allowSleep())
  }

  onPause(listener: () => void): () => void {
    return remover(this.app.addListener('pause', () => listener()))
  }

  onResume(listener: () => void): () => void {
    return remover(this.app.addListener('resume', () => listener()))
  }

  /**
   * The newest handler answers. On false, or with no handler, the app is left the way Android
   * leaves it for the back button on the first screen: it goes to the background (`minimizeApp`).
   */
  onBackButton(handler: () => boolean): () => void {
    this.backHandlers.push(handler)
    let removed = false
    return () => {
      if (removed) return
      removed = true
      const index = this.backHandlers.indexOf(handler)
      if (index >= 0) this.backHandlers.splice(index, 1)
    }
  }

  async language(): Promise<string> {
    try {
      return (await this.device.getLanguageTag()).value || 'en'
    } catch {
      return 'en'
    }
  }
}
