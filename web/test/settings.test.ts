import assert from 'node:assert/strict'
import { test } from 'node:test'
import { effect } from '@preact/signals'
import { DEFAULT_SETTINGS, loadSettings, normaliseSettings } from '../src/app/settings.ts'
import { INSTRUMENTS } from '../src/core/instruments/instruments.ts'
import { tempSuffix } from '../src/platform/atomicWrite.ts'
import { createFakePlatform } from '../src/platform/fake/index.ts'
import { PlatformError } from '../src/platform/port.ts'

// The general settings (practice-app task 8.2, design D4/D8/D13, spec `app-shell` "General
// settings" and `instruments` "Default instrument"; the pitch reference setting is gone, design D19) against the fake
// platform. A "restart" is a new settings object on the same files.

test('defaults: tenor saxophone, the device language, the scan hint not seen', async () => {
  const { files } = createFakePlatform()
  const settings = await loadSettings(files)
  assert.equal(settings.defaultInstrument.value, 'tenor-sax')
  assert.equal(settings.language.value, null)
  assert.equal(settings.scanHintSeen.value, false)
  assert.equal(settings.countIn.value, false)
  assert.deepEqual(settings.snapshot(), { defaultInstrument: 'tenor-sax', countIn: false, language: null, scanHintSeen: false })
  assert.deepEqual(settings.snapshot(), DEFAULT_SETTINGS)
  assert.deepEqual(files.paths(), [], 'loading writes nothing')
})

test('a value survives a reload, each setting and all together', async () => {
  const { files } = createFakePlatform()
  const settings = await loadSettings(files)
  await settings.setDefaultInstrument('clarinet')
  await settings.setCountIn(true)
  await settings.setLanguage('nl')
  await settings.setScanHintSeen()
  assert.deepEqual(files.paths(), ['settings.json'], 'one file, no temp left over')
  assert.deepEqual(JSON.parse(files.text('settings.json')!), { defaultInstrument: 'clarinet', countIn: true, language: 'nl', scanHintSeen: true })

  const reloaded = await loadSettings(files)
  assert.equal(reloaded.defaultInstrument.value, 'clarinet')
  assert.equal(reloaded.countIn.value, true)
  assert.equal(reloaded.language.value, 'nl')
  assert.equal(reloaded.scanHintSeen.value, true)

  // back to the device language, and the hint can be reset
  await reloaded.setLanguage(null)
  await reloaded.setScanHintSeen(false)
  await reloaded.setCountIn(false)
  const again = await loadSettings(files)
  assert.deepEqual(again.snapshot(), { defaultInstrument: 'clarinet', countIn: false, language: null, scanHintSeen: false })
})

test('a change takes effect at once, before it is saved', async () => {
  const { files } = createFakePlatform()
  const settings = await loadSettings(files)
  const seen: boolean[] = []
  const stop = effect(() => {
    seen.push(settings.countIn.value)
  })
  const saved = settings.setCountIn(true)
  assert.equal(settings.countIn.value, true, 'the signal moved before the write finished')
  assert.deepEqual(seen, [false, true])
  await saved
  stop()
  const other = settings.setLanguage('en')
  assert.equal(settings.language.value, 'en')
  await other
})

test('the pitch reference is gone: an old file that has one loads, and it is not written back', async () => {
  const { files } = createFakePlatform()
  files.seed('settings.json', JSON.stringify({ defaultInstrument: 'clarinet', pitchReference: 442, countIn: true, language: 'nl', scanHintSeen: true }))
  const settings = await loadSettings(files)
  assert.deepEqual(settings.snapshot(), { defaultInstrument: 'clarinet', countIn: true, language: 'nl', scanHintSeen: true })
  assert.ok(!('pitchReference' in settings.snapshot()))
  assert.ok(!('pitchReference' in normaliseSettings({ pitchReference: 442 })))
  await settings.setCountIn(false)
  assert.ok(!('pitchReference' in JSON.parse(files.text('settings.json')!)), 'the next save drops it')
})

test('a missing, broken or wrongly shaped file gives the defaults and the app starts', async () => {
  for (const content of [undefined, '', '{not json', 'null', '[1, 2]', '42', '"text"']) {
    const { files } = createFakePlatform()
    if (content !== undefined) files.seed('settings.json', content)
    const settings = await loadSettings(files)
    assert.deepEqual(settings.snapshot(), DEFAULT_SETTINGS, JSON.stringify(content))
    assert.equal(settings.readOnly, false, 'nothing worth keeping: the next save replaces it')
    await settings.setCountIn(true)
    assert.equal(JSON.parse(files.text('settings.json')!).countIn, true)
  }
})

