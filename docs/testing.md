# Testing

The project has three test layers. Each one starts with a single command from the repository root.
The requirements are in `openspec/specs/test-suite/spec.md`; the design behind them is in
`openspec/changes/archive/2026-11-18-test-pyramid/design.md` and, for the Snapsody rebuild,
`openspec/changes/archive/2026-11-18-practice-app/design.md` (D2, D15).

| Layer | Command | What runs | Budget | When |
|---|---|---|---|---|
| quick | `make test-quick` | web unit tests (`node --test`) and Kotlin JVM unit tests | ≤ 30 s warm | on every edit |
| mac | `make test-mac` | quick, then the web UI tests in headless Chromium (Playwright) | ≤ 3 min warm | before a commit |
| device | `make test-device` | the end-to-end smoke test on the Android emulator | — | once per change, before archive |

Each command prints its duration and exits non-zero when a test fails. The failing test is named
in the output.

## Web layout and the platform port

```
web/src/
  ui/        Preact components (.tsx): presentation only; screens/ has one component per screen
  app/       plain TypeScript and @preact/signals: the app's state and flows; no UI imports
  core/      score/, playback/ and instruments/ (pages/ follows): pure logic
  platform/  port.ts, the interface to the phone, and the adapters
  main.tsx   the composition root: the only file that may pick an adapter
```

How the app starts: `main.tsx` picks the platform and calls `ui/mount.tsx`'s `mount(platform, root)`, which runs
`app/shell.ts`'s `startShell(platform)` (settings, the library sweep, the translator, the list and the home, the
router and the back button, in that order) and draws `ui/App.tsx`: the screen on top of the router's stack, the tab bar
on a start screen, the notice, and the sheets and dialogs. `ui/screens/index.tsx` says which component draws which screen,
and is the one list to change when a screen is built (practice-app groups 14 and 15 replace the placeholders that are left; practising, group 13, is built).

- **Direction:** `ui/` uses `app/`, `app/` uses `core/`. `app/` and `core/` import nothing from
  `ui/` or the adapters, and from `platform/` only `port.ts`. `web/test/layers.test.ts` scans the
  import lines (and checks that the scan flags a known-bad import), so a layer break fails the
  quick layer. It also checks that the app ships no test hooks: nothing in `src/` imports the fake
  platform or `web/test/`, or names `window.__test`, and `index.html` loads only `main.tsx`.
- **Why `.ts` below `ui/`:** `node --test` cannot load `.tsx`. Only `ui/`, `main.tsx` and `dev/`
  hold JSX, so everything a quick test imports is plain `.ts`.
- **The port** (`platform/port.ts`, whose comments are its specification) has four parts:
  - files: read and write text, write atomically, copy (binary), rename, list, remove, and a URL
    for an image;
  - scanner: `scan({ maxPages })` gives page images (`cancelled` is a result; "unavailable" is a
    `PlatformError` with that code);
  - reader: `read(pages, onEvent)` is one job for the ordered pages, with per-page `progress`,
    `done`, `no-music` and `failed` events, a final `finished`, and `cancel()`;
  - device: keep awake, app pause and resume, the back button, and the language.
- **Adapters:**

  | Adapter | Folder | Used by | What it is |
  |---|---|---|---|
  | fake | `platform/fake/` | quick layer (`app/` tests), mac layer | in-memory files; a scripted scanner and reader; helpers to arrange and inspect |
  | browser-dev | `platform/browserDev/` | `npm run dev` in desktop Chrome | IndexedDB files, the browser's file dialog as the scanner, a reader that answers with committed MusicXML |
  | capacitor | `platform/capacitor/` | the app on the phone | Capacitor's Filesystem, App and Device plugins, the community KeepAwake plugin, and our Scanner, Reader and AtomicFiles plugins (`android/`); see "The Capacitor app" below |

  The fake and browser-dev files share one implementation (`platform/keyValueFiles.ts`) and one
  atomic-write helper (`platform/atomicWrite.ts`), and their readers one scripted job
  (`platform/scriptedReader.ts`), so a test against the fake says something about browser-dev too.
