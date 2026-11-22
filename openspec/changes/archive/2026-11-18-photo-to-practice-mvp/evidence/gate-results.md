# Feasibility gate results

Design D11 sets the gate. Task 3.7 adds the on-device results and the final pass/fail
decision. This file so far holds the Mac-side findings of task 3.1.

## 3.1 Python-version path (Mac, 2026-11-17)

**Status: passed, criterion narrowed (see Decision).**

Task 3.1 originally required MusicXML for the book photo that was byte-identical to
`fixtures/local/page.musicxml`. Exercise 87 (bars 1–19) is identical; the rest of the page
is not.

### Setup

- **Reference.**
  - Produced by homr 0.7.1 on Python 3.12, numpy 2.5.5, OpenCV 4.14.0 and ONNX Runtime
    1.32, with segnet on CoreML.
  - Reproducible: a rerun of the reference environment is byte-identical (about 9 s).
  - With title detection off, only `<work-title>` changes.
  - A CPU-only run (`--cpu`) gives the same notes as the CoreML run.
- **Target environment (`.venv-py310`).**
  - Python 3.10.22, numpy 1.26.2, opencv-python-headless **4.5.4.60**, ONNX Runtime 1.23.2,
    and the vendored homr with the patches in `vendor/PATCHES.md`.
  - Chaquopy ships OpenCV **4.5.1**, which has no macOS arm64 wheel; 4.5.4.60 is the
    closest version that installs as a wheel.
  - So 4.5.1 itself is only exercised on the phone (task 3.2 onwards).

### Result

The comparison uses `tools/homr/compare_musicxml.py`.

| Comparison | byte-identical | musical content (imgpos stripped) | bars 1–19 |
|---|---|---|---|
| target, title on vs `fixtures/local/page.musicxml` | no | no | **yes** |
| target, `--no-title` vs reference `--no-title` | no | no | **yes** |

The musical differences are in bars 25 and later, which belong to the following
exercises on the same page:

- an *f* dynamic is lost
- one G4 becomes F♯4
- a slur is lost
- one quarter note becomes an eighth

A further 97 `imgpos` comments move by ±1 px.

### Cause: OpenCV version, not Python or numpy

I isolated the cause by swapping one library at a time, using CPU-only runs of the same
vendored code:

| Python | numpy | OpenCV | ORT | same notes as reference |
|---|---|---|---|---|
| 3.10 | 2.2.6 | 4.14.0 | 1.23.2 | yes |
| 3.10 | 2.2.6 | 4.10.0 | 1.23.2 | no |
| 3.10 | 1.26.2 | 4.10.0 | 1.23.2 | no |
| 3.10 | 1.26.2 | 4.5.4 | 1.23.2 | no |

So Python 3.10, numpy 1.26.2 and ONNX Runtime 1.23 are compatible. The OpenCV version
alone changes the output.

The divergence shows up stage by stage:

1. **Before the patches.** `cv2.imread`, autocrop, resize, `cvtColor`, `findContours`
   and the segnet outputs are bit-identical. The first difference is CLAHE (164 pixels,
   ±1).
2. **After patches 3 and 4** (deterministic CLAHE, `minAreaRect` angle convention).
   Bar-line detection, note-head size estimation and the whole processing log become
   identical. Staves 0–2 (exercise 87) give the transformer bit-identical input.
3. **What still differs.** Staff dewarping (`staff_dewarping.py`: span points, then
   `remap`) differs on every staff. On staves 3–5 the dewarped crops change, and with
   them a few tokens.

### Why byte-identity is a fragile target

The CLAHE investigation showed that OpenCV's float results depend on the compiler
fusing multiply-adds in a particular build: 4.10 and 4.14 run the same algorithm and
still differ. Building OpenCV 4.14 for Android (D3 fallback 2) would therefore not
guarantee byte-identical output either.

Matching 4.14 exactly for dewarping would mean porting more OpenCV code. That covers at
least the `remap` input geometry and possibly `fitEllipse`, `HoughLinesP` and the
polygon-intersection helpers, each verified bit for bit.

### Decision