test('an unknown or invalid instrument id falls back to the default, and so does a hidden one', async () => {
  const hidden = INSTRUMENTS.find((i) => i.hidden)
  for (const id of ['theremin', '', 'TENOR-SAX', 7, null, {}, ...(hidden ? [hidden.id] : [])]) {
    const { files } = createFakePlatform()
    files.seed('settings.json', JSON.stringify({ defaultInstrument: id, pitchReference: 441, language: 'nl', scanHintSeen: true }))
    const settings = await loadSettings(files)
    assert.equal(settings.defaultInstrument.value, 'tenor-sax', JSON.stringify(id))
    assert.deepEqual([settings.language.value, settings.scanHintSeen.value], ['nl', true], 'the valid values stay')
  }
  // every instrument the user is offered is kept
  for (const instrument of INSTRUMENTS.filter((i) => !i.hidden)) {
    assert.equal(normaliseSettings({ defaultInstrument: instrument.id }).defaultInstrument, instrument.id)
  }
})

test('other invalid values fall back one by one: count-in, language and the hint flag', () => {
  assert.deepEqual(normaliseSettings({ defaultInstrument: 'piano', countIn: 'yes', language: 'fr', scanHintSeen: 'yes' }), {
    defaultInstrument: 'piano',
    countIn: false,
    language: null,
    scanHintSeen: false,
  })
  assert.equal(normaliseSettings({ language: 'en' }).language, 'en')
  assert.equal(normaliseSettings({ language: 'nl' }).language, 'nl')
  assert.equal(normaliseSettings({ scanHintSeen: true }).scanHintSeen, true)
  assert.equal(normaliseSettings({ countIn: true }).countIn, true)
})

test('setting an instrument or language the app does not have is refused and changes nothing', async () => {
  const { files } = createFakePlatform()
  const settings = await loadSettings(files)
  await assert.rejects(settings.setDefaultInstrument('theremin'), /not an instrument/)
  const hidden = INSTRUMENTS.find((i) => i.hidden)
  if (hidden) await assert.rejects(settings.setDefaultInstrument(hidden.id), /not an instrument/)
  await assert.rejects(settings.setLanguage('fr' as 'en'), /not a language/)
  assert.deepEqual(settings.snapshot(), DEFAULT_SETTINGS)
  assert.deepEqual(files.paths(), [])
})

test('a save cut off between the temp file and the rename leaves the old settings; the next start removes the stray file, since settings.json is there', async () => {
  const { files } = createFakePlatform()
  const settings = await loadSettings(files)
  await settings.setDefaultInstrument('clarinet')
  files.fault = (operation) => {
    if (operation === 'rename' || operation === 'remove') throw new Error('process died')
  }
  await assert.rejects(settings.setDefaultInstrument('guitar'), /process died/)
  files.fault = undefined
  assert.equal(settings.defaultInstrument.value, 'guitar', 'this run keeps what the user set')
  assert.deepEqual(files.paths().filter((p) => p.startsWith('settings.json.tmp-')).length, 1)
  assert.equal(JSON.parse(files.text('settings.json')!).defaultInstrument, 'clarinet')

  const restarted = await loadSettings(files)
  assert.equal(restarted.defaultInstrument.value, 'clarinet', 'after a restart: the old value')
  assert.deepEqual(files.paths(), ['settings.json'], 'the stray temp file is gone')
  await restarted.setDefaultInstrument('piano')
  assert.equal((await loadSettings(files)).defaultInstrument.value, 'piano', 'and saving works again')
})

test('a save cut off after the rename deleted settings.json (Android): the next start promotes the temp file', async () => {
  const { files } = createFakePlatform()
  const settings = await loadSettings(files)
  await settings.setDefaultInstrument('clarinet')
  files.fault = (operation) => {
    if (operation === 'rename' || operation === 'remove') throw new Error('process died')
  }
  await assert.rejects(settings.setDefaultInstrument('guitar'), /process died/)
  files.fault = undefined
  await files.remove('settings.json') // the delete half of a delete-then-rename
  assert.equal(files.paths().filter((p) => p.startsWith('settings.json.tmp-')).length, 1)

  const restarted = await loadSettings(files)
  assert.equal(restarted.defaultInstrument.value, 'guitar', 'the temp file held the only copy, and it is the settings now')
  assert.equal(restarted.readOnly, false)
  assert.deepEqual(files.paths(), ['settings.json'])
  assert.equal(JSON.parse(files.text('settings.json')!).defaultInstrument, 'guitar')
})

test('of several temp files without settings.json the newest that is JSON is promoted; one that is not JSON is removed', async () => {
  const { files } = createFakePlatform()
  files.seed(`settings.json.tmp-${tempSuffix(1000)}`, JSON.stringify({ defaultInstrument: 'clarinet' }))
  files.seed(`settings.json.tmp-${tempSuffix(2000)}`, JSON.stringify({ defaultInstrument: 'guitar' }))
  files.seed(`settings.json.tmp-${tempSuffix(3000)}`, '{"pitchRef')
  files.seed('other.json.tmp-1', '{}')
  assert.equal((await loadSettings(files)).defaultInstrument.value, 'guitar')
  assert.deepEqual(files.paths(), ['other.json.tmp-1', 'settings.json'], 'only its own temp files')

  const broken = createFakePlatform().files
  broken.seed('settings.json.tmp-1', '{"cut')
  const settings = await loadSettings(broken)
  assert.deepEqual([settings.snapshot(), settings.readOnly], [DEFAULT_SETTINGS, false])
  assert.deepEqual(broken.paths(), [])
})

