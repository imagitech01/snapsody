# Design

## Context

See proposal.md (Why) for the motivation. The requirements are in `specs/test-suite/spec.md`.

**What exists:**
- **Web:** `web/test/*.test.ts` has 149 tests that run with `node --test` in about 3.4 s and use no DOM. The DOM modules (`editor`, `practiceControls`, `library`, `regionSelection`, `flagReview`, `scoreView`, `recognition`, `main`) have no tests off the phone.
- **Android:** 15 instrumented test classes, 36 methods, and no `src/test` source set.

**Facts measured or checked for this design:**
- **A Kotlin JVM test in `:app` is cheap.** A throwaway JUnit test took 10 s on the first run (daemon warm). Re-runs took 0.9 s with nothing changed, and 1.5–3 s after an edit.
- **Unit tests depend on the models today.** `testDebugUnitTest` runs `checkModelAssets` (through `preBuild`), but not `buildWeb`.
- **`web/src/bridge.ts` is the web layer's only native seam.** It uses 18 request types and 7 events, all handled in `MainActivity.kt`, with the envelope in `Bridge.kt`.
- **Test hooks already exist** in the web layer: `window.__app`, `__editor`, `__player`, `__regionSelection`, `__scoreView`, `__lastTappedNote`.
- **Recognition is setup only in four tests.** `EditingTest`, `PracticeControlsTest`, `ScoreRenderTest` and `LibraryTest` start with a real recognition run, with a 300 s wait, only to get a score.
- **The Playwright API needed here exists.** In 1.64.1, `page.addInitScript` runs before the page's scripts, `page.clock` fakes timers, and `page.touchscreen.tap` needs `hasTouch` (checked in the docs).

## Goals / Non-Goals

**What is coming** (the in-progress Figma design; its file key is kept outside the repo): mostly UI and score logic on top of the proven recognition.
- **Navigation:** tabs for Library, Favorites and Settings, with search.
- **Multi-page scans:** add pages, an optional crop, put the pages in order, and read them into one continuous score with continuous bar numbers.
- **An editor with Note, Marks and Score tabs:**
  - new marks: tenuto, accent, fermata, crescendo and diminuendo;
  - key and time signature;
  - written tempo;
  - undo and redo;
  - the source photo beside the bar.
- **Practice:**
  - instruments (piano, guitar, violin, flute), with written or concert pitch;
  - speed (0.5×, 0.75×, 1×), separate from the written tempo;
  - rest between loop repeats;
  - count along;
  - follow on or off;
  - go to bar and a page navigator;
  - landscape.
- **Settings:** the default instrument and the pitch reference.

**Goals:**
- A task that changes app logic or UI is verified on a Mac, in seconds (quick) or minutes (mac).
- Tests do not slow the redesign. Logic lives in pure modules with node tests. Each screen has at most one journey test, which the change that redesigns the screen updates.
- The setup is small: two toolchains that already exist (npm, Gradle) plus Playwright.

**Non-Goals:**
- Re-testing what the first change proved: model parity, GPU self-test and fallback, the Chaquopy bridge, recognition accuracy, sample decoding, the scanner and the photo picker.
- Python tests. `ia_engine.py` is not expected to change. A change that touches it adds its own tests.
- Checking the Android WebView's rendering pixel by pixel.

## Decisions

### T1. Three layers, run from a root Makefile

| Layer | Command | Contents | Budget |
|---|---|---|---|
| quick | `make test-quick` | `npm test` (web units) and `./gradlew :app:testDebugUnitTest` (Kotlin JVM) | ≤ 30 s warm |
| mac | `make test-mac` | quick, then `npm run test:ui` (Playwright) | ≤ 3 min warm |
| device | `make test-device` (`DEVICE=phone` for a Galaxy S24) | the smoke test on the emulator | before archive |

Each target prints its duration.

*Why a Makefile:* two toolchains need one entry point at the root. A later git hook or CI can call it.

### T2. Kotlin: plain JUnit 4 on the JVM in `:app`

**Setup:**
- Add `src/test/kotlin` with `testImplementation` for `junit:junit:4.13.2` and `org.json:json`. The Android jar's `org.json` is a stub.
- Set `testOptions.unitTests.isReturnDefaultValues = true`, so `android.util.Log` is harmless.

