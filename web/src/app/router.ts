import { computed, signal } from '@preact/signals'
import type { ReadonlySignal, Signal } from '@preact/signals'
import type { Device } from '../platform/port.ts'

/*
 * Navigation (practice-app design D12; spec `app-shell` "Main tabs" and "Back closes the top layer
 * first"): which tab is current, the stack of screens, the sheets and dialogs above the top screen,
 * and what the back button does.
 *
 * - There are three tabs, each with a start screen (Practice: `home`, Library: `library`, Settings:
 *   `settings`). One stack holds the screens; its first entry is a start screen (the constructor and
 *   `selectTab` put it there; `replace` is for the screens above it). The tab bar shows only on a
 *   start screen at the bottom of the stack (`tabBarVisible`), so practising, editing and adding
 *   music, which are pushed on top, use the whole screen until the user goes back.
 * - Tabs do not keep a stack each. The tab bar is only there when the stack is at a start screen,
 *   so there is never a deeper screen of another tab to come back to: `selectTab` swaps the
 *   stack for the start screen of that tab.
 * - Sheets and dialogs are one separate stack of overlays. Any navigation closes them: they belong
 *   to the screen they were opened on.
 * - `back()` is what the system back action (and a screen's own Back or Cancel) does: it closes the
 *   top overlay, else asks the leave guard of the top screen, else pops the screen; at a start
 *   screen it returns false, which lets the platform leave the app. `connectBackButton` hands it to
 *   `Device.onBackButton`. `push`, `replace`, `pop` and `selectTab` never ask.
 * - The leave guard is how the editor asks "discard your edits?" (spec `score-editing` "Save and
 *   practice"). The editor session registers one on its screen with `setLeaveGuard`; a guard
 *   that needs an answer from the user opens a dialog with `confirm`. The router does not know the editor.
 *
 * Not here: the hash that mirrors the screen in browser-dev (design D12) and the shape of what a
 * screen needs besides an id; `Screen` carries only what 9.3 to 9.6 are known to need.
 */

export type Tab = 'practice' | 'library' | 'settings'

export const TABS: readonly Tab[] = ['practice', 'library', 'settings']

/**
 * A screen of the stack. `pieceId` is the id of a piece in the library. `autoplay` opens the
 * piece and starts playing it (the play button of the rotation); `isNew` opens the editor on a piece
 * that adding music has just made, which asks for its name (change simplify-editor-and-name-new-pieces,
 * D4); `add-music` and `reading` carry the piece the pages are added to, when there is one.
 */
export type Screen =
  | { readonly name: 'home' }
  | { readonly name: 'library' }
  | { readonly name: 'favorites' }
  | { readonly name: 'settings' }
  | { readonly name: 'practice'; readonly pieceId: string; readonly autoplay?: boolean }
  | { readonly name: 'editor'; readonly pieceId: string; readonly isNew?: true }
  | { readonly name: 'add-music'; readonly pieceId?: string }
  | { readonly name: 'reading'; readonly pieceId?: string }

export type ScreenName = Screen['name']

const START_SCREENS: Readonly<Record<Tab, Screen>> = {
  practice: { name: 'home' },
  library: { name: 'library' },
  settings: { name: 'settings' },
}

/** The first screen of a tab. */
export function startScreen(tab: Tab): Screen {
  return START_SCREENS[tab]
}

/** Whether the screen is the start screen of a tab: the only kind the tab bar is shown on. */
export function isStartScreen(screen: Screen): boolean {
  return TABS.some((tab) => START_SCREENS[tab].name === screen.name)
}

/** The sheets that slide over a screen (frames 02.3 and 02.4), and Settings' two lists (default instrument, language). */
export type SheetName = 'tools' | 'loop' | 'instrument' | 'language'

/** What a confirm dialog says. The texts are already in the user's language. */
export interface ConfirmOptions {
  title: string
  message?: string
  confirmLabel: string
  cancelLabel: string
  /** The confirm button deletes or throws something away. */
  destructive?: boolean
}

