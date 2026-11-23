import { useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import { barForEditing } from '../../../app/editorSession.ts'
import type { EditorSession } from '../../../app/editorSession.ts'
import { middleLine } from '../../../core/score/edit.ts'
import type { ElementRef } from '../../../core/score/elements.ts'
import { partIndex } from '../../../core/score/model.ts'
import type { Pitch, Score } from '../../../core/score/model.ts'
import { createScoreView } from '../../scoreView.ts'
import type { ScoreView } from '../../scoreView.ts'
import { dragAxis, dragSteps, halfGap, hitBar, ledgerSteps, STAFF_REACH_STEPS, stepAt, yOfStep } from '../../notesSurface.ts'
import type { SlotGeometry, StaffGeometry } from '../../notesSurface.ts'
import { useShell } from '../../ShellContext.ts'
import { drawnNote, readBarLayout } from './barLayout.ts'
import { fromExcerpt, toExcerpt } from './frame.ts'

/**
 * The large bar in Notes (change redesign-score-editor, design D2): the current bar of the part being edited, drawn by
 * Verovio from `barForEditing` to fill the width at the height the frame gives it, with the selection, the selected
 * element and the flags on it, and an overlay for what Verovio does not draw: the slots and a pitch drag.
 *
 * The touches are this component's (`ownTaps` of the score view), with pointer events on a box around the drawing that
 * captures the pointer, so a gesture goes on while the drawing is replaced after an edit:
 *
 * - A touch first looks for an element under the finger (a clef, a slur, a mark, a bar line: `elementAtPoint`), then for
 *   what `hitBar` finds: a note or rest in whose column it is, the slot, or the staff where there is no note; else the
 *   nearest note within a finger's reach, as before; else nothing. An element and nothing are given to the editor on
 *   release, if the finger did not move away (`onTapElement`); a note too (`onTapNote`), unless it was dragged.
 * - A drag that starts on a note does nothing until the finger has moved 8 px; then the larger axis decides, for the rest
 *   of the gesture. Up or down, with the Notes tools open, is a pitch drag of that note (a chord's note on its own): the
 *   note is selected, a ghost notehead follows the finger from staff step to staff step, counted from where the drag was
 *   decided, with the note's name beside it, and each new step sounds (`soundPitch`). On release the steps are applied
 *   once (`dragPitch`, one undo step), and the bar is drawn again. Sideways is the slide of a slur (task 7.2), not here yet.
 * - Where a tap may add a note (`canAddByTap`), a touch in the slot or on the staff adds one at once, at the staff step
 *   under the finger (`addAtSlot`, `addOnStaff`), and it sounds; while the finger stays down it is dragged to its pitch
 *   by the steps from where it came down, with the ghost and its name, and the release is part of the same undo step.
 *
 * What it draws is one bar as a score of its own, so the elements it finds are named in the score through `fromExcerpt`
 * before the editor sees them.
 */
export interface BarSurfaceProps {
  session: EditorSession
  /** The notes to mark as flagged: those a warning is about, and those of the bars that do not add up. */
  flagged: readonly string[]
  flaggedBars: readonly string[]
  onTapNote: (id: string) => void
  /** An element tapped, named in the score, or undefined for a tap on nothing. */
  onTapElement: (ref: ElementRef | undefined) => void
  /** Before a note is added or dragged: what the editor says goes. */
  onQuiet: () => void
}

/** A gesture on the large bar, from the touch to the release. */
type Gesture =
  | { kind: 'element'; ref: ElementRef; x0: number; y0: number; moved: boolean }
  | { kind: 'empty'; x0: number; y0: number; moved: boolean }
  | { kind: 'note'; id: string; x0: number; y0: number; axis: 'none' | 'vertical' | 'horizontal'; drag?: PitchDrag }
  /** A note added by the touch, dragged to its pitch while the finger stays down. */
  | { kind: 'added'; id: string; drag: PitchDrag; y0: number }
  | { kind: 'done' }

/** A pitch drag: the staff the note is on, its step, where the drag counts from, and the steps it has gone. */
interface PitchDrag {
  id: string
  staff: StaffGeometry
  step: number
  fromY: number
  steps: number
}

/** What the overlay draws, in the box's own coordinates. */
interface Overlay {
  slots: readonly SlotGeometry[]
  /** The two staff-line heights of each slot's staff, for its height. */
  slotStaves: ReadonlyMap<number, { top: number; bottom: number }>
  ghost?: { x: number; y: number; rx: number; ry: number; ledgers: readonly number[]; lineHalf: number; name: string; nameLeft: boolean }
}

const EMPTY: Overlay = { slots: [], slotStaves: new Map() }

/** The pitch on the middle line of each staff of the part `part` in a one-bar score (its clef in force). */
function middlesOf(excerpt: Score, part: string): number[] {
  const pi = partIndex(excerpt, part)
  const staves = excerpt.bars[0]?.parts[pi]?.staves ?? []
  return staves.map((s) => middleLine(s.clef ?? { sign: 'G', line: 2 }))
}

export function BarSurface({ session, flagged, flaggedBars, onTapNote, onTapElement, onQuiet }: BarSurfaceProps) {
  const { i18n } = useShell()
  const box = useRef<HTMLDivElement>(null)
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<ScoreView | undefined>(undefined)
  /** The excerpt given to the view last, and the bar (from 1) it is. */
  const drawn = useRef<{ excerpt: Score; bar: number } | undefined>(undefined)
  const gesture = useRef<Gesture>({ kind: 'done' })
  const latest = useRef({ onTapNote, onTapElement, onQuiet, i18n })
  latest.current = { onTapNote, onTapElement, onQuiet, i18n }
  const [overlay, setOverlay] = useState<Overlay>(EMPTY)

  const score = session.score.value
  const bar = session.currentBar.value
  const part = session.part.value
  const excerpt = useMemo(() => barForEditing(score, bar - 1), [score, bar])
  const selectedId = session.selection.value?.noteId ?? null
  const element = session.selectedElement.value?.ref

  /** The layout of the drawn bar, measured now. */
  const layoutNow = () => {
    const root = view.current?.element
    const shown = drawn.current
    if (!root || !shown) return { staves: [], notes: [], slots: [] }
    return readBarLayout(root, middlesOf(shown.excerpt, session.part.peek()), session.slots.peek())
  }

  /** The overlay's slots, measured again after the bar is drawn. */
  const measureSlots = () => {
    const origin = box.current?.getBoundingClientRect()
    if (!origin) return
    const layout = layoutNow()
    const slots = layout.slots.map((s) => ({ ...s, left: s.left - origin.left, right: s.right - origin.left }))
    const slotStaves = new Map(layout.staves.map((s) => [s.staff, { top: s.top - origin.top, bottom: s.bottom - origin.top }]))
    setOverlay((now) => ({ ...now, slots, slotStaves }))
  }

  useLayoutEffect(() => {
    drawn.current = { excerpt, bar }
    const root = host.current!
    const made = createScoreView(root, excerpt, {
      part: { id: part },
      multiRests: 'expand',
      fit: true,
      ownTaps: true,
      // The bar on show, once it is drawn (the journeys wait for it): the drawing of the bar before stays until then.
      onRender: () => {
        root.dataset.bar = String(drawn.current?.bar ?? '')
        measureSlots()
        // A note being dragged stays faded in the new drawing.
        const g = gesture.current
        const id = g.kind === 'added' ? g.id : g.kind === 'note' && g.drag ? g.id : undefined
        if (id) drawnNote(made.element, id)?.classList.add('is-dragged')
      },
    })
    view.current = made
    return () => {
      made.dispose()
      view.current = undefined
    }
    // One view for the screen's life: the bar, the score and the part are given to it below.
  }, [session])

  useLayoutEffect(() => {
    if (drawn.current?.excerpt === excerpt) return
    drawn.current = { excerpt, bar }
    void view.current?.setScore(excerpt)
  }, [excerpt])

  useLayoutEffect(() => {
    void view.current?.setPart({ id: part })
  }, [part])

  useLayoutEffect(() => {
    view.current?.mark('sel', selectedId ? [selectedId] : [])
  }, [selectedId])

  useLayoutEffect(() => {
    view.current?.mark('flag', [...flagged])
    view.current?.mark('flagbar', [...flaggedBars])
  }, [flagged, flaggedBars])

  useLayoutEffect(() => {
    view.current?.markElement(element ? toExcerpt(score, bar - 1, element) : undefined)
  }, [element, score, bar])

  /** Shows the ghost of a pitch drag, or takes it away. */
  const showGhost = (drag: PitchDrag | undefined, pitch: Pitch | undefined) => {
    const root = view.current?.element
    const origin = box.current?.getBoundingClientRect()
    for (const g of root?.querySelectorAll('.is-dragged') ?? []) if (!drag || g.id !== drag.id) g.classList.remove('is-dragged')
    if (!drag || !root || !origin || !pitch) {
      setOverlay((now) => (now.ghost ? { slots: now.slots, slotStaves: now.slotStaves } : now))
      return
    }
    drawnNote(root, drag.id)?.classList.add('is-dragged')
    // Measured again: a note added by the touch may have been drawn since, and the bar laid out anew around it.
    const layout = layoutNow()
    const staff = layout.staves.find((s) => s.staff === drag.staff.staff) ?? drag.staff
    const head = layout.notes.find((n) => n.id === drag.id)?.head
    const gap = halfGap(staff)
    const step = (head ? stepAt(staff, (head.top + head.bottom) / 2) : drag.step) + drag.steps
    const x = (head ? (head.left + head.right) / 2 : staff.left + 20) - origin.left
    const rx = head ? Math.max((head.right - head.left) / 2, gap * 1.2) : gap * 1.3
    const y = yOfStep(staff, step) - origin.top
    setOverlay((now) => ({
      ...now,
      ghost: {
        x,
        y,
        rx,
        ry: gap * 0.95,
        ledgers: ledgerSteps(step).map((s) => yOfStep(staff, s) - origin.top),
        lineHalf: rx * 1.7,
        name: latest.current.i18n.noteName(pitch),
        nameLeft: x > origin.width - 84,
      },
    }))
  }

  /** The drag has gone to `y`: its steps, and when they changed the ghost, the name and the sound. */
  const follow = (drag: PitchDrag, steps: number) => {
    const reach = 4 + STAFF_REACH_STEPS + 2
    const bounded = Math.max(-reach - drag.step, Math.min(reach - drag.step, steps))
    const changed = bounded !== drag.steps
    drag.steps = bounded
    const pitch = session.pitchAfterSteps(drag.id, bounded)
    showGhost(drag, pitch)
    if (changed && pitch) void session.soundPitch(pitch)
  }

  const onPointerDown = (event: PointerEvent) => {
    if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return
    const root = view.current?.element
    if (!root || root.dataset.rendered !== 'true') return
    // No preventDefault: the touch still takes the focus away from the title, so the keyboard goes; `touch-action` and
    // `user-select` keep the page from scrolling or selecting text.
    box.current?.setPointerCapture(event.pointerId)
    const x = event.clientX
    const y = event.clientY
    const ref = view.current!.elementAtPoint(x, y)
    if (ref) {
      gesture.current = { kind: 'element', ref, x0: x, y0: y, moved: false }
      return
    }
    const layout = layoutNow()
    const hit = hitBar(layout, x, y, session.canAddByTap.peek())
    if (hit.kind === 'note') {
      gesture.current = { kind: 'note', id: hit.id, x0: x, y0: y, axis: 'none' }
      return
    }
    if (hit.kind === 'slot' || hit.kind === 'staff') {
      latest.current.onQuiet()
      const id = hit.kind === 'slot' ? session.addAtSlot(hit.staff, hit.pitch) : session.addOnStaff(hit.staff, hit.pitch, hit.right)
      const staff = layout.staves.find((s) => s.staff === hit.staff)
      if (!id || !staff) {
        gesture.current = { kind: 'done' }
        return
      }
      const drag: PitchDrag = { id, staff, step: stepAt(staff, y), fromY: y, steps: 0 }
      gesture.current = { kind: 'added', id, drag, y0: y }
      const pitch = session.pitchAfterSteps(id, 0)
      if (pitch) void session.soundPitch(pitch)
      return
    }
    // Outside the staff: the nearest note within a finger's reach, as practice finds one.
    const info = view.current!.noteAtPoint(x, y)
    gesture.current = info ? { kind: 'note', id: info.note.id, x0: x, y0: y, axis: 'none' } : { kind: 'empty', x0: x, y0: y, moved: false }
  }

  const onPointerMove = (event: PointerEvent) => {
    const g = gesture.current
    if (!event.isPrimary || g.kind === 'done') return
    const x = event.clientX
    const y = event.clientY
    if (g.kind === 'element' || g.kind === 'empty') {
      if (dragAxis(x - g.x0, y - g.y0) !== 'none') g.moved = true
      return
    }
    if (g.kind === 'added') {
      follow(g.drag, stepAt(g.drag.staff, y) - stepAt(g.drag.staff, g.y0))
      return
    }
    if (g.axis === 'none') {
      g.axis = dragAxis(x - g.x0, y - g.y0)
      if (g.axis !== 'vertical' || session.tools.peek() !== 'notes') return
      const root = view.current?.element
      const layout = layoutNow()
      const note = layout.notes.find((n) => n.id === g.id)
      const staff = note && layout.staves.find((s) => s.staff === note.staff)
      if (!root || !note || note.rest || !staff) return
      latest.current.onTapNote(g.id)
      g.drag = { id: g.id, staff, step: stepAt(staff, (note.head.top + note.head.bottom) / 2), fromY: y, steps: 0 }
      return
    }
    if (g.drag) follow(g.drag, dragSteps(halfGap(g.drag.staff), g.drag.fromY, y))
  }

  const end = (event: PointerEvent, cancelled: boolean) => {
    if (!event.isPrimary) return
    const g = gesture.current
    gesture.current = { kind: 'done' }
    showGhost(undefined, undefined)
    if (g.kind === 'done' || cancelled) {
      // The note a touch added stays where it was added; the drag that follows it is over.
      if (g.kind === 'added') session.dragPitch(g.id, 0)
      return
    }
    const { onTapNote: tapNote, onTapElement: tapElement, onQuiet: quiet } = latest.current
    if (g.kind === 'element') {
      if (!g.moved) tapElement(fromExcerpt(session.score.peek(), session.currentBar.peek() - 1, g.ref))
    } else if (g.kind === 'empty') {
      if (!g.moved) tapElement(undefined)
    } else if (g.kind === 'added') {
      session.dragPitch(g.id, g.drag.steps)
    } else if (g.axis === 'none') {
      tapNote(g.id)
    } else if (g.drag && g.drag.steps !== 0) {
      quiet()
      session.dragPitch(g.id, g.drag.steps)
    }
  }

  const ghost = overlay.ghost
  return (
    <div
      ref={box}
      class="editor-bar"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => end(event, false)}
      onPointerCancel={(event) => end(event, true)}
    >
      <div ref={host} class="editor-bar-host" />
      <svg class="editor-bar-overlay" aria-hidden="true">
        {overlay.slots.map((slot) => {
          const lines = overlay.slotStaves.get(slot.staff)
          if (!lines) return null
          const pad = (lines.bottom - lines.top) / 6
          const top = lines.top - pad
          const height = lines.bottom - lines.top + 2 * pad
          return (
            <g key={`${slot.staff}`} class="editor-slot" data-staff={slot.staff}>
              <rect x={slot.left} y={top} width={slot.right - slot.left} height={height} rx={4} />
              {/* Over a bar of rest, the sign keeps clear of the rest in the middle. */}
              <text x={slot.covers ? slot.left + (slot.right - slot.left) * 0.82 : (slot.left + slot.right) / 2} y={top + height / 2}>
                +
              </text>
            </g>
          )
        })}
        {ghost ? (
          <g class="editor-ghost">
            {ghost.ledgers.map((y) => (
              <line key={y} x1={ghost.x - ghost.lineHalf} x2={ghost.x + ghost.lineHalf} y1={y} y2={y} />
            ))}
            <ellipse cx={ghost.x} cy={ghost.y} rx={ghost.rx} ry={ghost.ry} />
          </g>
        ) : null}
      </svg>
      {ghost ? (
        <span
          class={ghost.nameLeft ? 'editor-drag-name editor-drag-name--left' : 'editor-drag-name'}
          role="status"
          style={{ left: `${ghost.nameLeft ? ghost.x - ghost.rx - 8 : ghost.x + ghost.rx + 8}px`, top: `${ghost.y}px` }}
        >
          {ghost.name}
        </span>
      ) : null}
    </div>
  )
}
