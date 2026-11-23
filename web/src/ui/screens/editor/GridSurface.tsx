import { useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { EditorSession } from '../../../app/editorSession.ts'
import { gridOf } from '../../../core/score/grid.ts'
import type { GridBlock, GridDescription } from '../../../core/score/grid.ts'
import { partIndex } from '../../../core/score/model.ts'
import type { VoiceRef } from '../../../core/score/model.ts'
import { frac } from '../../../core/score/rational.ts'
import {
  GRID_HEAD_PX,
  GRID_STRIP_PX,
  blockRect,
  columnAtX,
  endHandle,
  gridGeometry,
  growFor,
  hairpinPath,
  hitRows,
  moveCols,
  moveSteps,
  resizeCols,
  staccatoWidth,
  stripNoteAt,
  stripTarget,
  xOfColumn,
  yOfRow,
} from '../../gridSurface.ts'
import type { GridGeometry, Rect } from '../../gridSurface.ts'
import { dragAxis } from '../../notesSurface.ts'
import { useShell } from '../../ShellContext.ts'
import { SelectField } from './controls.tsx'

/**
 * The large bar in Grid (change redesign-score-editor, design D3, D4; spec `score-editing` "Grid view", "Grid shows one
 * staff and voice", "Edit notes in Grid", "Grid keeps the bar in order", "Grid leaves alone what it cannot draw",
 * "Loudness strip in Grid"): one voice of the current bar as blocks on a grid, drawn by the app from the session's `grid`
 * (`core/score/grid.ts`), with the geometry of `ui/gridSurface.ts`. From the top:
 *
 * - In a part with more than one staff or voice, the chip that names the one shown ("Left hand") and chooses another.
 * - The beat numbers over the columns.
 * - The rows, a staff step each, named at the left in the note names of the settings, with the lines of the staff drawn
 *   through them; the columns, a sixteenth each, with the beats and the bar's end marked. The blocks of the voice (a
 *   staccato one half solid, an accented one with a dark front edge, a triplet, a grace note or a note off the sixteenths
 *   hatched, as locked); the hatched time of a triplet's rest; the other voices of the staff faint. When the rows do not
 *   fit at their smallest height they scroll inside the Grid, by the row names (the cells keep every touch).
 * - The loudness strip: the marks and the hairpins of the staff in the bar.
 *
 * The touches are this component's, with pointer capture on its box, so a gesture goes on while it is drawn again:
 *
 * - A touch on an empty cell, lifted without moving, adds what a tap adds there (`gridAdd`: a note at the row's pitch on
 *   that sixteenth, or a chord note where a note starts), and it sounds. Outside the Notes tools, or with a mark armed, it
 *   puts away the selection instead (`onTapEmpty`), as a tap on nothing does in Notes.
 * - A touch on a block, lifted without moving, is a tap on its note (`onTapNote`: it selects, or gets the armed mark).
 * - A drag from a block's body decides its way after 8 px, as in Notes (design D2): sideways it moves the block by whole
 *   sixteenths (`gridMove`), up or down it changes the note's pitch a staff step a row (`gridPitch`), the name shown in the
 *   block and each step sounding; the rows grow when the block goes past them. A drag from a block's end changes its
 *   length (`gridResize`) to the longest note that ends at or before the finger. The block is drawn where it would go
 *   while the finger is down; on release the session makes the change (one undo step), or refuses it and says why, and
 *   the block is drawn where it is. A locked block does not follow the finger, and the session says where it is edited.
 * - On the strip, a touch lifted without moving steps the mark of the note above it (`stepLoudness`: p, mf, f, none); a
 *   slide from a note to another adds a crescendo forward or a diminuendo back (`stripSlide`), drawn while the finger
 *   is down. Under no note, it says that loudness goes under a note (`onStripNowhere`).
 */
export interface GridSurfaceProps {
  session: EditorSession
  onTapNote: (id: string) => void
  /** A tap on an empty cell where a tap adds nothing: the selection goes. */
  onTapEmpty: () => void
  /** Before the session is asked for a change: what the editor says goes. */
  onQuiet: () => void
  /** A tap or a slide on the strip under no note. */
  onStripNowhere: () => void
}

/** A gesture on the Grid, from the touch to the release. */
type Gesture =
  | { kind: 'cell'; col: number; row: number; x0: number; y0: number; moved: boolean }
  | {
      kind: 'block'
      block: GridBlock
      /** The block's staff step, and the rows and their height when the touch came down (a drag counts in those). */
      step: number
      geo: GridGeometry
      end: boolean
      x0: number
      y0: number
      way: 'none' | 'move' | 'pitch' | 'length'
      /** The ghost is drawn. */
      shown: boolean
      cols: number
      steps: number
      length: number
    }
  | { kind: 'strip'; from?: string; x0: number; x: number; moved: boolean }
  | { kind: 'done' }

/** Where the block being dragged would go, for its ghost. */
interface Ghost {
  id: string
  col: number
  cols: number
  step: number
  name?: string
}

const sameVoice = (a: VoiceRef, b: VoiceRef): boolean => a.part === b.part && a.staff === b.staff && a.voice === b.voice
const voiceKey = (ref: VoiceRef): string => `${ref.staff}:${ref.voice}`

export function GridSurface({ session, onTapNote, onTapEmpty, onQuiet, onStripNowhere }: GridSurfaceProps) {
  const { i18n } = useShell()
  const { t } = i18n
  const box = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const cells = useRef<SVGSVGElement>(null)
  const strip = useRef<SVGSVGElement>(null)
  const gesture = useRef<Gesture>({ kind: 'done' })
  const [size, setSize] = useState<{ width: number; room: number } | null>(null)
  const [grow, setGrow] = useState<{ up: number; down: number } | null>(null)
  const [ghost, setGhost] = useState<Ghost | null>(null)
  const [slide, setSlide] = useState<{ x1: number; x2: number } | null>(null)

  const score = session.score.value
  const bar = session.currentBar.value
  const voice = session.gridVoice.value
  const offered = session.gridVoices.value
  const shown = session.grid.value
  const desc: GridDescription | undefined = useMemo(
    () => (grow && shown ? gridOf(score, voice, bar - 1, grow) : shown),
    [grow, shown, score, voice, bar],
  )
  const selectedId = session.selection.value?.noteId ?? null
  const picked = session.pending.value?.from ?? null
  const geo = desc && size ? gridGeometry({ rows: desc.rows.length, columns: desc.columns.length }, size.width, size.room) : undefined
  const latest = useRef({ desc, geo, onTapNote, onTapEmpty, onQuiet, onStripNowhere })
  latest.current = { desc, geo, onTapNote, onTapEmpty, onQuiet, onStripNowhere }

  // The size the cells are drawn for: the Grid's width, and the height its rows have between the beat numbers and the strip.
  useLayoutEffect(() => {
    const root = box.current
    const rows = scroller.current
    if (!root || !rows) return
    const measure = (): void => {
      const next = { width: root.clientWidth, room: rows.clientHeight }
      setSize((now) => (now && now.width === next.width && now.room === next.room ? now : next))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(root)
    observer.observe(rows)
    return () => observer.disconnect()
  }, [])

  // Rows that scroll show the selected note, else the middle of the notes of the staff, when the bar or the voice changes.
  const scrollKey = `${bar}|${voiceKey(voice)}|${geo?.scroll ? geo.rowH : 0}`
  useLayoutEffect(() => {
    const rows = scroller.current
    if (!rows || !desc || !geo || !geo.scroll) return
    const own = desc.blocks.find((b) => b.id === selectedId)
    const all = [...desc.blocks, ...desc.others].map((b) => b.row)
    const target = own ? own.row : all.length > 0 ? (Math.min(...all) + Math.max(...all)) / 2 : desc.rows.length / 2
    rows.scrollTop = Math.max(0, yOfRow(geo, target) - (rows.clientHeight - geo.rowH) / 2)
  }, [scrollKey])

  // While a block is dragged up or down past what the rows show, they follow it.
  const ghostRow = ghost && desc ? desc.rows.findIndex((r) => r.step === ghost.step) : -1
  useLayoutEffect(() => {
    const rows = scroller.current
    if (!rows || !geo || !geo.scroll || ghostRow < 0) return
    const top = yOfRow(geo, ghostRow)
    if (top < rows.scrollTop) rows.scrollTop = top
    else if (top + geo.rowH > rows.scrollTop + rows.clientHeight) rows.scrollTop = top + geo.rowH - rows.clientHeight
  }, [ghostRow, geo?.rowH, geo?.scroll])

  const name = (ref: VoiceRef): string => {
    const part = score.parts[partIndex(score, ref.part)]
    const many = offered.filter((r) => r.staff === ref.staff).length > 1
    if (part?.staves === 2) {
      const hand = t(ref.staff === 0 ? 'part.right' : 'part.left')
      return many ? t('grid.voice.handVoice', { hand, voice: ref.voice + 1 }) : hand
    }
    return t('editor.place.voice', { voice: ref.voice + 1 })
  }

  /** A point of the screen in the rows' drawing, and in the strip's. */
  const inCells = (x: number, y: number): { x: number; y: number } | undefined => {
    const r = cells.current?.getBoundingClientRect()
    return r ? { x: x - r.left, y: y - r.top } : undefined
  }
  const inStrip = (x: number): number | undefined => {
    const r = strip.current?.getBoundingClientRect()
    return r ? x - r.left : undefined
  }

  /** The ghost of the block being dragged, with its name when its pitch changes, and the sound of a new pitch. */
  const follow = (g: Extract<Gesture, { kind: 'block' }>, changed: boolean): void => {
    g.shown = true
    if (g.block.locked) return
    const pitch = g.way === 'pitch' ? session.pitchAfterSteps(g.block.id, g.steps) : undefined
    setGhost({
      id: g.block.id,
      col: g.block.col + (g.way === 'move' ? g.cols : 0),
      cols: g.way === 'length' ? g.length : g.block.cols,
      step: g.step + (g.way === 'pitch' ? g.steps : 0),
      ...(pitch ? { name: i18n.noteName(pitch) } : {}),
    })
    if (g.way === 'pitch') {
      const want = growFor(g.geo.rows, g.block.row, g.steps)
      const none = want.up === 0 && want.down === 0
      setGrow((now) => (none ? null : now && now.up === want.up && now.down === want.down ? now : want))
      if (changed && pitch) void session.soundPitch(pitch)
    }
  }

  const onPointerDown = (event: PointerEvent): void => {
    if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return
    const { desc: d, geo: g } = latest.current
    const target = event.target as Element | null
    if (!d || !g || !target || target.closest('.editor-blocks-chip, .editor-blocks-names')) return
    const x = event.clientX
    const y = event.clientY
    if (target.closest('.editor-blocks-strip')) {
      const sx = inStrip(x)
      if (sx === undefined) return
      box.current?.setPointerCapture(event.pointerId)
      const from = stripNoteAt(d, Math.floor(columnAtX(g, sx)))
      gesture.current = { kind: 'strip', ...(from ? { from } : {}), x0: x, x, moved: false }
      return
    }
    const at = inCells(x, y)
    if (!at || !target.closest('.editor-blocks-cells')) return
    const hit = hitRows(d, g, at.x, at.y)
    if (hit.kind === 'none') return
    box.current?.setPointerCapture(event.pointerId)
    if (hit.kind === 'cell') {
      gesture.current = { kind: 'cell', col: hit.col, row: hit.row, x0: x, y0: y, moved: false }
      return
    }
    const block = d.blocks.find((b) => b.id === hit.id)!
    gesture.current = {
      kind: 'block',
      block,
      step: d.rows[block.row]!.step,
      geo: g,
      end: hit.part === 'end',
      x0: x,
      y0: y,
      way: 'none',
      shown: false,
      cols: 0,
      steps: 0,
      length: block.cols,
    }
  }

  const onPointerMove = (event: PointerEvent): void => {
    const g = gesture.current
    if (!event.isPrimary || g.kind === 'done') return
    const x = event.clientX
    const y = event.clientY
    if (g.kind === 'cell') {
      if (dragAxis(x - g.x0, y - g.y0) !== 'none') g.moved = true
      return
    }
    if (g.kind === 'strip') {
      g.x = x
      if (dragAxis(x - g.x0, 0) !== 'none') g.moved = true
      const { desc: d, geo: geom } = latest.current
      const block = g.from ? d?.blocks.find((b) => b.id === g.from) : undefined
      const sx = inStrip(x)
      if (g.moved && block && geom && sx !== undefined) setSlide({ x1: xOfColumn(geom, block.col) + 4, x2: sx })
      return
    }
    if (g.way === 'none') {
      const axis = dragAxis(x - g.x0, y - g.y0)
      if (axis === 'none') return
      g.way = g.end ? 'length' : axis === 'vertical' ? 'pitch' : 'move'
      if (!g.block.locked) {
        latest.current.onQuiet()
        session.select(g.block.id)
      }
    }
    const geom = g.geo
    if (g.way === 'move') {
      const cols = moveCols(geom, x - g.x0)
      const changed = cols !== g.cols
      g.cols = cols
      if (changed || !g.shown) follow(g, changed)
    } else if (g.way === 'pitch') {
      const steps = moveSteps(geom, g.block.row, y - g.y0)
      const changed = steps !== g.steps
      g.steps = steps
      if (changed || !g.shown) follow(g, changed)
    } else {
      const at = inCells(x, y)
      if (!at) return
      const length = resizeCols(latest.current.geo ?? geom, g.block, at.x)
      const changed = length !== g.length
      g.length = length
      if (changed || !g.shown) follow(g, changed)
    }
  }

  const end = (event: PointerEvent, cancelled: boolean): void => {
    if (!event.isPrimary) return
    const g = gesture.current
    gesture.current = { kind: 'done' }
    setGhost(null)
    setSlide(null)
    setGrow(null)
    if (g.kind === 'done' || cancelled) return
    const { desc: d, geo: geom, onTapNote: tapNote, onTapEmpty: tapEmpty, onQuiet: quiet, onStripNowhere: nowhere } = latest.current
    if (g.kind === 'cell') {
      if (g.moved || !d) return
      if (!session.canAddByTap.peek()) {
        tapEmpty()
        return
      }
      const row = d.rows[g.row]
      if (!row) return
      quiet()
      const id = session.gridAdd(frac(g.col, 16), { step: row.pitch.step, octave: row.pitch.octave })
      const pitch = id ? session.pitchAfterSteps(id, 0) : undefined
      if (pitch) void session.soundPitch(pitch)
      return
    }
    if (g.kind === 'strip') {
      if (!d || !geom) return
      const sx = inStrip(g.x)
      const to = g.moved && sx !== undefined ? stripTarget(d, Math.floor(columnAtX(geom, sx))) : g.from
      if (!g.from || !to) {
        nowhere()
        return
      }
      quiet()
      if (to === g.from) session.stepLoudness(g.from)
      else session.stripSlide(g.from, to)
      return
    }
    const id = g.block.id
    if (g.way === 'none') {
      tapNote(id)
      return
    }
    quiet()
    if (g.way === 'move') {
      if (g.cols !== 0 || g.block.locked) session.gridMove(id, frac(Math.round(g.block.col * 3) + g.cols * 3, 48))
    } else if (g.way === 'pitch') {
      if (g.steps !== 0 || g.block.locked) session.gridPitch(id, g.steps)
    } else if (g.length !== g.block.cols || g.block.locked) {
      session.gridResize(id, frac(g.length, 16))
    }
  }

  const rowOfStep = (step: number): number => (desc ? desc.rows.findIndex((r) => r.step === step) : -1)

  /** A block drawn: its rectangle, the solid part of a staccato, the front edge of an accent, its name when it fits. */
  const drawBlock = (b: GridBlock, rect: Rect, classes: string, label: string | undefined, key: string) => {
    const solid = b.staccato ? staccatoWidth(rect) : rect.w
    const fits = label !== undefined && rect.w >= label.length * 6.2 + 8
    return (
      <g key={key} class={classes} data-note={b.id}>
        {b.staccato ? <rect class="editor-blocks-block-faint" x={rect.x} y={rect.y} width={rect.w} height={rect.h} rx={3} /> : null}
        <rect class="editor-blocks-block-body" x={rect.x} y={rect.y} width={solid} height={rect.h} rx={3} />
        {b.accent ? <rect class="editor-blocks-block-accent" x={rect.x} y={rect.y} width={4} height={rect.h} rx={1} /> : null}
        {b.cols > 0 && !b.locked ? (
          <line class="editor-blocks-block-end" x1={rect.x + rect.w - endHandle(rect) / 2} x2={rect.x + rect.w - endHandle(rect) / 2} y1={rect.y + 4} y2={rect.y + rect.h - 4} />
        ) : null}
        {fits ? (
          <text class="editor-blocks-block-name" x={rect.x + 5} y={rect.y + rect.h / 2}>
            {label}
          </text>
        ) : null}
      </g>
    )
  }

  const width = size?.width ?? 0
  const rowsHeight = geo?.rowsHeight ?? 0
  const voiceChip =
    offered.length > 1 ? (
      <div class="editor-blocks-chip">
        <SelectField
          label={t('grid.voice')}
          value={voiceKey(voice)}
          options={offered.map((ref) => ({ value: voiceKey(ref), label: name(ref) }))}
          onChange={(key) => {
            const ref = offered.find((r) => voiceKey(r) === key)
            if (ref && !sameVoice(ref, voice)) {
              onQuiet()
              session.setGridVoice(ref)
            }
          }}
        />
      </div>
    ) : null

  return (
    <div
      ref={box}
      class="editor-blocks"
      data-bar={desc && geo ? String(bar) : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => end(event, false)}
      onPointerCancel={(event) => end(event, true)}
    >
      {voiceChip}
      <svg class="editor-blocks-head" width={width} height={GRID_HEAD_PX} aria-hidden="true">
        {desc && geo
          ? desc.columns.map((c, k) =>
              c.beat !== undefined ? (
                <text key={k} x={xOfColumn(geo, k) + 3} y={GRID_HEAD_PX - 4}>
                  {c.beat}
                </text>
              ) : null,
            )
          : null}
      </svg>
      <div ref={scroller} class={geo?.scroll ? 'editor-blocks-scroll is-scrolling' : 'editor-blocks-scroll'}>
        <div class="editor-blocks-rows" style={{ height: `${rowsHeight}px` }}>
          {desc && geo ? (
            <svg ref={cells} class="editor-blocks-cells" width={width} height={rowsHeight} aria-hidden="true">
              <defs>
                <pattern id="editor-blocks-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <rect class="editor-blocks-hatch-back" width="6" height="6" />
                  <line class="editor-blocks-hatch-line" x1="0" y1="0" x2="0" y2="6" />
                </pattern>
              </defs>
              {desc.rows.map((row, r) => (
                <g key={row.step} class={row.line ? 'editor-blocks-row is-line' : 'editor-blocks-row'}>
                  <rect class={row.step % 2 === 0 ? 'editor-blocks-band' : 'editor-blocks-band is-odd'} x={0} y={yOfRow(geo, r)} width={width} height={geo.rowH} />
                  {row.line ? <line class="editor-blocks-staffline" x1={geo.gutter} x2={width} y1={yOfRow(geo, r) + geo.rowH / 2} y2={yOfRow(geo, r) + geo.rowH / 2} /> : null}
                  <text class="editor-blocks-name" x={geo.gutter - 5} y={yOfRow(geo, r) + geo.rowH / 2}>
                    {i18n.noteName(row.pitch)}
                  </text>
                </g>
              ))}
              {desc.columns.length > desc.barColumns ? (
                <rect class="editor-blocks-over" x={xOfColumn(geo, desc.barColumns)} y={0} width={xOfColumn(geo, desc.columns.length) - xOfColumn(geo, desc.barColumns)} height={rowsHeight} />
              ) : null}
              {Array.from({ length: desc.columns.length + 1 }, (_, c) => {
                const kind = c === 0 || c === desc.barColumns ? 'is-bar' : desc.columns[c]?.beat !== undefined ? 'is-beat' : ''
                return <line key={c} class={`editor-blocks-column ${kind}`} x1={xOfColumn(geo, c)} x2={xOfColumn(geo, c)} y1={0} y2={rowsHeight} />
              })}
              {desc.lockedRests.map((r) => (
                <rect key={r.id} class="editor-blocks-locked-rest" x={xOfColumn(geo, r.col) + 1} y={0} width={Math.max(2, r.cols * geo.colW - 2)} height={rowsHeight} />
              ))}
              {desc.others.map((b) => {
                const rect = blockRect(geo, b)
                return <rect key={`o-${b.id}`} class="editor-blocks-other" x={rect.x} y={rect.y} width={rect.w} height={rect.h} rx={3} />
              })}
              {desc.blocks.map((b) => {
                const classes = ['editor-blocks-block']
                if (b.id === selectedId) classes.push('is-selected')
                if (b.id === picked) classes.push('is-picked')
                if (b.locked) classes.push('is-locked')
                if (ghost?.id === b.id) classes.push('is-dragged')
                return drawBlock(b, blockRect(geo, b), classes.join(' '), i18n.noteName(b.pitch), b.id)
              })}
              {ghost
                ? (() => {
                    const b = desc.blocks.find((x) => x.id === ghost.id)
                    const row = rowOfStep(ghost.step)
                    if (!b || row < 0) return null
                    const rect = blockRect(geo, { col: ghost.col, cols: ghost.cols, row })
                    return drawBlock(b, rect, 'editor-blocks-ghost', ghost.name ?? i18n.noteName(b.pitch), 'ghost')
                  })()
                : null}
            </svg>
          ) : null}
          {/* The row names take no gesture of the Grid's: a finger there scrolls the rows when they do not fit. */}
          <div class="editor-blocks-names" style={{ width: `${geo?.gutter ?? 0}px` }} />
        </div>
      </div>
      <svg ref={strip} class="editor-blocks-strip" width={width} height={GRID_STRIP_PX} aria-hidden="true">
        {desc && geo ? (
          <>
            <rect class="editor-blocks-strip-back" x={geo.gutter} y={1} width={Math.max(0, width - geo.gutter)} height={GRID_STRIP_PX - 2} rx={3} />
            <text class="editor-blocks-strip-name" x={geo.gutter - 5} y={GRID_STRIP_PX / 2}>
              {t('grid.strip')}
            </text>
            {desc.hairpins.map((h) => {
              const startsWithMark = desc.dynamics.some((m) => Math.abs(m.col - h.from) < 0.01)
              const x1 = xOfColumn(geo, h.from) + (h.before ? 0 : startsWithMark ? 18 : 3)
              const x2 = xOfColumn(geo, h.to) - (h.after ? 0 : 3)
              const d = h.type === 'crescendo' ? hairpinPath(x1, x2, GRID_STRIP_PX / 2, 7) : hairpinPath(x2, x1, GRID_STRIP_PX / 2, 7)
              return <path key={`${h.start}-${h.stop}`} class="editor-blocks-hairpin" data-hairpin={h.type} d={d} />
            })}
            {desc.dynamics.map((m) => (
              <text key={m.id} class="editor-blocks-dynamic" data-note={m.noteId} x={xOfColumn(geo, m.col) + 3} y={GRID_STRIP_PX / 2}>
                {m.mark}
              </text>
            ))}
            {slide ? <path class="editor-blocks-hairpin is-sliding" d={hairpinPath(slide.x1, slide.x2, GRID_STRIP_PX / 2, 7)} /> : null}
          </>
        ) : null}
      </svg>
    </div>
  )
}
