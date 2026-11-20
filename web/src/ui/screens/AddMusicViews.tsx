import type { ComponentChildren } from 'preact'
import { useEffect, useId, useState } from 'preact/hooks'
import type { AddMusicFlow, AddMusicState, PageState, PartChoice, ReadingProgress } from '../../app/addMusic.ts'
import type { Score } from '../../core/score/model.ts'
import { renderScore } from '../../core/score/render.ts'
import type { Files } from '../../platform/port.ts'
import { Button, Card, Icon, IconButton, ToggleRow } from '../components/index.ts'
import type { IconName } from '../components/index.ts'
import { useShell } from '../ShellContext.ts'

/*
 * What the add-music screen shows for each step of the flow (practice-app task 14.1, design D14):
 *  - the hint before the scanner (no frame: designed in the look of the others),
 *  - the pages being read (frame 05 "Process scan"),
 *  - the parts step (spec `score-recognition` "Choose the parts to keep"): a row per part with a checkbox, its name,
 *    its first bars drawn small and "I play this",
 *  - no music on a page, a page that could not be read, a piece that could not be saved, and the
 *    scanner that cannot run (no frames),
 *  - a plain waiting view for the moments between (the scanner opening, saving).
 * `AddMusicScreen` picks the view and navigates; these only draw and call the flow.
 */

/** The frame of every view: the Back button, the header and the body, with the actions pinned at the foot. */
function Frame({
  step,
  title,
  eyebrow,
  onBack,
  actions,
  children,
}: {
  step: string
  title: string
  eyebrow?: string | null
  onBack?: () => void
  actions?: ComponentChildren
  children?: ComponentChildren
}) {
  const { t } = useShell().i18n
  return (
    <div class="screen" data-screen="add-music" data-step={step}>
      {onBack ? (
        <div class="screen-topbar">
          <IconButton label={t('common.back')} icon="back" onPress={onBack} />
        </div>
      ) : null}
      <header class="screen-header">
        {eyebrow === null ? null : <p class="t-eyebrow">{eyebrow ?? t('add.title')}</p>}
        <h1 class="t-title">{title}</h1>
      </header>
      <div class="screen-body">{children}</div>
      {actions ? <div class="add-actions">{actions}</div> : null}
    </div>
  )
}

// ---- The hint ---------------------------------------------------------------------------------

/** Before the scanner: crop each page, add the next one, and a switch to skip this next time (spec `score-capture` "Hint before scanning"). */
export function HintView({ flow, onBack }: { flow: AddMusicFlow; onBack: () => void }) {
  const { t } = useShell().i18n
  const [dontShow, setDontShow] = useState(false)
  return (
    <Frame
      step="hint"
      title={t('add.hint.title')}
      onBack={onBack}
      actions={
        <Button block icon="camera" onPress={() => void flow.continueFromHint({ dontShowAgain: dontShow })}>
          {t('add.hint.continue')}
        </Button>
      }
    >
      <ol class="add-steps">
        {(['add.hint.crop', 'add.hint.next'] as const).map((key, index) => (
          <li key={key} class="add-step">
            <span class="add-step-number" aria-hidden="true">
              {index + 1}
            </span>
            <p>{t(key)}</p>
          </li>
        ))}
      </ol>
      <div class="add-hint-switch">
        <ToggleRow title={t('add.hint.dontShow')} checked={dontShow} onChange={setDontShow} />
      </div>
    </Frame>
  )
}

// ---- Reading (frame 05) ------------------------------------------------------------------------

const STATE_ICON: Record<PageState, IconName> = { done: 'check', current: 'clock', waiting: 'ring' }

/** The URL of the image at [path] while it is wanted, or undefined; a path that cannot be shown leaves the box empty. */
function usePageImage(files: Pick<Files, 'imageUrl'>, path: string | undefined): string | undefined {
  const [shown, setShown] = useState<{ path: string; url: string }>()
  useEffect(() => {
    if (path === undefined) return
    let wanted = true
    files
      .imageUrl(path)
      .then((url) => wanted && setShown({ path, url }))
      .catch(() => wanted && setShown(undefined))
    return () => {
      wanted = false
    }
  }, [files, path])
  return shown !== undefined && shown.path === path ? shown.url : undefined
}

/**
 * Frame 05: the page being read, which page of how many with the progress, the pages read, being read
 * and still to come, and Cancel. Not drawn (design D14): the frame's "Notes detected" tag, its scanning
 * beam and the glow over a staff, which would claim a detail the reader does not report.
 */
