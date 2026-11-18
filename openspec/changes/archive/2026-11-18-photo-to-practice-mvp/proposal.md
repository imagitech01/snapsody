# Proposal

## Why

Saxophone method-book exercises often use notation (triplets, articulation patterns) that the theory lessons haven't covered yet, and hearing an exercise played correctly is the quickest way to learn it. A frontier AI model can already turn a photo into an interactive play-along, but that costs tokens per photo and needs the cloud. Two spikes on 2026-11-17 showed it can run on the phone instead, for free and offline:

- **homr** read exercise 87 from a phone photo with all 19 bars' pitches and triplet rhythms correct, and the slur/staccato pattern almost complete (one slur end missing in bar 17).
- homr's segmentation model runs on the Galaxy S24's **GPU** at ~21–26 ms per tile, giving correct output.

See `spike/homr/` and `spike/npu/results.md`.

## What Changes

- New **Android app** (first target: Samsung Galaxy S24), free and open source (AGPL-3.0, inherited from homr).
- **Capture:** take a photo of a book page and mark the one exercise to practise.
- **On-device recognition:** homr runs locally through Chaquopy and outputs MusicXML. No server and no AI tokens.
- **Model acceleration:** run segnet on the GPU (LiteRT GPU delegate). Fall back to the CPU when the GPU is missing, fails a correctness self-test, or is slower.
- **Repair rules:** check and fix the recognised music before showing it. Bar lengths must add up, which also recovers missed triplets and missing time signatures; notes outside the tenor range are flagged.
- **Tempo:** homr does not read tempo words or metronome marks, so an exercise starts at a default tempo unless the user enters its marking.
- **Correction:** fix a wrongly read note, duration or articulation on screen.
- **Playback:** show the score with a cursor following the music, played with a tenor-saxophone sound at concert pitch (a major ninth below written). Repeats are followed, slurs play legato, and staccato notes are shortened.
- **Practice controls (v1):** free tempo control, count-in, loop a range of bars, tap a note to start from there.
- **First milestone is a feasibility gate:** homr runs end to end on the S24 (Chaquopy, GPU segnet) and produces the same MusicXML for exercise 87 as on the Mac, in acceptable time. Building beyond the gate depends on passing it.

**Out of scope for this change:**
- iOS and App Store publishing
- Play Store release work
- a paid cloud/AI recognition engine (the design keeps room for it behind the MusicXML boundary)
- NPU acceleration (the pilot showed NNAPI only reaches Samsung's GPU driver on this phone, with wrong results)
- note names, fingering charts and symbol explanations (follow-up changes)
- multi-voice or non-saxophone scores

## Capabilities

### New Capabilities

- `score-capture`: photograph a page, correct perspective, and select the region of the single exercise to practise.
- `score-recognition`: turn the selected image into MusicXML on the device, including choosing the accelerator (GPU or CPU) and applying the music-rule repairs.
- `score-editing`: let the user correct recognised notes, durations, articulations and signatures, and keep the corrected score.
- `score-playback`: render the score, play it with a tenor-sax sound at concert pitch with articulation and repeats respected, and keep a cursor in sync with the audio.
- `practice-controls`: tempo control, count-in, bar-range looping and tap-to-seek during playback.

### Modified Capabilities

None. This is the project's first change and no specs exist yet.

## Impact

- **New codebase:** an Android app with a native engine layer (Chaquopy Python running homr; LiteRT and ONNX Runtime for the models) and a UI layer (likely a WebView, keeping the UI portable to iOS later; to be decided in `design.md`).
- **Dependencies and licences:**
  - homr (AGPL-3.0). Its model weights are partly trained on non-commercial data (Camera-PrIMuS, CC BY-NC); fine for a free app, and must be revisited before any paid tier.
  - LiteRT (Apache-2.0) and ONNX Runtime (MIT).
  - A score renderer, e.g. Verovio (LGPL-3.0).
  - A tenor-saxophone sample set whose licence allows redistribution, still to be found.
- **Python on Android:** Chaquopy's package index offers OpenCV only for Python 3.8/3.10 and numpy up to 1.26, while homr 0.7.1 declares Python ≥3.11, numpy ≥2.4 and OpenCV ≥4.13. homr's code looks portable to the older versions, but this is the first thing the feasibility gate must prove.
- **App size:** roughly 120 MB of models (smaller if int8 versions prove accurate end to end). The models could ship inside the app or download on first launch.
- **Device:** GPU path verified on the Exynos 2400 only. Other phones rely on the runtime self-test and the CPU fallback.
- **Repo hygiene:** the spike folders and virtualenvs (`spike/`, `.venv*`) need to be git-ignored before the first commit. Photos of the (copyrighted) method book stay in a local-only, git-ignored fixtures folder and are never bundled into the app.
