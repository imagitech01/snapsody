import { useEffect, useId, useLayoutEffect, useRef, useState } from 'preact/hooks'
import type { BarPhoto } from '../../../app/editorRules.ts'
import type { EditorSession } from '../../../app/editorSession.ts'
import { IconButton } from '../../components/index.ts'
import { useDialogFocus } from '../../components/dialogFocus.ts'
import { useShell } from '../../ShellContext.ts'
import { gestureView, lineRegion, startView, stripLayout, zoomAt } from './photoView.ts'
import type { Point, Size, View } from './photoView.ts'

/*
 * The photo line (change redesign-score-editor, design D10 and D13; spec "Line from the photo"): the line of the page
 * photo that holds the current bar, the session's `photo`.
 *
 * - `PhotoStrip` is the line above the overview: 44 px high (design D13 says 40; a control is at least 44), the line with its margin across the width, a little "Page 1"
 *   in its corner; the whole page, small, when the place of the line is not known. A tap opens it large. It keeps its
 *   height while the picture loads and when it cannot be shown, so the frame does not move.
 * - In a two-staff part, or when the frame has no room for the line (`frameLayout`), the "Photo" key of the title row
 *   opens it instead (the editor draws that key).
 * - `PhotoLarge` shows it over the editor: it opens on the line, larger than across the width and from its left edge (the
 *   whole page when the line is not known), with the line marked; two fingers zoom, one moves, the wheel zooms in a browser (`photoView.ts` has
 *   the maths). Close and the back button close it (the session's `confirmLeave`).
 */

/** The picture of the photo's page: its URL, null while it loads, or 'failed'. Loaded again only when the page changes. */
export function usePhotoUrl(session: EditorSession, photo: BarPhoto | null): string | null | 'failed' {
  const [url, setUrl] = useState<string | null | 'failed'>(null)
  const n = photo?.n
  useEffect(() => {
    setUrl(null)
    if (!photo) return
    let live = true
    session.photoUrl(photo).then(
      (found) => live && setUrl(found),
      () => live && setUrl('failed'),
    )
    return () => {
      live = false
    }
    // The picture is the page's: another bar of the same page keeps it.
  }, [session, n])
  return url
}

/** The label of the photo line and of the "Photo" key: "Photo of bar 6, page 1". */
export function photoLabel(t: ReturnType<typeof useShell>['i18n']['t'], photo: BarPhoto, bar: number): string {
  return t('editor.photo.open', { bar, page: photo.page })
}

export function PhotoStrip({ photo, url, bar, onOpen }: { photo: BarPhoto; url: string | null | 'failed'; bar: number; onOpen: () => void }) {
  const { t } = useShell().i18n
  const [broken, setBroken] = useState<string | null>(null)
  const shown = url !== null && url !== 'failed' && url !== broken ? url : null
  const layout = photo.box ? stripLayout(lineRegion(photo.box)) : null
  return (
    <button type="button" class="editor-photo-line" data-page={photo.page} aria-label={photoLabel(t, photo, bar)} onClick={onOpen}>
      {shown && layout ? (
        <img
          class="editor-photo-crop"
          src={shown}
          alt=""
          draggable={false}
          style={{ width: `${layout.width}%`, left: `${layout.left}%`, transform: `translateY(-${layout.up}%)` }}
          onError={() => setBroken(shown)}
        />
      ) : shown ? (
        <img class="editor-photo-page" src={shown} alt="" draggable={false} onError={() => setBroken(shown)} />
      ) : null}
      <span class="editor-photo-chip">{t('editor.photo.page', { page: photo.page })}</span>
    </button>
  )
}

/** How much one notch of the wheel zooms (a browser on a computer; on the phone the fingers do it). */
const WHEEL_ZOOM = 0.002

