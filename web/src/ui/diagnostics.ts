import { diag, diagContexts } from '../core/diag.ts'
import { activePractice } from './screens/activePractice.ts'

/*
 * The dev build's diagnostics (docs/testing.md "Dev build on the phone"): turns `core/diag.ts` on, logs errors
 * nothing caught, and once a second while a piece plays (or just stopped) writes a heartbeat that compares what
 * is heard with what the score highlights:
 *
 *   [diag] beat {"piece":…,"state":"playing","t":12.3,"dt":1.0,"out":0.05,"beat":7.2,"want":["n8"],"hl":["n8"],"frames":60,"contexts":[…]}
 *
 * `beat.MISMATCH` marks a heartbeat where the music is playing and the highlighted note is not the one heard, for
 * the second heartbeat running (one alone is the heartbeat looking just after a note began, before the next frame);
 * `frames` is how many times the cursor looked since the last heartbeat (0 while playing: its loop is gone);
 * `dt` is how far the audio clock moved (0 while playing: the clock stalled); `contexts` lists every audio
 * context still open (more than one: an old piece's audio is still there).
 *
 * `window.__snapsody.activePractice` gives the open session to the WebView inspector (chrome://inspect).
 */
export function startDiagnostics(): void {
  if (diag.on) return
  diag.enable()
  diag.log('diag.on', { ua: navigator.userAgent })
  ;(window as unknown as { __snapsody: unknown }).__snapsody = { activePractice, diagContexts }
  addEventListener('error', (event) => diag.log('window.error', { message: event.message, at: `${event.filename}:${event.lineno}:${event.colno}`, stack: (event.error as Error | undefined)?.stack }))
  addEventListener('unhandledrejection', (event) => {
    const reason = event.reason as unknown
    diag.log('window.rejection', { reason: reason instanceof Error ? `${reason.message}\n${reason.stack ?? ''}` : String(reason) })
  })
  document.addEventListener('visibilitychange', () => diag.log('page.visibility', { state: document.visibilityState }))

  let lastState = 'stopped'
  let lastTime: number | undefined
  let wasMismatch = false
  setInterval(() => {
    const frames = diag.take('cursor.frame')
    const session = activePractice.peek()
    if (!session) {
      lastState = 'stopped'
      lastTime = undefined
      return
    }
    const state = session.state.peek()
    if ((state === 'stopped' || state === 'paused') && state === lastState) return
    lastState = state
    const audio = session.player.backendInstance
    const t = audio?.currentTime
    const dt = t !== undefined && lastTime !== undefined ? Math.round((t - lastTime) * 1000) / 1000 : undefined
    lastTime = t
    const position = session.heard()
    const want = position?.events?.length ? position.events.flatMap((e) => e.noteIds) : (position?.event?.noteIds ?? [])
    const hl = [...document.querySelectorAll('.score-view .hl')].map((g) => g.id)
    const mismatch = state === 'playing' && want.length > 0 && !want.some((id) => hl.includes(id))
    const lasting = mismatch && wasMismatch
    wasMismatch = mismatch
    diag.log(lasting ? 'beat.MISMATCH' : 'beat', {
      piece: session.piece.id,
      player: session.player.diagId,
      state,
      bar: session.bar.peek(),
      following: session.following.peek(),
      t,
      dt,
      out: audio?.outputLatency,
      base: audio?.baseLatency,
      beat: position?.beat,
      finished: position?.finished,
      want,
      hl,
      cursor: (document.querySelector('.score-cursor') as HTMLElement | null)?.hidden === false,
      frames,
      ...(mismatch ? { mismatch: true } : {}),
      contexts: [...diagContexts].map(({ id, ctx }) => ({ id, state: ctx.state, t: Math.round(ctx.currentTime * 100) / 100 })),
    })
  }, 1000)
}
