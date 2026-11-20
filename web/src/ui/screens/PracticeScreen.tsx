import { computed } from '@preact/signals'
import type { ReadonlySignal } from '@preact/signals'
import { useEffect, useState } from 'preact/hooks'
import { LibraryError } from '../../app/library.ts'
import { PracticeSession } from '../../app/practiceSession.ts'
import type { Screen } from '../../app/router.ts'
import { TEMPO_MAX, TEMPO_MIN } from '../../core/playback/tempo.ts'
import { createWebAudioBackend } from '../../core/playback/webBackend.ts'
import { Button, Icon, IconButton, Stepper } from '../components/index.ts'
import { ScoreIsland } from '../ScoreIsland.tsx'
import { useShell } from '../ShellContext.ts'
import { activePractice, soundProblem } from './activePractice.ts'

/*
 * Practising a piece (frames 02.1 portrait and 02.2 landscape; specs `practice-controls`,
 * `score-playback` "Cursor follows playback", `app-shell` "Practice in portrait and landscape"): the
 * header with only the title (design D19), the score, and Restart, Play or Pause, Loop, the
 * tempo and the metronome. One DOM serves both orientations; `styles/practice.css` lays it out as the
 * portrait or the landscape frame.
 *
 * The session. `App` draws only the screen on top of the router's stack, so this screen is mounted when
 * the piece is opened and unmounted when something is pushed over it (the editor) or it is left. It
 * opens its `PracticeSession` when it mounts and closes it when it unmounts: coming back from the
 * editor mounts it again, which reads the piece afresh, so a saved edit is what is practised (design
 * D12). The session's sheets (tools, loop) reach it through `activePractice`.
 *
 * Everything on the screen is read from the session's signals; the score island follows them itself
 * and is never drawn again while the music plays (design D3).
 */

type Opened = { session: PracticeSession; playing: ReadonlySignal<boolean> }

/** The screens whose `autoplay` has been honoured: a screen that mounts again (after the editor) does not start by itself. */
const played = new WeakSet<object>()

export function PracticeScreen({ screen }: { screen: Extract<Screen, { name: 'practice' }> }) {
  const shell = useShell()
  const { i18n, router, view, settings, platform } = shell
  const { t } = i18n
  const [opened, setOpened] = useState<Opened | null>(null)
  const [failed, setFailed] = useState<'error.pieceMissing' | 'error.pieceDamaged' | 'error.generic' | null>(null)

  useEffect(() => {
    let live = true
    let mine: PracticeSession | undefined
    soundProblem.value = false
    PracticeSession.open(screen.pieceId, {
      library: shell.library,
      settings,
      device: platform.device,
      // The session closes every backend it is given, so each call makes a new one.
      backend: (instrument) => createWebAudioBackend({ sound: instrument.sound }),
    }).then(
      (session) => {
        if (!live) {
          void session.close().catch(() => undefined)
          return
        }
        mine = session
        activePractice.value = session
        setOpened({ session, playing: computed(() => session.state.value === 'playing') })
        if (screen.autoplay && !played.has(screen)) {
          played.add(screen)
          void session.play().catch(() => (soundProblem.value = true))
        }
      },
      (error: unknown) => {
        if (!live) return
        setFailed(error instanceof LibraryError ? (error.code === 'not-found' ? 'error.pieceMissing' : 'error.pieceDamaged') : 'error.generic')
      },
    )
    return () => {
      live = false
      const session = mine
      if (!session) return
      if (activePractice.peek() === session) activePractice.value = null
      // Closing saves the bar and the settings; the lists that show them are read again once that is done.
      void session
        .close()
        .catch(() => undefined)
        .then(() => shell.home.refresh())
        .catch(() => undefined)
    }
    // The screen is for one piece: another piece is another screen (`App` keys it).
  }, [])

  const session = opened?.session
  // The session read the piece when it opened, so its name is the newest; the list's is there until then.
  const name = session?.piece.name ?? view.pieces.value.find((p) => p.id === screen.pieceId)?.name ?? ''

  return (
    <div class="screen practice" data-screen="practice" data-piece-id={screen.pieceId}>
      <header class="practice-header">
        <IconButton label={t('common.back')} icon="back" onPress={() => void router.back()} />
        <h1 class="practice-title">{name}</h1>
        <IconButton label={t('practice.more')} icon="more" disabled={!session} onPress={() => router.openSheet('tools')} />
      </header>
      {failed ? (
        <p class="practice-problem" role="alert">
          {t(failed)}
        </p>
      ) : null}
      {opened ? <Practising opened={opened} /> : <div class="practice-score practice-score--empty" />}
    </div>
  )
}

