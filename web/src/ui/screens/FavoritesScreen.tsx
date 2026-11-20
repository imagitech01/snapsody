import { Card, Icon, IconButton } from '../components/index.ts'
import { useShell } from '../ShellContext.ts'
import { PieceListRow } from './PieceListRow.tsx'

/**
 * The favorites (frame 03.2, spec `piece-library` "Favorites"): the starred pieces in the library's
 * order, each with its star to take it out again. It is opened over the library or the home, so the tab
 * bar is not shown (`Router.tabBarVisible`) and the screen has its own Back button (deviations.md, 03.2).
 */
export function FavoritesScreen() {
  const { view, i18n, router } = useShell()
  const { t } = i18n
  const rows = view.favorites.value

  return (
    <div class="screen">
      <div class="screen-topbar">
        <IconButton label={t('common.back')} icon="back" onPress={() => void router.back()} />
      </div>
      <header class="screen-header">
        <h1 class="t-title">{t('favorites.title')}</h1>
        <p class="t-subtitle">{t('favorites.subtitle')}</p>
      </header>
      <div class="screen-body">
        {view.loaded.value && rows.length === 0 ? (
          <Card tone="muted" label={t('favorites.empty.title')}>
            <h2 class="note-title">{t('favorites.empty.title')}</h2>
            <p class="note-line">{t('favorites.empty.body')}</p>
          </Card>
        ) : (
          <>
            <Card tone="muted" label={t('favorites.note.title')}>
              <div class="note-card">
                <Icon name="star" class="note-icon" />
                <div>
                  <h2 class="note-title">{t('favorites.note.title')}</h2>
                  <p class="note-line">{t('favorites.note.star')}</p>
                  <p class="note-line">{t('favorites.note.repeat')}</p>
                </div>
              </div>
            </Card>
            {rows.length > 0 ? (
              <section class="favorites-section" aria-labelledby="favorites-count">
                <h2 id="favorites-count" class="t-eyebrow">
                  {t('favorites.count', { count: rows.length })}
                </h2>
                <div class="row-stack">
                  {rows.map((row) => (
                    <PieceListRow key={row.info.id} row={row} />
                  ))}
                </div>
                <p class="t-caption favorites-tip">{t('favorites.tip')}</p>
              </section>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}