The user accepted the result: *"it is what it is.. just use it.. if its not perfect, thats ok"*.

- Task 3.1 and design D3 now require what D11 requires: exercise 87, bars 1–19, matches
  the reference. That holds.
- The small differences elsewhere on the page are accepted and recorded above.
- The path taken is **Python 3.10 + numpy 1.26.2 + OpenCV 4.5.x with homr's pins relaxed,
  plus patches 1–4 from `vendor/PATCHES.md`.** No further D3 fallback is needed.

## 3.5–3.7 On-device gate (Galaxy S24, 2026-11-17)

**Decision: the gate PASSES** against design D11:
- Bars 1–19 come out the same as a Mac's homr output.
- Recognition takes at most 30 s (target) and never more than 60 s (limit).
- The app was not killed for memory.

Building beyond the gate can go ahead.

### Setup

- **Device.** Samsung Galaxy S24 (SM-S921B, Exynos 2400), Android 17, build
  `S921BXXSIEZJ1`. It was on the bench, not cooled, and the runs followed each other.
- **App.** Debug build with the debug-only gate screen (`GateActivity`). It is started
  with `adb shell am start -n app.instrumentassist/.GateActivity --es run GPU,CPU`, and its
  inputs are pushed to the app's external files folder `gate/` (never bundled).
- **Python-version path** (task 3.1). Chaquopy 17.2 with Python 3.10.22, numpy 1.26.2,
  OpenCV 4.5.1 and Pillow 11.0.0, running homr 0.7.1 with patches 1–7 from
  `vendor/PATCHES.md`.
- **Models.**
  - segnet runs on LiteRT 1.4.2: the GPU delegate (OpenCL, fp16 precision allowed) or
    XNNPACK on 4 CPU threads.
  - The encoder and decoder run on ONNX Runtime Android 1.31.1 (CPU, 4 threads, fp32).
  - The decoder loop runs in Kotlin, with the key/value cache kept native.
- **Inputs.**
  - `ex87_crop.jpg`: exercise 87 cut from the reference photo (2212×966,
    `fixtures/local/exercise87_crop.jpg`).
  - `page.jpg`: the full reference photo.

### Timings (seconds) and memory, second run

| Input | Accel. | Total | segnet (GPU init) | Staff processing (Python) | Encoder | Decoder | MusicXML | Peak PSS |
|---|---|---|---|---|---|---|---|---|
| ex. 87 crop (18 tiles, 4 staves) | **GPU** | **7.7** | 1.9 (1.5) | 2.0 | 2.0 | 1.9 | 0.01 | 883 MB |
| ex. 87 crop | CPU | 14.4 | 6.6 | 3.1 | 2.9 | 1.7 | 0.02 | 1,175 MB |
| full page (30 tiles, 6 staves) | GPU | 12.1 | 2.5 (1.7) | 3.9 | 3.1 | 2.5 | 0.03 | 1,252 MB |
| full page | CPU | 27.4 | 13.8 | 6.0 | 4.5 | 3.0 | 0.04 | 1,244 MB |

The first run, a few minutes earlier, gave the same picture: crop 7.8 s (GPU) and 13.1 s
(CPU), page 11.5 s (GPU) and 22.9 s (CPU). Memory peaked at 0.9–1.3 GB PSS, with no
low-memory kill.

**Breakdown.**
- **GPU segnet.** About 25–30 ms per tile, plus a one-time ~1.5 s for compiling the GPU
  kernels. Task 4.3's kernel cache should remove that compile on later launches.
- **CPU segnet.** About 370–460 ms per tile, roughly 2× the pilot's `benchmark_model`
  figure. It is still within limits as a fallback.
- **Python staff processing** (detection, dewarping, crops) and the transformer take about
  2 s each for 4 staves.

### Accuracy (task 3.6)

The in-app check compares pitch, duration, tuplets, slurs and staccato in bars 1–19
(`ia_gate.compare_bars`). All four runs passed:

| Input | Reference (Mac, homr 0.7.1, same image) | GPU | CPU |
|---|---|---|---|
| full page | `fixtures/local/page.musicxml` | pass | pass |
| ex. 87 crop | `fixtures/local/exercise87_crop.mac.musicxml` | pass | pass |

