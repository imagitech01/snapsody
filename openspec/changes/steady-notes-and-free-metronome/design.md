# Design

## D1. The metronome on its own is a separate small class, not a scheduler mode

`FreeMetronome` (core/playback) runs on the same `Clock`, `TimerApi` and `NoteOutput.click` as the scheduler. `Player` owns it, because `Player` owns the backend that a user gesture creates; the metronome toggle can now be that first gesture. It is a flag next to `PlayerState`, not a new state, so the Play button logic does not change.

Rules:
- It starts only from `setMetronome(true)` while the state is `stopped` or `paused`. A remembered `metronome: true` never starts it.
- `play()` stops it before the piece starts. A click already handed to the output must not sound over the count-in off the grid: it schedules at most one click ahead, within a short window, or cancels it.
- Pause, stop and the end of the piece are silent, as before. To get the metronome alone again the user switches it off and on.
- Beats per bar and accents come from the bar Play would start from (`countInClicks`); the beat is the player's beat unit. A tempo or beat-unit change re-spaces the next click from the last one.
- The session stops it when the practice screen is left and when the app goes to the background.

## D2. Vibrato is removed at conversion, not at playback

The wobble is in the recordings and each key range of the SoundFont has one zone, so there is no steadier layer to pick. The converter flattens it (option `steady` per instrument, on for the saxophones and the trumpet): follow the pitch, resample at a variable rate so it is constant, bring each harmonic to a fixed level and phase after the attack, tune the note to its key, then loop on a whole number of periods. The violin keeps its vibrato: the tracking does not hold on its high notes, and the user found it fine as it is. The runtime sampler does not change.

## D3. Decisions made while building (not asked; for the user to confirm)

The metronome on its own:
- The screen stays on while it clicks. A screen that times out sends the app to the background, which silences it.
- A sound that fails to load leaves the switch on, with nothing sounding and the same message a failed Play shows. The next press tries again.
- The beats of the bar are fixed when the clicks start. Tapping another note or changing the loop does not change them; the tempo and the beat unit apply at once. When the bar is counted in a different number of beats, the next click starts a new bar.
- Stop silences it too. Pause, stop and the end of the piece never start it again.
- The first switch-on waits for the instrument's sample set, because the backend loads it before it returns. The clicks themselves need no samples.
- When Play takes over, a click that has already started is left to finish (50 ms); only one that has not sounded is taken back. `NoteOutput.click` returns an optional handle for that.
- `setMetronome` and `toggleMetronome` return a promise that rejects when the sound cannot be loaded.
- It shows as a filled icon on the toggle; there are no new texts.

Steady notes:
- The pitch is followed in two passes: one a semitone wide either side, for a wide vibrato, then one 30 Hz wide.
- The harmonics are fixed in phase as well as in level. With the level alone, three notes still moved by 13 to 18 cents.
- A steady note is tuned to the exact pitch of its key from its measured pitch, not by the SoundFont's tuning data (which was up to 7 cents off).
- `steady` is set per instrument. The clarinet measured steady with or without it, so it stays as it was, byte for byte.
- `web/test/ui/practice.test.ts`: the `freeze` helper's margin went from 10 to 250 ms. With the metronome loading its sound just before, pausing the clock failed about one run in six.