- **Scripting the fake** (`web/test/fakePlatform.test.ts` has working examples):

  ```ts
  const platform = createFakePlatform()
  platform.scanner.willReturn(2)                                   // the next scan returns 2 pages
  platform.reader.willRead([{ result: 'done' }, { result: 'no-music' }])
  platform.files.fault = (op) => { if (op === 'rename') throw new Error('crash') }
  ```

  `createFakePlatform({ autoRun: false })` lets a test deliver the reader's events one at a time
  with `job.step()` (and `job.flush()` for all the rest).

## Running the app in browser-dev

```
cd web && npm run dev
```

Vite serves the app with hot reload at <http://localhost:5173/> (the next free port when 5173 is
taken), with no phone and no emulator. The adapter is `platform/browserDev/`. Two pages:

- `/` is the app: the home, the library, the favorites, the settings (practice-app group 12) and practising a piece
  (group 13: the practice screen and its loop and tools sheets) are built; adding music and the editor are
  placeholders with a Back button until groups 14 and 15. Practising plays real sound (the samples are served next to the page). It starts
  empty, as a first launch; the files are in the same IndexedDB database as the next page.
- `/dev/platform.html` is the platform check page (`web/dev/`, never part of the build). It drives
  the browser-dev platform the way the add-music flow will:
  - **Scan pages** opens the browser's file dialog; pick one or more images (for example
    `web/test/fixtures/page.jpg`). They are used as they are, with no cropping. Each page is copied
    into IndexedDB and shown through `files.imageUrl`.
  - **Read pages** starts one reading job. Every page answers with the committed
    `web/test/fixtures/practice-exercise.recognised.musicxml`, with the real reader's events one
    after the other. **Cancel reading** stops it.
  - **Stored** lists the stored files, `recognised.musicxml` among them. They stay after a reload.
    **Clear** removes them.

Files live in the IndexedDB database `snapsody-browser-dev` of the page's origin. To start from
nothing, use Clear or DevTools, Application, Storage, "Clear site data". In browser-dev, Escape
stands in for the back button, and a hidden tab for the app going to the background.

## Quick layer

- **Web:** `web/test/*.test.ts` with `node --test` (`npm test` in `web/`). `npm test -- --watch`
  reruns them on save. `npm run typecheck` (TypeScript, in `web/`) is separate; `npm run build`
  runs it before Vite.
- **Platform and layers:** `web/test/fakePlatform.test.ts` (atomic write, copy, rename, list,
  remove, the scripted scanner, per-page reader events, the device) and `web/test/layers.test.ts`
  (the import rules above).
- **The shell (`app/shell.ts`):** `web/test/shell.test.ts` runs the start-up against the fake platform: the order (settings,
  sweep, first list), a piece recovered from a temp file, the language from the settings and the device, the list read
  again when a screen that shows it comes back or the app returns from the background, the back button, and the
  notice for a rejected save or an unreadable library.
- **Storage and settings (`app/`):** `web/test/library.test.ts` (the pieces on the fake files: the
  format 2 layout, a new piece built in a hidden folder, atomic updates, a write cut off between the
  temp file and the rename, the start-up sweep, damaged pieces in the list) and
  `web/test/settings.test.ts`.
- **Kotlin:** `android/app/src/test/java/` with JUnit 4 on the plain JVM
  (`./gradlew :app:testDebugUnitTest` in `android/`). The real `org.json` is on the test
  classpath, and Android stubs return default values. Neither the model files nor the web build are
  needed. The plugins' handlers are plain classes, so they run here:
  - `ScannerHandlerTest` covers the ML Kit options, the stored pages, cancelling and "unavailable";
  - `ReaderHandlerTest` covers one job for the ordered pages under one foreground start, the
    per-page events, cancel, no music, failed pages and a failed job;
  - `AtomicFilesTest` covers the native atomic write. A crash at any step leaves the old or the new
    file, never none, and a file move replaces its target in one step.

  The first run in a fresh checkout also lets Chaquopy install its Python packages (about a
  minute).
