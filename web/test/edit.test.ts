import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as ed from '../src/core/score/edit.ts'
import { parseMusicXml, serializeMusicXml } from '../src/core/score/musicxml.ts'
import { isNote, isWedge } from '../src/core/score/model.ts'
import type { Note, Score } from '../src/core/score/model.ts'
import { prepareRecognisedScore } from '../src/core/score/prepare.ts'
import { EditSession } from '../src/core/score/editSession.ts'
import { computeWarnings } from '../src/core/score/warnings.ts'
import { TENOR_SAX } from '../src/core/instruments/instruments.ts'
import { frac } from '../src/core/score/rational.ts'
import { startingTempo, tempoSetup } from '../src/core/playback/tempo.ts'

const TICKS: Record<string, number> = { whole: 48, half: 24, quarter: 12, eighth: 6, '16th': 3 }
interface S { id: string; step?: string; octave?: number; alter?: number; acc?: string; type?: string; rest?: boolean }
const note = (s: S): string =>
  `<note id="${s.id}">${s.rest ? '<rest/>' : `<pitch><step>${s.step ?? 'G'}</step>${s.alter ? `<alter>${s.alter}</alter>` : ''}<octave>${s.octave ?? 4}</octave></pitch>`}<duration>${TICKS[s.type ?? 'quarter']}</duration><voice>1</voice><type>${s.type ?? 'quarter'}</type>${s.acc ? `<accidental>${s.acc}</accidental>` : ''}</note>`
function score(bars: S[][], opts: { fifths?: number; beats?: number; beatType?: number; direction?: string } = {}): Score {
  const ms = bars
    .map((b, i) => {
      const attrs =
        i === 0
          ? `<attributes><divisions>12</divisions><key><fifths>${opts.fifths ?? 0}</fifths></key>${opts.beats === 0 ? '' : `<time><beats>${opts.beats ?? 3}</beats><beat-type>${opts.beatType ?? 4}</beat-type></time>`}</attributes>${opts.direction ?? ''}`
          : ''
      return `<measure number="${i + 1}">${attrs}${b.map(note).join('')}</measure>`
    })
    .join('')
  return parseMusicXml(`<?xml version="1.0"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name></part-name></score-part></part-list><part id="P1">${ms}</part></score-partwise>`)
}
/** The warnings of a score for the tenor saxophone (what the editor shows after every edit). */
const recheck = (s: Score) => computeWarnings(s, TENOR_SAX)
const notes = (s: Score): Note[] => s.measures.flatMap((m) => m.items.filter(isNote))
const byId = (s: Score, id: string): Note => notes(s).find((n) => n.id === id)!
const name = (n: Note): string => `${n.pitch!.step}${n.pitch!.alter === 1 ? '#' : n.pitch!.alter === -1 ? 'b' : ''}${n.pitch!.octave}`
const three = (): Score => score([[{ id: 'a', step: 'C', octave: 5 }, { id: 'b', step: 'F', octave: 4 }, { id: 'c', step: 'G' }], [{ id: 'd', step: 'F', octave: 4 }, { id: 'e', step: 'F', octave: 5 }, { id: 'f', rest: true }]])

test('C5 stepped down is B4; stepping up wraps to the next octave', () => {
  const s = three()
  ed.stepPitch(s, 'a', -1)
  assert.equal(name(byId(s, 'a')), 'B4')
  ed.stepPitch(s, 'a', 1)
  ed.stepPitch(s, 'a', 1)
  assert.equal(name(byId(s, 'a')), 'D5')
  assert.throws(() => ed.stepPitch(s, 'f', 1), ed.EditError)
})

test('accidentals: sharp, flat, natural, none', () => {
  const s = three()
  ed.setAccidental(s, 'c', 'sharp')
  assert.equal(name(byId(s, 'c')), 'G#4')
  assert.equal(byId(s, 'c').accidental, 'sharp')
  ed.setAccidental(s, 'c', 'flat')
  assert.equal(name(byId(s, 'c')), 'Gb4')
  ed.setAccidental(s, 'c', 'natural')
  assert.equal(name(byId(s, 'c')), 'G4')
  ed.setAccidental(s, 'c', 'none')
  assert.equal(byId(s, 'c').accidental, undefined)
})

test('an accidental carries through the bar for the same step and octave only', () => {
  const s = score([[{ id: 'a', step: 'F' }, { id: 'b', step: 'F' }, { id: 'c', step: 'F', octave: 5 }], [{ id: 'd', step: 'F' }]])
  ed.setAccidental(s, 'a', 'sharp')
  assert.equal(name(byId(s, 'b')), 'F#4')
  assert.equal(name(byId(s, 'c')), 'F5')
  assert.equal(name(byId(s, 'd')), 'F4')
})

