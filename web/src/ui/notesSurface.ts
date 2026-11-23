/*
 * The geometry of the large bar in Notes (change redesign-score-editor, design D2; spec `score-editing` "Notes view", "Drag
 * a note to change its pitch", "A bar always takes a note"): what a touch on the drawn bar is on, which staff step a
 * height is, and how far a drag has gone in staff steps. Plain geometry on boxes in screen coordinates, so a quick test
 * can prove it; `BarSurface.tsx` measures the boxes in Verovio's drawing (`barLayout.ts`) and turns the answers into the
 * session's actions.
 */

/** A box in screen coordinates. */
export interface Box {
  left: number
  right: number
  top: number
  bottom: number
}

/** A staff of the drawn bar. */
export interface StaffGeometry {
  /** The staff, from 0 (the left hand of a piano part is 1). */
  staff: number
  /** The heights of its top and bottom lines. */
  top: number
  bottom: number
  /** Where notes can go: after the clef, key and time signature at the start of the bar. */
  left: number
  /** The end of the bar: its right bar line. */
  right: number
  /** The pitch on the middle line, in diatonic steps from C0 (`middleLine` of the clef in force: B4 is 34). */
  middle: number
}

/** A note or rest as it is drawn. */
export interface DrawnNote {
  id: string
  staff: number
  rest: boolean
  /** The notehead (or the rest). */
  head: Box
  /** The whole drawing, with its stem. */
  box: Box
}

/** The slot for the next note of a staff (design D2): from after the last note or rest to the end of the bar. */
export interface SlotGeometry {
  staff: number
  left: number
  right: number
  /** The whole-bar rest a tap in the slot replaces: the slot takes its taps. */
  covers?: string
}

/** What is drawn in the large bar, measured. */
export interface BarLayout {
  staves: readonly StaffGeometry[]
  notes: readonly DrawnNote[]
  slots: readonly SlotGeometry[]
}

/** A written pitch without its alter: the step a place on the staff is. */
export interface StaffPitch {
  step: 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B'
  octave: number
}

/** How far a finger moves before a drag on a note is a drag (design D2): then the larger axis decides. */
export const DRAG_START_PX = 8
/** How many staff steps above the top line and below the bottom line a tap still counts as on the staff (three ledger lines). */
export const STAFF_REACH_STEPS = 6
/** How far beside a notehead a tap still takes the note, at most: less where the notes are close, so that a tap between two notes can add one. */
export const NOTE_SLOP_PX = 6
/** How far above or below a note's drawing (its head and stem) a tap still takes the note. */
export const NOTE_REACH_Y_PX = 28

const STEPS: readonly StaffPitch['step'][] = ['C', 'D', 'E', 'F', 'G', 'A', 'B']

/** The distance between two staff steps (a line and the space next to it). */
export const halfGap = (staff: Pick<StaffGeometry, 'top' | 'bottom'>): number => (staff.bottom - staff.top) / 8

/** The height of the middle line. */
export const middleY = (staff: Pick<StaffGeometry, 'top' | 'bottom'>): number => (staff.top + staff.bottom) / 2

/**
 * The staff step at a height, counted up from the middle line (the top line is 4, the space above it 5).
 *
 *   stepAt({ top: 100, bottom: 148 }, 118) // 1: the space above the middle line
 */
export function stepAt(staff: Pick<StaffGeometry, 'top' | 'bottom'>, y: number): number {
  return Math.round((middleY(staff) - y) / halfGap(staff)) || 0
}

/** The height of a staff step (see `stepAt`). */
export const yOfStep = (staff: Pick<StaffGeometry, 'top' | 'bottom'>, step: number): number => middleY(staff) - step * halfGap(staff)

/** The written step and octave `step` staff steps above the middle line of a staff whose middle line is `middle` (diatonic steps from C0). */
export function pitchAtStep(middle: number, step: number): StaffPitch {
  const d = middle + step
  const octave = Math.floor(d / 7)
  return { step: STEPS[d - octave * 7]!, octave }
}

/**
 * The staff a height belongs to: one whose lines, with `STAFF_REACH_STEPS` above and below, hold it, the nearest by its
 * middle line when two do (between the hands of a piano bar). Undefined above and below them all.
 */
export function staffAt(staves: readonly StaffGeometry[], y: number): StaffGeometry | undefined {
  let best: StaffGeometry | undefined
  let distance = Infinity
  for (const staff of staves) {
    const reach = STAFF_REACH_STEPS * halfGap(staff)
    if (y < staff.top - reach || y > staff.bottom + reach) continue
    const d = Math.abs(y - middleY(staff))
    if (d < distance) {
      best = staff
      distance = d
    }
  }
  return best
}

/**
 * How a drag that started on a note has gone (design D2): nothing until the finger has moved `DRAG_START_PX`, then the
 * larger axis, which the caller keeps for the rest of the gesture.
 *
 *   dragAxis(3, 5) // 'none'
 *   dragAxis(2, -9) // 'vertical'
 */
export function dragAxis(dx: number, dy: number): 'none' | 'vertical' | 'horizontal' {
  if (Math.hypot(dx, dy) < DRAG_START_PX) return 'none'
  return Math.abs(dy) >= Math.abs(dx) ? 'vertical' : 'horizontal'
}

