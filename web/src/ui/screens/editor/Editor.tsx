import { computed, signal } from '@preact/signals'
import { useMemo, useRef, useState } from 'preact/hooks'
import type { EditorSession } from '../../../app/editorSession.ts'
import { EditError, addSlur, addTie, addWedge, compareInTime } from '../../../core/score/edit.ts'
import type { ElementRef } from '../../../core/score/elements.ts'
import { lineOfBar } from '../../../core/score/lines.ts'
import type { LineBars } from '../../../core/score/lines.ts'
import { isNote, placeOfNote, sameVoice } from '../../../core/score/model.ts'
import type { MeasureItem, Note, Score, VoiceRef, VoiceScore } from '../../../core/score/model.ts'
import { voiceView, voices } from '../../../core/score/model.ts'
import { Button, Icon, IconButton, SegmentedControl } from '../../components/index.ts'
import { ScoreIsland } from '../../ScoreIsland.tsx'
import { useShell } from '../../ShellContext.ts'
import { ElementPanel } from './ElementPanel.tsx'
import { MarksTab } from './MarksTab.tsx'
import type { PickState, PickKind } from './MarksTab.tsx'
import { NoteTab } from './NoteTab.tsx'
import type { Failure, FailureKey } from './NoteTab.tsx'
import { ScoreTab } from './ScoreTab.tsx'

/**
 * The editor of a piece (frames 06.1 to 06.3, spec `score-editing`, design D12 and D14; change
 * simplify-editor-and-name-new-pieces): the title, the score with what is selected and flagged on it, the
 * three tabs of tools (Note, Marks, Score) with Preview bar, Undo and Redo in their head, and Save &
 * practice. What it does is `EditorSession`'s (`app/editorSession.ts`); this draws it and keeps what only
 * the screen knows: the tab, the notes a slur, tie or hairpin is waiting for, and "Full score".
 *
 * One line while editing (spec "One line while editing", design D1 and D2): with nothing selected the score is
 * the whole sheet; once something is selected, the island shows only the line that holds its bar, and the
 * strip under it steps from line to line (selecting the first bar of the other line) or shows the full score
 * again. "Full score" keeps the selection; the next tap that selects ends it. A line is what Verovio lays out
 * for the width, so the island reports the lines after every layout.
 *
 * Naming a new piece (spec `piece-library` "Default name", design D5): while the session is `naming`, the title is
 * tinted with the caption "Name this piece", and its first focus selects the date name, so typing replaces it.
 * Nothing focuses it by itself: the keyboard would cover the score.
 *
 * Leaving: the back button, the header's Back and Cancel all ask the router, whose leave guard (the
 * session's) asks the discard question while there are unsaved edits. "Add pages", at the foot of the Score
 * tab, opens the add-music screen over this one, which removes this screen, so it asks to save first.
 */

type Tab = 'note' | 'marks' | 'score'

/** What failed to save, as the text the user reads. */
const SAVE_ERROR = {
  'empty-name': 'editor.nameEmpty',
  conflict: 'editor.saveConflict',
  failed: 'editor.saveFailed',
} as const satisfies Readonly<Record<'empty-name' | 'conflict' | 'failed', 'editor.nameEmpty' | 'editor.saveConflict' | 'editor.saveFailed'>>

/** The failure text of each mark that joins two notes. */
const PICK_ERROR: Readonly<Record<PickKind, FailureKey>> = {
  slur: 'mark.error.slur',
  tie: 'mark.error.tie',
  crescendo: 'mark.error.wedge',
  diminuendo: 'mark.error.wedge',
}

const noHeard = (): undefined => undefined

/** A note or rest that is drawn: a hidden rest (a `<forward>`) is not there to select or count. */
const isShown = (item: MeasureItem): item is Note => isNote(item) && !item.hidden

const lineOf = (score: Score, ref: VoiceRef): VoiceScore => voiceView(score, ref)


