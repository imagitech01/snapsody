import { createContext } from 'preact'
import { useContext } from 'preact/hooks'
import type { Shell } from '../app/shell.ts'

/**
 * The shell the app was started with (`app/shell.ts`), for every screen and overlay below `App`. It is
 * the one place a component gets the router, the library, the settings, the translator and the platform
 * from, so a screen is a function of its route and takes no props from the frame.
 */
export const ShellContext = createContext<Shell | null>(null)

export function useShell(): Shell {
  const shell = useContext(ShellContext)
  if (!shell) throw new Error('useShell: no shell; render the screen inside <App>')
  return shell
}
