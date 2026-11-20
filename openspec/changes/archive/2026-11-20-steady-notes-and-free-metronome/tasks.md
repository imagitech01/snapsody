# Tasks

## 1. Metronome on its own (D1)

- [x] 1.1 `FreeMetronome` in `web/src/core/playback/`, with tests on the fake clock: spacing at the tempo, accents per bar, a live tempo change, stop leaves nothing scheduled beyond one click.
- [x] 1.2 `Player`: start it from `setMetronome(true)` while stopped or paused, stop it on `setMetronome(false)` and on `play()`; expose whether it is sounding. Tests in `web/test/player.test.ts`, including the toggle as the first gesture and a backend that fails to load.
- [x] 1.3 `PracticeSession` and `PracticeScreen`: the toggle starts and stops it, a remembered `metronome: true` stays silent, leaving the screen or backgrounding stops it. Tests in `web/test/practiceSession.test.ts` and `web/test/ui/practice.test.ts`.

## 2. Steady notes (D2)

- [x] 2.1 `steady` option in `convert_soundfont.py` and `instruments.json`.
- [x] 2.2 Regenerate the tenor sax, alto sax and trumpet; the other sets stay byte-identical. Run the `check_*` tools.
- [x] 2.3 Measure pitch, level and brightness wobble before and after; record it in `docs/samples.md`.
- [x] 2.4 Listen: held notes, now and steady side by side, for all instruments. Verify: manual by ear (the user, 2026-11-19, on a page of rendered clips; they chose the tenor sax, the alto sax and the trumpet).
- [x] 2.5 In the app on the S24: whole notes on the tenor sax, the alto sax and the trumpet. Verify: manual by ear (the user).

## 3. Integration

- [x] 3.2 On the S24, with count-in on: let the metronome click on its own, press Play, and listen for a stray click off the beat. Verify: manual by ear (the user); cancelling a click is proven on fakes only.
- [x] 3.3 `make test-device` on the emulator, once before archive.
- [x] 3.1 `make test-mac` and `openspec validate steady-notes-and-free-metronome --strict` are green.