/**
 * The staff steps a pitch drag has gone (up is positive), counted from `fromY`, where the drag was decided, not where the
 * finger came down: else the dead zone of `DRAG_START_PX` would be one or two steps already, and on a small staff a drag
 * of one step could not be made.
 *
 *   dragSteps(6.4, 300, 290) // 2
 */
export function dragSteps(gap: number, fromY: number, y: number): number {
  if (!(gap > 0)) return 0
  return Math.round((fromY - y) / gap) || 0
}

/** What a touch on the large bar is on, once no element (a clef, a slur, a mark, a bar line) was under the finger. */
export type BarHit =
  | { kind: 'note'; id: string }
  /** The slot of a staff: a note at the end of its first voice (`addAtSlot`). */
  | { kind: 'slot'; staff: number; pitch: StaffPitch }
  /** The staff where there is no note: a note before the note drawn to the right (`right`), else at the end (`addOnStaff`). */
  | { kind: 'staff'; staff: number; pitch: StaffPitch; right?: string }
  | { kind: 'none' }

const centreX = (b: Box): number => (b.left + b.right) / 2

/** How far beside its head a note takes a tap: `NOTE_SLOP_PX`, or a quarter of the room to the nearest other head of its staff when that is less. */
function slopOf(note: DrawnNote, notes: readonly DrawnNote[]): number {
  let room = Infinity
  for (const other of notes) {
    if (other === note || other.staff !== note.staff) continue
    if (other.head.left >= note.head.right) room = Math.min(room, other.head.left - note.head.right)
    else if (other.head.right <= note.head.left) room = Math.min(room, note.head.left - other.head.right)
  }
  return Math.max(0, Math.min(NOTE_SLOP_PX, room / 4))
}

/**
 * The note whose column a point is in: within its head's width (and a little beside it, `slopOf`), and from a little
 * above its drawing to a little below it, but not on the lines of another staff. Of several (a chord), the one whose head
 * is nearest.
 */
function noteInColumn(layout: BarLayout, x: number, y: number, skip: ReadonlySet<string>): DrawnNote | undefined {
  const notes = layout.notes.filter((n) => !skip.has(n.id))
  const onStaff = staffAt(layout.staves, y)
  let best: DrawnNote | undefined
  let distance = Infinity
  for (const note of notes) {
    const slop = slopOf(note, notes)
    if (x < note.head.left - slop || x > note.head.right + slop) continue
    if (y < note.box.top - NOTE_REACH_Y_PX || y > note.box.bottom + NOTE_REACH_Y_PX) continue
    if (onStaff && onStaff.staff !== note.staff && y >= onStaff.top - halfGap(onStaff) * 2 && y <= onStaff.bottom + halfGap(onStaff) * 2) continue
    const d = Math.max(note.head.top - y, 0, y - note.head.bottom)
    if (d < distance) {
      best = note
      distance = d
    }
  }
  return best
}

/**
 * What a touch at (x, y) is on (design D2), in this order: a note or rest in whose column it is (`noteInColumn`); then,
 * only where a tap may add a note (`canAdd`: the Notes tools are open and no mark is armed), the slot of the staff under
 * it, else the staff itself between the start of the bar's notes and its end, within `STAFF_REACH_STEPS` of its lines,
 * with the note or rest drawn first to the right of the touch on that staff; else nothing (the caller may still take the
 * nearest note within a finger's reach, as practice does). A whole-bar rest under a slot does not take the slot's taps
 * while a tap may add.
 */
export function hitBar(layout: BarLayout, x: number, y: number, canAdd: boolean): BarHit {
  const covered = new Set(canAdd ? layout.slots.flatMap((s) => (s.covers ? [s.covers] : [])) : [])
  const note = noteInColumn(layout, x, y, covered)
  if (note) return { kind: 'note', id: note.id }
  if (!canAdd) return { kind: 'none' }
  const staff = staffAt(layout.staves, y)
  if (!staff || x < staff.left || x > staff.right) return { kind: 'none' }
  const step = Math.max(-(4 + STAFF_REACH_STEPS), Math.min(4 + STAFF_REACH_STEPS, stepAt(staff, y)))
  const pitch = pitchAtStep(staff.middle, step)
  const slot = layout.slots.find((s) => s.staff === staff.staff && x >= s.left && x <= s.right)
  if (slot) return { kind: 'slot', staff: staff.staff, pitch }
  let right: DrawnNote | undefined
  for (const n of layout.notes) {
    if (n.staff !== staff.staff || covered.has(n.id) || centreX(n.head) <= x) continue
    if (!right || centreX(n.head) < centreX(right.head)) right = n
  }
  return { kind: 'staff', staff: staff.staff, pitch, ...(right ? { right: right.id } : {}) }
}

/** The ledger lines a notehead `step` staff steps from the middle line needs: the heights of the lines between the staff and it. */
export function ledgerSteps(step: number): number[] {
  const out: number[] = []
  for (let s = 6; s <= step; s += 2) out.push(s)
  for (let s = -6; s >= step; s -= 2) out.push(s)
  return out
}