/** A layer above the top screen. `id` tells two layers of the same kind apart. */
export type Overlay =
  | { readonly kind: 'sheet'; readonly id: number; readonly sheet: SheetName }
  | { readonly kind: 'dialog'; readonly id: number; readonly options: ConfirmOptions }

/**
 * What a screen registers to be asked before back leaves it. Answer true to let the user leave,
 * false to keep them there; a promise is fine (a dialog waiting for the user). A guard that
 * throws, or whose promise rejects, keeps the user on the screen.
 */
export type LeaveGuard = () => boolean | Promise<boolean>

interface Entry {
  readonly id: number
  readonly screen: Screen
  guard?: LeaveGuard
}

export class Router {
  /** The tab marked in the tab bar. It stays the tab the user came from while a screen is pushed over it. */
  readonly tab: ReadonlySignal<Tab>
  /** The screens, the first (always a start screen) to the top one. */
  readonly stack: ReadonlySignal<readonly Screen[]>
  /** The screen on top. */
  readonly screen: ReadonlySignal<Screen>
  /** Whether the tab bar is shown: only while the stack is at the start screen of a tab. */
  readonly tabBarVisible: ReadonlySignal<boolean>
  /** The sheets and dialogs over the top screen, the first opened to the one on top. */
  readonly overlays: ReadonlySignal<readonly Overlay[]>

  private readonly currentTab: Signal<Tab>
  private readonly entries: Signal<readonly Entry[]>
  private readonly layers: Signal<readonly Overlay[]>
  /** Resolves each dialog's promise, by its overlay id. */
  private readonly answers = new Map<number, (accepted: boolean) => void>()
  private nextId = 1
  /** The id of the entry whose leave guard has not answered yet. */
  private asking: number | undefined

  constructor(tab: Tab = 'practice') {
    this.currentTab = signal(tab)
    this.entries = signal([this.entry(startScreen(tab))])
    this.layers = signal([])
    this.tab = this.currentTab
    this.stack = computed(() => this.entries.value.map((e) => e.screen))
    this.screen = computed(() => this.entries.value[this.entries.value.length - 1]!.screen)
    this.tabBarVisible = computed(() => this.entries.value.length === 1 && isStartScreen(this.screen.value))
    this.overlays = this.layers
  }

  // ---- Screens -----------------------------------------------------------------------------

  /**
   * Shows a tab's start screen, with nothing else on the stack and no overlay. The tab bar calls it;
   * from a deeper screen it also works, and drops everything above the start screen. Choosing the
   * tab that is already shown at its start screen does nothing.
   */
  selectTab(tab: Tab): void {
    if (tab === this.currentTab.value && this.entries.value.length === 1) return
    this.closeOverlays(0)
    this.currentTab.value = tab
    this.entries.value = [this.entry(startScreen(tab))]
  }

  /** Opens a screen over the top one. */
  push(screen: Screen): void {
    this.closeOverlays(0)
    this.entries.value = [...this.entries.value, this.entry(screen)]
  }

  /** Swaps the top screen for another, as when reading is done and the editor takes its place. Its leave guard goes with it. */
  replace(screen: Screen): void {
    this.closeOverlays(0)
    this.entries.value = [...this.entries.value.slice(0, -1), this.entry(screen)]
  }

  /** Removes the top screen without asking its guard. False, and nothing changes, at a start screen. */
  pop(): boolean {
    if (this.entries.value.length <= 1) return false
    this.closeOverlays(0)
    this.entries.value = this.entries.value.slice(0, -1)
    return true
  }

  // ---- Back --------------------------------------------------------------------------------

  /**
   * The back action. Returns true when it did something (or is waiting for the user's answer) and
   * false when the app is at a start screen with nothing open, which is when the platform may leave
   * the app.
   *
   * 1. An overlay is open: closes the top one (a dialog counts as "no").
   * 2. A guard of the top screen is waiting for an answer: nothing more.
   * 3. Otherwise asks the top screen's leave guard, and pops the screen when it lets the user go.
   *    A guard that answers with a promise is waited for, and the screen is popped only if it is
   *    still the top one by then.
   */
  back(): boolean {
    const layers = this.layers.value
    if (layers.length > 0) {
      this.closeOverlays(layers.length - 1)
      return true
    }
    if (this.asking !== undefined) return true
    const entries = this.entries.value
    if (entries.length <= 1) return false
    const top = entries[entries.length - 1]!
    let verdict: boolean | Promise<boolean>
    try {
      verdict = top.guard ? top.guard() : true
    } catch {
      return true // the guard broke: stay, and the next back asks again
    }
    if (verdict === true) this.pop()
    else if (verdict !== false) this.waitFor(top, verdict)
    return true
  }

