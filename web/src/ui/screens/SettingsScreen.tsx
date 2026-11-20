import { PLAY_STORE_URL } from '../../app/links.ts'
import { ListRow, ToggleRow } from '../components/index.ts'
import { useShell } from '../ShellContext.ts'

/**
 * The Settings tab's start screen (frame 07, specs `app-shell` "General settings" and `instruments`
 * "Default instrument"): the default instrument, one line that shows the
 * current choice and opens a sheet with the whole list (`SettingsSheets.tsx`, design D19), the
 * count-in (design D17), and one group of two rows (change paper-and-ink-and-about D9 and D10): Rate on Google
 * Play, a link to the app's page in Play, and About Snapsody, which shows the version and opens the About screen
 * (credits, privacy policy and source code are there now). A change takes effect at once
 * (the settings are signals) and is saved; a save that fails is the shell's notice (`settings.saveFailed`).
 */
export function SettingsScreen() {
  const { settings, i18n, router, run } = useShell()
  const { t } = i18n

  const save = (change: () => Promise<void>): void => void run(change, 'settings.saveFailed')

  return (
    <div class="screen screen--tabs">
      <header class="screen-header">
        <h1 class="t-title">{t('settings.title')}</h1>
        <p class="t-subtitle">{t('settings.subtitle')}</p>
      </header>
      <div class="screen-body">
        <section class="settings-section">
          <ListRow
            size="compact"
            title={t('settings.instrument')}
            value={i18n.instrumentName(settings.defaultInstrument.value)}
            chevron
            onPress={() => router.openSheet('instrument')}
          />
        </section>

        <section class="settings-section">
          <ToggleRow
            title={t('practice.countIn')}
            description={t('practice.countIn.hint')}
            checked={settings.countIn.value}
            onChange={(on) => save(() => settings.setCountIn(on))}
          />
        </section>

        <section class="settings-section">
          <div class="row-stack">
            <ListRow size="compact" title={t('settings.rate')} href={PLAY_STORE_URL} chevron />
            <ListRow
              size="compact"
              title={t('settings.about')}
              value={__APP_VERSION__}
              chevron
              onPress={() => router.push({ name: 'about' })}
            />
          </div>
        </section>

        <p class="t-caption settings-offline">{t('settings.offline')}</p>
      </div>
    </div>
  )
}
