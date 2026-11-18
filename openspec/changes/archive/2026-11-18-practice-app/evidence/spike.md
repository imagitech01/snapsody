# Capacitor spike (task group 1, design D1)

Run on 18 Nov 2026 on the development Mac (Apple Silicon, 8 GB) and the `ia_test_api36` emulator
(Android 36.1, Google Play, arm64, 4 GB). The project is in `spike/capacitor/`. `android/` and
`web/src/` were not touched; the old host still builds and its tests still pass (see the end).

The app was still called Scoremate when this ran, so the logs below say `app.scoremate`. It is now
Snapsody, `app.snapsody` (design D5).

| Task | Result |
|---|---|
| 1.1 Capacitor 8 project, the web build shows | **pass** |
| 1.2 Gradle setup: Chaquopy, homr sync, LiteRT, ONNX Runtime, noCompress, models | **pass** |
| 1.3 Reader plugin: list of pages as one job, progress, app switch | **pass**; needs the `mediaProcessing` service type for long queues |
| 1.4 Web platform: wasm, Verovio, sampler, Filesystem across a restart | **pass** (see the note on `instantiateStreaming`) |
| 1.5 Scanner plugin | **pass** on the S24 (2 pages, 2 file paths); also opened and returned 2 pages on the emulator |
| 1.6 Gate decision | left for the user |

**Recommendation:** Capacitor. Every point D1 asks the spike to show works on the emulator. The
two adaptations needed (Kotlin plugin, foreground service type) are small and documented below.

## Toolchain and versions

The coordinator's revised constraint applied: the Capacitor project uses the toolchain Capacitor
8.6.2 is built for. AGP 9.5 was **not** tried in the spike.

