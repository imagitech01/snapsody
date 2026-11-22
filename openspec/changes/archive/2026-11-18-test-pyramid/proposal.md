# Proposal

## Why

In the first change (photo-to-practice-mvp), most checks needed a Galaxy S24, which slowed development. That was right while recognition on the phone was the risk. It is not the risk any more: the feasibility gate and the end-to-end check proved that the models and recognition work on a Galaxy S24.

The next changes are mostly app logic and UI. They need fast tests on a Mac. They do not need the model and recognition checks repeated on every change.

## What Changes

- **Three layers, one command each:**
  - **quick:** unit tests in seconds, run on every edit. These are the existing web tests (`node --test`, 149 tests) and new plain-JVM Kotlin tests for the exercise store and the bridge handlers.
  - **mac:** the quick layer plus the built web app in headless desktop Chromium (Playwright), with a fake `window.nativeBridge` and a committed score. It has one journey test per main flow: practise, edit, scan, library. It also has a check that every bundled instrument sample decodes. This replaces the phone for UI flows.
  - **device:** one end-to-end smoke test, run before a change is archived, not per task. It runs on the Android emulator on a Mac (headless, arm64), so the phone does not have to be at hand. A Galaxy S24 is only for what an emulator cannot show: camera and scanner, GPU speed, and how sound and the screen feel on the real phone. Those checks are manual and rare.
- **Fits the coming redesign** (Figma: library tabs, multi-page scans, the new editor, instruments, landscape practice):
  - new logic goes into pure modules with node unit tests;
  - journey tests find elements by role and accessible name, never by CSS or position;
  - `make ui-review` puts the app's screens next to their Figma frames, with an overlay and the recorded deviations, for checking by eye. Figma is the design to aim for, not a specification. It never fails a build;
  - a committed exercise folder in today's storage format protects the user's saved exercises when the format changes.
- **A bridge contract:** one committed set of request, reply and event examples. The fake bridge and the real Kotlin handlers are both checked against it, so the fake cannot drift from the app.
- **Two small Kotlin refactors** so that logic runs on the JVM. The bridge handlers move out of `MainActivity`. The exercise store gets an image-conversion seam. App behaviour does not change.
- **Remove the instrumented tests.** All 15 classes are deleted.
  - The UI and storage tests are replaced first, by mac and quick tests for the same behaviour.
  - The model, GPU and recognition tests are deleted without a replacement. What they checked was proven in the first change, and a later change that touches models or inference brings its own checks.
  - Every deleted test stays in git history.
- **A rule for future changes** in `openspec/config.yaml`: each task's verify step names its layer (quick or mac). The device layer is only for the smoke test before archive.

**Out of scope:**
- Re-testing models, accelerators or recognition.
- Python tests.
- CI and git hooks.
- Coverage targets.
- Robolectric.

## Capabilities

### New Capabilities

- `test-suite`: the project's automated tests. It covers the three layers and their commands, what each layer may depend on, time budgets, the bridge contract, and the fixture rules.

### Modified Capabilities

None. App behaviour is unchanged.

## Impact

- **`web/`:**
  - a new dev dependency, `playwright`, plus a one-time Chromium download (dev only, never in the app);
  - a new `test/ui/` folder;
  - a committed practice-exercise score in `test/fixtures/`.
- **`android/app`:**
  - a new `src/test` source set with JUnit 4 and `org.json`;
  - the handler and store refactors;
  - `checkModelAssets` moved off the unit-test path;
  - `androidTest` reduced to the smoke test.
- **Repo root:** a `Makefile`.
- **Docs:** a new `docs/testing.md`. `fixtures/bridge/` holds the contract examples.
