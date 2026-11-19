import { useEffect, useRef } from 'preact/hooks'
import { mountScoreIsland } from './scoreIsland.ts'
import type { ScoreIslandHandle, ScoreIslandOptions } from './scoreIsland.ts'

/**
 * The score on the practice screen and in the editor: a Preact component that only mounts the
 * imperative island (scoreIsland.ts) in one `div` and gives it the props. It renders that `div` and
 * nothing inside it, so Preact never touches the drawing, and it reads no signal while rendering, so
 * playback never renders it: the island follows the signals itself.
 *
 * The signals (`bar`, `following`, `shownBar`, `playing`, `selected`) belong to one practice session or
 * editor session: pass new ones and the island is mounted again. The callbacks and `heard` may change
 * between renders; the island always calls the latest. A new `score` is laid out in place.
 */
export interface ScoreIslandProps extends ScoreIslandOptions {
  /** The name of the score region for screen readers ("Score"). */
  label: string
}

export function ScoreIsland(props: ScoreIslandProps) {
  const root = useRef<HTMLDivElement>(null)
  const handle = useRef<ScoreIslandHandle | undefined>(undefined)
  const latest = useRef(props)
  latest.current = props

  useEffect(() => {
    const island = mountScoreIsland(root.current!, {
      score: latest.current.score,
      bar: props.bar,
      following: props.following,
      shownBar: props.shownBar,
      playing: props.playing,
      ...(props.selected ? { selected: props.selected } : {}),
      ...(props.flagged ? { flagged: props.flagged } : {}),
      ...(props.flaggedBars ? { flaggedBars: props.flaggedBars } : {}),
      heard: () => latest.current.heard(),
      onScrollAway: (bar) => latest.current.onScrollAway(bar),
      onTapNote: (id, info) => latest.current.onTapNote(id, info),
      // Opt-in: only the editor passes it, so the practice screen keeps resolving taps to notes alone.
      ...(props.onTapElement ? { onTapElement: (ref) => latest.current.onTapElement?.(ref) } : {}),
      ...(props.selectedElement ? { selectedElement: props.selectedElement } : {}),
    })
    handle.current = island
    return () => {
      island.dispose()
      handle.current = undefined
    }
  }, [props.bar, props.following, props.shownBar, props.playing, props.selected, props.flagged, props.flaggedBars, props.selectedElement])

  useEffect(() => {
    void handle.current?.setScore(props.score)
  }, [props.score])

  // Focusable so that a keyboard can scroll it; its name tells a screen reader what it is.
  return <div ref={root} class="score-island" role="region" aria-label={props.label} tabIndex={0} />
}