| | Spike (`spike/capacitor/android`) | Old host (`android/`, unchanged) |
|---|---|---|
| Android Gradle plugin | **8.13.2** (root classpath; the template has 8.13.0, and Capacitor's own module asks for 8.13.0, but the root version is the one that loads) | 9.5.0 |
| Gradle | **8.14.3** (wrapper from `cap add android`) | 9.8.2 |
| Kotlin | **2.2.20** (`org.jetbrains.kotlin.android`; the version `@capacitor/filesystem` 8.1.5 defaults to) | built into AGP 9 |
| Chaquopy | **17.2.0** (its docs list AGP 7.3–9.5) | 17.2.0 |
| compileSdk / targetSdk / minSdk | **36 / 36 / 29** | 37 / 36 / 29 |
| Java | **21** (Temurin 21.0.13; Kotlin `jvmTarget` 21, same as Capacitor's `compileOptions`) | 17 target |
| Python in Chaquopy | 3.10, numpy 1.26.2, opencv-python 4.5.1.48, pillow 11.0.0 (unchanged) | same |
| LiteRT / ONNX Runtime / ML Kit scanner | 1.4.2 / 1.31.1 / 16.0.0 (unchanged) | same |
| AndroidX | core 1.17.0, activity 1.11.0, appcompat 1.7.1 (Capacitor's `variables.gradle`) | core 1.19.1, activity 1.13.0 |

npm packages (exact pins in `spike/capacitor/package.json`): `@capacitor/core`, `@capacitor/android`
and `@capacitor/cli` **8.6.2**, `@capacitor/filesystem` **8.1.5**, `verovio` 6.4.0 and `vite` 8.3.5
(spike page only). The Capacitor 9 release candidate was not used.

What had to change in Capacitor's generated project:
- **Kotlin.** The template is Java-only. The root `build.gradle` adds the Kotlin and Chaquopy plugins
  to the buildscript classpath and sets `ext.kotlin_version`. `app/build.gradle` applies
  `org.jetbrains.kotlin.android` and `com.chaquo.python`, with `jvmTarget` 21.
- **Ported from `android/app/build.gradle.kts` into the template's Groovy `app/build.gradle`:**
  - the `syncHomrPython` task;
  - the `chaquopy {}` block, with `.venv-py310` as the build Python;
  - `noCompress` for `tflite` and `onnx`;
  - `android/model-assets` added as an assets dir in place, so the 150 MB are not copied;
  - `checkModelAssets`;
  - `abiFilters arm64-v8a`;
  - the LiteRT, ONNX Runtime and ML Kit dependencies.

  The Groovy files are kept, so `npx cap sync` keeps working.
- **Manifest.**
  - The template's `INTERNET` permission is removed with `tools:node="remove"`, as in `android/`. The
    app still loads from `https://localhost`, so the project's offline rule holds under Capacitor.
  - Added `FOREGROUND_SERVICE` and `FOREGROUND_SERVICE_MEDIA_PROCESSING`, and the Reader's service.
  - `allowBackup="false"`.
- `minSdkVersion` 29 in `variables.gradle` (the template has 24).
- `gradle.properties`: `-Xmx4g`, as in `android/`.

Not carried over (not needed for the gate): the web build as a Gradle task (`cap sync` copies
`www/`), the debug candidate-samples task, and the JVM test setup.

## 1.1 Capacitor project, the web page shows — pass

- `npx cap add android` in `spike/capacitor/`, with `capacitor.config.json` set to `appId: app.scoremate`,
  `appName: Scoremate` and `webDir: www`.
- `npm run build:www` builds the current `web/` with `--outDir spike/capacitor/www`, so nothing is
  written into `web/`. It also builds the spike check page into `www/spike/`. `npx cap sync android`
  copies `www/` into the APK.
- On the emulator, `am start -W -n app.scoremate/.MainActivity` gave `LaunchState: COLD`, then
  `Capacitor: Loading app at https://localhost`, then `Handling local request: https://localhost/assets/index-….js`.
  - The screenshot shows the current app's home: "Instrument Assist", Diagnostics, "Add exercise".
  - The library shows "s.postMessage is not a function". This is expected, because the old
    bridge does not exist under Capacitor (see Open issues for the cause).
- `dumpsys package app.scoremate` lists the requested permissions: `FOREGROUND_SERVICE`,
  `FOREGROUND_SERVICE_MEDIA_PROCESSING` and `ACCESS_NETWORK_STATE`. There is **no `INTERNET`**.

## 1.2 Gradle setup — pass

- `./gradlew assembleDebug` in `spike/capacitor/android` gives `BUILD SUCCESSFUL in 1m 16s` cold and
  11 s warm. An unfiltered `--rerun-tasks :app:compileDebugKotlin` prints no `w:` or `e:` lines. Gradle's problems report has two entries, both javac's "unchecked or unsafe operations" note on Capacitor's own `Plugin.java`. The APK is 258.5 MB (the old host's is 261.3 MB).
- `unzip -v app-debug.apk`; models are `Stored` (uncompressed), so `noCompress` applies:

  ```
  57311164 Stored 57311164 assets/models/segnet_fp32_b1.tflite
  52861122 Stored 52861122 assets/models/encoder_pytorch_model_509-….onnx
  47356003 Stored 47356003 assets/models/decoder_pytorch_model_509-….onnx
      1235 Defl:N      576 assets/models/models.json  (+ selftest_tile.u8, selftest_ref_cpu.u8)
  ```
- Native libraries: `libpython3.10.so`, `libchaquopy_java.so`, `libonnxruntime.so`,
  `libtensorflowlite_jni.so` and `libtensorflowlite_gpu_jni.so`, all under `lib/arm64-v8a/`.
- **Python sources.** Chaquopy packs them in `assets/chaquopy/app.imy`, a zip inside the APK, so the
  outer `unzip -l` does not list them. `unzip -l` of the inner archive shows `ia_engine.py`,
  `homr/main.py`, `homr/_backend.py` and 48 `homr/*.py` files in all, with no `.onnx`.
  - Its file list is **identical** to the old host's `app.imy` (`diff` of both listings).
  - `requirements-common.imy` holds `cv2`, `numpy` and `PIL`.
- **At runtime, on the emulator:**

  ```
  PythonEngine: selftest: python 3.10.22 (cpython), numpy 1.26.2, opencv 4.5.1, pillow 11.0.0,
    homr imported from /data/data/app.scoremate/files/chaquopy/AssetFinder/app/homr/__init__.py
  AcceleratorSelector: decision: CPU (GPU unavailable: … Can not open OpenCL library on this device …)
  ```

## 1.3 Reader plugin — pass

### What was built

The code is in `spike/capacitor/android/app/src/main/java/app/scoremate/reader/`.

- **`ReaderJob`** is today's `Recognition`, generalised to an ordered list of pages.
  - The job is one `InferenceThread.submit` that loops over the pages, under **one** foreground
    service start. There is no foreground start per page (D6).
  - Each page runs the unchanged `ia_engine.run_job`, so it is padded as today.
  - Events:
    - `progress` {page, pages, stage, fraction};
    - `page` {page, status `done|no_music|failed|cancelled`, musicxml, accelerator, seconds};
    - `finished` {status, seconds}.
  - Every page result is also kept natively, and `status()` returns them.
- **`ReaderService`** runs as `shortService` or `mediaProcessing`. The spike chooses the type per job,
  to measure both.
- **`ReaderPlugin`** is a thin Capacitor adapter with `read({pages, serviceType})`, `cancel`, `status`,
  and the spike-only `bundledPages()`.
- The recognition code (`inference/*`, `PythonEngine`, `ia_engine.py`) is copied from `android/`.
  Only the package changed, to `app.scoremate`.
- **Test pages.** `spike/capacitor/tools/make_pages.py` splits `tools/models/engrave.py`'s `TEST_ABC`
  into three self-engraved pages:
  - 12, 12 and 8 bars;
  - 2000 × 1084, 1130 and 744 px;
  - in `fixtures/assets/spike-pages/`, bundled in the APK.

### Expected output (added: there was no committed expected output for engraved pages)

- `spike/capacitor/tools/expected_musicxml.py` runs in `.venv-py310` on the Mac (OpenCV 4.5.4, the
  closest to Chaquopy's 4.5.1). It writes `fixtures/expected/page-{1,2,3}.musicxml`.
  - It follows the job's steps: `ia_engine.pad_for_recognition`, then homr with the app's
    `ProcessingConfig`, on the CPU.
- The criterion is the archived gate's (gate-results.md, 3.1 and 3.6): identical **musical content**,
  meaning identical after removing homr's `<!-- imgpos -->` comments.
- The tool is `spike/capacitor/tools/compare_musicxml.py`, restored from git `d922a04`.

### Run 1: three pages, with a switch to another app between pages

Job `57b0cef0…`, `mediaProcessing`, started from the spike page.

| Time | What happened (logcat) |
|---|---|
| 13:33:11.811 | `ReaderJob: started with 3 pages`, then `ReaderService: in the foreground as mediaProcessing (type 8192)` |
| 13:33:28.186 | `page 1/3 done in 16.4 s on CPU`; web: `reader page 1/3 done … musicxml 25251 chars … visibility=visible` |
| 13:33:30.252 | `START u0 {act=android.settings.SETTINGS …}` (switch to Settings) → web: `visibility hidden` |
| 13:33:46.803 | `page 2/3 done in 18.6 s on CPU`; web: `reader page 2/3 done … visibility=hidden`, written with the Filesystem plugin |
| 13:33:54.870 | `page 3/3 done in 8.1 s on CPU`, then `finished done after 43.1 s`; `ReaderService: stopped after 43.1 s` |
| 13:34:02.721 | back in the app: `reader status done …: 3/3 page results kept natively (p1:done p2:done p3:done)` |

- The web layer received pages 2 and 3 **while hidden**. Capacitor's `notifyListeners` reached the JS
  of a stopped activity, and the page wrote each MusicXML with the Filesystem plugin at once.
- The process stayed the same (pid 4585) throughout.
- The files were pulled with `adb shell run-as app.scoremate cat files/spike/reader/<job>/page-N.musicxml`
  and compared with the expected output:

| Page | byte-identical | musical content | bars | `imgpos` comments that differ |
|---|---|---|---|---|
| 1 | no | **yes** | 12/12 | 31 of 80, up to 13 px |
| 2 | no | **yes** | 12/12 | 13 of 71, up to 1 px |
| 3 | no | **yes** | 8/8 | 9 of 45, up to 3 px |

The only differing line in each file is the one carrying the `imgpos` comments. This is the same
class of difference the gate saw between the Mac and the phone: LiteRT segnet and OpenCV 4.5.1 on
the device, against ONNX Runtime and OpenCV 4.5.4 on the Mac.

**Also checked:**
- The two pages from the emulator scan (1.5 below) went through the Reader. Each gave
  `no_music … "No noteheads or clefs found"` and the job finished `done`.
- Cancel was exercised through the timeout path below: the running page reported `cancelled`, the
  rest were skipped, and `finished cancelled` followed.

### Foreground service type and time limit (Risks)

- **Today's `shortService` does not allow a long queue.**
  - Run 3: 30 pages, `shortService`, app in Settings from 3 s after the start.

    ```
    13:37:09.784 ReaderService: in the foreground as shortService (type 2048)
    13:40:09.798 ActivityManager: Short FGS timed out: ServiceRecord{… app.scoremate/.reader.ReaderService …}
    13:40:09.811 ReaderService: foreground time limit reached (shortService) after 180.0 s: cancelling the reading
    13:40:09.931 ReaderJob: …: page 19/30 cancelled in 6.1 s
    13:40:09.941 ReaderJob: …: finished cancelled after 180.2 s
    ```

  - The limit is a hard 180 s from `startForeground`, and it is not extendable from the background.
    It counts the whole job, so the limit is the queue's total time, not the time per page.
  - On the S24 CPU a full page takes about 28 s, so about 6 pages fit, and 10 pages (about 280 s) do
    not. On the GPU (about 12 s per page) 10 pages fit, but the CPU is the fallback.
  - The emulator's engraved pages are smaller and quicker (7–18 s), which is why run 2 (15 pages,
    `shortService`, 147.7 s) still finished.
- **`mediaProcessing` does.**
  - Run 4: the same 30 pages, `mediaProcessing`, backgrounded the whole time.

    ```
    13:40:37.834 ReaderService: in the foreground as mediaProcessing (type 8192)
    13:45:34.070 ReaderJob: …: finished done after 296.2 s
    ```

  - All 30 page events reached the web layer while hidden (30 files written).
- **Needed: `foregroundServiceType="mediaProcessing"` with `FOREGROUND_SERVICE_MEDIA_PROCESSING`.**
  - Android describes it as "media processing use cases such as video or photo editing and
    processing", with a limit of 6 hours per 24 hours. `onTimeout(int, int)` is called at the limit.
  - It was added in API 35, but the docs say it "can be also used on prior android versions" (no
    timeout callback there).
  - **Verified on API 36 only.** API 29–35 rests on the docs and was not run (see Open issues).
  - For API 29–33 the spike passes type 0, since mandatory types started with Android 14. That was
    not run either.
  - For the Play Store, a declaration of the use is needed for any type except `shortService`.
  - `dataSync` has the same 6-hour limit, but its documented use is data transfer
    (upload/download, backup, import/export). That fits reading photos to MusicXML less well than
    `mediaProcessing` does.
- **Pitfall found:** `androidx.core` 1.17.0's `ServiceCompat.startForeground` masks the type with
  `0x40000FFF`, which drops `mediaProcessing` (`0x2000`). That crashes with
  `InvalidForegroundServiceTypeException: Starting FGS with type none` (seen in the first run). The
  spike calls `Service.startForeground(id, notification, type)` directly.

## 1.4 Web platform — pass

The spike page is `www/spike/index.html` (source `spike/capacitor/web-spike/`). It is opened with
`am start -n app.scoremate/.MainActivity --es page spike/index.html`, a spike-only hook in
`MainActivity`, and logs through `console.log` to logcat (`Capacitor/Console`).

- **WebAssembly from Capacitor's origin.**
  - `instantiateStreaming: PASS https://localhost/test.wasm content-type=application/wasm add(2,3)=5`.
  - Capacitor's `WebViewLocalServer` serves `.wasm` as `application/wasm`. Our own MIME table is no
    longer needed.
- **Verovio.**
  - `verovio: PASS version 6.4.0-33d1633, wasm+toolkit 821 ms, page 1 of 1: 60 notes, 121953 bytes SVG`.
    The score was `web/test/fixtures/practice-exercise.musicxml`, and the screenshot shows it engraved.
  - *Note on the task's wording:* Verovio 6.4's build embeds its wasm in the JS chunk and calls
    `WebAssembly.instantiate(bytes)`. It never uses `instantiateStreaming` (the bundle has no such
    call). Both halves were checked: streaming works from the origin (`test.wasm`), and Verovio's wasm
    loads and renders.
- **Sampler.**
  - Tapping "Play a note" (`adb shell input tap`) loads the bundled tenor-sax set through
    `web/src/playback/webaudio.ts` (`loadSampleBank` and `Sampler`). It plays MIDI 56, with an
    `AnalyserNode` between the sampler's master and the destination.
  - Web layer: `sampler: PASS AudioContext running, sampleRate 48000, currentTime 1.91 s, 33 samples decoded, note 56 peak amplitude 0.142`.
  - Android audio (`dumpsys audio`): `new player piid:79 uid/pid:10224/4039 package:app.scoremate type:AAudio … usage=USAGE_MEDIA`, then `player piid:79 event:started`.
- **Filesystem across a restart.**
  - First launch with `fs=write`: `wrote token "token-1795005028096-gq6v9w" to file:///data/user/0/app.scoremate/files/spike/persist.txt`.
  - Then `am force-stop app.scoremate`; `pidof` confirmed the process was gone.
  - Relaunch (`LaunchState: COLD`, no write): `filesystem read: PASS read token "token-1795005028096-gq6v9w"`.
    `run-as … cat files/spike/persist.txt` gives the same token.

## 1.5 Scanner plugin — pass (S24)

`scanner/ScannerPlugin.kt`:
- `scan({ maxPages })`, default 10, calls `setPageLimit(maxPages)`. Gallery import is on, the result
  is JPEG, and the mode is `SCANNER_MODE_BASE`, as today.
- **The `IntentSender` fits without a helper activity.** In `load()` the plugin registers a
  `StartIntentSenderForResult` launcher through `bridge.registerForActivityResult` (public in
  Capacitor 8.6.2; `load()` runs while the activity is created).
  - Capacitor's `@ActivityCallback` only takes an `Intent`, which is why it isn't used.
- The pages' content URIs are copied, upright (EXIF), to `files/scans/<uuid>/page-N.jpg`. The call
  returns `{ pages: [{ path, width, height }] }`, or `{ pages: [], cancelled: true }`. It rejects
  with code `unavailable` when ML Kit cannot run.

**Extra evidence from the emulator (not the task's verification).** The Google Play image ran the
scanner on its virtual camera:
- `ResumedActivity: … com.google.android.gms/.mlkit.docscan.ui.DocumentScanningActivity`.
- Two pages were captured (with "+"), then Next:
  `scanner: PASS 2 pages: …/files/scans/2c45976f-…/page-1.jpg 898x968, …/page-2.jpg 902x963`.

**S24 check (18 Nov 2026, SM-S921B, wireless debugging).** The user scanned two pages in ML Kit,
cropped them in its own UI, and tapped Done:

```
14:14:13.025 ScannerPlugin: scan returned 2 pages into /data/user/0/app.scoremate/files/scans/f8cfbf27-…
14:14:13.067 Capacitor/Console: [spike] scanner: PASS 2 pages: …/page-1.jpg 3721x349, …/page-2.jpg 3625x392
```

The same launch also logged `instantiateStreaming: PASS` and `verovio: PASS` on the S24.

**How to run the 1.5 check on the S24:**
1. Connect the S24 and run `cd spike/capacitor && npm ci && npm run build:www && npx cap sync android`.
2. Run `cd android && ./gradlew assembleDebug && adb -d install -r app/build/outputs/apk/debug/app-debug.apk`.
3. Open the check page: `adb -d shell am start -n app.scoremate/.MainActivity --es page spike/index.html`,
   and watch `adb -d logcat -s Capacitor/Console:* ScannerPlugin:*`.
4. Tap "Scan pages (1.5, ML Kit, up to 10)". Photograph two pages, crop them in the scanner, and tap
   Next/Done.
5. Pass: the log shows `scanner: PASS 2 pages: …/page-1.jpg WxH, …/page-2.jpg WxH`. Optionally, tap
   "Read the scanned pages" to run them through the Reader on the GPU.

## Open issues

- **The old web bridge collides with Capacitor.** Capacitor's `native-bridge.js` defines a global
  `nativeBridge`. The old `web/src/bridge.ts` takes that global for its own host, which causes
  "s.postMessage is not a function". This goes away when task 2.3 deletes the old bridge. The new
  `platform/` adapter must not use that name.
- **Safe-area CSS.** Capacitor's `SystemBars` logs
  `Error injecting safe area CSS: TypeError: Cannot read properties of null (reading 'style')` at
  start: it runs before `document.documentElement` exists. The app shell group should check that
  `--safe-area-inset-*` are set after load, or use `env(safe-area-inset-*)`.
- **The `mediaProcessing` service type was only run on API 36.**
  - Android 14 (API 34) enforces service types but predates `mediaProcessing`. Whether it accepts
    0x2000 rests on one sentence in the docs.
  - API 29–33 were not run either.
  - Check on an API 34 emulator image before the final Reader ships, or fall back to `dataSync`
    there.
- **`onTimeout` is called twice on API 36.** Both overloads fire, and the second `cancel` is
  harmless. The final service should handle the timeout once.
- **The Scanner call does not survive activity recreation.** If the system destroys the activity while
  the scanner is open, the pending call is lost. This was not seen. D15's handler-class split, or
  `bridge.saveCall`, can address it in the real plugin.
- **D7 staff positions are not shown yet.** D7 asks for one spike run showing that the staff
  positions reach the web layer. That needs the homr patch, which belongs to D7's own task, so it was
  not part of this spike.
- **`npm audit`** reports a high-severity ReDoS in `picomatch`, reached through `vite` 8.3.5. This is a
  dev-time dependency only, and `web/` uses the same `vite`.
- **The template's `capacitor-cordova-android-plugins/`** is generated and git-ignored. A fresh clone
  needs `npx cap sync android` before Gradle.
- **The Android build stays separate from npm.** `npm run build:www` and `cap sync` are run by hand. A
  Gradle hook like today's `buildWeb` can come with group 10.

## Files

Task 10.1 turned `spike/capacitor/android/` into `android/` and deleted the rest of `spike/capacitor/`.
The check page, the spike's test pages, their expected MusicXML and the tools below are in git
history; the last commit that has them is `e2622f5`.

- `spike/capacitor/`: `package.json`, `capacitor.config.json`, `vite.config.ts`, `web-spike/` (the
  check page), `tools/build-www.mjs`, `tools/make_pages.py`, `tools/expected_musicxml.py`,
  `tools/compare_musicxml.py`, `fixtures/assets/spike-pages/page-{1,2,3}.png`,
  `fixtures/expected/page-{1,2,3}.musicxml`, `android/` (Capacitor's template with the changes above).
- Root `.gitignore`: `spike/` became `spike/*` plus `!spike/capacitor/`, so the spike can be
  committed. The old spike leftovers stay ignored.

## Old host and test layers after the spike

- `make test-quick` passed in 3.9 s: 157 web tests and 12 JVM tests.
- `make test-mac` passed in 22.2 s.
- `git status` shows only `.gitignore` and `spike/capacitor/`.

## 1.6 Gate decision

**Capacitor**, agreed with the user on 18 Nov 2026 after the S24 scanner check. The fallback (our own
slimmed-down host behind the same port) is not needed. The toolchain for `android/` in 10.1 is the
one above: Capacitor 8.6.2, AGP 8.13.2, Gradle 8.14.3, Chaquopy 17.2.0, compileSdk 36. The Reader
uses the `mediaProcessing` foreground service type.
