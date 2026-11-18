import { useState } from 'preact/hooks'
import { Button, Card, Icon, SegmentedControl, Sheet } from '../components/index.ts'
import type { SegmentedOption } from '../components/index.ts'
import { useShell } from '../ShellContext.ts'
import { activePractice } from './activePractice.ts'

/**
 * The loop (frame 02.3; spec `practice-controls` "Loop a range of bars"): the first and last bar of the
 * passage and the rest between repeats. Nothing changes until "Start looping"; closing the sheet keeps
 * the loop as it was. With a loop on, it can be switched off here.
 */
type Rest = '0' | '1' | '2'

export function LoopSheet() {
  const { router, i18n } = useShell()
  const { t } = i18n
  const session = activePractice.value
  const bars = session?.bars ?? 1
  const bar = session?.bar.peek() ?? 1
  const loop = session?.loop.peek() ?? null
  const [from, setFrom] = useState(loop?.start ?? bar)
  const [to, setTo] = useState(loop?.end ?? Math.min(bars, bar + 1))
  const [rest, setRest] = useState<Rest>(String(session?.loopRest.peek() ?? 0) as Rest)
  if (!session) return null

  const close = (): void => router.closeSheet('loop')
  // The two ends stay in order: moving one past the other takes the other along.
  const changeFrom = (value: number): void => {
    setFrom(value)
    if (value > to) setTo(value)
  }
  const changeTo = (value: number): void => {
    setTo(value)
    if (value < from) setFrom(value)
  }
  const restOptions: readonly SegmentedOption<Rest>[] = [
    { value: '0', label: t('common.off') },
    { value: '1', label: t('unit.bars', { count: 1 }) },
    { value: '2', label: t('unit.bars', { count: 2 }) },
  ]

  return (
    <Sheet title={t('loop.title')} subtitle={t('loop.subtitle')} closeLabel={t('common.close')} onClose={close}>
      <div class="bar-fields">
        <BarField label={t('loop.from')} value={from} bars={bars} onChange={changeFrom} />
        <BarField label={t('loop.to')} value={to} bars={bars} onChange={changeTo} />
      </div>
      <h3 class="sheet-heading">{t('loop.rest')}</h3>
      <SegmentedControl label={t('loop.rest')} options={restOptions} value={rest} onChange={setRest} />
      <p class="t-caption sheet-hint">{t('loop.rest.hint')}</p>
      <Card tone="muted" label={t('loop.title')}>
        <p class="loop-note">{t('loop.note')}</p>
        <p class="loop-note-small">{t('loop.note.restart')}</p>
      </Card>
      <div class="sheet-action">
        <Button
          block
          onPress={() => {
            session.setLoop({ start: from, end: to })
            session.setLoopRest(Number(rest))
            close()
          }}
        >
          {t('loop.set', { from, to })}
        </Button>
      </div>
      {loop ? (
        <div class="sheet-action sheet-action--next">
          <Button
            variant="secondary"
            size="large"
            block
            onPress={() => {
              session.clearLoop()
              close()
            }}
          >
            {t('loop.clear')}
          </Button>
        </div>
      ) : null}
      <p class="sheet-foot sheet-foot--small">{t('loop.foot')}</p>
    </Sheet>
  )
}

/** A bar to choose: the frame's box with the label, the number big and a chevron. A native list does the choosing (it is the phone's own picker). */
function BarField({ label, value, bars, onChange }: { label: string; value: number; bars: number; onChange: (bar: number) => void }) {
  return (
    <label class="bar-field">
      <span class="bar-field-label">{label}</span>
      <span class="bar-field-value" aria-hidden="true">
        {value}
      </span>
      <Icon name="chevron-down" size={20} />
      <select class="bar-field-select" aria-label={label} value={value} onChange={(event) => onChange(Number(event.currentTarget.value))}>
        {Array.from({ length: bars }, (_, index) => (
          <option key={index + 1} value={index + 1}>
            {index + 1}
          </option>
        ))}
      </select>
    </label>
  )
}