For the full page, the phone's MusicXML has the same musical content as a Mac's
OpenCV-4.5 run for the *whole* page, on the GPU as well as the CPU. Only homr's `imgpos`
comments differ.

**homr reads the crop slightly differently from the full page.** This happens on a Mac
too, so it is not a port issue. Compared with the full-page reference:

- **Bar 15:** the crop loses the triplet marks, and the final quarter is also read as an
  eighth. The bar comes out as seven plain eighths (3.5 beats in 3/4) instead of two
  triplets and a quarter.
  - The bar-length check (task 7.2) will flag it. It is not exactly the "six eighths +
    quarter" case the specified triplet repair rewrites, so it is flagged, not repaired.
  - (This corrects the summary given when the gate decision was asked, which called it
    exactly the repair case.)
- **Bar 17:** the slur ends on a different note. The full-page reference is itself known
  to miss a slur end in bar 17.
- **Margins:** trying other crop margins on a Mac moved these differences around
  (bars 1 and 15–18) but never removed them.
- **Decision:** with the user's agreement, the gate compares each input with a Mac's output
  for the *same* image. Task 3.6, design D11 and the spec scenario were updated to say so.

### Notes for later tasks

- **4.3:** enable the GPU kernel cache. It removes about 1.5 s per first run after a launch.
- **4.x / 5.x:** peak memory of about 1.2 GB comes from the full-page path. Recognition
  normally runs on a crop (about 0.9 GB on the GPU).
- **CPU segnet** is about 2× slower than the pilot's `benchmark_model`. It's worth
  profiling if the CPU fallback matters on other phones.

## Follow-up: white margin around the crop (2026-11-17)

**Problem.** The crop issue above was in **bar 15**. In every unpadded crop, homr lost the
triplets and misread the final quarter as an eighth.

**Change.** The selected region now gets a white margin before recognition:
- 5% of its width on the left and right, 12% of its height at the top and bottom
- implemented in `ia_engine.pad_for_recognition`, which the gate uses now and the
  recognition job will use (design D5)

**Mac experiment** (`--cpu`, OpenCV 4.5; bars 1–19 against `page.musicxml`):

| Crop | Bar 15 | Bar 17 |
|---|---|---|
| 5 unpadded crops (different page margins) | wrong in all 5 | varied |
| 11 padded variants (pad 0–10% horizontal, 8–50% vertical, 4 different crops) | **correct in all 11** | differed in 4 |

- Bar 17's slur end is ambiguous in print (the reference misses one there too), and a
  slur never changes a bar's length.
- The chosen padding (5% / 12%) passes all 19 bars on the exercise-87 crop. A Mac
  output is in `fixtures/local/exercise87_crop_padded.mac.musicxml`.

**S24 result** (padded, compared directly with the full-page reference `page.musicxml`):

| Input | GPU | CPU | Bars 1–19 |
|---|---|---|---|
| ex. 87 crop | 8.0 s, 923 MB | 15.2 s, 1,196 MB | pass / pass |
| full page | 11.7 s, 1,290 MB | 29.6 s, 1,284 MB | pass / pass |

The crop now matches the full-page reference itself. Task 7.5's expectation of zero repair
flags for exercise 87 therefore stands. Padding adds about 5% to the crop's recognition
time.

The spec's triplet-repair example also had an arithmetic slip, now corrected: six plain
eighths and a quarter add up to 4 beats, not 3.5.

## Accelerator self-test, kernel cache and fallback (group 4, Galaxy S24, 2026-11-17)

**Self-test (task 4.1).**
- **Reference tile.** One 320 × 320 tile cut from the self-engraved test page
  (`tools/models/make_selftest_tile.py`). It has a slur, staccato, a triplet, a dynamic, an
  accidental and ledger lines, and 14,432 symbol pixels.
- **CPU reference.** LiteRT CPU on a Mac. Both files are packaged into the app with their
  hashes in `models.json`.
- **First launch** after clearing the app's data: the self-test ran in the background.

