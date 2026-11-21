import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as ed from '../src/core/score/edit.ts'
import { parseMusicXml, serializeMusicXml } from '../src/core/score/musicxml.ts'
import { firstVoice, isNote, isWedge, noteIndex, notesOf, partMultiRestRuns, sameVoice, voiceView, voices } from '../src/core/score/model.ts'
import type { Note, Score, VoiceRef, VoiceScore } from '../src/core/score/model.ts'
import { prepareRecognisedScore } from '../src/core/score/prepare.ts'
import { EditSession } from '../src/core/score/editSession.ts'
import { computeScoreWarnings, computeWarnings } from '../src/core/score/warnings.ts'
import { TENOR_SAX } from '../src/core/instruments/instruments.ts'
import { frac } from '../src/core/score/rational.ts'
import { startingTempo, tempoSetup } from '../src/core/playback/tempo.ts'
import { barOf, scoreOf } from './playbackHelpers.ts'
import { describeElement } from '../src/core/score/elements.ts'
import type { ElementRef } from '../src/core/score/elements.ts'
import { buildTimeline } from '../src/core/playback/timeline.ts'
import { renderScore } from '../src/core/score/render.ts'
import { COMMITTED_FIXTURE, HOMR_MARKS_FIXTURE, MELODY_PIANO_FIXTURE, read } from './helpers.ts'
import { firstLine, setAttr } from './helpers.ts'

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
const recheck = (s: Score) => computeWarnings(firstLine(s), TENOR_SAX)
const notes = (s: Score): Note[] => firstLine(s).measures.flatMap((m) => m.items.filter(isNote))
const byId = (s: Score, id: string): Note => notes(s).find((n) => n.id === id)!
const name = (n: Note): string => `${n.pitch!.step}${n.pitch!.alter === 1 ? '#' : n.pitch!.alter === -1 ? 'b' : ''}${n.pitch!.octave}`
const three = (): Score => score([[{ id: 'a', step: 'C', octave: 5 }, { id: 'b', step: 'F', octave: 4 }, { id: 'c', step: 'G' }], [{ id: 'd', step: 'F', octave: 4 }, { id: 'e', step: 'F', octave: 5 }, { id: 'f', rest: true }]])

test('C5 stepped down is B4; stepping up wraps to the next octave', () => {
  const s = three()
  ed.stepPitch(firstLine(s), 'a', -1)
  assert.equal(name(byId(s, 'a')), 'B4')
  ed.stepPitch(firstLine(s), 'a', 1)
  ed.stepPitch(firstLine(s), 'a', 1)
  assert.equal(name(byId(s, 'a')), 'D5')
  assert.throws(() => ed.stepPitch(firstLine(s), 'f', 1), ed.EditError)
})

test('accidentals: sharp, flat, natural, none', () => {
  const s = three()
  ed.setAccidental(firstLine(s), 'c', 'sharp')
  assert.equal(name(byId(s, 'c')), 'G#4')
  assert.equal(byId(s, 'c').accidental, 'sharp')
  ed.setAccidental(firstLine(s), 'c', 'flat')
  assert.equal(name(byId(s, 'c')), 'Gb4')
  ed.setAccidental(firstLine(s), 'c', 'natural')
  assert.equal(name(byId(s, 'c')), 'G4')
  ed.setAccidental(firstLine(s), 'c', 'none')
  assert.equal(byId(s, 'c').accidental, undefined)
})

test('an accidental carries through the bar for the same step and octave only', () => {
  const s = score([[{ id: 'a', step: 'F' }, { id: 'b', step: 'F' }, { id: 'c', step: 'F', octave: 5 }], [{ id: 'd', step: 'F' }]])
  ed.setAccidental(firstLine(s), 'a', 'sharp')
  assert.equal(name(byId(s, 'b')), 'F#4')
  assert.equal(name(byId(s, 'c')), 'F5')
  assert.equal(name(byId(s, 'd')), 'F4')
})

test('duration: whole to 16th, dotted, triplet', () => {
  const s = three()
  ed.setDuration(firstLine(s), 'a', { type: 'half', dots: 0, triplet: false })
  assert.equal(byId(s, 'a').duration.n / byId(s, 'a').duration.d, 0.5)
  ed.setDuration(firstLine(s), 'a', { type: 'quarter', dots: 1, triplet: false })
  assert.equal(byId(s, 'a').duration.n / byId(s, 'a').duration.d, 3 / 8)
  ed.setDuration(firstLine(s), 'a', { type: '16th', dots: 0, triplet: false })
  assert.deepEqual([byId(s, 'a').duration.n, byId(s, 'a').duration.d], [1, 16])
  for (const id of ['a', 'b', 'c']) ed.setDuration(firstLine(s), id, { type: 'eighth', dots: 0, triplet: true })
  assert.deepEqual([byId(s, 'a').duration.n, byId(s, 'a').duration.d], [1, 12])
  assert.deepEqual(byId(s, 'a').tuplets, [{ type: 'start', number: 1 }])
  assert.deepEqual(byId(s, 'c').tuplets, [{ type: 'stop', number: 1 }])
  ed.setDuration(firstLine(s), 'b', { type: 'quarter', dots: 0, triplet: false })
  assert.equal(byId(s, 'a').tuplets.length, 0)
})

test('toggles: staccato, slur, tie', () => {
  const s = score([[{ id: 'a' }, { id: 'b' }, { id: 'c', step: 'A' }]])
  ed.toggleStaccato(firstLine(s), 'a')
  assert.equal(byId(s, 'a').staccato, true)
  ed.toggleStaccato(firstLine(s), 'a')
  assert.equal(byId(s, 'a').staccato, undefined)
  ed.toggleSlur(firstLine(s), 'a')
  assert.equal(byId(s, 'a').slurs[0]?.type, 'start')
  assert.equal(byId(s, 'b').slurs[0]?.type, 'stop')
  ed.toggleSlur(firstLine(s), 'b')
  assert.equal(byId(s, 'a').slurs.length + byId(s, 'b').slurs.length, 0)
  ed.toggleTie(firstLine(s), 'a')
  assert.equal(byId(s, 'a').tieStart, true)
  assert.equal(byId(s, 'b').tieStop, true)
  ed.toggleTie(firstLine(s), 'a')
  assert.equal(byId(s, 'b').tieStop, undefined)
  assert.throws(() => ed.toggleTie(firstLine(s), 'b'), ed.EditError) // next note is another pitch
})

test('delete removes the note and its slur partner; insert makes fresh unique ids', () => {
  const s = score([[{ id: 'a' }, { id: 'b' }, { id: 'c' }]])
  ed.toggleSlur(firstLine(s), 'a')
  const next = ed.deleteNote(firstLine(s), 'a')
  assert.equal(next, 'b')
  assert.deepEqual(notes(s).map((n) => n.id), ['b', 'c'])
  assert.equal(byId(s, 'b').slurs.length, 0)
  const before = ed.insertNote(firstLine(s), 'b', 'before', 'note')
  const after = ed.insertNote(firstLine(s), 'b', 'after', 'rest')
  assert.equal(new Set([before, after, 'b', 'c']).size, 4)
  assert.deepEqual(notes(s).map((n) => n.id), [before, 'b', after, 'c'])
  assert.equal(byId(s, after).rest, true)
  assert.equal(name(byId(s, before)), 'G4')
})

test('key change to one sharp makes un-marked F sound F#; a printed natural stays F', () => {
  const s = score(
    [[{ id: 'a', step: 'F' }, { id: 'b', step: 'F', acc: 'natural' }, { id: 'c', step: 'F' }], [{ id: 'd', step: 'F', octave: 5 }, { id: 'e', step: 'G' }, { id: 'f', step: 'F', octave: 5 }]],
  )
  ed.setKey(s, firstVoice(s).part, 1)
  assert.deepEqual(['a', 'b', 'c', 'd', 'e', 'f'].map((id) => name(byId(s, id))), ['F#4', 'F4', 'F4', 'F#5', 'G4', 'F#5']) // c inherits b's natural in the bar
  ed.setKey(s, firstVoice(s).part, 0)
  assert.equal(name(byId(s, 'a')), 'F4')
  ed.setKey(s, firstVoice(s).part, -1)
  const flat = score([[{ id: 'a', step: 'B' }, { id: 'b', step: 'B', acc: 'natural' }]])
  ed.setKey(flat, firstVoice(flat).part, -1)
  assert.deepEqual([name(byId(flat, 'a')), name(byId(flat, 'b'))], ['Bb4', 'B4'])
  assert.throws(() => ed.setKey(s, firstVoice(s).part, 8), ed.EditError)
})

test('key change survives serialisation and parsing', () => {
  const s = score([[{ id: 'a', step: 'F' }, { id: 'b', step: 'F', acc: 'natural' }, { id: 'c' }]])
  ed.setKey(s, firstVoice(s).part, 1)
  const back = parseMusicXml(serializeMusicXml(s))
  assert.equal(firstLine(back).measures[0]!.key?.fifths, 1)
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
  assert.equal(tempoSetup(firstLine(s)).defaultBpm, 80)
  ed.setTempoMarking(firstLine(s), { words: 'Moderato' })
  const back = parseMusicXml(serializeMusicXml(s))
  assert.equal(ed.firstTempoMarking(firstLine(back))?.words, 'Moderato')
  assert.equal(startingTempo(null, tempoSetup(firstLine(back))), 108)
  assert.equal(startingTempo(70, tempoSetup(firstLine(back))), 70) // a chosen tempo still wins
  ed.setTempoMarking(firstLine(back), { words: 'Allegro', perMinute: 120 })
  assert.equal(tempoSetup(firstLine(back)).defaultBpm, 120)
  ed.setTempoMarking(firstLine(back), {})
  assert.equal(ed.firstTempoMarking(firstLine(back)), undefined)
})

test('lengthening a quarter to a half in a full 3/4 bar flags the bar and editing continues', () => {
  const s = score([[{ id: 'a' }, { id: 'b' }, { id: 'c' }], [{ id: 'd' }, { id: 'e' }, { id: 'f' }]])
  ed.setDuration(firstLine(s), 'b', { type: 'half', dots: 0, triplet: false })
  const flags = recheck(s)
  assert.deepEqual(flags.map((f) => [f.kind, f.bar]), [['bar-length', '1']])
  ed.stepPitch(firstLine(s), 'e', 1) // not blocked
  assert.equal(name(byId(s, 'e')), 'A4')
  ed.setDuration(firstLine(s), 'b', { type: 'quarter', dots: 0, triplet: false })
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
  for (let i = 0; i < 6; i++) ed.stepPitch(firstLine(s), 'a', 1) // C5 to B5... then beyond
  for (let i = 0; i < 6; i++) ed.stepPitch(firstLine(s), 'a', 1)
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
  ed.stepPitch(firstLine(s), 'a', -1)
  ed.setDuration(firstLine(s), 'c', { type: 'eighth', dots: 1, triplet: false })
  ed.toggleStaccato(firstLine(s), 'd')
  const inserted = ed.insertNote(firstLine(s), 'e', 'after', 'note')
  const xml = serializeMusicXml(s)
  const back = parseMusicXml(xml)
  assert.deepEqual(notes(back).map((n) => n.id), ['a', 'b', 'c', 'd', 'e', inserted, 'f'])
  assert.equal(serializeMusicXml(back), xml)
})

test('editing a parsed copy leaves the recognised XML string untouched', () => {
  const recognised = serializeMusicXml(three())
  const copy = recognised.slice()
  const s = parseMusicXml(recognised)
  ed.deleteNote(firstLine(s), 'a')
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
  firstLine(s).measures.flatMap((m) => m.items.filter(isWedge).map((w): [string, string, string] => [w.type, w.start, w.stop]))
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
  ed.toggleStaccato(firstLine(s), 'a')
  ed.toggleTenuto(firstLine(s), 'a')
  ed.toggleAccent(firstLine(s), 'a')
  ed.toggleFermata(firstLine(s), 'a')
  assert.deepEqual([byId(s, 'a').staccato, byId(s, 'a').tenuto, byId(s, 'a').accent, byId(s, 'a').fermata], [true, true, true, true])
})

test('edit: a rest takes a fermata but not a tenuto or an accent', () => {
  const s = score([[{ id: 'a' }, { id: 'r', rest: true }, { id: 'c' }]])
  failsWithoutUndoStep(s, (sc) => ed.toggleTenuto(sc, 'r'))
  failsWithoutUndoStep(s, (sc) => ed.toggleAccent(sc, 'r'))
  assert.equal(firstLine(throughSession(s, (sc) => ed.toggleFermata(sc, 'r')).after).measures[0]!.items.filter(isNote).find((n) => n.id === 'r')!.fermata, true)
  failsWithoutUndoStep(s, (sc) => ed.toggleTenuto(sc, 'nope'))
})

