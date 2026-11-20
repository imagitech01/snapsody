import type {
  Barline,
  Clef,
  Ending,
  KeySignature,
  Measure,
  MeasureItem,
  Note,
  NoteType,
  Pitch,
  Score,
  SlurMark,
  Step,
  TempoItem,
  TimeModification,
  TimeSignature,
  TupletMark,
  WedgeItem,
} from './model.ts'
import { isNote, isWedge, multiRestRuns } from './model.ts'
import type { BeamMark } from './beams.ts'
import type { Frac } from './rational.ts'
import { ZERO, eq, frac, lcm, mul } from './rational.ts'
import type { XmlElement } from './xml.ts'
import { el, parseXml, serializeXml } from './xml.ts'

/*
 * MusicXML (partwise) <-> score model.
 *
 * Kept: first part, first voice and staff of it; notes, rests, pitch and
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
 * Dropped (reported through `warnings` where it can matter): further parts,
 * other voices/staves, <backup>/<forward>, beams, stems, lyrics, other
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
 */
export function parseMusicXml(source: string, warnings: string[] = []): Score {
  const root = parseXml(source)
  if (root.name === 'score-timewise') throw new Error('Timewise MusicXML is not supported')
  if (root.name !== 'score-partwise') throw new Error(`Not MusicXML: root element is <${root.name}>`)

  const score: Score = { measures: [] }
  const title = child(child(root, 'work') ?? el('x'), 'work-title')?.text
  if (title) score.title = title

  const scorePart = child(child(root, 'part-list') ?? el('x'), 'score-part')
  const partName = child(scorePart ?? el('x'), 'part-name')?.text
  if (partName) score.partName = partName

  const parts = kids(root, 'part')
  const part = parts[0]
  if (!part) {
    warnings.push('No <part> found; the score is empty')
    return score
  }
  if (parts.length > 1) warnings.push(`Only the first of ${parts.length} parts is kept`)

  const inferredTime = kids(child(root, 'identification') ?? el('x'), 'miscellaneous').some((m) =>
    kids(m, 'miscellaneous-field').some((f) => f.attrs.name === 'time-signature-inferred' && f.text === 'true'),
  )

  // Ids: keep ids present in the source, generate the rest without collisions. Notes are numbered
  // n1, n2, ... and directions (dynamics, tempo marks, words) d1, d2, ...; a direction never takes an
  // id a note has, so note ids come out as they would without direction ids.
  const used = new Set<string>()
  const noteIds = new Set<string>()
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
  let counter = 0
  let directionCounter = 0
  const seen = new Set<string>()
  const nextId = (wanted: string | undefined): string => {
    if (wanted && !seen.has(wanted)) {
      seen.add(wanted)
      return wanted
    }
    let id: string
    do id = `n${++counter}`
    while (used.has(id) || seen.has(id))
    seen.add(id)
    return id
  }
  const nextDirectionId = (wanted: string | undefined): string => {
    if (wanted && !seen.has(wanted) && !noteIds.has(wanted)) {
      seen.add(wanted)
      return wanted
    }
    let id: string
    do id = `d${++directionCounter}`
    while (used.has(id) || seen.has(id))
    seen.add(id)
    return id
  }

  let divisions = 1
  let firstVoice: string | undefined
  let firstStaff: string | undefined
  let skippedNotes = 0
  let warnedMove = false
  let warnedBackup = false
  let sawNote = false
  let lastKept = true
  /** The first note of the chord being read (or the single note before its chord members). */
  let chordFirst: Note | undefined
  /** Hairpins started and not yet stopped, in start order; `startNote` is the first note after the start. */
  const openWedges: { type: WedgeItem['type']; number: string; startNote?: Note; startMeasure?: Measure }[] = []
  /** The last note of the melody read so far (not a grace note or a chord member): where a hairpin stop lands. */
  let lastMelodyNote: Note | undefined
  const handleWedge = (mark: WedgeMark, bar: string): void => {
    const at = openWedges.findIndex((o) => o.number === mark.number)
    if (mark.type !== 'stop') {
      if (at >= 0) {
        warnings.push(`Measure ${bar}: a hairpin started inside another one; the earlier one was dropped`)
        openWedges.splice(at, 1)
      }
      openWedges.push({ type: mark.type, number: mark.number })
      return
    }
    if (at < 0) {
      warnings.push(`Measure ${bar}: a hairpin stop without a start was ignored`)
      return
    }
    const [open] = openWedges.splice(at, 1)
    if (!open?.startNote || !open.startMeasure || !lastMelodyNote) {
      warnings.push(`Measure ${bar}: a hairpin with no note under it was dropped`)
      return
    }
    const wedge: WedgeItem = { kind: 'wedge', type: open.type, start: open.startNote.id, stop: lastMelodyNote.id }
    open.startMeasure.items.splice(open.startMeasure.items.indexOf(open.startNote), 0, wedge)
  }

  kids(part, 'measure').forEach((m, index) => {
    const measure: Measure = { number: m.attrs.number ?? String(index + 1), items: [] }
    let seenNoteInMeasure = false

    for (const c of m.children) {
      switch (c.name) {
        case 'attributes': {
          const d = intOf(child(c, 'divisions'))
          if (d && d > 0) divisions = d
          const clef = kids(c, 'clef').find((x) => !x.attrs.number || x.attrs.number === '1')
          if (clef) measure.clef = parseClef(clef)
          const key = child(c, 'key')
          if (key) {
            const k = parseKey(key)
            if (k) measure.key = k
          }
          const style = child(c, 'measure-style')
          const multiple = intOf(style ? child(style, 'multiple-rest') : undefined)
          if (multiple !== undefined && multiple >= 2) measure.multiRest = multiple
          const time = child(c, 'time')
          if (time) {
            const t = parseTime(time)
            if (t) measure.time = t
            else warnings.push(`Measure ${measure.number}: unsupported time signature dropped`)
          }
          if (seenNoteInMeasure && (clef || key || time) && !warnedMove) {
            warnedMove = true
            warnings.push(`Measure ${measure.number}: mid-bar attribute change moved to the start of the bar`)
          }
          break
        }
        case 'print':
          if (c.attrs['new-system'] === 'yes') measure.newSystem = true
          break
        case 'barline': {
          const b = parseBarline(c)
          if (b) {
            if ((c.attrs.location ?? 'right') === 'left') measure.leftBarline = b
            else measure.rightBarline = b
          }
          break
        }
        case 'direction': {
          const direction = parseDirection(c, sawNote, nextDirectionId)
          measure.items.push(...direction.items)
          for (const mark of direction.wedges) handleWedge(mark, measure.number)
          break
        }
        case 'backup':
        case 'forward':
          if (!warnedBackup) {
            warnedBackup = true
            warnings.push(`Measure ${measure.number}: <${c.name}> ignored; only one voice is kept`)
          }
          break
        case 'note': {
          const voice = child(c, 'voice')?.text || '1'
          const staff = child(c, 'staff')?.text || '1'
          const isChord = child(c, 'chord') !== undefined
          if (firstVoice === undefined) {
            firstVoice = voice
            firstStaff = staff
          }
          let keep = voice === firstVoice && staff === firstStaff
          // A chord note belongs to the note before it.
          if (isChord) keep = keep && lastKept
          lastKept = keep
          if (!keep) {
            skippedNotes++
            break
          }
          const note = parseNote(c, divisions, nextId(c.attrs.id), warnings, measure.number)
          // An arpeggio belongs to the chord: it is kept on its first note, whichever note had it.
          if (note.chord && note.arpeggio && chordFirst) {
            chordFirst.arpeggio = true
            delete note.arpeggio
          }
          if (!note.chord) chordFirst = note
          measure.items.push(note)
          seenNoteInMeasure = true
          sawNote = true
          if (!note.chord && !note.grace) {
            lastMelodyNote = note
            for (const open of openWedges) {
              if (open.startNote) continue
              open.startNote = note
              open.startMeasure = measure
            }
          }
          break
        }
        default:
          break
      }
    }
    pairTremolos(measure)
    score.measures.push(measure)
  })

  if (skippedNotes > 0) warnings.push(`${skippedNotes} notes in other voices or staves were dropped`)
  if (openWedges.length > 0) warnings.push(`${openWedges.length} hairpin${openWedges.length === 1 ? '' : 's'} that never stopped ${openWedges.length === 1 ? 'was' : 'were'} dropped`)

  if (inferredTime) {
    const first = score.measures.find((m) => m.time)?.time
    if (first) first.inferred = true
  }
  return score
}