export function ReadingView({ flow, progress, onCancel }: { flow: AddMusicFlow; progress: ReadingProgress; onCancel: () => void }) {
  const { platform, view, i18n } = useShell()
  const { t } = i18n
  const url = usePageImage(platform.files, flow.pagePaths[progress.page - 1])
  // An image that does not load leaves the box empty, not the browser's broken-image mark.
  const [broken, setBroken] = useState<string>()
  const photo = url !== undefined && url !== broken ? url : undefined
  const percent = Math.round(progress.fraction * 100)
  const piece = flow.pieceId === undefined ? undefined : view.pieces.value.find((p) => p.id === flow.pieceId)
  const reading = t('add.reading.page', { page: progress.page, pages: progress.pages })
  return (
    <div class="screen" data-screen="add-music" data-step="reading">
      <div class="screen-topbar">
        <IconButton label={t('common.back')} icon="back" onPress={onCancel} />
      </div>
      <header class="screen-header">
        <p class="t-eyebrow">{t('add.title')}</p>
        <h1 class="t-title">{t('add.reading.title')}</h1>
        <p class="t-subtitle">{piece ? t('add.reading.bodyExisting', { name: piece.name }) : t('add.reading.body')}</p>
      </header>
      <div class="screen-body">
        <div class="add-photo">{photo ? <img src={photo} alt={t('add.reading.pageLabel', { page: progress.page })} onError={() => setBroken(photo)} /> : null}</div>
        <h2 class="add-reading" aria-live="polite">
          {reading}
        </h2>
        <div class="add-progress">
          <div class="add-progress-track" role="progressbar" aria-label={reading} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
            <span class="add-progress-fill" style={{ width: `${percent}%` }} />
          </div>
          <span class="add-progress-value">{t('add.reading.progress', { percent })}</span>
        </div>
        <ol class="add-pages" aria-label={t('add.reading.title')}>
          {progress.states.map((state, index) => (
            <li key={index} class={`add-page is-${state}`} aria-current={state === 'current' ? 'step' : undefined}>
              <Icon name={STATE_ICON[state]} />
              <span class="add-page-name">{t('add.reading.pageLabel', { page: index + 1 })}</span>
              <span class="add-page-state">{t(`add.reading.state.${state}`)}</span>
            </li>
          ))}
        </ol>
      </div>
      <div class="add-actions">
        <p class="t-caption add-keep-open">{t('add.reading.keepOpen')}</p>
        <Button variant="secondary" block onPress={onCancel}>
          {t('add.reading.cancel')}
        </Button>
      </div>
    </div>
  )
}

// ---- The parts step ----------------------------------------------------------------------------

/** How many bars of a part are drawn: a few, so two melodies can be told apart and the drawing stays light. They are laid out wide enough to be one line. */
const PREVIEW_BARS = 3

/**
 * The first bars of one part, drawn small with the toolkit the app already uses (one `loadData` and one page of SVG per
 * part, on the first bars only). A drawing that fails leaves the box empty: the name is what the row stands on.
 */
function PartPreview({ score, part, label }: { score: Score; part: PartChoice; label: string }) {
  const [svg, setSvg] = useState<string>()
  useEffect(() => {
    let wanted = true
    const first: Score = { ...score, bars: score.bars.slice(0, PREVIEW_BARS) }
    renderScore(first, { width: 460, scale: 40, parts: [part.id] })
      .then((pages) => wanted && setSvg(pages[0]))
      .catch(() => undefined)
    return () => {
      wanted = false
    }
  }, [score, part.id])
  return <div class="add-part-preview" role="img" aria-label={label} dangerouslySetInnerHTML={{ __html: svg ?? '' }} />
}

/**
 * The parts step: every part with a checkbox (keep), its name, its first bars and a radio "I play this". Continue is off
 * while nothing is kept; Back cancels, as cancelling the reading does. The choices live in the flow.
 */
export function PartsView({ flow, state, onBack }: { flow: AddMusicFlow; state: Extract<AddMusicState, { step: 'parts' }>; onBack: () => void }) {
  const { t } = useShell().i18n
  const none = !state.keep.some(Boolean)
  return (
    <Frame
      step="parts"
      title={t('add.parts.title')}
      onBack={onBack}
      actions={
        <>
          {none ? (
            <p class="t-caption add-keep-open" role="status">
              {t('add.parts.needOne')}
            </p>
          ) : null}
          <Button block disabled={none} onPress={() => void flow.continueParts()}>
            {t('add.parts.continue')}
          </Button>
        </>
      }
    >
      <p class="t-subtitle add-parts-body">{t('add.parts.body')}</p>
      <ul class="add-parts" role="radiogroup" aria-label={t('add.parts.play')}>
        {state.parts.map((part, index) => (
          <PartRow key={part.id} flow={flow} state={state} part={part} index={index} />
        ))}
      </ul>
    </Frame>
  )
}

