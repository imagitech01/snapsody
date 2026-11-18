import { useEffect, useState } from 'preact/hooks'
import type { EditorSession } from '../../../app/editorSession.ts'
import { Icon } from '../../components/index.ts'
import { useShell } from '../../ShellContext.ts'
import { stripLayout, stripRegion } from './photoRegion.ts'

/**
 * The photo beside the selected bar (frame 06.1's "Original photo comparison", spec `score-editing`
 * "Original beside the selected bar", design D7 and D14): the staff of the page photo that holds the
 * bar, with a margin, labelled "Photo 1 · Bar 3"; the whole photo of the page when the position of the
 * bar on it is not known; and "Preview bar 3" on top of it, which plays that bar alone.
 *
 * The strip shows the staff, not the bar itself: the reader reports where each staff is, not each bar.
 */
export function PhotoStrip({ session, onPreview }: { session: EditorSession; onPreview: () => void }) {
  const { i18n } = useShell()
  const { t } = i18n
  const view = session.photo.value
  const previewing = session.previewing.value
  const [url, setUrl] = useState<string | null>(null)
  /** The photo's size in pixels, known when it has loaded: the crop's proportions follow it. */
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  const n = view?.n

  useEffect(() => {
    setUrl(null)
    setSize(null)
    if (!view) return
    let live = true
    session.photoUrl(view).then(
      (found) => live && setUrl(found),
      () => live && setUrl(null),
    )
    return () => {
      live = false
    }
    // The photo is the page's: another bar on the same page keeps the picture.
  }, [session, n])

  if (!view) {
    return (
      <section class="editor-photo editor-photo--empty" aria-label={t('editor.photo.none')}>
        <p class="editor-hint">{t('editor.photo.none')}</p>
      </section>
    )
  }

  const region = view.box ? stripRegion(view.box) : null
  const layout = region ? stripLayout(region, size?.width ?? 5, size?.height ?? 1) : null
  const label = t('editor.photo', { page: view.page, bar: view.bar })
  const alt = t('editor.photo.alt', { page: view.page })

  return (
    <section class="editor-photo" aria-label={label}>
      {url && layout && region ? (
        <div class="editor-photo-crop" style={{ '--aspect': size ? layout.aspect : 5 }}>
          <img
            src={url}
            alt={alt}
            style={{ width: `${layout.width}%`, height: `${layout.height}%`, left: `${layout.left}%`, top: `${layout.top}%` }}
            onLoad={(event) => setSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
          />
        </div>
      ) : url ? (
        <img class="editor-photo-whole" src={url} alt={alt} />
      ) : null}
      <p class="editor-photo-label">{label}</p>
      <button type="button" class="editor-photo-preview" onClick={onPreview}>
        <Icon name={previewing ? 'pause' : 'play'} size={14} />
        <span>{previewing ? t('editor.preview.stop') : t('editor.preview', { bar: view.bar })}</span>
      </button>
    </section>
  )
}