test('edit: marks and hairpins survive saving and reloading', () => {
  const s = six()
  ed.toggleTenuto(firstLine(s), 'a')
  ed.toggleAccent(firstLine(s), 'b')
  ed.toggleFermata(firstLine(s), 'f')
  ed.addWedge(firstLine(s), 'crescendo', 'a', 'd')
  ed.addWedge(firstLine(s), 'diminuendo', 'e', 'f')
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
  assert.deepEqual(firstLine(bar.after).measures[0]!.items.map((i) => (isWedge(i) ? 'wedge' : i.kind === 'note' ? i.id : i.kind)), ['wedge', 'a', 'b', 'c'], 'kept right before its first note')

  const across = throughSession(six(), (s) => ed.addWedge(s, 'diminuendo', 'c', 'e'))
  assert.deepEqual(wedges(across.after), [['diminuendo', 'c', 'e']])
  assert.deepEqual(firstLine(across.after).measures[1]!.items.some(isWedge), false, 'kept in the measure of its first note')

  // Remove: from any note under the hairpin, not only its ends.
  for (const under of ['c', 'd', 'e']) {
    const removed = throughSession(across.after, (s) => ed.removeWedge(s, under))
    assert.deepEqual(wedges(removed.after), [], `removed from ${under}`)
    assert.deepEqual(wedges(removed.before), [['diminuendo', 'c', 'e']])
  }
  failsWithoutUndoStep(across.after, (s) => ed.removeWedge(s, 'a')) // no hairpin there
  failsWithoutUndoStep(across.after, (s) => ed.removeWedge(s, 'f'))

  // wedgeAt tells which hairpin a note is under, for showing the mark as active.
  assert.deepEqual([ 'a', 'b', 'c', 'd', 'e', 'f'].map((id) => ed.wedgeAt(firstLine(across.after), id)?.type), [undefined, undefined, 'diminuendo', 'diminuendo', 'diminuendo', undefined])
})

test('edit: a hairpin over one note, and its limits', () => {
  assert.deepEqual(wedges(throughSession(six(), (s) => ed.addWedge(s, 'crescendo', 'b', 'b')).after), [['crescendo', 'b', 'b']])
  const s = six()
  ed.addWedge(firstLine(s), 'crescendo', 'b', 'd')
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
  ed.addWedge(firstLine(s), 'crescendo', 'b', 'e')
  assert.deepEqual(wedges(throughSession(s, (sc) => ed.deleteNote(sc, 'c')).after), [['crescendo', 'b', 'e']])
  assert.deepEqual(wedges(throughSession(s, (sc) => ed.deleteNote(sc, 'b')).after), [])
  assert.deepEqual(wedges(throughSession(s, (sc) => ed.deleteNote(sc, 'e')).after), [])
  const afterStartDeleted = throughSession(s, (sc) => ed.deleteNote(sc, 'b')).after
  assert.equal(firstLine(afterStartDeleted).measures.flatMap((m) => m.items).some(isWedge), false, 'no item is left behind')
  assert.deepEqual(wedges(throughSession(six(), (sc) => ed.deleteNote(sc, 'a')).after), [])
})

test('edit: a note becomes a rest of the same length; the id and the bar stay, pitch and marks go', () => {
  const s = score([[{ id: 'a', step: 'F' }, { id: 'b', step: 'F' }, { id: 'c', step: 'G' }], [{ id: 'd', step: 'G' }, { id: 'e' }, { id: 'f' }]])
  ed.setAccidental(firstLine(s), 'a', 'sharp')
  ed.toggleStaccato(firstLine(s), 'b')
  ed.toggleTenuto(firstLine(s), 'b')
  ed.toggleAccent(firstLine(s), 'b')
  ed.toggleFermata(firstLine(s), 'b')
  ed.toggleSlur(firstLine(s), 'b') // b-c
  ed.toggleTie(firstLine(s), 'c') // c-d (both G4)
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
  ed.setAccidental(firstLine(sharp), 'a', 'sharp')
  assert.equal(name(byId(sharp, 'b')), 'F#4')
  assert.equal(name(byId(throughSession(sharp, (sc) => ed.noteToRest(sc, 'a')).after, 'b')), 'F4')
  // It cannot be done twice, or to a grace note (a chord's note turns the whole chord into a rest: change edit-parts).
  failsWithoutUndoStep(r.after, (sc) => ed.noteToRest(sc, 'b'))
  const odd = score([[{ id: 'a' }, { id: 'g' }, { id: 'h' }, { id: 'z' }]])
  byId(odd, 'g').grace = true
  byId(odd, 'h').chord = true
  failsWithoutUndoStep(odd, (sc) => ed.noteToRest(sc, 'g'))
  failsWithoutUndoStep(odd, (sc) => ed.noteToRest(sc, 'h'))
})

test('edit: a hairpin that ends on a note keeps ending there when the note becomes a rest', () => {
  const s = six()
  ed.addWedge(firstLine(s), 'crescendo', 'a', 'c')
  assert.deepEqual(wedges(throughSession(s, (sc) => ed.noteToRest(sc, 'c')).after), [['crescendo', 'a', 'c']])
})

