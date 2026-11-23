import assert from 'node:assert/strict'
import { test } from 'node:test'
import { effect, signal } from '@preact/signals'
import { barExcerpt, barForEditing, openEditor } from '../src/app/editorSession.ts'
import type { EditorDeps, EditorSession } from '../src/app/editorSession.ts'
import { createI18n } from '../src/app/i18n/index.ts'
import { photoOfBar } from '../src/app/editorRules.ts'
import { DEFAULT_PRACTICE, createLibrary } from '../src/app/library.ts'
import { createRouter } from '../src/app/router.ts'
import { loadSettings } from '../src/app/settings.ts'
import { preparePages } from '../src/core/pages/pages.ts'
import type { AudioBackend } from '../src/core/playback/player.ts'
import type { NoteOnSpec, TimerApi } from '../src/core/playback/scheduler.ts'
import { addBar, addChordNote, addSlur, addTie, addWedge, deleteBar, deleteElement, deleteNote, dynamicOf, insertNote, joinBars, noteToRest, ownerOf, setBarEnd, setBarStart, setClef, setDuration, setKey, setRepeatTimes, splitBar, stepPitch, toggleStaccato } from '../src/core/score/edit.ts'
import { allItemLists, isNote, isWedge, notesOf, placeOfNote, singleVoiceScore, voiceView } from '../src/core/score/model.ts'
import { concertMidi, midiOf } from '../src/core/playback/timeline.ts'
import { frac } from '../src/core/score/rational.ts'
import type { MeasureItem } from '../src/core/score/model.ts'
import type { Score } from '../src/core/score/model.ts'
import { parseMusicXml, serializeMusicXml } from '../src/core/score/musicxml.ts'
import { createFakePlatform } from '../src/platform/fake/index.ts'
import { MELODY_PIANO_FIXTURE, note, quarters, read, score } from './helpers.ts'
import { barNumberProblems, firstLine, setAttr } from './helpers.ts'

// The editor session (practice-app task 9.6, spec `score-editing`): selection, edits with undo and
// redo, live warnings and stepping through them, the bar preview, the title and asking for the name
// of a new piece, the dirty state with the leave guard, and Save & practice.

/** Page 1 (3/4): bar 1 is A3 C5 C5 (a written A3 is below the tenor saxophone), bar 2 is G5 G5 G5. */
const PAGE_1 = score([note({ step: 'A', octave: 3, type: 'quarter' }) + quarters(2, 'C'), quarters(3, 'G')], [3, 4])
/** Page 2: bar 3 is a beat short (E5 E5), bar 4 is fine. */
const PAGE_2 = score([quarters(2, 'E'), quarters(3, 'F')])
const BOX = { x: 0.05, y: 0.1, width: 0.9, height: 0.25 }

async function setup(options: { practiceTempo?: number; isNew?: boolean } = {}) {
  const platform = createFakePlatform()
  const library = createLibrary(platform.files, { newId: () => 'piece-1' })
  const settings = await loadSettings(platform.files)
  const i18n = createI18n()
  const router = createRouter('library')
  platform.files.seed('scans/1/page-1.jpg', Uint8Array.of(1))
  platform.files.seed('scans/1/page-2.jpg', Uint8Array.of(2))
  const prepared = preparePages([PAGE_1, PAGE_2])
  await library.create({
    name: '18 Nov, 14:05',
    musicxml: prepared.musicxml,
    bars: prepared.bars,
    repairs: prepared.repairs,
    pages: [
      { source: 'scans/1/page-1.jpg', recognised: PAGE_1, ...prepared.pages[0]! },
      { source: 'scans/1/page-2.jpg', recognised: PAGE_2, ...prepared.pages[1]!, staves: [{ box: BOX, firstBar: 3, lastBar: 3 }, { box: { ...BOX, y: 0.5 }, firstBar: 4, lastBar: 4 }] },
    ],
  })
  if (options.practiceTempo !== undefined) await library.writePractice('piece-1', { ...DEFAULT_PRACTICE, tempo: options.practiceTempo })

  const played: NoteOnSpec[] = []
  const audio: AudioBackend = {
    currentTime: 0,
    output: {
      noteOn(spec) {
        played.push(spec)
        return { release() {}, cancel() {} }
      },
    },
  }
  const timer: TimerApi = { set: () => 1, clear() {} }
  const deps: EditorDeps = { library, settings, router, i18n, backend: async () => audio, timer }
  router.push({ name: 'editor', pieceId: 'piece-1' })
  const editor = await openEditor(deps, 'piece-1', options.isNew ? { isNew: true } : {})
  return { platform, library, settings, router, i18n, editor, played, deps }
}

/** The ids of the notes of bar [bar] (1-based) of the working score. */
const idsOf = (editor: EditorSession, bar: number): string[] => notesOf(firstLine(editor.score.value).measures[bar - 1]!).map((n) => n.id)
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

// ---- selection -----------------------------------------------------------------------------

test('selection: a note and its bar, and a bar alone', async () => {
  const { editor } = await setup()
  assert.equal(editor.selection.value, null)

  const [, c5] = idsOf(editor, 1)
  assert.equal(editor.select(c5!), true)
  assert.deepEqual(editor.selection.value, { bar: 1, noteId: c5 })
  assert.equal(editor.selectedNote.value!.pitch!.step, 'C')

  const [e5] = idsOf(editor, 3)
  editor.select(e5!)
  assert.deepEqual(editor.selection.value, { bar: 3, noteId: e5 })
  assert.equal(editor.selectBar(4), true)
  assert.deepEqual(editor.selection.value, { bar: 4, noteId: null })
  assert.equal(editor.selectedNote.value, undefined)

  assert.equal(editor.select('no-such-note'), false)
  assert.equal(editor.selectBar(5), false)
  assert.equal(editor.selectBar(0), false)
  assert.deepEqual(editor.selection.value, { bar: 4, noteId: null }, 'nothing changed')
  editor.clearSelection()
  assert.equal(editor.selection.value, null)
})

test('selection: the selected note is named in the note names of the settings, and follows a change at once (change redesign-score-editor, D9)', async () => {
  const { editor, settings } = await setup()
  const [a3, c5] = idsOf(editor, 1)
  assert.equal(editor.selectedNoteName.value, '', 'no note selected')
  editor.select(a3!)
  assert.equal(editor.selectedNoteName.value, 'A3', 'letters until the user changes it')
  await settings.setNoteNames('solfege')
  assert.equal(editor.selectedNoteName.value, 'La3')
  editor.select(c5!)
  assert.equal(editor.selectedNoteName.value, 'Do5')
  await settings.setNoteNames('letters')
  assert.equal(editor.selectedNoteName.value, 'C5')
})

// ---- edits ---------------------------------------------------------------------------------

test('edits: a pitch step with undo and redo; the score signal follows, and undoing every edit is clean again', async () => {
  const { editor } = await setup()
  const scores: Score[] = []
  const stop = effect(() => {
    scores.push(editor.score.value)
  })
  const [, c5] = idsOf(editor, 1)
  editor.select(c5!)
  assert.deepEqual([editor.canUndo.value, editor.canRedo.value, editor.dirty.value], [false, false, false])

  editor.apply((s) => stepPitch(s, c5!, -1))
  assert.equal(editor.selectedNote.value!.pitch!.step, 'B', 'C5 stepped down once is B4')
  assert.deepEqual([editor.canUndo.value, editor.canRedo.value, editor.dirty.value], [true, false, true])

  assert.equal(editor.undo(), true)
  assert.equal(editor.selectedNote.value!.pitch!.step, 'C')
  assert.deepEqual([editor.canUndo.value, editor.canRedo.value, editor.dirty.value], [false, true, false], 'back to the saved score: clean')
  assert.equal(editor.redo(), true)
  assert.equal(editor.selectedNote.value!.pitch!.step, 'B')
  assert.equal(editor.dirty.value, true)
  assert.equal(editor.redo(), false)
  assert.equal(scores.length, 4, 'the score signal changed with each edit, undo and redo')
  stop()

  // an edit that throws changes nothing and leaves no undo step
  assert.throws(() => editor.apply(() => {
    throw new Error('not allowed')
  }), /not allowed/)
  assert.equal(editor.undo(), true)
  assert.equal(editor.canUndo.value, false)
})

test('edits: the current bar\'s bar lines follow the current bar, every edit, undo and redo (change edit-bar-lines)', async () => {
  const { editor } = await setup()
  assert.equal(editor.currentBar.value, 1, 'nothing selected, bar 1 current')
  assert.deepEqual(editor.barLines.value, { start: 'normal', end: 'normal', times: 2 }, 'with nothing selected, the current bar\'s')
  editor.selectBar(2)
  assert.deepEqual(editor.barLines.value, { start: 'normal', end: 'normal', times: 2 }, 'a bar without a note')
  editor.apply((s) => setBarStart(s, 1, 'repeat'))
  editor.apply((s) => setBarEnd(s, 1, 'repeat'))
  editor.apply((s) => setRepeatTimes(s, 1, 3))
  assert.deepEqual(editor.barLines.value, { start: 'repeat', end: 'repeat', times: 3 })
  editor.undo()
  assert.deepEqual(editor.barLines.value, { start: 'repeat', end: 'repeat', times: 2 })
  editor.undo()
  assert.deepEqual(editor.barLines.value, { start: 'repeat', end: 'normal', times: 2 })
  editor.redo()
  assert.equal(editor.barLines.value!.end, 'repeat')
  const [g5] = idsOf(editor, 2)
  editor.selectBar(1)
  assert.equal(editor.barLines.value!.start, 'normal', 'another bar')
  editor.select(g5!)
  assert.equal(editor.barLines.value!.start, 'repeat', 'a note in the bar makes it current too')
  editor.clearSelection()
  assert.deepEqual(editor.barLines.value, { start: 'repeat', end: 'repeat', times: 2 }, 'nothing selected: still the current bar\'s')
})

test('selection: an element other than a note is selected with its bar, follows edits, goes when deleted, and comes back on undo (change select-and-delete-elements)', async () => {
  const { editor } = await setup()
  const [first, second] = idsOf(editor, 2)
  editor.apply((s) => addSlur(s, first!, second!))
  const slur = { kind: 'slur', noteId: first!, number: 1 } as const
  assert.equal(editor.selectElement({ kind: 'dynamic', id: 'nope' }), false, 'not in the score: nothing changes')
  assert.equal(editor.selection.value, null)
  assert.ok(editor.selectElement(slur))
  assert.deepEqual(editor.selection.value, { bar: 2, noteId: null }, 'its bar is selected, no note')
  assert.deepEqual(editor.selectedElement.value, { ref: slur, info: { kind: 'slur', bar: 1, deletable: true, part: 'P1', staff: 0 } })
  assert.equal(editor.selectedNote.value, undefined)

  // An edit elsewhere keeps it; deleting it leaves its bar selected; undo selects it again.
  editor.apply((s) => toggleStaccato(s, idsOf(editor, 1)[0]!))
  assert.deepEqual(editor.selectedElement.value?.ref, slur)
  editor.apply((s) => deleteElement(s, slur))
  assert.equal(editor.selectedElement.value, undefined, 'gone with the slur')
  assert.deepEqual(editor.selection.value, { bar: 2, noteId: null })
  editor.undo()
  assert.deepEqual(editor.selectedElement.value?.ref, slur, 'undo brings the slur and its selection back')
  editor.redo()
  assert.equal(editor.selectedElement.value, undefined)

  // While it is gone, the next edit forgets it: adding a slur there again does not select it.
  editor.apply((s) => addSlur(s, first!, second!))
  assert.equal(editor.selectedElement.value, undefined)

  // Selecting a note or a bar replaces it; a bar line selects its bar.
  assert.ok(editor.selectElement(slur))
  editor.select(second!)
  assert.equal(editor.selectedElement.value, undefined)
  assert.ok(editor.selectElement(slur))
  editor.selectBar(1)
  assert.equal(editor.selectedElement.value, undefined)
  assert.ok(editor.selectElement({ kind: 'barline', bar: 3 }))
  assert.deepEqual(editor.selection.value, { bar: 4, noteId: null })
  assert.equal(editor.selectedElement.value, undefined, 'a bar line is its bar, not an element')
  assert.ok(editor.selectElement({ kind: 'clef', bar: 0 }))
  assert.equal(editor.selectedElement.value?.info.deletable, false, 'the first clef')
  editor.clearSelection()
  assert.equal(editor.selectedElement.value, undefined)
})

test('edits: a note inserted or deleted is selected the way the edit says; undoing an insert leaves its bar selected', async () => {
  const { editor } = await setup()
  const [e5, e5b] = idsOf(editor, 3)
  editor.select(e5b!)
  const inserted = editor.apply((s) => insertNote(s, e5b!, 'after', 'rest'))
  assert.deepEqual(editor.selection.value, { bar: 3, noteId: inserted })
  assert.equal(editor.selectedNote.value!.rest, true)

  editor.undo()
  assert.deepEqual(editor.selection.value, { bar: 3, noteId: null }, 'the rest is gone; its bar stays selected')

  editor.select(e5!)
  const next = editor.apply((s) => deleteNote(s, e5!))
  assert.equal(next, e5b)
  assert.deepEqual(editor.selection.value, { bar: 3, noteId: e5b })
})

// ---- warnings ------------------------------------------------------------------------------

test('warnings: counted live for the instrument in use, stepped through in score order, and gone when fixed', async () => {
  const { editor, settings, i18n } = await setup()
  const kinds = (): string[] => editor.warnings.value.map((w) => `${w.kind}@${w.bar}`)
  assert.deepEqual(kinds(), ['out-of-range@1', 'bar-length@3'])
  assert.equal(i18n.t('editor.check.next', { count: editor.warningCount.value }), '2 to check · Next')
  assert.equal(editor.instrument.value.id, 'tenor-sax')

  // stepping: the A3, then bar 3, then round again
  const [a3] = idsOf(editor, 1)
  assert.equal(editor.nextWarning()!.kind, 'out-of-range')
  assert.deepEqual(editor.selection.value, { bar: 1, noteId: a3 })
  assert.equal(editor.nextWarning()!.kind, 'bar-length')
  assert.deepEqual(editor.selection.value, { bar: 3, noteId: null })
  assert.equal(editor.currentWarning.value!.kind, 'bar-length')
  assert.equal(i18n.warning(editor.currentWarning.value!), 'Bar 3 adds up to 2 beats but 3/4 needs 3.')
  assert.equal(editor.nextWarning()!.kind, 'out-of-range', 'wraps round')
  assert.equal(editor.previousWarning()!.kind, 'bar-length')

  // fixing the A3 (one step up is B3, inside the range) clears its warning and the count goes down by one
  editor.apply((s) => stepPitch(s, a3!, 1))
  assert.deepEqual(kinds(), ['bar-length@3'])
  assert.equal(editor.warningCount.value, 1)
  editor.undo()
  assert.deepEqual(kinds(), ['out-of-range@1', 'bar-length@3'], 'undo brings it back')

  // the instrument decides the range: on the piano the A3 is fine
  await settings.setDefaultInstrument('piano')
  assert.deepEqual(kinds(), ['bar-length@3'])
  await settings.setDefaultInstrument('tenor-sax')

  // making bar 3's last note a half note fixes the bar
  const [, e5b] = idsOf(editor, 3)
  editor.apply((s) => setDuration(s, e5b!, { type: 'half', dots: 0, triplet: false }))
  assert.deepEqual(kinds(), ['out-of-range@1'])
  // a note selected before a warning: its own warning is the next one
  editor.select(a3!)
  assert.equal(editor.nextWarning()!.noteId, a3)
})

