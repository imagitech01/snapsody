import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { SOUND_CREDITS } from '../src/app/credits.ts'

// The credits the Settings screen shows (practice-app task 12.3, spec `instruments` "Recorded instrument sounds") are
// the SoundFont's own acknowledgements, which its licence asks to travel with the app. They are copied into
// `src/app/credits.ts`, so this checks that they are still the ones in `NOTICE` (the repository's record of the
// licences) and `docs/samples.md` (where the choice of the SoundFont is recorded), whatever the white space.

const read = (path: string): string => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const flat = (text: string): string => text.replace(/\s+/g, ' ')

test('credits: the acknowledgements, licence and source are those recorded in NOTICE and docs/samples.md', () => {
  const notice = flat(read('../../NOTICE'))
  const samples = flat(read('../../docs/samples.md'))
  assert.match(SOUND_CREDITS.name, /^MuseScore_General 0\.2$/)
  assert.ok(notice.includes(`${SOUND_CREDITS.name.replace(' 0.2', '')} 0.2`), 'NOTICE names the same SoundFont and version')
  assert.ok(notice.includes(`- ${SOUND_CREDITS.licence}`), 'NOTICE has the same licence')
  assert.ok(notice.includes(SOUND_CREDITS.source), 'NOTICE has the same source')
  for (const line of [...SOUND_CREDITS.acknowledgements, ...SOUND_CREDITS.copyright]) {
    assert.ok(notice.includes(flat(line)), `NOTICE does not have: ${line}`)
    assert.ok(samples.includes(flat(line)), `docs/samples.md does not have: ${line}`)
  }
  assert.equal(SOUND_CREDITS.acknowledgements.length, 5, 'the five acknowledgements the licence lists')
})
