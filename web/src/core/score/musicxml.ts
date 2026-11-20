import type {
  Bar,
  Barline,
  Clef,
  Ending,
  KeySignature,
  MeasureItem,
  Note,
  NoteType,
  Part,
  PartBar,
  Pitch,
  Score,
  SlurMark,
  StaffBar,
  Step,
  TempoItem,
  TimeModification,
  TimeSignature,
  TupletMark,
  VoiceScore,
  WedgeItem,
} from './model.ts'
import { allItemLists, isNote, isWedge, partMultiRestRuns, singleVoiceScore } from './model.ts'
import type { BeamMark } from './beams.ts'
import type { Frac } from './rational.ts'
import { ZERO, add, cmp, eq, frac, lcm, mul, sub } from './rational.ts'
import type { XmlElement } from './xml.ts'
import { el, parseXml, serializeXml } from './xml.ts'

/*
 * MusicXML (partwise) <-> score model.
 *
 * Kept: every part, staff and voice (change parts-and-accompaniment); notes, rests, pitch and
 * accidentals, durations, dots, tuplets, ties, slurs, staccato, tenuto, accent,
 * fermata, breath marks, dynamics, hairpins (<wedge>), tempo (words, metronome,
 * sound tempo), other direction words, clef, key, time, barlines, repeats,
 * endings, system breaks.
 *
 * Also kept (change more-marks, design D1, D2): strong accent, staccatissimo, caesura, one ornament per
 * note (trill, turn, mordent), tremolo, arpeggio and multi-measure rests. homr 0.7.1 writes a mordent
 * among the articulations, every turn as <inverted-turn> and every tremolo as start or stop, never as
 * single; those are read as described at `pairTremolos`. A <doit> is dropped with a warning.
 *
 * Dropped (reported through `warnings` where it can matter): a third staff of a part, beams, stems, lyrics, other
 * articulations and ornaments, layout (<defaults>, <print> except
 * new-system), MIDI/instrument definitions, comments.
 *
 * Hairpins: MusicXML has a start and a stop direction, placed in time between the notes. The model
 * ties a hairpin to notes (WedgeItem): it runs from the first note after the start direction to the
 * last note before the stop direction. A start without a stop, a stop without a start, and a pair
 * with no note between them are dropped with a warning. On writing, the start goes right before the
 * first note and the stop right after the last one (after its chord, before the next direction).
 */

const WHOLE_FRACTION: Record<NoteType, Frac> = {
  maxima: frac(8),
  long: frac(4),
  breve: frac(2),
  whole: frac(1),
  half: frac(1, 2),
  quarter: frac(1, 4),
  eighth: frac(1, 8),
  '16th': frac(1, 16),
  '32nd': frac(1, 32),
  '64th': frac(1, 64),
  '128th': frac(1, 128),
}

export function isNoteType(s: string): s is NoteType {
  return Object.hasOwn(WHOLE_FRACTION, s)
}

/** Notated value of a note type with dots and an optional time modification. */
export function noteDuration(type: NoteType, dots: number, timeMod?: TimeModification): Frac {
  let d = WHOLE_FRACTION[type]
  d = mul(d, frac(2 ** (dots + 1) - 1, 2 ** dots))
  if (timeMod) d = mul(d, frac(timeMod.normal, timeMod.actual))
  return d
}

const STEPS = new Set(['A', 'B', 'C', 'D', 'E', 'F', 'G'])

// ---------------------------------------------------------------- parsing

function child(e: XmlElement, name: string): XmlElement | undefined {
  return e.children.find((c) => c.name === name)
}
function kids(e: XmlElement, name: string): XmlElement[] {
  return e.children.filter((c) => c.name === name)
}
function intOf(e: XmlElement | undefined): number | undefined {
  if (!e || !/^-?\d+$/.test(e.text)) return undefined
  return Number(e.text)
}
function numOf(e: XmlElement | undefined): number | undefined {
  if (!e || e.text === '') return undefined
  const n = Number(e.text)
  return Number.isFinite(n) ? n : undefined
}

/**
 * Parses partwise MusicXML into the score model. Anything that had to be
 * dropped or interpreted is appended to `warnings` when one is given.
 * Throws on XML that is not well-formed or not partwise MusicXML.
 *
 * Every part is read (design D3 of change parts-and-accompaniment): each `<part>` becomes a `Part`; a
 * note goes to its staff (`<staff>`, default 1) and its voice (`<voice>`, numbered per staff in order of
 * first use) at the time the cursor of the measure says, which follows `<backup>`, `<forward>` and note
 * durations. A `<forward>` with a `<voice>` (what the writer makes) is a hidden rest of that length in that
 * voice. homr's `<forward>` has no voice: it only moves the cursor to where the next note starts, and a
 * voice whose next note starts later than its last one ended gets a hidden rest for the gap; so does an
 * extra voice that ends before the rest of its staff. Every staff bar has the same number of voices.
 * Bar attributes come from the first part; a later part that disagrees is reported once per bar.
 */
