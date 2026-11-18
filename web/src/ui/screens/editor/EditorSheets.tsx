import { useEffect, useState } from 'preact/hooks'
import type { EditorSession, PagePhoto } from '../../../app/editorSession.ts'
import { Button, Sheet } from '../../components/index.ts'
import { useShell } from '../../ShellContext.ts'

/*
 * The two sheets of the editor. The router keeps whether they are open (`Router.openSheet('pages' | 'goto')`,
 * so back closes them first); the editor draws them, because they need its session.
 */

/**
 * "Pages 1 / 3" (frame 06.1, design D14): the photo of every page, in reading order, each with the bars it
 * gave and a button that takes the editor to the first of them.
 */
export function PagesSheet({ session, onGoTo, onClose }: { session: EditorSession; onGoTo: (bar: number) => void; onClose: () => void }) {
  const { i18n } = useShell()
  const { t } = i18n
  const [photos, setPhotos] = useState<PagePhoto[] | null>(null)
  const pages = session.info.value.pages

  useEffect(() => {
    let live = true
    session.photos().then(
      (found) => live && setPhotos(found),
      () => live && setPhotos([]),
    )
    return () => {
      live = false
    }
  }, [session])

  return (
    <Sheet title={t('editor.pages.title')} closeLabel={t('common.close')} onClose={onClose}>
      <ol class="editor-pages">
        {pages.map((page, index) => {
          const photo = photos?.find((p) => p.page === index + 1)
          return (
            <li key={page.n} class="editor-page">
              <div class="editor-page-head">
                <h3 class="editor-page-title">{t('page.label', { page: index + 1 })}</h3>
                <span class="editor-page-bars">{t('bar.range', { from: page.firstBar, to: page.lastBar })}</span>
              </div>
              {photo ? <img class="editor-page-photo" src={photo.url} alt={t('editor.photo.alt', { page: index + 1 })} /> : <div class="editor-page-photo editor-page-photo--loading" />}
              <Button variant="secondary" size="small" block onPress={() => onGoTo(page.firstBar)}>
                {t('editor.pages.goTo', { bar: page.firstBar })}
              </Button>
            </li>
          )
        })}
      </ol>
    </Sheet>
  )
}

/** "Go to bar…": a bar number, then the editor selects that bar and shows it. */
export function GoToBarSheet({ bars, onGoTo, onClose }: { bars: number; onGoTo: (bar: number) => void; onClose: () => void }) {
  const { i18n } = useShell()
  const { t } = i18n
  const [text, setText] = useState('')
  const [invalid, setInvalid] = useState(false)

  const submit = (): void => {
    const bar = Number(text.trim())
    if (!Number.isInteger(bar) || bar < 1 || bar > bars) {
      setInvalid(true)
      return
    }
    onGoTo(bar)
  }

  return (
    <Sheet title={t('tools.goToBar')} closeLabel={t('common.close')} onClose={onClose}>
      <form
        class="editor-goto"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <input
          class="editor-goto-input"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          aria-label={t('tools.goToBar.input')}
          aria-invalid={invalid}
          value={text}
          onInput={(event) => {
            setText(event.currentTarget.value)
            setInvalid(false)
          }}
        />
        <Button size="large" onPress={submit}>
          {t('tools.goToBar.show')}
        </Button>
      </form>
      {invalid ? (
        <p class="editor-goto-error" role="alert">
          {t('tools.goToBar.invalid', { bars })}
        </p>
      ) : null}
    </Sheet>
  )
}
