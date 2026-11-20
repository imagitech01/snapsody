import { alongOf, partChoices, sameYourPart } from '../../app/parts.ts'
import { visibleInstruments } from '../../core/instruments/instruments.ts'
import { ListRow, Sheet, ToggleRow } from '../components/index.ts'
import { useShell } from '../ShellContext.ts'
import { activePractice, soundProblem } from './activePractice.ts'
import { alongName, partSubtitle, partTitle } from './partNames.ts'

/*
 * The two lists behind the Practice tools rows of a piece with parts (change parts-and-accompaniment, design D9; the agreed mock):
 * "Your part" (what you play, and under it what plays along) and "Instrument for this piece". Both read the open practice
 * session; a choice is saved with the piece at once.
 */

/** Your part: a radio per part (and per hand of a two-staff part), then "Plays along" with a switch for each other part or hand. */
export function PartSheet() {
  const { router, i18n } = useShell()
  const { t } = i18n
  const session = activePractice.value
  if (!session) return null
  const { score } = session
  const yours = session.part.value
  const silent = session.silent.value
  const along = alongOf(score, yours)
  const twoStaves = score.parts.find((p) => p.id === yours.id)?.staves === 2
  const close = (): void => router.closeSheet('part')
  return (
    <Sheet title={t('part.title')} subtitle={t('part.subtitle')} closeLabel={t('common.close')} onClose={close}>
      <div class="row-stack" role="radiogroup" aria-label={t('part.title')}>
        {partChoices(score).map((choice) => (
          <ListRow
            key={`${choice.part.id}:${choice.part.hand ?? ''}`}
            size="compact"
            title={partTitle(t, choice)}
            subtitle={partSubtitle(t, choice)}
            selected={sameYourPart(choice.part, yours)}
            onPress={() => session.setPart(choice.part)}
          />
        ))}
      </div>
      <h3 class="sheet-heading t-section">{t('part.along')}</h3>
      {along.length > 0 ? (
        <div class="sheet-rows">
          {along.map((other) => {
            const on = !silent.includes(other.key)
            return <ToggleRow key={other.key} title={alongName(t, other)} description={on ? t('part.along.on') : t('part.along.off')} checked={on} onChange={(next) => session.setPlaysAlong(other.key, next)} />
          })}
        </div>
      ) : (
        <p class="t-caption">{t('part.along.none')}</p>
      )}
      <p class="t-caption sheet-foot">{twoStaves ? t('part.foot.staves') : t('part.foot.line')}</p>
    </Sheet>
  )
}

/** Instrument for this piece: "Your default" first (it follows Settings), then the instruments; a pick is saved and closes the sheet. */
export function PieceInstrumentSheet() {
  const { router, i18n, settings } = useShell()
  const { t } = i18n
  const session = activePractice.value
  if (!session) return null
  const chosen = session.instrumentChoice.value
  const hasPiano = session.score.parts.some((p) => p.staves === 2)
  const close = (): void => router.closeSheet('pieceInstrument')
  const pick = (id: string | null): void => {
    close()
    soundProblem.value = false
    void session.setPieceInstrument(id).catch(() => (soundProblem.value = true))
  }
  const defaultName = i18n.instrumentName(settings.defaultInstrument.value)
  return (
    <Sheet title={t('pieceInstrument.title')} subtitle={t('pieceInstrument.subtitle')} closeLabel={t('common.close')} onClose={close}>
      <div class="row-stack" role="radiogroup" aria-label={t('pieceInstrument.title')}>
        <ListRow size="compact" title={t('pieceInstrument.default')} subtitle={defaultName} selected={chosen === null} onPress={() => pick(null)} />
        {visibleInstruments().map((item) => (
          <ListRow key={item.id} size="compact" title={i18n.instrumentName(item.id)} subtitle={i18n.familyName(item.family)} selected={chosen === item.id} onPress={() => pick(item.id)} />
        ))}
      </div>
      {hasPiano ? <p class="t-caption sheet-foot">{t('pieceInstrument.foot')}</p> : null}
    </Sheet>
  )
}
