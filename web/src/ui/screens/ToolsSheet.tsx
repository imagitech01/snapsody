import { alongOf, partChoices, sameYourPart } from '../../app/parts.ts'
import { ListRow, Sheet, ToggleRow } from '../components/index.ts'
import { useShell } from '../ShellContext.ts'
import { activePractice } from './activePractice.ts'
import { alongName, choiceOf, partTitle } from './partNames.ts'

/**
 * The practice tools (frame 02.4, slimmed down in design D17; spec `app-shell` "Back closes the top layer
 * first"): edit the score and favorite. Everything else the practice screen needs is on the screen
 * itself. Open over the practice screen; the score stays open behind it.
 *
 * A piece with several parts or a two-staff part also has "Your part" (what you play and what plays along), and a piece
 * with a one-staff part "Instrument for this piece" (change parts-and-accompaniment, design D9). Each opens its own
 * sheet in place of these tools; the score stays open behind it.
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
  const open = (sheet: 'part' | 'pieceInstrument'): void => {
    close()
    router.openSheet(sheet)
  }

  // "Melody · piano plays along": your part, and what else sounds with it.
  let partSummary = ''
  if (session.hasPartsRow) {
    const { score } = session
    const yours = session.part.value
    const silent = session.silent.value
    const alone = score.parts.length === 1
    const mine = partChoices(score).find((c) => sameYourPart(c.part, yours)) ?? choiceOf(score, yours, alone)
    const others = alongOf(score, yours).filter((o) => !silent.includes(o.key)).map((o) => alongName(t, o).toLowerCase())
    const name = partTitle(t, mine)
    partSummary = others.length === 0 ? name : t(others.length === 1 ? 'tools.part.summary.one' : 'tools.part.summary.many', { name, others: others.join(' and ') })
  }
  const instrumentSummary = session.instrumentChoice.value === null ? t('tools.instrument.default', { instrument: i18n.instrumentName(session.instrument.id) }) : i18n.instrumentName(session.instrument.id)

  return (
    <Sheet title={t('tools.title')} subtitle={t('tools.subtitle')} closeLabel={t('common.close')} onClose={close}>
      <div class="sheet-rows">
        {session.hasPartsRow ? <ListRow title={t('tools.part')} subtitle={partSummary} chevron onPress={() => open('part')} /> : null}
        {session.hasInstrumentRow ? <ListRow title={t('tools.instrument')} subtitle={instrumentSummary} chevron onPress={() => open('pieceInstrument')} /> : null}
        <ListRow title={t('tools.edit')} subtitle={t('tools.edit.hint')} chevron onPress={() => router.push({ name: 'editor', pieceId })} />
        <ToggleRow title={t('tools.favorite')} description={t('tools.favorite.hint')} checked={favorite} onChange={() => void run(() => view.toggleFavorite(pieceId))} />
      </div>
      <p class="t-caption sheet-foot">{t('tools.foot')}</p>
    </Sheet>
  )
}