test('warnings: none to check, nothing to step to', async () => {
  const { editor } = await setup()
  const [a3] = idsOf(editor, 1)
  const [, e5b] = idsOf(editor, 3)
  editor.apply((s) => stepPitch(s, a3!, 1))
  editor.apply((s) => setDuration(s, e5b!, { type: 'half', dots: 0, triplet: false }))
  assert.deepEqual(editor.warnings.value, [])
  assert.equal(editor.nextWarning(), undefined)
  assert.equal(editor.currentWarning.value, undefined)
})

// ---- dirty and leaving ---------------------------------------------------------------------

test('leaving: back with nothing to lose leaves at once; with edits it asks, stays on "keep editing" and leaves on "discard"', async () => {
  const s = await setup()
  const { editor, router } = s
  assert.equal(router.screen.value.name, 'editor')

  editor.apply((score) => stepPitch(score, idsOf(editor, 1)[0]!, 1))
  assert.equal(editor.dirty.value, true)
  router.back()
  const dialog = router.overlays.value.at(-1)
  assert.equal(dialog?.kind, 'dialog')
  assert.deepEqual(dialog?.kind === 'dialog' ? dialog.options : undefined, {
    title: 'Discard your edits?',
    message: 'You have edits that are not saved. If you leave now, they are lost.',
    confirmLabel: 'Discard',
    cancelLabel: 'Keep editing',
    destructive: true,
  })
  router.answerDialog(false)
  await settle()
  assert.equal(router.screen.value.name, 'editor', 'the editor stays open')

  router.back()
  router.answerDialog(true)
  await settle()
  assert.equal(router.screen.value.name, 'library')
  assert.equal((await s.library.load('piece-1')).info.score, 'score-1.musicxml', 'nothing was saved')

  // a clean editor leaves without asking; with "Full score" shown, back first closes it (change redesign-score-editor, D1)
  router.push({ name: 'editor', pieceId: 'piece-1' })
  const clean = await openEditor(s.deps, 'piece-1')
  clean.openFullScore()
  clean.goToBar(2)
  router.back()
  assert.deepEqual([router.screen.value.name, clean.fullScore.value, clean.currentBar.value, router.overlays.value.length], ['editor', false, 2, 0], 'back closes the full score and keeps the bar')
  router.back()
  assert.equal(router.overlays.value.length, 0)
  assert.equal(router.screen.value.name, 'library')
  clean.close()

  // a title change alone is an unsaved edit too
  router.push({ name: 'editor', pieceId: 'piece-1' })
  const titled = await openEditor(s.deps, 'piece-1')
  titled.setTitle('Ode to Joy')
  assert.equal(titled.dirty.value, true)
  titled.setTitle('  18 Nov, 14:05 ')
  assert.equal(titled.dirty.value, false, 'the same name with spaces around it is not a change')
})

// ---- saving --------------------------------------------------------------------------------

test('save & practice: writes the corrected score, keeps the raw readings, opens practice, and the editor is clean', async () => {
  const s = await setup()
  const { editor, router, library, platform } = s
  const readings = [platform.files.text('pieces/piece-1/pages/1/recognised.musicxml'), platform.files.text('pieces/piece-1/pages/2/recognised.musicxml')]
  const [, c5] = idsOf(editor, 1)
  editor.apply((score) => stepPitch(score, c5!, -1))

  const result = await editor.saveAndPractice()
  assert.equal(result.ok, true)
  assert.deepEqual(router.screen.value, { name: 'practice', pieceId: 'piece-1' }, 'practice takes the editor’s place')
  assert.deepEqual(router.stack.value.map((x) => x.name), ['library', 'practice'])
  assert.equal(editor.dirty.value, false)

  const saved = await library.load('piece-1')
  assert.equal(saved.info.score, 'score-2.musicxml')
  assert.equal(result.ok && result.info.score, 'score-2.musicxml')
  const note = notesOf(firstLine(parseMusicXml(saved.musicxml)).measures[0]!).find((n) => n.id === c5)!
  assert.deepEqual(note.pitch, { step: 'B', octave: 4 }, 'the piece opens with the correction')
  assert.deepEqual([platform.files.text('pieces/piece-1/pages/1/recognised.musicxml'), platform.files.text('pieces/piece-1/pages/2/recognised.musicxml')], readings)
  assert.equal(saved.info.name, '18 Nov, 14:05')

  // saving twice in a row: the second is based on the first
  editor.apply((score) => stepPitch(score, c5!, -1))
  assert.equal((await editor.save()).ok, true)
  assert.equal((await library.info('piece-1')).score, 'score-3.musicxml')
  // nothing changed: nothing is written
  assert.equal((await editor.save()).ok, true)
  assert.equal((await library.info('piece-1')).score, 'score-3.musicxml')
})

test('save & practice from an editor opened over practice goes back to a new practice screen of that piece (design D12)', async () => {
  const s = await setup()
  const { editor, router } = s
  // The setup pushed the editor over the library. Put the practice screen between them, as the tools sheet does.
  editor.close()
  router.pop()
  router.push({ name: 'practice', pieceId: 'piece-1', autoplay: true })
  router.push({ name: 'editor', pieceId: 'piece-1' })
  const over = await openEditor(s.deps, 'piece-1')
  assert.deepEqual(router.stack.value.map((x) => x.name), ['library', 'practice', 'editor'])

  over.apply((score) => stepPitch(score, idsOf(over, 1)[1]!, -1))
  assert.equal((await over.saveAndPractice()).ok, true)
  assert.deepEqual(router.stack.value.map((x) => x.name), ['library', 'practice'], 'the editor is gone and the practice screen is not there twice')
  assert.deepEqual(router.screen.value, { name: 'practice', pieceId: 'piece-1' }, 'a new practice screen: it does not start playing again')

  // Over the practice screen of another piece (or over anything else) it replaces the editor.
  router.pop()
  router.push({ name: 'practice', pieceId: 'piece-2' })
  router.push({ name: 'editor', pieceId: 'piece-1' })
  const stranger = await openEditor(s.deps, 'piece-1')
  assert.equal((await stranger.saveAndPractice()).ok, true)
  assert.deepEqual(router.stack.value.map((x) => x.name), ['library', 'practice', 'practice'])
  assert.deepEqual(router.stack.value.map((x) => ('pieceId' in x ? x.pieceId : null)), [null, 'piece-2', 'piece-1'])
})

test('rename: the title is saved as the name; an empty one is refused and nothing is written', async () => {
  const { editor, library } = await setup()
  editor.setTitle('   ')
  assert.deepEqual(await editor.save(), { ok: false, reason: 'empty-name' })
  assert.equal((await library.info('piece-1')).name, '18 Nov, 14:05')

  editor.setTitle('  Ode to Joy ')
  const result = await editor.save()
  assert.equal(result.ok, true)
  assert.equal(editor.title.value, 'Ode to Joy')
  assert.equal(editor.dirty.value, false)
  assert.deepEqual((await library.list()).pieces.map((p) => p.name), ['Ode to Joy'])
  assert.equal((await library.info('piece-1')).score, 'score-1.musicxml', 'a rename alone does not write the score')
})

test('naming: a new piece asks for its name until the title is typed, a save succeeds or the editor closes; an existing piece does not ask', async () => {
  const existing = await setup()
  assert.equal(existing.editor.naming.value, false, 'opened from practice or the library: not asked again')

  const typed = await setup({ isNew: true })
  assert.equal(typed.editor.naming.value, true)
  typed.editor.setTitle('Ode to Joy')
  assert.equal(typed.editor.naming.value, false, 'typing a title ends it')

  const saved = await setup({ isNew: true })
  saved.editor.apply((score) => stepPitch(score, idsOf(saved.editor, 1)[1]!, -1))
  assert.equal(saved.editor.naming.value, true, 'an edit to the notes leaves it on')
  const result = await saved.editor.save()
  assert.equal(result.ok, true)
  assert.equal(saved.editor.naming.value, false, 'a save ends it')
  assert.equal((await saved.library.info('piece-1')).name, '18 Nov, 14:05', 'an untouched date name saves as it is')

  const emptied = await setup({ isNew: true })
  emptied.editor.setTitle('  ')
  assert.deepEqual(await emptied.editor.save(), { ok: false, reason: 'empty-name' }, 'an empty title is still refused')
  assert.equal((await emptied.library.info('piece-1')).name, '18 Nov, 14:05')

  const closed = await setup({ isNew: true })
  closed.editor.close()
  assert.equal(closed.editor.naming.value, false, 'leaving ends it')
})

test('save: a piece saved elsewhere since it was opened is a conflict, and the edits stay', async () => {
  const { editor, library } = await setup()
  editor.apply((score) => stepPitch(score, idsOf(editor, 1)[1]!, -1))
  const elsewhere = await library.load('piece-1')
  await library.writeScore('piece-1', elsewhere.musicxml, elsewhere.info.score)
  const result = await editor.save()
  assert.equal(result.ok, false)
  assert.equal(!result.ok && result.reason, 'conflict')
  assert.equal(editor.dirty.value, true, 'the edits are still here')
  assert.equal((await library.info('piece-1')).score, 'score-2.musicxml')
})

test('save: a disk that is full keeps the edits, and the next save goes through', async () => {
  const { editor, library, platform } = await setup()
  editor.apply((score) => stepPitch(score, idsOf(editor, 1)[1]!, -1))
  platform.files.fault = (operation) => {
    if (operation === 'write') throw new Error('disk full')
  }
  const result = await editor.save()
  platform.files.fault = undefined
  assert.equal(!result.ok && result.reason, 'failed')
  assert.equal(editor.dirty.value, true)
  assert.equal((await editor.save()).ok, true)
  assert.equal((await library.info('piece-1')).score, 'score-2.musicxml')
})

// ---- preview -------------------------------------------------------------------------------

test('preview: only the current bar plays, with the correction, at the practice tempo and with the instrument in use', async () => {
  const { editor, played } = await setup({ practiceTempo: 66 })
  // There is always a current bar (change redesign-score-editor, D1): with nothing selected, that bar is previewed.
  assert.equal(editor.selection.value, null)
  assert.equal(editor.barPreview()?.bar, editor.currentBar.value, 'nothing selected: the current bar')
  editor.goToBar(2)
  assert.equal(editor.barPreview()?.bar, 2)
  assert.equal(played.length, 0)

  const [e5] = idsOf(editor, 3)
  editor.select(e5!)
  editor.apply((score) => stepPitch(score, e5!, -1)) // E5 -> D5
  const preview = editor.barPreview()!
  assert.equal(preview.bar, 3)
  assert.equal(preview.bpm, 66, 'the tempo the user practises at')
  assert.equal(preview.instrument.id, 'tenor-sax')
  assert.equal(firstLine(preview.score).measures.length, 1)
  assert.deepEqual(firstLine(preview.score).measures[0]!.time, { beats: 3, beatType: 4 }, 'the time in force at bar 3')
  assert.equal(firstLine(preview.score).measures[0]!.clef?.sign, 'G')
  assert.deepEqual(notesOf(firstLine(preview.score).measures[0]!).map((n) => n.pitch!.step), ['D', 'E'])

  assert.equal(editor.previewing.value, false)
  await editor.previewBar()
  // the corrected D5 starts it, sounding a major ninth lower on the tenor saxophone (the fake timer
  // never fires, so only the first note is scheduled)
  assert.deepEqual(played[0]!.midi, [60])
  assert.equal(editor.previewing.value, true, 'the button can say Stop while it plays')
  editor.stopPreview()
  assert.equal(editor.previewing.value, false)
  editor.close()
})

test('preview: without a practice tempo the score decides; the excerpt drops repeats and leaves the score as it was', async () => {
  const { editor } = await setup()
  editor.selectBar(1)
  assert.equal(editor.barPreview()!.bpm, 80, 'no tempo marking: the default')
  const s = parseMusicXml(PAGE_1)
  setAttr(s, 1, 'rightBarline', { repeat: 'backward' })
  const before = structuredClone(s)
  const excerpt = barExcerpt(s, 1)
  assert.equal(firstLine(excerpt).measures[0]!.rightBarline, undefined)
  assert.deepEqual(firstLine(excerpt).measures[0]!.time, { beats: 3, beatType: 4 })
  assert.deepEqual(s, before)
  assert.deepEqual(barExcerpt(s, 9).bars, [], 'no bar 10: a score without bars')
})

test('bar for editing: the bar keeps its own bar lines and ending, and leaves out the hairpin, slur and tie into the next bar', () => {
  // 4/4: bar 1 G G G E, bar 2 E E E E, bar 3 E F F F; bar 2 is a first ending that ends with a backward repeat.
  const s = parseMusicXml(score([quarters(3) + quarters(1, 'E'), quarters(4, 'E'), quarters(1, 'E') + quarters(3, 'F')], [4, 4]))
  const ids = firstLine(s).measures.map((m) => notesOf(m).map((n) => n.id))
  const [b1, b2, b3] = [ids[0]!, ids[1]!, ids[2]!]
  setAttr(s, 1, 'leftBarline', { ending: { number: '1', type: 'start' } })
  setAttr(s, 1, 'rightBarline', { repeat: 'backward', ending: { number: '1', type: 'stop' } })
  addSlur(s, b2[0]!, b2[1]!) // inside the bar
  addSlur(s, b2[2]!, b3[1]!) // into the next bar
  addSlur(s, b1[1]!, b2[0]!) // from the bar before
  addWedge(s, 'crescendo', b2[0]!, b2[2]!) // inside the bar
  addWedge(s, 'diminuendo', b2[3]!, b3[2]!) // into the next bar
  addTie(s, b1[3]!, b2[0]!) // from the bar before
  addTie(s, b2[3]!, b3[0]!) // into the next bar
  addTie(s, b2[1]!, b2[2]!) // inside the bar
  const before = structuredClone(s)

  const excerpt = barForEditing(s, 1)
  assert.equal(excerpt.bars.length, 1)
  const bar = firstLine(excerpt).measures[0]!
  assert.deepEqual(bar.leftBarline, { ending: { number: '1', type: 'start' } }, 'the ending starts here')
  assert.deepEqual(bar.rightBarline, { repeat: 'backward', ending: { number: '1', type: 'stop' } }, 'the repeat and the end of the ending')
  assert.deepEqual(bar.time, { beats: 4, beatType: 4 }, 'the time in force')
  assert.deepEqual(bar.clef, { sign: 'G', line: 2 }, 'the clef in force')
  const notes = notesOf(bar)
  assert.deepEqual(notes.map((n) => n.id), b2)
  assert.deepEqual(notes.map((n) => n.slurs.map((m) => m.type)), [['start'], ['stop'], [], []], 'only the slur inside the bar')
  assert.deepEqual(notes.map((n) => [!!n.tieStart, !!n.tieStop]), [[false, false], [true, false], [false, true], [false, false]], 'only the tie inside the bar')
  assert.deepEqual(bar.items.filter(isWedge).map((w) => [w.type, w.start, w.stop]), [['crescendo', b2[0], b2[2]]], 'only the hairpin inside the bar')
  assert.deepEqual(s, before, 'the score is unchanged')

  // The preview's excerpt of the same bar has no bar lines, as before.
  const preview = firstLine(barExcerpt(s, 1)).measures[0]!
  assert.equal(preview.leftBarline, undefined)
  assert.equal(preview.rightBarline, undefined)
  assert.deepEqual(barForEditing(s, 9).bars, [], 'no bar 10: a score without bars')
})

