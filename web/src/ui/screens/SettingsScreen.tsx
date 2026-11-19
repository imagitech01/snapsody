import { useState } from 'preact/hooks'
import { SOUND_CREDITS } from '../../app/credits.ts'
import { PRIVACY_POLICY_URL, SOURCE_CODE_URL } from '../../app/links.ts'
import { ListRow, ToggleRow } from '../components/index.ts'
import { useShell } from '../ShellContext.ts'

/**
 * The Settings tab's start screen (frame 07, specs `app-shell` "General settings" and `instruments`
 * "Default instrument"): the default instrument and the language, each one line that shows the
 * current choice and opens a sheet with the whole list (`SettingsSheets.tsx`, design D19), the
 * count-in (design D17), the credits of the instrument sounds, and the links to the privacy policy and the
 * source code (add-privacy-policy, spec `app-shell` "Privacy policy and source code"). A change takes effect at once
 * (the settings are signals) and is saved; a save that fails is the shell's notice (`settings.saveFailed`).
 */
export function SettingsScreen() {
  const { settings, i18n, router, run } = useShell()
  const { t } = i18n
  const [creditsOpen, setCreditsOpen] = useState(false)
  const language = settings.language.value

  const save = (change: () => Promise<void>): void => void run(change, 'settings.saveFailed')

  return (
    <div class="screen screen--tabs">
      <header class="screen-header">
        <p class="t-eyebrow">{t('app.name')}</p>
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
          <ListRow
            size="compact"
            title={t('settings.language')}
            value={language === null ? t('settings.language.device') : t(`language.${language}`)}
            chevron
            onPress={() => router.openSheet('language')}
          />
        </section>

        <section class="settings-section">
          <ListRow
            size="compact"
            title={t('settings.credits')}
            chevron
            expanded={creditsOpen}
            controls="credits-panel"
            onPress={() => setCreditsOpen(!creditsOpen)}
          />
          {creditsOpen ? (
            <div id="credits-panel" class="credits" role="region" aria-label={t('credits.title')}>
              <h2 class="note-title">{t('credits.sounds')}</h2>
              <p class="credits-line">{t('credits.intro')}</p>
              <p class="credits-name">{SOUND_CREDITS.name}</p>
              <p class="credits-line">{t('credits.licence', { licence: SOUND_CREDITS.licence })}</p>
              <p class="credits-line">{t('credits.source', { source: SOUND_CREDITS.source })}</p>
              <p class="credits-line">{t('credits.notices')}</p>
              <ul class="credits-notices">
                {[...SOUND_CREDITS.acknowledgements, ...SOUND_CREDITS.copyright].map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>

        <section class="settings-section">
          <ListRow size="compact" title={t('settings.privacy')} href={PRIVACY_POLICY_URL} chevron />
        </section>

        <section class="settings-section">
          <ListRow size="compact" title={t('settings.source')} subtitle={t('settings.source.hint')} href={SOURCE_CODE_URL} chevron />
        </section>

        <p class="t-caption settings-offline">{t('settings.offline')}</p>
      </div>
    </div>
  )
}
