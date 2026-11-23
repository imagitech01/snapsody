import type { ReadonlySignal, Signal } from '@preact/signals'
import type { EditorSession } from '../../../app/editorSession.ts'
import { lineOfBar } from '../../../core/score/lines.ts'
import type { LineBars } from '../../../core/score/lines.ts'
import { IconButton } from '../../components/index.ts'
import { ScoreIsland } from '../../ScoreIsland.tsx'
import { useShell } from '../../ShellContext.ts'

/**
 * The overview and the full score (change redesign-score-editor, design D1 and D13): one score island of the part being
 * edited, drawn small, with the current bar tinted and the flags on it.
 *
 * - As the overview it shows the line of music that holds the current bar (the island's `line`): a line is what Verovio
 *   lays out for the width, so it is as many bars as fit. A tap anywhere in a bar makes that bar current and selects
 *   nothing; the arrows at its ends make the first bar of the line before or after current. In a two-staff part it shows
 *   both staves. When the large bar would get less than its minimum, the frame shrinks it to a row of the line's bar
 *   numbers with the flags (`numbers`); the island stays laid out under it, so the lines and the line's height are known.
 * - As "Full score" the same island shows the whole part, from the current bar's line, and scrolls; a tap in a bar picks
 *   it and goes back to the bar view, and "Back to bar N" goes back without picking.
 */
export interface OverviewProps {
  session: EditorSession
  /** `line` or `numbers` (design D13); the full score when the session shows it. */
  mode: 'line' | 'numbers'
  island: {
    bar: ReadonlySignal<number>
    line: ReadonlySignal<number | null>
    following: ReadonlySignal<boolean>
    shownBar: ReadonlySignal<number | null>
    playing: ReadonlySignal<boolean>
    selected: ReadonlySignal<readonly string[]>
    flagged: ReadonlySignal<readonly string[]>
    flaggedBars: ReadonlySignal<readonly string[]>
    lines: Signal<readonly LineBars[]>
  }
  /** A bar (from 1) to make current: a tap, a bar number or a line arrow. */
  onGoTo: (bar: number) => void
  /** A bar (from 1) picked in the full score, or none for "Back to bar N". */
  onCloseFull: (bar?: number) => void
}

const noHeard = (): undefined => undefined

export function Overview({ session, mode, island, onGoTo, onCloseFull }: OverviewProps) {
  const { t } = useShell().i18n
  const full = session.fullScore.value
  const bar = session.currentBar.value
  const lines = island.lines.value
  const index = lineOfBar(lines, bar - 1)
  const shown = lines[index] ?? { firstBar: bar - 1, lastBar: bar - 1 }
  const flagged = session.flaggedBars.value
  const numbers = Array.from({ length: shown.lastBar - shown.firstBar + 1 }, (_, k) => shown.firstBar + k + 1)

  const stepLine = (direction: 1 | -1): void => {
    const next = lines[index + direction]
    if (next) onGoTo(next.firstBar + 1)
  }

  return (
    <section
      class={`editor-overview editor-overview--${full ? 'full' : mode}`}
      role="group"
      aria-label={full ? t('editor.fullScore') : t('editor.line.group')}
      data-overview={full ? 'full' : mode}
    >
      {full ? (
        <div class="editor-full-head">
          <p class="editor-full-hint">{t('editor.full.hint')}</p>
          <button type="button" class="editor-text-button" onClick={() => onCloseFull()}>
            {t('editor.line.back', { bar })}
          </button>
        </div>
      ) : null}
      <div class="editor-overview-row">
        {full ? null : <IconButton label={t('editor.line.previous')} icon="back" look="plain" disabled={index <= 0} onPress={() => stepLine(-1)} />}
        <div class="editor-overview-line">
          <div class="editor-overview-island">
            <ScoreIsland
              label={full ? t('editor.fullScore') : t('editor.line.group')}
              multiRests="expand"
              scale={OVERVIEW_SCALE}
              part={session.drawn}
              score={session.score.value}
              bar={island.bar}
              following={island.following}
              shownBar={island.shownBar}
              playing={island.playing}
              selected={island.selected}
              flagged={island.flagged}
              flaggedBars={island.flaggedBars}
              heard={noHeard}
              onScrollAway={() => undefined}
              onTapNote={() => undefined}
              onTapBar={(picked) => (session.fullScore.peek() ? onCloseFull(picked) : onGoTo(picked))}
              line={island.line}
              onLines={(found) => {
                island.lines.value = found
              }}
            />
          </div>
          {mode === 'numbers' && !full ? (
            <div class="editor-overview-numbers">
              {numbers.map((n) => (
                <button
                  key={n}
                  type="button"
                  class={`editor-bar-number${n === bar ? ' is-current' : ''}${flagged.has(n) ? ' is-flagged' : ''}`}
                  aria-label={flagged.has(n) ? t('editor.bar.flagged', { bar: n }) : t('bar.label', { bar: n })}
                  aria-current={n === bar ? 'true' : undefined}
                  onClick={() => onGoTo(n)}
                >
                  {n}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        {full ? null : <IconButton label={t('editor.line.next')} icon="chevron-right" look="plain" disabled={index < 0 || index >= lines.length - 1} onPress={() => stepLine(1)} />}
      </div>
    </section>
  )
}

/** Verovio's scale of the overview and the full score: smaller than practice's 40, so a line holds a few bars next to its arrows. */
const OVERVIEW_SCALE = 30