test('duration: whole to 16th, dotted, triplet', () => {
  const s = three()
  ed.setDuration(s, 'a', { type: 'half', dots: 0, triplet: false })
  assert.equal(byId(s, 'a').duration.n / byId(s, 'a').duration.d, 0.5)
  ed.setDuration(s, 'a', { type: 'quarter', dots: 1, triplet: false })
  assert.equal(byId(s, 'a').duration.n / byId(s, 'a').duration.d, 3 / 8)
  ed.setDuration(s, 'a', { type: '16th', dots: 0, triplet: false })
  assert.deepEqual([byId(s, 'a').duration.n, byId(s, 'a').duration.d], [1, 16])
  for (const id of ['a', 'b', 'c']) ed.setDuration(s, id, { type: 'eighth', dots: 0, triplet: true })
  assert.deepEqual([byId(s, 'a').duration.n, byId(s, 'a').duration.d], [1, 12])
  assert.deepEqual(byId(s, 'a').tuplets, [{ type: 'start', number: 1 }])
  assert.deepEqual(byId(s, 'c').tuplets, [{ type: 'stop', number: 1 }])
  ed.setDuration(s, 'b', { type: 'quarter', dots: 0, triplet: false })
  assert.equal(byId(s, 'a').tuplets.length, 0)
})

test('toggles: staccato, slur, tie', () => {
  const s = score([[{ id: 'a' }, { id: 'b' }, { id: 'c', step: 'A' }]])
  ed.toggleStaccato(s, 'a')
  assert.equal(byId(s, 'a').staccato, true)
  ed.toggleStaccato(s, 'a')
  assert.equal(byId(s, 'a').staccato, undefined)
  ed.toggleSlur(s, 'a')
  assert.equal(byId(s, 'a').slurs[0]?.type, 'start')
  assert.equal(byId(s, 'b').slurs[0]?.type, 'stop')
  ed.toggleSlur(s, 'b')
  assert.equal(byId(s, 'a').slurs.length + byId(s, 'b').slurs.length, 0)
  ed.toggleTie(s, 'a')
  assert.equal(byId(s, 'a').tieStart, true)
  assert.equal(byId(s, 'b').tieStop, true)
  ed.toggleTie(s, 'a')
  assert.equal(byId(s, 'b').tieStop, undefined)
  assert.throws(() => ed.toggleTie(s, 'b'), ed.EditError) // next note is another pitch
})

test('delete removes the note and its slur partner; insert makes fresh unique ids', () => {
  const s = score([[{ id: 'a' }, { id: 'b' }, { id: 'c' }]])
  ed.toggleSlur(s, 'a')
  const next = ed.deleteNote(s, 'a')
  assert.equal(next, 'b')
  assert.deepEqual(notes(s).map((n) => n.id), ['b', 'c'])
  assert.equal(byId(s, 'b').slurs.length, 0)
  const before = ed.insertNote(s, 'b', 'before', 'note')
  const after = ed.insertNote(s, 'b', 'after', 'rest')
  assert.equal(new Set([before, after, 'b', 'c']).size, 4)
  assert.deepEqual(notes(s).map((n) => n.id), [before, 'b', after, 'c'])
  assert.equal(byId(s, after).rest, true)
  assert.equal(name(byId(s, before)), 'G4')
})

test('key change to one sharp makes un-marked F sound F#; a printed natural stays F', () => {
  const s = score(
    [[{ id: 'a', step: 'F' }, { id: 'b', step: 'F', acc: 'natural' }, { id: 'c', step: 'F' }], [{ id: 'd', step: 'F', octave: 5 }, { id: 'e', step: 'G' }, { id: 'f', step: 'F', octave: 5 }]],
  )
  ed.setKey(s, 1)
  assert.deepEqual(['a', 'b', 'c', 'd', 'e', 'f'].map((id) => name(byId(s, id))), ['F#4', 'F4', 'F4', 'F#5', 'G4', 'F#5']) // c inherits b's natural in the bar
  ed.setKey(s, 0)
  assert.equal(name(byId(s, 'a')), 'F4')
  ed.setKey(s, -1)
  const flat = score([[{ id: 'a', step: 'B' }, { id: 'b', step: 'B', acc: 'natural' }]])
  ed.setKey(flat, -1)
  assert.deepEqual([name(byId(flat, 'a')), name(byId(flat, 'b'))], ['Bb4', 'B4'])
  assert.throws(() => ed.setKey(s, 8), ed.EditError)
})

test('key change survives serialisation and parsing', () => {
  const s = score([[{ id: 'a', step: 'F' }, { id: 'b', step: 'F', acc: 'natural' }, { id: 'c' }]])
  ed.setKey(s, 1)
  const back = parseMusicXml(serializeMusicXml(s))
  assert.equal(back.measures[0]!.key?.fifths, 1)
  assert.deepEqual(notes(back).map((n) => [n.id, name(n), n.accidental]), [['a', 'F#4', undefined], ['b', 'F4', 'natural'], ['c', 'G4', undefined]])
  assert.equal(serializeMusicXml(back), serializeMusicXml(s))
})

