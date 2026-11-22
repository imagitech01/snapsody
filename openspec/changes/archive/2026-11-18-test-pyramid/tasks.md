# Tasks

## 1. Entry points

- [x] 1.1 Add a root `Makefile` with `test-quick`, `test-mac` and `test-device` (design T1). Each target prints its duration and exits non-zero on failure. For now `test-quick` runs `npm test` in `web/`. Verify: `make test-quick` passes, and a deliberately broken web test makes it fail and name that test.
- [x] 1.2 Start `docs/testing.md`: the layers, their commands and budgets, the one-time setup, and which layer a new test goes in. Verify: each command in it runs as written.

## 2. Kotlin unit tests

- [x] 2.1 Add `src/test/kotlin` with JUnit 4 and `org.json`, and set `unitTests.isReturnDefaultValues = true`. Add `testDebugUnitTest` to `make test-quick`. Verify: a first test runs under `make test-quick`.
- [x] 2.2 Move `checkModelAssets` from `preBuild` to the `merge*Assets` tasks. Verify: with `android/model-assets/` moved aside, `make test-quick` passes and `./gradlew assembleDebug` fails with the how-to message.
- [x] 2.3 Add the `ImageToJpeg` seam to `ExerciseStore`. Write JVM tests for lifecycle, invalid ids, failed create, and non-JPEG input routed through the converter. Verify:
  - quick passes;
  - `ExerciseStoreTest` still passes on the emulator against the refactored store (the last time it runs);
  - `ExerciseStoreTest` is deleted.
- [x] 2.4 Add the stored-data compatibility test (design T3): one committed exercise folder in today's format under `src/test/resources/stores/v1/`, made from self-made material, loaded by the current `ExerciseStore`. Verify:
  - quick passes;
  - renaming a required file in the fixture fails the test.

## 3. Bridge contract

- [x] 3.1 Extract `BridgeHandlers` from `MainActivity`, and split `Bridge.dispatch(text)` from the transport (design T3). App behaviour must not change. Verify: `WebLayerTest` and `LibraryTest` still pass on the emulator against the refactor (`LibraryTest` needs the local exercise image; without it, run `WebLayerTest` only).
- [x] 3.2 Write `fixtures/bridge/` with an example for each of the 18 request types and the 7 events, and mark the debug-only ones. Add the typed `Requests` map in `bridge.ts`, plus a quick test that every `request(...)` type in `web/src` has an example. Verify: `npm run typecheck` passes, and adding `request("made.up")` fails the quick layer, naming the type.
- [x] 3.3 Add the Kotlin JVM contract test: the registered handlers equal the examples, and each example's reply has the expected shape. Verify:
  - quick passes;
  - changing a reply key in one handler fails the test, naming that type;
  - `WebLayerTest.forceCpuSettingOverTheBridge` is deleted.
- [x] 3.4 Measure the quick layer. Verify: a second `make test-quick` run reports ≤ 30 s, and the time is recorded in `docs/testing.md`.

## 4. Web UI test harness

- [x] 4.1 Add `playwright` (pinned) and `npm run test:ui`: `node --test` over `test/ui/*.test.ts`, against a `vite build` into `build/web-test/`. Add the Chromium install to the setup in `docs/testing.md`, and `test:ui` to `make test-mac`. Verify: an empty UI test runs under `make test-mac`.
- [x] 4.2 Build the harness (design T4): `page.route` for the app host, the 384×832 touch context, the fake bridge (answers validated against the contract, recorded requests, events, in-memory store) and the test `AudioContext`. Verify with a smoke UI test: the home screen loads, wasm loads, and `ping` is answered by the fake.
- [x] 4.3 Prove taps and the audio clock:
  - a `page.touchscreen.tap` on a rendered note sets `window.__lastTappedNote`. If it does not, switch to pointer events and note it in `docs/testing.md`;
  - Play plus one beat on the test clock moves the cursor to the next note.

  Verify: both pass 10 runs in a row.
- [x] 4.4 Write the generator and the two practice-exercise scores (design T6). Verify with node unit tests:
  - the clean score round-trips and has 19 bars in 3/4;
  - the recognised variant gets the expected repair and range flag.

## 5. Journeys and checks off the phone