test('a folder that cannot be listed: a temp file may hold the only copy, so nothing is written until a start can look', async () => {
  const { files } = createFakePlatform()
  const temp = `settings.json.tmp-${tempSuffix(1000)}`
  files.seed(temp, JSON.stringify({ defaultInstrument: 'guitar' }))
  files.fault = (operation) => {
    if (operation === 'list') throw new PlatformError('failed', 'I/O error')
  }
  const settings = await loadSettings(files)
  assert.deepEqual([settings.snapshot(), settings.readOnly], [DEFAULT_SETTINGS, true])
  await assert.rejects(settings.setDefaultInstrument('piano'), /could not be read/)
  files.fault = undefined
  assert.deepEqual(files.paths(), [temp], 'the temp file is untouched and no settings.json was written')

  const restarted = await loadSettings(files)
  assert.deepEqual([restarted.defaultInstrument.value, restarted.readOnly], ['guitar', false])
  assert.deepEqual(files.paths(), ['settings.json'])
})

test('settings.json that cannot be read: the defaults, but nothing is written over it until a start reads it', async () => {
  for (const failure of [new PlatformError('failed', 'I/O error'), new Error('something else')]) {
    const { files } = createFakePlatform()
    files.seed('settings.json', JSON.stringify({ defaultInstrument: 'clarinet', language: 'nl', scanHintSeen: true }))
    const stored = files.text('settings.json')
    files.fault = (operation, paths) => {
      if (operation === 'read' && paths[0] === 'settings.json') throw failure
    }
    const settings = await loadSettings(files)
    assert.deepEqual(settings.snapshot(), DEFAULT_SETTINGS, failure.message)
    assert.equal(settings.readOnly, true)
    await assert.rejects(settings.setDefaultInstrument('piano'), /could not be read/)
    assert.equal(settings.defaultInstrument.value, 'piano', 'the change holds for this run')
    await assert.rejects(settings.setScanHintSeen(), /could not be read/)
    files.fault = undefined
    assert.equal(files.text('settings.json'), stored, 'the user\'s settings are not overwritten')

    const restarted = await loadSettings(files)
    assert.equal(restarted.readOnly, false)
    assert.equal(restarted.defaultInstrument.value, 'clarinet')
    await restarted.setDefaultInstrument('guitar')
    assert.equal(JSON.parse(files.text('settings.json')!).defaultInstrument, 'guitar', 'saving works again')
  }
})

test('a save that fails where the store can still see it leaves the old file and no temp file', async () => {
  const { files } = createFakePlatform()
  const settings = await loadSettings(files)
  await settings.setLanguage('nl')
  files.fault = (operation) => {
    if (operation === 'rename') throw new Error('disk full')
  }
  await assert.rejects(settings.setLanguage('en'), /disk full/)
  files.fault = undefined
  assert.deepEqual(files.paths(), ['settings.json'])
  assert.equal(JSON.parse(files.text('settings.json')!).language, 'nl')
  // the next change saves everything, including the value whose save failed
  await settings.setScanHintSeen()
  assert.deepEqual(JSON.parse(files.text('settings.json')!), { defaultInstrument: 'tenor-sax', countIn: false, language: 'en', scanHintSeen: true })
})

test('changes made one after the other without waiting are saved in order and the last one stays', async () => {
  const { files } = createFakePlatform()
  const settings = await loadSettings(files)
  const saves = [settings.setCountIn(true), settings.setLanguage('nl'), settings.setCountIn(false), settings.setDefaultInstrument('guitar')]
  await Promise.all(saves)
  const reloaded = await loadSettings(files)
  assert.equal(reloaded.countIn.value, false)
  assert.equal(reloaded.language.value, 'nl')
  assert.equal(reloaded.defaultInstrument.value, 'guitar')
  assert.deepEqual(files.paths(), ['settings.json'])
})

test('a failed save does not stop the saves after it', async () => {
  const { files } = createFakePlatform()
  const settings = await loadSettings(files)
  let fail = true
  files.fault = (operation) => {
    if (operation === 'rename' && fail) {
      fail = false
      throw new Error('disk full')
    }
  }
  const results = await Promise.allSettled([settings.setLanguage('nl'), settings.setLanguage('en')])
  assert.deepEqual(results.map((r) => r.status), ['rejected', 'fulfilled'])
  assert.equal((await loadSettings(files)).language.value, 'en')
})