/**
 * Settles what kind each tremolo of the bar is (design D2). homr never writes `single`: it alternates
 * start and stop over the whole piece, whether or not two notes are joined. A `start` whose next note in
 * the same bar has a `stop` is a two-note tremolo; any other `start` or `stop` is a single one. The
 * next note skips grace notes and chord members. A tremolo already marked `single` stays so.
 */
function pairTremolos(measure: Measure): void {
  const melody = measure.items.filter(isNote).filter((n) => !n.chord && !n.grace)
  const paired = new Set<Note>()
  melody.forEach((n, i) => {
    const next = melody[i + 1]
    if (n.tremolo?.kind === 'start' && next?.tremolo?.kind === 'stop') {
      paired.add(n)
      paired.add(next)
    }
  })
  for (const n of measure.items) {
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
   * index, from 0), `slur-<noteId>-<number>` on a slur start, `tie-<noteId>` on a tie start and
   * `wedge-<startId>` on a hairpin start.
   */
  drawingIds?: boolean
  /**
   * What to do with a multi-measure rest that still holds (`multiRestRuns`): `collapse` writes its
   * `<multiple-rest>`, so Verovio draws it as one symbol; `expand` leaves it out, so every bar is drawn.
   * Default `collapse`: the stored file must keep `multiRest`. The editor draws with `expand`.
   */
  multiRests?: 'collapse' | 'expand'
}

