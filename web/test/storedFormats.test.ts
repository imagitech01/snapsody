import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { DEFAULT_PRACTICE, PIECE_FORMAT, createLibrary } from '../src/app/library.ts'
import { DEFAULT_SETTINGS, loadSettings } from '../src/app/settings.ts'
import { parseMusicXml } from '../src/core/score/musicxml.ts'
import { createFakePlatform } from '../src/platform/fake/index.ts'
import type { FakeFiles } from '../src/platform/fake/index.ts'

// Stored pieces stay readable (practice-app task 8.3, spec `test-suite` "Stored exercises stay
// readable"). `fixtures/stores/<version>/` is a committed copy of the app's data folder in each
// storage format the app has written since pieces were introduced: `pieces/<id>/...` and
// `settings.json`, made from self-made material (the two-page fixture). Each is put in the fake
// platform's files and opened with the current library and settings code, as the app does after an
// update. A change to the format adds a folder for its own version and never edits the old ones;
// this test then loads that one too, and fails when the current code cannot open any of them.

const STORES = fileURLToPath(new URL('./fixtures/stores/', import.meta.url))

const versions = readdirSync(STORES)
  .filter((name) => statSync(`${STORES}${name}`).isDirectory())
  .sort()

/** The files of one stored version, in fake files seeded from disk (binary photos too). */
function openStore(version: string): FakeFiles {
  const { files } = createFakePlatform()
  const root = `${STORES}${version}/`
  for (const relative of readdirSync(root, { recursive: true })) {
    if (statSync(`${root}${relative}`).isFile()) files.seed(relative, readFileSync(`${root}${relative}`))
  }
  return files
}

/** The folder names under `pieces/` in a stored version, read from disk. */
function storedPieceIds(version: string): string[] {
  return readdirSync(`${STORES}${version}/pieces`)
    .filter((name) => statSync(`${STORES}${version}/pieces/${name}`).isDirectory())
    .sort()
}

test('stored formats: there is a store for the current format', () => {
  assert.ok(versions.includes(`v${PIECE_FORMAT}`), `no fixtures/stores/v${PIECE_FORMAT}/ (found: ${versions.join(', ')})`)
})