- **Plugin contract:** `fixtures/bridge/` holds one example per call and event of our Scanner,
  Reader and AtomicFiles plugins (see its README). Three checks use it:
  - the Kotlin handler tests above;
  - `web/test/pluginContract.test.ts`, for the fake platform;
  - `web/test/capacitorAdapter.test.ts`, for the Capacitor adapter.
- **Capacitor adapter:** `web/test/capacitorAdapter.test.ts` runs `platform/capacitor/` against
  mock plugins (`web/test/capacitorMocks.ts`). The mocks behave like the real ones on Android:
  - the Filesystem plugin's delete-then-rename;
  - DoesNotExist on missing paths;
  - NoParentDirectory;
  - DestinationDirectoryExists.

  The test checks the port's semantics on top of them: what the fake does for files, a scanned
  page's absolute path, the Reader's events and cancel, and the device.
- **Stored pieces:** `web/test/fixtures/stores/<version>/` is a committed copy of the app's data
  folder (`pieces/<id>/...` and `settings.json`) in each storage format the app has written since
  pieces were introduced (`v2`: format 2, built from the two-page fixture). A change to the format
  adds a folder for its version and never edits the old ones; `web/test/storedFormats.test.ts`
  puts each in the fake platform's files and loads it with the current library and settings code.
  The first version's Kotlin store and its fixtures went with the old host (practice-app task 10.1).

Measured on the development Mac (Apple Silicon, 8 GB), 18 Nov 2026:

| Run | Time |
|---|---|
| warm, nothing changed (Gradle tests up to date) | 1.6 s |
| warm, after an edit that recompiles Kotlin | 2.5–17 s |
| Gradle daemon stopped, configuration cached | 5.4 s |

After practice-app task 10.1 (the Capacitor project, 24 JVM tests and 436 web tests), on 18 Nov 2026:
3.7 s warm with nothing changed, and 11 s after an edit to `fixtures/bridge/`, which reruns the
JVM tests.

At the end of the practice-app change (task 16.1: 556 web tests and 26 JVM tests), on 18 Nov 2026
with no emulator running: 2.8–3.1 s warm with nothing changed, against the budget of 30 s, and
11 s right after the Gradle daemon was stopped (the first run after `make test-device`).

## Mac layer

`npm run test:ui` (in `web/`) builds the app with Vite into `build/web-test/`, the same build the
Capacitor app bundles, and runs `web/test/ui/*.test.ts` with `node --test` and the Playwright
library in headless Chromium, one file at a time.