| | Agreement with the CPU reference | Median of 5 runs | Init |
|---|---|---|---|
| CPU (XNNPACK, 4 threads) | 100.000 % | 281 ms | 129 ms |
| GPU (OpenCL, fp16 allowed) | 99.889 % | 21.5 ms | 1,764 ms (no kernel cache yet) |

Decision: **GPU**. It agrees (≥ 99.5 %) and is faster. The instrumented test
`AcceleratorSelfTestTest` reaches the same decision with cached kernels (99.889 %).

**Kernel cache (task 4.3).** Measured with two launches of the gate screen on the engraved page,
with a forced stop in between:

| Launch | GPU init | First inference |
|---|---|---|
| 1 (empty cache) | 1,614 ms | 30 ms |
| 2 (cache from launch 1) | **171 ms** | 24 ms |

The cache file is 37 MB, kept in `code_cache/litert_gpu/`, which Android clears on app updates.

**Stored decision (task 4.2).** `AcceleratorSelectorTest` checks two things:
- The self-test reruns when the stored app version, a model hash or the driver string differs.
- It does not rerun otherwise.

The key on a Galaxy S24 is app version `0.1.0 (1)`, the five asset hashes, and
`Samsung Electronics Co., Ltd. | ANGLE ((Samsung Xclipse 940) on Vulkan 1.3.304) | OpenGL ES 3.2
Driver version: 25.6.4 …` plus the build fingerprint.

**Fallback (task 4.4).** `GpuFallbackTest` runs a full homr recognition of the engraved page
(32 bars). The GPU is made to fail after 2 tiles.
- The batch is redone on the CPU and the recognition completes with all 60 tiles on the CPU.
- The GPU is marked failed and the selector then picks the CPU.
- A further GPU request stays on the CPU.
- Its music equals the fallback run's in all 32 bars.

## End to end in airplane mode (group 14, Galaxy S24, 2026-11-18)

Release-equivalent setup: debug build `8920045`; the merged debug and release manifests have no
`INTERNET` permission. The user ran the steps with airplane mode on: "airplane mode perfect".

### 14.1 Exercise 87: accepted by the user without the photo run
The user chose not to photograph exercise 87 in airplane mode ("i believe it will work, just
confirm it and continue"). The task is ticked on that decision and the following evidence. The
evidence covers each step, but not as one offline run of exercise 87:
- **Offline capture and recognition:** exercise 88 went from photo to playback in airplane mode
  (below). Recognition also ran in airplane mode on 2026-11-17 (task 5.4).
- **Exercise 87 recognition:** from the cropped test image on 2026-11-18, with a network
  connection, 19 bars in 6 s (GPU). The earlier camera scan through the page scanner (task 6.1)
  also gave 19 bars.
- **Practice steps on exercise 87:**
  - The user played it at 96 and 50 bpm with the bundled sax and heard the same pitch (12.2).
  - Count-in, looping bars 9–12 and tap-seek pass in `PracticeControlsTest` on a Galaxy S24, and the
    user heard no gap at the loop wrap (12.5).
- **Permissions:** the merged manifests have no `INTERNET` permission.

### 14.2 Exercise 88
- **Capture:** the scanner worked offline and returned a straightened page of 3743 × 2959.
  The user then selected exercise 88.
- **Recognition:** about 4 s from the crop to the result, on the GPU. That includes 1.8 s to
  start the GPU segmentation model (the first recognition since the app started). From the log:
  segnet ready 08:11:57.2, `recognition.done` 08:11:59.1.
- **Result:** 5 bars, G major, 4/4, 29 notes and 1 rest, 4 triplet groups (12 notes), and the
  closing repeat sign (`<repeat direction="backward"/>`). No flags and no repairs.
- **Playback:** the user heard playback follow the repeat ("even the repetition symbol is
  recognized and played").
- **Errors and edits:** none. `current.musicxml` has the same pitches, values and dots as
  `recognised.musicxml`; the only difference is the order of elements written by the app's
  serialiser.
- The common-time sign is stored as a plain 4/4 time signature. It plays the same, and the
  rendered score shows "4/4", not the C symbol.
