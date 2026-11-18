import type { Shell } from '../app/shell.ts'
import type { Tab } from '../app/router.ts'
import { TabBar } from './components/index.ts'
import type { TabItem } from './components/index.ts'
import { Overlays } from './Overlays.tsx'
import { SCREENS } from './screens/index.tsx'
import type { ScreenView } from './screens/index.tsx'
import { ShellContext } from './ShellContext.ts'

/**
 * The frame of the app (practice-app design D12, spec `app-shell` "Main tabs"): the screen on top of
 * the router's stack, the tab bar while that is a start screen, the notice, and the sheets and dialogs
 * over it. Which component draws which screen is `screens/index.tsx`; this file does not change when a
 * screen is added.
 */

const TAB_ICONS: Record<Tab, TabItem<Tab>['icon']> = { practice: 'play', library: 'library', settings: 'settings' }

export function App({ shell }: { shell: Shell }) {
  const { router, i18n } = shell
  const { t } = i18n
  const screen = router.screen.value
  // The screen is typed by its own name; the lookup by a name only known at run time cannot be.
  const View = SCREENS[screen.name] as ScreenView<typeof screen.name>
  const tabs: TabItem<Tab>[] = (['practice', 'library', 'settings'] as const).map((id) => ({ id, label: t(`tab.${id}`), icon: TAB_ICONS[id] }))
  const notice = shell.notice.value

  return (
    <ShellContext.Provider value={shell}>
      <div class="app">
        <main class="app-main">
          {/* Another screen is another component, also when it has the same name (two pieces to practise). */}
          <View key={`${router.stack.value.length}:${JSON.stringify(screen)}`} screen={screen as never} />
          {notice ? (
            <div class="notice" role="status">
              <span>{t(notice)}</span>
              <button type="button" class="notice-close" onClick={() => shell.dismissNotice()}>
                {t('common.ok')}
              </button>
            </div>
          ) : null}
        </main>
        {router.tabBarVisible.value ? <TabBar label={t('tab.barLabel')} tabs={tabs} current={router.tab.value} onSelect={(tab) => router.selectTab(tab)} /> : null}
        <Overlays />
      </div>
    </ShellContext.Provider>
  )
}