function PartRow({ flow, state, part, index }: { flow: AddMusicFlow; state: Extract<AddMusicState, { step: 'parts' }>; part: PartChoice; index: number }) {
  const { t } = useShell().i18n
  const nameId = useId()
  const playId = useId()
  const kept = state.keep[index]!
  const plays = state.play === index
  return (
    <li class={kept ? 'add-part' : 'add-part is-dropped'}>
      <div class="add-part-head">
        <button type="button" class="add-part-keep" role="checkbox" aria-checked={kept} aria-labelledby={nameId} onClick={() => flow.setKept(index, !kept)}>
          <span class="add-part-box" aria-hidden="true">
            {kept ? <Icon name="check" size={16} /> : null}
          </span>
        </button>
        <span id={nameId} class="add-part-name">
          {part.name}
        </span>
        <button type="button" class="add-part-play" role="radio" aria-checked={plays} aria-labelledby={`${playId} ${nameId}`} disabled={!kept} onClick={() => flow.setPlay(index)}>
          <span id={playId}>{t('add.parts.play')}</span>
          <Icon name="radio" class={plays ? 'radio-on' : 'radio-off'} />
        </button>
      </div>
      <PartPreview score={state.score} part={part} label={t('add.parts.preview', { name: part.name })} />
    </li>
  )
}

// ---- When nothing was added ---------------------------------------------------------------------

type Problem = Extract<AddMusicState, { step: 'no-music' | 'failed' | 'unavailable' }>

/** What a view of a problem says: its title, its lines, and whether scanning again is offered. */
function wording(problem: Problem, t: ReturnType<typeof useShell>['i18n']['t']): { title: string; lines: string[]; again: boolean } {
  if (problem.step === 'unavailable') return { title: t('add.unavailable.title'), lines: [t('add.unavailable.body')], again: false }
  if (problem.step === 'no-music') return { title: t('add.noMusic.title'), lines: [t('add.noMusic.body', { page: problem.page })], again: true }
  if (problem.reason === 'save') return { title: t('add.saveFailed.title'), lines: [t('add.saveFailed')], again: true }
  const lines = problem.reason === 'page' && problem.page !== undefined ? [t('add.failed.page', { page: problem.page }), t('add.failed.body')] : [t('add.failed.body')]
  return { title: t('add.failed.title'), lines, again: true }
}

/**
 * No music on page N, a page or the piece that failed (the same card, with Scan again), and the scanner
 * that cannot run (the same card, OK only: the spec offers no other way to add music).
 */
export function ProblemView({ problem, flow, onBack }: { problem: Problem; flow: AddMusicFlow; onBack: () => void }) {
  const { t } = useShell().i18n
  const { title, lines, again } = wording(problem, t)
  return (
    <Frame step={problem.step} title={title} onBack={onBack}>
      <Card label={title}>
        {lines.map((line) => (
          <p key={line} class="add-problem-line">
            {line}
          </p>
        ))}
        <div class="invite-action add-problem-actions">
          {again ? (
            <Button block icon="camera" onPress={() => void flow.scanAgain()}>
              {t('add.noMusic.again')}
            </Button>
          ) : null}
          <Button variant="secondary" block onPress={onBack}>
            {again ? t('add.reading.cancel') : t('common.ok')}
          </Button>
        </div>
      </Card>
    </Frame>
  )
}

// ---- Between the steps --------------------------------------------------------------------------

/**
 * The moments the user only waits for: the scanner opening, and the piece being saved. Before the flow has
 * started and once it has ended (the screen is about to close) nothing is said: the screen is empty.
 */
export function BusyView({ step }: { step: 'idle' | 'scanning' | 'saving' | 'cancelled' }) {
  const { t } = useShell().i18n
  if (step === 'idle' || step === 'cancelled') return <div class="screen" data-screen="add-music" data-step={step} />
  const saving = step === 'saving'
  return (
    <Frame step={saving ? 'saving' : 'scanning'} eyebrow={null} title={t('add.title')}>
      <p class="t-subtitle" role="status">
        {saving ? t('add.saving') : t('add.scanning')}
      </p>
    </Frame>
  )
}