test('edit: a rest becomes a note on the pitch of the nearest note, with its id, length and fermata', () => {
  const s = score([[{ id: 'a', step: 'D', octave: 5 }, { id: 'r', rest: true }, { id: 'c', step: 'A', octave: 4 }]])
  ed.toggleFermata(firstLine(s), 'r')
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
  ed.addWedge(firstLine(s), 'crescendo', 'b', 'c')
  const before = throughSession(s, (sc) => ed.insertNote(sc, 'b', 'before', 'note')).after
  assert.deepEqual(wedges(before), [['crescendo', 'b', 'c']])
  assert.deepEqual(firstLine(before).measures[0]!.items.map((i) => (isWedge(i) ? 'wedge' : i.kind === 'note' ? i.id : i.kind)).filter((x) => x !== 'a'), [firstLine(before).measures[0]!.items.filter(isNote)[1]!.id, 'wedge', 'b', 'c'], 'the hairpin item stays right before its first note')
  assert.deepEqual(parseMusicXml(serializeMusicXml(before)), before, 'and the reloaded model equals the edited one')
  const after = throughSession(s, (sc) => ed.insertNote(sc, 'c', 'after', 'note')).after
  assert.deepEqual(wedges(after), [['crescendo', 'b', 'c']])
  assert.deepEqual(parseMusicXml(serializeMusicXml(after)), after)
  assert.equal(ed.wedgeAt(firstLine(before), notes(before)[1]!.id), undefined, 'the inserted note, second in the bar, is outside it')
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
  ed.addSlur(firstLine(s), 'a', 'f')
  ed.addSlur(firstLine(s), 'b', 'c') // inside the first
  ed.addSlur(firstLine(s), 'c', 'e') // overlaps the second at c and sits inside the first
  assert.deepEqual(slurs(s), [['a', 'start', 1], ['b', 'start', 2], ['c', 'stop', 2], ['c', 'start', 3], ['e', 'stop', 3], ['f', 'stop', 1]])
  // Two slurs one after the other may share a number.
  const t = six()
  ed.addSlur(firstLine(t), 'a', 'c')
  ed.addSlur(firstLine(t), 'd', 'f')
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

// --- bar lines (change edit-bar-lines, tasks 1.1 and 1.2) ---

const roundTrip = (s: Score): Score => parseMusicXml(serializeMusicXml(s))
const linesOf = (s: Score, i: number): string => {
  const b = ed.barLinesOf(s, i)
  return `${b.start}/${b.end}/${b.times}`
}

test('bar lines: read a double bar line on either side of the boundary, a final bar line, a start-repeat and a repeat count', () => {
  const s = scoreOf([
    barOf('C', { right: '<bar-style>light-light</bar-style>' }),
    barOf('D'),
    barOf('E', { left: '<bar-style>light-light</bar-style>' }),
    barOf('F', { left: '<bar-style>heavy-light</bar-style><repeat direction="forward"/>', right: '<bar-style>light-heavy</bar-style><repeat direction="backward" times="3"/>' }),
    barOf('G', { right: '<bar-style>light-heavy</bar-style>' }),
  ])
  assert.deepEqual([0, 1, 2, 3, 4].map((i) => linesOf(s, i)), ['normal/double/2', 'normal/double/2', 'normal/normal/2', 'repeat/repeat/3', 'normal/double/2'])
  assert.throws(() => ed.barLinesOf(s, 5), ed.EditError)
  assert.throws(() => ed.barLinesOf(s, -1), ed.EditError)
})

test('bar lines: every start and end value round-trips through MusicXML', () => {
  for (const start of ['normal', 'repeat'] as const) {
    for (const end of ['normal', 'double', 'repeat'] as const) {
      const s = scoreOf([barOf('C'), barOf('D'), barOf('E')])
      ed.setBarStart(s, 1, start)
      ed.setBarEnd(s, 1, end)
      if (end === 'repeat') ed.setRepeatTimes(s, 1, 5)
      const back = roundTrip(s)
      assert.equal(linesOf(back, 1), `${start}/${end}/${end === 'repeat' ? 5 : 2}`)
      assert.equal(serializeMusicXml(back), serializeMusicXml(s))
      assert.equal(linesOf(back, 0), 'normal/normal/2', 'the bar before is untouched')
    }
  }
  const s = scoreOf([barOf('C'), barOf('D')])
  ed.setBarStart(s, 1, 'repeat')
  ed.setBarEnd(s, 1, 'repeat')
  assert.match(serializeMusicXml(s), /<barline location="left">\s*<bar-style>heavy-light<\/bar-style>\s*<repeat direction="forward"\/>\s*<\/barline>/)
  assert.match(serializeMusicXml(s), /<barline location="right">\s*<bar-style>light-heavy<\/bar-style>\s*<repeat direction="backward"\/>\s*<\/barline>/)
  ed.setRepeatTimes(s, 1, 3)
  assert.match(serializeMusicXml(s), /<repeat direction="backward" times="3"\/>/)
  ed.setRepeatTimes(s, 1, 2)
  assert.equal(/times=/.test(serializeMusicXml(s)), false, 'the default count is not written')
  ed.setBarStart(s, 1, 'normal')
  ed.setBarEnd(s, 1, 'normal')
  assert.equal(/<barline/.test(serializeMusicXml(s)), false, 'a plain bar line is no bar line element at all')
})

test('bar lines: the end of a bar owns the double bar line, so one on the next bar\'s left goes', () => {
  for (const end of ['normal', 'double', 'repeat'] as const) {
    const s = scoreOf([barOf('C'), barOf('D', { left: '<bar-style>light-light</bar-style>' }), barOf('E')])
    ed.setBarEnd(s, 0, end)
    assert.equal(firstLine(s).measures[1]!.leftBarline, undefined, end)
    assert.equal(ed.barLinesOf(s, 0).end, end)
  }
  // A start-repeat on the next bar is not a double bar line and stays.
  const s = scoreOf([barOf('C'), barOf('D', { left: '<bar-style>heavy-light</bar-style><repeat direction="forward"/>' })])
  ed.setBarEnd(s, 0, 'normal')
  assert.equal(ed.barLinesOf(s, 1).start, 'repeat')
  // Changing the start of a bar keeps the double bar line before it, moved to the bar before.
  const t = scoreOf([barOf('C'), barOf('D', { left: '<bar-style>light-light</bar-style>' })])
  ed.setBarStart(t, 1, 'repeat')
  assert.deepEqual([linesOf(t, 0), linesOf(t, 1)], ['normal/double/2', 'repeat/normal/2'])
  ed.setBarStart(t, 1, 'normal')
  assert.deepEqual([linesOf(t, 0), linesOf(t, 1)], ['normal/double/2', 'normal/normal/2'])
})

test('bar lines: an ending stays through every edit', () => {
  const s = scoreOf([
    barOf('C', { left: '<repeat direction="forward"/>' }),
    barOf('D', { left: '<ending number="1" type="start"/>', right: '<ending number="1" type="stop"/><repeat direction="backward"/>' }),
    barOf('E', { left: '<ending number="2" type="start"/>', right: '<ending number="2" type="discontinue"/>' }),
  ])
  const endings = (sc: Score): string =>
    firstLine(sc).measures.map((m) => `${m.leftBarline?.ending?.type ?? '-'}:${m.rightBarline?.ending?.type ?? '-'}`).join(' ')
  const before = endings(s)
  ed.setRepeatTimes(s, 1, 3)
  ed.setBarStart(s, 1, 'repeat')
  ed.setBarStart(s, 1, 'normal')
  ed.setBarEnd(s, 1, 'double')
  ed.setBarEnd(s, 1, 'normal')
  ed.setBarEnd(s, 1, 'repeat')
  ed.setBarStart(s, 2, 'repeat')
  ed.setBarEnd(s, 2, 'repeat')
  ed.setBarStart(s, 2, 'normal')
  ed.setBarEnd(s, 2, 'normal')
  assert.equal(endings(s), before)
  assert.equal(endings(roundTrip(s)), before)
  assert.equal(firstLine(s).measures[1]!.rightBarline!.times, undefined, 'a repeat set back from normal starts at 2 again')
})

test('bar lines: a bar out of range, a count outside 2-8 and a count on a bar without an end-repeat fail without an undo step', () => {
  const s = scoreOf([barOf('C', { right: '<repeat direction="backward"/>' }), barOf('D')])
  failsWithoutUndoStep(s, (sc) => ed.setBarStart(sc, 2, 'repeat'))
  failsWithoutUndoStep(s, (sc) => ed.setBarEnd(sc, -1, 'double'))
  failsWithoutUndoStep(s, (sc) => ed.setBarEnd(sc, 0.5, 'double'))
  failsWithoutUndoStep(s, (sc) => ed.setRepeatTimes(sc, 0, 1))
  failsWithoutUndoStep(s, (sc) => ed.setRepeatTimes(sc, 0, 9))
  failsWithoutUndoStep(s, (sc) => ed.setRepeatTimes(sc, 0, 2.5))
  failsWithoutUndoStep(s, (sc) => ed.setRepeatTimes(sc, 1, 3))
  failsWithoutUndoStep(s, (sc) => ed.setRepeatTimes(sc, 5, 3))
})

test('bar lines: undo and redo in the session restore the bar lines', () => {
  const s = scoreOf([barOf('C'), barOf('D', { right: '<bar-style>light-light</bar-style>' }), barOf('E')])
  const start = throughSession(s, (sc) => ed.setBarStart(sc, 1, 'repeat'))
  assert.deepEqual([linesOf(start.before, 1), linesOf(start.after, 1)], ['normal/double/2', 'repeat/double/2'])
  const end = throughSession(start.after, (sc) => ed.setBarEnd(sc, 1, 'repeat'))
  assert.equal(linesOf(end.after, 1), 'repeat/repeat/2')
  const times = throughSession(end.after, (sc) => ed.setRepeatTimes(sc, 1, 4))
  assert.deepEqual([linesOf(times.before, 1), linesOf(times.after, 1)], ['repeat/repeat/2', 'repeat/repeat/4'])
})

// ---------------------------------------------------------------- deleting elements and fixing clefs (change select-and-delete-elements)

const pitches = (s: Score, bar: number): string[] =>
  firstLine(s).measures[bar]!.items.filter(isNote).map((n) => (n.pitch ? `${n.pitch.step}${n.pitch.alter === 1 ? '#' : n.pitch.alter === -1 ? 'b' : ''}${n.pitch.octave}` : 'rest'))

test('deleteElement: each kind is removed alone, undo brings it back, and the bar check still runs', () => {
  const base = parseMusicXml(read(COMMITTED_FIXTURE))
  const refs: ElementRef[] = [
    { kind: 'tempo', id: 'd1' },
    { kind: 'dynamic', id: 'd2' },
    { kind: 'words', id: 'd4' },
    { kind: 'slur', noteId: 'n1', number: 1 },
    { kind: 'tie', noteId: 'n7' },
    { kind: 'wedge', startId: 'a1' },
    { kind: 'articulation', noteId: 'a1', mark: 'staccato' },
    { kind: 'articulation', noteId: 'n2', mark: 'tenuto' },
    { kind: 'articulation', noteId: 'n3', mark: 'accent' },
    { kind: 'articulation', noteId: 'n7', mark: 'breath' },
    { kind: 'articulation', noteId: 'n15', mark: 'fermata' },
    { kind: 'key', bar: 5 },
    { kind: 'time', bar: 5 },
  ]
  const xmlBefore = serializeMusicXml(base)
  const warningsBefore = computeWarnings(firstLine(base), TENOR_SAX)
  for (const ref of refs) {
    const session = new EditSession(base)
    session.apply((s) => ed.deleteElement(s, ref))
    const after = session.score
    assert.equal(describeElement(firstLine(after), ref), undefined, `${JSON.stringify(ref)} is gone`)
    // Only that element: every other element of the fixture is still there.
    for (const other of refs) if (other !== ref && !(ref.kind === 'tie' && other.kind === 'tie')) assert.ok(describeElement(firstLine(after), other), `${JSON.stringify(other)} stays when ${JSON.stringify(ref)} goes`)
    assert.equal(firstLine(after).measures.flatMap((m) => m.items.filter(isNote)).length, firstLine(base).measures.flatMap((m) => m.items.filter(isNote)).length, 'no note goes')
    // The bar check runs on the result (a deleted 2/4 change leaves bar 6 too short for 3/4).
    const warnings = computeWarnings(firstLine(after), TENOR_SAX)
    if (ref.kind === 'time') assert.ok(warnings.some((w) => w.kind === 'bar-length' && w.bar === '6'), 'bar 6 no longer fits')
    else assert.deepEqual(warnings, warningsBefore)
    assert.ok(session.undo())
    assert.equal(serializeMusicXml(session.score), xmlBefore, `undo restores ${JSON.stringify(ref)}`)
  }
})

test('deleteElement: a slur goes with both its ends; a missing element, a bar line, and the first clef, key and time are refused', () => {
  const s = parseMusicXml(read(COMMITTED_FIXTURE))
  ed.deleteElement(s, { kind: 'slur', noteId: 'n1', number: 1 })
  assert.ok(firstLine(s).measures.every((m) => m.items.filter(isNote).every((n) => n.slurs.length === 0)), 'start and stop both gone')
  ed.deleteElement(s, { kind: 'tie', noteId: 'n7' })
  assert.ok(firstLine(s).measures.every((m) => m.items.filter(isNote).every((n) => !n.tieStart && !n.tieStop)), 'both ends of the tie gone')
  const refused: ElementRef[] = [
    { kind: 'clef', bar: 0 },
    { kind: 'key', bar: 0 },
    { kind: 'time', bar: 0 },
    { kind: 'barline', bar: 2 },
    { kind: 'slur', noteId: 'n1', number: 1 }, // already gone: deleting never adds one back
    { kind: 'tie', noteId: 'n7' },
    { kind: 'articulation', noteId: 'n1', mark: 'staccato' },
    { kind: 'dynamic', id: 'd4' },
    { kind: 'clef', bar: 2 },
  ]
  const refuses = (ref: ElementRef): boolean => {
    try {
      ed.deleteElement(s, ref)
      return false
    } catch (error) {
      return error instanceof ed.EditError
    }
  }
  for (const ref of refused) assert.ok(refuses(ref), `${JSON.stringify(ref)} is refused`)
})

test('setClef: treble to bass keeps every note on its line, so the middle line goes from B4 to D3, and back again', () => {
  const s = score([[{ id: 'a', step: 'B', octave: 4 }, { id: 'b', step: 'C', octave: 5 }, { id: 'c', step: 'E', octave: 4 }]])
  ed.setClef(s, firstVoice(s), 0, { sign: 'F', line: 4 })
  assert.deepEqual(firstLine(s).measures[0]!.clef, { sign: 'F', line: 4 })
  assert.deepEqual(pitches(s, 0), ['D3', 'E3', 'G2'])
  ed.setClef(s, firstVoice(s), 0, { sign: 'G', line: 2 })
  assert.deepEqual(pitches(s, 0), ['B4', 'C5', 'E4'])
})

test('setClef: explicit accidentals stay with their notes, and the key gives the others their alter again', () => {
  // G major: F is sharp. Under treble: an F5 with a printed natural, a G4 with a printed sharp, and a plain D4.
  const s = score([[{ id: 'a', step: 'F', octave: 5, acc: 'natural' }, { id: 'b', step: 'G', octave: 4, alter: 1, acc: 'sharp' }, { id: 'c', step: 'D', octave: 4 }]], { fifths: 1 })
  ed.setClef(s, firstVoice(s), 0, { sign: 'F', line: 4 })
  // Under bass the same places are A3 (natural, printed), B2 (sharp, printed) and F2: F2 has no accidental, so the key makes it F#.
  assert.deepEqual(pitches(s, 0), ['A3', 'B#2', 'F#2'])
  const notes = firstLine(s).measures[0]!.items.filter(isNote)
  assert.deepEqual(notes.map((n) => n.accidental), ['natural', 'sharp', undefined])
})

test('setClef and deleteClef: only the bars up to the next clef change move', () => {
  const s = score([[{ id: 'a', step: 'B', octave: 4 }], [{ id: 'b', step: 'B', octave: 4 }], [{ id: 'c', step: 'D', octave: 3 }], [{ id: 'd', step: 'D', octave: 3 }]], { beats: 1 })
  ed.setClef(s, firstVoice(s), 2, { sign: 'F', line: 4 }) // bars 3-4 were read under bass: here set as a change that moves them
  assert.deepEqual([0, 1, 2, 3].map((b) => pitches(s, b)[0]), ['B4', 'B4', 'F1', 'F1'])
  ed.setClef(s, firstVoice(s), 2, { sign: 'G', line: 2 })
  ed.setClef(s, firstVoice(s), 1, { sign: 'F', line: 4 }) // bar 2 only: bar 3 has its own clef change
  assert.deepEqual([0, 1, 2, 3].map((b) => pitches(s, b)[0]), ['B4', 'D3', 'D3', 'D3'])
  ed.deleteClef(s, firstVoice(s), 1) // treble again from bar 2, up to bar 3's change
  assert.deepEqual([0, 1, 2, 3].map((b) => pitches(s, b)[0]), ['B4', 'B4', 'D3', 'D3'])
  assert.equal(firstLine(s).measures[1]!.clef, undefined)
  assert.throws(() => ed.deleteClef(s, firstVoice(s), 0), ed.EditError)
  assert.throws(() => ed.deleteClef(s, firstVoice(s), 1), ed.EditError)
  assert.throws(() => ed.setClef(s, firstVoice(s), 0, { sign: 'percussion' }), ed.EditError)
})

test('deleteClef: the exercise-91 shape (a bass clef read at bar 11) plays B4 for the middle line once the clef is gone', () => {
  // Bars 1-10 in treble; at bar 11 recognition read a bass clef, so bars 11-14 hold the pitches of the bass staff.
  const bars: S[][] = []
  for (let b = 0; b < 14; b++) bars.push([{ id: `m${b}`, step: b < 10 ? 'B' : 'D', octave: b < 10 ? 4 : 3, type: 'half' }, { id: `x${b}`, step: b < 10 ? 'G' : 'B', octave: b < 10 ? 4 : 2, type: 'half' }])
  const s = score(bars, { beats: 4 })
  setAttr(s, 10, 'clef', { sign: 'F', line: 4 })
  const written = (sc: Score, bar: number): number[] => buildTimeline(firstLine(sc), TENOR_SAX).events.filter((e) => e.barIndex === bar && !e.rest).map((e) => e.written[0]!)
  assert.deepEqual(written(s, 10), [50, 47], 'before: D3 and B2')
  ed.deleteClef(s, firstVoice(s), 10)
  for (const bar of [10, 11, 12, 13]) assert.deepEqual(written(s, bar), [71, 67], `bar ${bar + 1}: B4 on the middle line, G4 below it`)
  assert.deepEqual(written(s, 9), [71, 67], 'bar 10 unchanged')
})

test('deleteKey: a key change to one flat misread at bar 9 of a D major piece goes, and F and C are sharp again', () => {
  const bars: S[][] = []
  for (let b = 0; b < 10; b++) bars.push([{ id: `f${b}`, step: 'F', octave: 4 }, { id: `c${b}`, step: 'C', octave: 5 }, { id: `n${b}`, step: 'C', octave: 5, acc: 'natural' }])
  const s = score(bars, { fifths: 2 })
  setAttr(s, 8, 'key', { fifths: -1 })
  ed.resolveAlters(firstLine(s))
  assert.deepEqual(pitches(s, 8), ['F4', 'C5', 'C5'], 'under one flat')
  ed.deleteKey(s, firstVoice(s).part, 8)
  for (const bar of [8, 9]) assert.deepEqual(pitches(s, bar), ['F#4', 'C#5', 'C5'], `bar ${bar + 1}: D major again; a printed natural stays`)
  assert.equal(firstLine(s).measures[8]!.key, undefined)
  assert.throws(() => ed.deleteKey(s, firstVoice(s).part, 8), ed.EditError)
  assert.throws(() => ed.deleteKey(s, firstVoice(s).part, 0), ed.EditError)
})

test('deleteTime: a deleted time change makes the bar check flag the bars that no longer fit', () => {
  // 3/4, then a 2/4 change at bar 3: bars 3-4 hold two beats.
  const s = score([[{ id: 'a' }, { id: 'b' }, { id: 'c' }], [{ id: 'd' }, { id: 'e' }, { id: 'f' }], [{ id: 'g' }, { id: 'h' }], [{ id: 'i' }, { id: 'j' }]])
  setAttr(s, 2, 'time', { beats: 2, beatType: 4 })
  assert.deepEqual(computeWarnings(firstLine(s), TENOR_SAX).filter((w) => w.kind === 'bar-length'), [])
  ed.deleteTime(s, 2)
  assert.deepEqual(computeWarnings(firstLine(s), TENOR_SAX).filter((w) => w.kind === 'bar-length').map((w) => w.bar), ['3', '4'])
  assert.throws(() => ed.deleteTime(s, 2), ed.EditError)
  assert.throws(() => ed.deleteTime(s, 0), ed.EditError)
})

// ---------------------------------------------------------------- the marks of change more-marks (task 4.2)

const marks = (): Score => parseMusicXml(read(HOMR_MARKS_FIXTURE))
/** One edit through a session: the score before, the score after, and the session to undo with. */
function edited(source: Score, edit: (s: Score) => unknown) {
  const session = new EditSession(source)
  const before = structuredClone(session.score)
  session.apply(edit)
  return { before, after: session.score, session }
}

test('toggles: strong accent and staccatissimo go on and off, undo restores each, a rest refuses them', () => {
  const s = marks()
  for (const [toggle, key, id] of [
    [ed.toggleStrongAccent, 'strongAccent', 'n3'],
    [ed.toggleStaccatissimo, 'staccatissimo', 'n3'],
  ] as const) {
    const on = edited(s, (sc) => toggle(sc, id))
    assert.equal(byId(on.after, id)[key], true)
    assert.equal(byId(s, id)[key], undefined, 'the source score is untouched')
    assert.ok(on.session.undo())
    assert.deepEqual(on.session.score, on.before, `undo of ${key}`)
    // Tapping the active mark removes it (n4 has the strong accent, n5 the staccatissimo).
    const off = edited(s, (sc) => toggle(sc, key === 'strongAccent' ? 'n4' : 'n5'))
    assert.equal(byId(off.after, key === 'strongAccent' ? 'n4' : 'n5')[key], undefined)
    assert.ok(off.session.undo())
    assert.deepEqual(off.session.score, off.before)
    assert.throws(() => toggle(firstLine(s), 'n27'), ed.EditError)
  }
})

test('toggles: trill, turn and mordent replace each other, tapping the active one removes it, undo restores', () => {
  const s = marks()
  // n6 has a trill.
  const turn = edited(s, (sc) => ed.toggleOrnament(sc, 'n6', 'turn'))
  assert.equal(byId(turn.after, 'n6').ornament, 'turn')
  const mordent = edited(turn.after, (sc) => ed.toggleOrnament(sc, 'n6', 'mordent'))
  assert.equal(byId(mordent.after, 'n6').ornament, 'mordent')
  const trill = edited(mordent.after, (sc) => ed.toggleOrnament(sc, 'n6', 'trill'))
  assert.equal(byId(trill.after, 'n6').ornament, 'trill')
  const none = edited(trill.after, (sc) => ed.toggleOrnament(sc, 'n6', 'trill'))
  assert.equal(byId(none.after, 'n6').ornament, undefined)
  for (const step of [turn, mordent, trill, none]) {
    assert.ok(step.session.undo())
    assert.deepEqual(step.session.score, step.before)
  }
  // A plain note takes one; a rest refuses.
  assert.equal(byId(edited(s, (sc) => ed.toggleOrnament(sc, 'n3', 'mordent')).after, 'n3').ornament, 'mordent')
  assert.throws(() => ed.toggleOrnament(firstLine(s), 'n27', 'trill'), ed.EditError)
})

test('toggles: a tremolo is a single one of 3 strokes; tapping it removes it, and from a pair it leaves both notes', () => {
  const s = marks()
  const on = edited(s, (sc) => ed.toggleTremolo(sc, 'n3'))
  assert.deepEqual(byId(on.after, 'n3').tremolo, { kind: 'single', strokes: 3 })
  assert.ok(on.session.undo())
  assert.deepEqual(on.session.score, on.before)
  // n9 and n10 are a two-note tremolo (bar 3), n11 a single one.
  assert.deepEqual([byId(s, 'n9').tremolo?.kind, byId(s, 'n10').tremolo?.kind, byId(s, 'n11').tremolo?.kind], ['start', 'stop', 'single'])
  for (const id of ['n9', 'n10']) {
    const off = edited(s, (sc) => ed.toggleTremolo(sc, id))
    assert.deepEqual([byId(off.after, 'n9').tremolo, byId(off.after, 'n10').tremolo], [undefined, undefined], `tapping ${id}`)
    assert.ok(off.session.undo())
    assert.deepEqual(off.session.score, off.before)
  }
  const single = edited(s, (sc) => ed.toggleTremolo(sc, 'n11'))
  assert.equal(byId(single.after, 'n11').tremolo, undefined)
  assert.equal(byId(single.after, 'n13').tremolo?.kind, 'single', 'the other single tremolos stay')
  assert.throws(() => ed.toggleTremolo(firstLine(s), 'n27'), ed.EditError)
})

test('toggles: an arpeggio is on a chord only, set from any of its notes, and sits on the first note', () => {
  const s = marks()
  // n15 n16 n17 are a chord with the arpeggio (bar 5); n19-n21 a chord without (bar 6); n18 a single note.
  assert.throws(() => ed.toggleArpeggio(firstLine(s), 'n18'), ed.EditError)
  assert.throws(() => ed.toggleArpeggio(firstLine(s), 'n27'), ed.EditError) // a rest
  const on = edited(s, (sc) => ed.toggleArpeggio(sc, 'n21'))
  assert.equal(byId(on.after, 'n19').arpeggio, true)
  assert.equal(byId(on.after, 'n21').arpeggio, undefined)
  assert.ok(on.session.undo())
  assert.deepEqual(on.session.score, on.before)
  const off = edited(s, (sc) => ed.toggleArpeggio(sc, 'n17'))
  assert.equal(byId(off.after, 'n15').arpeggio, undefined)
  assert.ok(off.session.undo())
  assert.deepEqual(off.session.score, off.before)
  // It is written on every note of the chord.
  assert.equal(serializeMusicXml(on.after).match(/<arpeggiate\/>/g)?.length, 6)
  // Deleting down to one note takes the arpeggio off; deleting the first note moves it.
  const moved = edited(s, (sc) => ed.deleteNote(sc, 'n15'))
  assert.equal(byId(moved.after, 'n16').arpeggio, true)
  const single = edited(moved.after, (sc) => ed.deleteNote(sc, 'n17'))
  assert.equal(byId(single.after, 'n16').arpeggio, undefined)
})

test('deleteElement: every new mark is removed alone, a two-note tremolo from both notes, and undo brings each back', () => {
  const base = marks()
  const mark = (noteId: string, m: string): ElementRef => ({ kind: 'articulation', noteId, mark: m as never })
  const refs: ElementRef[] = [
    mark('n1', 'ornament'),
    mark('n6', 'ornament'),
    mark('n7', 'ornament'),
    mark('n4', 'strongAccent'),
    mark('n5', 'staccatissimo'),
    mark('n9', 'tremolo'),
    mark('n11', 'tremolo'),
    mark('n15', 'arpeggio'),
    mark('n26', 'caesura'),
    mark('n21', 'fermata'),
  ]
  const xmlBefore = serializeMusicXml(base)
  for (const ref of refs) {
    assert.ok(describeElement(firstLine(base), ref), `${JSON.stringify(ref)} is in the fixture`)
    const { after, session } = edited(base, (s) => ed.deleteElement(s, ref))
    assert.equal(describeElement(firstLine(after), ref), undefined, `${JSON.stringify(ref)} is gone`)
    for (const other of refs) {
      if (other === ref) continue
      const twin = ref.kind === 'articulation' && other.kind === 'articulation' && ref.mark === 'tremolo' && other.mark === 'tremolo' && other.noteId === 'n9'
      if (!twin) assert.ok(describeElement(firstLine(after), other), `${JSON.stringify(other)} stays when ${JSON.stringify(ref)} goes`)
    }
    assert.ok(session.undo())
    assert.equal(serializeMusicXml(session.score), xmlBefore, `undo restores ${JSON.stringify(ref)}`)
  }
  // The two-note tremolo goes from both notes, whichever note the reference names.
  for (const id of ['n9', 'n10']) {
    const s = marks()
    ed.deleteElement(s, mark(id, 'tremolo'))
    assert.deepEqual([byId(s, 'n9').tremolo, byId(s, 'n10').tremolo], [undefined, undefined])
  }
  // The ornament that goes is the note's own, and the note plays plainly after (the notes stay).
  const s = marks()
  ed.deleteElement(s, mark('n6', 'ornament'))
  assert.equal(byId(s, 'n6').ornament, undefined)
  assert.equal(notes(s).length, notes(base).length)
  assert.throws(() => ed.deleteElement(s, mark('n6', 'ornament')), ed.EditError) // already gone
})

test('notes: a note that becomes a rest loses its new marks, and deleting one note of a tremolo pair leaves no half pair', () => {
  const s = marks()
  ed.noteToRest(firstLine(s), 'n6')
  assert.equal(byId(s, 'n6').ornament, undefined)
  ed.noteToRest(firstLine(s), 'n9')
  assert.deepEqual([byId(s, 'n9').tremolo, byId(s, 'n10').tremolo], [undefined, undefined])
  const t = marks()
  ed.deleteNote(firstLine(t), 'n10')
  assert.equal(byId(t, 'n9').tremolo, undefined)
})

test('grace notes: selected, changed and deleted like notes, and never added', () => {
  const s = marks()
  const grace = byId(s, 'n2')
  assert.equal(grace.grace, true)
  ed.stepPitch(firstLine(s), 'n2', 1)
  assert.equal(name(byId(s, 'n2')), 'E5')
  ed.setAccidental(firstLine(s), 'n2', 'sharp')
  assert.equal(name(byId(s, 'n2')), 'E#5')
  assert.throws(() => ed.insertNote(firstLine(s), 'n2', 'after', 'note'), ed.EditError) // nothing is inserted next to one
  assert.throws(() => ed.setDuration(firstLine(s), 'n2', { type: 'quarter', dots: 0, triplet: false }), ed.EditError)
  // Inserting next to an ordinary note never makes a grace note.
  const fresh = ed.insertNote(firstLine(s), 'n1', 'after', 'note')
  assert.equal(byId(s, fresh).grace, undefined)
  // Deleted as a note; the selection moves on.
  assert.equal(ed.deleteNote(firstLine(s), 'n2'), 'n3')
  assert.equal(notes(s).find((n) => n.id === 'n2'), undefined)
})

test('multi-measure rest: the editor draws every bar, and a note put into the run ends it for practice too', async () => {
  const s = marks()
  const runBars = [7, 8, 9, 10]
  assert.equal(firstLine(s).measures[7]!.multiRest, 4)
  const rests = runBars.map((b) => notesOf(firstLine(s).measures[b]!)[0]!.id)
  // Fix a bar inside a long rest: the editor's drawing has the four bars, each with its whole-bar rest.
  const editor = serializeMusicXml(s, { multiRests: 'expand' })
  assert.ok(!editor.includes('<multiple-rest>'))
  assert.equal(editor.match(/<rest measure="yes"\/>/g)?.length, 4)
  assert.ok(serializeMusicXml(s).includes('<multiple-rest>4</multiple-rest>'), 'practice and the stored file keep the run')
  // An edit elsewhere keeps the run.
  const elsewhere = edited(s, (sc) => ed.stepPitch(sc, 'n3', 1))
  assert.equal(firstLine(elsewhere.after).measures[7]!.multiRest, 4)
  // A note put into the third bar of the run: the run goes, in the session's score and in what is saved.
  const put = edited(s, (sc) => ed.restToNote(sc, rests[2]!))
  assert.equal(firstLine(put.after).measures[7]!.multiRest, undefined)
  const saved = serializeMusicXml(parseMusicXml(serializeMusicXml(put.after)))
  assert.ok(!saved.includes('<multiple-rest>'))
  const [svg] = await renderScore(put.after, { width: 900 })
  assert.equal(svg!.match(/class="measure"/g)?.length, 12, 'bars 8 to 11 are drawn bar by bar')
  assert.ok(!svg!.includes('class="multiRest"'))
  // Undo gives the run back.
  assert.ok(put.session.undo())
  assert.equal(firstLine(put.session.score).measures[7]!.multiRest, 4)
  assert.deepEqual(put.session.score, put.before)
  // Anything else in a bar of the run ends it too: a fermata on the first rest, a note added after the last.
  assert.equal(firstLine(edited(s, (sc) => ed.toggleFermata(sc, rests[0]!)).after).measures[7]!.multiRest, undefined)
  assert.equal(firstLine(edited(s, (sc) => ed.insertNote(sc, rests[3]!, 'after', 'note')).after).measures[7]!.multiRest, undefined)
  // An edit that fails changes nothing, the run included.
  const session = new EditSession(s)
  assert.throws(() => session.apply((sc) => ed.toggleTremolo(sc, rests[1]!)), ed.EditError)
  assert.equal(firstLine(session.score).measures[7]!.multiRest, 4)
})

// ---------------------------------------------------------------- edits in any part, staff and voice (change edit-parts)

/** Every hairpin of the score as [type, start, stop]. */
const allWedges = (s: Score): [string, string, string][] =>
  s.bars.flatMap((b) => b.parts.flatMap((p) => p.staves.flatMap((st) => st.voices.flatMap((v) => v.filter(isWedge).map((w): [string, string, string] => [w.type, w.start, w.stop])))))
/** The melody-and-piano fixture: P1 the melody, P2 the piano; bar 3 has a second voice in the left hand (n44, C2). */
const melodyPiano = (): Score => parseMusicXml(read(MELODY_PIANO_FIXTURE))
const RIGHT_HAND: VoiceRef = { part: 'P2', staff: 0, voice: 0 }
const LEFT_HAND: VoiceRef = { part: 'P2', staff: 1, voice: 0 }
const LEFT_HAND_2: VoiceRef = { part: 'P2', staff: 1, voice: 1 }
const MELODY: VoiceRef = { part: 'P1', staff: 0, voice: 0 }
/** The items of one voice in every bar, as JSON, to compare what an edit left alone. */
const voiceJson = (s: Score, ref: VoiceRef): string => JSON.stringify(voiceView(s, ref).measures.map((m) => m.items))
/** The ids of the notes of one voice in one bar (from 0), with chord members marked `+`. */
const idsIn = (s: Score, ref: VoiceRef, bar: number): string[] =>
  voiceView(s, ref).measures[bar]!.items.filter(isNote).filter((n) => !n.hidden).map((n) => (n.chord ? `+${n.id}` : n.id))

test('edit parts: an edit in the left hand\'s second voice changes that voice only', () => {
  const { before, after } = edited(melodyPiano(), (s) => ed.stepPitch(s, 'n44', 1))
  assert.equal(noteIndex(after).get('n44')!.note.pitch!.step, 'D', 'C2 -> D2')
  assert.deepEqual(noteIndex(after).get('n44')!.ref, LEFT_HAND_2)
  for (const ref of voices(before)) if (!sameVoice(ref, LEFT_HAND_2)) assert.equal(voiceJson(after, ref), voiceJson(before, ref), `${JSON.stringify(ref)} is unchanged`)
  // Inserting there stays in that voice too.
  const inserted = edited(melodyPiano(), (s) => ed.insertNote(s, 'n44', 'after', 'rest'))
  const newId = [...noteIndex(inserted.after).keys()].find((id) => !noteIndex(before).has(id))!
  assert.deepEqual(noteIndex(inserted.after).get(newId)!.ref, LEFT_HAND_2)
  for (const ref of voices(before)) if (!sameVoice(ref, LEFT_HAND_2)) assert.equal(voiceJson(inserted.after, ref), voiceJson(before, ref))
  // The bar check runs on every voice of the bar: the second voice is now too long, and only it is flagged.
  const flagged = computeScoreWarnings(inserted.after, 'P1', TENOR_SAX).filter((w) => w.kind === 'bar-length')
  assert.deepEqual(flagged.map((w) => w.bar), ['3'])
})

test('edit parts: parts stay apart (spec "Edit any part")', () => {
  const { before, after } = edited(melodyPiano(), (s) => ed.deleteNote(s, 'n9'))
  assert.deepEqual(idsIn(after, MELODY, 2), ['n8', 'n10'])
  for (const ref of [RIGHT_HAND, LEFT_HAND, LEFT_HAND_2]) assert.equal(voiceJson(after, ref), voiceJson(before, ref), `bar 3 of ${ref.staff === 0 ? 'the right' : 'the left'} hand is unchanged`)
})

test('edit parts: a note edit on a whole score refuses a note that is not there', () => {
  assert.throws(() => ed.stepPitch(melodyPiano(), 'nope', 1), ed.EditError)
  assert.throws(() => ed.voiceOfNote(melodyPiano(), 'nope'), ed.EditError)
})

/** One 3/4 bar: the chord C5–E5 (a, b), then D5 (c) and E5 (d), quarter notes. */
const chordBar = (): Score => {
  const s = score([[{ id: 'a', step: 'C', octave: 5 }, { id: 'b', step: 'E', octave: 5 }, { id: 'c', step: 'D', octave: 5 }, { id: 'd', step: 'E', octave: 5 }]])
  byId(s, 'b').chord = true
  return s
}
const chordPitches = (s: Score): string[] => notes(s).map((n) => (n.rest ? 'rest' : `${n.chord ? '+' : ''}${n.pitch!.step}${n.pitch!.octave}`))

test('edit parts: fix one note of a chord (spec "Edit a note")', () => {
  const { after } = edited(chordBar(), (s) => ed.stepPitch(s, 'b', 1))
  assert.deepEqual(chordPitches(after), ['C5', '+F5', 'D5', 'E5'], 'C5–E5 becomes C5–F5')
  const sharp = edited(chordBar(), (s) => ed.setAccidental(s, 'b', 'flat'))
  assert.equal(byId(sharp.after, 'b').accidental, 'flat')
  assert.equal(byId(sharp.after, 'a').accidental, undefined, 'the accidental is on the chord note only')
})

test('edit parts: lengthen a chord from any of its notes (spec "Edit a note")', () => {
  for (const id of ['a', 'b']) {
    const { after } = edited(chordBar(), (s) => ed.setDuration(s, id, { type: 'half', dots: 0, triplet: false }))
    assert.deepEqual([byId(after, 'a').type, byId(after, 'b').type, byId(after, 'c').type], ['half', 'half', 'quarter'], `from ${id}`)
    assert.deepEqual(byId(after, 'b').duration, frac(1, 2))
  }
  // On the piano: the middle note of the right hand's first chord sets the whole chord.
  const { after } = edited(melodyPiano(), (s) => ed.setDuration(s, 'n21', { type: 'quarter', dots: 1, triplet: false }))
  for (const id of ['n20', 'n21', 'n22']) assert.deepEqual([noteIndex(after).get(id)!.note.type, noteIndex(after).get(id)!.note.dots], ['quarter', 1])
})

test('edit parts: a triplet of chords counts each chord once', () => {
  // Three eighth-note chords: each has a second note.
  const s = score([[{ id: 'a', type: 'eighth' }, { id: 'a2', type: 'eighth' }, { id: 'b', type: 'eighth' }, { id: 'b2', type: 'eighth' }, { id: 'c', type: 'eighth' }, { id: 'c2', type: 'eighth' }, { id: 'd', type: 'half' }]])
  for (const id of ['a2', 'b2', 'c2']) byId(s, id).chord = true
  let after = s
  for (const id of ['a2', 'b', 'c']) after = edited(after, (sc) => ed.setDuration(sc, id, { type: 'eighth', dots: 0, triplet: true })).after
  assert.deepEqual(byId(after, 'a').tuplets, [{ type: 'start', number: 1 }])
  assert.deepEqual(byId(after, 'c').tuplets, [{ type: 'stop', number: 1 }])
  for (const id of ['a2', 'b', 'b2', 'c2']) assert.deepEqual(byId(after, id).tuplets, [], `${id} carries no bracket`)
  for (const id of ['a', 'a2', 'b', 'b2', 'c', 'c2']) assert.deepEqual(byId(after, id).timeMod, { actual: 3, normal: 2 })
})

test('edit parts: insert in the second voice (spec "Edit a note")', () => {
  const before = melodyPiano()
  const { after, session } = edited(before, (s) => ed.insertNote(s, 'n44', 'after', 'note'))
  const fresh = [...noteIndex(after).keys()].find((id) => !noteIndex(before).has(id))!
  assert.deepEqual(noteIndex(after).get(fresh)!.ref, LEFT_HAND_2, 'the new note is in voice 2')
  assert.deepEqual(idsIn(after, LEFT_HAND_2, 2), ['n44', fresh])
  assert.equal(voiceJson(after, LEFT_HAND), voiceJson(before, LEFT_HAND), 'voice 1 is unchanged')
  assert.ok(session.canUndo)
  // Next to a chord, a note goes before or after the whole chord.
  const chord = edited(chordBar(), (s) => ed.insertNote(s, 'b', 'before', 'rest'))
  assert.deepEqual(chordPitches(chord.after), ['rest', 'C5', '+E5', 'D5', 'E5'])
})

test('edit parts: "Make rest" on a chord note makes the whole chord one rest', () => {
  const { after, session } = edited(melodyPiano(), (s) => ed.noteToRest(s, 'n21'))
  assert.deepEqual(idsIn(after, RIGHT_HAND, 0), ['n20', 'n23', '+n24', '+n25'])
  const rest = noteIndex(after).get('n20')!.note
  assert.equal(rest.rest, true)
  assert.equal(rest.type, 'half')
  assert.ok(session.canUndo)
  const small = edited(chordBar(), (s) => ed.noteToRest(s, 'b'))
  assert.deepEqual(chordPitches(small.after), ['rest', 'D5', 'E5'])
})

test('edit parts: deleting a chord note deletes that note only, and the chord stays selected', () => {
  const s = melodyPiano()
  const session = new EditSession(s)
  assert.equal(session.apply((sc) => ed.deleteNote(sc, 'n21')), 'n20')
  assert.deepEqual(idsIn(session.score, RIGHT_HAND, 0), ['n20', '+n22', 'n23', '+n24', '+n25'])
  // The first note of a chord: the next note takes over as the chord's first, and is selected.
  assert.equal(session.apply((sc) => ed.deleteNote(sc, 'n23')), 'n24')
  assert.deepEqual(idsIn(session.score, RIGHT_HAND, 0), ['n20', '+n22', 'n24', '+n25'])
})

test('edit parts: a tie on a chord note joins the note of the same pitch in the next chord', () => {
  // C4–E4 | C4–E4, the E4s tied.
  const s = score([[{ id: 'a', step: 'C' }, { id: 'b', step: 'E' }, { id: 'c', step: 'C' }, { id: 'd', step: 'E' }, { id: 'e', type: 'quarter' }]])
  byId(s, 'b').chord = true
  byId(s, 'd').chord = true
  const tied = edited(s, (sc) => ed.toggleTie(sc, 'b')).after
  assert.deepEqual([byId(tied, 'b').tieStart, byId(tied, 'd').tieStop, byId(tied, 'c').tieStop], [true, true, undefined])
  const added = edited(s, (sc) => ed.addTie(sc, 'b', 'd')).after
  assert.deepEqual([byId(added, 'b').tieStart, byId(added, 'd').tieStop], [true, true])
  assert.throws(() => ed.addTie(structuredClone(s), 'b', 'c'), ed.EditError)
  // Removing it from either end removes both ends, and the C4s are not touched.
  for (const id of ['b', 'd']) {
    const off = edited(tied, (sc) => ed.toggleTie(sc, id)).after
    assert.deepEqual([byId(off, 'b').tieStart, byId(off, 'd').tieStop], [undefined, undefined])
  }
  // Deleting the tied chord note takes the tie's other end away too.
  const gone = edited(tied, (sc) => ed.deleteNote(sc, 'b')).after
  assert.equal(byId(gone, 'd').tieStop, undefined)
})

test('edit parts: add a missed chord note, a third above in the key (spec "Chord tools")', () => {
  // C4–E4 in C major: G4 is added, and selected.
  const s = score([[{ id: 'a', step: 'C' }, { id: 'b', step: 'E' }, { id: 'c', type: 'half' }]])
  byId(s, 'b').chord = true
  const session = new EditSession(s)
  const added = session.apply((sc) => ed.addChordNote(sc, 'a'))
  assert.deepEqual(chordPitches(session.score), ['C4', '+E4', '+G4', 'G4'])
  assert.equal(byId(session.score, added).id, added)
  assert.equal(byId(session.score, added).type, 'quarter')
  assert.equal(byId(session.score, added).accidental, undefined)
  // In D major, a third above D is F♯ (from the key, without an accidental of its own).
  const d = score([[{ id: 'a', step: 'D' }, { id: 'b', type: 'half' }]], { fifths: 2 })
  const inD = edited(d, (sc) => ed.addChordNote(sc, 'a')).after
  const fSharp = notes(inD)[1]!
  assert.deepEqual([fSharp.chord, fSharp.pitch], [true, { step: 'F', alter: 1, octave: 4 }])
  assert.equal(fSharp.accidental, undefined)
  // Over the top of the octave, and not on a rest.
  const b = edited(score([[{ id: 'a', step: 'A', octave: 4 }, { id: 'b', type: 'half' }]]), (sc) => ed.addChordNote(sc, 'a')).after
  assert.deepEqual(notes(b)[1]!.pitch, { step: 'C', octave: 5 })
  failsWithoutUndoStep(score([[{ id: 'a', rest: true }, { id: 'b', type: 'half' }]]), (sc) => ed.addChordNote(sc, 'a'))
})

interface P { id: string; step?: string; octave?: number; type?: string; rest?: boolean; chord?: boolean; slur?: 'start' | 'stop' }
/** One 4/4 bar of a piano part: the right hand (staff 1) and the left hand (staff 2), each one voice. */
function piano(right: P[], left: P[]): Score {
  const one = (p: P, staff: number): string =>
    `<note id="${p.id}">${p.chord ? '<chord/>' : ''}${p.rest ? '<rest/>' : `<pitch><step>${p.step ?? 'C'}</step><octave>${p.octave ?? 4}</octave></pitch>`}<duration>${TICKS[p.type ?? 'quarter']}</duration><voice>${staff === 1 ? 1 : 5}</voice><type>${p.type ?? 'quarter'}</type><staff>${staff}</staff>${p.slur ? `<notations><slur type="${p.slur}" number="1"/></notations>` : ''}</note>`
  const length = right.filter((p) => !p.chord).reduce((t, p) => t + TICKS[p.type ?? 'quarter']!, 0)
  const attrs = '<attributes><divisions>12</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>'
  const bar = `<measure number="1">${attrs}${right.map((p) => one(p, 1)).join('')}<backup><duration>${length}</duration></backup>${left.map((p) => one(p, 2)).join('')}</measure>`
  return parseMusicXml(`<?xml version="1.0"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">${bar}</part></score-partwise>`)
}
const PIANO_RIGHT: VoiceRef = { part: 'P1', staff: 0, voice: 0 }
const PIANO_LEFT: VoiceRef = { part: 'P1', staff: 1, voice: 0 }
/** A hand's first bar as "id:pitch" (a rest is "id:rest"), chord notes marked `+`. */
const hand = (s: Score, ref: VoiceRef): string[] =>
  voiceView(s, ref).measures[0]!.items.filter(isNote).map((n) => `${n.chord ? '+' : ''}${n.id}:${n.rest ? 'rest' : `${n.pitch!.step}${n.pitch!.octave}`}`)

test('edit parts: a note read in the wrong hand moves to the other hand (spec "Chord tools")', () => {
  // A quarter C4 on beat 3 in the right hand; the left hand has a quarter rest there.
  const s = piano(
    [{ id: 'r1', step: 'E' }, { id: 'r2', step: 'D' }, { id: 'r3', step: 'C' }, { id: 'r4', step: 'D' }],
    [{ id: 'l1', step: 'C', octave: 3, type: 'half' }, { id: 'l2', rest: true }, { id: 'l3', step: 'G', octave: 2 }],
  )
  const session = new EditSession(s)
  assert.equal(session.apply((sc) => ed.moveToOtherStaff(sc, 'r3')), 'r3', 'the moved note stays selected')
  const right = hand(session.score, PIANO_RIGHT)
  assert.equal(right.length, 4)
  assert.deepEqual([right[0], right[1], right[3]], ['r1:E4', 'r2:D4', 'r4:D4'])
  assert.match(right[2]!, /:rest$/, 'the right hand has a quarter rest on beat 3')
  assert.deepEqual(hand(session.score, PIANO_LEFT), ['l1:C3', 'r3:C4', 'l3:G2'], 'C4 is in the left hand on beat 3')
  assert.deepEqual(noteIndex(session.score).get('r3')!.ref, PIANO_LEFT)
  assert.ok(session.undo())
  assert.deepEqual(session.score, s)
})

test('edit parts: a moved chord note joins a chord of the same start and length', () => {
  // The right hand's chord C4–E4 on beat 1; the left hand has C3 there, a quarter too.
  const s = piano(
    [{ id: 'r1', step: 'C' }, { id: 'r1b', step: 'E', chord: true }, { id: 'r2', type: 'half' }, { id: 'r3' }],
    [{ id: 'l1', step: 'C', octave: 3 }, { id: 'l2', type: 'half', step: 'G', octave: 2 }, { id: 'l3', step: 'C', octave: 3 }],
  )
  // A chord note other than the first moves alone: E4 joins C3, and C4 stays.
  const member = edited(s, (sc) => ed.moveToOtherStaff(sc, 'r1b')).after
  assert.deepEqual(hand(member, PIANO_RIGHT), ['r1:C4', 'r2:C4', 'r3:C4'], 'nothing is left behind for a chord note')
  assert.deepEqual(hand(member, PIANO_LEFT), ['l1:C3', '+r1b:E4', 'l2:G2', 'l3:C3'])
  // Moving the chord's first note takes the whole chord, and leaves a quarter rest.
  const whole = edited(s, (sc) => ed.moveToOtherStaff(sc, 'r1')).after
  assert.match(hand(whole, PIANO_RIGHT)[0]!, /:rest$/)
  assert.deepEqual(hand(whole, PIANO_LEFT), ['l1:C3', '+r1:C4', '+r1b:E4', 'l2:G2', 'l3:C3'])
  // A whole-bar rest takes a whole note.
  const empty = piano([{ id: 'r1', type: 'whole', step: 'A', octave: 3 }], [{ id: 'l1', rest: true, type: 'whole' }])
  assert.deepEqual(hand(edited(empty, (sc) => ed.moveToOtherStaff(sc, 'r1')).after, PIANO_LEFT), ['r1:A3'])
})

test('edit parts: nowhere to go in the other hand (spec "Chord tools")', () => {
  // The left hand holds a half note across beat 3.
  const s = piano(
    [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }, { id: 'r4' }],
    [{ id: 'l1', step: 'C', octave: 3 }, { id: 'l2', step: 'G', octave: 2, type: 'half' }, { id: 'l3', rest: true }],
  )
  failsWithoutUndoStep(s, (sc) => ed.moveToOtherStaff(sc, 'r3'))
  // A rest of another length is no place either, and a one-staff part has no other hand.
  failsWithoutUndoStep(piano([{ id: 'r1', type: 'half' }, { id: 'r2', type: 'half' }], [{ id: 'l1', rest: true }, { id: 'l2', rest: true }, { id: 'l3', type: 'half' }]), (sc) => ed.moveToOtherStaff(sc, 'r1'))
  failsWithoutUndoStep(six(), (sc) => ed.moveToOtherStaff(sc, 'a'))
  failsWithoutUndoStep(s, (sc) => ed.moveToOtherStaff(sc, 'l3'))
})

test('edit parts: a moved note loses its slurs, at both ends', () => {
  const s = piano(
    [{ id: 'r1', slur: 'start' }, { id: 'r2', slur: 'stop' }, { id: 'r3' }, { id: 'r4' }],
    [{ id: 'l1', rest: true }, { id: 'l2', rest: true }, { id: 'l3', rest: true, type: 'half' }],
  )
  assert.equal(noteIndex(s).get('r2')!.note.slurs.length, 1)
  const after = edited(s, (sc) => ed.moveToOtherStaff(sc, 'r1')).after
  assert.deepEqual(noteIndex(after).get('r1')!.note.slurs, [])
  assert.deepEqual(noteIndex(after).get('r2')!.note.slurs, [], 'the slur\'s other end goes too')
  // The score is still written and read back the same.
  assert.equal(serializeMusicXml(parseMusicXml(serializeMusicXml(after))), serializeMusicXml(after))
})

test('edit parts: key of the melody only (spec "Edit signatures and tempo")', () => {
  const s = melodyPiano()
  const { after } = edited(s, (sc) => ed.setKey(sc, 'P1', 2))
  assert.equal(after.bars[0]!.parts[0]!.key?.fifths, 2, 'the melody has two sharps')
  assert.equal(after.bars[0]!.parts[1]!.key?.fifths, 0, 'the piano keeps no sharps')
  // C in the melody is C♯ now; the C of the piano stays C.
  assert.equal(noteIndex(after).get('n4')!.note.pitch!.alter, 1)
  assert.equal(noteIndex(after).get('n20')!.note.pitch!.alter, undefined)
  assert.equal(noteIndex(after).get('n26')!.note.pitch!.alter, undefined, 'and the left hand too')
  // The piano's key reaches both its staves and every voice.
  const piano = edited(s, (sc) => ed.setKey(sc, 'P2', 2)).after
  for (const id of ['n20', 'n26', 'n43']) assert.equal(noteIndex(piano).get(id)!.note.pitch!.alter, 1, `${id} is C♯`)
  assert.throws(() => ed.setKey(melodyPiano(), 'P9', 1), ed.EditError)
})

test('edit parts: the time signature is the whole piece\'s (spec "Edit signatures and tempo")', () => {
  const { after } = edited(melodyPiano(), (sc) => ed.setTime(sc, 3, 4))
  const written = serializeMusicXml(after)
  assert.equal(written.match(/<beats>3<\/beats>/g)?.length, 2, 'both parts are in 3/4')
  assert.ok(!written.includes('<beats>4</beats>'))
})

test('edit parts: left hand only (spec "Fix a clef")', () => {
  // The left hand read in treble clef: set it so, then change it back to bass.
  const s = melodyPiano()
  ed.setClef(s, { part: 'P2', staff: 1 }, 0, { sign: 'G', line: 2 })
  const right = voiceJson(s, RIGHT_HAND)
  const name = (sc: Score, id: string): string => `${noteIndex(sc).get(id)!.note.pitch!.step}${noteIndex(sc).get(id)!.note.pitch!.octave}`
  assert.equal(name(s, 'n26'), 'A4', 'C3 read under a treble clef is A4, on the same space')
  const { after } = edited(s, (sc) => ed.setClef(sc, { part: 'P2', staff: 1 }, 0, { sign: 'F', line: 4 }))
  assert.deepEqual(after.bars[0]!.parts[1]!.staves[1]!.clef, { sign: 'F', line: 4 })
  assert.deepEqual(after.bars[0]!.parts[1]!.staves[0]!.clef, { sign: 'G', line: 2 }, 'the right hand keeps its treble clef')
  assert.equal(name(after, 'n26'), 'C3')
  assert.equal(name(after, 'n44'), 'C2', 'the second voice of the left hand moves with it')
  assert.equal(voiceJson(after, RIGHT_HAND), right, 'the right hand is unchanged')
  // A clef change of the left hand is deleted on the left hand only.
  const changed = edited(after, (sc) => ed.setClef(sc, { part: 'P2', staff: 1 }, 2, { sign: 'G', line: 2 })).after
  const back = edited(changed, (sc) => ed.deleteElement(sc, { kind: 'clef', part: 'P2', staff: 1, bar: 2 })).after
  assert.equal(name(back, 'n43'), 'C3')
  assert.equal(back.bars[2]!.parts[1]!.staves[1]!.clef, undefined)
  assert.throws(() => ed.setClef(melodyPiano(), { part: 'P1', staff: 1 }, 0, { sign: 'F', line: 4 }), ed.EditError) // the melody has one staff
})

test('edit parts: a slur or tie across voices is refused (spec "Marks belong to a staff or voice")', () => {
  // Bar 3 of the fixture's left hand: E3 D3 C3 in voice 1, C2 in voice 2.
  failsWithoutUndoStep(melodyPiano(), (s) => ed.addSlur(s, 'n41', 'n44'))
  assert.throws(() => ed.addSlur(melodyPiano(), 'n41', 'n44'), /one voice/)
  assert.throws(() => ed.addTie(melodyPiano(), 'n43', 'n44'), /one voice/)
  // Within one voice it is as before.
  const { after } = edited(melodyPiano(), (s) => ed.addSlur(s, 'n41', 'n43'))
  assert.deepEqual(noteIndex(after).get('n41')!.note.slurs, [{ type: 'start', number: 1 }])
})

test('edit parts: a hairpin on the left hand plays louder on the left hand only (spec "Marks belong to a staff or voice")', () => {
  // A crescendo over bar 3 of the left hand, from E3 (voice 1) to C2 (voice 2): one staff, two voices.
  const before = melodyPiano()
  const { after } = edited(before, (s) => ed.addWedge(s, 'crescendo', 'n41', 'n44'))
  assert.equal(ed.wedgeAt(after, 'n42')?.type, 'crescendo', 'a note under it in voice 1')
  assert.equal(ed.wedgeAt(after, 'n44')?.type, 'crescendo', 'and its last note in voice 2')
  assert.equal(ed.wedgeAt(after, 'n35'), undefined, 'the right hand has none')
  const gain = (s: Score, id: string): number => buildTimeline(s, TENOR_SAX).eventOfNote(id)!.gain
  assert.ok(gain(after, 'n43') > gain(before, 'n43'), 'the left hand grows louder')
  for (const id of ['n35', 'n38', 'n8', 'n10']) assert.equal(gain(after, id), gain(before, id), `${id} (right hand, melody) does not change`)
  // Written and read back, it still runs from E3 to C2.
  const back = parseMusicXml(serializeMusicXml(after))
  assert.deepEqual(allWedges(back), [['crescendo', 'n41', 'n44']])
  // Not from one staff to the other, and not over another hairpin of the staff.
  failsWithoutUndoStep(melodyPiano(), (s) => ed.addWedge(s, 'crescendo', 'n35', 'n43'))
  failsWithoutUndoStep(after, (s) => ed.addWedge(s, 'diminuendo', 'n43', 'n43'))
  // Removing it from a note of the other voice removes it.
  const off = edited(after, (s) => ed.removeWedge(s, 'n44')).after
  assert.deepEqual(allWedges(off), [])
})

// ---------------------------------------------------------------- adding and removing a bar line (change edit-parts, D9, task 5.1)

/** A 3/4 piece of seven bars whose bar 6 was read with six quarter notes (s1..s6): a missed bar line. Other bars: b<bar>1..3. */
const missedBarLine = (): Score =>
  score(
    Array.from({ length: 7 }, (_, i) =>
      i === 5
        ? Array.from({ length: 6 }, (_, k) => ({ id: `s${k + 1}`, step: 'C', octave: 5 }))
        : Array.from({ length: 3 }, (_, k) => ({ id: `b${i + 1}${k + 1}`, step: 'G' })),
    ),
  )
/** A 4/4 piece of six bars whose bar 3 was read as two bars of two beats, bars 3 and 4 (x1 x2 | y1 y2): an extra bar line. */
const extraBarLine = (): Score =>
  score(
    Array.from({ length: 6 }, (_, i) =>
      i === 2 ? [{ id: 'x1', step: 'E' }, { id: 'x2', step: 'F' }] : i === 3 ? [{ id: 'y1', step: 'A' }, { id: 'y2', step: 'B' }] : Array.from({ length: 4 }, (_, k) => ({ id: `b${i + 1}${k + 1}`, step: 'G' })),
    ),
    { beats: 4 },
  )
const ids = (s: Score, bar: number): string[] => idsIn(s, firstVoice(s), bar)
const numbers = (s: Score): string[] => s.bars.map((b) => b.number)
const froms = (s: Score): ([number, number] | undefined)[] => s.bars.map((b) => b.from)
const lengths = (s: Score): string[] => s.bars.map((b) => b.parts.map((p) => p.staves.map((st) => st.voices.map((v) => v.filter(isNote).filter((n) => !n.chord).length).join('/')).join('|')).join(' '))
/** The refusal of a bar-line edit: no undo step, nothing changed, and its reason. */
const refusedWith = (s: Score, edit: (s: Score) => unknown, reason: ed.BarLineRefusal): ed.BarLineError => {
  failsWithoutUndoStep(s, edit)
  try {
    edit(structuredClone(s))
  } catch (error) {
    assert.ok(error instanceof ed.BarLineError, String(error))
    assert.equal(error.reason, reason, error.message)
    return error
  }
  throw new Error('did not refuse')
}

test('bar lines: a missed bar line is added before the fourth note of bar 6, and the bars after it are renumbered (spec "A missed bar line")', () => {
  const s = missedBarLine()
  assert.deepEqual(barCheck(s), ['bar-length@6'])
  const session = new EditSession(s)
  assert.equal(session.apply((sc) => ed.splitBar(sc, 's4')), 's4', 'the selected note stays selected')
  const after = session.score
  assert.equal(after.bars.length, 8)
  assert.deepEqual(ids(after, 5), ['s1', 's2', 's3'])
  assert.deepEqual(ids(after, 6), ['s4', 's5', 's6'])
  assert.deepEqual(ids(after, 7), ['b71', 'b72', 'b73'], 'the old bar 7 is bar 8')
  assert.deepEqual(numbers(after), ['1', '2', '3', '4', '5', '6', '7', '8'])
  assert.deepEqual(barCheck(after), [], 'neither bar is marked as not adding up')
  assert.deepEqual(froms(after), [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 5.5], [5.5, 6], [6, 7]], 'each half holds its half of the loaded bar 6')
  // `from` is never written: the MusicXML is that of the same score without it.
  const plain = structuredClone(after)
  for (const bar of plain.bars) delete bar.from
  assert.equal(serializeMusicXml(after), serializeMusicXml(plain))
  assert.ok(parseMusicXml(serializeMusicXml(after)).bars.every((b) => b.from === undefined))
})

