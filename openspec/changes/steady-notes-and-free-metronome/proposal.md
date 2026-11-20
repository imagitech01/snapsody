# Proposal

## Why

Two things get in the way of practising.

1. The metronome only clicks while the piece plays. Sometimes the user wants only a metronome, without the music.
2. Long notes (quarter notes and longer) of the saxophones waver in pitch. The wobble is recorded into the SoundFont's samples: measured on the bundled files, the alto sax moves 15 to 45 cents at 4 to 5 Hz from the start of the note, the tenor sax 8 to 30 cents from about half a second in, and the short sustain loop repeats it for as long as the note lasts. The clarinet is steady (under 1 cent). The sampler itself adds no modulation. A practice reference has to be a steady pitch.

## What Changes

- **Metronome on its own.** Switching the metronome on while the piece is not playing (stopped or paused) starts the clicks at once, at the current tempo, in the time signature of the bar the piece would start from, first beat accented. Switching it off stops them. Pressing Play hands over to the music: the free clicks stop and the piece starts as before (count-in if set), with the metronome in time with it. Pausing or stopping the music is silent, as today. A piece that opens with its remembered metronome on does not start clicking by itself. Leaving the practice screen, or the app going to the background, stops the clicks.
- **Steady notes.** The converter removes the recorded vibrato when it builds the sample sets: the pitch of each looped note is tracked and resampled to a constant pitch, and its level after the attack is evened out. It is an option per instrument in `tools/samples/instruments.json`, on for the tenor sax, the alto sax and the trumpet, which the user picked by ear from a side-by-side page of all instruments. The other instruments are not touched. Those three sample sets are regenerated.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `practice-controls`: the Metronome requirement also covers the metronome on its own.
- `instruments`: adds the requirement "Steady notes".

## Impact

- `web/src/core/playback/`: a small free-running metronome on the existing clock, timer and click output, owned by `Player`.
- `web/src/app/practiceSession.ts`, `web/src/ui/screens/PracticeScreen.tsx`, texts in `en.ts` and `nl.ts`.
- `tools/samples/convert_soundfont.py`, `tools/samples/instruments.json`, `web/public/samples/*` (regenerated), `docs/samples.md`.
- Stored formats do not change.