**No separate module.** The measured cost of 1.5–3 s per edit fits the budget.

**No Robolectric.** The two seams in T3 are enough.

**Model check:** move `checkModelAssets` from `preBuild` to the `merge*Assets` tasks. Unit tests then run without the models, and an APK build without them still fails.

### T3. Two seams, both refactors

- **`BridgeHandlers`:** the handler lambdas move out of `MainActivity` into a class built from its dependencies. `Bridge.dispatch(text): String?`, with the envelope, unknown type and error replies, is split from the WebView transport. This class is what the contract test (T5) runs.
- **`ExerciseStore`:** gets `fun interface ImageToJpeg`, with the Bitmap-based default. The JPEG path is already a plain file copy.

The JVM tests take over `ExerciseStoreTest` (lifecycle, invalid ids, failed create, routing of non-JPEG input) and the handler logic of `WebLayerTest.forceCpuSettingOverTheBridge`.

**Stored-data compatibility.** Exercises saved on the phone must survive the coming storage changes: multi-page sources, favorites, the instrument per exercise.
- `android/app/src/test/resources/stores/v1/` holds one committed exercise folder in today's format, built from self-made material.
- A JVM test loads it with the current `ExerciseStore`.
- A change that alters the format adds a folder for its own version, and the test loads all of them.

### T4. Web UI: the Playwright library under `node --test`, against the production build

**One runner, one TypeScript path.**
- Tests live in `web/test/ui/*.test.ts` and use `playwright` (the library) from `node --test`.
- That keeps the runner and the TypeScript handling the unit tests already use. `@playwright/test` would bring a second runner and its own TypeScript transform next to TypeScript 7.

**Same build, same URLs as the app.**
- `vite build` writes into `build/web-test/`.
- Tests navigate to `https://appassets.androidplatform.net/assets/web/index.html`.
- `page.route` serves that host from disk with the app's MIME types, `.wasm` included.
- `/exercises/<id>/source.jpg` and `/capture/...` are served from the fake bridge's store.