test('time signature change re-checks the bars', () => {
  const s = score([[{ id: 'a' }, { id: 'b' }, { id: 'c' }], [{ id: 'd' }, { id: 'e' }, { id: 'f' }]])
  assert.equal(recheck(s).length, 0)
  ed.setTime(s, 4, 4)
  const flags = recheck(s)
  assert.deepEqual(flags.map((f) => [f.kind, f.bar]), [['bar-length', '1'], ['bar-length', '2']])
  ed.setTime(s, 3, 4)
  assert.equal(recheck(s).length, 0)
})

test('inferred time signature warning goes away once the user sets one', () => {
  const prepared = prepareRecognisedScore(
    serializeMusicXml(score([[{ id: 'a' }, { id: 'b' }, { id: 'c' }], [{ id: 'd' }, { id: 'e' }, { id: 'f' }]], { beats: 0 })),
  )
  const s = parseMusicXml(prepared.musicxml)
  assert.deepEqual(recheck(s).map((f) => f.kind), ['time-signature-inferred'])
  ed.setTime(s, 3, 4)
  assert.deepEqual(recheck(s), [])
})

test('"Moderato" sets the default tempo 108 when no tempo was chosen', () => {
  const s = three()
  assert.equal(tempoSetup(s).defaultBpm, 80)
  ed.setTempoMarking(s, { words: 'Moderato' })
  const back = parseMusicXml(serializeMusicXml(s))
  assert.equal(ed.firstTempoMarking(back)?.words, 'Moderato')
  assert.equal(startingTempo(null, tempoSetup(back)), 108)
  assert.equal(startingTempo(70, tempoSetup(back)), 70) // a chosen tempo still wins
  ed.setTempoMarking(back, { words: 'Allegro', perMinute: 120 })
  assert.equal(tempoSetup(back).defaultBpm, 120)
  ed.setTempoMarking(back, {})
  assert.equal(ed.firstTempoMarking(back), undefined)
})

test('lengthening a quarter to a half in a full 3/4 bar flags the bar and editing continues', () => {
  const s = score([[{ id: 'a' }, { id: 'b' }, { id: 'c' }], [{ id: 'd' }, { id: 'e' }, { id: 'f' }]])
  ed.setDuration(s, 'b', { type: 'half', dots: 0, triplet: false })
  const flags = recheck(s)
  assert.deepEqual(flags.map((f) => [f.kind, f.bar]), [['bar-length', '1']])
  ed.stepPitch(s, 'e', 1) // not blocked
  assert.equal(name(byId(s, 'e')), 'A4')
  ed.setDuration(s, 'b', { type: 'quarter', dots: 0, triplet: false })
  assert.equal(recheck(s).length, 0)
})

test('user edits are never auto-repaired as triplets, only flagged', () => {
  const s = score([[{ id: 'a', type: 'eighth' }, { id: 'b', type: 'eighth' }, { id: 'c', type: 'eighth' }, { id: 'd', type: 'quarter' }, { id: 'e', type: 'quarter' }]])
  assert.equal(recheck(s).length, 1)
  assert.equal(byId(s, 'a').timeMod, undefined)
})

test('out-of-range is re-checked too', () => {
  const s = three()
  assert.equal(recheck(s).length, 0)
  for (let i = 0; i < 6; i++) ed.stepPitch(s, 'a', 1) // C5 to B5... then beyond
  for (let i = 0; i < 6; i++) ed.stepPitch(s, 'a', 1)
  assert.equal(recheck(s).some((f) => f.kind === 'out-of-range' && f.noteId === 'a'), true)
})

test('session: undo of a delete restores the note with the same id; redo deletes again', () => {
  const s = three()
  const session = new EditSession(s)
  const original = serializeMusicXml(s)
  session.apply((sc) => ed.deleteNote(sc, 'b'))
  assert.equal(notes(session.score).some((n) => n.id === 'b'), false)
  assert.equal(session.canUndo, true)
  session.undo()
  assert.equal(serializeMusicXml(session.score), original)
  assert.equal(byId(session.score, 'b').id, 'b')
  assert.equal(session.canRedo, true)
  session.redo()
  assert.equal(notes(session.score).some((n) => n.id === 'b'), false)
  session.undo()
  session.apply((sc) => ed.stepPitch(sc, 'a', 1)) // a new edit clears redo
  assert.equal(session.canRedo, false)
})

test('session: an amending edit is undone together with the one before it (a held button)', () => {
  const session = new EditSession(three())
  const before = serializeMusicXml(session.score)
  session.apply((sc) => ed.stepPitch(sc, 'a', 1))
  const first = serializeMusicXml(session.score)
  session.apply((sc) => ed.stepPitch(sc, 'b', 1))
  session.apply((sc) => ed.stepPitch(sc, 'b', 1), { amend: true })
  session.apply((sc) => ed.stepPitch(sc, 'b', 1), { amend: true })
  session.undo()
  assert.equal(serializeMusicXml(session.score), first, 'the three steps of b are one undo step')
  session.undo()
  assert.equal(serializeMusicXml(session.score), before)
  assert.equal(session.canUndo, false)
  // With nothing to amend, it is an undo step of its own.
  session.apply((sc) => ed.stepPitch(sc, 'a', 1), { amend: true })
  assert.equal(session.canUndo, true)
})