test('bar lines: an extra bar line is removed, the joined bar adds up, and the bars after it are renumbered (spec "An extra bar line")', () => {
  const s = extraBarLine()
  assert.deepEqual(barCheck(s), ['bar-length@3', 'bar-length@4'])
  const { after } = edited(s, (sc) => ed.joinBars(sc, 2))
  assert.equal(after.bars.length, 5)
  assert.deepEqual(ids(after, 2), ['x1', 'x2', 'y1', 'y2'], 'bar 3 holds the notes of both')
  assert.deepEqual(ids(after, 3), ['b51', 'b52', 'b53', 'b54'], 'the old bar 5 is bar 4')
  assert.deepEqual(numbers(after), ['1', '2', '3', '4', '5'])
  assert.deepEqual(barCheck(after), [], 'bar 3 adds up to four beats')
  assert.deepEqual(froms(after), [[0, 1], [1, 2], [2, 4], [4, 5], [5, 6]])
})

test('bar lines: an accidental no longer carries across a bar line that is added, and carries across one that is removed', () => {
  // F♯ then F in one bar: the second F is sharp. With a bar line between them it is F again.
  const s = score([[{ id: 'a', step: 'F', acc: 'sharp', alter: 1 }, { id: 'b', step: 'F', alter: 1 }, { id: 'c', step: 'G' }]])
  const split = edited(s, (sc) => ed.splitBar(sc, 'b')).after
  assert.equal(byId(split, 'b').pitch!.alter, undefined)
  const joined = edited(split, (sc) => ed.joinBars(sc, 0)).after
  assert.equal(byId(joined, 'b').pitch!.alter, 1)
})

