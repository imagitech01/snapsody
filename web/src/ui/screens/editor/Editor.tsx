import { computed, signal } from '@preact/signals'
import { useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { EditorSession, ToolsTab } from '../../../app/editorSession.ts'
import type { EditorView } from '../../../app/settings.ts'
import { isSpanMark } from '../../../app/editorRules.ts'
import { EditError } from '../../../core/score/edit.ts'
import type { ElementRef } from '../../../core/score/elements.ts'
import type { LineBars } from '../../../core/score/lines.ts'
import { isNote } from '../../../core/score/model.ts'
import type { MeasureItem, Note, Score } from '../../../core/score/model.ts'
import { voiceView, voices } from '../../../core/score/model.ts'
import { Button, IconButton, SegmentedControl } from '../../components/index.ts'
import { useShell } from '../../ShellContext.ts'
import { BarSurface } from './BarSurface.tsx'
import { ElementPanel } from './ElementPanel.tsx'
import { GridSurface } from './GridSurface.tsx'
import { frameLayout } from './frame.ts'
import type { FrameLayout } from './frame.ts'
import { BarsTray } from './BarsTray.tsx'
import { MarksTray } from './MarksTray.tsx'
import type { Failure, FailureKey } from './NoteTab.tsx'
import { NotesTray } from './NotesTray.tsx'
import { Overview } from './Overview.tsx'
import { ScoreTab } from './ScoreTab.tsx'

/**
 * The editor of a piece: one bar at a time (change redesign-score-editor, design D1, D13 and D14; spec `score-editing` "One
 * bar at a time", "Go to another bar", "Full score"). What it does is `EditorSession`'s (`app/editorSession.ts`): the
 * current bar, the tools tab, the view, "Full score" and the message are session state, and this draws them. From top to
 * bottom:
 *
 * 1. The header: Back, the title (with "Name this piece" for a new piece) and the "Full score" key; under it the check chip
 *    ("2 to check · Next", with a key for the one before), Preview bar, Undo and Redo.
 * 2. The part switch, where the piece has more than one part (change edit-parts, D1).
 * 3. The overview: the line of music that holds the current bar, or its bar numbers when the screen is too low (`Overview`).
 * 4. The bar row: previous, "Bar 3 of 12" with the beats chip ("3½ of 4 beats", green when it adds up), next, and the
 *    Notes | Grid switch.
 * 5. One row for what the editor has to say (design D13): the notice of a slur, tie or hairpin that waits for its last
 *    note, with Cancel (design D14), which says a refused change in its place until the next action; else a refused
 *    change; else, for a bar that does not add up, the suggested repairs as chips ("Did you mean E4 (1) → dotted
 *    quarter", design D6, task 9.3); else what the bar's warning says.
 * 6. The large bar: in Notes `BarSurface` (a tap selects a note or an element or adds a note, a drag changes a pitch),
 *    in Grid `GridSurface` (the voice as blocks: a tap on a cell adds a note, a block is dragged to move it, change its
 *    pitch or by its end its length, and the loudness strip under it). Both show the same bar and the same selection,
 *    which are the session's, so switching keeps them (spec "Notes and Grid views").
 * 7. The tools: the tabs Notes · Marks · Bars · Score and the tray of the open one, with the selection and the selected
 *    element (`ElementPanel`) at its top. Notes is the Notes tray (`NotesTray`), Marks the Marks tray (`MarksTray`) and
 *    Bars the Bars tray (`BarsTray`), with the scissors in the large bar: a tap on one adds a bar line there (task 9.2).
 *    With the Marks tools open the line at the top of the tray says what to do next: tap a note or a mark, tap the notes
 *    that get the armed mark, or tap the first note of the armed slur; with the Bars tools open, how the scissors work.
 * 8. Save & practice.
 *
 * Design D13: the screen does not scroll; every row but the large bar has its own height, the tray three rows of keys
 * (it scrolls inside itself), and the large bar gets what is left, at least 170 px. When that does not fit, the overview
 * becomes bar numbers (`frameLayout`, measured after every layout). A screen too low for even that (a phone on its side)
 * scrolls as a whole.
 *
 * "Full score" (design D1) shows the whole part in place of everything between the header and Save & practice; a tap in a
 * bar picks it, "Back to bar N" and the back button go back without picking (the session's leave guard closes it first).
 * The notice of a waiting span stays above it, and its first note is marked as picked there as in the overview.
 *
 * Marks (tasks 7.1, 7.2, 7.5): a tap on a note is the session's `tapNote` (it selects, or paints the armed mark, or takes
 * the first or last note of the armed span); with a mark armed, a tap on an element or on nothing does nothing. What only
 * the screen keeps: why the last change of today's Bars and Score tools did not happen, or that a slide ended on no
 * note. Naming a new piece (spec `piece-library` "Default name"): while the session is
 * `naming`, the title is tinted with the caption "Name this piece", and its first focus selects the date name, so typing
 * replaces it; nothing focuses it by itself. Leaving: the header's Back and the back button ask the router, whose leave
 * guard (the session's) asks the discard question while there are unsaved edits. "Add pages", in the Score tray, opens the
 * add-music screen over this one, which removes this screen, so it asks to save first.
 */

/** What failed to save, as the text the user reads. */
const SAVE_ERROR = {
  'empty-name': 'editor.nameEmpty',
  conflict: 'editor.saveConflict',
  failed: 'editor.saveFailed',
} as const satisfies Readonly<Record<'empty-name' | 'conflict' | 'failed', 'editor.nameEmpty' | 'editor.saveConflict' | 'editor.saveFailed'>>

/** A note or rest that is drawn: a hidden rest (a `<forward>`) is not there to select or count. */
const isShown = (item: MeasureItem): item is Note => isNote(item) && !item.hidden

export function Editor({ session }: { session: EditorSession }) {
  const { router, i18n } = useShell()
  const { t } = i18n
  /** Why the last change of today's tools did not happen: a fixed text, or one already made from the refusal. */
  const [message, setMessage] = useState<FailureKey | 'mark.error.slide' | 'grid.error.strip' | { text: string } | null>(null)
  const [saveError, setSaveError] = useState<'empty-name' | 'conflict' | 'failed' | null>(null)
  const [layout, setLayout] = useState<FrameLayout>({ overview: 'line', scroll: false })
  const frame = useRef<HTMLDivElement>(null)
  /** The title has not had its first focus yet; and that focus selected the date name, which the press's own mouseup must not undo. */
  const firstFocus = useRef(true)
  const keepSelection = useRef(false)

  // What the overview's island follows. One set per session: new signal objects would mount the island again.
  const island = useMemo(() => {
    const flagged = computed(() => session.warnings.value.flatMap((w) => (w.noteId ? [w.noteId] : [])))
    // A bar that does not add up is marked on the notes of the voice it is about, in the part shown.
    const flaggedBars = computed(() => {
      const score = session.score.value
      const part = session.part.value
      return session.warnings.value
        .filter((w) => !w.noteId && w.bar !== undefined && (w.part ?? part) === part)
        .flatMap((w) => {
          const refs = w.staff !== undefined && w.voice !== undefined ? [{ part, staff: w.staff, voice: w.voice }] : voices(score).filter((r) => r.part === part)
          return refs.flatMap((ref) => voiceView(score, ref).measures.filter((m) => m.number === w.bar).flatMap((m) => m.items.filter(isShown).map((n) => n.id)))
        })
    })
    return {
      bar: session.currentBar,
      /** The line of the current bar, or the whole part for "Full score". */
      line: computed(() => (session.fullScore.value ? null : session.currentBar.value)),
      following: signal(false),
      shownBar: signal<number | null>(null),
      playing: signal(false),
      selected: computed(() => {
        const id = session.selection.value?.noteId
        return id ? [id] : []
      }),
      /** The first note of a span that waits for its last note (design D14). */
      picked: computed(() => {
        const id = session.pending.value?.from
        return id ? [id] : []
      }),
      flagged,
      flaggedBars,
      /** The lines of the drawing, as the island last laid them out. */
      lines: signal<readonly LineBars[]>([]),
    }
  }, [session])

  const score = session.score.value
  const current = session.currentBar.value
  const barCount = session.barCount.value
  const tools = session.tools.value
  const full = session.fullScore.value
  const view = session.view.value
  const warningCount = session.warningCount.value

  // Design D13, measured after every render and whenever a part of the frame changes size.
  useLayoutEffect(() => {
    const root = frame.current
    if (!root) return
    const measure = (): void => {
      if (session.fullScore.peek()) return
      const overview = root.querySelector<HTMLElement>('.editor-overview')
      const row = overview?.querySelector<HTMLElement>('.editor-overview-row')
      const line = overview?.querySelector<HTMLElement>('.score-island')
      const surface = root.querySelector<HTMLElement>('.editor-surface')
      if (!overview || !row || !line || !surface) return
      const chrome = overview.offsetHeight - row.offsetHeight
      const rowMin = row.querySelector<HTMLElement>('.icon-button')?.offsetHeight ?? 0
      const next = frameLayout({
        screen: root.clientHeight,
        fixed: root.scrollHeight - overview.offsetHeight - surface.offsetHeight,
        line: Math.max(line.offsetHeight, rowMin) + chrome,
        numbers: rowMin + chrome,
      })
      setLayout((now) => (now.overview === next.overview && now.scroll === next.scroll ? now : next))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(root)
    for (const child of root.children) observer.observe(child)
    const line = root.querySelector('.editor-overview .score-island')
    if (line) observer.observe(line)
    return () => observer.disconnect()
  })

  /** Runs an edit of today's tools as one undo step (or as part of the last, `amend`); an edit that cannot be done says why and changes nothing. */
  const run = (edit: (score: Score) => unknown, failure: Failure = 'editor.error.edit', options: { amend?: boolean } = {}): void => {
    try {
      session.apply(edit, options)
      setMessage(null)
      setSaveError(null)
    } catch (error) {
      if (!(error instanceof EditError)) throw error
      setMessage(typeof failure === 'function' ? { text: failure(error) } : failure)
    }
  }

  const quiet = (): void => {
    setMessage(null)
    session.clearMessage()
  }

  /** Makes a bar current (the overview, the line arrows, previous and next); the notes a mark waits for are kept. */
  const goTo = (bar: number): void => {
    quiet()
    session.goToBar(bar)
  }

  /** A tap on a note: it is selected, or it gets the armed mark, or it is the first or last note of the armed span (the session's `tapNote`). */
  const tapNote = (id: string): void => {
    quiet()
    session.tapNote(id)
  }

  /**
   * A tap in the large bar that found an element, or (undefined) nothing: an element is selected and shown in its panel; a
   * bar line makes its bar current and opens the Bars tools (spec "Remove a bar line", "From the bar line itself"); an empty
   * tap puts away the element or the note, keeping the bar, so that the Notes tools set what a tap adds again (spec "Notes
   * tools"). While a mark is armed, only notes count.
   */
  const tapElement = (ref: ElementRef | undefined): void => {
    if (session.armed.peek() !== null) return
    quiet()
    if (!ref) {
      if (session.selectedElement.peek() || session.selectedNote.peek()) session.selectBar(session.currentBar.peek())
      return
    }
    if (!session.selectElement(ref)) return
    if (ref.kind === 'barline') session.openTools('bars')
  }

  /** A tap on a scissors mark of the Bars tools (task 9.2): a bar line before that note, or the reason it cannot go there. */
  const cut = (noteId: string): void => {
    quiet()
    session.addBarLineBefore(noteId)
  }

  /** The part switch (change edit-parts, D1): another part is drawn, and the selection and a span waiting for a note of the other part go. */
  const switchPart = (id: string): void => {
    quiet()
    session.setPart(id)
  }

  /** Another tools tab: the Notes and Bars tools disarm the armed mark and end a waiting span (the session's). */
  const chooseTab = (next: ToolsTab): void => {
    session.openTools(next)
    setMessage(null)
  }

  const warn = (direction: 'next' | 'previous'): void => {
    quiet()
    const warning = direction === 'next' ? session.nextWarning() : session.previousWarning()
    if (!warning) return
    // A warning about the time signature is about the whole piece: show the tools where it is changed.
    if (warning.kind === 'time-signature-inferred' || warning.kind === 'time-signature-missing') {
      chooseTab('score')
      session.goToBar(1)
    }
  }

  const preview = async (): Promise<void> => {
    if (session.previewing.value) {
      session.stopPreview()
      return
    }
    quiet()
    try {
      await session.previewBar()
    } catch {
      setMessage('practice.error.sound')
    }
  }

  const savePieceAndPractice = async (): Promise<void> => {
    setSaveError(null)
    const result = await session.saveAndPractice()
    if (!result.ok) setSaveError(result.reason)
  }

  const addPages = async (): Promise<void> => {
    setSaveError(null)
    if (session.dirty.value) {
      const save = await router.confirm({
        title: t('editor.addPages.title'),
        message: t('editor.addPages.body'),
        confirmLabel: t('editor.addPages.confirm'),
        cancelLabel: t('common.cancel'),
      })
      if (!save) return
      const result = await session.save()
      if (!result.ok) {
        setSaveError(result.reason)
        return
      }
    }
    // Back from adding pages opens this entry again: once the piece is named, it must not ask for a name again.
    const top = router.screen.peek()
    if (top.name === 'editor' && top.isNew && !session.naming.peek()) router.replace({ name: 'editor', pieceId: session.pieceId })
    router.push({ name: 'add-music', pieceId: session.pieceId })
  }

  // "Bar 3 · Note 4": the place of the note among the bar's notes and rests.
  // "Bar 5 · Left hand · Chord, note 2 of 3", or "Bar 2 · Note 3" in a one-line piece (change edit-parts, D2).
  const selection = session.selection.value
  const note = session.selectedNote.value
  const label = session.selectionLabel.value
  const armed = session.armed.value
  const pending = session.pending.value
  const heading =
    tools === 'score'
      ? t('score.whole')
      : selection && note && label
        ? label
        : tools === 'bars'
          ? t(view === 'grid' ? 'bars.hint.grid' : 'bars.hint')
          : tools !== 'marks'
            ? t(view === 'grid' && tools === 'notes' ? 'grid.hint' : 'editor.selection.none')
            : armed === null
              ? t(view === 'grid' ? 'grid.marks.hint' : 'marks.hint')
              : isSpanMark(armed)
                ? t('marks.armed.span')
                : t('marks.armed.note')
  const previewing = session.previewing.value
  const naming = session.naming.value
  const beats = session.barBeats.value

  // The one row of what the editor has to say (design D13): a refused change, else what the current bar's warning says.
  const said = message ? (typeof message === 'string' ? t(message) : message.text) : session.message.value
  // The notice of a span that waits for its last note (design D14): it takes that row, and stays through "Full score". A
  // refusal meanwhile (a last note in another voice) is said in the notice, beside Cancel, until the next action: a
  // second row would push Save & practice off a small screen with a piano bar (design D13).
  const notice = pending ? (
    <div class={said ? 'editor-waiting editor-waiting--refused' : 'editor-waiting'} role="status">
      <p class="editor-waiting-text">{said ?? t('marks.waiting', { mark: t(`mark.${pending.kind}`), bar: pending.bar })}</p>
      <button
        type="button"
        class="editor-text-button editor-waiting-cancel"
        onClick={() => {
          quiet()
          session.cancelPending()
        }}
      >
        {t('common.cancel')}
      </button>
    </div>
  ) : null
  const barWarnings = session.barWarnings.value
  const focused = session.currentWarning.value
  const warning = focused && barWarnings.includes(focused) ? focused : barWarnings[0]
  // The suggested repairs of a bar that does not add up (design D6), as chips in one row that scrolls sideways; a tap is
  // one undo step. They come after a notice and a refusal in the row (design D13), and before the bar's warning text,
  // which the beats chip of the bar row says too. A warning the user stepped to that is not about the bar's length (a
  // note out of range) keeps its text in the row instead.
  const stepped = warning !== undefined && warning === focused && warning.kind !== 'bar-length'
  const suggestions = session.suggestions.value
  const chips =
    suggestions.length > 0 && !stepped ? (
      <div class="editor-fix" role="group" aria-label={t('suggest.lead')}>
        <span class="editor-fix-lead" aria-hidden="true">
          {t('suggest.lead')}
        </span>
        {suggestions.map((suggestion, k) => (
          <button
            key={`${k}:${i18n.suggestion(suggestion)}`}
            type="button"
            class="editor-fix-chip"
            onClick={() => {
              quiet()
              session.applySuggestion(suggestion)
            }}
          >
            <span class="editor-fix-pill">{i18n.suggestion(suggestion)}</span>
          </button>
        ))}
      </div>
    ) : null

  const classes = ['screen', 'editor']
  if (full) classes.push('editor--full')
  if (layout.scroll && !full) classes.push('editor--scroll')

  return (
    <div ref={frame} class={classes.join(' ')} data-screen="editor" data-piece-id={session.pieceId} data-layout={full ? 'full' : layout.scroll ? 'scroll' : layout.overview}>
      <header class="editor-header">
        <h1 class="visually-hidden">{t('editor.title')}</h1>
        <div class="editor-titlebar">
          <IconButton label={t('common.back')} icon="back" look="plain" onPress={() => void router.back()} />
          <label class={naming ? 'editor-title-field editor-title-field--naming' : 'editor-title-field'}>
            <span class={naming ? 'editor-caption' : 'editor-caption visually-hidden'}>{naming ? t('editor.nameThis') : t('editor.nameLabel')}</span>
            <input
              class="editor-title-input"
              type="text"
              value={session.title.value}
              aria-invalid={saveError === 'empty-name'}
              autoComplete="off"
              onFocus={(event) => {
                if (!firstFocus.current) return
                firstFocus.current = false
                if (!session.naming.peek()) return
                event.currentTarget.select()
                keepSelection.current = true
              }}
              onMouseUp={(event) => {
                // The press that focused the field would put the caret where it ended, losing the selection.
                if (!keepSelection.current) return
                keepSelection.current = false
                event.preventDefault()
              }}
              onInput={(event) => {
                session.setTitle(event.currentTarget.value)
                if (saveError === 'empty-name') setSaveError(null)
              }}
            />
          </label>
          <button
            type="button"
            class="editor-text-button editor-full-key"
            aria-pressed={full}
            onClick={() => {
              quiet()
              if (full) session.closeFullScore()
              else session.openFullScore()
            }}
          >
            {t('editor.fullScore')}
          </button>
        </div>
        <div class="editor-toolbar">
          {warningCount > 0 ? (
            <div class="editor-check" role="group" aria-label={t('editor.warnings')}>
              <IconButton label={t('editor.check.previous')} icon="back" look="plain" onPress={() => warn('previous')} />
              <button type="button" class="editor-check-chip" onClick={() => warn('next')}>
                <span class="editor-check-pill">
                  <span class="editor-check-dot" aria-hidden="true" />
                  {t('editor.check.next', { count: warningCount })}
                </span>
              </button>
            </div>
          ) : null}
          <span class="editor-toolbar-gap" />
          {/* While it plays, it stops (spec "Preview a bar"). */}
          <IconButton label={previewing ? t('editor.preview.stop') : t('editor.preview', { bar: current })} icon={previewing ? 'pause' : 'play'} look="plain" onPress={() => void preview()} />
          <IconButton label={t('editor.undo')} icon="undo" look="plain" disabled={!session.canUndo.value} onPress={() => session.undo()} />
          <IconButton label={t('editor.redo')} icon="redo" look="plain" disabled={!session.canRedo.value} onPress={() => session.redo()} />
        </div>
      </header>

      {score.parts.length > 1 && !full ? (
        <div class="editor-parts">
          <SegmentedControl
            label={t('editor.part')}
            value={session.part.value}
            options={score.parts.map((p, n) => ({ value: p.id, label: p.name || t('editor.part.number', { n: n + 1 }) }))}
            onChange={switchPart}
          />
        </div>
      ) : null}

      {full && notice ? <div class="editor-say editor-say--full">{notice}</div> : null}

      <Overview session={session} mode={layout.overview} island={island} onGoTo={goTo} onCloseFull={(bar) => session.closeFullScore(bar)} />

      {full ? null : (
        <>
          <div class="editor-barrow">
            <IconButton label={t('editor.bar.previous')} icon="back" disabled={current <= 1} onPress={() => goTo(current - 1)} />
            <div class="editor-barrow-where">
              <p class="editor-bar-position">{t('bar.position', { bar: current, bars: barCount })}</p>
              {beats ? (
                <span class={beats.addsUp ? 'editor-beats editor-beats--ok' : 'editor-beats editor-beats--off'}>
                  {t('editor.bar.beats', { counted: beats.counted, count: beats.beats })}
                </span>
              ) : null}
            </div>
            <IconButton label={t('editor.bar.next')} icon="chevron-right" disabled={current >= barCount} onPress={() => goTo(current + 1)} />
            <span class="editor-toolbar-gap" />
            <SegmentedControl<EditorView>
              label={t('editor.view')}
              value={view}
              options={[
                { value: 'notes', label: t('editor.view.notes') },
                { value: 'grid', label: t('editor.view.grid') },
              ]}
              onChange={(next) => void session.setView(next)}
            />
          </div>

          <div class="editor-say">
            {notice}
            {notice ? null : said ? (
              <p class="editor-message" role="status">
                {said}
              </p>
            ) : chips ? (
              chips
            ) : warning ? (
              <p class="editor-warnings-text" role="status">
                {i18n.warning(warning)}
              </p>
            ) : null}
          </div>

          <div class="editor-surface" role="region" aria-label={t('editor.bar.large', { bar: current })}>
            {view === 'grid' ? (
              <GridSurface
                session={session}
                onTapNote={tapNote}
                onTapEmpty={() => tapElement(undefined)}
                onQuiet={quiet}
                onStripNowhere={() => setMessage('grid.error.strip')}
                onCut={cut}
              />
            ) : (
              <BarSurface
                session={session}
                flagged={island.flagged.value}
                flaggedBars={island.flaggedBars.value}
                onTapNote={tapNote}
                onTapElement={tapElement}
                onQuiet={quiet}
                onSlideNowhere={() => setMessage('mark.error.slide')}
                onCut={cut}
              />
            )}
          </div>

          <section class="editor-tools" aria-label={t('editor.tabs')}>
            <SegmentedControl<ToolsTab>
              look="track"
              label={t('editor.tabs')}
              value={tools}
              options={[
                { value: 'notes', label: t('editor.tab.notes') },
                { value: 'marks', label: t('editor.tab.marks') },
                { value: 'bars', label: t('editor.tab.bars') },
                { value: 'score', label: t('editor.tab.score') },
              ]}
              onChange={chooseTab}
            />
            <div class="editor-tray">
              <p class="editor-selection">{heading}</p>
              <ElementPanel session={session} run={run} />
              {tools === 'notes' ? <NotesTray session={session} run={run} onQuiet={quiet} /> : null}
              {tools === 'marks' ? <MarksTray session={session} onQuiet={quiet} /> : null}
              {tools === 'bars' ? <BarsTray session={session} onQuiet={quiet} /> : null}
              {tools === 'score' ? <ScoreTab session={session} run={run} onAddPages={() => void addPages()} /> : null}
            </div>
          </section>
        </>
      )}

      <footer class="editor-actions">
        {saveError ? (
          <p class="editor-save-error" role="alert">
            {t(SAVE_ERROR[saveError])}
          </p>
        ) : null}
        <Button block disabled={session.saving.value} onPress={() => void savePieceAndPractice()}>
          {t('editor.save')}
        </Button>
      </footer>
    </div>
  )
}
