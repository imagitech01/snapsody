import { useEffect, useState } from 'preact/hooks'
import { findCredit, licenceFileOf } from '../../app/credits.ts'
import { licenceUrl, reflowLicence } from '../../app/licenceText.ts'
import { IconButton, ListRow } from '../components/index.ts'
import { useShell } from '../ShellContext.ts'
import { creditLine } from './CreditsScreen.tsx'

type Text = { state: 'loading' } | { state: 'error' } | { state: 'ready'; paragraphs: string[] }

/**
 * The licence of one component (change paper-and-ink-and-about D6 and D7): its version and licence, its source
 * as a link, the notices its licence asks to be shown, and the licence text. The text is a file in the app's
 * own folder (`public/licences/`), read from the app's own origin, so it needs no network. The screen scrolls as
 * a whole (no scroll area inside it), and the text is reflowed (`reflowLicence`). A file that cannot be read
 * leaves the rest of the screen and one line saying so.
 */
export function LicenceScreen({ screen }: { screen: { componentId: string } }) {
  const { i18n, router } = useShell()
  const { t } = i18n
  const credit = findCredit(screen.componentId)
  const [text, setText] = useState<Text>({ state: 'loading' })

  useEffect(() => {
    if (!credit) return
    let current = true
    setText({ state: 'loading' })
    fetch(licenceUrl(licenceFileOf(credit)))
      .then((response) => (response.ok ? response.text() : Promise.reject(new Error(String(response.status)))))
      .then((body) => current && setText({ state: 'ready', paragraphs: reflowLicence(body) }))
      .catch(() => current && setText({ state: 'error' }))
    return () => {
      current = false
    }
  }, [credit])

  return (
    <div class="screen">
      <div class="screen-topbar">
        <IconButton label={t('common.back')} icon="back" onPress={() => void router.back()} />
      </div>
      <header class="screen-header">
        <h1 class="t-title">{credit?.name ?? t('credits.title')}</h1>
        {credit ? (
          <p class="t-subtitle">
            {credit.version ? `${t('licence.version')} ${creditLine(credit)}` : creditLine(credit)}
            {credit.notOpenSource ? ` · ${t('credits.notOpenSource')}` : ''}
          </p>
        ) : null}
      </header>
      <div class="screen-body">
        {credit ? (
          <>
            <div class="row-stack">
              <ListRow size="compact" title={t('licence.source')} subtitle={credit.source.replace(/^https:\/\//, '')} href={credit.source} chevron />
            </div>
            {credit.notices && credit.notices.length > 0 ? (
              <section class="licence-block">
                <h2 class="t-eyebrow">{t('licence.notices')}</h2>
                <ul class="licence-notes">
                  {credit.notices.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </section>
            ) : null}
            <section class="licence-block">
              <h2 class="t-eyebrow">{t('licence.text')}</h2>
              {text.state === 'error' ? (
                <p class="licence-error" role="alert">
                  {t('licence.error')}
                </p>
              ) : text.state === 'ready' ? (
                <div class="licence-text">
                  {text.paragraphs.map((paragraph, index) => (
                    <p key={index}>{paragraph}</p>
                  ))}
                </div>
              ) : null}
            </section>
          </>
        ) : (
          <p class="licence-error">{t('licence.missing')}</p>
        )}
      </div>
    </div>
  )
}