test('session: a failed edit changes nothing and is not an undo step', () => {
  const session = new EditSession(three())
  const before = serializeMusicXml(session.score)
  assert.throws(() => session.apply((sc) => ed.stepPitch(sc, 'f', 1)), ed.EditError)
  assert.equal(session.canUndo, false)
  assert.equal(serializeMusicXml(session.score), before)
})

test('edited scores round trip and untouched notes keep their ids', () => {
  const s = three()
  ed.stepPitch(s, 'a', -1)
  ed.setDuration(s, 'c', { type: 'eighth', dots: 1, triplet: false })
  ed.toggleStaccato(s, 'd')
  const inserted = ed.insertNote(s, 'e', 'after', 'note')
  const xml = serializeMusicXml(s)
  const back = parseMusicXml(xml)
  assert.deepEqual(notes(back).map((n) => n.id), ['a', 'b', 'c', 'd', 'e', inserted, 'f'])
  assert.equal(serializeMusicXml(back), xml)
})

test('editing a parsed copy leaves the recognised XML string untouched', () => {
  const recognised = serializeMusicXml(three())
  const copy = recognised.slice()
  const s = parseMusicXml(recognised)
  ed.deleteNote(s, 'a')
  assert.notEqual(serializeMusicXml(s), recognised)
  assert.equal(recognised, copy)
})

// --- tenuto, accent, fermata, hairpins, note <-> rest, insert (practice-app task 4.2) ---
// Every operation runs through an EditSession and is undone and redone, with the warnings computed
// after each step: an edit never repairs a bar, it changes what the bar check finds, and undo and redo
// bring the old findings back.

const barCheck = (s: Score): string[] => recheck(s).map((w) => `${w.kind}@${w.bar ?? '-'}`)

/** Applies `edit` in a session, then undoes and redoes it; returns the score before and after, and the bar check of each. */
function throughSession(start: Score, edit: (s: Score) => unknown) {
  const session = new EditSession(start)
  const beforeXml = serializeMusicXml(session.score)
  const before = structuredClone(session.score)
  const checkBefore = barCheck(session.score)
  session.apply(edit)
  const after = structuredClone(session.score)
  const afterXml = serializeMusicXml(session.score)
  const checkAfter = barCheck(session.score)
  assert.equal(session.canUndo, true)
  session.undo()
  assert.deepEqual(session.score, before, 'undo restores the score')
  assert.equal(serializeMusicXml(session.score), beforeXml)
  assert.deepEqual(barCheck(session.score), checkBefore, 'and the bar check as it was')
  session.redo()
  assert.deepEqual(session.score, after, 'redo applies it again')
  assert.equal(serializeMusicXml(session.score), afterXml)
  assert.deepEqual(barCheck(session.score), checkAfter)
  return { before, after, checkBefore, checkAfter }
}

/** Two 3/4 bars: C5 D5 E5 | F5 G5 A5, ids a b c | d e f. */
const six = (): Score =>
  score([
    [{ id: 'a', step: 'C', octave: 5 }, { id: 'b', step: 'D', octave: 5 }, { id: 'c', step: 'E', octave: 5 }],
    [{ id: 'd', step: 'F', octave: 5 }, { id: 'e', step: 'G', octave: 5 }, { id: 'f', step: 'A', octave: 5 }],
  ])
const wedges = (s: Score): [string, string, string][] =>
  s.measures.flatMap((m) => m.items.filter(isWedge).map((w): [string, string, string] => [w.type, w.start, w.stop]))
const failsWithoutUndoStep = (s: Score, edit: (s: Score) => unknown): void => {
  const session = new EditSession(s)
  const before = serializeMusicXml(session.score)
  assert.throws(() => session.apply(edit), ed.EditError)
  assert.equal(session.canUndo, false)
  assert.equal(serializeMusicXml(session.score), before)
}

test('edit: toggle tenuto, accent and fermata on a note, and tap the active mark to remove it', () => {
  for (const [toggle, mark] of [[ed.toggleTenuto, 'tenuto'], [ed.toggleAccent, 'accent'], [ed.toggleFermata, 'fermata']] as const) {
    const on = throughSession(six(), (s) => toggle(s, 'b'))
    assert.equal(byId(on.after, 'b')[mark], true, `${mark} on`)
    assert.equal(byId(on.before, 'b')[mark], undefined)
    assert.deepEqual([on.checkBefore, on.checkAfter], [[], []], 'the bars still add up')
    const s = on.after
    const off = throughSession(s, (sc) => toggle(sc, 'b'))
    assert.equal(byId(off.after, 'b')[mark], undefined, `${mark} off`)
    assert.equal(notes(on.after).filter((n) => n[mark]).length, 1, 'only the selected note')
  }
  // The marks are independent of each other and of staccato.
  const s = six()
  ed.toggleStaccato(s, 'a')
  ed.toggleTenuto(s, 'a')
  ed.toggleAccent(s, 'a')
  ed.toggleFermata(s, 'a')
  assert.deepEqual([byId(s, 'a').staccato, byId(s, 'a').tenuto, byId(s, 'a').accent, byId(s, 'a').fermata], [true, true, true, true])
})

