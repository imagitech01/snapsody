import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DRAG_START_PX, dragAxis, dragSteps, halfGap, hitBar, ledgerSteps, pitchAtStep, staffAt, stepAt, yOfStep } from '../src/ui/notesSurface.ts'
import type { BarLayout, DrawnNote, StaffGeometry } from '../src/ui/notesSurface.ts'

// The geometry of the large bar in Notes (change redesign-score-editor, design D2, task 6.2): what a touch is on, which
// staff step a height is, and how far a pitch drag has gone.

/** A treble staff with its lines at 100, 112, ..., 148 (a step is 6 px), notes from x 60 to 300. */
const TREBLE: StaffGeometry = { staff: 0, top: 100, bottom: 148, left: 60, right: 300, middle: 34 }
/** The bass staff of a piano bar under it (D3 on the middle line). */
const BASS: StaffGeometry = { staff: 1, top: 220, bottom: 268, left: 60, right: 300, middle: 22 }

/** A quarter note at x (its head 16 px wide) on a staff step, with a stem up. */
function quarter(id: string, x: number, step: number, staff = TREBLE): DrawnNote {
  const y = yOfStep(staff, step)
  return { id, staff: staff.staff, rest: false, head: { left: x, right: x + 16, top: y - 6, bottom: y + 6 }, box: { left: x, right: x + 16, top: y - 40, bottom: y + 6 } }
}

/** "C5 D5 E5 F5" in 4/4, 48 px apart, as the Ode to Joy bar is drawn on a phone. */
const ODE: BarLayout = { staves: [TREBLE], notes: [quarter('c', 80, 1), quarter('d', 128, 2), quarter('e', 176, 3), quarter('f', 224, 4)], slots: [] }

test('staff steps: the middle line is 0, a line and a space are one step apart, and a step names its written pitch in the clef', () => {
  assert.equal(halfGap(TREBLE), 6)
  assert.deepEqual([stepAt(TREBLE, 124), stepAt(TREBLE, 100), stepAt(TREBLE, 148), stepAt(TREBLE, 82), stepAt(TREBLE, 127)], [0, 4, -4, 7, 0])
  assert.equal(yOfStep(TREBLE, 4), 100)
  assert.deepEqual(pitchAtStep(34, 0), { step: 'B', octave: 4 }, 'treble: B4 on the middle line')
  assert.deepEqual(pitchAtStep(34, 1), { step: 'C', octave: 5 })
  assert.deepEqual(pitchAtStep(34, -6), { step: 'C', octave: 4 }, 'middle C on the first ledger line below')
  assert.deepEqual(pitchAtStep(22, 0), { step: 'D', octave: 3 }, 'bass: D3 on the middle line')
  assert.deepEqual(pitchAtStep(22, -5), { step: 'F', octave: 2 })
  assert.deepEqual(ledgerSteps(4), [])
  assert.deepEqual(ledgerSteps(7), [6])
  assert.deepEqual(ledgerSteps(-8), [-6, -8])
})

test('staff at a height: within three ledger lines of its lines; between the hands of a piano bar the nearer one', () => {
  assert.equal(staffAt([TREBLE], 124)?.staff, 0)
  assert.equal(staffAt([TREBLE], 100 - 36)?.staff, 0, 'three ledger lines above')
  assert.equal(staffAt([TREBLE], 100 - 40), undefined, 'above that: no staff')
  assert.equal(staffAt([TREBLE, BASS], 180)?.staff, 0)
  assert.equal(staffAt([TREBLE, BASS], 190)?.staff, 1)
})

test('a drag on a note: nothing for the first 8 px, then the larger axis; steps count from where it was decided, also on a small staff', () => {
  assert.equal(DRAG_START_PX, 8)
  assert.equal(dragAxis(3, 5), 'none')
  assert.equal(dragAxis(2, -9), 'vertical')
  assert.equal(dragAxis(-9, 3), 'horizontal')
  assert.equal(dragAxis(6, 6), 'vertical', 'a tie goes to the pitch')
  // A one-line bar (6.4 px a step) and a piano bar (3.5 px a step): one step down is a few pixels past the decision.
  assert.equal(dragSteps(6.4, 300, 306), -1)
  assert.equal(dragSteps(6.4, 300, 290), 2)
  assert.equal(dragSteps(3.5, 300, 302), -1)
  assert.equal(dragSteps(3.5, 300, 301), 0)
  assert.equal(dragSteps(3.5, 300, 293), 2)
  assert.equal(dragSteps(0, 300, 200), 0)
})