export function parseMusicXml(source: string, warnings: string[] = []): Score {
  const root = parseXml(source)
  if (root.name === 'score-timewise') throw new Error('Timewise MusicXML is not supported')
  if (root.name !== 'score-partwise') throw new Error(`Not MusicXML: root element is <${root.name}>`)

  const title = child(child(root, 'work') ?? el('x'), 'work-title')?.text
  const scoreParts = kids(child(root, 'part-list') ?? el('x'), 'score-part')
  const partEls = kids(root, 'part')
  if (partEls.length === 0) {
    warnings.push('No <part> found; the score is empty')
    const name = child(scoreParts[0] ?? el('x'), 'part-name')?.text ?? ''
    const empty: Score = { parts: [{ id: 'P1', name, staves: 1 }], bars: [] }
    if (title) empty.title = title
    return empty
  }

  const inferredTime = kids(child(root, 'identification') ?? el('x'), 'miscellaneous').some((m) =>
    kids(m, 'miscellaneous-field').some((f) => f.attrs.name === 'time-signature-inferred' && f.text === 'true'),
  )

  const ids = idAllocator(partEls)
  const read = partEls.map((p) => readPart(p, ids, warnings))

  // Part ids as read; a missing or repeated one is made up.
  const partIds: string[] = []
  partEls.forEach((p, i) => {
    let id = p.attrs.id || `P${i + 1}`
    while (partIds.includes(id)) id = `${id}_${i + 1}`
    partIds.push(id)
  })
  const names = partNames(
    partEls.map((p, i) => child(scoreParts.find((sp) => sp.attrs.id === p.attrs.id) ?? scoreParts[i] ?? el('x'), 'part-name')?.text ?? ''),
    read.map((r) => r.staves),
  )

  const first = read[0]!
  const bars: Bar[] = first.bars.map((b, index) => {
    const bar: Bar = { number: b.number, parts: [] }
    if (b.shared.time) bar.time = b.shared.time
    if (b.shared.leftBarline) bar.leftBarline = b.shared.leftBarline
    if (b.shared.rightBarline) bar.rightBarline = b.shared.rightBarline
    if (b.shared.newSystem) bar.newSystem = true
    // The part bars of every part: a later part that is shorter gets empty bars.
    for (const r of read) {
      const pb = r.bars[index]?.pb
      bar.parts.push(pb ?? { staves: Array.from({ length: r.staves }, (_, si) => ({ voices: Array.from({ length: r.voiceCounts[si] ?? 1 }, (): MeasureItem[] => []) })) })
    }
    return bar
  })
  read.forEach((r, pi) => {
    if (pi === 0) return
    const id = partIds[pi]!
    if (r.bars.length < bars.length) warnings.push(`Part ${id} has ${r.bars.length} bars but the first part has ${bars.length}; the missing bars are empty`)
    if (r.bars.length > bars.length) warnings.push(`Part ${id} has ${r.bars.length} bars but the first part has ${bars.length}; the extra bars were dropped`)
    // Bar attributes: the first part wins.
    bars.forEach((bar, index) => {
      const other = r.bars[index]
      if (!other) return
      const differs: string[] = []
      if (!sameTimeSignature(bar.time, other.shared.time)) differs.push('time signature')
      if (!sameJson(bar.leftBarline, other.shared.leftBarline) || !sameJson(bar.rightBarline, other.shared.rightBarline)) differs.push('bar lines')
      if ((bar.newSystem === true) !== (other.shared.newSystem === true)) differs.push('line break')
      if (differs.length > 0) warnings.push(`Measure ${bar.number}: part ${id} disagrees with the first part on the ${differs.join(' and ')}; the first part is used`)
    })
  })

  const parts: Part[] = read.map((r, pi) => ({ id: partIds[pi]!, name: names[pi]!, staves: r.staves }))
  const score: Score = { parts, bars }
  if (title) score.title = title
  if (inferredTime) {
    const firstTime = bars.find((b) => b.time)?.time
    if (firstTime) firstTime.inferred = true
  }
  return score
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

function sameTimeSignature(a: TimeSignature | undefined, b: TimeSignature | undefined): boolean {
  if (!a || !b) return !a && !b
  return a.beats === b.beats && a.beatType === b.beatType
}

/**
 * The names of the parts (design D3). homr calls a one-staff part "Voice" and a two-staff part "Piano"; when
 * there is more than one part or a piano part, a generic or missing name becomes "Piano" (two staves) or
 * "Melody" (one staff; "Melody 1", "Melody 2" ... when there are several). Any other name is kept, and a
 * one-part, one-staff score keeps its name as it is.
 */
function partNames(names: string[], staves: number[]): string[] {
  if (names.length === 1 && staves[0] === 1) return names
  const generic = (name: string): boolean => name === '' || name === 'Voice' || name === 'Piano'
  const melodies = names.filter((n, i) => staves[i] === 1 && generic(n)).length
  let melody = 0
  return names.map((name, i) => {
    if (!generic(name)) return name
    if (staves[i] === 2) return 'Piano'
    melody++
    return melodies > 1 ? `Melody ${melody}` : 'Melody'
  })
}

interface IdAllocator {
  nextId: (wanted: string | undefined) => string
  nextDirectionId: (wanted: string | undefined) => string
}

/**
 * Ids: keep ids present in the source, generate the rest without collisions, over the whole score. Notes are
 * numbered n1, n2, ... and directions (dynamics, tempo marks, words) d1, d2, ...; a direction never takes an
 * id a note has, so note ids come out as they would without direction ids.
 */
function idAllocator(parts: XmlElement[]): IdAllocator {
  const used = new Set<string>()
  const noteIds = new Set<string>()
  for (const part of parts) {
    for (const m of kids(part, 'measure')) {
      for (const n of kids(m, 'note')) {
        const id = n.attrs.id
        if (id) {
          used.add(id)
          noteIds.add(id)
        }
      }
      for (const d of kids(m, 'direction')) if (d.attrs.id) used.add(d.attrs.id)
    }
  }
  let counter = 0
  let directionCounter = 0
  const seen = new Set<string>()
  return {
    nextId: (wanted) => {
      if (wanted && !seen.has(wanted)) {
        seen.add(wanted)
        return wanted
      }
      let id: string
      do id = `n${++counter}`
      while (used.has(id) || seen.has(id))
      seen.add(id)
      return id
    },
    nextDirectionId: (wanted) => {
      if (wanted && !seen.has(wanted) && !noteIds.has(wanted)) {
        seen.add(wanted)
        return wanted
      }
      let id: string
      do id = `d${++directionCounter}`
      while (used.has(id) || seen.has(id))
      seen.add(id)
      return id
    },
  }
}

/** What every part shares in a bar, as one part read it. */
interface SharedAttributes {
  time?: TimeSignature
  leftBarline?: Barline
  rightBarline?: Barline
  newSystem?: boolean
}

interface ReadPart {
  staves: 1 | 2
  bars: { number: string; shared: SharedAttributes; pb: PartBar }[]
  /** The voices of each staff. */
  voiceCounts: number[]
}

/** A direction waiting for the end of its bar, to be put into the first voice of its staff where it belongs in time. */
interface PendingDirection {
  items: MeasureItem[]
  time: Frac
  /** Position in the first voice's list when that voice had been read up to the direction's time; else found by time. */
  at: number | undefined
}

/** A hairpin that has started and not yet stopped. */
interface OpenWedge {
  type: WedgeItem['type']
  number: string
  startNote?: Note
  startList?: MeasureItem[]
  /** Whether the list is the one of the bar being read (its directions are not in yet). */
  startHere?: boolean
}

function readPart(part: XmlElement, ids: IdAllocator, warnings: string[]): ReadPart {
  const measureEls = kids(part, 'measure')

  // The staves of the part: `<staves>`, or the highest staff any note or clef names; a piano part has two.
  let staveCount = 1
  for (const m of measureEls) {
    for (const a of kids(m, 'attributes')) {
      staveCount = Math.max(staveCount, intOf(child(a, 'staves')) ?? 1)
      for (const c of kids(a, 'clef')) staveCount = Math.max(staveCount, Number(c.attrs.number) || 1)
    }
    for (const n of kids(m, 'note')) staveCount = Math.max(staveCount, intOf(child(n, 'staff')) ?? 1)
  }
  if (staveCount > 2) warnings.push(`A part has ${staveCount} staves; only the first two are kept`)
  const staves: 1 | 2 = staveCount >= 2 ? 2 : 1

  // The voice number of a note as homr means it: on the second staff voices 1-4 count as 5-8 (homr skips
  // its renumbering for the rests that follow a multi-measure rest, which keep voice 1).
  const normalVoice = (staff: number, raw: string): string => {
    const v = Number(raw)
    return staff === 1 && Number.isInteger(v) && v >= 1 && v <= 4 ? String(v + 4) : raw
  }
  // Voices are numbered per staff from the lowest voice number used anywhere in the part, so a rest-only
  // position that homr writes first does not take the first voice's place.
  const voiceMaps: Map<string, number>[] = [new Map(), new Map()]
  {
    const used: Set<string>[] = [new Set(), new Set()]
    for (const m of measureEls) {
      for (const n of [...kids(m, 'note'), ...kids(m, 'forward')]) {
        const raw = child(n, 'voice')?.text || (n.name === 'note' ? '1' : '')
        if (raw === '') continue
        const staffNo = intOf(child(n, 'staff')) ?? 1
        if (staffNo > staves) continue
        const staff = staffNo >= 2 ? 1 : 0
        used[staff]!.add(normalVoice(staff, raw))
      }
    }
    used.forEach((set, staff) => {
      const sorted = [...set].sort((a, b) => (Number(a) - Number(b)) || (a < b ? -1 : a > b ? 1 : 0))
      sorted.forEach((raw, i) => voiceMaps[staff]!.set(raw, i))
    })
  }
  const voiceIndexOf = (staff: number, rawVoice: string): number => {
    const raw = normalVoice(staff, rawVoice)
    const map = voiceMaps[staff]!
    let index = map.get(raw)
    if (index === undefined) {
      index = map.size
      map.set(raw, index)
    }
    return index
  }

  let divisions = 1
  let timeInForce: TimeSignature | undefined
  let skippedNotes = 0
  let warnedMove = false
  let sawNote = false
  const wedges = Array.from({ length: 2 }, () => ({ open: [] as OpenWedge[], lastNote: undefined as Note | undefined }))
  const bars: ReadPart['bars'] = []

  measureEls.forEach((m, index) => {
    const number = m.attrs.number ?? String(index + 1)
    const shared: SharedAttributes = {}
    const clefs: (Clef | undefined)[] = [undefined, undefined]
    let key: KeySignature | undefined
    let multiRest: number | undefined
    /** The voices of each staff in this bar (notes and hidden rests; directions are put in at the end), their ends and the start of every item. */
    const lists: MeasureItem[][][] = [[], []]
    const ends: Frac[][] = [[], []]
    const starts = new Map<MeasureItem, Frac>()
    const pending: PendingDirection[][] = [[], []]
    const pendingWedges: { wedge: WedgeItem; before: Note; list: MeasureItem[] }[] = []

    let cursor = ZERO
    let lastStart = ZERO
    let lastTarget: { staff: number; voice: number } | undefined
    /** The first note of the chord being read (or the single note before its chord members). */
    let chordFirst: Note | undefined
    let seenNoteInMeasure = false

    const voiceList = (staff: number, voice: number): MeasureItem[] => (lists[staff]![voice] ??= [])
    const voiceEnd = (staff: number, voice: number): Frac => ends[staff]![voice] ?? ZERO
    /** Puts a hidden rest in a voice where the voice is idle until `until`. */
    const fillTo = (staff: number, voice: number, until: Frac): void => {
      const end = voiceEnd(staff, voice)
      if (cmp(until, end) <= 0) return
      const rest: Note = { kind: 'note', id: ids.nextId(undefined), rest: true, hidden: true, dots: 0, duration: sub(until, end), slurs: [], tuplets: [] }
      voiceList(staff, voice).push(rest)
      starts.set(rest, end)
      ends[staff]![voice] = until
    }

    const handleWedge = (mark: WedgeMark, staff: number): void => {
      const state = wedges[staff]!
      const at = state.open.findIndex((o) => o.number === mark.number)
      if (mark.type !== 'stop') {
        if (at >= 0) {
          warnings.push(`Measure ${number}: a hairpin started inside another one; the earlier one was dropped`)
          state.open.splice(at, 1)
        }
        state.open.push({ type: mark.type, number: mark.number })
        return
      }
      if (at < 0) {
        warnings.push(`Measure ${number}: a hairpin stop without a start was ignored`)
        return
      }
      const [open] = state.open.splice(at, 1)
      if (!open?.startNote || !open.startList || !state.lastNote) {
        warnings.push(`Measure ${number}: a hairpin with no note under it was dropped`)
        return
      }
      const wedge: WedgeItem = { kind: 'wedge', type: open.type, start: open.startNote.id, stop: state.lastNote.id }
      if (open.startHere) pendingWedges.push({ wedge, before: open.startNote, list: open.startList })
      else open.startList.splice(open.startList.indexOf(open.startNote), 0, wedge)
    }

    for (const c of m.children) {
      switch (c.name) {
        case 'attributes': {
          const d = intOf(child(c, 'divisions'))
          if (d && d > 0) divisions = d
          const clefEls = kids(c, 'clef')
          let sawClef = false
          for (const clef of clefEls) {
            const staff = clef.attrs.number ? Number(clef.attrs.number) - 1 : 0
            if (staff < 0 || staff >= staves) continue
            clefs[staff] = parseClef(clef)
            sawClef = true
          }
          const keyEl = child(c, 'key')
          if (keyEl) {
            const k = parseKey(keyEl)
            if (k) key = k
          }
          const style = child(c, 'measure-style')
          const multiple = intOf(style ? child(style, 'multiple-rest') : undefined)
          if (multiple !== undefined && multiple >= 2) multiRest = multiple
          const timeEl = child(c, 'time')
          if (timeEl) {
            const t = parseTime(timeEl)
            if (t) shared.time = t
            else warnings.push(`Measure ${number}: unsupported time signature dropped`)
          }
          if (seenNoteInMeasure && (sawClef || keyEl || timeEl) && !warnedMove) {
            warnedMove = true
            warnings.push(`Measure ${number}: mid-bar attribute change moved to the start of the bar`)
          }
          break
        }
        case 'print':
          if (c.attrs['new-system'] === 'yes') shared.newSystem = true
          break
        case 'barline': {
          const b = parseBarline(c)
          if (b) {
            if ((c.attrs.location ?? 'right') === 'left') shared.leftBarline = b
            else shared.rightBarline = b
          }
          break
        }
        case 'direction': {
          const staffNo = intOf(child(c, 'staff')) ?? 1
          const staff = staffNo >= 2 && staves === 2 ? 1 : 0
          const direction = parseDirection(c, sawNote, ids.nextDirectionId)
          if (direction.items.length > 0) {
            const first = lists[staff]![0]
            // When the first voice has been read up to now, the direction goes right after what is there.
            const upToNow = first !== undefined && eq(voiceEnd(staff, 0), cursor)
            pending[staff]!.push({ items: direction.items, time: cursor, at: upToNow ? first.length : undefined })
          }
          for (const mark of direction.wedges) handleWedge(mark, staff)
          break
        }
        case 'backup': {
          const ticks = intOf(child(c, 'duration')) ?? 0
          cursor = sub(cursor, frac(ticks, divisions * 4))
          if (cmp(cursor, ZERO) < 0) cursor = ZERO
          break
        }
        case 'forward': {
          const ticks = intOf(child(c, 'duration')) ?? 0
          const length = frac(ticks, divisions * 4)
          const voiceText = child(c, 'voice')?.text
          if (voiceText !== undefined && voiceText !== '' && ticks > 0) {
            // A hidden rest of a voice (what the writer makes).
            const staffNo = intOf(child(c, 'staff')) ?? 1
            const staff = staffNo >= 2 && staves === 2 ? 1 : 0
            const voice = voiceIndexOf(staff, voiceText)
            fillTo(staff, voice, cursor)
            const rest: Note = { kind: 'note', id: ids.nextId(undefined), rest: true, hidden: true, dots: 0, duration: length, slurs: [], tuplets: [] }
            voiceList(staff, voice).push(rest)
            starts.set(rest, cursor)
            ends[staff]![voice] = add(cursor, length)
            lastTarget = undefined
          }
          cursor = add(cursor, length)
          break
        }
        case 'note': {
          const isChord = child(c, 'chord') !== undefined
          const staffNo = intOf(child(c, 'staff')) ?? 1
          const durationTicks = intOf(child(c, 'duration'))
          let target: { staff: number; voice: number } | undefined
          if (isChord) target = lastTarget
          else if (staffNo <= staves || staffNo < 1) target = { staff: staffNo >= 2 ? 1 : 0, voice: voiceIndexOf(staffNo >= 2 ? 1 : 0, child(c, 'voice')?.text || '1') }
          if (!target) {
            // A note on a third staff, or a chord member of one: dropped, but it still takes its time.
            skippedNotes++
            if (!isChord && child(c, 'grace') === undefined && durationTicks !== undefined) cursor = add(cursor, frac(durationTicks, divisions * 4))
            if (!isChord) lastTarget = undefined
            break
          }
          const note = parseNote(c, divisions, ids.nextId(c.attrs.id), warnings, number)
          const advance = note.grace ? ZERO : durationTicks !== undefined ? frac(durationTicks, divisions * 4) : note.duration
          // An arpeggio belongs to the chord: it is kept on its first note, whichever note had it.
          if (note.chord && note.arpeggio && chordFirst) {
            chordFirst.arpeggio = true
            delete note.arpeggio
          }
          if (!note.chord) chordFirst = note
          const { staff, voice } = target
          let start: Frac
          if (isChord) start = lastStart
          else {
            start = cursor
            fillTo(staff, voice, start)
            lastStart = start
            lastTarget = target
            cursor = add(cursor, advance)
          }
          voiceList(staff, voice).push(note)
          starts.set(note, start)
          if (!isChord) ends[staff]![voice] = add(start, advance)
          seenNoteInMeasure = true
          sawNote = true
          if (voice === 0 && !note.chord && !note.grace) {
            const state = wedges[staff]!
            state.lastNote = note
            for (const open of state.open) {
              if (open.startNote) continue
              open.startNote = note
              open.startList = voiceList(staff, 0)
              open.startHere = true
            }
          }
          break
        }
        default:
          break
      }
    }

    if (shared.time) timeInForce = shared.time
    // A first voice that has nothing while another voice has something gets a hidden rest for the bar (the
    // time signature's length, else the longest voice). Later voices are not padded at the end.
    const staffBars: StaffBar[] = []
    for (let staff = 0; staff < staves; staff++) {
      const extent = (ends[staff] ?? []).reduce<Frac>((a, e) => (e && cmp(e, a) > 0 ? e : a), ZERO)
      const count = Math.max(lists[staff]!.length, 1)
      const list0 = lists[staff]![0]
      if ((list0 === undefined || list0.length === 0) && cmp(extent, ZERO) > 0) {
        fillTo(staff, 0, timeInForce ? frac(timeInForce.beats, timeInForce.beatType) : extent)
      }
      const voices: MeasureItem[][] = Array.from({ length: count }, (_, v) => lists[staff]![v] ?? [])
      // Directions go into the first voice, where they belong in time.
      const first = voices[0]!
      if (pending[staff]!.length > 0) {
        // A direction inside a hidden rest of the first voice splits the rest there, so it stays at its time.
        for (const p of pending[staff]!) {
          if (p.at !== undefined) continue
          const i = first.findIndex((item) => {
            const st = starts.get(item)
            return isNote(item) && item.hidden === true && st !== undefined && cmp(st, p.time) < 0 && cmp(add(st, item.duration), p.time) > 0
          })
          if (i < 0) continue
          const rest = first[i] as Note
          const st = starts.get(rest)!
          const tail: Note = { ...rest, id: ids.nextId(undefined), duration: sub(add(st, rest.duration), p.time) }
          rest.duration = sub(p.time, st)
          first.splice(i + 1, 0, tail)
          starts.set(tail, p.time)
          for (const q of pending[staff]!) if (q.at !== undefined && q.at > i) q.at++
        }
        const placed = pending[staff]!
          .map((p, seq) => {
            let at = p.at
            if (at === undefined) {
              at = first.findIndex((item) => cmp(starts.get(item) ?? ZERO, p.time) >= 0)
              if (at < 0) at = first.length
            }
            return { at, seq, items: p.items }
          })
          .sort((a, b) => a.at - b.at || a.seq - b.seq)
        const merged: MeasureItem[] = []
        let next = 0
        first.forEach((item, i) => {
          while (next < placed.length && placed[next]!.at <= i) merged.push(...placed[next++]!.items)
          merged.push(item)
        })
        while (next < placed.length) merged.push(...placed[next++]!.items)
        first.splice(0, first.length, ...merged)
      }
      for (const w of pendingWedges) {
        if (!voices.includes(w.list)) continue
        const at = w.list.indexOf(w.before)
        if (at >= 0) w.list.splice(at, 0, w.wedge)
      }
      for (const v of voices) pairTremolos(v)
      const sb: StaffBar = { voices }
      if (clefs[staff]) sb.clef = clefs[staff]!
      staffBars.push(sb)
    }
    // Wedges started in this bar are done with the bar's own list now.
    for (const state of wedges) for (const open of state.open) open.startHere = false

    const pb: PartBar = { staves: staffBars }
    if (key) pb.key = key
    if (multiRest !== undefined) pb.multiRest = multiRest
    bars.push({ number, shared, pb })
  })

  if (skippedNotes > 0) warnings.push(`${skippedNotes} notes on a third staff were dropped`)
  const openCount = wedges.reduce((sum, w) => sum + w.open.length, 0)
  if (openCount > 0) warnings.push(`${openCount} hairpin${openCount === 1 ? '' : 's'} that never stopped ${openCount === 1 ? 'was' : 'were'} dropped`)

  // Every bar of a staff has the same number of voices.
  const voiceCounts = [0, 1].slice(0, staves).map((staff) => Math.max(1, ...bars.map((b) => b.pb.staves[staff]!.voices.length)))
  for (const b of bars) {
    b.pb.staves.forEach((sb, staff) => {
      while (sb.voices.length < voiceCounts[staff]!) sb.voices.push([])
    })
  }
  return { staves, bars, voiceCounts }
}

/**
 * Settles what kind each tremolo of the bar is (design D2). homr never writes `single`: it alternates
 * start and stop over the whole piece, whether or not two notes are joined. A `start` whose next note in
 * the same bar has a `stop` is a two-note tremolo; any other `start` or `stop` is a single one. The
 * next note skips grace notes and chord members. A tremolo already marked `single` stays so.
 */
function pairTremolos(items: MeasureItem[]): void {
  const melody = items.filter(isNote).filter((n) => !n.chord && !n.grace)
  const paired = new Set<Note>()
  melody.forEach((n, i) => {
    const next = melody[i + 1]
    if (n.tremolo?.kind === 'start' && next?.tremolo?.kind === 'stop') {
      paired.add(n)
      paired.add(next)
    }
  })
  for (const n of items) {
    if (isNote(n) && n.tremolo && !paired.has(n)) n.tremolo.kind = 'single'
  }
}

function parseClef(c: XmlElement): Clef {
  const clef: Clef = { sign: child(c, 'sign')?.text || 'G' }
  const line = intOf(child(c, 'line'))
  if (line !== undefined) clef.line = line
  const oc = intOf(child(c, 'clef-octave-change'))
  if (oc !== undefined) clef.octaveChange = oc
  return clef
}

function parseKey(k: XmlElement): KeySignature | undefined {
  const fifths = intOf(child(k, 'fifths'))
  if (fifths === undefined) return undefined
  const key: KeySignature = { fifths }
  const mode = child(k, 'mode')?.text
  if (mode) key.mode = mode
  return key
}

function parseTime(t: XmlElement): TimeSignature | undefined {
  const beats = intOf(child(t, 'beats'))
  const beatType = intOf(child(t, 'beat-type'))
  if (beats === undefined || beatType === undefined || beats <= 0 || beatType <= 0) return undefined
  const time: TimeSignature = { beats, beatType }
  if (t.attrs.symbol === 'common' || t.attrs.symbol === 'cut') time.symbol = t.attrs.symbol
  return time
}

function parseBarline(b: XmlElement): Barline | undefined {
  const bar: Barline = {}
  const style = child(b, 'bar-style')?.text
  if (style) bar.style = style
  const repeat = child(b, 'repeat')
  if (repeat) {
    const dir = repeat.attrs.direction
    if (dir === 'forward' || dir === 'backward') bar.repeat = dir
    const times = repeat.attrs.times
    if (times && /^\d+$/.test(times)) bar.times = Number(times)
  }
  const ending = child(b, 'ending')
  if (ending) {
    const type = ending.attrs.type
    if (type === 'start' || type === 'stop' || type === 'discontinue') {
      const e: Ending = { number: ending.attrs.number ?? '1', type }
      bar.ending = e
    }
  }
  return Object.keys(bar).length > 0 ? bar : undefined
}

/** A `<wedge>` as read: the model resolves it to notes later (see `handleWedge`). */
interface WedgeMark {
  type: 'crescendo' | 'diminuendo' | 'stop'
  number: string
}

/**
 * The items of one `<direction>`. The first item takes the direction's `id` (through `nextId`, which
 * keeps it when it is free); any further one (several dynamics, or a dynamic with a tempo mark) a fresh one.
 */
function parseDirection(d: XmlElement, sawNote: boolean, nextId: (wanted: string | undefined) => string): { items: MeasureItem[]; wedges: WedgeMark[] } {
  const items: MeasureItem[] = []
  const wedges: WedgeMark[] = []
  let wanted = d.attrs.id
  const id = (): string => {
    const given = nextId(wanted)
    wanted = undefined
    return given
  }
  const tempo: Omit<TempoItem, 'id'> = { kind: 'tempo' }
  let hasTempo = false
  const words: string[] = []

  for (const dt of kids(d, 'direction-type')) {
    for (const c of dt.children) {
      if (c.name === 'dynamics') {
        for (const mark of c.children) {
          const text = mark.name === 'other-dynamics' ? mark.text : mark.name
          if (text) items.push({ kind: 'dynamic', id: id(), mark: text })
        }
      } else if (c.name === 'wedge') {
        const type = c.attrs.type
        if (type === 'crescendo' || type === 'diminuendo' || type === 'stop') wedges.push({ type, number: c.attrs.number ?? '1' })
      } else if (c.name === 'words') {
        if (c.text) words.push(c.text)
      } else if (c.name === 'metronome') {
        const unit = child(c, 'beat-unit')?.text
        if (unit && isNoteType(unit)) {
          tempo.beatUnit = unit
          const dots = kids(c, 'beat-unit-dot').length
          if (dots > 0) tempo.beatUnitDots = dots
        }
        const pm = numOf(child(c, 'per-minute'))
        if (pm !== undefined) tempo.perMinute = pm
        hasTempo = true
      }
    }
  }
  const sound = child(d, 'sound')
  const soundTempo = sound ? Number(sound.attrs.tempo) : NaN
  if (Number.isFinite(soundTempo) && soundTempo > 0) {
    tempo.soundTempo = soundTempo
    hasTempo = true
  }

  const text = words.join(' ')
  if (hasTempo) {
    if (text) tempo.words = text
    items.push({ id: id(), ...tempo })
  } else if (text) {
    // Words alone before the first note are taken as the tempo word ("Moderato").
    items.push(sawNote ? { kind: 'words', id: id(), text } : { kind: 'tempo', id: id(), words: text })
  }
  return { items, wedges }
}

function parseNote(n: XmlElement, divisions: number, id: string, warnings: string[], bar: string): Note {
  const note: Note = { kind: 'note', id, dots: kids(n, 'dot').length, duration: ZERO, slurs: [], tuplets: [] }

  const rest = child(n, 'rest')
  if (rest) {
    note.rest = true
    if (rest.attrs.measure === 'yes') note.measureRest = true
  }
  const pitchEl = child(n, 'pitch')
  if (pitchEl && !rest) {
    const step = child(pitchEl, 'step')?.text ?? ''
    const octave = intOf(child(pitchEl, 'octave'))
    if (STEPS.has(step) && octave !== undefined) {
      const pitch: Pitch = { step: step as Step, octave }
      const alter = numOf(child(pitchEl, 'alter'))
      if (alter !== undefined && alter !== 0) pitch.alter = alter
      note.pitch = pitch
    } else {
      warnings.push(`Measure ${bar}: note with an invalid pitch treated as a rest`)
      note.rest = true
    }
  } else if (!rest) {
    // Unpitched or malformed: keep timing, play nothing.
    note.rest = true
  }

  const accidental = child(n, 'accidental')?.text
  if (accidental) note.accidental = accidental
  if (child(n, 'chord')) note.chord = true

  const tm = child(n, 'time-modification')
  if (tm) {
    const actual = intOf(child(tm, 'actual-notes'))
    const normal = intOf(child(tm, 'normal-notes'))
    if (actual && normal && actual > 0 && normal > 0) note.timeMod = { actual, normal }
  }

  const typeText = child(n, 'type')?.text ?? ''
  if (isNoteType(typeText)) note.type = typeText
  const durationTicks = intOf(child(n, 'duration'))
  const fromElement = durationTicks !== undefined ? frac(durationTicks, divisions * 4) : undefined

  if (child(n, 'grace')) {
    note.grace = true
    note.duration = ZERO
  } else if (note.type) {
    note.duration = noteDuration(note.type, note.dots, note.timeMod)
    if (fromElement && !eq(fromElement, note.duration)) {
      warnings.push(`Measure ${bar}: <duration> disagrees with <type>; the printed note value is used`)
    }
  } else if (fromElement) {
    note.duration = fromElement
  } else {
    warnings.push(`Measure ${bar}: note without type or duration`)
  }

  const tieEls = kids(n, 'tie')
  for (const t of tieEls) {
    if (t.attrs.type === 'start') note.tieStart = true
    if (t.attrs.type === 'stop') note.tieStop = true
  }
  const setOrnament = (kind: NonNullable<Note['ornament']>): void => {
    if (note.ornament === undefined) note.ornament = kind
    else warnings.push(`Measure ${bar}: a note with more than one ornament keeps only the first (${note.ornament}); ${kind} was dropped`)
  }
  for (const notations of kids(n, 'notations')) {
    for (const c of notations.children) {
      if (c.name === 'tied') {
        if (c.attrs.type === 'start') note.tieStart = true
        if (c.attrs.type === 'stop') note.tieStop = true
      } else if (c.name === 'slur') {
        const type = c.attrs.type
        if (type === 'start' || type === 'stop' || type === 'continue') {
          const mark: SlurMark = { type, number: Number(c.attrs.number ?? '1') || 1 }
          note.slurs.push(mark)
        }
      } else if (c.name === 'tuplet') {
        const type = c.attrs.type
        if (type === 'start' || type === 'stop') {
          const mark: TupletMark = { type, number: Number(c.attrs.number ?? '1') || 1 }
          note.tuplets.push(mark)
        }
      } else if (c.name === 'articulations') {
        if (child(c, 'staccato')) note.staccato = true
        if (child(c, 'tenuto')) note.tenuto = true
        if (child(c, 'accent')) note.accent = true
        if (child(c, 'breath-mark')) note.breath = true
        if (child(c, 'strong-accent')) note.strongAccent = true
        if (child(c, 'staccatissimo')) note.staccatissimo = true
        if (child(c, 'caesura')) note.caesura = true
        // homr writes a mordent here, which is not valid MusicXML; it is read all the same.
        if (child(c, 'mordent')) setOrnament('mordent')
        if (child(c, 'doit')) warnings.push(`Measure ${bar}: a doit mark was dropped (it is neither drawn nor played)`)
      } else if (c.name === 'ornaments') {
        for (const o of c.children) {
          if (o.name === 'trill-mark') setOrnament('trill')
          else if (o.name === 'turn' || o.name === 'inverted-turn') setOrnament('turn')
          else if (o.name === 'mordent') setOrnament('mordent')
          else if (o.name === 'tremolo' && !note.tremolo) {
            const type = o.attrs.type
            if (type === 'start' || type === 'stop' || type === 'single') {
              const strokes = intOf(o)
              note.tremolo = { kind: type, strokes: strokes !== undefined && strokes > 0 ? strokes : 3 }
            }
          }
        }
      } else if (c.name === 'fermata') {
        note.fermata = true
      } else if (c.name === 'arpeggiate') {
        note.arpeggio = true
      }
    }
  }
  return note
}

// ------------------------------------------------------------ serialising

function txt(name: string, value: string | number, attrs: Record<string, string> = {}): XmlElement {
  return el(name, attrs, String(value))
}

/** Serialises the score as partwise MusicXML. */
export interface SerializeOptions {
  /** Beam marks by note id (display only: see beams.ts). */
  beams?: Map<string, BeamMark[]>
  /**
   * For drawing only, never stored (change select-and-delete-elements, design D2): ids that Verovio keeps
   * on what it draws, so a tap can be traced back to the model. `clef-<bar>` on a bar's clef (the bar's
   * index, from 0; staff 0 of the first part), `slur-<noteId>-<number>` on a slur start, `tie-<noteId>` on a
   * tie start and `wedge-<startId>` on a hairpin start. Any other staff's clef is `clef-<bar>-<part id>-<staff>`.
   */
  drawingIds?: boolean
  /**
   * What to do with a multi-measure rest that still holds (`partMultiRestRuns`): `collapse` writes its
   * `<multiple-rest>`, so Verovio draws it as one symbol; `expand` leaves it out, so every bar is drawn.
   * Default `collapse`: the stored file must keep `multiRest`. The editor draws with `expand`.
   */
  multiRests?: 'collapse' | 'expand'
  /** Write only these parts (by id), for drawing; they keep their ids. Default: every part. */
  parts?: string[]
}

/** The drawing ids of `SerializeOptions.drawingIds`. */
export const drawingId = {
  /** The clef of a bar (index from 0); for the first staff of the first part the id has no part or staff in it. */
  clef: (bar: number, partId?: string, staff = 0): string => (partId === undefined ? `clef-${bar}` : `clef-${bar}-${partId}-${staff}`),
  slur: (noteId: string, number: number): string => `slur-${noteId}-${number}`,
  tie: (noteId: string): string => `tie-${noteId}`,
  wedge: (startId: string): string => `wedge-${startId}`,
}

/** The MusicXML voice number of a voice: 1-4 on the first staff, 5-8 on the second (as homr writes them). */
function voiceNumber(staff: number, voice: number): number {
  return voice < 4 ? 1 + 4 * staff + voice : 9 + 8 * staff + (voice - 4)
}

export function serializeMusicXml(score: Score, options: SerializeOptions = {}): string {
  const selected = score.parts.map((_, i) => i).filter((i) => !options.parts || options.parts.includes(score.parts[i]!.id))

  // One <divisions> for the whole score, large enough for every duration of every part.
  let divisions = 1
  for (const bar of score.bars) {
    for (const pi of selected) {
      for (const sb of bar.parts[pi]?.staves ?? []) {
        for (const items of sb.voices) {
          for (const item of items) {
            if (isNote(item) && item.duration.n !== 0) divisions = lcm(divisions, mul(item.duration, frac(4)).d)
          }
        }
      }
    }
  }

  const root = el('score-partwise', { version: '4.0' })
  if (score.title) root.children.push(el('work', {}, [txt('work-title', score.title)]))
  if (score.bars.some((b) => b.time?.inferred)) {
    root.children.push(
      el('identification', {}, [
        el('miscellaneous', {}, [txt('miscellaneous-field', 'true', { name: 'time-signature-inferred' })]),
      ]),
    )
  }
  root.children.push(
    el('part-list', {}, selected.map((pi) => el('score-part', { id: score.parts[pi]!.id }, [txt('part-name', score.parts[pi]!.name)]))),
  )

  // Hairpins are written by note id: the start right before its first note, the stop right after its last.
  const wedgeStarts = new Map<string, WedgeItem[]>()
  const wedgeStops = new Map<string, WedgeItem[]>()
  {
    const order = new Map<string, number>()
    const lists = allItemLists(score)
    for (const items of lists) for (const item of items) if (isNote(item)) order.set(item.id, order.size)
    for (const items of lists) {
      for (const item of items) {
        if (!isWedge(item)) continue
        const a = order.get(item.start)
        const b = order.get(item.stop)
        if (a === undefined || b === undefined || a > b) continue // dangling: never written
        wedgeStarts.set(item.start, [...(wedgeStarts.get(item.start) ?? []), item])
        wedgeStops.set(item.stop, [...(wedgeStops.get(item.stop) ?? []), item])
      }
    }
  }

  /** Whether the chord being written is arpeggiated: it is set on the first note and written on all of them. */
  let arpeggio = false
  for (const pi of selected) {
    const info = score.parts[pi]!
    const collapsedRuns = options.multiRests === 'expand' ? [] : partMultiRestRuns(score, pi)
    const wedgeNumbers = new Map<WedgeItem, number>()
    const openNumbers = new Set<number>()
    /** A direction of a two-staff part names its staff (before `<sound>`, the last child of a direction). */
    const onStaff = (direction: XmlElement, staff: number): XmlElement => {
      if (info.staves < 2) return direction
      const at = direction.children.findIndex((c) => c.name === 'sound')
      direction.children.splice(at < 0 ? direction.children.length : at, 0, txt('staff', staff + 1))
      return direction
    }
    const wedgeDirection = (w: WedgeItem, type: 'crescendo' | 'diminuendo' | 'stop', staff: number): XmlElement => {
      let number = wedgeNumbers.get(w)
      if (type !== 'stop') {
        number = 1
        while (openNumbers.has(number)) number++
        openNumbers.add(number)
        wedgeNumbers.set(w, number)
      } else if (number !== undefined) openNumbers.delete(number)
      const wedge = el('wedge', { type, number: String(number ?? 1), ...(options.drawingIds && type !== 'stop' ? { id: drawingId.wedge(w.start) } : {}) })
      return onStaff(el('direction', { placement: 'below' }, [el('direction-type', {}, [wedge])]), staff)
    }

    const part = el('part', { id: info.id })
    score.bars.forEach((bar, index) => {
      const pb = bar.parts[pi]
      const measure = el('measure', { number: bar.number })
      if (bar.newSystem) measure.children.push(el('print', { 'new-system': 'yes' }))
      if (bar.leftBarline) measure.children.push(barlineEl(bar.leftBarline, 'left'))

      const attrs = el('attributes')
      if (index === 0) attrs.children.push(txt('divisions', divisions))
      if (pb?.key) {
        const key = el('key', {}, [txt('fifths', pb.key.fifths)])
        if (pb.key.mode) key.children.push(txt('mode', pb.key.mode))
        attrs.children.push(key)
      }
      if (bar.time) {
        const timeAttrs: Record<string, string> = bar.time.symbol ? { symbol: bar.time.symbol } : {}
        attrs.children.push(
          el('time', timeAttrs, [txt('beats', bar.time.beats), txt('beat-type', bar.time.beatType)]),
        )
      }
      if (index === 0 && info.staves === 2) attrs.children.push(txt('staves', 2))
      pb?.staves.forEach((sb, si) => {
        if (!sb.clef) return
        const clefAttrs: Record<string, string> = {}
        if (info.staves === 2) clefAttrs.number = String(si + 1)
        if (options.drawingIds) clefAttrs.id = pi === 0 && si === 0 ? drawingId.clef(index) : drawingId.clef(index, info.id, si)
        const clef = el('clef', clefAttrs, [txt('sign', sb.clef.sign)])
        if (sb.clef.line !== undefined) clef.children.push(txt('line', sb.clef.line))
        if (sb.clef.octaveChange !== undefined) clef.children.push(txt('clef-octave-change', sb.clef.octaveChange))
        attrs.children.push(clef)
      })
      // measure-style comes last in <attributes>.
      const run = collapsedRuns.find((r) => r.start === index)
      if (run) attrs.children.push(el('measure-style', {}, [txt('multiple-rest', run.length)]))
      if (attrs.children.length > 0) measure.children.push(attrs)

      /** Ticks written since the start of the bar: the next voice starts with a `<backup>` of this much. */
      let written = 0
      pb?.staves.forEach((sb, si) => {
        sb.voices.forEach((items, vi) => {
          if (items.length === 0) return
          if (written > 0) measure.children.push(el('backup', {}, [txt('duration', written)]))
          written = 0
          const voice = voiceNumber(si, vi)
          /** Hairpin stops wait until the stop note and its chord are written, and go out before the next direction or note. */
          const pendingStops: WedgeItem[] = []
          const flushStops = (): void => {
            for (const w of pendingStops.splice(0)) measure.children.push(wedgeDirection(w, 'stop', si))
          }
          for (const item of items) {
            if (item.kind === 'wedge') continue // written next to its notes (above)
            if (item.kind !== 'note') flushStops()
            if (item.kind === 'note') {
              if (!item.chord) {
                flushStops()
                for (const w of wedgeStarts.get(item.id) ?? []) measure.children.push(wedgeDirection(w, w.type, si))
              }
              if (item.hidden) {
                const ticks = mul(item.duration, frac(4 * divisions)).n
                measure.children.push(el('forward', {}, [txt('duration', ticks), txt('voice', voice), txt('staff', si + 1)]))
                written += ticks
                continue
              }
              if (!item.chord) arpeggio = item.arpeggio === true
              measure.children.push(noteEl(item, divisions, voice, si + 1, options.beams?.get(item.id), options.drawingIds, arpeggio))
              if (!item.chord && !item.grace) written += mul(item.duration, frac(4 * divisions)).n
              pendingStops.push(...(wedgeStops.get(item.id) ?? []))
            } else if (item.kind === 'dynamic') {
              const mark = isStandardDynamic(item.mark)
                ? el(item.mark)
                : txt('other-dynamics', item.mark)
              measure.children.push(
                onStaff(el('direction', { id: item.id, placement: 'below' }, [el('direction-type', {}, [el('dynamics', {}, [mark])])]), si),
              )
            } else if (item.kind === 'words') {
              measure.children.push(
                onStaff(el('direction', { id: item.id, placement: 'above' }, [el('direction-type', {}, [txt('words', item.text)])]), si),
              )
            } else {
              measure.children.push(onStaff(tempoEl(item), si))
            }
          }
          flushStops()
        })
      })
      if (bar.rightBarline) measure.children.push(barlineEl(bar.rightBarline, 'right'))
      part.children.push(measure)
    })
    root.children.push(part)
  }
  return serializeXml(root)
}

/** Serialises one voice view as partwise MusicXML (one part, one staff, one voice). */
export function serializeVoice(score: VoiceScore, options: SerializeOptions = {}): string {
  return serializeMusicXml(singleVoiceScore(score.measures, { ...(score.title !== undefined ? { title: score.title } : {}), ...(score.partName !== undefined ? { partName: score.partName } : {}) }), options)
}

const STANDARD_DYNAMICS = new Set([
  'p', 'pp', 'ppp', 'pppp', 'ppppp', 'pppppp', 'f', 'ff', 'fff', 'ffff', 'fffff', 'ffffff',
  'mp', 'mf', 'sf', 'sfp', 'sfpp', 'fp', 'rf', 'rfz', 'sfz', 'sffz', 'fz', 'n', 'pf', 'sfzp',
])
function isStandardDynamic(s: string): boolean {
  return STANDARD_DYNAMICS.has(s)
}

function barlineEl(b: Barline, location: 'left' | 'right'): XmlElement {
  const e = el('barline', { location })
  if (b.style) e.children.push(txt('bar-style', b.style))
  if (b.ending) e.children.push(el('ending', { number: b.ending.number, type: b.ending.type }))
  if (b.repeat) {
    const attrs: Record<string, string> = { direction: b.repeat }
    if (b.times !== undefined) attrs.times = String(b.times)
    e.children.push(el('repeat', attrs))
  }
  return e
}

function tempoEl(t: TempoItem): XmlElement {
  const d = el('direction', { id: t.id, placement: 'above' })
  if (t.words) d.children.push(el('direction-type', {}, [txt('words', t.words)]))
  if (t.beatUnit || t.perMinute !== undefined) {
    const metronome = el('metronome')
    if (t.beatUnit) {
      metronome.children.push(txt('beat-unit', t.beatUnit))
      for (let i = 0; i < (t.beatUnitDots ?? 0); i++) metronome.children.push(el('beat-unit-dot'))
    }
    if (t.perMinute !== undefined) metronome.children.push(txt('per-minute', t.perMinute))
    d.children.push(el('direction-type', {}, [metronome]))
  }
  if (t.soundTempo !== undefined) d.children.push(el('sound', { tempo: String(t.soundTempo) }))
  return d
}

function noteEl(n: Note, divisions: number, voice: number, staff: number, beams: BeamMark[] = [], drawingIds = false, arpeggio = false): XmlElement {
  const e = el('note', { id: n.id })
  if (n.grace) e.children.push(el('grace'))
  if (n.chord) e.children.push(el('chord'))
  if (n.rest) e.children.push(el('rest', n.measureRest ? { measure: 'yes' } : {}))
  else if (n.pitch) {
    const p = el('pitch', {}, [txt('step', n.pitch.step)])
    if (n.pitch.alter !== undefined) p.children.push(txt('alter', n.pitch.alter))
    p.children.push(txt('octave', n.pitch.octave))
    e.children.push(p)
  }
  if (!n.grace) {
    const ticks = mul(n.duration, frac(4 * divisions))
    e.children.push(txt('duration', ticks.n))
  }
  if (n.tieStop) e.children.push(el('tie', { type: 'stop' }))
  if (n.tieStart) e.children.push(el('tie', { type: 'start' }))
  e.children.push(txt('voice', voice))
  if (n.type) e.children.push(txt('type', n.type))
  for (let i = 0; i < n.dots; i++) e.children.push(el('dot'))
  if (n.accidental) e.children.push(txt('accidental', n.accidental))
  if (n.timeMod) {
    e.children.push(
      el('time-modification', {}, [txt('actual-notes', n.timeMod.actual), txt('normal-notes', n.timeMod.normal)]),
    )
  }
  e.children.push(txt('staff', staff))
  for (const b of beams) e.children.push(txt('beam', b.value, { number: String(b.number) }))

  const notations = el('notations')
  if (n.tieStop) notations.children.push(el('tied', { type: 'stop' }))
  if (n.tieStart) notations.children.push(el('tied', { type: 'start', ...(drawingIds ? { id: drawingId.tie(n.id) } : {}) }))
  for (const s of n.slurs) {
    const id: Record<string, string> = drawingIds && s.type === 'start' ? { id: drawingId.slur(n.id, s.number) } : {}
    notations.children.push(el('slur', { type: s.type, number: String(s.number), ...id }))
  }
  for (const t of n.tuplets) notations.children.push(el('tuplet', { type: t.type, number: String(t.number) }))
  // Valid MusicXML (design D2): the ornaments and the tremolo under <ornaments>, the rest under <articulations>.
  if (n.ornament || n.tremolo) {
    const orn = el('ornaments')
    if (n.ornament) orn.children.push(el(n.ornament === 'trill' ? 'trill-mark' : n.ornament))
    if (n.tremolo) orn.children.push(txt('tremolo', n.tremolo.strokes, { type: n.tremolo.kind }))
    notations.children.push(orn)
  }
  if (n.staccato || n.staccatissimo || n.tenuto || n.accent || n.strongAccent || n.breath || n.caesura) {
    const art = el('articulations')
    if (n.staccato) art.children.push(el('staccato'))
    if (n.staccatissimo) art.children.push(el('staccatissimo'))
    if (n.tenuto) art.children.push(el('tenuto'))
    if (n.accent) art.children.push(el('accent'))
    if (n.strongAccent) art.children.push(el('strong-accent'))
    if (n.breath) art.children.push(el('breath-mark'))
    if (n.caesura) art.children.push(el('caesura'))
    notations.children.push(art)
  }
  if (n.fermata) notations.children.push(el('fermata'))
  if (arpeggio) notations.children.push(el('arpeggiate'))
  if (notations.children.length > 0) e.children.push(notations)
  return e
}