test('edit: a rest takes a fermata but not a tenuto or an accent', () => {
  const s = score([[{ id: 'a' }, { id: 'r', rest: true }, { id: 'c' }]])
  failsWithoutUndoStep(s, (sc) => ed.toggleTenuto(sc, 'r'))
  failsWithoutUndoStep(s, (sc) => ed.toggleAccent(sc, 'r'))
  assert.equal(throughSession(s, (sc) => ed.toggleFermata(sc, 'r')).after.measures[0]!.items.filter(isNote).find((n) => n.id === 'r')!.fermata, true)
  failsWithoutUndoStep(s, (sc) => ed.toggleTenuto(sc, 'nope'))
})

test('edit: marks and hairpins survive saving and reloading', () => {
  const s = six()
  ed.toggleTenuto(s, 'a')
  ed.toggleAccent(s, 'b')
  ed.toggleFermata(s, 'f')
  ed.addWedge(s, 'crescendo', 'a', 'd')
  ed.addWedge(s, 'diminuendo', 'e', 'f')
  const xml = serializeMusicXml(s)
  const back = parseMusicXml(xml)
  assert.deepEqual(wedges(back), [['crescendo', 'a', 'd'], ['diminuendo', 'e', 'f']])
  assert.deepEqual(notes(back).map((n) => [n.tenuto, n.accent, n.fermata]), notes(s).map((n) => [n.tenuto, n.accent, n.fermata]))
  assert.equal(serializeMusicXml(back), xml)
  assert.deepEqual(back, s, 'the model an edit builds is the model the parser builds')
})

test('edit: add a crescendo or a diminuendo from one note to another, also over a barline, and remove it', () => {
  const bar = throughSession(six(), (s) => ed.addWedge(s, 'crescendo', 'a', 'c'))
  assert.deepEqual(wedges(bar.after), [['crescendo', 'a', 'c']])
  assert.deepEqual(wedges(bar.before), [])
  assert.deepEqual([bar.checkBefore, bar.checkAfter], [[], []])
  assert.deepEqual(bar.after.measures[0]!.items.map((i) => (isWedge(i) ? 'wedge' : i.kind === 'note' ? i.id : i.kind)), ['wedge', 'a', 'b', 'c'], 'kept right before its first note')

  const across = throughSession(six(), (s) => ed.addWedge(s, 'diminuendo', 'c', 'e'))
  assert.deepEqual(wedges(across.after), [['diminuendo', 'c', 'e']])
  assert.deepEqual(across.after.measures[1]!.items.some(isWedge), false, 'kept in the measure of its first note')

  // Remove: from any note under the hairpin, not only its ends.
  for (const under of ['c', 'd', 'e']) {
    const removed = throughSession(across.after, (s) => ed.removeWedge(s, under))
    assert.deepEqual(wedges(removed.after), [], `removed from ${under}`)
    assert.deepEqual(wedges(removed.before), [['diminuendo', 'c', 'e']])
  }
  failsWithoutUndoStep(across.after, (s) => ed.removeWedge(s, 'a')) // no hairpin there
  failsWithoutUndoStep(across.after, (s) => ed.removeWedge(s, 'f'))

  // wedgeAt tells which hairpin a note is under, for showing the mark as active.
  assert.deepEqual([ 'a', 'b', 'c', 'd', 'e', 'f'].map((id) => ed.wedgeAt(across.after, id)?.type), [undefined, undefined, 'diminuendo', 'diminuendo', 'diminuendo', undefined])
})

test('edit: a hairpin over one note, and its limits', () => {
  assert.deepEqual(wedges(throughSession(six(), (s) => ed.addWedge(s, 'crescendo', 'b', 'b')).after), [['crescendo', 'b', 'b']])
  const s = six()
  ed.addWedge(s, 'crescendo', 'b', 'd')
  failsWithoutUndoStep(s, (sc) => ed.addWedge(sc, 'diminuendo', 'e', 'd')) // reversed
  failsWithoutUndoStep(s, (sc) => ed.addWedge(sc, 'diminuendo', 'd', 'e')) // overlaps at d
  failsWithoutUndoStep(s, (sc) => ed.addWedge(sc, 'diminuendo', 'a', 'b')) // overlaps at b
  failsWithoutUndoStep(s, (sc) => ed.addWedge(sc, 'diminuendo', 'a', 'f')) // swallows the first
  failsWithoutUndoStep(s, (sc) => ed.addWedge(sc, 'diminuendo', 'e', 'nope'))
  assert.deepEqual(wedges(throughSession(s, (sc) => ed.addWedge(sc, 'diminuendo', 'e', 'f')).after), [['crescendo', 'b', 'd'], ['diminuendo', 'e', 'f']])
  // Grace notes, chord notes and rests only do not carry one.
  const odd = score([[{ id: 'a' }, { id: 'g' }, { id: 'h' }, { id: 'r', rest: true }]])
  byId(odd, 'g').grace = true
  byId(odd, 'h').chord = true
  failsWithoutUndoStep(odd, (sc) => ed.addWedge(sc, 'crescendo', 'a', 'g'))
  failsWithoutUndoStep(odd, (sc) => ed.addWedge(sc, 'crescendo', 'h', 'r'))
  const rests = score([[{ id: 'a', rest: true }, { id: 'b', rest: true }, { id: 'c', rest: true }]])
  failsWithoutUndoStep(rests, (sc) => ed.addWedge(sc, 'crescendo', 'a', 'c'))
})

