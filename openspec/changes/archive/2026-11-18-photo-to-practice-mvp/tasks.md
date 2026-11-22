# Tasks

## 1. Repository and project setup

- [x] 1.1 Create `fixtures/local/` and move the book photo, `spike/homr/page.musicxml` and Claude's artifacts there; add `.gitignore` for `fixtures/local/`, `.venv*/`, spike build outputs (`spike/**/tflite_*`, `spike/**/*.onnx`, `*.npy`, debug PNGs, `bin/`), Android `build/`/`.gradle/` and web `node_modules/`/`dist/`, keeping `spike/**/results.md` and scripts (design D12); verify with `git status` that only sources, specs, scripts and results are listed
- [x] 1.2 Create the Android project (Kotlin, single activity, minSdk 29) with **no `INTERNET` permission** in the manifest; verify `./gradlew assembleDebug` succeeds and the app launches on a Galaxy S24 via `adb install`
- [x] 1.3 Create the web layer (TypeScript + Vite, built into the app's assets) and serve it in the WebView via `WebViewAssetLoader`; verify the app shows the web page and a WebAssembly test module loads
- [x] 1.4 Add the JSON message bridge between WebView and Kotlin (`addWebMessageListener`), with request/response correlation ids; verify a round-trip "ping" from TS returns a Kotlin response in an instrumented test
- [x] 1.5 Add a LICENSE (AGPL-3.0) and a NOTICE listing homr, Verovio, LiteRT, ONNX Runtime, Chaquopy and ML Kit with their licences; verify the files exist and name every bundled dependency

## 2. Model build pipeline

- [x] 2.1 Turn `spike/npu/prepare.py` + `fold_resize.py` + the onnx2tf step into one reproducible script (`tools/models/build_segnet.py`) that outputs `segnet_fp32_b1.tflite` from homr's pinned segnet ONNX, with onnx2tf's sample data supplied locally (no download); verify its output matches `spike/npu/tflite_out/segnet_fp32_b1_static_float32.tflite` on a test tile
- [x] 2.2 Add an equivalence test to the script: TFLite vs the original fp16 ONNX on a 12-tile grid, failing below 99.9% symbol-pixel agreement. Use the book photo from `fixtures/local/` when present (skipping with a message otherwise) and a self-engraved page (Verovio → PNG) always; verify the test passes
- [x] 2.3 Package segnet TFLite plus homr's encoder/decoder ONNX into app assets, with their SHA-256 hashes in a generated `models.json`; verify the APK contains the three files and the hashes match

## 3. Feasibility gate: homr on the phone

- [x] 3.1 Prove the Python-version path on a Mac: run vendored homr 0.7.1 under Python 3.10 + numpy 1.26.2 + OpenCV 4.5.x (the versions Chaquopy offers) with relaxed pins, and patch any incompatibility; verify its MusicXML for the book photo matches `fixtures/local/page.musicxml` in exercise 87 (bars 1–19, the D11 criterion); small differences elsewhere on the page caused by OpenCV version differences are accepted and recorded in `docs/gate-results.md`. If this fails, record why and pick the next fallback from design D3 before continuing
- [x] 3.2 Add Chaquopy (Python 3.10, numpy 1.26.2, opencv-python 4.5.1, Pillow) and vendor the patched homr with title detection and PDF input disabled; verify `import homr` succeeds on a Galaxy S24 (logcat)
- [x] 3.3 Implement Kotlin `InferenceService`: segnet on LiteRT (GPU delegate and XNNPACK CPU, selectable), encoder on ONNX Runtime Android CPU, and the **whole decoder loop in Kotlin** with the key/value cache kept native (design D3); verify an instrumented test runs each on a fixture input, with output shapes and decoded tokens matching homr on a Mac for one staff
- [x] 3.4 Patch homr to call `InferenceService` through Chaquopy's Java bridge (segnet tile batches via direct ByteBuffers; encoder once per staff; one decoder call per staff returning tokens); verify segnet via the bridge on the **CPU** matches the Mac reference at ≥99.9% symbol pixels and on the **GPU** at ≥99.5% (design D4 threshold)
- [x] 3.5 Build a debug "gate" screen that recognises the exercise-87 crop (loaded from a local file pushed via adb, not bundled) and records per-stage timings (segnet, staff processing, encoder, decoder, MusicXML), total time and peak memory; verify it runs to completion on a Galaxy S24 on both GPU and CPU
- [x] 3.6 Add a comparison check of bars 1–19 (pitch, duration, tuplets, slurs, staccato) between the gate's MusicXML and a Mac's homr output for the same input: the full photo vs `fixtures/local/page.musicxml`, and the exercise-87 crop vs a Mac's output for that crop; verify both pass on a Galaxy S24. Differences between the crop and the full-page reference come from homr itself (they occur on a Mac too); record them in `docs/gate-results.md`
- [x] 3.7 Record gate results in `docs/gate-results.md` (timings per stage, memory, GPU vs CPU, the Python-version path taken) and decide pass/fail against design D11 (≤30 s target, ≤60 s limit, no memory kill); verify the document states the decision. **If the gate fails, stop here and review with the user before continuing**

## 4. Accelerator self-test

- [x] 4.1 Build a self-engraved dense reference tile (Verovio → PNG at build time: triplets, slurs, staccato, ledger lines) with its CPU reference output, and implement the self-test (≥99.5% symbol-pixel agreement + faster median of 5 runs → GPU, else CPU); verify on a Galaxy S24 that it selects the GPU and logs agreement and timings
- [x] 4.2 Store the decision keyed by app version, model hashes and GPU driver string, rerunning when any of them change; verify by changing the stored app version in a test and observing a rerun
- [x] 4.3 Enable the GPU delegate's serialized kernel cache; verify the second app launch's GPU init time drops well below the first (logged)
- [x] 4.4 Fall back to the CPU on any GPU error during recognition and mark the GPU failed until the next self-test, plus add a hidden "force CPU" setting; verify with an injected GPU failure that recognition still completes on the CPU

## 5. Recognition job

- [x] 5.1 Run recognition as a cancellable foreground job taking a cropped image and returning MusicXML, with progress events per stage/staff over the bridge; verify the UI shows advancing progress during a real run
- [x] 5.2 Implement cancel (checked between tiles, staves and decoder calls), returning to region selection with no exercise created; verify by cancelling mid-run and confirming no exercise folder exists
- [x] 5.3 Report "no music found" when homr detects no staff, offering reselect/retake; verify with a crop of plain text
- [x] 5.4 Verify recognition runs in airplane mode end to end

## 6. Capture

- [x] 6.1 Integrate the ML Kit Document Scanner behind a `PageSource` interface (camera + gallery import, corner adjustment, straightened output); verify both camera and gallery paths deliver a straightened page image on a Galaxy S24
- [x] 6.2 Check the merged manifest after adding ML Kit; if `INTERNET` was merged in, remove it with `tools:node="remove"`; verify the merged manifest has no `INTERNET` permission and the scanner still opens
- [x] 6.3 Handle a page scanner that cannot run (Play services missing or outdated, camera unusable, scanner error) by explaining it and still offering gallery import through the system photo picker (no permission; no perspective correction); verify with an injected scanner failure that the explanation appears and a gallery photo reaches region selection. The ML Kit scanner uses Google Play services' camera permission, so the app has no camera permission to deny
- [x] 6.4 Build the region-selection screen in the web UI (draggable/resizable box, confirm) and crop at full resolution natively; verify that selecting exercise 87 on the reference page produces a crop containing only exercise 87

## 7. Score model and repairs (TypeScript)

- [x] 7.1 Implement MusicXML → score model → MusicXML (notes, rests, pitch/accidentals, durations, tuplets, ties, slurs, staccato, breath marks, dynamics, clef/key/time, barlines, repeats, endings, tempo marking); verify with unit tests on a committed self-made MusicXML fixture (plus `fixtures/local/page.musicxml` when present) that every element round-trips
- [x] 7.2 Implement bar-length validation and the triplet repair (six plain eighths + quarter in 3/4 → two triplets); verify with unit tests, including an unrepairable bar that gets flagged
- [x] 7.3 Implement time-signature inference when none is present (majority bar length), marked as inferred; verify with a unit test on a common-time exercise stripped of its time signature → 4/4 inferred
- [x] 7.4 Implement the range check (written B♭3–F♯6), flagging but not changing notes; verify with a unit test for written A3
- [x] 7.5 Wire repairs into the post-recognition flow so flags are stored with the exercise; verify exercise 87 from the gate produces zero flags

## 8. Storage and exercise library

- [x] 8.1 Implement Kotlin exercise storage (folder per exercise: `source.jpg`, `recognised.musicxml`, `current.musicxml`, `meta.json`) with bridge calls to list, load, save, rename and delete; verify with an instrumented test of the full lifecycle
- [x] 8.2 Build the library screen (list, open, rename, delete with confirmation, default name from capture date/time) and the "show original" view of `source.jpg`; verify on a Galaxy S24 that exercise 87 survives an app restart and that deleting it removes its folder

## 9. Score rendering

- [x] 9.1 Integrate Verovio (wasm) to render the score model in written pitch, fitted to portrait phone width; verify exercise 87 renders with clef, key, 3/4, triplets, slurs and staccato
- [x] 9.2 Map rendered SVG element ids to score-model notes for taps and highlighting; verify that tapping each note of bar 1 logs the matching model note
- [x] 9.3 Beam eighth notes and shorter by beat for display (homr writes no beams and Verovio does not add them); verify with unit tests on the grouping rules and on a Galaxy S24 that exercise 87's triplets are drawn as beamed groups of three

## 10. Playback engine

- [x] 10.1 Implement timeline expansion: repeats, first/second endings, ties merged, D.C./D.S. ignored; verify with unit tests (bars 1,2,1,2,3 for a simple repeat; endings order; tied notes merged)
- [x] 10.2 Implement sounding pitch = written − 14 semitones, articulation timing (staccato ~50%, breath gap) and dynamics → gain (default *mf*); verify with unit tests on the expanded timeline (written G4 → concert F3, staccato shortened, *f* louder than *mf*)
- [x] 10.3 Implement the Web Audio sampler and lookahead scheduler, reading the sample format from design D9 (one file per note + JSON map), including legato under slurs (start in the sustain section with a crossfade). Use a temporary placeholder sample set; verify with a scheduler unit test that slurred notes get no new attack and staccato notes end early
- [x] 10.4 Drive the cursor from `AudioContext.currentTime − outputLatency`, with auto-scroll to the current line; verify on a Galaxy S24 that the highlight changes in step with the heard notes and scrolls between lines
- [x] 10.5 Make playback always read the current corrected score; verify that a note changed in the model is heard changed on the next play

## 11. Tenor-sax sound

- [x] 11.1 Find candidate tenor-sax sample sets meeting design D9 (concert A♭2–E5, sustain long enough or loopable, CC0/CC-BY) and record each candidate's source and licence text in `docs/samples.md`; verify at least one candidate is documented, or that the own-recording fallback is chosen
- [x] 11.2 Convert each candidate into the app's sample format; verify every semitone in range has a sample and each map validates
- [x] 11.3 Build a listening page (using the playback engine from group 10) that plays exercise 87 at 96 and 50 bpm per candidate, and let the user choose; verify the choice is recorded in `docs/samples.md`
- [x] 11.4 Bundle the chosen set, replacing the placeholder, and tune legato crossfade and staccato length by ear; verify on a Galaxy S24 that exercise 87's slurred notes connect and its staccato notes are clearly short

## 12. Practice controls

- [x] 12.1 Implement play/pause/resume from position; verify pausing in bar 5 and resuming continues in bar 5
- [x] 12.2 Implement the tempo control (30–200 bpm) with live changes rescheduling from the current note; verify on a Galaxy S24 that pitch is unchanged at 50 vs 96 bpm and that a change in bar 6 continues from bar 6
- [x] 12.3 Implement the default tempo (metronome mark → tempo-word table → 80 bpm) and remember the last tempo per exercise in `meta.json`; verify with unit tests for the table and a reopen test on the device
- [x] 12.4 Implement the count-in (one bar of clicks in the current metre with a visible count, toggle remembered); verify a 3/4 exercise counts 1-2-3 before the first note
- [x] 12.5 Implement bar-range looping (seamless, count-in only before the first pass, clearable); verify by ear and with a scheduler unit test that bars 9–12 loop with no gap
- [x] 12.6 Implement tap-to-seek, both while stopped and while playing; verify by tapping bar 9 (stopped) and bar 3 (playing) on a Galaxy S24

## 13. Editing

- [x] 13.1 Show repair flags on the score with next/previous navigation; verify with an exercise that has two injected flags
- [x] 13.2 Implement note editing (pitch step and accidental, duration including dotted and triplet, slur/tie/staccato toggles, delete, insert note or rest); verify with unit tests on the score model and a manual check that C5 stepped down shows B4
- [x] 13.3 Implement key signature, time signature and tempo-marking edits; verify that changing to one sharp makes un-marked Fs play as F♯, and that entering "Moderato" sets the default tempo for an exercise with no chosen tempo
- [x] 13.4 Re-run the bar-length check after every edit and mark broken bars without blocking; verify by lengthening a quarter to a half in a full 3/4 bar
- [x] 13.5 Implement undo/redo for the editing session and save edits to `current.musicxml`, leaving `recognised.musicxml` untouched; verify undoing a delete restores the note and that both files differ after an edit

## 14. End-to-end check on a Galaxy S24

- [x] 14.1 In airplane mode, photograph the reference page, select exercise 87, recognise, play at 96 then 50 bpm with count-in, loop bars 9–12 and tap-seek to bar 3; verify every step works, the merged manifest still has no `INTERNET` permission, and recognition time is recorded in `docs/gate-results.md`
- [x] 14.2 Repeat with exercise 88 (repeat sign, triplet bar, common time) and confirm playback follows the repeat; record any recognition errors and the edits needed in `docs/gate-results.md`
