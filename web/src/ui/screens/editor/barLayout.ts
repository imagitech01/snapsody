import type { BarSlot } from '../../../app/editorSession.ts'
import type { BarLayout, Box, DrawnNote, SlotGeometry, StaffGeometry } from '../../notesSurface.ts'

/*
 * Measures the large bar as Verovio drew it (change redesign-score-editor, design D2), in screen coordinates, for the
 * geometry of `notesSurface.ts`: the staves (from their five lines, and where the notes start after the clef, key and
 * time signature), every note and rest with its head, and the slots the session asks for. The bar is one `g.measure`
 * whose `g.staff` children are the staves of the part being edited, in order; the drawn notes carry the model's ids.
 */

const boxOf = (el: Element): Box => {
  const r = el.getBoundingClientRect()
  return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }
}

/** The drawing of a note or rest by its id (in a chord, the note's own), or undefined. */
export function drawnNote(root: Element, id: string): SVGGElement | undefined {
  const escaped = CSS.escape(id)
  return root.querySelector<SVGGElement>(`g.note[id="${escaped}"], g.rest[id="${escaped}"], g.mRest[id="${escaped}"]`) ?? undefined
}

/**
 * The layout of the large bar drawn in `root`. `middles` is the pitch on the middle line of each staff (`middleLine` of
 * its clef in force), `slots` the session's slots of the bar. Empty when nothing is drawn yet.
 */
export function readBarLayout(root: Element, middles: readonly number[], slots: readonly BarSlot[]): BarLayout {
  const measure = root.querySelector('g.measure')
  if (!measure) return { staves: [], notes: [], slots: [] }
  const staffNodes = [...measure.children].filter((c) => c.matches('g.staff'))
  const staves: StaffGeometry[] = []
  const notes: DrawnNote[] = []
  // A start-repeat bar line is drawn before the first note, like the clef: notes start after it.
  const barLines = [...measure.querySelectorAll(':scope > g.barLine')].map(boxOf)
  staffNodes.forEach((node, staff) => {
    const lines = [...node.children].filter((c) => c.tagName.toLowerCase() === 'path').map(boxOf)
    if (lines.length < 5) return
    const top = Math.min(...lines.map((l) => (l.top + l.bottom) / 2))
    const bottom = Math.max(...lines.map((l) => (l.top + l.bottom) / 2))
    const lineLeft = Math.min(...lines.map((l) => l.left))
    const right = Math.max(...lines.map((l) => l.right))
    const drawn = [...node.querySelectorAll<SVGGElement>('g.note, g.rest, g.mRest')].filter((g) => g.id)
    const firstHead = Math.min(...drawn.map((g) => boxOf(g.querySelector('g.notehead') ?? g).left), right)
    const before = [...[...node.children].filter((c) => c.matches('g.clef, g.keySig, g.meterSig')).map(boxOf), ...barLines.filter((b) => b.right <= firstHead)]
    const left = Math.max(lineLeft, ...before.map((b) => b.right))
    staves.push({ staff, top, bottom, left, right, middle: middles[staff] ?? 34 })
    for (const g of drawn) {
      const rest = !g.matches('g.note')
      notes.push({ id: g.id, staff, rest, head: boxOf(rest ? g : (g.querySelector('g.notehead') ?? g)), box: boxOf(g) })
    }
  })
  const out: SlotGeometry[] = []
  for (const slot of slots) {
    const staff = staves.find((s) => s.staff === slot.staff)
    if (!staff) continue
    let left = staff.left
    if (slot.after !== null) {
      const after = drawnNote(measure, slot.after)
      if (!after) continue
      // After the whole chord, with its dots.
      left = boxOf(after.closest('g.chord') ?? after).right + 4
    }
    const right = staff.right - 3
    if (right - left < 12) continue
    out.push({ staff: slot.staff, left, right, ...(slot.rest ? { covers: slot.rest } : {}) })
  }
  return { staves, notes, slots: out }
}
