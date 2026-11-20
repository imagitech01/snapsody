import assert from 'node:assert/strict'
import { test } from 'node:test'
import { frac } from '../src/core/score/rational.ts'
import {
  DEFAULT_TEMPO,
  TEMPO_WORDS,
  clampTempo,
  countInClicks,
  meterBeatUnit,
  startingTempo,
  tempoFromWords,
  tempoSetup,
  unitName,
} from '../src/core/playback/tempo.ts'
import { barOf, n, scoreOf } from './playbackHelpers.ts'
import { firstLine } from './helpers.ts'

const words = (w: string): string => `<direction><direction-type><words>${w}</words></direction-type></direction>`
const metronome = (unit: string, perMinute: number, dot = false): string =>
  `<direction><direction-type><metronome><beat-unit>${unit}</beat-unit>${dot ? '<beat-unit-dot/>' : ''}<per-minute>${perMinute}</per-minute></metronome></direction-type></direction>`
const bars = [barOf('C')]

// 12.3: the tempo-word table

test('tempo words: common words map to typical values, in order from slow to fast', () => {
  const order = ['largo', 'larghetto', 'adagio', 'andante', 'moderato', 'allegretto', 'allegro', 'vivace', 'presto', 'prestissimo']
  const values = order.map((w) => TEMPO_WORDS[w]!)
  assert.deepEqual([...values].sort((a, b) => a - b), values, 'monotonic')
  assert.equal(tempoFromWords('Moderato'), TEMPO_WORDS.moderato)
  assert.ok(TEMPO_WORDS.moderato! > 80, 'a Moderato exercise does not start at the 80 fallback')
  assert.equal(tempoFromWords('ALLEGRO con brio'), TEMPO_WORDS.allegro)
  assert.equal(tempoFromWords('Allegretto (swing)'), TEMPO_WORDS.allegretto, 'allegretto is not read as allegro')
  assert.equal(tempoFromWords('Andantino'), TEMPO_WORDS.andantino)
  assert.equal(tempoFromWords('Larghetto'), TEMPO_WORDS.larghetto)
  assert.equal(tempoFromWords('Allegro moderato'), TEMPO_WORDS['allegro moderato'])
  assert.equal(tempoFromWords('dolce'), undefined)
  assert.equal(tempoFromWords(undefined), undefined)
  assert.equal(tempoFromWords('preston'), undefined, 'whole words only')
})

test('tempo words: every table value is inside the user range once clamped', () => {
  for (const v of Object.values(TEMPO_WORDS)) assert.ok(clampTempo(v) >= 30 && clampTempo(v) <= 200)
  assert.equal(clampTempo(500), 200)
  assert.equal(clampTempo(3), 30)
})

// 12.3: precedence metronome > word > 80, then the remembered tempo

test('default tempo: no marking gives 80 beats per minute', () => {
  const setup = tempoSetup(firstLine(scoreOf(bars)))
  assert.equal(setup.defaultBpm, DEFAULT_TEMPO)
  assert.equal(setup.defaultBpm, 80)
  assert.equal(setup.source, 'default')
})

test('default tempo: a tempo word is looked up in the table', () => {
  const setup = tempoSetup(firstLine(scoreOf(bars, [4, 4], words('Moderato'))))
  assert.equal(setup.defaultBpm, TEMPO_WORDS.moderato)
  assert.equal(setup.source, 'words')
})

test('default tempo: a metronome mark wins over a tempo word', () => {
  const setup = tempoSetup(firstLine(scoreOf(bars, [4, 4], words('Allegro') + metronome('quarter', 66))))
  assert.equal(setup.defaultBpm, 66)
  assert.equal(setup.source, 'metronome')
})

test('default tempo: the metronome mark sets the beat unit, else the metre does', () => {
  const dottedInFourFour = tempoSetup(firstLine(scoreOf(bars, [4, 4], metronome('quarter', 100, true))))
  assert.deepEqual(dottedInFourFour.unit, frac(3, 2))
  assert.equal(dottedInFourFour.unitName, 'dotted quarter')
  assert.equal(tempoSetup(firstLine(scoreOf(bars, [6, 8], metronome('quarter', 90)))).unitName, 'quarter', "the mark's own unit wins over 6/8")
  assert.equal(tempoSetup(firstLine(scoreOf(bars, [6, 8]))).unitName, 'dotted quarter')
})

test('default tempo: a mark outside 30-200 is clamped', () => {
  assert.equal(tempoSetup(firstLine(scoreOf(bars, [4, 4], metronome('quarter', 240)))).defaultBpm, 200)
  assert.equal(tempoSetup(firstLine(scoreOf(bars, [4, 4], metronome('quarter', 20)))).defaultBpm, 30)
})

test('remembered tempo: the last chosen tempo wins over everything the score says', () => {
  const marked = tempoSetup(firstLine(scoreOf(bars, [4, 4], metronome('quarter', 66))))
  assert.equal(startingTempo(60, marked), 60)
  assert.equal(startingTempo(null, marked), 66)
  assert.equal(startingTempo(undefined, tempoSetup(firstLine(scoreOf(bars)))), 80)
  assert.equal(startingTempo(999, marked), 200, 'a stored value is kept in range')
})

// beat units per metre

test('beat unit by metre: quarter, half, dotted quarter, eighth', () => {
  const unit = (beats: number, beatType: number): string => unitName(meterBeatUnit({ beats, beatType }))
  assert.equal(unit(4, 4), 'quarter')
  assert.equal(unit(3, 4), 'quarter')
  assert.equal(unit(2, 2), 'half')
  assert.equal(unit(3, 2), 'half')
  assert.equal(unit(6, 8), 'dotted quarter')
  assert.equal(unit(9, 8), 'dotted quarter')
  assert.equal(unit(12, 8), 'dotted quarter')
  assert.equal(unit(3, 8), 'eighth')
  assert.equal(unit(5, 8), 'eighth')
  assert.equal(unit(7, 8), 'eighth')
})

test('count-in clicks: one bar of beats in the metre', () => {
  const clicks = (beats: number, beatType: number, unit = meterBeatUnit({ beats, beatType })): number =>
    countInClicks(firstLine(scoreOf([{ body: n({}) }], [beats, beatType])), 0, unit)
  assert.equal(clicks(3, 4), 3, '1-2-3')
  assert.equal(clicks(4, 4), 4)
  assert.equal(clicks(2, 2), 2)
  assert.equal(clicks(6, 8), 2, '1-2')
  assert.equal(clicks(9, 8), 3)
  assert.equal(clicks(12, 8), 4)
  assert.equal(clicks(5, 8), 5)
  assert.equal(clicks(3, 8), 3)
  assert.equal(clicks(6, 8, frac(1)), 3, 'a quarter-note metronome mark in 6/8 counts three quarters')
})
