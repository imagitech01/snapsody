import { Button, Card, IconButton, ListRow } from '../components/index.ts'
import { useShell } from '../ShellContext.ts'

/**
 * The Practice tab's start screen (frame 01, spec `practice-home`): the card that continues the last
 * piece, the rotation of favorites, the shortcuts to the library and to adding music, and, while there is
 * no piece at all, the invitation to add the first one. What it shows is derived in `app/home.ts`.
 */
export function HomeScreen() {
  const { home, i18n, router } = useShell()
  const { t } = i18n
  const first = home.firstLaunch.value
  const card = home.continueCard.value
  const rotation = home.rotation.value

  const addMusic = (): void => router.push({ name: 'add-music' })

  return (
    <div class="screen screen--tabs">
      <header class="screen-header">
        <p class="t-eyebrow">{t('app.name')}</p>
        <h1 class="t-title">{t('home.title')}</h1>
        {first ? null : <p class="t-subtitle">{card ? t('home.subtitle') : t('home.subtitle.pick')}</p>}
      </header>
      <div class="screen-body">
        {first ? (
          <Card label={t('home.first.title')}>
            <h2 class="invite-title">{t('home.first.title')}</h2>
            <p class="invite-body">{t('home.first.body')}</p>
            <div class="invite-action">
              <Button block icon="camera" onPress={addMusic}>
                {t('home.addMusic')}
              </Button>
            </div>
          </Card>
        ) : (
          <>
            {card ? (
              <Card tone="dark" label={t('home.continue.title')}>
                <p class="continue-eyebrow">{t('home.continue.title')}</p>
                <h2 class="continue-title">{card.piece.name}</h2>
                <p class="continue-meta">
                  {t('bar.position', { bar: card.bar, bars: card.bars })} · {t('unit.bpm', { count: card.tempo })}
                </p>
                <p class="continue-note">
                  {card.metronome ? t('practice.metronomeOn') : t('practice.metronomeOff')} ·{' '}
                  {card.loop ? t('practice.loopOn', { from: card.loop.start, to: card.loop.end }) : t('practice.loopOff')}
                </p>
                <div class="continue-action">
                  <Button variant="light" block onPress={() => router.push({ name: 'practice', pieceId: card.piece.id })}>
                    {t('home.continue.action')}
                  </Button>
                </div>
              </Card>
            ) : null}

            <section class="home-rotation" aria-labelledby="rotation-title">
              <div class="section-head">
                <h2 id="rotation-title" class="t-section">
                  {t('home.rotation.title')}
                </h2>
                {rotation.length > 0 ? (
                  <Button variant="link" size="small" onPress={() => router.push({ name: 'favorites' })}>
                    {t('home.rotation.all')}
                  </Button>
                ) : null}
              </div>
              {rotation.length > 0 ? (
                <div class="row-stack">
                  {rotation.map((row) => (
                    <ListRow
                      key={row.info.id}
                      size="large"
                      title={row.info.name}
                      subtitle={row.length}
                      onPress={() => router.push({ name: 'practice', pieceId: row.info.id })}
                      trailing={
                        <IconButton
                          label={t('home.rotation.play', { name: row.info.name })}
                          icon="play"
                          look="accent"
                          round
                          size={46}
                          onPress={() => router.push({ name: 'practice', pieceId: row.info.id, autoplay: true })}
                        />
                      }
                    />
                  ))}
                </div>
              ) : (
                <p class="t-caption">{t('home.rotation.empty')}</p>
              )}
            </section>

            <div class="home-actions">
              <Button variant="link" size="large" onPress={() => router.selectTab('library')}>
                {t('home.browse')}
                <span aria-hidden="true"> →</span>
              </Button>
              <Button variant="secondary" onPress={addMusic}>
                <span aria-hidden="true">+ </span>
                {t('home.addMusic')}
              </Button>
            </div>
            <p class="t-caption home-footnote">{t('home.footnote')}</p>
          </>
        )}
      </div>
    </div>
  )
}