test('bar for editing: every staff of a piano piece, each with its clef in force', () => {
  const s = parseMusicXml(read(MELODY_PIANO_FIXTURE))
  const left = { part: 'P2', staff: 1, voice: 0 }
  const bar = voiceView(barForEditing(s, 2), left).measures[0]!
  assert.deepEqual(bar.clef, { sign: 'F', line: 4 })
  assert.deepEqual(notesOf(bar).map((n) => n.id), notesOf(voiceView(s, left).measures[2]!).map((n) => n.id))
})

// ---- your part (change parts-and-accompaniment, task 7.1) -------------------------------------

/** A melody-and-piano piece in the library, with what practice.json remembers of your part, opened in the editor. */
async function setupMelodyPiano(part?: { id: string; hand?: 'right' | 'left' }) {
  const platform = createFakePlatform()
  const library = createLibrary(platform.files, { newId: () => 'piece-1' })
  const settings = await loadSettings(platform.files)
  const router = createRouter('library')
  platform.files.seed('scans/1/page-1.jpg', Uint8Array.of(1))
  const page = read(MELODY_PIANO_FIXTURE)
  const prepared = preparePages([page])
  await library.create({
    name: 'Melody and piano',
    musicxml: prepared.musicxml,
    bars: prepared.bars,
    repairs: prepared.repairs,
    pages: [{ source: 'scans/1/page-1.jpg', recognised: page, ...prepared.pages[0]! }],
  })
  if (part) await library.writePractice('piece-1', { ...DEFAULT_PRACTICE, part })
  router.push({ name: 'editor', pieceId: 'piece-1' })
  const deps: EditorDeps = { library, settings, router, i18n: createI18n() }
  const editor = await openEditor(deps, 'piece-1')
  const stored = async (): Promise<string> => (await library.load('piece-1')).musicxml
  return { editor, stored }
}

/** The id of the `k`th shown note (from 0, chord notes counted) of a voice in a bar (from 1) of the editor's score. */
const noteAt = (editor: EditorSession, ref: { part: string; staff: number; voice: number }, bar: number, k: number): string =>
  notesOf(voiceView(editor.score.value, ref).measures[bar - 1]!).filter((n) => !n.hidden)[k]!.id
const LH = { part: 'P2', staff: 1, voice: 0 }
const LH2 = { part: 'P2', staff: 1, voice: 1 }
const RH = { part: 'P2', staff: 0, voice: 0 }

const partXml = (xml: string, id: string): string => new RegExp(`<part id="${id}">[\\s\\S]*?</part>`).exec(xml)![0]

test('your part: editing a note of the melody and saving leaves the piano part as it was in the stored MusicXML', async () => {
  const { editor, stored } = await setupMelodyPiano()
  assert.equal(editor.part.value, 'P1')
  const before = partXml(serializeMusicXml(parseMusicXml(await stored())), 'P2')
  const [first] = voiceView(editor.score.value, { part: 'P1', staff: 0, voice: 0 }).measures[0]!.items.filter((i) => 'pitch' in i)
  editor.select((first as { id: string }).id)
  editor.apply((s) => stepPitch(s, (first as { id: string }).id, 1))
  assert.equal((await editor.save()).ok, true)
  const after = await stored()
  assert.equal(partXml(after, 'P2'), before, 'the piano part is byte-identical')
  assert.notEqual(partXml(after, 'P1'), partXml(serializeMusicXml(parseMusicXml(read(MELODY_PIANO_FIXTURE))), 'P1'))
  assert.match(partXml(after, 'P1'), /<step>A<\/step>\s*<octave>4<\/octave>[\s\S]*?<step>A<\/step>\s*<octave>4<\/octave>/, 'the melody changed: the first G4 is A4 now')
  editor.close()
})

test('edit parts: the editor opens on your part, the piano, and draws it whole; a key change goes on it only', async () => {
  const { editor } = await setupMelodyPiano({ id: 'P2', hand: 'left' })
  assert.equal(editor.part.value, 'P2', 'open on the piano part when it is your part')
  assert.deepEqual(editor.drawn.value, { id: 'P2' }, 'both hands are drawn, whichever one you play')
  // Any note of the part can be selected: the right hand, the left hand, its second voice.
  for (const id of [noteAt(editor, RH, 1, 0), noteAt(editor, LH, 3, 0), noteAt(editor, LH2, 3, 0)]) assert.equal(editor.select(id), true, id)
  editor.apply((s) => setKey(s, editor.part.value, 2))
  const score = editor.score.value
  assert.equal(score.bars[0]!.parts[1]!.key?.fifths, 2, 'the key is on P2')
  assert.equal(score.bars[0]!.parts[0]!.key?.fifths, 0, 'the melody keeps its key')
  editor.apply((s) => setClef(s, { part: 'P2', staff: 1 }, 0, { sign: 'G', line: 2 }))
  assert.equal(editor.score.value.bars[0]!.parts[1]!.staves[1]!.clef?.sign, 'G', 'the clef is on the left-hand staff')
  assert.equal(editor.score.value.bars[0]!.parts[1]!.staves[0]!.clef?.sign, 'G')
  assert.equal(editor.score.value.bars[0]!.parts[0]!.staves[0]!.clef?.sign, 'G')
  editor.close()
})

test('edit parts: switching part clears the selection, and an undo switches to the part it changes (spec "Edit any part")', async () => {
  const { editor } = await setupMelodyPiano()
  assert.equal(editor.part.value, 'P1')
  // Edit the melody, switch to the piano, undo: the session is on the melody again, with the edit undone.
  const g4 = noteAt(editor, { part: 'P1', staff: 0, voice: 0 }, 1, 0)
  assert.ok(editor.select(g4))
  editor.apply((s) => stepPitch(s, g4, 1))
  assert.ok(editor.setPart('P2'))
  assert.equal(editor.part.value, 'P2')
  assert.equal(editor.selection.value, null, 'switching clears the selection')
  assert.deepEqual(editor.drawn.value, { id: 'P2' })
  assert.ok(editor.undo())
  assert.equal(editor.part.value, 'P1', 'on the melody again')
  assert.equal(voiceView(editor.score.value, { part: 'P1', staff: 0, voice: 0 }).measures[0]!.items.filter((i) => 'pitch' in i).map((n) => (n as { pitch: { step: string } }).pitch.step)[0], 'G', 'the edit is undone')
  // Redo of it from the piano goes back to the melody too.
  editor.setPart('P2')
  assert.ok(editor.redo())
  assert.equal(editor.part.value, 'P1')
  // An edit of the whole piece (a bar line) keeps the part shown when it is undone.
  editor.setPart('P2')
  editor.apply((s) => setBarEnd(s, 0, 'double'))
  assert.ok(editor.undo())
  assert.equal(editor.part.value, 'P2')
  assert.equal(editor.setPart('P9'), false)
  assert.equal(editor.part.value, 'P2')
  editor.close()
})

test('your part: an unknown part is the first part', async () => {
  const { editor } = await setupMelodyPiano({ id: 'P9' })
  assert.equal(editor.part.value, 'P1')
  editor.close()
})

test('preview: the excerpt of a bar holds every part, each staff with its own clef, and each part with its name', () => {
  const s = parseMusicXml(read(MELODY_PIANO_FIXTURE))
  const left = { part: 'P2', staff: 1, voice: 0 }
  const excerpt = barExcerpt(s, 2)
  const bar = voiceView(excerpt, left).measures[0]!
  assert.deepEqual(bar.clef, { sign: 'F', line: 4 }, 'the bass clef of the left hand, not the melody\'s treble clef')
  assert.deepEqual(bar.time, { beats: 4, beatType: 4 })
  assert.deepEqual(notesOf(bar).map((n) => n.pitch?.step), notesOf(voiceView(s, left).measures[2]!).map((n) => n.pitch?.step))
  assert.deepEqual(excerpt.parts.map((p) => p.name), ['Melody', 'Piano'])
  assert.equal(excerpt.bars.length, 1)
  assert.deepEqual(notesOf(voiceView(excerpt, { part: 'P1', staff: 0, voice: 0 }).measures[0]!).map((n) => n.id), ['n8', 'n9', 'n10'], 'the melody is there too')
})

test('edit parts: the label says where the selected note is (spec "Select a chord note")', async () => {
  const { editor } = await setupMelodyPiano({ id: 'P2' })
  // A three-note chord in the left hand of bar 5: C3, then E3 and G3 added above it.
  const c3 = noteAt(editor, LH, 5, 0)
  const e3 = editor.apply((s) => addChordNote(s, c3))
  const g3 = editor.apply((s) => addChordNote(s, c3))
  assert.ok(editor.select(e3))
  assert.equal(editor.selectionLabel.value, 'Bar 5 · Left hand · Chord, note 2 of 3')
  assert.ok(editor.select(g3))
  assert.equal(editor.selectionLabel.value, 'Bar 5 · Left hand · Chord, note 3 of 3')
  assert.ok(editor.select(noteAt(editor, LH, 5, 3)))
  assert.equal(editor.selectionLabel.value, 'Bar 5 · Left hand · Note 2', 'a chord counts once among the notes of the bar')
  // Bar 3 of the left hand has two voices: the voice is named.
  assert.ok(editor.select(noteAt(editor, LH2, 3, 0)))
  assert.equal(editor.selectionLabel.value, 'Bar 3 · Left hand · Voice 2 · Note 1', 'the hidden rest before it is not counted')
  assert.ok(editor.select(noteAt(editor, LH, 3, 1)))
  assert.equal(editor.selectionLabel.value, 'Bar 3 · Left hand · Voice 1 · Note 2')
  // A second voice in the right hand of bar 7.
  const added = editor.apply((s) => {
    for (const bar of s.bars) bar.parts[1]!.staves[0]!.voices.push([])
    const note: MeasureItem = { kind: 'note', id: 'v2', pitch: { step: 'C', octave: 5 }, type: 'whole', dots: 0, duration: { n: 1, d: 1 }, slurs: [], tuplets: [] }
    s.bars[6]!.parts[1]!.staves[0]!.voices[1]!.push(note)
    return 'v2'
  })
  assert.ok(editor.select(added))
  assert.equal(editor.selectionLabel.value, 'Bar 7 · Right hand · Voice 2 · Note 1')
  editor.close()
})

test('edit parts: a one-line piece keeps its label, "Bar 2 · Note 3"', async () => {
  const { editor } = await setup()
  assert.ok(editor.select(idsOf(editor, 2)[2]!))
  assert.equal(editor.selectionLabel.value, 'Bar 2 · Note 3')
  assert.ok(editor.select(idsOf(editor, 1)[0]!))
  assert.equal(editor.selectionLabel.value, 'Bar 1 · Note 1')
  editor.close()
})

/** A melody-and-piano piece with what practice.json says plays along, opened in the editor, bar 3 selected. */
async function previewOf(practice: { part?: { id: string; hand?: 'right' | 'left' }; silent?: string[]; ownLine?: boolean }) {
  const platform = createFakePlatform()
  const library = createLibrary(platform.files, { newId: () => 'piece-1' })
  const settings = await loadSettings(platform.files)
  const router = createRouter('library')
  platform.files.seed('scans/1/page-1.jpg', Uint8Array.of(0xff, 0xd8, 0xff, 0xe0))
  const xml = read(MELODY_PIANO_FIXTURE)
  await library.create({ name: 'Duet', musicxml: xml, bars: 8, repairs: [], pages: [{ source: 'scans/1/page-1.jpg', recognised: xml, firstBar: 1, lastBar: 8 }] })
  await library.writePractice('piece-1', { ...DEFAULT_PRACTICE, ...practice })
  router.push({ name: 'editor', pieceId: 'piece-1' })
  const editor = await openEditor({ library, settings, router, i18n: createI18n() }, 'piece-1')
  assert.ok(editor.selectBar(3))
  return editor
}

test('edit parts: the preview plays a bar as practice does, every part that plays along (spec "Preview a bar")', async () => {
  // Both parts play in practice: bar 3 holds the melody's notes and the piano's.
  const both = await previewOf({ part: { id: 'P1' } })
  const heard = new Set(both.previewNotes())
  for (const id of ['n8', 'n9', 'n10']) assert.ok(heard.has(id), `the melody's ${id}`)
  for (const id of ['n35', 'n41', 'n44']) assert.ok(heard.has(id), `the piano's ${id}`)
  assert.equal(both.barPreview()!.score.parts.length, 2)
  both.close()
  // Your line off: the melody is left out, the piano still plays.
  const off = await previewOf({ part: { id: 'P1' }, ownLine: false })
  const without = new Set(off.previewNotes())
  for (const id of ['n8', 'n9', 'n10']) assert.ok(!without.has(id), `your ${id} is not heard`)
  assert.ok(without.has('n35'))
  off.close()
  // The piano switched off under "Plays along": only your melody.
  const alone = await previewOf({ part: { id: 'P1' }, silent: ['P2'] })
  assert.deepEqual(new Set(alone.previewNotes()), new Set(['n8', 'n9', 'n10']))
  alone.close()
})

// ---- bar lines added and removed (change edit-parts, D9, D10, task 5.2) ------------------------

/** Records every `writeScore` call of the library (its arguments) and lets it through. */
function spyOnWrites(library: EditorDeps['library']): unknown[][] {
  const calls: unknown[][] = []
  const real = library.writeScore.bind(library)
  library.writeScore = (...args: Parameters<typeof real>) => {
    calls.push(args)
    return real(...args)
  }
  return calls
}

test('bar lines: a bar line added and undone saves no bar map; one added and saved maps the bars, the pages and the lines of the photo', async () => {
  const { editor, library } = await setup()
  const calls = spyOnWrites(library)
  // Bar 2 is G5 G5 G5: a bar line before its second note, then undone; then a pitch, so there is something to save.
  editor.apply((s) => splitBar(s, idsOf(editor, 2)[1]!))
  assert.equal(editor.score.value.bars.length, 5)
  editor.undo()
  editor.apply((s) => stepPitch(s, idsOf(editor, 1)[1]!, -1))
  assert.equal((await editor.save()).ok, true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0]!.length, 3, 'no bar map: saving is as before')
  assert.equal((await library.info('piece-1')).bars, 4)

  editor.apply((s) => splitBar(s, idsOf(editor, 2)[1]!))
  const result = await editor.save()
  assert.equal(result.ok, true)
  assert.deepEqual(calls[1]![3], { bars: [{ first: 1, last: 1 }, { first: 2, last: 3 }, { first: 4, last: 4 }, { first: 5, last: 5 }], added: [] })
  const info = await library.info('piece-1')
  assert.equal(info.bars, 5)
  assert.deepEqual(info.pages.map((p) => [p.firstBar, p.lastBar, p.staves.map((s) => [s.firstBar, s.lastBar])]), [[1, 3, []], [4, 5, [[4, 4], [5, 5]]]])
  assert.equal(editor.dirty.value, false)
})