test('bar lines: on the melody and piano, the piano\'s whole-bar rest is split in two, and two are joined into one (spec "The rest of the piece follows", "Two rests become one")', () => {
  const s = melodyPiano()
  // Bar 6: the melody E5 D5 | C5 B4, the right hand's half-note chords, the left hand's whole-bar rest n66.
  const { after } = edited(s, (sc) => ed.splitBar(sc, 'n15'))
  assert.equal(after.bars.length, 9)
  assert.deepEqual([idsIn(after, MELODY, 5), idsIn(after, MELODY, 6)], [['n13', 'n14'], ['n15', 'n16']])
  assert.deepEqual([idsIn(after, RIGHT_HAND, 5), idsIn(after, RIGHT_HAND, 6)], [['n60', '+n61', '+n62'], ['n63', '+n64', '+n65']])
  const rests = [5, 6].map((bar) => voiceView(after, LEFT_HAND).measures[bar]!.items.filter(isNote))
  for (const [k, rest] of rests.entries()) {
    assert.equal(rest.length, 1, `bar ${6 + k} of the left hand is one rest`)
    assert.equal(rest[0]!.measureRest, true, `and a whole-bar rest (bar ${6 + k})`)
    assert.deepEqual(rest[0]!.duration, frac(1, 2))
  }
  assert.equal(rests[0]![0]!.id, 'n66', 'the first keeps its id')
  assert.deepEqual([idsIn(after, LEFT_HAND_2, 5), idsIn(after, LEFT_HAND_2, 6)], [[], []], 'the second voice stays empty')
  assert.deepEqual(numbers(after), ['1', '2', '3', '4', '5', '6', '7', '8', '9'])
  assert.equal(after.bars[5]!.newSystem, undefined)
  // Joined again: one whole-bar rest of the whole bar, and the very score that was read.
  const { after: back } = edited(after, (sc) => ed.joinBars(sc, 5))
  const rest = voiceView(back, LEFT_HAND).measures[5]!.items.filter(isNote)
  assert.deepEqual(rest.map((n) => [n.id, n.measureRest, n.duration]), [['n66', true, frac(1)]])
  assert.equal(serializeMusicXml(back), serializeMusicXml(s))
  assert.deepEqual(froms(back), [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8]])
})

