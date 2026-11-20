import { PRIVACY_POLICY_URL, SOURCE_CODE_URL } from '../../app/links.ts'
import { IconButton, ListRow } from '../components/index.ts'
import { useShell } from '../ShellContext.ts'

/**
 * About Snapsody (change paper-and-ink-and-about D6 and D10, spec `app-shell` "About Snapsody"): the name,
 * the version and the licence of the app, one sentence about what it is built on, and the rows Credits and
 * licences, Privacy policy and Source code. It is pushed over Settings like Favorites: its own Back, no tab bar.
 * The icon is the launcher icon's mark, decorative (the name is next to it).
 */
export function AboutScreen() {
  const { i18n, router } = useShell()
  const { t } = i18n
  return (
    <div class="screen">
      <div class="screen-topbar">
        <IconButton label={t('common.back')} icon="back" onPress={() => void router.back()} />
      </div>
      <header class="screen-header">
        <h1 class="t-title">{t('about.title')}</h1>
        <p class="t-subtitle">{t('about.version', { version: __APP_VERSION__ })}</p>
      </header>
      <div class="screen-body">
        <div class="about-card">
          <img class="about-icon" src="favicon.svg" alt="" width={48} height={48} />
          <div>
            <p class="about-name">{t('about.name', { version: __APP_VERSION__ })}</p>
            <p class="about-line">{t('about.licence')}</p>
            <p class="about-line">{t('about.copyright')}</p>
          </div>
        </div>
        <p class="about-note">{t('about.note')}</p>
        <section class="settings-section">
          <div class="row-stack">
            <ListRow size="compact" title={t('about.credits')} subtitle={t('about.credits.hint')} chevron onPress={() => router.push({ name: 'credits' })} />
            <ListRow size="compact" title={t('about.privacy')} href={PRIVACY_POLICY_URL} chevron />
            <ListRow size="compact" title={t('about.source')} subtitle={t('about.source.hint')} href={SOURCE_CODE_URL} chevron />
          </div>
        </section>
      </div>
    </div>
  )
}