test('edit: deleting a note takes a hairpin that ends on it away, and keeps one that only passes it', () => {
  const s = six()
  ed.addWedge(s, 'crescendo', 'b', 'e')
  assert.deepEqual(wedges(throughSession(s, (sc) => ed.deleteNote(sc, 'c')).after), [['crescendo', 'b', 'e']])
  assert.deepEqual(wedges(throughSession(s, (sc) => ed.deleteNote(sc, 'b')).after), [])
  assert.deepEqual(wedges(throughSession(s, (sc) => ed.deleteNote(sc, 'e')).after), [])
  const afterStartDeleted = throughSession(s, (sc) => ed.deleteNote(sc, 'b')).after
  assert.equal(afterStartDeleted.measures.flatMap((m) => m.items).some(isWedge), false, 'no item is left behind')
  assert.deepEqual(wedges(throughSession(six(), (sc) => ed.deleteNote(sc, 'a')).after), [])
})

test('edit: a note becomes a rest of the same length; the id and the bar stay, pitch and marks go', () => {
  const s = score([[{ id: 'a', step: 'F' }, { id: 'b', step: 'F' }, { id: 'c', step: 'G' }], [{ id: 'd', step: 'G' }, { id: 'e' }, { id: 'f' }]])
  ed.setAccidental(s, 'a', 'sharp')
  ed.toggleStaccato(s, 'b')
  ed.toggleTenuto(s, 'b')
  ed.toggleAccent(s, 'b')
  ed.toggleFermata(s, 'b')
  ed.toggleSlur(s, 'b') // b-c
  ed.toggleTie(s, 'c') // c-d (both G4)
  assert.equal(name(byId(s, 'b')), 'F#4', 'b inherits the sharp printed on a')
  const r = throughSession(s, (sc) => ed.noteToRest(sc, 'b'))
  const b = byId(r.after, 'b')
  assert.deepEqual([b.rest, b.pitch, b.accidental, b.staccato, b.tenuto, b.accent, b.breath], [true, undefined, undefined, undefined, undefined, undefined, undefined])
  assert.equal(b.fermata, true, 'a rest can keep its fermata')
  assert.deepEqual([b.slurs.length, byId(r.after, 'c').slurs.length], [0, 0], 'the slur is gone at both ends')
  assert.deepEqual([b.duration, b.type], [byId(r.before, 'b').duration, 'quarter'])
  assert.deepEqual(notes(r.after).map((n) => n.id), ['a', 'b', 'c', 'd', 'e', 'f'])
  assert.deepEqual([r.checkBefore, r.checkAfter], [[], []], 'the bar still adds up')
  // Tie partners are released: c is no longer tied, d no longer ends a tie.
  const t = throughSession(s, (sc) => ed.noteToRest(sc, 'c'))
  assert.deepEqual([byId(t.after, 'c').tieStart, byId(t.after, 'd').tieStop], [undefined, undefined])
  // A later note in the bar loses what it took from the rest's printed accidental.
  const sharp = score([[{ id: 'a', step: 'F' }, { id: 'b', step: 'F' }, { id: 'c', step: 'G' }]])
  ed.setAccidental(sharp, 'a', 'sharp')
  assert.equal(name(byId(sharp, 'b')), 'F#4')
  assert.equal(name(byId(throughSession(sharp, (sc) => ed.noteToRest(sc, 'a')).after, 'b')), 'F4')
  // It cannot be done twice, or to a grace note or a chord member.
  failsWithoutUndoStep(r.after, (sc) => ed.noteToRest(sc, 'b'))
  const odd = score([[{ id: 'a' }, { id: 'g' }, { id: 'h' }, { id: 'z' }]])
  byId(odd, 'g').grace = true
  byId(odd, 'h').chord = true
  failsWithoutUndoStep(odd, (sc) => ed.noteToRest(sc, 'g'))
  failsWithoutUndoStep(odd, (sc) => ed.noteToRest(sc, 'h'))
})

test('edit: a hairpin that ends on a note keeps ending there when the note becomes a rest', () => {
  const s = six()
  ed.addWedge(s, 'crescendo', 'a', 'c')
  assert.deepEqual(wedges(throughSession(s, (sc) => ed.noteToRest(sc, 'c')).after), [['crescendo', 'a', 'c']])
})

