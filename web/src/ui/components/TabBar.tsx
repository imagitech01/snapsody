import { Icon } from './Icon.tsx'
import type { IconName } from './Icon.tsx'

/**
 * The tab bar at the bottom of a start screen (frames 01, 03.1, 07): three tabs, the current one on a
 * tinted pill. It is a navigation landmark with one button per tab; the current tab has
 * `aria-current="page"`. It sits above the bottom inset of the screen, so it keeps clear of the
 * gesture bar. The app shows it only on a start screen (`Router.tabBarVisible`).
 */
export interface TabItem<T extends string> {
  id: T
  label: string
  icon: IconName
}

export interface TabBarProps<T extends string> {
  /** The name of the navigation landmark ("Main"). */
  label: string
  tabs: readonly TabItem<T>[]
  current: T
  onSelect: (id: T) => void
}

export function TabBar<T extends string>({ label, tabs, current, onSelect }: TabBarProps<T>) {
  return (
    <nav class="tab-bar" aria-label={label}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          class="tab-bar-tab"
          aria-current={tab.id === current ? 'page' : undefined}
          onClick={() => onSelect(tab.id)}
        >
          <Icon name={tab.icon} />
          <span>{tab.label}</span>
        </button>
      ))}
    </nav>
  )
}