for (const version of versions) {
  test(`stored formats: ${version} lists, loads, and can still be written by the current code`, async () => {
    const files = openStore(version)
    const expected = storedPieceIds(version)
    assert.ok(expected.length > 0, `${version}: no piece folders`)

    const library = createLibrary(files)
    assert.deepEqual(await library.sweep(), { removed: [], restored: [] }, `${version}: a committed store has nothing to sweep`)
    const { pieces, problems } = await library.list()
    assert.deepEqual(problems, [], `${version}: every stored piece is readable`)
    assert.deepEqual(pieces.map((p) => p.id).sort(), expected, `${version}: every stored piece is listed`)

    for (const listed of pieces) {
      const where = `${version}/${listed.id}`
      const { info, musicxml } = await library.load(listed.id)
      assert.deepEqual(info, listed, `${where}: load and list agree`)
      assert.ok(info.name.trim() !== '', `${where}: a name`)

      // the corrected score is a score with as many bars as piece.json says
      assert.equal(parseMusicXml(musicxml).measures.length, info.bars, `${where}: bars`)

      // the pages cover the bars one after the other, and each has its photo and its raw reading
      assert.deepEqual(info.pages.map((p) => p.n), info.pages.map((_, i) => i + 1), `${where}: pages are numbered 1, 2, ...`)
      let nextBar = 1
      for (const page of info.pages) {
        assert.equal(page.firstBar, nextBar, `${where}: page ${page.n} starts where the last one ended`)
        nextBar = page.lastBar + 1
        const photo = files.bytes(`pieces/${info.id}/pages/${page.n}/source.jpg`)
        assert.ok(photo && photo[0] === 0xff && photo[1] === 0xd8, `${where}: page ${page.n} photo is a JPEG`)
        assert.match(await library.pageImageUrl(info.id, page.n), /source\.jpg$/, `${where}: page ${page.n} photo has a URL`)
        const reading = files.text(`pieces/${info.id}/pages/${page.n}/recognised.musicxml`)
        assert.ok(reading !== undefined && parseMusicXml(reading).measures.length > 0, `${where}: page ${page.n} raw reading`)
        // the staves, when there are any, cover exactly the bars of the page, in order
        if (page.staves.length > 0) {
          let bar = page.firstBar
          for (const staff of page.staves) {
            assert.equal(staff.firstBar, bar, `${where}: page ${page.n} staves follow each other`)
            bar = staff.lastBar + 1
          }
          assert.equal(bar, page.lastBar + 1, `${where}: page ${page.n} staves cover the page`)
        }
      }
      assert.equal(nextBar - 1, info.bars, `${where}: the pages cover every bar`)

      // practice state: restored when there is some
      const practice = await library.readPractice(info.id)
      if (practice !== null) assert.ok(practice.bar >= 1 && practice.bar <= info.bars, `${where}: practice bar inside the piece`)

      // still writable with the current code: rename, star, practice state, a corrected score
      const readings = info.pages.map((p) => files.text(`pieces/${info.id}/pages/${p.n}/recognised.musicxml`))
      await library.update(info.id, { name: 'Renamed', favorite: !info.favorite })
      await library.writePractice(info.id, { ...DEFAULT_PRACTICE, bar: 2, tempo: 90 })
      await library.writeScore(info.id, musicxml, info.score)
      const after = await library.load(info.id)
      assert.notEqual(after.info.score, info.score, `${where}: the corrected score went to a new file`)
      assert.equal(files.text(`pieces/${info.id}/${info.score}`), undefined, `${where}: the old score file is gone`)
      assert.equal(after.musicxml, musicxml, `${where}: the score reads back`)
      assert.equal(after.info.name, 'Renamed', `${where}: renamed`)
      assert.equal(after.info.favorite, !info.favorite, `${where}: starred`)
      assert.deepEqual(await library.readPractice(info.id), { ...DEFAULT_PRACTICE, bar: 2, tempo: 90 }, `${where}: practice saved`)
      assert.deepEqual(info.pages.map((p) => files.text(`pieces/${info.id}/pages/${p.n}/recognised.musicxml`)), readings, `${where}: raw readings unchanged`)
    }

    // settings, when the store has any, load without falling back to anything invalid
    if (files.text('settings.json') !== undefined) {
      const settings = await loadSettings(files)
      // A setting added since the store was written (the count-in, design D17) reads as its default.
      // A pitchReference from before design D19 is ignored.
      const { pitchReference: _ignored, ...stored } = JSON.parse(files.text('settings.json')!) as Record<string, unknown>
      assert.deepEqual(settings.snapshot(), { ...DEFAULT_SETTINGS, ...stored }, `${version}: settings.json is read as it was written`)
    }
  })
}

test('stored formats: v2 holds the piece the app wrote, with every field read back', async () => {
  const files = openStore('v2')
  const library = createLibrary(files)
  const { info, musicxml } = await library.load('00000000-0000-4000-8000-000000000002')
  assert.deepEqual(
    { ...info, pages: info.pages.map((p) => ({ n: p.n, firstBar: p.firstBar, lastBar: p.lastBar, staves: p.staves.map((s) => [s.firstBar, s.lastBar]) })) },
    {
      format: 2,
      id: '00000000-0000-4000-8000-000000000002',
      name: 'Waltz study in G',
      created: '2026-11-18T14:05:00.000Z',
      lastPracticed: '2026-11-18T16:20:00.000Z',
      favorite: true,
      score: 'score-1.musicxml',
      pages: [
        { n: 1, firstBar: 1, lastBar: 8, staves: [[1, 5], [6, 8]] },
        { n: 2, firstBar: 9, lastBar: 14, staves: [[9, 13], [14, 14]] },
      ],
      repairs: [],
      bars: 14,
    },
  )
  assert.deepEqual(info.pages[1]!.staves[1]!.box, { x: 0.034, y: 0.593, width: 0.179, height: 0.253 })
  assert.equal(parseMusicXml(musicxml).measures[0]!.time?.beats, 3)
  // The fixture's practice.json still has countIn and follow, from before they left it (design D17): they are ignored.
  assert.deepEqual(await library.readPractice(info.id), { bar: 10, tempo: 72, loop: { start: 9, end: 12 }, loopRest: 1, metronome: true })
  const settings = await loadSettings(files)
  // Its settings.json has no countIn yet (off), and still has a pitchReference from before design D19: ignored.
  assert.deepEqual(settings.snapshot(), { defaultInstrument: 'clarinet', countIn: false, language: 'nl', scanHintSeen: true })
})
