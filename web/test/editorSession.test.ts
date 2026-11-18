import assert from 'node:assert/strict'
import { test } from 'node:test'
import { effect, signal } from '@preact/signals'
import { barExcerpt, openEditor, photoOf } from '../src/app/editorSession.ts'
import type { EditorDeps, EditorSession } from '../src/app/editorSession.ts'
import { createI18n } from '../src/app/i18n/index.ts'
import type { Language } from '../src/app/i18n/index.ts'
import { DEFAULT_PRACTICE, createLibrary } from '../src/app/library.ts'
import { createRouter } from '../src/app/router.ts'
import { loadSettings } from '../src/app/settings.ts'
import { preparePages } from '../src/core/pages/pages.ts'
import type { AudioBackend } from '../src/core/playback/player.ts'
import type { NoteOnSpec, TimerApi } from '../src/core/playback/scheduler.ts'
import { deleteNote, insertNote, setDuration, stepPitch } from '../src/core/score/edit.ts'
import { notesOf } from '../src/core/score/model.ts'
import type { Score } from '../src/core/score/model.ts'
import { parseMusicXml } from '../src/core/score/musicxml.ts'
import { createFakePlatform } from '../src/platform/fake/index.ts'
import { note, quarters, score } from './helpers.ts'

// The editor session (practice-app task 9.6, spec `score-editing`): selection, edits with undo and
// redo, live warnings and stepping through them, the photo beside the selected bar, the bar
// preview, the title, the dirty state with the leave guard, and Save & practice.

/** Page 1 (3/4): bar 1 is A3 C5 C5 (a written A3 is below the tenor saxophone), bar 2 is G5 G5 G5. */
const PAGE_1 = score([note({ step: 'A', octave: 3, type: 'quarter' }) + quarters(2, 'C'), quarters(3, 'G')], [3, 4])
/** Page 2: bar 3 is a beat short (E5 E5), bar 4 is fine. */
const PAGE_2 = score([quarters(2, 'E'), quarters(3, 'F')])
const BOX = { x: 0.05, y: 0.1, width: 0.9, height: 0.25 }

async function setup(options: { practiceTempo?: number } = {}) {
  const platform = createFakePlatform()
  const library = createLibrary(platform.files, { newId: () => 'piece-1' })
  const settings = await loadSettings(platform.files)
  const i18n = createI18n(signal<Language | null>('en'))
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
  const editor = await openEditor(deps, 'piece-1')
  return { platform, library, settings, router, i18n, editor, played, deps }
}

/** The ids of the notes of bar [bar] (1-based) of the working score. */
const idsOf = (editor: EditorSession, bar: number): string[] => notesOf(editor.score.value.measures[bar - 1]!).map((n) => n.id)
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

// ---- selection and the photo ---------------------------------------------------------------

test('selection: a note and its bar, a bar alone, and the photo of the page (the staff when it is known)', async () => {
  const { editor } = await setup()
  assert.equal(editor.selection.value, null)
  assert.equal(editor.photo.value, null)

  const [, c5] = idsOf(editor, 1)
  assert.equal(editor.select(c5!), true)
  assert.deepEqual(editor.selection.value, { bar: 1, noteId: c5 })
  assert.equal(editor.selectedNote.value!.pitch!.step, 'C')
  assert.deepEqual(editor.photo.value, { page: 1, n: 1, bar: 1, box: null }, 'no staff positions on page 1: the whole photo')

  const [e5] = idsOf(editor, 3)
  editor.select(e5!)
  assert.deepEqual(editor.photo.value, { page: 2, n: 2, bar: 3, box: BOX }, '"Photo 2 · Bar 3": the strip with the staff that holds bar 3')
  assert.equal(editor.selectBar(4), true)
  assert.deepEqual(editor.selection.value, { bar: 4, noteId: null })
  assert.deepEqual(editor.photo.value!.box, { ...BOX, y: 0.5 })
  assert.equal(editor.selectedNote.value, undefined)

  assert.equal(editor.select('no-such-note'), false)
  assert.equal(editor.selectBar(5), false)
  assert.equal(editor.selectBar(0), false)
  assert.deepEqual(editor.selection.value, { bar: 4, noteId: null }, 'nothing changed')
  editor.clearSelection()
  assert.equal(editor.photo.value, null)

  assert.deepEqual(await editor.photos(), [
    { page: 1, n: 1, url: 'fake://image/pieces/piece-1/pages/1/source.jpg' },
    { page: 2, n: 2, url: 'fake://image/pieces/piece-1/pages/2/source.jpg' },
  ])
  assert.equal(await editor.photoUrl({ page: 2, n: 2, bar: 3, box: BOX }), 'fake://image/pieces/piece-1/pages/2/source.jpg')
  assert.equal(photoOf([], 1), null)
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
  assert.equal(i18n.t('warnings.count', { count: editor.warningCount.value }), '2 things to check')
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

  // a clean editor leaves without asking
  router.push({ name: 'editor', pieceId: 'piece-1' })
  const clean = await openEditor(s.deps, 'piece-1')
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
  const note = notesOf(parseMusicXml(saved.musicxml).measures[0]!).find((n) => n.id === c5)!
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

test('preview: only the selected bar plays, with the correction, at the practice tempo and with the instrument in use', async () => {
  const { editor, played } = await setup({ practiceTempo: 66 })
  assert.equal(editor.barPreview(), undefined, 'nothing selected, nothing to preview')
  await editor.previewBar()
  assert.equal(played.length, 0)

  const [e5] = idsOf(editor, 3)
  editor.select(e5!)
  editor.apply((score) => stepPitch(score, e5!, -1)) // E5 -> D5
  const preview = editor.barPreview()!
  assert.equal(preview.bar, 3)
  assert.equal(preview.bpm, 66, 'the tempo the user practises at')
  assert.equal(preview.instrument.id, 'tenor-sax')
  assert.equal(preview.score.measures.length, 1)
  assert.deepEqual(preview.score.measures[0]!.time, { beats: 3, beatType: 4 }, 'the time in force at bar 3')
  assert.equal(preview.score.measures[0]!.clef?.sign, 'G')
  assert.deepEqual(notesOf(preview.score.measures[0]!).map((n) => n.pitch!.step), ['D', 'E'])

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
  s.measures[1]!.rightBarline = { repeat: 'backward' }
  const before = structuredClone(s)
  const excerpt = barExcerpt(s, 1)
  assert.equal(excerpt.measures[0]!.rightBarline, undefined)
  assert.deepEqual(excerpt.measures[0]!.time, { beats: 3, beatType: 4 })
  assert.deepEqual(s, before)
  assert.deepEqual(barExcerpt(s, 9), { measures: [] })
})
