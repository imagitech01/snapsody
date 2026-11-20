import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { INSTRUMENTS } from '../src/core/instruments/instruments.ts'
import { buildTimeline } from '../src/core/playback/timeline.ts'
import { parseMusicXml } from '../src/core/score/musicxml.ts'
import { phrasesFor, scaleRoot } from '../dev/phrases.ts'
import { firstLine } from './helpers.ts'

// The phrases of the listening page (web/dev/listen.html) are made of real music: they have to parse, stay
// inside what each instrument can play and what its sample folder covers, and be slurred, short, held, accented
// and rising as their buttons say. (That the page plays them is checked in a browser, see docs/samples.md.)

const CONFIG = fileURLToPath(new URL('../../tools/samples/instruments.json', import.meta.url))
const config = JSON.parse(readFileSync(CONFIG, 'utf8')) as { instruments: Record<string, { range: [number, number] }> }

test('listening phrases: every instrument has the seven phrases, in its written range and inside its sample folder', () => {
  for (const instrument of INSTRUMENTS) {
    const phrases = phrasesFor(instrument)
    assert.deepEqual(phrases.map((p) => p.id), ['legato', 'staccato', 'held-low', 'held-mid', 'held-high', 'accent', 'crescendo'], instrument.id)
    const [lo, hi] = config.instruments[instrument.sound]!.range
    for (const phrase of phrases) {
      const timeline = buildTimeline(firstLine(parseMusicXml(phrase.xml)), instrument)
      const pitched = timeline.events.filter((e) => !e.rest)
      assert.deepEqual(pitched.flatMap((e) => e.written), phrase.written, `${instrument.id} ${phrase.id}: what is written is what is played`)
      for (const midi of phrase.written) {
        assert.ok(midi >= instrument.writtenRange.low && midi <= instrument.writtenRange.high, `${instrument.id} ${phrase.id}: written ${midi} is outside the instrument's range`)
      }
      for (const midi of pitched.flatMap((e) => e.pitches)) {
        assert.ok(midi >= lo && midi <= hi, `${instrument.id} ${phrase.id}: sounding ${midi} is outside its samples (${lo}..${hi})`)
      }
    }
  }
})

test('listening phrases: the scale starts on a C, with room for an octave', () => {
  for (const instrument of INSTRUMENTS) {
    const root = scaleRoot(instrument)
    assert.equal(root % 12, 0, instrument.id)
    assert.ok(root >= instrument.writtenRange.low && root + 12 <= instrument.writtenRange.high, instrument.id)
  }
  assert.equal(scaleRoot(INSTRUMENTS[0]!), 72, 'the tenor saxophone: written C5')
})

test('listening phrases: legato is one slur (every note after the first slurred), staccato is short, a held note is long and tied', () => {
  for (const instrument of INSTRUMENTS) {
    const by = Object.fromEntries(phrasesFor(instrument).map((p) => [p.id, buildTimeline(firstLine(parseMusicXml(p.xml)), instrument)]))
    const legato = by.legato!.events
    assert.equal(legato.length, 15, 'eight up, six down and the root')
    assert.deepEqual(legato.map((e) => e.attack), [true, ...Array<boolean>(14).fill(false)], `${instrument.id}: the whole scale is slurred`)
    const staccato = by.staccato!.events
    assert.ok(staccato.every((e) => e.attack && e.staccato), `${instrument.id}: every staccato note is struck and short`)
    for (const id of ['held-low', 'held-mid', 'held-high']) {
      const held = by[id]!.events
      assert.equal(held.length, 1, `${id}: the two tied whole notes are one note`)
      assert.equal(held[0]!.length.n / held[0]!.length.d, 8, `${id}: 8 beats, 8 s at the 60 bpm of the phrase`)
    }
    assert.deepEqual(phrasesFor(instrument).filter((p) => p.bpm !== undefined).map((p) => [p.id, p.bpm]), [['held-low', 60], ['held-mid', 60], ['held-high', 60]])
  }
})

test('listening phrases: the accents are on beats 1 and 3, at mf and then ff, and the crescendo rises from pp to ff', () => {
  const instrument = INSTRUMENTS[0]!
  const phrases = phrasesFor(instrument)
  const accent = buildTimeline(firstLine(parseMusicXml(phrases.find((p) => p.id === 'accent')!.xml)), instrument).events
  assert.deepEqual(accent.map((e) => e.accent), [true, false, true, false, true, false, true, false])
  assert.deepEqual(accent.map((e) => e.dynamic), ['mf', 'mf', 'mf', 'mf', 'ff', 'ff', 'ff', 'ff'])
  assert.ok(accent.every((e) => e.attackGain <= 1), 'no attack above full scale')
  assert.ok(accent[0]!.attackGain > accent[0]!.gain * 1.5, 'the mf accent is +4 dB')
  const cresc = buildTimeline(firstLine(parseMusicXml(phrases.find((p) => p.id === 'crescendo')!.xml)), instrument).events.map((e) => e.gain)
  assert.equal(cresc.length, 9)
  assert.ok(cresc.slice(0, 8).every((g, i) => i === 0 || g > cresc[i - 1]!), `each note louder than the one before: ${cresc}`)
  assert.equal(cresc[0], 0.2, 'from pp')
  assert.equal(cresc[8], 0.92, 'to ff')
})