test('edit: a rest becomes a note on the pitch of the nearest note, with its id, length and fermata', () => {
  const s = score([[{ id: 'a', step: 'D', octave: 5 }, { id: 'r', rest: true }, { id: 'c', step: 'A', octave: 4 }]])
  ed.toggleFermata(s, 'r')
  const r = throughSession(s, (sc) => ed.restToNote(sc, 'r'))
  const n = byId(r.after, 'r')
  assert.deepEqual([n.rest, name(n), n.type, n.fermata, n.accidental], [undefined, 'A4', 'quarter', true, undefined], 'the following note wins when both neighbours are as near')
  assert.deepEqual(n.duration, byId(r.before, 'r').duration)
  assert.deepEqual([r.checkBefore, r.checkAfter], [[], []])
  // With no note at all it is a B4.
  const lonely = score([[{ id: 'r', rest: true }, { id: 'q', rest: true }, { id: 'p', rest: true }]])
  assert.equal(name(byId(throughSession(lonely, (sc) => ed.restToNote(sc, 'q')).after, 'q')), 'B4')
  failsWithoutUndoStep(s, (sc) => ed.restToNote(sc, 'a')) // already a note
  // It takes the key's sharps: F in G major.
  const g = score([[{ id: 'r', rest: true }, { id: 'f', step: 'F', octave: 5 }, { id: 'x', step: 'F', octave: 5 }]], { fifths: 1 })
  assert.equal(name(byId(throughSession(g, (sc) => ed.restToNote(sc, 'r')).after, 'r')), 'F#5')
})

test('edit: a whole-measure rest becomes one note of the bar\'s length', () => {
  const s = score([[{ id: 'a', rest: true }]], { beats: 3 })
  const bar = byId(s, 'a')
  Object.assign(bar, { measureRest: true, dots: 0, duration: frac(3, 4) })
  delete bar.type
  const r = throughSession(s, (sc) => ed.restToNote(sc, 'a'))
  const n = byId(r.after, 'a')
  assert.deepEqual([n.rest, n.measureRest, n.type, n.dots], [undefined, undefined, 'half', 1], 'a dotted half fills a 3/4 bar')
  assert.deepEqual([r.checkBefore, r.checkAfter], [[], []])
  assert.deepEqual(parseMusicXml(serializeMusicXml(r.after)), r.after)
  // A length no single note has is refused.
  const five = score([[{ id: 'a', rest: true }]], { beats: 5 })
  Object.assign(byId(five, 'a'), { measureRest: true, dots: 0, duration: frac(5, 4) })
  delete byId(five, 'a').type
  failsWithoutUndoStep(five, (sc) => ed.restToNote(sc, 'a'))
})

test('edit: insert a note or a rest before or after a note; the bar check then flags the bar, and undo clears it', () => {
  for (const where of ['before', 'after'] as const) {
    for (const what of ['note', 'rest'] as const) {
      let inserted = ''
      const r = throughSession(six(), (s) => (inserted = ed.insertNote(s, 'b', where, what)))
      const order = notes(r.after).map((n) => n.id)
      assert.deepEqual(order, where === 'before' ? ['a', inserted, 'b', 'c', 'd', 'e', 'f'] : ['a', 'b', inserted, 'c', 'd', 'e', 'f'])
      const fresh = byId(r.after, inserted)
      assert.equal(fresh.rest === true, what === 'rest')
      assert.deepEqual(fresh.duration, byId(r.after, 'b').duration, 'the length of the note it was inserted next to')
      assert.deepEqual([r.checkBefore, r.checkAfter], [[], ['bar-length@1']], 'the 3/4 bar now has four beats')
    }
  }
  // Next to a hairpin's ends, the new note is outside it.
  const s = six()
  ed.addWedge(s, 'crescendo', 'b', 'c')
  const before = throughSession(s, (sc) => ed.insertNote(sc, 'b', 'before', 'note')).after
  assert.deepEqual(wedges(before), [['crescendo', 'b', 'c']])
  assert.deepEqual(before.measures[0]!.items.map((i) => (isWedge(i) ? 'wedge' : i.kind === 'note' ? i.id : i.kind)).filter((x) => x !== 'a'), [before.measures[0]!.items.filter(isNote)[1]!.id, 'wedge', 'b', 'c'], 'the hairpin item stays right before its first note')
  assert.deepEqual(parseMusicXml(serializeMusicXml(before)), before, 'and the reloaded model equals the edited one')
  const after = throughSession(s, (sc) => ed.insertNote(sc, 'c', 'after', 'note')).after
  assert.deepEqual(wedges(after), [['crescendo', 'b', 'c']])
  assert.deepEqual(parseMusicXml(serializeMusicXml(after)), after)
  assert.equal(ed.wedgeAt(before, notes(before)[1]!.id), undefined, 'the inserted note, second in the bar, is outside it')
})

