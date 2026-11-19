import { clampTempo, tempoSetup } from '../../../core/playback/tempo.ts'
import { firstTempoMarking, setKey, setTempoMarking, setTime } from '../../../core/score/edit.ts'
import { Button, Stepper } from '../../components/index.ts'
import { useShell } from '../../ShellContext.ts'
import { SelectField } from './controls.tsx'
import type { ToolProps } from './NoteTab.tsx'

/**
 * The Score tab (frame 06.3, spec `score-editing` "Flags shown for review", design D14): what holds for the
 * whole score. The key signature, the time signature and the written tempo, all at the start of the piece
 * (what `core/score/edit.ts` changes). The tempo is the metronome mark printed in the book, in steps of two
 * beats per minute (holding a button keeps stepping, as one undo step); the speed the user practises at is
 * separate and is not changed here.
 *
 * At its foot, "Add pages" (change simplify-editor-and-name-new-pieces, D3): scanning more pages that go after the
 * last bar. The editor's handler asks to save first, as adding pages opens the piece again.
 */

/** The time signatures offered, as "beats/beat type"; the one the piece has is added when it is none of these. */
const TIMES: readonly string[] = ['2/4', '3/4', '4/4', '5/4', '6/4', '2/2', '3/2', '3/8', '5/8', '6/8', '7/8', '9/8', '12/8']

/** Beats per minute a step of the tempo stepper changes. */
const TEMPO_STEP = 2

const FIFTHS: readonly number[] = [-7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7]

export function ScoreTab({ session, run, onAddPages }: ToolProps & { onAddPages: () => void }) {
  const { i18n } = useShell()
  const { t } = i18n
  const score = session.score.value
  const first = score.measures[0]
  const fifths = first?.key?.fifths ?? 0
  const time = first?.time ? `${first.time.beats}/${first.time.beatType}` : ''
  const times = time === '' || TIMES.includes(time) ? TIMES : [...TIMES, time]
  const marking = firstTempoMarking(score)
  const written = marking?.perMinute

  const keyLabel = (n: number): string => (n === 0 ? t('key.none') : n > 0 ? t('key.sharps', { count: n }) : t('key.flats', { count: -n }))

  /**
   * Moves the written tempo a step; with none yet it starts from the tempo the piece plays at now, counted in quarter notes.
   * The steps of a held button (`repeated`) are one undo step with the first.
   */
  const step = (direction: 1 | -1, repeated: boolean): void => {
    const setup = tempoSetup(score)
    const base = written ?? Math.round((setup.defaultBpm * setup.unit.n) / setup.unit.d)
    const perMinute = clampTempo(base + direction * TEMPO_STEP)
    run((s) =>
      setTempoMarking(s, {
        ...(marking?.words ? { words: marking.words } : {}),
        perMinute,
        ...(written !== undefined && marking?.beatUnit ? { beatUnit: marking.beatUnit } : {}),
        ...(written !== undefined && marking?.beatUnitDots ? { beatUnitDots: marking.beatUnitDots } : {}),
      }),
      undefined,
      { amend: repeated },
    )
  }

  return (
    <div class="editor-grid editor-grid--score">
      <span class="editor-field-label">{t('score.key')}</span>
      <SelectField
        label={t('score.key')}
        value={String(fifths)}
        disabled={!first}
        options={FIFTHS.map((n) => ({ value: String(n), label: keyLabel(n) }))}
        onChange={(value) => run((s) => setKey(s, Number(value)))}
      />

      <span class="editor-field-label">{t('score.time')}</span>
      <SelectField
        label={t('score.time')}
        value={time}
        disabled={!first}
        options={[
          ...(time === '' ? [{ value: '', label: t('score.time.none'), disabled: true }] : []),
          ...times.map((value) => ({ value, label: value.replace('/', ' / ') })),
        ]}
        onChange={(value) => {
          const [beats, beatType] = value.split('/').map(Number)
          if (beats && beatType) run((s) => setTime(s, beats, beatType))
        }}
      />

      <span class="editor-field-label">{t('score.tempo')}</span>
      <Stepper
        size="compact"
        label={t('score.tempo')}
        value={written === undefined ? '–' : t('unit.bpm', { count: Math.round(written) })}
        decrementLabel={t('score.tempo.lower')}
        incrementLabel={t('score.tempo.higher')}
        decrementDisabled={!first || (written !== undefined && written <= clampTempo(0))}
        incrementDisabled={!first || (written !== undefined && written >= clampTempo(1000))}
        onDecrement={(repeated) => step(-1, repeated)}
        onIncrement={(repeated) => step(1, repeated)}
        repeat
      />
      <p class="editor-hint editor-hint--wide">{t('score.tempoHint')}</p>

      <div class="editor-add-pages">
        <Button variant="secondary" block onPress={onAddPages}>
          {t('editor.addPages')}
        </Button>
        <p class="editor-hint">{t('editor.addPages.hint', { bar: score.measures.length })}</p>
      </div>
    </div>
  )
}
