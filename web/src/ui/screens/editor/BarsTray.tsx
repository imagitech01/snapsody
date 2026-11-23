import type { ComponentChildren } from 'preact'
import type { EditorSession } from '../../../app/editorSession.ts'
import { MAX_REPEAT_TIMES, MIN_REPEAT_TIMES } from '../../../core/score/edit.ts'
import type { BarEnd } from '../../../core/score/edit.ts'
import { Stepper } from '../../components/index.ts'
import { useShell } from '../../ShellContext.ts'
import { Chip } from './controls.tsx'

/**
 * The Bars tray (change redesign-score-editor, task 9.1; spec `score-editing` "Edit bar lines", "First and second
 * endings", "Endings stay in order", "Add a bar", "Delete a bar", "Same as the bar before", "Remove a bar line"). It works
 * on the current bar, with the session's actions, each one undo step. Three rows of keys, as the mock has them:
 *
 * 1. How the bar starts and ends: "Repeat from" (a start-repeat, on or off), then one of Normal, Double, Repeat (an
 *    end-repeat) and End (the end bar line). Each key shows its sign over its word; its name is the word.
 * 2. "Played 2×" for an end-repeat (2 to 8 times; held, the steps are one undo step with the first), off for any other
 *    end; then "1st time only" and "2nd time only", on when the bar lies in that ending. An ending read with other numbers
 *    ("1, 2") is shown by its number with a key that only removes it (design D7).
 * 3. "+ Bar before", "+ Bar after", "Same as bar before", "Join with next" and "Delete bar" (in the warning colour).
 *    Where one is not offered (the first bar has no bar before it; the end of a printed line or page; the only bar of a
 *    page or of the piece, design D8), it is drawn off but still taps, so the session says why on the message line.
 *
 * With the Bars tools open, the large bar shows the scissors (task 9.2: `BarSurface`, `GridSurface`).
 */
export interface BarsTrayProps {
  session: EditorSession
  /** Before an action: what the editor says goes. */
  onQuiet: () => void
}

/** The ends of a bar, with the sign on their key (the mock's). */
const ENDS: readonly { end: BarEnd; sign: string }[] = [
  { end: 'normal', sign: '│' },
  { end: 'double', sign: '‖' },
  { end: 'repeat', sign: ':‖' },
  { end: 'final', sign: '┃' },
]

const END_KEYS = { normal: 'bars.end.normal', double: 'bars.end.double', repeat: 'bars.end.repeat', final: 'bars.end.final' } as const satisfies Record<BarEnd, string>

export function BarsTray({ session, onQuiet }: BarsTrayProps) {
  const { t } = useShell().i18n
  const bar = session.currentBar.value
  const lines = session.barLines.value
  const ending = session.barEnding.value
  const off = lines === undefined
  const repeat = lines?.end === 'repeat'
  const times = repeat ? lines.times : MIN_REPEAT_TIMES

  const act = (action: () => unknown) => () => {
    onQuiet()
    action()
  }

  /** A key with a sign over its word; its name is the word. */
  const face = (sign: string, word: string): ComponentChildren => (
    <span class="editor-mark-face">
      <b class="editor-mark-sign" aria-hidden="true">
        {sign}
      </b>
      <span class="editor-mark-name">{word}</span>
    </span>
  )

  /** One step more or fewer passes; the steps of a held button are one undo step with the first. */
  const step = (direction: 1 | -1, repeated: boolean): void => {
    const next = times + direction
    if (!repeat || next < MIN_REPEAT_TIMES || next > MAX_REPEAT_TIMES) return
    onQuiet()
    session.setRepeatTimes(next, { amend: repeated })
  }

  return (
    <section class="editor-bars" aria-label={t('bars.tools')}>
      <h3 class="visually-hidden">{t('bar.label', { bar })}</h3>
      <div class="editor-bars-row editor-bars-row--lines">
        <div class="editor-bars-keys" role="group" aria-label={t('barline.start')}>
          <Chip pressed={lines?.start === 'repeat'} disabled={off} onPress={act(() => session.setBarStart(lines?.start === 'repeat' ? 'normal' : 'repeat'))}>
            {face('‖:', t('bars.start.repeat'))}
          </Chip>
        </div>
        <div class="editor-bars-keys editor-bars-keys--ends" role="group" aria-label={t('barline.end')}>
          {ENDS.map(({ end, sign }) => (
            <Chip key={end} pressed={lines?.end === end} disabled={off} onPress={act(() => lines?.end !== end && session.setBarEnd(end))}>
              {face(sign, t(END_KEYS[end]))}
            </Chip>
          ))}
        </div>
      </div>
      <div class="editor-bars-row editor-bars-row--endings">
        <Stepper
          size="compact"
          label={t('barline.times')}
          value={t('barline.timesValue', { count: times })}
          decrementLabel={t('barline.fewer')}
          incrementLabel={t('barline.more')}
          decrementDisabled={!repeat || times <= MIN_REPEAT_TIMES}
          incrementDisabled={!repeat || times >= MAX_REPEAT_TIMES}
          onDecrement={(repeated) => step(-1, repeated)}
          onIncrement={(repeated) => step(1, repeated)}
          repeat
        />
        {ending === null || ending === '1' || ending === '2' ? (
          <>
            <Chip pressed={ending === '1'} disabled={off} onPress={act(() => session.toggleEnding(1))}>
              {t('bars.ending.first')}
            </Chip>
            <Chip pressed={ending === '2'} disabled={off} onPress={act(() => session.toggleEnding(2))}>
              {t('bars.ending.second')}
            </Chip>
          </>
        ) : (
          <div class="editor-bars-other">
            <Chip onPress={act(() => session.removeEnding())}>{t('bars.ending.remove', { number: ending })}</Chip>
          </div>
        )}
      </div>
      <div class="editor-bars-row editor-bars-row--bars">
        <Chip disabled={off} onPress={act(() => session.addBar('before'))}>
          {t('bars.addBefore')}
        </Chip>
        <Chip disabled={off} onPress={act(() => session.addBar('after'))}>
          {t('bars.addAfter')}
        </Chip>
        <Chip off={!session.canCopyBarBefore.value} onPress={act(() => session.copyBarBefore())}>
          {t('bars.copy')}
        </Chip>
        <Chip off={!session.canJoinNext.value} onPress={act(() => session.joinNext())}>
          {t('bars.join')}
        </Chip>
        <Chip tone="danger" off={!session.canDeleteBar.value} onPress={act(() => session.deleteBar())}>
          {t('bars.delete')}
        </Chip>
      </div>
    </section>
  )
}