test('bar lines: a second save maps from the first save, and a retry after a failed rename does not map again', async () => {
  const { editor, library } = await setup()
  const calls = spyOnWrites(library)
  editor.apply((s) => splitBar(s, idsOf(editor, 2)[1]!))
  assert.equal((await editor.save()).ok, true)
  // Now a bar line in bar 1 (A3 C5 C5, before its second note): bar 1 of the saved piece becomes bars 1 and 2.
  editor.apply((s) => splitBar(s, idsOf(editor, 1)[1]!))
  editor.setTitle('Renamed')
  const realUpdate = library.update.bind(library)
  library.update = async () => {
    throw new Error('disk full')
  }
  const failed = await editor.save()
  assert.equal(!failed.ok && failed.reason, 'failed')
  assert.deepEqual(calls[1]![3], { bars: [{ first: 1, last: 2 }, { first: 3, last: 3 }, { first: 4, last: 4 }, { first: 5, last: 5 }, { first: 6, last: 6 }], added: [] }, 'from the piece as saved the first time')
  library.update = realUpdate
  assert.equal((await editor.save()).ok, true)
  assert.equal(calls.length, 2, 'the score was saved: the retry only renames')
  const info = await library.info('piece-1')
  assert.deepEqual([info.name, info.bars, info.pages.map((p) => [p.firstBar, p.lastBar])], ['Renamed', 6, [[1, 4], [5, 6]]])
})

test('bars: an added and a deleted bar save with their map; a second save maps from the first, where the added bar is deleted again', async () => {
  const { editor, library } = await setup()
  const calls = spyOnWrites(library)
  await library.writePractice('piece-1', { ...DEFAULT_PRACTICE, bar: 4, loop: { start: 4, end: 4 } })
  // A bar added after bar 2 (the end of page 1), and the old bar 4 (the second line of page 2) deleted.
  editor.apply((s) => addBar(s, 1, 'after'))
  editor.apply((s) => deleteBar(s, 4))
  assert.equal((await editor.save()).ok, true)
  assert.deepEqual(calls[0]![3], { bars: [{ first: 1, last: 1 }, { first: 2, last: 2 }, { first: 4, last: 4 }, null], added: [{ bar: 3, of: 2 }] })
  let info = await library.info('piece-1')
  assert.deepEqual([info.bars, info.pages.map((p) => [p.firstBar, p.lastBar, p.staves.map((s) => [s.firstBar, s.lastBar])])], [4, [[1, 3, []], [4, 4, [[4, 4]]]]])
  assert.deepEqual(await library.readPractice('piece-1'), { ...DEFAULT_PRACTICE, bar: 4, loop: null })

  editor.apply((s) => deleteBar(s, 2))
  assert.equal((await editor.save()).ok, true)
  assert.deepEqual(calls[1]![3], { bars: [{ first: 1, last: 1 }, { first: 2, last: 2 }, null, { first: 3, last: 3 }], added: [] }, 'the added bar, saved, is deleted')
  info = await library.info('piece-1')
  assert.deepEqual([info.bars, info.pages.map((p) => [p.firstBar, p.lastBar])], [3, [[1, 2], [3, 3]]])
})

// ---- bar numbers after added and deleted bars, through the session (change redesign-score-editor, D8, task 3.6) ---

const SIX_1 = score([quarters(3, 'C'), quarters(3, 'D'), quarters(3, 'E')], [3, 4])
const SIX_2 = score([quarters(3, 'F'), quarters(3, 'G'), quarters(3, 'A')])
type Line = { firstBar: number; lastBar: number }

/** A six-bar piece: page 1 is bars 1–3 in the lines 1 and 2–3, page 2 bars 4–6 in the lines [lines2]. */
async function setupSix(lines2: Line[] = [{ firstBar: 4, lastBar: 6 }]) {
  const platform = createFakePlatform()
  const library = createLibrary(platform.files, { newId: () => 'piece-1' })
  const settings = await loadSettings(platform.files)
  const router = createRouter('library')
  platform.files.seed('scans/1/page-1.jpg', Uint8Array.of(1))
  platform.files.seed('scans/1/page-2.jpg', Uint8Array.of(2))
  const prepared = preparePages([SIX_1, SIX_2])
  await library.create({
    name: 'Six bars',
    musicxml: prepared.musicxml,
    bars: prepared.bars,
    repairs: prepared.repairs,
    pages: [
      { source: 'scans/1/page-1.jpg', recognised: SIX_1, ...prepared.pages[0]!, staves: [{ box: BOX, firstBar: 1, lastBar: 1 }, { box: { ...BOX, y: 0.5 }, firstBar: 2, lastBar: 3 }] },
      { source: 'scans/1/page-2.jpg', recognised: SIX_2, ...prepared.pages[1]!, staves: lines2.map((line, k) => ({ box: { ...BOX, y: 0.1 + 0.4 * k }, ...line })) },
    ],
  })
  router.push({ name: 'editor', pieceId: 'piece-1' })
  const editor = await openEditor({ library, settings, router, i18n: createI18n() }, 'piece-1')
  /** Saves, and returns the pages with their lines as [first, last, lines], after checking the bar numbers hold. */
  const save = async () => {
    const result = await editor.save()
    assert.equal(result.ok, true, result.ok ? '' : String(result.error))
    const info = await library.info('piece-1')
    assert.deepEqual(barNumberProblems(info, await library.readPractice('piece-1')), [])
    assert.equal(info.bars, editor.score.value.bars.length)
    return [info.bars, info.pages.map((p) => [p.firstBar, p.lastBar, p.staves.map((s) => [s.firstBar, s.lastBar])])]
  }
  return { editor, library, settings, save }
}

test('bar numbers: a bar added between the halves of a split bar belongs to it (finding 3)', async () => {
  const { editor, save } = await setupSix()
  editor.apply((s) => splitBar(s, idsOf(editor, 2)[1]!))
  editor.apply((s) => addBar(s, 1, 'after'))
  assert.deepEqual(await save(), [8, [[1, 5, [[1, 1], [2, 5]]], [6, 8, [[6, 8]]]]], 'bar 2 is bars 2 to 4, with the added bar 3 between its halves')
})

test('bar numbers: two bars joined, saved, the join undone and a bar added after the first: the bar added lies inside the joined bar\'s range (finding 3)', async () => {
  const { editor, save } = await setupSix()
  editor.apply((s) => joinBars(s, 1))
  assert.deepEqual(await save(), [5, [[1, 2, [[1, 1], [2, 2]]], [3, 5, [[3, 5]]]]])
  editor.undo()
  editor.apply((s) => addBar(s, 1, 'after'))
  assert.deepEqual(await save(), [7, [[1, 4, [[1, 1], [2, 4]]], [5, 7, [[5, 7]]]]])
})

test('bar numbers: a deleted bar brought back by an undo after a save, and a bar added before it, join the line or page before it, without an overlap (findings 1, 2, 4)', async () => {
  // Finding 1: the first bar of line 2 deleted, saved, undone, a bar added before it: both go to line 1, and the lines do not overlap.
  let six = await setupSix()
  six.editor.apply((s) => deleteBar(s, 1))
  assert.deepEqual(await six.save(), [5, [[1, 2, [[1, 1], [2, 2]]], [3, 5, [[3, 5]]]]])
  six.editor.undo()
  six.editor.apply((s) => addBar(s, 1, 'before'))
  assert.deepEqual(await six.save(), [7, [[1, 4, [[1, 3], [4, 4]]], [5, 7, [[5, 7]]]]])
  // Finding 2: the same on the first bar of page 2: saved, not refused.
  six = await setupSix()
  six.editor.apply((s) => deleteBar(s, 3))
  assert.deepEqual(await six.save(), [5, [[1, 3, [[1, 1], [2, 3]]], [4, 5, [[4, 5]]]]])
  six.editor.undo()
  six.editor.apply((s) => addBar(s, 3, 'before'))
  assert.deepEqual(await six.save(), [7, [[1, 5, [[1, 1], [2, 5]]], [6, 7, [[6, 7]]]]])
  // Finding 4, a known limitation: `from` cannot say where a bar that is not in the saved score sat, so the restored first bar of page 2 lands on page 1.
  six = await setupSix()
  await six.library.writePractice('piece-1', { ...DEFAULT_PRACTICE, bar: 4, loop: { start: 4, end: 5 } })
  six.editor.apply((s) => deleteBar(s, 3))
  await six.save()
  assert.deepEqual(await six.library.readPractice('piece-1'), { ...DEFAULT_PRACTICE, bar: 4, loop: { start: 4, end: 4 } })
  six.editor.undo()
  assert.deepEqual(await six.save(), [6, [[1, 4, [[1, 1], [2, 4]]], [5, 6, [[5, 6]]]]])
  assert.deepEqual(await six.library.readPractice('piece-1'), { ...DEFAULT_PRACTICE, bar: 5, loop: { start: 5, end: 5 } })
  // What follows from it: the piece now counts bar 4 on page 1, so bars 4 and 5 joined would be a join across a page,
  // and the save is refused (the session will not offer it once it checks against the piece as last saved).
  six.editor.apply((s) => joinBars(s, 3))
  const across = await six.editor.save()
  assert.match(String(!across.ok && across.error), /two pages/)
  // Likewise, page 2 left with only the restored bar is a page left without bars.
  six = await setupSix()
  six.editor.apply((s) => deleteBar(s, 3))
  await six.save()
  six.editor.undo()
  six.editor.apply((s) => deleteBar(s, 5))
  six.editor.apply((s) => deleteBar(s, 4))
  const empty = await six.editor.save()
  assert.match(String(!empty.ok && empty.error), /page 2 would hold no bars/)
})

test('bar numbers: a line whose only bar is deleted keeps a bar added next to it, in one save or two (finding 6)', async () => {
  const lines: Line[] = [
    { firstBar: 4, lastBar: 5 },
    { firstBar: 6, lastBar: 6 },
  ]
  const one = await setupSix(lines)
  one.editor.apply((s) => addBar(s, 5, 'after'))
  one.editor.apply((s) => deleteBar(s, 5))
  const once = await one.save()
  assert.deepEqual(once, [6, [[1, 3, [[1, 1], [2, 3]]], [4, 6, [[4, 5], [6, 6]]]]])
  const two = await setupSix(lines)
  two.editor.apply((s) => addBar(s, 5, 'after'))
  await two.save()
  two.editor.apply((s) => deleteBar(s, 5))
  assert.deepEqual(await two.save(), once)
})

test('bar numbers: a position on a deleted bar moves to a bar added in its place, else to the bar that follows (finding 7)', async () => {
  const { editor, library, save } = await setupSix()
  await library.writePractice('piece-1', { ...DEFAULT_PRACTICE, bar: 4, loop: { start: 4, end: 4 } })
  editor.apply((s) => addBar(s, 3, 'before'))
  editor.apply((s) => deleteBar(s, 4))
  assert.deepEqual(await save(), [6, [[1, 3, [[1, 1], [2, 3]]], [4, 6, [[4, 6]]]]])
  assert.deepEqual(await library.readPractice('piece-1'), { ...DEFAULT_PRACTICE, bar: 4, loop: null })
  // Bar 5 deleted with nothing added: the position moves to the bar that follows.
  await library.writePractice('piece-1', { ...DEFAULT_PRACTICE, bar: 5 })
  editor.apply((s) => deleteBar(s, 4))
  await save()
  assert.equal((await library.readPractice('piece-1'))!.bar, 5)
})

test('bar numbers: a line whose last bar is deleted and whose neighbours are joined across it is dropped; across a page the save is refused (finding 5)', async () => {
  const lines: Line[] = [
    { firstBar: 4, lastBar: 5 },
    { firstBar: 6, lastBar: 6 },
  ]
  const { editor, save } = await setupSix([{ firstBar: 4, lastBar: 4 }, { firstBar: 5, lastBar: 5 }, { firstBar: 6, lastBar: 6 }])
  editor.apply((s) => deleteBar(s, 4))
  editor.apply((s) => joinBars(s, 3))
  assert.deepEqual(await save(), [4, [[1, 3, [[1, 1], [2, 3]]], [4, 4, [[4, 4]]]]], 'the joined bar holds bars 4 to 6: it is in the first line')
  const across = await setupSix(lines)
  across.editor.apply((s) => deleteBar(s, 2))
  across.editor.apply((s) => joinBars(s, 1))
  const refused = await across.editor.save()
  assert.equal(!refused.ok && refused.reason, 'failed')
  assert.match(String(!refused.ok && refused.error), /two pages/)
})

/** [list] with [count] items from [at] replaced by [items], as a copy. */
function spliced<T>(list: readonly T[], at: number, count: number, ...items: T[]): T[] {
  const copy = list.slice()
  copy.splice(at, count, ...items)
  return copy
}

/** A pseudo-random number generator with a fixed seed (a linear congruential one), so a failure can be run again. */
function seeded(seed: number): (n: number) => number {
  let state = seed >>> 0
  return (n) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return Math.floor((state / 2 ** 32) * n)
  }
}

test('bar numbers: short random sessions of the bar actions the session offers, with undo and redo, keep the pages, the lines and practice consistent, and no save is refused', async () => {
  const random = seeded(36)
  let saves = 0
  const counts = { added: 0, deleted: 0, split: 0, joined: 0, undone: 0, redone: 0, deleteNotOffered: 0, joinNotOffered: 0, checked: 0 }
  for (let run = 0; run < 300; run++) {
    const { editor, library } = await setupSix([
      { firstBar: 4, lastBar: 5 },
      { firstBar: 6, lastBar: 6 },
    ])
    // The page and line each bar was read on, and whether it is an added bar. Until an undo or a redo follows a save, what
    // the session offers must be exactly what they say (task 5.3): Delete where its page keeps a bar that was not added,
    // Join with next inside a line. After that, the session counts as the library does (design D8), and only the saves say.
    type Label = { page: number; line: number; added: boolean }
    let labels: Label[] = [0, 1, 1, 2, 2, 3].map((line) => ({ page: line < 2 ? 1 : 2, line, added: false }))
    const undone: Label[][] = []
    let redone: Label[][] = []
    const steps: string[] = []
    let exact = true
    let saved = false
    const edited = (name: string, next: Label[]): void => {
      undone.push(labels)
      redone = []
      labels = next
      steps.push(name)
    }
    for (let save = 0; save < 3; save++) {
      for (let op = random(6); op >= 0; op--) {
        const n = labels.length
        const i = random(n)
        const kind = random(6)
        const deletable = n > 1 && labels.some((l, j) => j !== i && l.page === labels[i]!.page && !l.added)
        const joinable = i + 1 < n && labels[i]!.line === labels[i + 1]!.line
        if (exact) {
          assert.equal(editor.canDeleteBarAt(i), deletable, `delete ${i + 1} after ${steps.join(', ')}`)
          assert.equal(editor.canRemoveBarLineAfter(i), joinable, `join ${i + 1} after ${steps.join(', ')}`)
          counts.checked++
        }
        if (kind === 0) {
          const side = random(2) === 0 ? 'before' : 'after'
          editor.goToBar(i + 1)
          assert.ok(editor.addBar(side))
          assert.equal(editor.currentBar.value, side === 'after' ? i + 2 : i + 1, 'the added bar is the current bar')
          edited(`add ${side} ${i + 1}`, spliced(labels, side === 'after' ? i + 1 : i, 0, { ...labels[i]!, added: true }))
          counts.added++
        } else if (kind === 1) {
          if (!editor.canDeleteBarAt(i)) {
            counts.deleteNotOffered++
            continue
          }
          editor.goToBar(i + 1)
          assert.ok(editor.deleteBar(), editor.message.value ?? '')
          edited(`delete ${i + 1}`, spliced(labels, i, 1))
          counts.deleted++
        } else if (kind === 2 && idsOf(editor, i + 1).length > 1 && editor.canAddBarLineBefore(idsOf(editor, i + 1)[1]!)) {
          assert.ok(editor.addBarLineBefore(idsOf(editor, i + 1)[1]!), editor.message.value ?? '')
          edited(`split ${i + 1}`, spliced(labels, i, 0, labels[i]!))
          counts.split++
        } else if (kind === 3) {
          if (!editor.canRemoveBarLineAfter(i)) {
            counts.joinNotOffered++
            continue
          }
          editor.goToBar(i + 1)
          assert.ok(editor.joinNext(), editor.message.value ?? '')
          edited(`join ${i + 1}`, spliced(labels, i, 2, { ...labels[i]!, added: labels[i]!.added && labels[i + 1]!.added }))
          counts.joined++
        } else if (kind === 4 && editor.undo()) {
          redone.push(labels)
          labels = undone.pop()!
          steps.push('undo')
          if (saved) exact = false
          counts.undone++
        } else if (kind === 5 && editor.redo()) {
          undone.push(labels)
          labels = redone.pop()!
          steps.push('redo')
          if (saved) exact = false
          counts.redone++
        }
        assert.equal(editor.barCount.value, labels.length, steps.join(', '))
        assert.ok(editor.currentBar.value >= 1 && editor.currentBar.value <= editor.barCount.value, `the current bar is in range: ${steps.join(', ')}`)
      }
      const old = (await library.info('piece-1')).bars
      const start = 1 + random(old)
      const end = start + random(old - start + 1)
      await library.writePractice('piece-1', { ...DEFAULT_PRACTICE, bar: 1 + random(old), loop: random(4) === 0 ? null : { start, end } })
      steps.push('save')
      const result = await editor.save()
      assert.ok(result.ok, `refused: ${String(!result.ok && result.error)} after ${steps.join(', ')}`)
      saved = true
      saves++
      const info = await library.info('piece-1')
      assert.deepEqual(barNumberProblems(info, await library.readPractice('piece-1')), [], steps.join(', '))
      assert.equal(info.bars, editor.score.value.bars.length, steps.join(', '))
    }
    editor.close()
  }
  assert.equal(saves, 900, 'every save went through')
  // Each kind of action ran, and each guard said no at least once.
  for (const [name, count] of Object.entries(counts)) assert.ok(count > 0, `${name}: ${count}`)
})