test('bar lines: a whole-bar rest joined with notes becomes a rest of the time signature\'s bar length, and the bar check marks the bar', () => {
  // Bars 5 and 6 of the fixture: the melody rests a whole bar (n12), then plays; the left hand plays, then rests (n66).
  const { after } = edited(melodyPiano(), (sc) => ed.joinBars(sc, 4))
  const melody = voiceView(after, MELODY).measures[4]!.items.filter(isNote)
  assert.deepEqual(melody.map((n) => n.id), ['n12', 'n13', 'n14', 'n15', 'n16'])
  assert.deepEqual([melody[0]!.measureRest, melody[0]!.type, melody[0]!.duration], [undefined, 'whole', frac(1)])
  const left = voiceView(after, LEFT_HAND).measures[4]!.items.filter(isNote)
  assert.deepEqual(left.map((n) => n.id), ['n56', 'n57', 'n58', 'n59', 'n66'])
  assert.deepEqual([left[4]!.measureRest, left[4]!.type], [undefined, 'whole'])
  assert.equal(after.bars[4]!.newSystem, true, 'the joined bar starts as the first did')
  assert.ok(computeScoreWarnings(after, 'P1', TENOR_SAX).some((w) => w.kind === 'bar-length' && w.bar === '5'))
})

test('bar lines: a rest across the new bar line is split into standard lengths, longest first; a hidden rest into two hidden rests', () => {
  // The right hand plays four quarters; the left hand an eighth, a half rest, an eighth and a quarter.
  const s = piano(
    [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }, { id: 'r4' }],
    [{ id: 'l1', type: 'eighth', octave: 3 }, { id: 'l2', type: 'half', rest: true }, { id: 'l3', type: 'eighth', octave: 3 }, { id: 'l4', octave: 3 }],
  )
  const { after } = edited(s, (sc) => ed.splitBar(sc, 'r3'))
  const left = [0, 1].map((bar) => voiceView(after, PIANO_LEFT).measures[bar]!.items.filter(isNote).map((n) => `${n.rest ? 'rest' : n.id}:${n.type}`))
  assert.deepEqual(left, [
    ['l1:eighth', 'rest:quarter', 'rest:eighth'],
    ['rest:eighth', 'l3:eighth', 'l4:quarter'],
  ])
  assert.equal(voiceView(after, PIANO_LEFT).measures[0]!.items[1]!.kind === 'note' && (voiceView(after, PIANO_LEFT).measures[0]!.items[1] as Note).id, 'l2', 'the first piece keeps the id')
  assert.equal(new Set(after.bars.flatMap((b) => b.parts.flatMap((p) => p.staves.flatMap((st) => st.voices.flat().filter(isNote).map((n) => n.id))))).size, 10, 'every id is unique')
  assert.deepEqual([...new Set(computeScoreWarnings(after, 'P1', TENOR_SAX).filter((w) => w.kind === 'bar-length').map((w) => w.bar))], ['1', '2'], 'two bars of two beats in 4/4')
  // A second voice in the left hand that starts after a hidden half rest: the hidden rest crosses the point.
  const two = piano([{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }, { id: 'r4' }], [{ id: 'l1', octave: 3 }, { id: 'l2', octave: 3 }, { id: 'l3', octave: 3, type: 'half' }])
  const quarter = (id: string): Note => ({ kind: 'note', id, pitch: { step: 'C', octave: 2 }, type: 'quarter', dots: 0, duration: frac(1, 4), slurs: [], tuplets: [] })
  two.bars[0]!.parts[0]!.staves[1]!.voices.push([{ kind: 'note', id: 'h1', rest: true, hidden: true, dots: 0, duration: frac(1, 2), slurs: [], tuplets: [] }, quarter('v1'), quarter('v2')])
  const hidden = edited(two, (sc) => ed.splitBar(sc, 'r2')).after
  const second = [0, 1].map((bar) => voiceView(hidden, { ...PIANO_LEFT, voice: 1 }).measures[bar]!.items.filter(isNote).map((n) => `${n.hidden ? 'hidden' : n.id}:${n.duration.n}/${n.duration.d}`))
  assert.deepEqual(second, [['hidden:1/4'], ['hidden:1/4', 'v1:1/4', 'v2:1/4']])
})

