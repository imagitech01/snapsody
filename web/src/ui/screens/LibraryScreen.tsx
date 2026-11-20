import { Button, Card, Icon, IconButton } from '../components/index.ts'
import { useShell } from '../ShellContext.ts'
import { PieceListRow } from './PieceListRow.tsx'

/**
 * The Library tab's start screen (frame 03.1, spec `piece-library`): search, the list of pieces with
 * their star, summary line and (not in the frame) a bin that asks before deleting, the way to the
 * favorites, "Add music", and the invitation when there is no piece. The list and the search are
 * `app/libraryView.ts`: the same store the home and the favorites read.
 */
export function LibraryScreen() {
  const { view, i18n, router, run } = useShell()
  const { t } = i18n
  const rows = view.visible.value
  const query = view.query.value

  const addMusic = (): void => router.push({ name: 'add-music' })

  /** Asks first; the piece and its files go only when the user says yes. */
  const remove = async (id: string, name: string): Promise<void> => {
    const sure = await router.confirm({
      title: t('library.delete.title'),
      message: t('library.delete.body', { name }),
      confirmLabel: t('library.delete.confirm'),
      cancelLabel: t('common.cancel'),
      destructive: true,
    })
    if (sure) await run(() => view.remove(id))
  }

  return (
    <div class="screen screen--tabs">
      <header class="screen-header">
        <h1 class="t-title">{t('library.title')}</h1>
        <p class="t-subtitle">{t('library.subtitle')}</p>
      </header>
      <div class="screen-body">
        {view.isEmpty.value ? (
          <Card label={t('library.empty.title')}>
            <h2 class="invite-title">{t('library.empty.title')}</h2>
            <p class="invite-body">{t('library.empty.body')}</p>
            <div class="invite-action">
              <Button block icon="camera" onPress={addMusic}>
                {t('library.addMusic')}
              </Button>
            </div>
            <p class="t-caption invite-hint">{t('library.addHint')}</p>
          </Card>
        ) : (
          view.loaded.value && (
            <>
              <div class="search-field">
                <Icon name="search" />
                <input
                  type="search"
                  class="search-input"
                  aria-label={t('library.search')}
                  placeholder={t('library.search')}
                  value={query}
                  autocomplete="off"
                  autocapitalize="off"
                  spellcheck={false}
                  onInput={(event) => {
                    view.query.value = event.currentTarget.value
                  }}
                />
                {query !== '' ? <IconButton label={t('library.searchClear')} icon="close" look="quiet" size={44} onPress={() => (view.query.value = '')} /> : null}
              </div>

              <section class="library-section" aria-labelledby="library-section-title">
                <div class="section-head">
                  <h2 id="library-section-title" class="t-section">
                    {t('library.section')}
                  </h2>
                  <Button variant="link" size="small" onPress={() => router.push({ name: 'favorites' })}>
                    {t('library.favorites')}
                  </Button>
                </div>
                {view.noMatch.value ? (
                  <p class="library-empty" role="status">
                    {t('library.noMatch', { query: query.trim() })}
                  </p>
                ) : (
                  <div class="row-stack">
                    {rows.map((row) => (
                      <PieceListRow key={row.info.id} row={row} onDelete={() => void remove(row.info.id, row.info.name)} />
                    ))}
                  </div>
                )}
              </section>

              <div class="library-add">
                <Button block icon="camera" onPress={addMusic}>
                  {t('library.addMusic')}
                </Button>
                <p class="t-caption">{t('library.addHint')}</p>
              </div>
            </>
          )
        )}
        {view.problems.value.map((problem) => (
          <p key={problem.id} class="t-caption library-problem">
            {problem.reason === 'damaged' ? t('library.problem.damaged') : t('library.problem.unsupported')}
          </p>
        ))}
      </div>
    </div>
  )
}
