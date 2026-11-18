import { ListRow, Sheet, ToggleRow } from '../components/index.ts'
import { useShell } from '../ShellContext.ts'
import { activePractice } from './activePractice.ts'

/**
 * The practice tools (frame 02.4, slimmed down in design D17; spec `app-shell` "Back closes the top layer
 * first"): edit the score and favorite. Everything else the practice screen needs is on the screen
 * itself. Open over the practice screen; the score stays open behind it.
 *
 * Not here any more (D17): "Go to bar" (scrolling the score shows any bar, and "Return to playing" comes
 * back), the instrument and the count-in (general settings, in Settings only) and "Follow playback" (the
 * view always follows).
 */
export function ToolsSheet() {
  const { router, i18n, view, run } = useShell()
  const { t } = i18n
  const session = activePractice.value
  if (!session) return null

  const pieceId = session.piece.id
  const favorite = view.pieces.value.find((p) => p.id === pieceId)?.favorite ?? session.piece.favorite
  const close = (): void => router.closeSheet('tools')

  return (
    <Sheet title={t('tools.title')} subtitle={t('tools.subtitle')} closeLabel={t('common.close')} onClose={close}>
      <div class="sheet-rows">
        <ListRow title={t('tools.edit')} subtitle={t('tools.edit.hint')} chevron onPress={() => router.push({ name: 'editor', pieceId })} />
        <ToggleRow title={t('tools.favorite')} description={t('tools.favorite.hint')} checked={favorite} onChange={() => void run(() => view.toggleFavorite(pieceId))} />
      </div>
      <p class="t-caption sheet-foot">{t('tools.foot')}</p>
    </Sheet>
  )
}