test('bar lines: "Bar line before" is not offered for the first note of a bar; "Remove bar line" not after the last bar or where a page or a line of the photo ends', async () => {
  const { editor } = await setup()
  const [first, second] = idsOf(editor, 2)
  assert.equal(editor.canAddBarLineBefore(first!), false, 'the first note of a bar')
  assert.equal(editor.canAddBarLineBefore(second!), true)
  assert.equal(editor.canAddBarLineBefore('no-such-note'), false)
  // Page 1 is bars 1–2; page 2 is bars 3–4 in two lines of the photo, bar 3 and bar 4.
  assert.deepEqual([0, 1, 2, 3, -1, 4].map((i) => editor.canRemoveBarLineAfter(i)), [true, false, false, false, false, false])
  // A bar line added in bar 2 and not saved: the bar line between its halves can go, the end of page 1 still cannot.
  editor.apply((s) => splitBar(s, second!))
  assert.deepEqual([0, 1, 2, 3, 4].map((i) => editor.canRemoveBarLineAfter(i)), [true, true, false, false, false])
  // Saved: page 1 is bars 1–3 now, and the same holds.
  assert.equal((await editor.save()).ok, true)
  assert.deepEqual([0, 1, 2, 3, 4].map((i) => editor.canRemoveBarLineAfter(i)), [true, true, false, false, false])
  // The two halves joined again (not saved): the bar line after them is the end of page 1.
  editor.apply((s) => joinBars(s, 1))
  assert.deepEqual([0, 1, 2, 3].map((i) => editor.canRemoveBarLineAfter(i)), [true, false, false, false])
  // Joined across the end of page 1 anyway (the edit itself does not know the pages): the save is refused as a failure, not as a name.
  editor.apply((s) => joinBars(s, 1))
  const refused = await editor.save()
  assert.equal(!refused.ok && refused.reason, 'failed')
  assert.equal(editor.dirty.value, true)
})

test('bar lines: a missed bar line in a bar that does not add up is split and saved with the right map', async () => {
  for (const [count, before] of [
    [6, 3],
    [8, 4],
  ] as const) {
    const { editor, library } = await setup()
    const calls = spyOnWrites(library)
    // Bar 2 of the 3/4 piece read with `count` quarter notes: a bar line was missed.
    for (let k = 3; k < count; k++) editor.apply((s) => insertNote(s, idsOf(editor, 2).at(-1)!, 'after', 'note'))
    assert.equal(idsOf(editor, 2).length, count)
    const note = idsOf(editor, 2)[before]!
    assert.ok(editor.canAddBarLineBefore(note))
    editor.apply((s) => splitBar(s, note))
    assert.deepEqual([idsOf(editor, 2).length, idsOf(editor, 3).length], [before, count - before])
    if (count === 6) assert.deepEqual(editor.warnings.value.filter((w) => w.kind === 'bar-length' && (w.bar === '2' || w.bar === '3')).map((w) => w.bar), [], 'neither half is marked')
    assert.equal((await editor.save()).ok, true)
    assert.deepEqual(calls[0]![3], { bars: [{ first: 1, last: 1 }, { first: 2, last: 3 }, { first: 4, last: 4 }, { first: 5, last: 5 }], added: [] }, `${count} quarters: old 2 is 2–3, old 3 is 4`)
    assert.equal((await library.info('piece-1')).bars, 5)
    editor.close()
  }
})

// ---- One bar at a time: the session of the redesigned editor (change redesign-score-editor, group 5) ---------

/** A piece of the pages [pages] (MusicXML), page k with the lines [lines[k]] in its photo, opened in the editor. */
async function openPages(pages: string[], lines: Line[][] = []) {
  const platform = createFakePlatform()
  const library = createLibrary(platform.files, { newId: () => 'piece-1' })
  const settings = await loadSettings(platform.files)
  const router = createRouter('library')
  const prepared = preparePages(pages)
  pages.forEach((_, k) => platform.files.seed(`scans/1/page-${k + 1}.jpg`, Uint8Array.of(k + 1)))
  await library.create({
    name: 'A piece',
    musicxml: prepared.musicxml,
    bars: prepared.bars,
    repairs: prepared.repairs,
    pages: pages.map((page, k) => ({ source: `scans/1/page-${k + 1}.jpg`, recognised: page, ...prepared.pages[k]!, staves: (lines[k] ?? []).map((line, j) => ({ box: { ...BOX, y: 0.1 + 0.2 * j }, ...line })) })),
  })
  router.push({ name: 'editor', pieceId: 'piece-1' })
  const editor = await openEditor({ library, settings, router, i18n: createI18n() }, 'piece-1')
  return { editor, library, settings }
}

/** Runs [action] (then [check]) and checks that it changed the score as one undo step: one undo gives back the score before it, one redo the score after it. */
function oneStep(editor: EditorSession, label: string, action: () => unknown, check?: () => void): void {
  const before = editor.score.value
  const result = action()
  assert.ok(result !== false && result !== undefined, `${label}: done (${editor.message.value})`)
  check?.()
  const after = editor.score.value
  assert.notEqual(after, before, `${label}: the score changed`)
  assert.ok(editor.undo(), label)
  assert.equal(editor.score.value, before, `${label}: one undo gives back the score before it`)
  assert.ok(editor.redo(), label)
  assert.equal(editor.score.value, after, `${label}: and one redo the score after it`)
}

/** The notes and rests of bar [bar] (from 1) of the first voice, as "C5 quarter", "rest eighth". */
const barText = (editor: EditorSession, bar: number): string[] =>
  notesOf(firstLine(editor.score.value).measures[bar - 1]!).map((n) => `${n.rest ? 'rest' : `${n.pitch!.step}${n.pitch!.octave}`} ${n.type ?? (n.measureRest ? 'of the bar' : '?')}${n.dots ? '.' : ''}`)

test('current bar (task 5.1): opens on the first warning\'s bar with nothing selected, else on bar 1; previous, next, a note and a warning move it', async () => {
  // Bar 3 of 4 is a beat short.
  const { editor } = await openPages([score([quarters(3, 'C'), quarters(3, 'D'), quarters(2, 'E'), quarters(3, 'F')], [3, 4])])
  assert.deepEqual([editor.currentBar.value, editor.barCount.value, editor.selection.value], [3, 4, null], 'Bar 3 of 4, nothing selected')
  assert.deepEqual(editor.barWarnings.value.map((w) => w.kind), ['bar-length'])
  assert.deepEqual(editor.barBeats.value, { counted: '2', beats: 3, beatType: 4, addsUp: false })
  assert.deepEqual([...editor.flaggedBars.value], [3], 'the bars to flag in the overview')
  assert.ok(editor.goToBar(1))
  assert.deepEqual([editor.barWarnings.value, editor.barBeats.value?.addsUp], [[], true])
  assert.ok(editor.nextWarning())
  assert.equal(editor.currentBar.value, 3, 'stepping to a warning makes its bar current')

  // Stepping goes on from the current bar (change redesign-score-editor, task 6.1; spec "Warning on another line"): bars 3 and 5 are short.
  const two = (await openPages([score([quarters(3, 'C'), quarters(3, 'D'), quarters(2, 'E'), quarters(3, 'F'), quarters(2, 'G')], [3, 4])])).editor
  assert.equal(two.currentBar.value, 3)
  assert.ok(two.goToBar(4))
  assert.equal(two.nextWarning()?.bar, '5', 'from bar 4 with nothing selected: the warning of bar 5, not the first one')
  assert.equal(two.currentBar.value, 5)
  assert.equal(two.previousWarning()?.bar, '3')
  assert.ok(two.goToBar(1))
  assert.equal(two.previousWarning()?.bar, '5', 'from bar 1 back: round to the last one')

  const six = (await setupSix()).editor
  assert.deepEqual([six.currentBar.value, six.barCount.value, six.selection.value], [1, 6, null], 'nothing to check: Bar 1 of 6')
  assert.equal(six.previousBar(), false)
  assert.ok(six.nextBar())
  assert.equal(six.currentBar.value, 2)
  assert.ok(six.previousBar())
  assert.equal(six.currentBar.value, 1)
  assert.equal(six.goToBar(7), false)
  assert.ok(six.goToBar(6))
  assert.equal(six.nextBar(), false)
  assert.equal(six.currentBar.value, 6)
  // A note or an element makes its bar current; another bar leaves a selection only in that bar.
  six.select(idsOf(six, 4)[1]!)
  assert.equal(six.currentBar.value, 4)
  six.goToBar(4)
  assert.equal(six.selection.value?.noteId, idsOf(six, 4)[1], 'the same bar keeps it')
  six.goToBar(2)
  assert.deepEqual([six.currentBar.value, six.selection.value], [2, null], 'another bar: no selection, but a current bar')
  six.selectBar(5)
  assert.equal(six.currentBar.value, 5)
  six.clearSelection()
  assert.equal(six.currentBar.value, 5, 'clearing the selection keeps the bar')
  // Kept in range when bars go, also by an undo and a redo.
  six.goToBar(6)
  six.apply((s) => deleteBar(s, 5))
  assert.deepEqual([six.currentBar.value, six.barCount.value], [5, 5])
  six.undo()
  assert.deepEqual([six.currentBar.value, six.barCount.value], [5, 6])
  six.goToBar(6)
  six.redo()
  assert.deepEqual([six.currentBar.value, six.barCount.value], [5, 5])
  // A selected note leads it after an edit that moves its bar.
  six.select(idsOf(six, 3)[0]!)
  six.apply((s) => addBar(s, 0, 'before'))
  assert.equal(six.currentBar.value, 4, 'the selected note is in bar 4 now')
})

test('view and tools (task 5.2): the view lives in the settings, a tap adds what the Notes tools say, and the Marks and Bars tools add no note', async () => {
  const { editor, settings, library } = await setupSix()
  assert.equal(editor.view.value, 'notes', 'the first time: Notes')
  await editor.setView('grid')
  assert.equal(settings.editorView.value, 'grid')
  editor.close()
  // The view is remembered for the next piece (settings.test.ts proves it is kept after a restart).
  const router = createRouter('library')
  router.push({ name: 'editor', pieceId: 'piece-1' })
  const again = await openEditor({ library, settings, router, i18n: createI18n() }, 'piece-1')
  assert.equal(again.view.value, 'grid')

  // What a tap adds (spec "Choose what a tap adds"): with nothing selected, the length, the dot and note or rest.
  assert.deepEqual(editor.tapChoice.value, { type: 'quarter', dots: 0, rest: false })
  editor.chooseLength('eighth')
  editor.chooseRest(true)
  editor.toggleDotted()
  editor.toggleDotted()
  assert.deepEqual(editor.tapChoice.value, { type: 'eighth', dots: 0, rest: true })
  editor.goToBar(2)
  const added = editor.addAtSlot(0, { step: 'B', octave: 4 })
  assert.ok(added)
  assert.deepEqual(barText(editor, 2), ['D5 quarter', 'D5 quarter', 'D5 quarter', 'rest eighth'], 'an eighth rest at the slot')
  assert.equal(editor.selection.value?.noteId, added, 'and it is selected')
  // With a note selected, the tools change it, and what a tap adds stays (spec "Change the selected note").
  editor.select(idsOf(editor, 2)[0]!)
  assert.ok(editor.chooseLength('half'))
  editor.chooseRest(false)
  assert.deepEqual(barText(editor, 2)[0], 'D5 half')
  assert.deepEqual(editor.tapChoice.value, { type: 'eighth', dots: 0, rest: true })

  // The Marks and the Bars tools add no note (spec "No stray note").
  editor.clearSelection()
  for (const tab of ['marks', 'bars'] as const) {
    editor.openTools(tab)
    const before = editor.score.value
    assert.equal(editor.canAddByTap.value, false, tab)
    assert.equal(editor.addAtSlot(0, { step: 'C', octave: 5 }), undefined, tab)
    assert.equal(editor.addOnStaff(0, { step: 'C', octave: 5 }, idsOf(editor, 2)[1]), undefined, tab)
    assert.equal(editor.gridAdd(frac(0), { step: 'C', octave: 5 }), undefined, tab)
    assert.equal(editor.score.value, before, tab)
  }
  editor.openTools('notes')
  assert.equal(editor.canAddByTap.value, true)
})

