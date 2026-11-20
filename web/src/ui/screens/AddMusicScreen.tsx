import { useEffect, useState } from 'preact/hooks'
import { createAddMusic } from '../../app/addMusic.ts'
import type { AddMusicState } from '../../app/addMusic.ts'
import type { Screen } from '../../app/router.ts'
import { useShell } from '../ShellContext.ts'
import { BusyView, HintView, PartsView, ProblemView, ReadingView } from './AddMusicViews.tsx'

/**
 * Adding music (practice-app task 14.1, design D12 and D14; specs `score-capture`, `score-recognition`): one
 * `AddMusicFlow` for as long as the screen is open, drawn by its step (`AddMusicViews.tsx`).
 *
 * The router knows two screens for this, `add-music` and `reading`, and both are this component. The flow
 * does not leave the screen when the pages start to be read: the app frame gives a screen of another route a
 * new component, which would lose the flow and its reading, so the route stays `add-music` all through.
 *
 * What the flow does not do, this screen does, on the step the flow ends in:
 *  - `saved`, a new piece: the list is read again, and the editor opens in place of this screen, asking for the
 *    piece's name (`isNew`; spec `score-capture` "A new piece opens in the editor", change
 *    simplify-editor-and-name-new-pieces D4). Back from there goes to where adding music started, and Save &
 *    practice replaces the editor with practice;
 *  - `saved`, pages added to a piece: back to the editor under this screen, which opens again on the new score;
 *  - `parts` (a new piece with several parts): the parts step, which is the flow's own (Continue saves, Back is Cancel);
 *  - `cancelled`: back to where adding music started. Nothing was created and an existing piece is unchanged.
 * The system Back button and the screen's own Back and Cancel are all `flow.cancel()`: while the pages are read
 * it stops the reading (the flow then ends `cancelled` and the screen goes back); on the hint and on a message
 * it ends the flow at once; while the scanner opens and while the piece is saved it does nothing.
 */
type AddMusicRoute = Extract<Screen, { name: 'add-music' | 'reading' }>
type Saved = Extract<AddMusicState, { step: 'saved' }>

export function AddMusicScreen({ screen }: { screen: AddMusicRoute }) {
  const shell = useShell()
  const { platform, library, settings, i18n, view, router } = shell
  const [flow] = useState(() =>
    createAddMusic(
      {
        scanner: platform.scanner,
        reader: platform.reader,
        files: platform.files,
        library,
        settings,
        defaultName: (added) => i18n.defaultPieceName(added),
      },
      screen.pieceId === undefined ? {} : { pieceId: screen.pieceId },
    ),
  )
  const state = flow.state.value

  const cancel = (): void => void flow.cancel()

  // Open the flow, and let Back cancel it. Leaving the screen by any other way stops a reading that is still going.
  useEffect(() => {
    const release = router.setLeaveGuard(() => {
      void flow.cancel()
      return false // the flow ends `cancelled` and the effect below goes back; a false here keeps Back from popping twice
    })
    void flow.start()
    return () => {
      release()
      void flow.cancel()
    }
  }, [flow, router])

  // Where the flow ends, the screen hands over. Only while this screen is still the top one.
  const step = state.step
  useEffect(() => {
    const now = flow.state.peek()
    if (now.step === 'cancelled') {
      if (router.screen.peek() === screen) router.pop()
    } else if (now.step === 'saved') {
      void handOver(now)
    }

    async function handOver(saved: Saved): Promise<void> {
      await view.refresh().catch(() => undefined) // the shell reads the list again when a list screen shows; this makes it right at once
      if (router.screen.peek() !== screen) return
      if (saved.added) router.pop()
      else router.replace({ name: 'editor', pieceId: saved.pieceId, isNew: true })
      // After the move: going to another screen ends the notice of the last one.
      if (saved.partDropped) shell.notify('add.partDropped')
    }
  }, [step, flow, router, view, screen, shell])

  switch (state.step) {
    case 'hint':
      return <HintView flow={flow} onBack={cancel} />
    case 'reading':
      return <ReadingView flow={flow} progress={state.progress} onCancel={cancel} />
    case 'parts':
      return <PartsView flow={flow} state={state} onBack={cancel} />
    case 'no-music':
    case 'failed':
    case 'unavailable':
      return <ProblemView problem={state} flow={flow} onBack={cancel} />
    case 'saving':
    case 'saved':
      return <BusyView step="saving" />
    case 'scanning':
      return <BusyView step="scanning" />
    default:
      // idle (before the flow has started) and cancelled (the screen is about to go back)
      return <BusyView step={state.step} />
  }
}
