// A page for `npm run dev` only (never part of the build): the listening check of the instrument sounds
// (practice-app task 7.3, docs/samples.md "Listening check"). For every instrument, visible or hidden, it plays
// short phrases through the real Player, scheduler and sampler: a slurred scale, the same scale staccato, a long
// held note (low, middle, high), an accent phrase and a crescendo, with the metronome and the pitch reference
// switchable while it plays.
// Open it at http://localhost:5173/dev/listen.html (the port is the one `npm run dev` prints).

import { render } from 'preact'
import { signal } from '@preact/signals'
import { INSTRUMENTS } from '../src/core/instruments/instruments.ts'
import type { Instrument } from '../src/core/instruments/instruments.ts'
import { Player } from '../src/core/playback/player.ts'
import type { PlayerState } from '../src/core/playback/player.ts'
import { PITCH_REFERENCE_DEFAULT, PITCH_REFERENCE_MAX, PITCH_REFERENCE_MIN } from '../src/core/playback/samples.ts'
import { createWebAudioBackend } from '../src/core/playback/webBackend.ts'
import { parseMusicXml } from '../src/core/score/musicxml.ts'
import { phrasesFor } from './phrases.ts'
import type { Phrase } from './phrases.ts'

const state = signal<PlayerState>('stopped')
const playing = signal('')
const failure = signal('')
const clock = signal<number | undefined>(undefined)
const tempo = signal(96)
const reference = signal(PITCH_REFERENCE_DEFAULT)
const metronome = signal(false)

let current: Phrase | undefined

const player = new Player({
  instrument: INSTRUMENTS[0]!,
  loadScore: () => parseMusicXml(current!.xml),
  // The backend is made inside the first button press (a user gesture), as in the app.
  backend: (instrument) => createWebAudioBackend({ sound: instrument.sound, pitchReference: reference.value }),
  onState: (value) => {
    state.value = value
    if (value === 'stopped') playing.value = ''
  },
})

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error))

async function play(instrument: Instrument, phrase: Phrase): Promise<void> {
  failure.value = ''
  try {
    player.stop()
    current = phrase
    await player.setInstrument(instrument)
    player.setTempo(phrase.bpm ?? tempo.value)
    player.setMetronome(metronome.value)
    reference.value = player.setPitchReference(reference.value)
    playing.value = `${instrument.name}: ${phrase.label}`
    await player.play()
  } catch (error) {
    playing.value = ''
    failure.value = `${instrument.name}, ${phrase.label}: ${describe(error)}`
  }
}

function stop(): void {
  player.stop()
  playing.value = ''
}

// Playback errors that do not come out of a button press (a sample that fails to decode while playing).
window.addEventListener('error', (event) => {
  failure.value = `error: ${event.message}`
})
window.addEventListener('unhandledrejection', (event) => {
  failure.value = `error: ${describe(event.reason)}`
})

// The audio clock, to see that the context runs: it advances while playing.
setInterval(() => {
  clock.value = player.backendInstance?.currentTime
}, 250)

function Controls() {
  return (
    <div class="controls">
      <button type="button" class="stop" onClick={stop}>Stop</button>
      <label>
        Tempo{' '}
        <input
          type="number"
          id="tempo"
          min="30"
          max="200"
          step="1"
          value={tempo.value}
          onInput={(event) => {
            const bpm = Number((event.currentTarget as HTMLInputElement).value)
            if (!Number.isFinite(bpm) || bpm <= 0) return
            tempo.value = bpm
            if (player.state === 'playing' && current?.bpm === undefined) tempo.value = player.setTempo(bpm)
          }}
        />{' '}
        bpm
      </label>
      <label>
        Pitch reference A4{' '}
        <input
          type="number"
          id="reference"
          min={PITCH_REFERENCE_MIN}
          max={PITCH_REFERENCE_MAX}
          step="1"
          value={reference.value}
          onInput={(event) => {
            const hz = Number((event.currentTarget as HTMLInputElement).value)
            if (Number.isFinite(hz)) reference.value = player.setPitchReference(hz)
          }}
        />{' '}
        Hz
      </label>
      <label>
        <input
          type="checkbox"
          id="metronome"
          checked={metronome.value}
          onChange={(event) => {
            metronome.value = (event.currentTarget as HTMLInputElement).checked
            player.setMetronome(metronome.value)
          }}
        />{' '}
        Metronome
      </label>
    </div>
  )
}

function Row({ instrument }: { instrument: Instrument }) {
  const phrases = phrasesFor(instrument)
  return (
    <tr data-instrument={instrument.id}>
      <th scope="row">
        {instrument.name}
        {instrument.hidden ? <span class="tag">hidden until it passes this check</span> : null}
      </th>
      <td>
        {phrases.map((phrase) => (
          <button key={phrase.id} type="button" data-phrase={phrase.id} title={phrase.hint} onClick={() => void play(instrument, phrase)}>
            {phrase.label}
          </button>
        ))}
      </td>
    </tr>
  )
}

function Listen() {
  return (
    <main>
      <h1>Listening check of the instrument sounds</h1>
      <p>
        Every button plays through the real player and sampler (<code>samples/&lt;instrument&gt;/</code>). Use speakers or headphones, and
        compare the instruments with the same phrase and tempo. See <code>docs/samples.md</code>, "Listening check".
      </p>
      <Controls />
      <p class="status" role="status" id="status">
        {state.value === 'stopped' ? 'Stopped' : state.value === 'loading' ? 'Loading the sounds' : state.value === 'playing' ? 'Playing' : 'Paused'}
        {playing.value ? `: ${playing.value}` : ''}
        {' | audio clock '}
        <span id="clock">{clock.value === undefined ? 'not started' : `${clock.value.toFixed(2)} s`}</span>
      </p>
      <p class="status error" role="alert" id="error">{failure.value}</p>
      <div class="table">
        <table>
          <tbody>
            {INSTRUMENTS.map((instrument) => (
              <Row key={instrument.id} instrument={instrument} />
            ))}
          </tbody>
        </table>
      </div>
      <ul class="hints">
        <li>Legato: notes connect with no gap and no bump (piano and guitar notes are struck each time).</li>
        <li>Staccato: clearly short, no tail, click or thump at the release.</li>
        <li>Held low, mid, high (8 s at 60 bpm, whatever the tempo field says): no tick at each loop wrap, no slow pulse; piano and guitar die away.</li>
        <li>Accent: emphasis on beats 1 and 3 at mf, then at ff, where the accent has less room (the peak never goes above full scale).</li>
        <li>Crescendo: pp to ff over eight notes, each louder than the one before.</li>
        <li>Loudness: the instruments about equally loud, the metronome audible over each. Try the phrases at 50 and at 96 bpm.</li>
      </ul>
    </main>
  )
}

render(<Listen />, document.getElementById('listen')!)