test('bar lines: a note or a triplet across the new bar line refuses it, naming the staff (spec "A note across the bar line")', () => {
  // Bar 7 of the fixture: the melody C5 D5 in halves, the left hand a whole G2.
  const across = refusedWith(melodyPiano(), (sc) => ed.splitBar(sc, 'n18'), 'across')
  assert.equal(across.message, 'A note in the left hand sounds across that point')
  assert.deepEqual(across.where, LEFT_HAND)
  // A triplet across the point: the left hand plays a quarter-note triplet, then a half note.
  const s = piano([{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }, { id: 'r4' }], [{ id: 'l1', octave: 3 }, { id: 'l2', octave: 3 }, { id: 'l3', octave: 3 }, { id: 'l4', octave: 3 }])
  const lh = voiceView(s, PIANO_LEFT).measures[0]!.items.filter(isNote)
  for (const [k, n] of lh.slice(0, 3).entries()) {
    n.timeMod = { actual: 3, normal: 2 }
    n.duration = frac(1, 6)
    n.tuplets = k === 0 ? [{ type: 'start', number: 1 }] : k === 2 ? [{ type: 'stop', number: 1 }] : []
  }
  lh[3]!.type = 'half'
  lh[3]!.duration = frac(1, 2)
  assert.match(refusedWith(s, (sc) => ed.splitBar(sc, 'r2'), 'triplet').message, /inside a triplet in the left hand/)
  assert.equal(edited(s, (sc) => ed.splitBar(sc, 'r3')).after.bars.length, 2, 'after the triplet it can go')
  // Between two notes of a triplet, in the voice itself.
  const t = score([[{ id: 'a', type: 'eighth' }, { id: 'b', type: 'eighth' }, { id: 'c', type: 'eighth' }, { id: 'd', type: 'half' }]])
  for (const [k, id] of ['a', 'b', 'c'].entries()) {
    const n = byId(t, id)
    n.timeMod = { actual: 3, normal: 2 }
    n.duration = frac(1, 12)
    n.tuplets = k === 0 ? [{ type: 'start', number: 1 }] : k === 2 ? [{ type: 'stop', number: 1 }] : []
  }
  assert.equal(refusedWith(t, (sc) => ed.splitBar(sc, 'b'), 'triplet').message, 'A bar line there would fall inside a triplet')
  // Triplets are counted as the editor brackets them, also when the source wrote no tuplet marks.
  for (const id of ['a', 'b', 'c']) byId(t, id).tuplets = []
  refusedWith(t, (sc) => ed.splitBar(sc, 'c'), 'triplet')
  const afterTriplet = edited(t, (sc) => ed.splitBar(sc, 'd')).after
  assert.deepEqual([ids(afterTriplet, 0), ids(afterTriplet, 1)], [['a', 'b', 'c'], ['d']])
  assert.deepEqual(byId(afterTriplet, 'a').tuplets, [{ type: 'start', number: 1 }], 'and bracketed again')
})