test('marks (task 5.2): note first, or mark first and painted on every tapped note, until a second tap or the Notes or Bars tools', async () => {
  const { editor } = await setupSix()
  const [c1, c2, c3] = idsOf(editor, 1)
  const [d1] = idsOf(editor, 2)
  const staccato = (id: string): boolean => placeOfNote(editor.score.value, id)!.note.staccato === true
  editor.openTools('marks')
  // Note first: the marks it has are active, and a mark goes on it.
  editor.apply((s) => toggleStaccato(s, c1!))
  editor.select(c1!)
  assert.ok(editor.activeMarks.value.has('staccato'))
  assert.ok(editor.tapMark('tenuto'))
  assert.deepEqual([editor.activeMarks.value.has('tenuto'), editor.armed.value], [true, null])
  editor.apply((s) => toggleStaccato(s, c1!))
  // Mark first: painted on every note tapped, which is not selected; still armed after.
  editor.clearSelection()
  assert.ok(editor.tapMark('staccato'))
  assert.equal(editor.armed.value, 'staccato')
  for (const id of [c1!, c2!, c3!, d1!]) assert.ok(editor.tapNote(id))
  assert.deepEqual([c1, c2, c3, d1].map((id) => staccato(id!)), [true, true, true, true], 'all four have a staccato')
  assert.deepEqual([editor.armed.value, editor.selection.value], ['staccato', null])
  assert.ok(editor.tapNote(c2!))
  assert.equal(staccato(c2!), false, 'a tapped note that has it loses it')
  // A second tap on it disarms it.
  editor.tapMark('staccato')
  assert.equal(editor.armed.value, null)
  // The Score tools keep it armed; the Notes and the Bars tools disarm it, and a tap then selects.
  editor.tapMark('accent')
  editor.openTools('score')
  assert.equal(editor.armed.value, 'accent')
  editor.openTools('bars')
  assert.equal(editor.armed.value, null)
  editor.openTools('marks')
  editor.tapMark('staccato')
  editor.openTools('notes')
  assert.equal(editor.armed.value, null)
  const before = editor.score.value
  editor.tapNote(c2!)
  assert.deepEqual([editor.selection.value?.noteId, editor.score.value === before], [c2, true], 'selected, without a staccato')
  // A rest takes no mark: the message says so, and nothing changes.
  const rest = editor.apply((s) => noteToRest(s, c3!))
  editor.openTools('marks')
  editor.clearSelection()
  editor.tapMark('accent')
  const unchanged = editor.score.value
  assert.equal(editor.tapNote(rest), false)
  assert.deepEqual([editor.score.value === unchanged, editor.message.value], [true, 'Marks go on notes, not on rests.'])
})

test('marks (task 7.1): an active slur, tie or hairpin of the selected note is removed by its mark, one undo step; one it does not have is armed from it', async () => {
  const { editor } = await setupSix()
  const [c1, c2, c3] = idsOf(editor, 1)
  const [d1] = idsOf(editor, 2)
  editor.openTools('marks')
  editor.apply((s) => addSlur(s, c3!, d1!))
  editor.apply((s) => addWedge(s, 'crescendo', c1!, c3!))
  // The slur stops on d1: its Slur is active, and tapping it takes the slur off both notes.
  editor.select(d1!)
  assert.ok(editor.activeMarks.value.has('slur'))
  oneStep(editor, 'the active slur off', () => editor.tapMark('slur'), () => {
    assert.deepEqual([placeOfNote(editor.score.value, c3!)!.note.slurs, placeOfNote(editor.score.value, d1!)!.note.slurs], [[], []])
    assert.deepEqual([editor.armed.value, editor.pending.value], [null, null], 'nothing armed')
  })
  // c2 is under the crescendo: its Crescendo is active, and tapping it removes the hairpin.
  editor.select(c2!)
  assert.ok(editor.activeMarks.value.has('crescendo'))
  oneStep(editor, 'the active crescendo off', () => editor.tapMark('crescendo'), () => {
    assert.equal(allItemLists(editor.score.value).flat().filter(isWedge).length, 0)
  })
  // A mark the note does not have is armed from it, as before.
  assert.ok(editor.tapMark('diminuendo'))
  assert.deepEqual([editor.armed.value, editor.pending.value?.from], ['diminuendo', c2])
  // A slide with the diminuendo armed adds a diminuendo, not a slur (spec "Slide between two notes"), and ends the waiting.
  oneStep(editor, 'armed slide', () => editor.slide(c3!, c1!))
  assert.deepEqual(allItemLists(editor.score.value).flat().filter(isWedge).map((w) => [w.type, w.start, w.stop]), [['diminuendo', c1, c3]])
  assert.deepEqual([placeOfNote(editor.score.value, c1!)!.note.slurs, editor.pending.value], [[], null])
})

// ---- the Notes surface and tray (change redesign-score-editor, tasks 6.2 and 6.3) -----------------------------

test('slots (task 6.2): a short first voice has one after its last note, a whole-bar rest one over the bar, a full bar none', async () => {
  const { editor } = await setup()
  // Bar 3 is E5 E5 in 3/4: a beat short.
  editor.goToBar(3)
  assert.deepEqual(editor.slots.value, [{ staff: 0, after: idsOf(editor, 3)[1] }])
  editor.goToBar(1)
  assert.deepEqual(editor.slots.value, [], 'a full bar has no slot')
  // Emptied, it holds a whole-bar rest, and the slot takes the whole bar.
  for (const id of idsOf(editor, 1)) editor.deleteNote(id)
  const [rest] = idsOf(editor, 1)
  assert.deepEqual(editor.slots.value, [{ staff: 0, after: null, rest }])
  // The slot follows the note added there.
  const added = editor.addAtSlot(0, { step: 'G', octave: 4 })!
  assert.deepEqual(editor.slots.value, [{ staff: 0, after: added }])
  editor.close()
})

test('slots (task 6.2): each staff of a piano bar has its own, and a short second voice has none', async () => {
  const { editor } = await setupMelodyPiano({ id: 'P2' })
  editor.goToBar(3)
  assert.deepEqual(editor.slots.value, [], 'both hands add up')
  editor.deleteNote(noteAt(editor, LH, 3, 0))
  assert.deepEqual(editor.slots.value.map((s) => s.staff), [1], 'only the left hand is short')
  // A second voice that is short (its last note deleted) shows none, and leaves the first voice's slot as it is.
  const before = editor.slots.value
  const second = notesOf(voiceView(editor.score.value, LH2).measures[2]!).filter((n) => !n.hidden)
  editor.deleteNote(second.at(-1)!.id)
  assert.deepEqual(editor.slots.value, before)
  editor.close()
})

test('Shorter and Longer (task 6.2): the next length, keeping the dot, as one undo step; none past whole and sixteenth', async () => {
  const { editor } = await setup()
  const [c5] = idsOf(editor, 1).slice(1)
  editor.select(c5!)
  oneStep(editor, 'shorter', () => editor.changeLength(-1), () => assert.equal(barText(editor, 1)[1], 'C5 eighth'))
  editor.toggleDotted()
  assert.ok(editor.changeLength(1))
  assert.equal(barText(editor, 1)[1], 'C5 quarter.', 'a dotted eighth made longer is a dotted quarter')
  assert.ok(editor.changeLength(1))
  assert.ok(editor.changeLength(1))
  assert.equal(barText(editor, 1)[1], 'C5 whole.')
  const at = editor.score.value
  assert.equal(editor.changeLength(1), false, 'nothing is longer than a whole note here')
  assert.equal(editor.score.value, at)
  editor.clearSelection()
  assert.equal(editor.changeLength(-1), false, 'nothing selected')
  editor.close()
})

test('the pitch drag (task 6.2): the name it shows is the pitch the release stores, with the key; the score is not changed until then', async () => {
  const { editor } = await setup()
  editor.apply((s) => setKey(s, editor.part.value, -1)) // F major: B is B flat
  const [, c5] = idsOf(editor, 1)
  const before = editor.score.value
  assert.deepEqual(editor.pitchAfterSteps(c5!, -1), { step: 'B', alter: -1, octave: 4 })
  assert.deepEqual(editor.pitchAfterSteps(c5!, 2), { step: 'E', octave: 5 })
  assert.deepEqual(editor.pitchAfterSteps(c5!, 0), { step: 'C', octave: 5 })
  assert.equal(editor.score.value, before, 'only tried on a copy')
  assert.equal(editor.pitchAfterSteps('nothing', 1), undefined)
  editor.select(c5!)
  assert.ok(editor.dragPitch(c5!, -1))
  assert.deepEqual(firstLine(editor.score.value).measures[0]!.items.filter(isNote).find((n) => n.id === c5)!.pitch, { step: 'B', alter: -1, octave: 4 })
  editor.close()
})

test('the sound of a note (task 6.2): one note with the instrument in use, from the audio the preview uses too', async () => {
  const { editor, played, deps } = await setup()
  let made = 0
  const make = deps.backend!
  deps.backend = (instrument) => {
    made++
    return make(instrument)
  }
  await editor.soundPitch({ step: 'D', octave: 5 })
  assert.equal(played.length, 1)
  assert.deepEqual(played[0]!.midi, [concertMidi(midiOf({ step: 'D', octave: 5 }), editor.instrument.value)], 'D5 as the tenor saxophone sounds it')
  await editor.soundPitch({ step: 'E', octave: 5 })
  editor.goToBar(2)
  await editor.previewBar()
  editor.stopPreview()
  assert.equal(made, 1, 'one audio for the sounds and the preview')
  editor.close()
  // Without audio, nothing sounds and nothing fails.
  const { editor: silent } = await setup()
  ;(silent as unknown as { deps: EditorDeps }).deps.backend = undefined
  await silent.soundPitch({ step: 'C', octave: 5 })
  silent.close()
})

test('bar for editing (task 6.2): a bar inside a longer ending gets a bracket of its own; the score keeps its bar lines', () => {
  const s = parseMusicXml(score([quarters(4, 'C'), quarters(4, 'D'), quarters(4, 'E'), quarters(4, 'F')]))
  setAttr(s, 1, 'leftBarline', { ending: { number: '1', type: 'start' } })
  setAttr(s, 3, 'rightBarline', { repeat: 'backward', ending: { number: '1', type: 'stop' } })
  const before = structuredClone(s)
  const bar = (index: number) => firstLine(barForEditing(s, index)).measures[0]!
  assert.deepEqual([bar(1).leftBarline, bar(1).rightBarline], [{ ending: { number: '1', type: 'start' } }, { ending: { number: '1', type: 'discontinue' } }], 'the first bar: open at its end')
  assert.deepEqual([bar(2).leftBarline, bar(2).rightBarline], [{ ending: { number: '1', type: 'start' } }, { ending: { number: '1', type: 'discontinue' } }], 'a bar in the middle')
  assert.deepEqual([bar(3).leftBarline, bar(3).rightBarline], [{ ending: { number: '1', type: 'start' } }, { repeat: 'backward', ending: { number: '1', type: 'stop' } }], 'the last bar keeps its own end')
  assert.deepEqual([bar(0).leftBarline, bar(0).rightBarline], [undefined, undefined], 'a bar in no ending')
  assert.deepEqual(s, before, 'the score is unchanged')
})

test('the Grid follows the selected note\'s staff and voice, else the first voice of the first staff, and another can be chosen (task 5.2)', async () => {
  const { editor } = await setupMelodyPiano({ id: 'P2' })
  assert.deepEqual(editor.gridVoice.value, RH, 'nothing selected: the right hand')
  assert.ok(editor.gridVoices.value.some((r) => r.staff === 1 && r.voice === 1), 'the left hand\'s second voice can be chosen')
  editor.goToBar(3)
  editor.select(noteAt(editor, LH, 3, 0))
  assert.deepEqual(editor.gridVoice.value, LH, 'a note of the left hand: the left hand')
  assert.deepEqual(editor.grid.value!.blocks.map((b) => b.id).includes(noteAt(editor, LH, 3, 0)), true)
  editor.select(noteAt(editor, LH2, 3, 0))
  assert.deepEqual(editor.gridVoice.value, LH2)
  // Choosing another hand shows it, and the selected note of the other voice goes.
  assert.ok(editor.setGridVoice(RH))
  assert.deepEqual([editor.gridVoice.value, editor.selection.value], [RH, null])
  assert.ok(editor.setGridVoice(LH))
  assert.deepEqual(editor.gridVoice.value, LH, 'chosen, with nothing selected')
  assert.equal(editor.setGridVoice({ part: 'P1', staff: 0, voice: 0 }), false, 'not a voice of the part being edited')
  editor.setPart('P1')
  assert.deepEqual(editor.gridVoice.value, { part: 'P1', staff: 0, voice: 0 })
  editor.close()
})

test('actions (task 5.3): adding notes by a tap, with the drag that follows, and the Grid gestures are one undo step each', async () => {
  const { editor } = await setupSix()
  // The slot: bar 1 emptied of its last note, then a C5 at the slot.
  editor.goToBar(1)
  oneStep(editor, 'delete', () => editor.deleteNote(idsOf(editor, 1)[2]!))
  assert.deepEqual([editor.currentBar.value, editor.selection.value?.noteId], [1, idsOf(editor, 1)[1]], 'the bar stays, with the note before selected')
  oneStep(editor, 'slot', () => editor.addAtSlot(0, { step: 'C', octave: 5 }))
  assert.deepEqual(barText(editor, 1), ['C5 quarter', 'C5 quarter', 'C5 quarter'])
  // A tap and the drag before the finger lifts: one step. A later drag of the same note is a step of its own.
  const before = editor.score.value
  const tapped = editor.addAtSlot(0, { step: 'C', octave: 5 })!
  assert.ok(editor.dragPitch(tapped, -2))
  assert.deepEqual(barText(editor, 1).at(-1), 'A4 quarter')
  editor.undo()
  assert.equal(editor.score.value, before, 'the tap and its drag are undone together')
  editor.redo()
  oneStep(editor, 'a later drag', () => editor.dragPitch(tapped, 1))
  assert.deepEqual(barText(editor, 1).at(-1), 'B4 quarter')
  // Between two notes, at the height of the tap, before the note to its right (spec "Add a note between two notes").
  editor.goToBar(2)
  const [, right] = idsOf(editor, 2)
  oneStep(
    editor,
    'on the staff',
    () => editor.addOnStaff(0, { step: 'E', octave: 5 }, right),
    () => assert.equal(editor.selection.value?.noteId, idsOf(editor, 2)[1], 'the new note is selected'),
  )
  assert.deepEqual(barText(editor, 2), ['D5 quarter', 'E5 quarter', 'D5 quarter', 'D5 quarter'])

  // Grid, in bar 3 left with its first note: a note on beat 3, moved, made shorter, a step higher, deleted.
  editor.goToBar(3)
  editor.deleteNote(idsOf(editor, 3)[2]!)
  editor.deleteNote(idsOf(editor, 3)[1]!)
  editor.chooseLength('quarter')
  editor.chooseRest(false)
  editor.clearSelection()
  let g = ''
  oneStep(editor, 'grid add', () => (g = editor.gridAdd(frac(1, 2), { step: 'G', octave: 5 })!))
  assert.deepEqual(barText(editor, 3), ['E5 quarter', 'rest quarter', 'G5 quarter'])
  const [e] = idsOf(editor, 3)
  oneStep(editor, 'grid move', () => editor.gridMove(e!, frac(1, 4)))
  assert.deepEqual(barText(editor, 3), ['rest quarter', 'E5 quarter', 'G5 quarter'])
  assert.equal(editor.gridResize(g, frac(1, 2)), false, 'past the end of the bar')
  assert.equal(editor.message.value, 'That goes past the end of the bar.')
  oneStep(editor, 'grid resize', () => editor.gridResize(g, frac(1, 8)))
  assert.equal(editor.message.value, null, 'a done action clears the message')
  oneStep(editor, 'grid pitch', () => editor.gridPitch(g, 1))
  assert.deepEqual(barText(editor, 3), ['rest quarter', 'E5 quarter', 'A5 eighth', 'rest eighth'])
  oneStep(editor, 'grid delete', () => editor.deleteNote(g))
})

