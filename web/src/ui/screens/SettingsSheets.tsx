import type { Language } from '../../app/settings.ts'
import { visibleInstruments } from '../../core/instruments/instruments.ts'
import { ListRow, Sheet } from '../components/index.ts'
import { useShell } from '../ShellContext.ts'

/**
 * The two lists behind Settings' one-line rows (design D19): the default instrument and the language,
 * each as a radiogroup in a sheet. Picking a row saves it at once and closes the sheet; Close, a tap on
 * the scrim and the back button leave the choice as it was.
 */

export function InstrumentSheet() {
  const { settings, i18n, router, run } = useShell()
  const { t } = i18n
  const chosen = settings.defaultInstrument.value
  const close = (): void => router.closeSheet('instrument')
  return (
    <Sheet title={t('settings.instrument')} closeLabel={t('common.close')} onClose={close}>
      <div class="row-stack" role="radiogroup" aria-label={t('settings.instrument')}>
        {visibleInstruments().map((item) => (
          <ListRow
            key={item.id}
            size="compact"
            title={i18n.instrumentName(item.id)}
            subtitle={i18n.familyName(item.family)}
            selected={chosen === item.id}
            onPress={() => {
              close()
              void run(() => settings.setDefaultInstrument(item.id), 'settings.saveFailed')
            }}
          />
        ))}
      </div>
    </Sheet>
  )
}

export function LanguageSheet() {
  const { settings, i18n, router, run } = useShell()
  const { t } = i18n
  const chosen = settings.language.value
  const close = (): void => router.closeSheet('language')
  const options: readonly { value: Language | null; title: string }[] = [
    { value: null, title: t('settings.language.deviceIs', { language: t(`language.${i18n.deviceLanguage}`) }) },
    { value: 'en', title: t('language.en') },
    { value: 'nl', title: t('language.nl') },
  ]
  return (
    <Sheet title={t('settings.language')} closeLabel={t('common.close')} onClose={close}>
      <div class="row-stack" role="radiogroup" aria-label={t('settings.language')}>
        {options.map((item) => (
          <ListRow
            key={item.value ?? 'device'}
            size="compact"
            title={item.title}
            selected={chosen === item.value}
            onPress={() => {
              close()
              void run(() => settings.setLanguage(item.value), 'settings.saveFailed')
            }}
          />
        ))}
      </div>
    </Sheet>
  )
}