Each task deletes the phone tests it replaces in the same commit. Tests use role and accessible-name selectors (design T4).

- [x] 5.1 Practice journey: open the practice exercise, play, tap a note to seek, set and clear a bar loop, change the tempo, reload and see the tempo kept. Verify: `make test-mac` passes, and `PracticeControlsTest` and `ScoreRenderTest` are deleted.
- [x] 5.2 Edit journey: open the recognised variant, step to a flag, lower a pitch, undo and redo, save. The saved `current` changes, while `recognised` does not. Verify: `make test-mac` passes, and `EditingTest` is deleted.
- [x] 5.3 Scan journey with scripted bridge events: page in, crop box confirmed, progress forward only, result opens the editor. Also cover cancel back to the same box, "No music found" with both actions, and the scanner-unavailable fallback. Verify: `make test-mac` passes, and `RegionSelectionTest` and `CaptureFallbackTest` are deleted.
- [x] 5.4 Library journey: the list is newest first, open, show original, rename, delete after confirmation. Verify: `make test-mac` passes. `LibraryTest` is deleted in 6.3, once the smoke test covers the restart.
- [x] 5.5 Sample-set check (design T4): every file of every bundled set decodes in Chromium and matches its map. Verify:
  - `make test-mac` passes;
  - removing one file from a set fails the test, naming the file;
  - `ListeningTest` is deleted.
- [x] 5.6 Add the design review (design T4):
  - the `review(page, frame)` helper, screenshotting at the frame's size;
  - `docs/design/figma/frames.json` and `docs/design/deviations.md`;
  - `make ui-review`, which writes `build/ui-review/index.html` (side by side, overlay toggle, deviation notes).

  Seed it with today's screens: export the closest Figma frames (Library, Edit score — Notes, Practice — Portrait) and name the large known differences as "not yet built". Verify:
  - `make ui-review` opens a page with the three pairs;
  - a journey step pointing at a frame with no PNG shows "no reference" instead of failing.
- [x] 5.7 Check the mac layer. Verify: `make test-mac` takes ≤ 3 min warm and passes 10 runs in a row, also with `fixtures/local/` moved aside. Record the numbers and the fast-loop commands in `docs/testing.md`.

## 6. Smoke test and cleanup

- [x] 6.1 Check that the app runs on the emulator (design T7b). Boot `ia_test_api36` headless, install the debug APK, and run a recognition of the engraved page from the debug test-image entry. The self-test must pick the CPU without crashing, the exercise must render, and playback must start. If the GPU delegate crashes without OpenCL, fix the self-test to fall back. Verify: the run completes, and `docs/testing.md` records the boot time, the recognition time and the peak memory on the emulator.
- [x] 6.2 Add `EndToEndSmokeTest` (design T7) and `make test-device` (design T7b: build, stop the Gradle daemon, boot from a snapshot, install, run, shut down; `DEVICE=phone` for a Galaxy S24). Verify:
  - `make test-device` passes with no phone connected and leaves no emulator running;
  - `make test-device DEVICE=phone` passes on a Galaxy S24;
  - the time of a full `make test-device` run is recorded in `docs/testing.md`.
- [x] 6.3 Delete the remaining instrumented tests (design T8): `AcceleratorSelfTestTest`, `AcceleratorSelectorTest`, `InferenceServiceTest`, `HomrBridgeTest`, `GpuFallbackTest`, `RecognitionTest`, `WebLayerTest` and `LibraryTest`. Also remove the code only those tests and the feasibility gate used: the debug `GateActivity` with its manifest entry, `ia_gate.py`, `ia_engine.segnet_bridge_agreement` and `transformer_bridge_symbols`, and the outputs of `tools/models/make_inference_fixtures.py` that only the deleted tests read (keep `engraved_page.png` for the smoke test). Verify: `androidTest` holds only the smoke test, `./gradlew assembleDebug` passes, `./gradlew compileDebugAndroidTestKotlin` passes, and the T8 table is copied into `docs/testing.md`.

## 7. Rule for future changes

- [x] 7.1 Add the `rules.tasks` and `rules.design` entries to `openspec/config.yaml` (design T9). Verify: `openspec instructions tasks --change test-pyramid --json` shows them.

## Workflow follow-up

- Run `make test-device` once, then archive the change after review.