test('edit: every new operation, one after another, undoes step by step to the start', () => {
  const session = new EditSession(six())
  const start = serializeMusicXml(session.score)
  const steps: ((s: Score) => unknown)[] = [
    (s) => ed.toggleTenuto(s, 'a'),
    (s) => ed.toggleAccent(s, 'b'),
    (s) => ed.toggleFermata(s, 'c'),
    (s) => ed.addWedge(s, 'crescendo', 'a', 'c'),
    (s) => ed.noteToRest(s, 'f'),
    (s) => ed.restToNote(s, 'f'),
    (s) => ed.insertNote(s, 'e', 'after', 'rest'),
    (s) => ed.removeWedge(s, 'b'),
  ]
  const stages = [start]
  for (const step of steps) {
    session.apply(step)
    stages.push(serializeMusicXml(session.score))
  }
  assert.equal(new Set(stages).size, stages.length, 'every step changed the score')
  for (let i = steps.length - 1; i >= 0; i--) {
    assert.equal(session.undo(), true)
    assert.equal(serializeMusicXml(session.score), stages[i])
  }
  for (let i = 0; i < steps.length; i++) {
    assert.equal(session.redo(), true)
    assert.equal(serializeMusicXml(session.score), stages[i + 1])
  }
})

// ---- a slur and a tie chosen by their first and last note (spec "Articulation marks") ------------

const slurs = (s: Score): [string, string, number][] =>
  notes(s).flatMap((n) => n.slurs.map((m): [string, string, number] => [n.id, m.type, m.number]))

test('edit: a slur is added from the first to the last note of a phrase, over bars too, and survives saving', () => {
  const across = throughSession(six(), (s) => ed.addSlur(s, 'b', 'e'))
  assert.deepEqual(slurs(across.after), [['b', 'start', 1], ['e', 'stop', 1]])
  assert.deepEqual(slurs(across.before), [])
  assert.deepEqual(slurs(parseMusicXml(serializeMusicXml(across.after))), [['b', 'start', 1], ['e', 'stop', 1]])
  // Tapping the active mark removes the whole slur from either end.
  assert.deepEqual(slurs(throughSession(across.after, (s) => ed.toggleSlur(s, 'e')).after), [])
  assert.deepEqual(slurs(throughSession(across.after, (s) => ed.toggleSlur(s, 'b')).after), [])
})

test('edit: a slur that sits inside or next to another one gets its own number', () => {
  const s = six()
  ed.addSlur(s, 'a', 'f')
  ed.addSlur(s, 'b', 'c') // inside the first
  ed.addSlur(s, 'c', 'e') // overlaps the second at c and sits inside the first
  assert.deepEqual(slurs(s), [['a', 'start', 1], ['b', 'start', 2], ['c', 'stop', 2], ['c', 'start', 3], ['e', 'stop', 3], ['f', 'stop', 1]])
  // Two slurs one after the other may share a number.
  const t = six()
  ed.addSlur(t, 'a', 'c')
  ed.addSlur(t, 'd', 'f')
  assert.deepEqual(slurs(t).map(([, , n]) => n), [1, 1, 1, 1])
})

test('edit: a slur needs two different notes, the first before the last, and no rest at either end', () => {
  const s = score([[{ id: 'a' }, { id: 'r', rest: true }, { id: 'c', step: 'A' }]])
  failsWithoutUndoStep(s, (sc) => ed.addSlur(sc, 'a', 'a'))
  failsWithoutUndoStep(s, (sc) => ed.addSlur(sc, 'c', 'a'))
  failsWithoutUndoStep(s, (sc) => ed.addSlur(sc, 'a', 'r'))
  failsWithoutUndoStep(s, (sc) => ed.addSlur(sc, 'r', 'c'))
  failsWithoutUndoStep(s, (sc) => ed.addSlur(sc, 'a', 'nope'))
  assert.deepEqual(slurs(throughSession(s, (sc) => ed.addSlur(sc, 'a', 'c')).after), [['a', 'start', 1], ['c', 'stop', 1]], 'a rest in the middle is fine')
})

test('edit: a tie is added between a note and the next note of the same pitch only', () => {
  const s = score([[{ id: 'a' }, { id: 'b' }, { id: 'c', step: 'A' }]])
  const tied = throughSession(s, (sc) => ed.addTie(sc, 'a', 'b'))
  assert.deepEqual([byId(tied.after, 'a').tieStart, byId(tied.after, 'b').tieStop], [true, true])
  assert.equal(byId(tied.before, 'a').tieStart, undefined)
  failsWithoutUndoStep(s, (sc) => ed.addTie(sc, 'b', 'c')) // another pitch
  failsWithoutUndoStep(s, (sc) => ed.addTie(sc, 'a', 'c')) // not the next note
  failsWithoutUndoStep(s, (sc) => ed.addTie(sc, 'b', 'a')) // backwards
  failsWithoutUndoStep(tied.after, (sc) => ed.addTie(sc, 'a', 'b')) // already tied
  assert.equal(byId(throughSession(tied.after, (sc) => ed.toggleTie(sc, 'a')).after, 'b').tieStop, undefined, 'the active mark removes it')
})