function Practising({ opened }: { opened: Opened }) {
  const { session, playing } = opened
  const { i18n, router } = useShell()
  const { t } = i18n
  const state = session.state.value
  const going = state === 'playing' || state === 'loading'
  const tempo = session.tempo.value
  const loop = session.loop.value
  const metronome = session.metronome.value
  const alone = session.metronomeAlone.value
  const counting = session.counting.value

  const toggle = (): void => {
    if (going) {
      session.pause()
      return
    }
    soundProblem.value = false
    void session.play().catch(() => (soundProblem.value = true))
  }

  // Switched on while nothing plays, the metronome clicks on its own: it can be the first press that
  // needs the sound, so a failure is told as a failed Play is.
  const toggleMetronome = (): void => {
    soundProblem.value = false
    void session.toggleMetronome().catch(() => (soundProblem.value = true))
  }

  return (
    <>
      <div class="practice-score">
        <ScoreIsland
          label={t('practice.score')}
          score={session.score}
          bar={session.bar}
          following={session.following}
          shownBar={session.shownBar}
          playing={playing}
          heard={() => session.heard()}
          onScrollAway={(bar) => session.showBar(bar)}
          onTapNote={(id) => session.goToNote(id)}
        />
        {counting ? (
          <div class="practice-count" role="status" aria-label={t('practice.countIn.beat', { n: counting.n, of: counting.of })}>
            <span aria-hidden="true">{counting.n}</span>
          </div>
        ) : null}
        {session.following.value ? null : (
          <div class="practice-return">
            <Button size="small" onPress={() => session.returnToPlaying()}>
              {t('practice.returnToPlaying')}
            </Button>
          </div>
        )}
        {soundProblem.value ? (
          <p class="practice-problem practice-problem--over" role="alert">
            {t('practice.error.sound')}
          </p>
        ) : null}
      </div>

      <div class="practice-controls">
        <div class="practice-row practice-row--main">
          <div class="practice-action practice-action--restart">
            <IconButton label={t('practice.restart')} icon="restart" size={48} onPress={() => session.restart()} />
            <span class="practice-action-label" aria-hidden="true">
              {t('practice.restart')}
            </span>
          </div>
          <div class="practice-action practice-action--play">
            <button type="button" class="play-button" aria-label={going ? t('practice.pause') : t('practice.play')} onClick={toggle}>
              <Icon name={going ? 'pause' : 'play'} />
            </button>
            <span class="practice-action-label" aria-hidden="true">
              {going ? t('practice.pause') : t('practice.play')}
            </span>
          </div>
          {/* The same shape as Restart in portrait (a square with its label under it), a pill in landscape. The label is its name. */}
          <button type="button" class={`loop-button${loop ? ' loop-button--on' : ''}`} aria-haspopup="dialog" onClick={() => router.openSheet('loop')}>
            <span class="loop-icon" aria-hidden="true">
              <Icon name="loop" size={20} />
            </span>
            <span class="loop-label">{loop ? t('practice.loopOn', { from: loop.start, to: loop.end }) : t('practice.loopOff')}</span>
          </button>
        </div>
        <div class="practice-row practice-row--tune">
          <Stepper
            label={t('practice.tempo')}
            value={String(tempo)}
            unit={t('practice.tempo.unit')}
            decrementLabel={t('practice.tempo.slower')}
            incrementLabel={t('practice.tempo.faster')}
            decrementDisabled={tempo <= TEMPO_MIN}
            incrementDisabled={tempo >= TEMPO_MAX}
            onDecrement={() => session.setTempo(tempo - 1)}
            onIncrement={() => session.setTempo(tempo + 1)}
            repeat
          />
          {/* aria-pressed is the switch; the class says it is clicking on its own, without the music (a fuller tint). */}
          <button
            type="button"
            class={`metronome-toggle${alone ? ' metronome-toggle--alone' : ''}`}
            aria-pressed={metronome}
            aria-label={t('practice.metronome')}
            onClick={toggleMetronome}
          >
            <Icon name="metronome" />
            <span class="metronome-text">
              <span class="metronome-name">{t('practice.metronome')}</span>
              <span class="metronome-state">{metronome ? t('common.on') : t('common.off')}</span>
            </span>
          </button>
        </div>
      </div>
    </>
  )
}