export function PhotoLarge({ photo, url, onClose }: { photo: BarPhoto; url: string | null | 'failed'; onClose: () => void }) {
  const { t } = useShell().i18n
  const titleId = useId()
  const dialog = useRef<HTMLDivElement>(null)
  const area = useRef<HTMLDivElement>(null)
  useDialogFocus(dialog)
  const [viewport, setViewport] = useState<Size | null>(null)
  const [natural, setNatural] = useState<Size | null>(null)
  const [view, setView] = useState<View | null>(null)
  const [broken, setBroken] = useState(false)
  /** The view as last drawn, for the gestures, which read it between renders. */
  const current = useRef<View | null>(null)
  current.current = view
  /** The fingers (or the mouse) on the photo, by pointer, in pixels of the view. */
  const pointers = useRef(new Map<number, Point>())
  /** The gesture going on: the view and the fingers when it began. Every finger put down or lifted begins a new one. */
  const gesture = useRef<{ start: View; from: Point[] } | null>(null)

  useLayoutEffect(() => {
    const element = area.current
    if (!element) return
    const measure = (): void => {
      const size = { width: element.clientWidth, height: element.clientHeight }
      setViewport((now) => (now && now.width === size.width && now.height === size.height ? now : size))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // It opens on the line; a new size of the view (the phone turned) opens it again.
  const box = photo.box
  useEffect(() => {
    if (!viewport || !natural) return
    setView(startView(viewport, natural, box ? lineRegion(box) : null))
    gesture.current = null
  }, [viewport, natural, photo.n, box?.x, box?.y, box?.width, box?.height])

  const at = (event: { clientX: number; clientY: number }): Point => {
    const rect = area.current!.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }
  const restart = (): void => {
    const now = current.current
    gesture.current = now && pointers.current.size > 0 ? { start: now, from: [...pointers.current.values()] } : null
  }
  const lift = (event: PointerEvent): void => {
    if (!pointers.current.delete(event.pointerId)) return
    restart()
  }

  const shown = url !== null && url !== 'failed' && !broken ? url : null
  const region = box ? lineRegion(box) : null
  const title = box ? (photo.firstBar === photo.lastBar ? t('editor.photo.bar', { bar: photo.firstBar }) : t('editor.photo.bars', { first: photo.firstBar, last: photo.lastBar })) : t('editor.photo.whole', { page: photo.page })

  return (
    <div ref={dialog} class="editor-photo-large" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
      <div class="editor-photo-head">
        <h2 id={titleId} class="editor-photo-title">
          {title}
        </h2>
        <IconButton label={t('common.close')} icon="close" look="plain" onPress={onClose} />
      </div>
      <div
        ref={area}
        class="editor-photo-zoom"
        data-scale={view ? view.scale.toFixed(4) : undefined}
        onPointerDown={(event) => {
          if (!view) return
          event.currentTarget.setPointerCapture(event.pointerId)
          pointers.current.set(event.pointerId, at(event))
          restart()
        }}
        onPointerMove={(event) => {
          if (!pointers.current.has(event.pointerId)) return
          pointers.current.set(event.pointerId, at(event))
          const going = gesture.current
          if (!going || !viewport || !natural) return
          setView(gestureView(going.start, going.from, [...pointers.current.values()], viewport, natural))
        }}
        onPointerUp={lift}
        onPointerCancel={lift}
        onWheel={(event) => {
          const now = current.current
          if (!now || !viewport || !natural) return
          event.preventDefault()
          setView(zoomAt(now, at(event), Math.exp(-event.deltaY * WHEEL_ZOOM), viewport, natural))
          restart()
        }}
      >
        {shown ? (
          <img
            class="editor-photo-picture"
            src={shown}
            alt={t('editor.photo.alt', { page: photo.page })}
            draggable={false}
            style={
              view && natural
                ? { width: `${natural.width}px`, height: `${natural.height}px`, transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }
                : { visibility: 'hidden' }
            }
            onLoad={(event) => setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
            onError={() => setBroken(true)}
          />
        ) : url === null && !broken ? null : (
          <p class="editor-photo-missing" role="status">
            {t('editor.photo.missing')}
          </p>
        )}
        {/* The line of the current bar is marked: around it is the rest of the page. */}
        {shown && view && natural && region ? (
          <div
            class="editor-photo-mark"
            aria-hidden="true"
            style={{
              left: `${view.x + region.x * natural.width * view.scale}px`,
              top: `${view.y + region.y * natural.height * view.scale}px`,
              width: `${region.width * natural.width * view.scale}px`,
              height: `${region.height * natural.height * view.scale}px`,
            }}
          />
        ) : null}
      </div>
      <p class="editor-photo-hint">{t('editor.photo.hint')}</p>
    </div>
  )
}