test('a tap on a note: on its head, beside it, on its stem and a little above it; a chord note by its own head', () => {
  for (const canAdd of [true, false]) {
    assert.deepEqual(hitBar(ODE, 88, yOfStep(TREBLE, 1), canAdd), { kind: 'note', id: 'c' }, 'on the head')
    assert.deepEqual(hitBar(ODE, 101, yOfStep(TREBLE, 1), canAdd), { kind: 'note', id: 'c' }, 'beside it')
    assert.deepEqual(hitBar(ODE, 140, yOfStep(TREBLE, 2) - 30, canAdd), { kind: 'note', id: 'd' }, 'on the stem')
    assert.deepEqual(hitBar(ODE, 136, yOfStep(TREBLE, 2) - 54, canAdd), { kind: 'note', id: 'd' }, '14 px above the drawing')
  }
  const chord: BarLayout = { staves: [TREBLE], notes: [quarter('c5', 80, 1), quarter('e5', 80, 3)], slots: [] }
  assert.deepEqual(hitBar(chord, 88, yOfStep(TREBLE, 3), true), { kind: 'note', id: 'e5' })
  assert.deepEqual(hitBar(chord, 88, yOfStep(TREBLE, 1), true), { kind: 'note', id: 'c5' })
})

test('a tap between two notes adds there, at the step under the finger and before the note to its right, only where a tap may add', () => {
  // Between C5 and D5 (heads at 80-96 and 128-144), at the height of D4.
  assert.deepEqual(hitBar(ODE, 112, yOfStep(TREBLE, -5), true), { kind: 'staff', staff: 0, pitch: { step: 'D', octave: 4 }, right: 'd' })
  assert.deepEqual(hitBar(ODE, 112, yOfStep(TREBLE, -5), false), { kind: 'none' }, 'the Marks or Bars tools: nothing')
  // After the last note of a full bar: at the end.
  assert.deepEqual(hitBar(ODE, 270, yOfStep(TREBLE, 0), true), { kind: 'staff', staff: 0, pitch: { step: 'B', octave: 4 } })
  // Eighths 30 px apart (14 px between the heads): the middle still adds.
  const eighths: BarLayout = { staves: [TREBLE], notes: [quarter('a', 80, 1), quarter('b', 110, 1)], slots: [] }
  assert.equal(hitBar(eighths, 103, yOfStep(TREBLE, 1), true).kind, 'staff')
  assert.equal(hitBar(eighths, 97, yOfStep(TREBLE, 1), true).kind, 'note', 'next to a head it is the note')
})

test('nothing is added before the notes start, after the bar line, or far above the staff', () => {
  assert.deepEqual(hitBar(ODE, 40, yOfStep(TREBLE, 0), true), { kind: 'none' }, 'the clef')
  assert.deepEqual(hitBar(ODE, 320, yOfStep(TREBLE, 0), true), { kind: 'none' }, 'the margin after the bar line')
  assert.deepEqual(hitBar(ODE, 270, 20, true), { kind: 'none' }, 'far above the staff')
  // Three ledger lines above is still on the staff, as high as the finger goes.
  assert.deepEqual(hitBar(ODE, 270, yOfStep(TREBLE, 10), true), { kind: 'staff', staff: 0, pitch: { step: 'E', octave: 6 } })
})

test('the slot: a tap in it adds at the end at the step under the finger; a whole-bar rest under it does not take the tap while a tap may add', () => {
  const short: BarLayout = { staves: [TREBLE], notes: [quarter('c', 80, 1), quarter('d', 128, 2)], slots: [{ staff: 0, left: 150, right: 298 }] }
  assert.deepEqual(hitBar(short, 220, yOfStep(TREBLE, -2), true), { kind: 'slot', staff: 0, pitch: { step: 'G', octave: 4 } }, 'the second line')
  assert.deepEqual(hitBar(short, 220, yOfStep(TREBLE, -2), false), { kind: 'none' })
  const rest: DrawnNote = { id: 'r', staff: 0, rest: true, head: { left: 170, right: 190, top: 112, bottom: 118 }, box: { left: 170, right: 190, top: 112, bottom: 118 } }
  const empty: BarLayout = { staves: [TREBLE], notes: [rest], slots: [{ staff: 0, left: 60, right: 298, covers: 'r' }] }
  assert.deepEqual(hitBar(empty, 180, 115, true), { kind: 'slot', staff: 0, pitch: { step: 'D', octave: 5 } })
  assert.deepEqual(hitBar(empty, 180, 115, false), { kind: 'note', id: 'r' }, 'with the Marks tools open the rest is selected')
})

test('a piano bar: a tap on the lower staff adds to the left hand in the bass clef, also under a note of the right hand', () => {
  const piano: BarLayout = { staves: [TREBLE, BASS], notes: [quarter('rh', 80, 1), quarter('lh', 80, 0, BASS)], slots: [] }
  assert.deepEqual(hitBar(piano, 160, yOfStep(BASS, 2), true), { kind: 'staff', staff: 1, pitch: { step: 'F', octave: 3 } })
  assert.deepEqual(hitBar(piano, 88, yOfStep(BASS, 0), true), { kind: 'note', id: 'lh' })
  assert.deepEqual(hitBar(piano, 88, yOfStep(BASS, 4), true), { kind: 'note', id: 'lh' }, 'the left hand note\'s column, not the right hand\'s')
})