test('Grid pitch (task 8.1): a block dragged up or down is one undo step, also right after a tap added it; a triplet block is refused with where it is edited, and a rest is no block', async () => {
  const triplet = note({ step: 'E', type: 'eighth', triplet: true })
  const { editor } = await openPages([score([quarters(4), triplet + triplet + triplet + quarters(3), quarters(4)], [4, 4])])
  editor.goToBar(2)
  const ids = idsOf(editor, 2)
  const before = editor.score.value
  assert.equal(editor.gridPitch(ids[0]!, 1), false, 'a triplet note')
  assert.equal(editor.message.value, 'Edit triplets and grace notes in Notes.')
  assert.equal(editor.score.value, before, 'nothing changed')
  oneStep(editor, 'the last quarter one step up', () => editor.gridPitch(ids[5]!, 1))
  assert.equal(editor.message.value, null)
  assert.deepEqual(barText(editor, 2).slice(3), ['G5 quarter', 'G5 quarter', 'A5 quarter'])
  // A note a tap just added is a step of its own; its drag is another.
  editor.goToBar(1)
  editor.deleteNote(idsOf(editor, 1)[3]!)
  editor.clearSelection()
  const added = editor.gridAdd(frac(3, 4), { step: 'C', octave: 5 })!
  oneStep(editor, 'the added note down', () => editor.gridPitch(added, -1))
  editor.undo()
  assert.deepEqual(barText(editor, 1).at(-1), 'C5 quarter', 'the undo took the drag only')
  // A rest is not a block.
  editor.select(idsOf(editor, 3)[0]!)
  editor.chooseRest(true)
  const rest = notesOf(firstLine(editor.score.value).measures[2]!).find((n) => n.rest)!
  assert.equal(editor.gridPitch(rest.id, 1), false)
  assert.equal(editor.message.value, 'Rests follow from the notes. Move a note instead.')
})

test('actions (task 5.3): marks, loudness, endings, bar lines, bars and suggestions are one undo step each, and a refusal says why', async () => {
  const { editor } = await setupSix()
  const [c1, c2, c3] = idsOf(editor, 1)
  editor.openTools('marks')
  editor.select(c1!)
  oneStep(editor, 'breath', () => editor.tapMark('breath'))
  oneStep(editor, 'caesura', () => editor.tapMark('caesura'))
  oneStep(editor, 'p', () => editor.tapMark('p'))
  oneStep(editor, 'f for p', () => editor.tapMark('f'))
  assert.ok(editor.activeMarks.value.has('f') && editor.activeMarks.value.has('breath') && editor.activeMarks.value.has('caesura'))
  oneStep(editor, 'the active f off', () => editor.tapMark('f'))
  assert.equal(editor.activeMarks.value.has('f'), false)
  // The loudness strip: none, p, mf, f, none; an ff steps to none.
  const strip: (string | undefined)[] = []
  for (let k = 0; k < 4; k++) {
    oneStep(editor, `strip ${k}`, () => editor.stepLoudness(c2!))
    strip.push(dynamicOf(editor.score.value, c2!)?.mark)
  }
  assert.deepEqual(strip, ['p', 'mf', 'f', undefined])
  oneStep(editor, 'ff', () => editor.setLoudness(c2!, 'ff'))
  oneStep(editor, 'strip under ff', () => editor.stepLoudness(c2!))
  assert.equal(dynamicOf(editor.score.value, c2!), undefined)
  // Slides along the strip: forward a crescendo, back a diminuendo; a slide in Notes, a slur.
  oneStep(editor, 'strip forward', () => editor.stripSlide(c1!, c2!))
  const [d1, d2] = idsOf(editor, 2)
  oneStep(editor, 'strip back', () => editor.stripSlide(d2!, d1!))
  assert.deepEqual(allItemLists(editor.score.value).flat().filter(isWedge).map((w) => [w.type, w.start, w.stop]), [['crescendo', c1, c2], ['diminuendo', d1, d2]])
  oneStep(editor, 'slide', () => editor.slide(c3!, c1!))
  assert.deepEqual(editor.spans.value.map((x) => [x.kind, x.fromId, x.toId]), [['slur', c1, c3], ['crescendo', c1, c2]])
  oneStep(editor, 'remove from the list', () => editor.removeSpan(editor.spans.value[0]!))

  // Bars: endings with their end-repeat, the end bar line, add, delete, the same as the bar before, join.
  editor.goToBar(4)
  oneStep(editor, '1st time only', () => editor.toggleEnding(1))
  assert.deepEqual([editor.barEnding.value, editor.barLines.value?.end], ['1', 'repeat'], 'the end-repeat comes along in the same step')
  editor.goToBar(5)
  oneStep(editor, '2nd time only', () => editor.toggleEnding(2))
  editor.goToBar(2)
  assert.equal(editor.toggleEnding(2), false)
  assert.equal(editor.message.value, 'A second-time bar comes directly after a first-time bar.')
  editor.goToBar(5)
  oneStep(editor, '2nd time only off', () => editor.toggleEnding(2))
  editor.goToBar(4)
  oneStep(editor, 'played 3 times', () => editor.setRepeatTimes(3))
  assert.equal(editor.barLines.value?.times, 3)
  oneStep(editor, 'the ending removed', () => editor.removeEnding())
  assert.equal(editor.barEnding.value, null)
  editor.goToBar(6)
  oneStep(editor, 'end bar line', () => editor.setBarEnd('final'))
  assert.equal(editor.barLines.value?.end, 'final')
  oneStep(editor, 'start repeat', () => editor.setBarStart('repeat'))
  editor.goToBar(2)
  editor.select(idsOf(editor, 2)[0]!)
  oneStep(editor, 'bar after', () => editor.addBar('after'))
  assert.deepEqual([editor.currentBar.value, editor.barCount.value, editor.selection.value, barText(editor, 3)], [3, 7, null, ['rest of the bar']], 'the new bar is current, with a whole-bar rest')
  oneStep(editor, 'same as bar before', () => editor.copyBarBefore())
  assert.deepEqual(barText(editor, 3), barText(editor, 2))
  oneStep(editor, 'delete bar', () => editor.deleteBar())
  assert.deepEqual([editor.currentBar.value, editor.barCount.value], [3, 6])
  editor.goToBar(2)
  oneStep(editor, 'join with next', () => editor.joinNext())
  assert.equal(barText(editor, 2).length, 6)
  // A suggestion: bar 2 cut down to two quarters in 3/4 is short of a quarter rest.
  for (const k of [5, 4, 3]) editor.deleteNote(idsOf(editor, 2)[k]!)
  editor.apply((s) => splitBar(s, idsOf(editor, 2)[2]!))
  editor.goToBar(2)
  assert.deepEqual(editor.barBeats.value, { counted: '2', beats: 3, beatType: 4, addsUp: false })
  const suggestion = editor.suggestions.value.find((x) => x.kind === 'addRest')!
  oneStep(editor, 'a suggestion', () => editor.applySuggestion(suggestion))
  assert.deepEqual([editor.barBeats.value?.addsUp, editor.suggestions.value], [true, []])
})

test('not offered (task 5.3): Delete bar for the only bar of the piece or of a page, and "Same as bar before" for the first bar', async () => {
  // Page 1 holds bars 1 to 3, page 2 bar 4 only.
  const { editor } = await openPages([score([quarters(3, 'C'), quarters(3, 'D'), quarters(3, 'E')], [3, 4]), score([quarters(3, 'F')])])
  editor.goToBar(4)
  assert.equal(editor.canDeleteBar.value, false, 'the only bar of page 2')
  const before = editor.score.value
  assert.equal(editor.deleteBar(), false)
  assert.deepEqual([editor.score.value === before, editor.message.value], [true, 'This is the last bar read on its page, so it cannot be deleted.'])
  editor.goToBar(3)
  assert.equal(editor.canDeleteBar.value, true)
  // A bar added on page 2 does not make its own bar deletable: the page would hold only an added bar.
  editor.goToBar(4)
  editor.addBar('after')
  assert.deepEqual([editor.canDeleteBar.value, editor.canDeleteBarAt(3)], [true, false], 'the added bar can go, the bar of the page cannot')
  // "Same as bar before": not for the first bar.
  editor.goToBar(1)
  assert.equal(editor.canCopyBarBefore.value, false)
  assert.equal(editor.copyBarBefore(), false)
  assert.equal(editor.message.value, 'The first bar has no bar before it to copy.')
  editor.goToBar(2)
  assert.equal(editor.canCopyBarBefore.value, true)

  const one = (await openPages([score([quarters(3, 'C')], [3, 4])])).editor
  assert.deepEqual([one.canDeleteBar.value, one.deleteBar(), one.message.value], [false, false, 'This is the only bar of the piece, so it cannot be deleted.'])
})

test('scissors (task 9.2): the places of a bar line in the current bar, in Notes for every voice and in Grid for the one shown; a tap is one undo step, refused with where', async () => {
  const { editor } = await setup()
  editor.goToBar(2)
  const [g1, g2, g3] = idsOf(editor, 2)
  assert.deepEqual(editor.barLineCuts.value.map((c) => [c.noteId, c.place]), [[g2, 2], [g3, 3]], 'not before the first note')
  assert.equal(editor.addBarLineBefore(g1!), false)
  assert.equal(editor.message.value, 'A bar line cannot go before the first note of a bar.')
  oneStep(editor, 'scissors', () => editor.addBarLineBefore(g3!), () => {
    assert.deepEqual([idsOf(editor, 2), idsOf(editor, 3), editor.currentBar.value, editor.barCount.value], [[g1, g2], [g3], 2, 5], 'bar 2 is cut before its third note and stays current')
  })
  editor.goToBar(2)
  assert.deepEqual(editor.barLineCuts.value.map((c) => c.noteId), [g2])

  // The melody over a piano: in bar 7 the left hand holds a whole note across the melody's second note.
  const piece = await setupMelodyPiano()
  const melody = noteAt(piece.editor, { part: 'P1', staff: 0, voice: 0 }, 7, 1)
  piece.editor.goToBar(7)
  assert.deepEqual(piece.editor.barLineCuts.value.map((c) => c.noteId), [melody])
  const before = piece.editor.score.value
  assert.equal(piece.editor.addBarLineBefore(melody), false)
  assert.deepEqual([piece.editor.score.value === before, piece.editor.message.value], [true, 'A note in the left hand sounds across that point, so a bar line cannot go there.'])
  // Grid shows one voice: its places only. In bar 3 of the piano the left hand moves on beat 2, the right hand does not.
  piece.editor.setPart('P2')
  piece.editor.goToBar(3)
  const at = () => piece.editor.barLineCuts.value.map((c) => `${c.start.n}/${c.start.d}`)
  assert.deepEqual(at(), ['1/4', '1/2'], 'both hands in Notes')
  await piece.editor.setView('grid')
  piece.editor.setGridVoice(RH)
  assert.deepEqual(at(), ['1/2'], 'the right hand in Grid')
})

test('not offered (task 5.3): Join with next at the end of a line or page, also after bars were deleted or brought back by an undo across a save', async () => {
  // Page 1: lines 1 and 2–3; page 2: lines 4–5 and 6.
  const lines: Line[] = [
    { firstBar: 4, lastBar: 5 },
    { firstBar: 6, lastBar: 6 },
  ]
  let six = await setupSix(lines)
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((i) => six.editor.canRemoveBarLineAfter(i)), [false, true, false, true, false, false])
  // The bar that ended line 4–5 deleted in the session: bar 4 and the old bar 6 are on two lines.
  six.editor.goToBar(5)
  assert.ok(six.editor.deleteBar())
  assert.deepEqual([0, 1, 2, 3, 4].map((i) => six.editor.canRemoveBarLineAfter(i)), [false, true, false, false, false])
  six.editor.goToBar(4)
  assert.deepEqual([six.editor.canJoinNext.value, six.editor.joinNext(), six.editor.message.value], [false, false, 'This bar ends a line of the printed page, so its bar line stays.'])
  // An added bar is on the line of the bar it was added after: its bar line to the next line stays.
  six.editor.goToBar(3)
  six.editor.addBar('after')
  assert.deepEqual([1, 2, 3].map((i) => six.editor.canRemoveBarLineAfter(i)), [true, true, false], '2–3, 3–added; not added–4')

  // The first bar of page 2 deleted, saved, and brought back by an undo: a save counts it on page 1 (design D8), so it
  // joins bar 3 and not bar 5, and the page 2 that is left keeps a bar.
  six = await setupSix()
  six.editor.goToBar(4)
  assert.ok(six.editor.deleteBar())
  assert.equal((await six.editor.save()).ok, true)
  six.editor.undo()
  assert.deepEqual([2, 3].map((i) => six.editor.canRemoveBarLineAfter(i)), [true, false])
  assert.deepEqual([3, 4, 5].map((i) => six.editor.canDeleteBarAt(i)), [true, true, true])
  six.editor.goToBar(5)
  assert.ok(six.editor.deleteBar())
  assert.deepEqual([3, 4].map((i) => six.editor.canDeleteBarAt(i)), [true, false], 'the last bar of page 2 is not offered')
  six.editor.goToBar(3)
  assert.ok(six.editor.joinNext())
  assert.deepEqual(await six.save(), [4, [[1, 3, [[1, 1], [2, 3]]], [4, 4, [[4, 4]]]]])
})

test('not offered (task 5.3): an undo after a save cannot leave a page without bars, as a page always keeps a bar that was not added', async () => {
  const { editor, save } = await setupSix()
  editor.goToBar(1)
  assert.ok(editor.addBar('after'))
  // Page 1 is bars 1, added, 2 and 3: bars 1 and 2 can go, then bar 3 is the last one of page 1 that was not added.
  for (const bar of [1, 2]) {
    editor.goToBar(bar)
    assert.ok(editor.deleteBar(), `delete ${bar}`)
  }
  assert.deepEqual([editor.currentBar.value, editor.canDeleteBarAt(1), editor.canDeleteBarAt(0)], [2, false, true])
  await save()
  while (editor.undo());
  // Saved, not refused. The bars the undo brought back belong to bar 3's line (design D8, known limit): line 1 had only the added bar.
  assert.deepEqual(await save(), [6, [[1, 3, [[1, 3]]], [4, 6, [[4, 6]]]]])
  // Why: with bar 3 deleted as well (not offered, so done here by hand), page 1 is the added bar alone, and after the
  // undo nothing that belongs to page 1 is left: that save is refused.
  const raw = await setupSix()
  raw.editor.apply((s) => addBar(s, 0, 'after'))
  for (const index of [0, 1, 1]) raw.editor.apply((s) => deleteBar(s, index))
  await raw.save()
  while (raw.editor.undo());
  const refused = await raw.editor.save()
  assert.match(String(!refused.ok && refused.error), /page 1 would hold no bars/)
})

test('suggestions (task 5.3): "Join with the next bar" is offered with the session\'s join rule, so not across a page', async () => {
  // Bar 2 holds two beats and bar 3 one: together they add up.
  const onePage = (await openPages([score([quarters(3, 'C'), quarters(2, 'D'), quarters(1, 'E'), quarters(3, 'F')], [3, 4])])).editor
  onePage.goToBar(2)
  assert.ok(onePage.suggestions.value.some((x) => x.kind === 'join'))
  const twoPages = (await openPages([score([quarters(3, 'C'), quarters(2, 'D')], [3, 4]), score([quarters(1, 'E'), quarters(3, 'F')])])).editor
  twoPages.goToBar(2)
  assert.ok(twoPages.suggestions.value.length > 0)
  assert.equal(twoPages.suggestions.value.some((x) => x.kind === 'join'), false, 'no join across the page')
})