- **The harness** (`web/test/ui/app.ts`) serves the build at Capacitor's local origin
  (`https://localhost/`) with the MIME types Capacitor's server gives, in a fresh 384×832 touch
  context per test (the S24's CSS size). Other hosts are refused, as in the app. The test entry lives in `test/ui/`, so
  `seeded.html` sets `<base href="/">`: the sample sets the player fetches next to the page come from the app's `samples/`,
  as they do at the root on the phone.
- **Two ways to start the app** (`App.start`, `withApp`):
  - `withApp({}, …)` loads the app's own entry, `/` (`src/main.tsx`, with the browser-dev platform), as the phone
    boots it. Only `harness.test.ts` does, since no journey would cover that entry otherwise.
  - `withApp({ seed }, …)` loads the **test entry**, `test/ui/seeded.html` (`seeded.tsx`): the same
    `mount(platform, root)` on the fake platform, so a journey runs the real shell on scripted files. It is built only
    by `test/ui/vite.config.ts` (next to the component gallery), never by the app's `vite.config.ts`, and nothing in
    `src/` knows about it (`layers.test.ts` checks that; after `./gradlew assembleDebug` the packaged
    `web/dist` has no `seeded` page and no `__test`).
- **Seeds** (`test/ui/seeds.ts`, `pieces.ts`): `seed` is a list of parts, applied in order, so a journey starts with exactly
  what it needs. `''` is an empty phone; `library` is "Ode to Joy" (3 pages, 12 bars, practised today, bar 2 at 60 BPM,
  metronome on), "C major warm-up" (a favorite, practised yesterday), "Even eighths" and "Étude in D", made by the real
  `createLibrary(files).create(...)`; `unpractised` is one piece nobody practised; `v2` is the pieces of the
  committed format 2 store (`fixtures/stores/v2/`, "Waltz study in G") and `v2-settings` its `settings.json` (clarinet,
  442 Hz, Dutch); `settings-unreadable` makes `settings.json` fail to read, so the settings are read-only. Pieces and
  settings are separate parts on purpose: a settings journey must not start from the fixture's Dutch. An unknown part
  throws. `language` (`withApp({ seed, language: 'nl-BE' })`) is what the fake device says the phone's language is.
  `reader: 'manual'` (`withApp({ seed, reader: 'manual' })`) makes the fake reader's jobs send their events only when the journey
  steps them (`platform.reader.jobs.at(-1)`: `step()`, `flush()`), so a journey can look at the reading screen and cancel it; by
  default a job runs through at once. The page the fake reader gives without its own score is four bars.
- **The fake platform in the page** is `window.__test` (`testHooks.ts`: `platform`, `shell`, `snapshot`), and `App` has
  the calls a journey needs: `back()` (the system back button; false means the phone would leave the app), `pause()`,
  `resume()`, `screen()` and `stack()` (what the router has open), `file(path)`
  and `filePaths()` (what is on the fake phone). `app.page.evaluate(() => window.__test!…)` reaches the rest, as the
  journeys do to change a piece while a screen is open.
- **A reload keeps the files**, as the phone does when the activity is recreated: `app.reload()` first writes the fake
  files to `sessionStorage` (`snapshot.ts`), and the entry reads them back instead of seeding (the seed applies only to the
  first start of a tab). The router starts again at the Practice tab.
- **Tests today:** `harness.test.ts` (the app's own entry starts and an empty phone gets the invitation, a `.wasm` file is
  served as `application/wasm`, other hosts are refused, the test audio clock follows `page.clock`, and the component gallery,
  `web/dev/gallery.tsx`), `samples.test.ts` (every bundled sample decodes), and the journeys, one file per main flow, each
  growing as its screens are built:
  - `practice.test.ts`: the home (task 12.1): continue card, rotation, shortcuts, first launch, refresh on return, Dutch;
    and practising (task 13): continue, Play and Pause with the real sound, the screen kept awake, the tempo and metronome,
    tap to start from a note, loop with a rest, the count-in (a general setting) and its visible count, scroll away and
    return to playing, the tools sheet (edit, favorite, back), the screen reopened after the editor, the landscape
    layout and turning the phone while playing, a missing piece and a sound that will not load, Dutch;
  - `library.test.ts` (task 12.2): the list and its summary lines, search, star and favorites, delete with the question,
    empty library;
  - `settings.test.ts` (task 12.3): the default instrument and the language as lines that open sheets, Dutch and English with a reload, the
    credits, the notice for settings that cannot be saved;
  - `addMusic.test.ts` (task 14.1): the hint, a scan of two pages stepped through the reading screen to one piece that opens in
    practice, no music on page 2 and scanning again, a page that fails, cancel (the button and Back) creating nothing, the
    scanner not available, pages added to a piece, Dutch;
  - `edit.test.ts` (tasks 15.1 to 15.4): the editor, opened by pushing it on the router (the tools sheet's Edit does the same):
    select, the photo strip (a piece made through the library with staff positions and a drawn picture), preview, the Note, Marks and Score tabs, warnings and their marks, saving (the stored score changes, the raw
    reading does not), Save & practice back to the practice screen or in its place, the discard question, Add pages, rename and a
    conflict.
- **Time:** timers, `Date` and `performance.now()` run on `page.clock`. A test `AudioContext`
  takes its `currentTime` from the same clock, so `page.clock.pauseAt(…)` then `runFor(ms)` moves
  playback and the cursor exactly. Recognition progress comes from the fake reader's scripted
  events.
- **Taps** use `page.touchscreen.tap`; they reach the score's note handling, so no pointer-event
  fallback is needed. Smooth scrolling is off, so a note does not move under a tap.
- **Selectors:** elements by role and accessible name (`getByRole('button', { name: 'Play' })`);
  score notes, which have no name, by the id the app's parser gives them (`web/test/ui/journey.ts`).
  Never CSS classes or layout positions for controls. The library journey reads the order of the rows from their titles
  (`.list-row-title`), which is reading text, not finding a control. The one exception is the score itself:
  `journey.ts` finds notes as SVG groups inside `.score-view` and reads the cursor's `.hl` class,
  because the engraved score has no accessible structure.
- **Scores:** `web/test/fixtures/practice-exercise.musicxml` (19 bars, 3/4, G major, triplets,
  slurs, staccato, a repeat with two endings) and its recognised variant (no beams, one triplet
  repair, one note out of range), written by `node test/fixtures/make-practice-exercise.ts`.
- **Journeys of the first version** (`practice`, `edit`, `scan`, `library`), the bundled sample-set decode check
  (`sampleSets`) and `touchAndClock` went with the old screens (practice-app task 2.3). The decode check of every bundled
  sample is back as `samples.test.ts` (task 7.3).

Measured on the development Mac, 18 Nov 2026, after practice-app group 2: `make test-mac` takes
4–5 s warm (quick layer about 2 s, Vite build and 4 harness tests the rest). The first version's
12 journeys took 21–22 s. After group 12 the mac layer has 43 UI tests.

At the end of the practice-app change (task 16.1: 76 UI tests), on 18 Nov 2026 with no emulator
running: `make test-mac` takes 87–95 s warm, against the budget of 3 min (the quick layer about
3 s of it, the Vite build and the UI tests the rest).

### Fast loop

- `npm test -- --watch` (in `web/`): the unit tests on every save.
- `npm run test:ui -- test/ui/<journey>.test.ts`: one journey (builds first).
- `node --test test/ui/<journey>.test.ts`: one journey against the last build, without building.
- `make test-mac`: everything, before a commit.

## Checking a screen by eye

The Figma design is finished and is not updated; new screens are not compared with it. A UI task is checked by
eye in the app itself and is named as manual in its tasks:

- Run the app in browser-dev (`cd web && npm run dev`, see "Running the app in browser-dev") in desktop Chrome, with the
  device toolbar at 360 × 780 (the S24's WebView size; 780 × 360 for landscape).
- Look at the screen in English and in Dutch (Settings, Language).
- `docs/design/deviations.md` records how the screens differed from the last Figma design on 2026-11-19. It is not
  added to.

## The Capacitor app

`android/` is the Capacitor 8 Android project, with the toolchain from the spike:
AGP 8.13.2, Gradle 8.14.3, Kotlin 2.2.20, Chaquopy 17.2.0, compileSdk 36, minSdk 29 and Java 21
(`openspec/changes/archive/2026-11-18-practice-app/evidence/spike.md`). The application id is `be.imagitech.snapsody`.

- **Building it:** `cd android && ./gradlew assembleDebug`. Before the assets are merged, the
  `syncWeb` task runs `npm run sync:android` in `web/`. That command builds the web layer into
  `web/dist` (Capacitor's `webDir`) and runs `cap sync android`, which copies the build to
  `android/app/src/main/assets/public/` and writes `capacitor.plugins.json`. The task is skipped
  when `web/` has not changed. The JVM tests do not trigger it.
- **The Capacitor CLI** lives in `tools/capacitor/`, not in `web/`. Its dependencies bring
  `@types/node`, which would break `web/`'s type check. `npm run cap -- <command>` in `web/` runs
  it.
- **Committed generated files:** `capacitor.settings.gradle`, `app/capacitor.build.gradle` and
  `capacitor-cordova-android-plugins/`. `cap sync` rewrites them with the same content. They are
  committed so that Gradle can configure a fresh checkout before any sync has run.
- **In a worktree**, point Gradle at the main checkout's build Python and packaged models
  (`-P` flags, or `ORG_GRADLE_PROJECT_…` variables set with `env`):

  ```
  ./gradlew -Pia.buildPython=<main checkout>/.venv-py310/bin/python \
            -Pia.modelAssets=<main checkout>/android/model-assets assembleDebug
  ```

- **Plugins:**

  | Plugin | Kind | What it does |
  |---|---|---|
  | `Scanner` | ours | ML Kit's document scanner, BASE mode with gallery import |
  | `Reader` | ours | homr through Chaquopy under one `mediaProcessing` foreground service per job |
  | `AtomicFiles` | ours | the port's `writeTextAtomic` and a file `rename`: fsync and `Os.rename` (design D4) |
  | `@capacitor/filesystem` | npm | all other file operations |
  | `@capacitor/app` | npm | pause, resume and the back button |
  | `@capacitor/device` | npm | the language |
  | `@capacitor-community/keep-awake` | npm | keeps the screen on |

  The plugin examples are in `fixtures/bridge/`. `web/src/main.tsx` picks the Capacitor adapter
  when `Capacitor.isNativePlatform()` is true, and browser-dev otherwise.

## Device layer

`make test-device` runs `EndToEndSmokeTest` (`android/app/src/androidTest/java/be/imagitech/snapsody/`), the
only instrumented test (practice-app task 10.6, design D15), on the `ia_test_api36` emulator
(Android 36.1, arm64, 4 GB), which it starts headless and stops again. It goes through the
Capacitor activity as a user would, with one page:

1. The test sets `ScannerPlugin.pageSource`, so the Scanner plugin returns the self-engraved page
   (`android/app/src/androidTest/assets/fixtures/engraved_page.png`, written by
   `.venv-convert/bin/python -I tools/models/make_inference_fixtures.py`, re-encoded as a JPEG like
   the scanner's) instead of opening ML Kit.
2. Add music (and the hint's "Open the scanner" while the hint is on), then the Reader reads the
   page under its foreground service, and practice opens on the new piece.
3. The piece folder is checked: `piece.json` with bars, the score file it names, the page photo and
   the page's reading.
4. The score renders, and after Play a note is highlighted and still is 2 s later. Then Pause.
5. A fresh activity shows the piece on the home's continue card, and it opens and renders.

It checks that each step completes, nothing more: no music comparison, no accelerator and no
timing, so it passes on the emulator's CPU. It removes the piece it made, and nothing else, so
it can also run on a phone that has pieces.

The app build has no test hooks. The test runs JavaScript in Capacitor's WebView
(`bridge.webView.evaluateJavascript`): it reads the screen through the DOM (`data-screen`,
`data-step`, `data-piece-id`, `.score-view g.note.hl`) and presses buttons by their accessible
names, in English, the emulator's language. A phone in another language needs English for
`DEVICE=phone`. Only the app has an androidTest variant: the root `build.gradle` switches off
those of the Capacitor and plugin libraries, so `./gradlew assembleDebugAndroidTest` builds the
smoke test alone.

`tools/test/device.sh` builds the debug and test APKs, stops the Gradle daemon (the daemon's heap
and the emulator do not fit in 8 GB together), boots the emulator from the clean snapshot
`ia_test_clean` without saving over it (the first run cold-boots and saves that snapshot), installs
both APKs, runs the test, and shuts the emulator down, also on failure. It refuses to start while
the AVD already runs, for example as `emulator-5554` started by hand: stop that one first
(`adb -s emulator-5554 emu kill`). `make test-device DEVICE=phone` runs the same test on the
connected phone instead.

Run it once per change, before archive. The S24 is only for what the emulator cannot show, checked
by hand when a change touches it: the camera and the ML Kit scanner, GPU speed, and how sound and
the screen feel on the real phone.

Measured on the development Mac, 18 Nov 2026, at the end of the practice-app change (task 16.3):

| | Emulator |
|---|---|
| boot from the snapshot | 5 s |
| accelerator chosen by the self-test (no OpenCL) | CPU, no crash |
| reading and save of the engraved page (the test's own log) | 26–35 s |
| the test itself (`am instrument`) | 35–53 s |
| full `make test-device` (build up to date, snapshot boot, fresh install) | 81 s |

The first version's smoke test took 38–77 s for recognition and save and 90–124 s for the whole
run on the same emulator; on the S24 the self-test picked the GPU and the page took 14 s.

## What happened to the instrumented tests

The test-pyramid change replaced the 15 instrumented test classes; each one is in git history.

| Before | After |
|---|---|
| `EditingTest`, `PracticeControlsTest`, `ScoreRenderTest`, `LibraryTest`, `RegionSelectionTest` | replaced by the four journeys (mac layer). Their detailed checks are node unit tests (`edit`, `player`, `practice`, `cursor`, `render`, `beams`). The restart survival is in the smoke test. These screens are about to be redesigned, so the old phone assertions were not ported one by one |
| `RecognitionTest` | its screens (progress, cancel, no music) are in the scan journey with scripted events; the real run is in the smoke test |
| `CaptureFallbackTest` | the fallback screen is in the scan journey; the picker part is dropped |
| `ExerciseStoreTest`, `WebLayerTest.forceCpuSettingOverTheBridge` | replaced by Kotlin JVM tests |
| `WebLayerTest` (origin, wasm, ping) | covered by the smoke test, which loads the page, renders with Verovio's wasm and uses the bridge |
| `ListeningTest` | replaced by the sample-set decode test in Chromium |
| `AcceleratorSelfTestTest`, `AcceleratorSelectorTest`, `InferenceServiceTest`, `HomrBridgeTest`, `GpuFallbackTest` | deleted, proven in the first change |

A change that touches models, inference or recognition brings its own checks; the tools are in
`tools/models/` and `tools/homr/`.

## One-time setup

- **Node** 26 and npm, then `npm ci` in `web/`.
- **Chromium for the UI tests** (about 150 MB, development only, never in the app):
  `npx playwright install chromium` in `web/`. Playwright is pinned in `web/package.json`.
- **JDK** 21 and the **Android SDK** (`ANDROID_HOME`, with `platform-tools` and `emulator`).
- **Python 3.10** in a virtualenv at `.venv-py310/` (for example `uv venv --python 3.10 .venv-py310`).
  Chaquopy uses it at build time, so the Kotlin JVM tests in `make test-quick` need it too.
- **For building the app:** `npm ci` in `tools/capacitor/` (the Capacitor CLI), and the packaged
  models (`android/model-assets/`, see the how-to that `./gradlew assembleDebug` prints without
  them).
- **For the device layer:** the AVD `ia_test_api36` (Android 36.1 Google Play arm64 image, 4 GB
  RAM), the packaged models (`android/model-assets/`, see the how-to that `./gradlew assembleDebug`
  prints without them) and the smoke test's page
  (`.venv-convert/bin/python -I tools/models/make_inference_fixtures.py`).

## Which layer a new test goes in

- **Logic** (score, editing, playback, practice, storage rules): a unit test in the quick layer.
  Put the logic in a plain `.ts` module (`web/src/core/`, or `web/src/app/` for the app's state
  and flows, tested against the fake platform) and test it with `node --test` in
  `web/test/<module>.test.ts`. Kotlin logic gets a JVM test in `android/app/src/test/java/` (plugin logic in a plain handler class).
- **A screen or a user flow:** the mac layer. Update or extend the journey test for that flow;
  do not add a second journey for the same screen.
- **Something only the real device shows** (camera, scanner, GPU speed, how sound and the screen
  feel): a manual check on the phone, named as manual in the task. Not an automated test.
- The device layer holds only the smoke test. It is not extended per change.

Tests in the quick and mac layers use only committed, self-made material. A test that needs the
local fixtures in `fixtures/local/` must skip with a message when they are absent, and must not be
the only test of a behaviour.