**A phone-shaped context.**
- Headless Chromium with `--autoplay-policy=no-user-gesture-required`.
- A fresh context per test: 384×832 (a Galaxy S24's CSS size), with `hasTouch` and `isMobile`.
- Taps use `page.touchscreen.tap`.

**The fake bridge** (`test/ui/fakeBridge.ts`, injected with `addInitScript`):
- answers each request from the contract examples, with per-test overrides validated against them;
- records the requests it gets;
- lets the test trigger events;
- keeps an in-memory exercise store, so flows persist across a reload within a test.

**Time.**
- Timers and `Date` run on `page.clock`.
- Recognition progress comes from scripted events.
- `page.clock` does not move `AudioContext.currentTime`, which the player schedules against. So the init script installs a test `AudioContext` (a subclass of the real one) whose clock the test advances.
- Audio assertions read the scheduled events through `window.__player`.

The first UI tests prove that the touch path and the test audio clock work (task 4.3). If taps do not reach the handlers, the helper dispatches pointer events instead.

**Journeys, not details.** The mac layer has one journey test per main flow. Each checks that the flow works end to end:
- open a score and practise it: play, seek, loop, tempo;
- edit and save: a pitch change, undo, then save;
- scan: capture, crop, recognition progress, the result; plus the no-music and cancel outcomes;
- manage the library: open, rename, delete.

The detailed rules sit in node unit tests, where they are faster and survive any redesign. These include edit operations, loop timing, transposition, the default tempo, repairs and beaming. A new screen from the Figma design gets its journey test, or extends one, in the change that builds it.

**Selectors that survive a redesign.** Tests find elements by role and accessible name (`getByRole('button', { name: 'Save & practice' })`). `data-testid` is used only where an element has no accessible name. Tests never use CSS classes or layout positions. A renamed button fails with a clear message and takes a one-line fix.

**Design review against Figma.** Figma is the design to aim for, not a specification. The goal is to look as close to it as sensible. A deliberate deviation, such as a choice that does not work in practice, is fine when it is written down. So the comparison is by eye and never a gate. A pixel diff would mostly report noise (fonts, real score engraving, live data).
- **Reference frames.** When a change implements a screen, it exports that screen's Figma frame as a PNG into `docs/design/figma/<frame-name>.png` and records the frame's node id in `docs/design/figma/frames.json`. Figma is still changing, so the PNG holds the design that change built against: the fallback you asked for.
- **App screenshots at the frame's size.** A journey step can name a frame: `review(page, '02.1 · Play along — Portrait')`. The page is then also screenshotted at that frame's size (400×900 portrait, 900×400 landscape) into `build/ui-review/`. Journeys run at a Galaxy S24's 384×832 as usual.
- **`make ui-review`** writes `build/ui-review/index.html`. It shows each app screenshot next to its Figma frame, with an overlay toggle (Figma at 50% opacity over the app) and the deviation notes for that frame. It runs after `make test-mac` and fails on nothing.
- **Deviation notes.** These live in `docs/design/deviations.md`, one line per frame: what differs and why ("bar numbers shown above the staff, not inside it: Verovio's layout"). The review page shows them, so a known deviation is not mistaken for a new one.

**Sample sets.** One mac test decodes every file of every bundled sample set with `decodeAudioData` in Chromium, and checks it against its map. New instruments are covered as soon as their files are bundled. This replaces `ListeningTest` for its practical purpose: catching a broken or missing file.

**Fast loop while developing.**
- `npm test -- --watch` reruns the unit tests on save.
- `npm run test:ui -- test/ui/<journey>.test.ts` runs one journey.
- `make test-mac` runs everything, before a commit.

### T5. Bridge contract

**The examples.** `fixtures/bridge/<type>.json` holds one file per request type: the request payload, the success reply, and the error reply where one exists. `fixtures/bridge/events/<event>.json` holds one file per event. Debug-only types are marked.

**Checked as shape.** The check compares keys, JSON types and enum values, not exact values.

**Checked from both sides:**
- **TypeScript (quick):** `bridge.ts` gets a typed `Requests` map. A unit test checks that every key has an example, and that every literal `request(...)` type in `web/src` is a key. The fake bridge validates its replies against the examples.
- **Kotlin (quick):** a JVM test builds `BridgeHandlers` with fakes. It checks that the registered types equal the examples. Then it runs each example through `dispatch` and compares the reply's shape.

### T6. A committed exercise-like score

The UI tests need a score like exercise 87 that is not exercise 87 (design D12 of the first change). Add `web/test/fixtures/practice-exercise.musicxml`:
- tenor sax, 3/4, G major, 19 bars;
- triplets, slurs and staccato;
- a repeat with first and second endings;
- a tempo word.

Add `practice-exercise.recognised.musicxml`, the same music in homr's output style: no beams, one bar the repairs fix, and one note out of range.

Both files come from a small committed generator (`web/test/fixtures/make-practice-exercise.ts`).

### T7. The smoke test

`EndToEndSmokeTest` is the only instrumented test. It takes the engraved page from `androidTest/assets/fixtures/` (generated by `tools/models/make_inference_fixtures.py`) and goes through the debug test-image entry:
1. region selection;
2. recognition;
3. the saved exercise;
4. render;
5. a few beats of playback;
6. an activity restart, then reopening the exercise.

It checks that each step completes, nothing more: no music comparison, no accelerator check, no timing.

It checks that each step completes. It asserts no music comparison, no accelerator and no timing, so it passes on the CPU.

### T7b. The device layer runs on the emulator

**The emulator is enough.** A Mac is Apple Silicon, so the arm64-only APK (Chaquopy) runs natively in an arm64 emulator. The AVD `ia_test_api36` already exists: Android 36.1, Google Play image, 4 GB RAM. The smoke test needs none of what the emulator lacks:
- it uses the debug test-image entry, not the camera or the scanner;
- without OpenCL the GPU self-test picks the CPU, and the smoke test does not care which one runs;
- CPU recognition took 15–30 s and peaked at 1.3 GB on a Galaxy S24, which fits the AVD.

**What `make test-device` does:**
1. Builds the debug and test APKs.
2. Stops the Gradle daemon (`./gradlew --stop`). On a Mac with 8 GB, the daemon's 4 GB heap plus the 4 GB AVD would not fit together.
3. Boots the AVD headless (`-no-window -no-boot-anim`) from a saved snapshot, with audio left on so `AudioContext` works.
4. Waits for `sys.boot_completed`.
5. Installs the APKs and runs the test with `adb shell am instrument`.
6. Shuts the emulator down.

With `DEVICE=phone`, it skips the emulator steps and uses the connected S24.

**A Galaxy S24 is for the few things an emulator cannot show.** These are checked by hand, only when a change touches them:
- the camera and the ML Kit scanner (the multi-page capture in the Figma design is one);
- GPU speed;
- how sound and the screen feel on the real phone.

The design names them, and tasks mark them as manual phone checks.

### T8. What happens to each instrumented test

| Today | After |
|---|---|
| `EditingTest`, `PracticeControlsTest`, `ScoreRenderTest`, `LibraryTest`, `RegionSelectionTest` | replaced by the four journeys (T4). Their detailed checks are already node unit tests (`edit`, `player`, `practice`, `cursor`, `render`, `beams`). The restart survival is in the smoke test. These screens are about to be redesigned, so the old phone assertions are not ported one by one |
| `RecognitionTest` | its screens (progress, cancel, no music) are in the scan journey with scripted events; the real run is in the smoke test |
| `CaptureFallbackTest` | the fallback screen is in the scan journey; the picker part is dropped |
| `ExerciseStoreTest`, `WebLayerTest.forceCpuSettingOverTheBridge` | replaced by Kotlin JVM tests |
| `WebLayerTest` (origin, wasm, ping) | covered by the smoke test, which loads the page, renders with Verovio's wasm and uses the bridge |
| `ListeningTest` | replaced by the sample-set decode test in Chromium (T4) |
| `AcceleratorSelfTestTest`, `AcceleratorSelectorTest`, `InferenceServiceTest`, `HomrBridgeTest`, `GpuFallbackTest` | deleted, proven in the first change |

A test that has a replacement is deleted in the same commit as its passing replacement.

### T9. The rule for future changes

Add to `openspec/config.yaml`:
- `rules.tasks`:
  - every verify step names its layer (`quick` or `mac`) and the test;
  - new logic is verified by a node unit test on a pure module;
  - a new or redesigned screen updates or adds its journey test;
  - a UI task names its Figma frame and is checked by eye in `make ui-review`; each deviation is recorded in `docs/design/deviations.md` with its reason;
  - by-ear and by-eye checks are named as manual;
  - the device smoke test runs once, before archive, on the emulator; a manual check on a Galaxy S24 is named only for the camera, the scanner, GPU speed, or by-ear and by-eye checks on the real phone.
- `rules.design`:
  - a design for UI work lists the Figma frames it implements and any deviation it plans, with the reason;
  - a new bridge message comes with its contract example;
  - a change to the stored exercise format adds a compatibility folder;
  - a change to models, inference or recognition states its own verification.

## Risks / Trade-offs

- **[The app does not run on the emulator: a native crash in the GPU delegate without OpenCL, or a WebView or audio problem in headless mode]** → task 6.1 checks this first. A GPU crash is fixed in the app, because the self-test should fall back on a phone without OpenCL too. If the emulator cannot work, `make test-device` falls back to a Galaxy S24 and the smoke test stays once per change.
- **[8 GB of RAM]** → the device target stops the Gradle daemon first. If the AVD still swaps, its RAM drops to 3 GB, since recognition peaks at 1.3 GB.
- **[Desktop Chromium differs from the Android WebView]** → the UI tests check behaviour and the DOM. The smoke test runs the real WebView once per change. A WebView-only problem gets a narrow phone test when it is found.
- **[The fake bridge drifts from the host]** → the contract (T5) is checked from both sides in the quick layer.
- **[A future model, LiteRT or homr change goes untested]** → the rule (T9) makes that change bring its own checks. The tools are still in `tools/models/` and `tools/homr/`, and the deleted tests are in git history.
- **[Playwright's Chromium download (~150 MB)]** → it is pinned in `package-lock.json` and installed once, for development only.

## Migration Plan

1. Build the framework: Makefile, Kotlin JVM, Playwright harness, contract.
2. Replace the UI and storage tests, deleting each instrumented test with its replacement.
3. Add the smoke test and delete the remaining instrumented tests.
4. Add the config rule.

Rollback is a git revert. App behaviour does not change.