test('a mark that waits for its last note (task 5.5): over four bars, through the full score, Cancel, and the last note first', async () => {
  // A slur over four bars: the notice stays in bars 2 to 5, then the slur runs from bar 2 to bar 5.
  let { editor } = await setupSix()
  editor.openTools('marks')
  editor.tapMark('slur')
  editor.goToBar(2)
  editor.tapNote(idsOf(editor, 2)[0]!)
  for (let bar = 2; bar <= 5; bar++) {
    assert.deepEqual(editor.pending.value, { kind: 'slur', from: idsOf(editor, 2)[0], bar: 2 }, `in bar ${bar}`)
    assert.equal(editor.currentBar.value, bar)
    if (bar < 5) editor.nextBar()
  }
  assert.ok(editor.tapNote(idsOf(editor, 5)[2]!))
  assert.equal(editor.pending.value, null)
  assert.equal(editor.armed.value, 'slur', 'still armed for the next one')
  editor.goToBar(3)
  assert.deepEqual(editor.spans.value.map((x) => [x.kind, x.first + 1, x.last + 1, x.fromId, x.toId]), [['slur', 2, 5, idsOf(editor, 2)[0], idsOf(editor, 5)[2]]])
  // Its key for the last bar goes there, with the last note selected.
  assert.ok(editor.goToSpanEnd(editor.spans.value[0]!, 'last'))
  assert.deepEqual([editor.currentBar.value, editor.selection.value?.noteId], [5, idsOf(editor, 5)[2]])

  // Through the full score: picked bar 6, the slur still waits, and a note of bar 6 ends it.
  ;({ editor } = await setupSix())
  editor.openTools('marks')
  editor.tapMark('slur')
  editor.goToBar(2)
  editor.tapNote(idsOf(editor, 2)[1]!)
  editor.openFullScore()
  assert.equal(editor.fullScore.value, true)
  editor.closeFullScore(6)
  assert.deepEqual([editor.fullScore.value, editor.currentBar.value, editor.pending.value?.bar], [false, 6, 2])
  editor.openFullScore()
  editor.closeFullScore()
  assert.deepEqual([editor.currentBar.value, editor.pending.value?.bar], [6, 2], 'back without a bar keeps both')
  assert.ok(editor.tapNote(idsOf(editor, 6)[0]!))
  assert.deepEqual(editor.spans.value.map((x) => [x.kind, x.first + 1, x.last + 1]), [['slur', 2, 6]])

  // Cancel: nothing added, the notice gone, Cresc. no longer armed.
  ;({ editor } = await setupSix())
  editor.openTools('marks')
  editor.tapMark('crescendo')
  editor.tapNote(idsOf(editor, 1)[0]!)
  const before = editor.score.value
  editor.cancelPending()
  assert.deepEqual([editor.pending.value, editor.armed.value, editor.score.value === before], [null, null, true])
  // A second tap on the armed mark, and the Notes or Bars tools, end it too; the Score tools do not.
  for (const end of [() => editor.tapMark('crescendo'), () => editor.openTools('notes'), () => editor.openTools('bars')]) {
    editor.openTools('marks')
    editor.tapMark('crescendo')
    editor.tapNote(idsOf(editor, 1)[0]!)
    editor.openTools('score')
    editor.openTools('marks')
    assert.ok(editor.pending.value)
    end()
    assert.deepEqual([editor.pending.value, editor.armed.value], [null, null])
  }

  // The last note before the first: from the last note of bar 4 to the first of bar 5.
  ;({ editor } = await setupSix())
  editor.openTools('marks')
  editor.tapMark('slur')
  editor.goToBar(5)
  editor.tapNote(idsOf(editor, 5)[0]!)
  editor.previousBar()
  assert.ok(editor.tapNote(idsOf(editor, 4)[2]!))
  assert.deepEqual(editor.spans.value.map((x) => [x.kind, x.fromId, x.toId]), [['slur', idsOf(editor, 4)[2], idsOf(editor, 5)[0]]])
})

test('a mark that waits for its last note (task 5.5): a selected note is its first; stepping to a warning keeps it; its note deleted ends it', async () => {
  const { editor } = await openPages([score([quarters(3, 'C'), quarters(3, 'D'), quarters(2, 'E'), quarters(3, 'F')], [3, 4])])
  editor.goToBar(1)
  editor.select(idsOf(editor, 1)[0]!)
  editor.openTools('marks')
  editor.tapMark('tie')
  assert.deepEqual(editor.pending.value, { kind: 'tie', from: idsOf(editor, 1)[0], bar: 1 })
  editor.nextWarning()
  assert.deepEqual([editor.currentBar.value, editor.pending.value?.bar], [3, 1])
  editor.apply((s) => deleteNote(s, idsOf(editor, 1)[0]!))
  assert.deepEqual([editor.pending.value, editor.armed.value], [null, 'tie'], 'it waits for nothing, and Tie stays armed')
})

test('save (task 5.4): after "add a bar, delete another" through the session, the pages and the loop follow; a second save maps from the first', async () => {
  const { editor, library, save } = await setupSix()
  const calls = spyOnWrites(library)
  await library.writePractice('piece-1', { ...DEFAULT_PRACTICE, bar: 5, loop: { start: 4, end: 6 } })
  // A bar added after bar 3, the end of page 1 ("An added bar and its page"), and the old bar 5 deleted ("A loop over a deleted bar").
  editor.goToBar(3)
  assert.ok(editor.addBar('after'))
  editor.goToBar(6)
  assert.ok(editor.deleteBar())
  assert.deepEqual(await save(), [6, [[1, 4, [[1, 1], [2, 4]]], [5, 6, [[5, 6]]]]], 'the added bar is on page 1')
  assert.deepEqual(calls[0]![3], { bars: [{ first: 1, last: 1 }, { first: 2, last: 2 }, { first: 3, last: 3 }, { first: 5, last: 5 }, null, { first: 6, last: 6 }], added: [{ bar: 4, of: 3 }] })
  assert.deepEqual(await library.readPractice('piece-1'), { ...DEFAULT_PRACTICE, bar: 6, loop: { start: 5, end: 6 } }, 'the loop keeps the music that is left; the position moves to the bar that follows')
  // One more bar deleted, the old bar 4, now bar 5: the map goes from the six bars as saved, not from the six bars as loaded.
  editor.goToBar(5)
  assert.ok(editor.deleteBar())
  assert.deepEqual(await save(), [5, [[1, 4, [[1, 1], [2, 4]]], [5, 5, [[5, 5]]]]])
  assert.deepEqual(calls[1]![3], { bars: [{ first: 1, last: 1 }, { first: 2, last: 2 }, { first: 3, last: 3 }, { first: 4, last: 4 }, null, { first: 5, last: 5 }], added: [] })
  assert.deepEqual(await library.readPractice('piece-1'), { ...DEFAULT_PRACTICE, bar: 5, loop: { start: 5, end: 5 } })
})

test('actions (task 5.3): a tap on the lower staff of a piano bar adds to the left hand, in the voice of the selected note when it is there', async () => {
  const { editor } = await setupMelodyPiano({ id: 'P2' })
  const items = (ref: { part: string; staff: number; voice: number }, bar: number) => voiceView(editor.score.value, ref).measures[bar - 1]!.items.filter((i) => 'id' in i).map((i) => (i as { id: string }).id)
  editor.goToBar(1)
  const right = items(RH, 1)
  const left = items(LH, 1)
  let added = ''
  oneStep(editor, 'left hand', () => (added = editor.addOnStaff(1, { step: 'E', octave: 3 })!))
  assert.deepEqual([items(RH, 1), items(LH, 1)], [right, [...left, added]], 'at the end of the left hand; the right hand is unchanged')
  assert.deepEqual(placeOfNote(editor.score.value, added)!.note.pitch, { step: 'E', octave: 3 })
  // With a note of the left hand's second voice selected, the new note goes to that voice, before the note to its right.
  editor.goToBar(3)
  const second = items(LH2, 3)
  editor.select(noteAt(editor, LH2, 3, 0))
  oneStep(editor, 'second voice', () => (added = editor.addOnStaff(1, { step: 'D', octave: 3 }, noteAt(editor, LH2, 3, 0))!))
  assert.deepEqual(items(LH2, 3), [second[0], added, second[1]], 'after the hidden rest that the voice starts with, before its C2')
  editor.close()
})

// ---- the photo line (change redesign-score-editor, task 11.1; design D8, D10; spec "Line from the photo") -------------

test('photo (task 11.1): the line of the current bar on its page, the whole page where no line is known, and its picture', async () => {
  const { editor } = await setup()
  assert.equal(editor.currentBar.value, 1)
  // Page 1 has no positions for its lines: the whole page, with the bars it holds.
  assert.deepEqual(editor.photo.value, { page: 1, n: 1, box: null, firstBar: 1, lastBar: 2 })
  editor.goToBar(2)
  assert.deepEqual(editor.photo.value, { page: 1, n: 1, box: null, firstBar: 1, lastBar: 2 })
  // Page 2 has them: the line that holds the bar.
  editor.goToBar(3)
  assert.deepEqual(editor.photo.value, { page: 2, n: 2, box: BOX, firstBar: 3, lastBar: 3 })
  editor.nextBar()
  assert.deepEqual(editor.photo.value, { page: 2, n: 2, box: { ...BOX, y: 0.5 }, firstBar: 4, lastBar: 4 })
  assert.equal(await editor.photoUrl(editor.photo.value!), 'fake://image/pieces/piece-1/pages/2/source.jpg')
  // Selecting a note follows it to its bar's line.
  editor.select(idsOf(editor, 3)[0]!)
  assert.deepEqual(editor.photo.value?.box, BOX)
})

test('photo (task 11.1): shown large and closed again; back closes it first, before "Full score", and changes nothing else', async () => {
  const { editor, router } = await setup()
  const [e5] = idsOf(editor, 3)
  editor.select(e5!)
  assert.equal(editor.photoLarge.value, false)
  assert.equal(editor.openPhoto(), true)
  assert.equal(editor.photoLarge.value, true)
  editor.closePhoto()
  assert.equal(editor.photoLarge.value, false)

  editor.openFullScore()
  editor.openPhoto()
  router.back()
  assert.equal(editor.photoLarge.value, false, 'back closed the photo')
  assert.equal(editor.fullScore.value, true, '"Full score" is still shown')
  assert.deepEqual(editor.selection.value, { bar: 3, noteId: e5 })
  assert.equal(editor.currentBar.value, 3)
  assert.equal(router.screen.value.name, 'editor')
  router.back()
  assert.equal(editor.fullScore.value, false)
  assert.equal(router.screen.value.name, 'editor')
  router.back()
  assert.equal(router.screen.value.name, 'library', 'nothing to lose: back leaves')

  editor.openPhoto()
  editor.close()
  assert.equal(editor.photoLarge.value, false, 'closing the editor closes it')
})

test('photo (task 11.1): an added bar shows the line of the bar it was added next to, before and after the save; the bars after it keep theirs', async () => {
  const { editor, save } = await setupSix()
  const line1 = { box: BOX, firstBar: 1, lastBar: 1 }
  const line2 = { box: { ...BOX, y: 0.5 }, firstBar: 2, lastBar: 3 }
  const where = () => {
    const photo = editor.photo.value!
    return { page: photo.page, box: photo.box, firstBar: photo.firstBar, lastBar: photo.lastBar }
  }
  editor.goToBar(1)
  assert.deepEqual(where(), { page: 1, ...line1 })
  // "+ Bar after" bar 1: the new bar 2 is on the line of bar 1, which now holds bars 1 and 2; the old bar 2 is bar 3.
  assert.ok(editor.addBar('after'))
  assert.equal(editor.currentBar.value, 2)
  assert.equal(editor.score.value.bars[1]!.added !== undefined, true)
  assert.deepEqual(where(), { page: 1, box: BOX, firstBar: 1, lastBar: 2 })
  editor.goToBar(3)
  assert.deepEqual(where(), { page: 1, box: line2.box, firstBar: 3, lastBar: 4 })
  // "+ Bar before" the old bar 2 (now bar 3): the new bar is on the line of the bar it was added next to, bar 3's.
  assert.ok(editor.addBar('before'))
  assert.equal(editor.currentBar.value, 3)
  assert.deepEqual(where(), { page: 1, box: line2.box, firstBar: 3, lastBar: 5 })
  editor.goToBar(6)
  assert.deepEqual(where(), { page: 2, box: BOX, firstBar: 6, lastBar: 8 })

  // Saved, the lines are the same: the photo counted the bars as the save does.
  const before = [1, 2, 3, 4, 5, 6, 7, 8].map((bar) => (editor.goToBar(bar), where()))
  assert.deepEqual(await save(), [8, [[1, 5, [[1, 2], [3, 5]]], [6, 8, [[6, 8]]]]])
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8].map((bar) => (editor.goToBar(bar), where())), before)
})

test('photo (task 11.1): the halves of a split bar keep its line; a deleted bar\'s line goes when it held no other bar; a refused save falls back to the pages as saved', async () => {
  const split = await setupSix()
  split.editor.apply((s) => splitBar(s, idsOf(split.editor, 2)[1]!))
  split.editor.goToBar(3)
  assert.deepEqual(split.editor.photo.value, { page: 1, n: 1, box: { ...BOX, y: 0.5 }, firstBar: 2, lastBar: 4 }, 'bar 3 is the second half of the old bar 2')
  split.editor.goToBar(5)
  assert.deepEqual(split.editor.photo.value, { page: 2, n: 2, box: BOX, firstBar: 5, lastBar: 7 })

  const deleted = await setupSix()
  deleted.editor.goToBar(1)
  assert.equal(deleted.editor.canDeleteBar.value, true)
  assert.ok(deleted.editor.deleteBar())
  // The old bar 1 was the only bar of the first line of page 1: that line is not shown any more.
  for (const bar of [1, 2]) {
    deleted.editor.goToBar(bar)
    assert.deepEqual(deleted.editor.photo.value, { page: 1, n: 1, box: { ...BOX, y: 0.5 }, firstBar: 1, lastBar: 2 })
  }
  deleted.editor.goToBar(3)
  assert.deepEqual(deleted.editor.photo.value, { page: 2, n: 2, box: BOX, firstBar: 3, lastBar: 5 })

  // Should a save now be refused (design D8's known limit after an undo across a save), the pages as last saved are used,
  // with the bar kept in range: here a piece.json that counts two bars fewer than the score it saved.
  const info = deleted.editor.info.value
  const saved = deleted.editor.score.value
  const wrong = { ...info, bars: info.bars - 2 }
  assert.deepEqual(photoOfBar(wrong, saved, saved, 1), { page: 1, n: 1, box: BOX, firstBar: 1, lastBar: 1 }, 'the line of bar 1 as saved, which the score no longer has')
  assert.deepEqual(photoOfBar(wrong, saved, saved, 2), { page: 1, n: 1, box: { ...BOX, y: 0.5 }, firstBar: 2, lastBar: 3 })
  assert.deepEqual(photoOfBar(wrong, saved, saved, 99), { page: 2, n: 2, box: BOX, firstBar: 4, lastBar: 6 })
  assert.equal(photoOfBar({ ...info, pages: [] }, saved, saved, 1), null, 'a piece without pages has no photo')
})
