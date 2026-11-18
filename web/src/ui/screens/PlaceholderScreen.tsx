import type { Screen } from '../../app/router.ts'
import { Button } from '../components/index.ts'
import { useShell } from '../ShellContext.ts'

/**
 * Stands in for a screen that is not built yet (practice-app groups 13 to 15): its name, the piece it
 * was opened for, and a Back button. It is replaced entry by entry in `screens/index.tsx`; the texts are
 * existing ones so that it speaks both languages until then.
 */
export function PlaceholderScreen({ screen }: { screen: Screen }) {
  const { i18n, router } = useShell()
  const { t } = i18n
  const heading =
    screen.name === 'add-music' ? t('add.title') : screen.name === 'reading' ? t('add.reading.title') : screen.name === 'editor' ? t('editor.title') : t('tab.practice')
  const pieceId = 'pieceId' in screen ? screen.pieceId : undefined
  return (
    <div class="screen" data-screen={screen.name} data-piece-id={pieceId}>
      <header class="screen-header">
        <p class="t-eyebrow">{t('app.name')}</p>
        <h1 class="t-title">{heading}</h1>
      </header>
      <div class="screen-body">
        <Button variant="secondary" icon="back" onPress={() => void router.back()}>
          {t('common.back')}
        </Button>
      </div>
    </div>
  )
}
