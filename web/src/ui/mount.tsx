import { render } from 'preact'
import { effect, signal } from '@preact/signals'
import { createI18n } from '../app/i18n/index.ts'
import { startShell } from '../app/shell.ts'
import type { Shell } from '../app/shell.ts'
import type { Platform } from '../platform/port.ts'
import { App } from './App.tsx'

/**
 * Starts the app on a platform and draws it into [root]: `startShell` (settings, sweep, i18n, list,
 * router), then the frame. Both entries call it and differ only in the platform they pass: `main.tsx`
 * (the phone, or browser-dev), and the UI tests' entry (`web/test/ui/seeded.tsx`, never in the app's build).
 * Resolves with the shell once the first screen is drawn.
 */
export async function mount(platform: Platform, root: HTMLElement): Promise<Shell> {
  let shell: Shell
  try {
    shell = await startShell(platform)
  } catch {
    // Nothing in the start-up is expected to throw; if it does, say so in the phone's language and do not stay blank.
    const t = createI18n(signal(null), globalThis.navigator?.language).t
    render(<p class="fatal">{t('error.generic')}</p>, root)
    throw new Error('the app could not start')
  }
  // The page's language follows the app's (screen readers pick their voice from it).
  effect(() => {
    document.documentElement.lang = shell.i18n.language.value
  })
  render(<App shell={shell} />, root)
  return shell
}