test('bar lines: not before the first note of a bar, a chord note gives its chord\'s start, and a grace note the next note\'s (spec "Not before the first note")', () => {
  const s = chordBar() // the chord C5–E5 (a, b), then D5 (c) and E5 (d)
  assert.equal(ed.canSplitBefore(s, 'a'), false)
  assert.equal(ed.canSplitBefore(s, 'b'), false, 'a chord note at the start is the start')
  assert.equal(ed.canSplitBefore(s, 'c'), true)
  refusedWith(s, (sc) => ed.splitBar(sc, 'b'), 'first')
  const graced = score([[{ id: 'a' }, { id: 'g' }, { id: 'b' }, { id: 'c' }]])
  byId(graced, 'g').grace = true
  byId(graced, 'g').duration = frac(0)
  const { after } = edited(graced, (sc) => ed.splitBar(sc, 'g'))
  assert.deepEqual([ids(after, 0), ids(after, 1)], [['a'], ['g', 'b', 'c']], 'the grace note goes with the note it leads to')
  // A grace note at the end of its bar leads to no note there.
  const last = score([[{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'g' }]])
  byId(last, 'g').grace = true
  byId(last, 'g').duration = frac(0)
  assert.equal(ed.canSplitBefore(last, 'g'), false)
  refusedWith(last, (sc) => ed.splitBar(sc, 'g'), 'end')
})

test('bar lines: the end of the bar moves to the second bar, and a joined bar keeps the first start and the second end (spec "The end of the bar moves along")', () => {
  const s = missedBarLine()
  s.bars[5]!.leftBarline = { style: 'heavy-light', repeat: 'forward' }
  s.bars[5]!.rightBarline = { style: 'light-heavy', repeat: 'backward', times: 3 }
  const { after } = edited(s, (sc) => ed.splitBar(sc, 's4'))
  assert.deepEqual([after.bars[5]!.leftBarline, after.bars[5]!.rightBarline], [{ style: 'heavy-light', repeat: 'forward' }, undefined])
  assert.deepEqual([after.bars[6]!.leftBarline, after.bars[6]!.rightBarline], [undefined, { style: 'light-heavy', repeat: 'backward', times: 3 }])
  // Join: the start of the first and the end of the second; the end-repeat and start-repeat between them go.
  const j = extraBarLine()
  j.bars[2]!.leftBarline = { style: 'heavy-light', repeat: 'forward' }
  j.bars[2]!.rightBarline = { style: 'light-heavy', repeat: 'backward' }
  j.bars[3]!.leftBarline = { style: 'heavy-light', repeat: 'forward' }
  j.bars[3]!.rightBarline = { style: 'light-light' }
  j.bars[3]!.newSystem = true
  const joined = edited(j, (sc) => ed.joinBars(sc, 2)).after.bars[2]!
  assert.deepEqual([joined.leftBarline, joined.rightBarline, joined.newSystem], [{ style: 'heavy-light', repeat: 'forward' }, { style: 'light-light' }, undefined])
  // An ending that starts on the split bar and stops at its end covers both bars.
  const e = missedBarLine()
  e.bars[5]!.leftBarline = { ending: { number: '1', type: 'start' } }
  e.bars[5]!.rightBarline = { style: 'light-heavy', repeat: 'backward', ending: { number: '1', type: 'stop' } }
  const ended = edited(e, (sc) => ed.splitBar(sc, 's4')).after
  assert.deepEqual(ended.bars[5]!.leftBarline, { ending: { number: '1', type: 'start' } })
  assert.equal(ended.bars[5]!.rightBarline, undefined)
  assert.deepEqual(ended.bars[6]!.rightBarline, { style: 'light-heavy', repeat: 'backward', ending: { number: '1', type: 'stop' } })
  assert.deepEqual(buildTimeline(ended, TENOR_SAX).bars.map((b) => b.barIndex), [0, 1, 2, 3, 4, 5, 6, 0, 1, 2, 3, 4, 7], 'the first ending is both bars, played once')
  // An ending start written on the right bar line starts the first bar, so the ending still covers both.
  const r = missedBarLine()
  r.bars[5]!.rightBarline = { ending: { number: '1', type: 'start' } }
  const moved = edited(r, (sc) => ed.splitBar(sc, 's4')).after
  assert.deepEqual([moved.bars[5]!.leftBarline, moved.bars[5]!.rightBarline, moved.bars[6]!.rightBarline], [{ ending: { number: '1', type: 'start' } }, undefined, undefined])
})

test('bar lines: joining refuses after the last bar, before a clef, key or time change, and before an ending (spec "A clef change in the way")', () => {
  const s = extraBarLine()
  assert.match(refusedWith(s, (sc) => ed.joinBars(sc, 5), 'last').message, /no bar after/)
  const change = (f: (sc: Score) => void): Score => {
    const sc = extraBarLine()
    f(sc)
    return sc
  }
  assert.match(refusedWith(change((sc) => (sc.bars[3]!.parts[0]!.staves[0]!.clef = { sign: 'F', line: 4 })), (sc) => ed.joinBars(sc, 2), 'clef').message, /clef change\. Delete it first/)
  refusedWith(change((sc) => (sc.bars[3]!.parts[0]!.key = { fifths: 1 })), (sc) => ed.joinBars(sc, 2), 'key')
  refusedWith(change((sc) => (sc.bars[3]!.time = { beats: 2, beatType: 4 })), (sc) => ed.joinBars(sc, 2), 'time')
  refusedWith(change((sc) => (sc.bars[3]!.leftBarline = { ending: { number: '2', type: 'start' } })), (sc) => ed.joinBars(sc, 2), 'ending')
  refusedWith(change((sc) => (sc.bars[2]!.rightBarline = { ending: { number: '1', type: 'stop' } })), (sc) => ed.joinBars(sc, 2), 'ending')
  // The piano's clef change in the left hand only refuses too.
  const p = melodyPiano()
  p.bars[6]!.parts[1]!.staves[1]!.clef = { sign: 'G', line: 2 }
  refusedWith(p, (sc) => ed.joinBars(sc, 5), 'clef')
})

test('bar lines: a join over a multi-measure rest clears it', () => {
  const s = score([[{ id: 'a' }, { id: 'b' }, { id: 'c' }], [{ id: 'm1', rest: true }], [{ id: 'm2', rest: true }], [{ id: 'd' }, { id: 'e' }, { id: 'f' }]])
  for (const id of ['m1', 'm2']) {
    const rest = byId(s, id)
    rest.measureRest = true
    rest.duration = frac(3, 4)
    delete rest.type
  }
  s.bars[1]!.parts[0]!.multiRest = 2
  const { after } = edited(s, (sc) => ed.joinBars(sc, 1))
  assert.equal(after.bars[1]!.parts[0]!.multiRest, undefined)
  assert.deepEqual(ids(after, 1), ['m1'], 'one whole-bar rest')
  assert.deepEqual(byId(after, 'm1').duration, frac(3, 2))
})

test('bar lines: undo and redo of a split and a join restore the bars and their from', () => {
  const s = melodyPiano()
  const session = new EditSession(s)
  const original = structuredClone(session.score)
  session.apply((sc) => ed.splitBar(sc, 'n15'))
  const split = structuredClone(session.score)
  assert.deepEqual(froms(split), [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 5.5], [5.5, 6], [6, 7], [7, 8]])
  session.apply((sc) => ed.joinBars(sc, 2))
  const joined = structuredClone(session.score)
  assert.deepEqual(froms(joined), [[0, 1], [1, 2], [2, 4], [4, 5], [5, 5.5], [5.5, 6], [6, 7], [7, 8]])
  assert.deepEqual(lengths(joined)[2], '4 3|4/2', 'the melody and both hands of bars 3 and 4 together')
  assert.ok(session.undo())
  assert.deepEqual(session.score, split)
  assert.ok(session.undo())
  assert.deepEqual(session.score, original, 'the score as it was, without from')
  assert.ok(session.redo())
  assert.deepEqual(session.score, split)
  assert.ok(session.redo())
  assert.deepEqual(session.score, joined)
})

test('edit parts: a hairpin from a second voice back to the first voice of the same bar is refused, as it could not be saved', () => {
  // 4/4: voice 1 A4 half, B4 half; voice 2 C4 quarter, then a dotted half rest.
  const n = (id: string, step: string, dur: number, type: string, voice: number): string =>
    `<note id="${id}"><pitch><step>${step}</step><octave>4</octave></pitch><duration>${dur}</duration><voice>${voice}</voice><type>${type}</type></note>`
  const bar = `<measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>${n('a', 'A', 2, 'half', 1)}${n('b', 'B', 2, 'half', 1)}<backup><duration>4</duration></backup>${n('c', 'C', 1, 'quarter', 2)}<note id="r"><rest/><duration>3</duration><voice>2</voice><type>half</type><dot/></note></measure>`
  const s = parseMusicXml(`<?xml version="1.0"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>x</part-name></score-part></part-list><part id="P1">${bar}</part></score-partwise>`)
  failsWithoutUndoStep(s, (sc) => ed.addWedge(sc, 'crescendo', 'c', 'b'))
  // From the first voice to the second it is kept through a save.
  const { after } = edited(s, (sc) => ed.addWedge(sc, 'crescendo', 'a', 'c'))
  assert.deepEqual(allWedges(parseMusicXml(serializeMusicXml(after))), [['crescendo', 'a', 'c']])
})

test('bar lines: a bar line added before another part\'s multi-measure rest keeps it; one added inside it ends it', () => {
  // The melody rests in bars 5 and 6 (indices 4 and 5), printed as one two-bar rest.
  const s = melodyPiano()
  const rest = (id: string) => ({ kind: 'note' as const, id, rest: true, measureRest: true, dots: 0, duration: frac(1), slurs: [], tuplets: [] })
  s.bars[5]!.parts[0]!.staves[0]!.voices[0] = [rest('mr6')]
  s.bars[4]!.parts[0]!.multiRest = 2
  const runs = (sc: Score) => partMultiRestRuns(sc, 0)
  assert.deepEqual(runs(s), [{ start: 4, length: 2 }])
  // A bar line in bar 3 of the piano (before its second chord): the run moves along to bars 6 and 7, and holds.
  const before = edited(s, (sc) => ed.splitBar(sc, 'n38')).after
  assert.deepEqual(runs(before), [{ start: 5, length: 2 }])
  assert.equal(before.bars[5]!.parts[0]!.multiRest, 2)
  // A bar line in bar 5 of the piano: the melody's rest is split too, and the run no longer holds.
  const inside = edited(s, (sc) => ed.splitBar(sc, 'n53')).after
  assert.deepEqual(runs(inside), [])
  assert.ok(inside.bars.every((b) => b.parts[0]!.multiRest === undefined))
})
