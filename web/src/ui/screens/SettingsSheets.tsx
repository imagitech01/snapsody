import { visibleInstruments } from '../../core/instruments/instruments.ts'
import { ListRow, Sheet } from '../components/index.ts'
import { useShell } from '../ShellContext.ts'

/**
 * The list behind Settings' one-line row (design D19): the default instrument,
 * as a radiogroup in a sheet. Picking a row saves it at once and closes the sheet; Close, a tap on
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