/** The drawing ids of `SerializeOptions.drawingIds`. */
export const drawingId = {
  clef: (bar: number): string => `clef-${bar}`,
  slur: (noteId: string, number: number): string => `slur-${noteId}-${number}`,
  tie: (noteId: string): string => `tie-${noteId}`,
  wedge: (startId: string): string => `wedge-${startId}`,
}

export function serializeMusicXml(score: Score, options: SerializeOptions = {}): string {
  // One <divisions> for the whole part, large enough for every duration.
  let divisions = 1
  for (const m of score.measures) {
    for (const item of m.items) {
      if (isNote(item) && item.duration.n !== 0) divisions = lcm(divisions, mul(item.duration, frac(4)).d)
    }
  }

  const root = el('score-partwise', { version: '4.0' })
  if (score.title) root.children.push(el('work', {}, [txt('work-title', score.title)]))
  if (score.measures.some((m) => m.time?.inferred)) {
    root.children.push(
      el('identification', {}, [
        el('miscellaneous', {}, [txt('miscellaneous-field', 'true', { name: 'time-signature-inferred' })]),
      ]),
    )
  }
  root.children.push(
    el('part-list', {}, [el('score-part', { id: 'P1' }, [txt('part-name', score.partName ?? '')])]),
  )

  // Hairpins are written by note id: the start right before its first note, the stop right after its last.
  const wedgeStarts = new Map<string, WedgeItem[]>()
  const wedgeStops = new Map<string, WedgeItem[]>()
  const wedgeNumbers = new Map<WedgeItem, number>()
  {
    const order = new Map<string, number>()
    for (const m of score.measures) for (const item of m.items) if (isNote(item)) order.set(item.id, order.size)
    for (const m of score.measures) {
      for (const item of m.items) {
        if (!isWedge(item)) continue
        const a = order.get(item.start)
        const b = order.get(item.stop)
        if (a === undefined || b === undefined || a > b) continue // dangling: never written
        wedgeStarts.set(item.start, [...(wedgeStarts.get(item.start) ?? []), item])
        wedgeStops.set(item.stop, [...(wedgeStops.get(item.stop) ?? []), item])
      }
    }
  }
  const openNumbers = new Set<number>()
  const wedgeDirection = (w: WedgeItem, type: 'crescendo' | 'diminuendo' | 'stop'): XmlElement => {
    let number = wedgeNumbers.get(w)
    if (type !== 'stop') {
      number = 1
      while (openNumbers.has(number)) number++
      openNumbers.add(number)
      wedgeNumbers.set(w, number)
    } else if (number !== undefined) openNumbers.delete(number)
    const wedge = el('wedge', { type, number: String(number ?? 1), ...(options.drawingIds && type !== 'stop' ? { id: drawingId.wedge(w.start) } : {}) })
    return el('direction', { placement: 'below' }, [el('direction-type', {}, [wedge])])
  }

  const collapsedRuns = options.multiRests === 'expand' ? [] : multiRestRuns(score)
  const part = el('part', { id: 'P1' })
  /** Whether the chord being written is arpeggiated: it is set on the first note and written on all of them. */
  let arpeggio = false
  score.measures.forEach((m, index) => {
    const measure = el('measure', { number: m.number })
    if (m.newSystem) measure.children.push(el('print', { 'new-system': 'yes' }))
    if (m.leftBarline) measure.children.push(barlineEl(m.leftBarline, 'left'))

    const attrs = el('attributes')
    if (index === 0) attrs.children.push(txt('divisions', divisions))
    if (m.key) {
      const key = el('key', {}, [txt('fifths', m.key.fifths)])
      if (m.key.mode) key.children.push(txt('mode', m.key.mode))
      attrs.children.push(key)
    }
    if (m.time) {
      const timeAttrs: Record<string, string> = m.time.symbol ? { symbol: m.time.symbol } : {}
      attrs.children.push(
        el('time', timeAttrs, [txt('beats', m.time.beats), txt('beat-type', m.time.beatType)]),
      )
    }
    if (m.clef) {
      const clef = el('clef', options.drawingIds ? { id: drawingId.clef(index) } : {}, [txt('sign', m.clef.sign)])
      if (m.clef.line !== undefined) clef.children.push(txt('line', m.clef.line))
      if (m.clef.octaveChange !== undefined) clef.children.push(txt('clef-octave-change', m.clef.octaveChange))
      attrs.children.push(clef)
    }
    // measure-style comes last in <attributes>.
    const run = collapsedRuns.find((r) => r.start === index)
    if (run) attrs.children.push(el('measure-style', {}, [txt('multiple-rest', run.length)]))
    if (attrs.children.length > 0) measure.children.push(attrs)

    /** Hairpin stops wait until the stop note and its chord are written, and go out before the next direction or note. */
    const pendingStops: WedgeItem[] = []
    const flushStops = (): void => {
      for (const w of pendingStops.splice(0)) measure.children.push(wedgeDirection(w, 'stop'))
    }
    for (const item of m.items) {
      if (item.kind === 'wedge') continue // written next to its notes (above)
      if (item.kind !== 'note') flushStops()
      if (item.kind === 'note') {
        if (!item.chord) {
          flushStops()
          for (const w of wedgeStarts.get(item.id) ?? []) measure.children.push(wedgeDirection(w, w.type))
        }
        if (!item.chord) arpeggio = item.arpeggio === true
        measure.children.push(noteEl(item, divisions, options.beams?.get(item.id), options.drawingIds, arpeggio))
        pendingStops.push(...(wedgeStops.get(item.id) ?? []))
      } else if (item.kind === 'dynamic') {
        const mark = isStandardDynamic(item.mark)
          ? el(item.mark)
          : txt('other-dynamics', item.mark)
        measure.children.push(
          el('direction', { id: item.id, placement: 'below' }, [el('direction-type', {}, [el('dynamics', {}, [mark])])]),
        )
      } else if (item.kind === 'words') {
        measure.children.push(
          el('direction', { id: item.id, placement: 'above' }, [el('direction-type', {}, [txt('words', item.text)])]),
        )
      } else {
        measure.children.push(tempoEl(item))
      }
    }
    flushStops()
    if (m.rightBarline) measure.children.push(barlineEl(m.rightBarline, 'right'))
    part.children.push(measure)
  })
  root.children.push(part)
  return serializeXml(root)
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

function noteEl(n: Note, divisions: number, beams: BeamMark[] = [], drawingIds = false, arpeggio = false): XmlElement {
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
  e.children.push(txt('voice', 1))
  if (n.type) e.children.push(txt('type', n.type))
  for (let i = 0; i < n.dots; i++) e.children.push(el('dot'))
  if (n.accidental) e.children.push(txt('accidental', n.accidental))
  if (n.timeMod) {
    e.children.push(
      el('time-modification', {}, [txt('actual-notes', n.timeMod.actual), txt('normal-notes', n.timeMod.normal)]),
    )
  }
  e.children.push(txt('staff', 1))
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
