import type { ComponentType } from 'preact'
import type { Screen, ScreenName, SheetName } from '../../app/router.ts'
import { AboutScreen } from './AboutScreen.tsx'
import { AddMusicScreen } from './AddMusicScreen.tsx'
import { CreditsScreen } from './CreditsScreen.tsx'
import { EditorScreen } from './editor/EditorScreen.tsx'
import { FavoritesScreen } from './FavoritesScreen.tsx'
import { HomeScreen } from './HomeScreen.tsx'
import { LibraryScreen } from './LibraryScreen.tsx'
import { LicenceScreen } from './LicenceScreen.tsx'
import { LoopSheet } from './LoopSheet.tsx'
import { PracticeScreen } from './PracticeScreen.tsx'
import { SettingsScreen } from './SettingsScreen.tsx'
import { InstrumentSheet } from './SettingsSheets.tsx'
import { ToolsSheet } from './ToolsSheet.tsx'

/*
 * Which component draws which screen, and which sheet. This is the one list to change when a screen is
 * built:
 *
 *  - a screen is a component that takes its route (`{ screen }`, narrowed to its own name) and reads
 *    what else it needs from `useShell()`. Every route has its screen now; `PlaceholderScreen` stays for a
 *    route that is added before its screen exists;
 *  - a new route is a new member of `Screen` in `app/router.ts`; the type of `SCREENS` then fails to
 *    compile until it has an entry here;
 *  - a sheet is a component that renders a `<Sheet>` and closes it with `router.closeSheet(name)`. The
 *    frame draws every open sheet in `router.overlays` (`Overlays.tsx`). The sheets of the practice
 *    screen (tools, loop) read their session from `activePractice`.
 *
 * Confirm dialogs need nothing here: any screen opens one with `router.confirm(...)`.
 */

/** A screen's component: its route, narrowed to the screen it draws. */
export type ScreenView<N extends ScreenName> = ComponentType<{ screen: Extract<Screen, { name: N }> }>

export const SCREENS: { readonly [N in ScreenName]: ScreenView<N> } = {
  home: HomeScreen,
  library: LibraryScreen,
  favorites: FavoritesScreen,
  settings: SettingsScreen,
  about: AboutScreen,
  credits: CreditsScreen,
  licence: LicenceScreen,
  practice: PracticeScreen,
  editor: EditorScreen,
  // one component for both: the route stays `add-music` while the pages are read (see AddMusicScreen.tsx)
  'add-music': AddMusicScreen,
  reading: AddMusicScreen,
}

/** The sheets built so far; one that is open and not listed draws nothing (and back still closes it). */
export const SHEETS: { readonly [N in SheetName]?: ComponentType } = {
  tools: ToolsSheet,
  loop: LoopSheet,
  instrument: InstrumentSheet,
}
