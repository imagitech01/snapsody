import { useEffect, useState } from 'preact/hooks'
import { openEditor } from '../../../app/editorSession.ts'
import type { EditorSession } from '../../../app/editorSession.ts'
import { LibraryError } from '../../../app/library.ts'
import type { Screen } from '../../../app/router.ts'
import type { AudioBackend } from '../../../core/playback/player.ts'
import { createWebAudioBackend } from '../../../core/playback/webBackend.ts'
import { Button } from '../../components/index.ts'
import { useShell } from '../../ShellContext.ts'
import { Editor } from './Editor.tsx'

/**
 * The editor screen (frames 06.1 to 06.3, practice-app tasks 15.1 to 15.4): opens the piece into an
 * `EditorSession` when the screen appears and closes it when the screen goes, and draws `Editor` while it
 * is open. The session puts the leave guard on this screen's entry in the router when it opens
 * (`openEditor`), so the screen has to be on top of the stack by then, which it is: this runs when it is
 * drawn.
 *
 * The audio of the bar preview is made on the first press of "Preview bar", inside the tap (a user gesture);
 * every audio backend made is closed with the screen, as the session itself only stops its player.
 */
export function EditorScreen({ screen }: { screen: Extract<Screen, { name: 'editor' }> }) {
  const { library, settings, router, i18n, home } = useShell()
  const { t } = i18n
  const [session, setSession] = useState<EditorSession | null>(null)
  const [problem, setProblem] = useState<'missing' | 'damaged' | null>(null)

  useEffect(() => {
    let leaving = false
    let opened: EditorSession | undefined
    const backends: AudioBackend[] = []
    openEditor(
      {
        library,
        settings,
        router,
        i18n,
        refreshList: () => home.refresh(),
        backend: async (instrument) => {
          const backend = await createWebAudioBackend({ sound: instrument.sound })
          // The screen was left while the sound loaded: nothing will close this one later.
          if (leaving) backend.close?.()
          else backends.push(backend)
          return backend
        },
      },
      screen.pieceId,
    ).then(
      (made) => {
        // The screen was left while the piece loaded: the guard the session put on the stack must not stay.
        if (leaving) made.close()
        else {
          opened = made
          setSession(made)
        }
      },
      (error: unknown) => {
        if (!leaving) setProblem(error instanceof LibraryError && error.code === 'not-found' ? 'missing' : 'damaged')
      },
    )
    return () => {
      leaving = true
      opened?.close()
      for (const backend of backends) backend.close?.()
    }
  }, [screen.pieceId])

  if (session) return <Editor session={session} />
  return (
    <div class="screen editor editor--waiting" data-screen="editor" data-piece-id={screen.pieceId}>
      <header class="screen-header">
        <p class="t-eyebrow">{t('editor.eyebrow')}</p>
        <h1 class="t-title">{t('editor.title')}</h1>
      </header>
      <div class="screen-body">
        {problem ? (
          <>
            <p class="editor-hint" role="alert">
              {problem === 'missing' ? t('error.pieceMissing') : t('error.pieceDamaged')}
            </p>
            <Button variant="secondary" icon="back" onPress={() => void router.back()}>
              {t('common.back')}
            </Button>
          </>
        ) : (
          <p class="editor-hint" role="status">
            {t('editor.loading')}
          </p>
        )}
      </div>
    </div>
  )
}
