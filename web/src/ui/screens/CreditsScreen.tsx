import { groupCredits } from '../../app/credits.ts'
import type { Credit } from '../../app/credits.ts'
import { IconButton, ListRow } from '../components/index.ts'
import { useShell } from '../ShellContext.ts'

/** "0.7.1 · AGPL-3.0", or the licence alone where the entry has no single version. */
export const creditLine = (credit: Credit): string => [credit.version, credit.licence].filter(Boolean).join(' · ')

/**
 * Credits and licences (change paper-and-ink-and-about D6 and D7, spec `app-shell` "Credits and licences"):
 * every bundled component under its group, each row with its version and licence; a row opens the Licence screen.
 * A component that is not open source says so in its row. Pushed over About: its own Back, no tab bar.
 */
export function CreditsScreen() {
  const { i18n, router } = useShell()
  const { t } = i18n
  return (
    <div class="screen">
      <div class="screen-topbar">
        <IconButton label={t('common.back')} icon="back" onPress={() => void router.back()} />
      </div>
      <header class="screen-header">
        <h1 class="t-title">{t('credits.title')}</h1>
      </header>
      <div class="screen-body">
        <p class="credits-intro">{t('credits.intro')}</p>
        {groupCredits().map((section) => (
          <section class="credits-group" key={section.group} aria-labelledby={`credits-${section.group}`}>
            <h2 id={`credits-${section.group}`} class="t-eyebrow">
              {t(`credits.group.${section.group}`)}
            </h2>
            <div class="row-stack">
              {section.credits.map((credit) => (
                <ListRow
                  key={credit.id}
                  size="compact"
                  title={credit.name}
                  subtitle={credit.notOpenSource ? `${creditLine(credit)} · ${t('credits.notOpenSource')}` : creditLine(credit)}
                  chevron
                  onPress={() => router.push({ name: 'licence', componentId: credit.id })}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
