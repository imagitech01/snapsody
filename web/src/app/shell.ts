import { effect, signal, untracked } from '@preact/signals'
import type { ReadonlySignal, Signal } from '@preact/signals'
import type { Platform } from '../platform/port.ts'
import { createHome } from './home.ts'
import type { Home } from './home.ts'
import { createI18n } from './i18n/index.ts'
import type { I18n } from './i18n/index.ts'
import { createLibrary } from './library.ts'
import type { Library } from './library.ts'
import { createLibraryView } from './libraryView.ts'
import type { LibraryView } from './libraryView.ts'
import { connectBackButton, createRouter } from './router.ts'
import type { Router, ScreenName } from './router.ts'
import { loadSettings } from './settings.ts'
import type { Settings } from './settings.ts'

/*
 * The app shell (practice-app design D2, D4, D11, D12, spec `app-shell`): everything the screens
 * share, made once when the app starts. The UI renders from it and adds nothing to it; a screen
 * gets what it needs from `Shell`.
 *
 * Start-up, in this order (`startShell`):
 *   1. `loadSettings(files)`: the default instrument is needed first. It never fails.
 *   2. `library.sweep()`: it settles what an interrupted run left in `pieces/` and MUST finish before
 *      the first `list()` (design D4: a piece whose `piece.json` only survives as a temp file is
 *      recovered at start). A sweep that fails is not the end of the app: the list is read anyway.
 *   3. `createI18n()`: the translator.
 *   4. The library view and the home (`createLibraryView`, `createHome`), over the library.
 *   5. The router, and the back button handed to it (`connectBackButton`).
 *   Then the list is read once (`home.refresh()`), so the first screen is drawn with the pieces in it.
 *
 * What the shell does while the app runs:
 *  - Refreshes the list whenever a screen that shows it comes into view again (home, library,
 *    favorites): a practice session or the editor changes `lastPracticed`, the name, the pages, and
 *    nothing else tells the store, and the rows' "yesterday" is only right when they are made again.
 *    It is an effect on `router.screen`, so a screen that is added later gets this without doing anything.
 *  - Follows the app going to the background and coming back (`foreground`). A practice session pauses
 *    itself on `Device.onPause`; the shell refreshes the list when the app comes back, because a day may have
 *    turned over ("yesterday") while it was away.
 *  - Reports what failed: a save of a setting or a change of the library that is rejected (settings that
 *    could not be read at start are `readOnly` and every save rejects) shows `notice`, one short text,
 *    until the user leaves the screen or the same kind of change works.
 *
 * How a screen is added (see `ui/screens/index.tsx`): `Router` knows its name (`Screen`), the UI gets a
 * component for it, and whatever the screen needs of the app (a practice session, an add-music flow) is made
 * by the screen from `shell.library`, `shell.settings`, `shell.platform` and `shell.i18n` when it opens.
 */

/** The texts the notice can be: keys of the catalogue, so the notice is written in the catalogue's words. */
export type NoticeKey = 'settings.saveFailed' | 'error.generic' | 'add.partDropped'

export interface Shell {
  /** The phone, as the port gives it: a screen that needs the scanner or the reader takes them from here. */
  readonly platform: Platform
  readonly settings: Settings
  readonly library: Library
  readonly i18n: I18n
  /** The list of pieces every screen reads. */
  readonly view: LibraryView
  readonly home: Home
  readonly router: Router
  /** False while the app is in the background. */
  readonly foreground: ReadonlySignal<boolean>
  /** What the app has to tell the user after something failed, or null. */
  readonly notice: ReadonlySignal<NoticeKey | null>
  /**
   * Runs [action] (a save, a delete, a star) and reports a failure as the notice instead of throwing, so
   * a screen can call it without a catch. Resolves true when it worked. A success clears the notice when the
   * notice is the one this kind of action raises.
   */
  run(action: () => Promise<unknown>, failure?: NoticeKey): Promise<boolean>
  /** Shows [key] as the notice (something to tell, not a failure: a part left out of added pages). It ends when the user leaves the screen it was shown on. */
  notify(key: NoticeKey): void
  /** Clears the notice. */
  dismissNotice(): void
  /** Stops listening to the router, the back button and the device. Tests call it; the app lives as long as the page. */
  stop(): void
}

/** The screens that show the list of pieces: it is read again when one of them is shown. */
const SHOWS_LIST: ReadonlySet<ScreenName> = new Set<ScreenName>(['home', 'library', 'favorites'])

export async function startShell(platform: Platform): Promise<Shell> {
  const settings = await loadSettings(platform.files)

  const library = createLibrary(platform.files)
  try {
    await library.sweep()
  } catch {
    // The list below is read anyway; what the sweep could not clean up is tried again at the next start.
  }

  const i18n = createI18n()
  const view = createLibraryView({ library, i18n })
  const home = createHome({ view, library, i18n })
  const router = createRouter('practice')
  const stopBack = connectBackButton(router, platform.device)

  const notice: Signal<NoticeKey | null> = signal(null)
  const foreground = signal(true)

  /** Reads the list again; a list that cannot be read is the notice (and the screens keep what they had). */
  const refresh = async (): Promise<void> => {
    try {
      await home.refresh()
    } catch {
      notice.value = 'error.generic'
    }
  }

  // The first run of the effect is the first read of the list; the others are the screens coming into view.
  let first: Promise<void> | undefined
  let current: ScreenName | undefined
  const stopRefresh = effect(() => {
    const name = router.screen.value.name
    untracked(() => {
      // Going to another screen ends the notice of the last one.
      if (current !== undefined && current !== name) notice.value = null
      current = name
      if (!SHOWS_LIST.has(name)) return
      const read = refresh()
      first ??= read
    })
  })
  await first

  const stopPause = platform.device.onPause(() => {
    foreground.value = false
  })
  const stopResume = platform.device.onResume(() => {
    foreground.value = true
    if (SHOWS_LIST.has(router.screen.value.name)) void refresh()
  })

  const run: Shell['run'] = async (action, failure = 'error.generic') => {
    try {
      await action()
    } catch {
      notice.value = failure
      return false
    }
    if (notice.value === failure) notice.value = null
    return true
  }

  return {
    platform,
    settings,
    library,
    i18n,
    view,
    home,
    router,
    foreground,
    notice,
    run,
    notify: (key) => {
      notice.value = key
    },
    dismissNotice: () => {
      notice.value = null
    },
    stop: () => {
      stopBack()
      stopRefresh()
      stopPause()
      stopResume()
    },
  }
}