  /**
   * Registers the guard `back()` asks before it leaves the screen that is on top now (the editor
   * session calls it when its screen opens). It is dropped when that screen leaves the stack; the
   * returned function drops it sooner. One guard per screen: a new one replaces the old.
   */
  setLeaveGuard(guard: LeaveGuard): () => void {
    const entry = this.entries.value[this.entries.value.length - 1]!
    entry.guard = guard
    return () => {
      if (entry.guard === guard) entry.guard = undefined
    }
  }

  // ---- Sheets and dialogs ------------------------------------------------------------------

  /** Opens a sheet over the screen, unless that sheet is open already. */
  openSheet(sheet: SheetName): void {
    if (this.layers.value.some((o) => o.kind === 'sheet' && o.sheet === sheet)) return
    this.layers.value = [...this.layers.value, { kind: 'sheet', id: this.nextId++, sheet }]
  }

  /** Closes the sheet and whatever was opened over it. Nothing happens when it is not open. */
  closeSheet(sheet: SheetName): void {
    const layers = this.layers.value
    for (let index = layers.length - 1; index >= 0; index--) {
      const overlay = layers[index]!
      if (overlay.kind === 'sheet' && overlay.sheet === sheet) {
        this.closeOverlays(index)
        return
      }
    }
  }

  /**
   * Opens a dialog over the screen and gives the user's answer: true when they confirm, false when
   * they cancel, press back or the screen changes. The UI shows the top overlay when it is a dialog
   * and calls `answerDialog` from its buttons.
   */
  confirm(options: ConfirmOptions): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const id = this.nextId++
      this.answers.set(id, resolve)
      this.layers.value = [...this.layers.value, { kind: 'dialog', id, options }]
    })
  }

  /** The buttons of the dialog on top: closes it and answers its promise. Nothing happens when the top overlay is not a dialog. */
  answerDialog(accepted: boolean): void {
    const layers = this.layers.value
    const top = layers[layers.length - 1]
    if (top?.kind !== 'dialog') return
    this.layers.value = layers.slice(0, -1)
    this.settle(top.id, accepted)
  }

  // ---- Inside -------------------------------------------------------------------------------

  private entry(screen: Screen): Entry {
    return { id: this.nextId++, screen }
  }

  /** Removes the overlays from [from] up; the dialogs among them answer "no", the top one first. */
  private closeOverlays(from: number): void {
    const layers = this.layers.value
    if (from >= layers.length) return
    this.layers.value = layers.slice(0, from)
    for (const overlay of layers.slice(from).reverse()) if (overlay.kind === 'dialog') this.settle(overlay.id, false)
  }

  private settle(id: number, accepted: boolean): void {
    const resolve = this.answers.get(id)
    this.answers.delete(id)
    resolve?.(accepted)
  }

  private waitFor(entry: Entry, verdict: Promise<boolean>): void {
    this.asking = entry.id
    void verdict
      .then(
        (leave) => leave === true,
        () => false,
      )
      .then((leave) => {
        if (this.asking === entry.id) this.asking = undefined
        const entries = this.entries.value
        if (leave && entries[entries.length - 1]?.id === entry.id) this.pop()
      })
  }
}

/** A router that starts at the start screen of [tab]. */
export function createRouter(tab: Tab = 'practice'): Router {
  return new Router(tab)
}

/**
 * Hands the back button to the router: back closes the top layer, then goes back a screen, and at
 * a start screen it says false so that the platform leaves the app. Returns the function that stops it.
 */
export function connectBackButton(router: Pick<Router, 'back'>, device: Pick<Device, 'onBackButton'>): () => void {
  return device.onBackButton(() => router.back())
}