export function Editor({ session }: { session: EditorSession }) {
  const { router, i18n } = useShell()
  const { t } = i18n
  const [tab, setTab] = useState<Tab>('note')
  const [pick, setPick] = useState<PickState | null>(null)
  /** Why the last change did not happen: a fixed text, or one already made from the refusal. */
  const [message, setMessage] = useState<FailureKey | { text: string } | null>(null)
  const [saveError, setSaveError] = useState<'empty-name' | 'conflict' | 'failed' | null>(null)
  /** The title has not had its first focus yet; and that focus selected the date name, which the press's own mouseup must not undo. */
  const firstFocus = useRef(true)
  const keepSelection = useRef(false)

  // What the score island follows. One set per session: new signal objects would mount the island again.
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
          return refs.flatMap((ref) => lineOf(score, ref).measures.filter((m) => m.number === w.bar).flatMap((m) => m.items.filter(isShown).map((n) => n.id)))
        })
    })
    const fullScore = signal(false)
    return {
      fullScore,
      /** The lines of the drawing, as the island last laid them out. */
      lines: signal<readonly LineBars[]>([]),
      /** The line to show: the selection's, unless "Full score" is on or nothing is selected. */
      line: computed(() => (fullScore.value ? null : (session.selection.value?.bar ?? null))),
      // The bar of the selection is tinted; 0 is no bar, and shows none.
      bar: computed(() => session.selection.value?.bar ?? 0),
      following: signal(false),
      shownBar: signal<number | null>(null),
      playing: signal(false),
      selected: computed(() => {
        const id = session.selection.value?.noteId
        return id ? [id] : []
      }),
      selectedElement: computed(() => session.selectedElement.value?.ref),
      flagged,
      flaggedBars,
    }
  }, [session])

  const score = session.score.value
  const selection = session.selection.value
  const note = session.selectedNote.value
  const warningCount = session.warningCount.value
  const currentWarning = session.currentWarning.value

  /** Scrolls the score to a bar, and selects it. */
  const goToBar = (bar: number): void => {
    if (!session.selectBar(bar)) return
    island.shownBar.value = bar
    setMessage(null)
  }

  /** Runs an edit as one undo step (or as part of the last, `amend`); an edit that cannot be done says why and changes nothing. */
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

  const tapNote = (id: string): void => {
    setMessage(null)
    island.fullScore.value = false
    session.select(id)
    if (!pick) return
    if (pick.first === null) {
      setPick({ ...pick, first: id })
      return
    }
    // The notes may be tapped in either order: the first of them in the score is where the mark starts.
    const [from, to] = compareInTime(session.score.value, pick.first, id) <= 0 ? [pick.first, id] : [id, pick.first]
    const { kind } = pick
    setPick(null)
    // A slur or tie stays in one voice, a hairpin in one staff (change edit-parts, D7): say so rather than "cannot".
    const a = placeOfNote(session.score.value, from)?.ref
    const b = placeOfNote(session.score.value, to)?.ref
    if (a && b && (kind === 'slur' || kind === 'tie') && !sameVoice(a, b)) {
      setMessage('mark.error.voice')
      return
    }
    if (a && b && (kind === 'crescendo' || kind === 'diminuendo') && (a.part !== b.part || a.staff !== b.staff)) {
      setMessage('mark.error.staff')
      return
    }
    run((s) => (kind === 'slur' ? addSlur(s, from, to) : kind === 'tie' ? addTie(s, from, to) : addWedge(s, kind, from, to)), PICK_ERROR[kind])
  }

  /**
   * A tap on the score that found an element, or (undefined) nothing: an element is selected and shown in
   * its panel; a bar line selects its bar and shows the bar-line controls on the Marks tab; an empty tap
   * puts away the element, keeping its bar. While the notes of a slur, tie or hairpin are being chosen,
   * only notes count.
   */
  const tapElement = (ref: ElementRef | undefined): void => {
    if (pick) return
    setMessage(null)
    if (!ref) {
      const element = session.selectedElement.peek()
      if (element) session.selectBar(element.info.bar + 1)
      return
    }
    if (!session.selectElement(ref)) return
    island.fullScore.value = false
    if (ref.kind === 'barline') setTab('marks')
  }

  const startPick = (kind: PickKind | null): void => {
    setMessage(null)
    setPick(kind ? { kind, first: null } : null)
  }

  /** The part switch (change edit-parts, D1): another part is drawn, and the selection and a mark being chosen go. */
  const switchPart = (id: string): void => {
    setPick(null)
    setMessage(null)
    island.fullScore.value = false
    session.setPart(id)
  }

  const chooseTab = (next: Tab): void => {
    setTab(next)
    setPick(null)
    setMessage(null)
  }

  const warn = (direction: 'next' | 'previous'): void => {
    setMessage(null)
    const warning = direction === 'next' ? session.nextWarning() : session.previousWarning()
    if (!warning) return
    island.fullScore.value = false
    // A warning about the time signature is about the whole piece: show the tab where it is changed.
    if (warning.kind === 'time-signature-inferred' || warning.kind === 'time-signature-missing') {
      chooseTab('score')
      goToBar(1)
      return
    }
    const bar = session.selection.peek()?.bar
    if (bar !== undefined) island.shownBar.value = bar
  }

  /** Selects the first bar of the line before or after the selected one; the notes a mark waits for are kept. */
  const stepLine = (direction: 1 | -1): void => {
    const bar = session.selection.peek()?.bar
    if (bar === undefined) return
    const lines = island.lines.peek()
    const next = lines[lineOfBar(lines, bar - 1) + direction]
    if (!next) return
    setMessage(null)
    island.fullScore.value = false
    session.selectBar(next.firstBar + 1)
  }

  const preview = async (): Promise<void> => {
    if (session.previewing.value) {
      session.stopPreview()
      return
    }
    setMessage(null)
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
  const label = session.selectionLabel.value
  const heading = tab === 'score' ? t('score.whole') : selection && note && label ? label : t('editor.selection.none')
  const previewing = session.previewing.value
  const naming = session.naming.value
  const lines = island.lines.value
  const fullScore = island.fullScore.value
  const lineIndex = selection ? lineOfBar(lines, selection.bar - 1) : -1
  const shown = lineIndex >= 0 && !fullScore ? lines[lineIndex] : undefined

  return (
    <div class="screen editor" data-screen="editor" data-piece-id={session.pieceId}>
      <div class="editor-scroll">
        <header class="editor-header">
          <div class="editor-topbar">
            <IconButton label={t('common.back')} icon="back" look="plain" size={44} onPress={() => void router.back()} />
            <p class="t-eyebrow">{t('editor.eyebrow')}</p>
            <Button variant="link" size="small" onPress={() => void router.back()}>
              {t('editor.cancel')}
            </Button>
          </div>
          <h1 class="t-title">{t('editor.title')}</h1>
          <label class={naming ? 'editor-title-field editor-title-field--naming' : 'editor-title-field'}>
            <span class="editor-caption">{naming ? t('editor.nameThis') : t('editor.nameLabel')}</span>
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
        </header>

        <div class="editor-main">
          <section class="editor-score-card" aria-label={t('editor.scoreLabel')}>
            {score.parts.length > 1 ? (
              <SegmentedControl
                label={t('editor.part')}
                value={session.part.value}
                options={score.parts.map((p, n) => ({ value: p.id, label: p.name || t('editor.part.number', { n: n + 1 }) }))}
                onChange={switchPart}
              />
            ) : null}
            {warningCount > 0 ? (
              <div class="editor-warnings" role="group" aria-label={t('editor.warnings')}>
                <div class="editor-warnings-row">
                  <span class="editor-warnings-count">
                    <span class="editor-warnings-dot" aria-hidden="true" />
                    {t('warnings.count', { count: warningCount })}
                  </span>
                  <button type="button" class="editor-text-button" onClick={() => warn('previous')}>
                    {t('warnings.previous')}
                  </button>
                  <button type="button" class="editor-text-button" onClick={() => warn('next')}>
                    {t('warnings.next')}
                  </button>
                </div>
                {currentWarning ? (
                  <p class="editor-warnings-text" role="status">
                    {i18n.warning(currentWarning)}
                  </p>
                ) : null}
              </div>
            ) : null}

            <div class={shown ? 'editor-score editor-score--line' : 'editor-score'}>
              <ScoreIsland
                label={t('editor.scoreLabel')}
                multiRests="expand"
                part={session.drawn}
                score={score}
                bar={island.bar}
                following={island.following}
                shownBar={island.shownBar}
                playing={island.playing}
                selected={island.selected}
                flagged={island.flagged}
                flaggedBars={island.flaggedBars}
                heard={noHeard}
                onScrollAway={(bar) => {
                  island.shownBar.value = bar
                }}
                onTapNote={(id) => tapNote(id)}
                onTapElement={tapElement}
                selectedElement={island.selectedElement}
                line={island.line}
                onLines={(found) => {
                  island.lines.value = found
                }}
              />
            </div>

            {shown ? (
              <div class="editor-line" role="group" aria-label={t('editor.line.group')}>
                <IconButton label={t('editor.line.previous')} icon="back" size={44} disabled={lineIndex <= 0} onPress={() => stepLine(-1)} />
                <p class="editor-line-label">
                  {t('editor.line', { line: lineIndex + 1, lines: lines.length })}
                  {' · '}
                  {shown.firstBar === shown.lastBar ? t('bar.label', { bar: shown.firstBar + 1 }) : t('bar.range', { from: shown.firstBar + 1, to: shown.lastBar + 1 })}
                </p>
                <IconButton label={t('editor.line.next')} icon="chevron-right" size={44} disabled={lineIndex >= lines.length - 1} onPress={() => stepLine(1)} />
                <button
                  type="button"
                  class="editor-text-button"
                  onClick={() => {
                    island.fullScore.value = true
                  }}
                >
                  {t('editor.fullScore')}
                </button>
              </div>
            ) : selection && fullScore ? (
              <div class="editor-line" role="group" aria-label={t('editor.line.group')}>
                <p class="editor-line-hint">{t('editor.line.hint')}</p>
                <button
                  type="button"
                  class="editor-text-button"
                  onClick={() => {
                    island.fullScore.value = false
                  }}
                >
                  {t('editor.line.back', { bar: selection.bar })}
                </button>
              </div>
            ) : null}
          </section>

          <section class="editor-tools" aria-label={t('editor.tabs')}>
            <ElementPanel session={session} run={run} />
            <SegmentedControl
              look="track"
              label={t('editor.tabs')}
              value={tab}
              options={[
                { value: 'note', label: t('editor.tab.note') },
                { value: 'marks', label: t('editor.tab.marks') },
                { value: 'score', label: t('editor.tab.score') },
              ]}
              onChange={chooseTab}
            />
            <div class="editor-tools-head">
              <p class="editor-selection">{heading}</p>
              <div class="editor-tools-actions">
                {/* Off while nothing is selected; while it plays, it stops (spec "Preview a bar"). */}
                <button type="button" class="editor-text-button editor-preview" disabled={!selection && !previewing} onClick={() => void preview()}>
                  <Icon name={previewing ? 'pause' : 'play'} size={12} />
                  <span>{previewing ? t('editor.preview.stop') : selection ? t('editor.preview', { bar: selection.bar }) : t('editor.preview.none')}</span>
                </button>
                <button type="button" class="editor-text-button" disabled={!session.canUndo.value} onClick={() => session.undo()}>
                  {t('editor.undo')}
                </button>
                <button type="button" class="editor-text-button" disabled={!session.canRedo.value} onClick={() => session.redo()}>
                  {t('editor.redo')}
                </button>
              </div>
            </div>
            {tab === 'note' ? <NoteTab session={session} run={run} /> : null}
            {tab === 'marks' ? <MarksTab session={session} run={run} pick={pick} onPick={startPick} /> : null}
            {tab === 'score' ? <ScoreTab session={session} run={run} onAddPages={() => void addPages()} /> : null}
            {message ? (
              <p class="editor-message" role="status">
                {typeof message === 'string' ? t(message) : message.text}
              </p>
            ) : null}
          </section>
        </div>
      </div>

      <footer class="editor-actions">
        {saveError ? (
          <p class="editor-save-error" role="alert">
            {t(SAVE_ERROR[saveError])}
          </p>
        ) : null}
        <Button block disabled={session.saving.value} onPress={() => void savePieceAndPractice()}>
          {t('editor.save')}
        </Button>
        <p class="t-caption editor-save-hint">{t('editor.saveHint')}</p>
      </footer>
    </div>
  )
}
