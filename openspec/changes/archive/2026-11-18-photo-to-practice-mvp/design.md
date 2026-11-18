# Design

## Context

There is no code yet; this is the project's first change (see proposal.md, Why). Three spikes in `spike/` shape the design:

- **homr 0.7.1** (Python + OpenCV + 3 ONNX models, ~120 MB, AGPL-3.0) read exercise 87 perfectly on a Mac in ~20 s. About half of that is segnet, the page-segmentation model, run on 320×320 tiles. The rest is the transformer encoder and decoder, plus Python pre- and post-processing.
- **On the Galaxy S24 (Exynos 2400, Android 17),** segnet converted to TFLite runs correctly on the GPU through the LiteRT GPU delegate at ~21–26 ms per tile, against ~120–180 ms on the CPU. NNAPI/ENN does not reach the NPU and gives wrong results (`spike/npu/results.md`).
- **Claude's artifact** used pre-rendered MP3s at two fixed tempos and a hand-coded score, so nothing in it can be reused, but it set the UX bar: score, moving cursor, tempo choice, count-in, tap to seek.

Constraints: Android first and only for now, personal use, free and open source, fully offline, and the UI should stay portable to iOS later.

## Goals / Non-Goals

**Goals:**
- A thin native Android host, with all music logic (score model, repairs, editing, playback scheduling) in one portable web/TypeScript layer.
- A recognition engine behind a "image in → MusicXML out" interface, so a cloud engine can be added later without touching anything downstream.
- Settle on-device feasibility (the gate) before building the rest.

**Non-Goals:**
- No server component of any kind, not even optional.
- No cursor over the original photo in v1. The score is re-engraved; showing the original image (score-capture spec) covers comparison.
- No general notation editor. Editing covers only what recognition gets wrong in single-voice exercises.
- No reuse of homr's own MusicXML writer quirks downstream: everything after recognition reads standard MusicXML only.

## Decisions

### D1. Native Kotlin host + WebView UI (not Capacitor, not Flutter)
The app is a Kotlin Android app hosting one WebView. The UI and music logic are a TypeScript bundle served from the app's assets via `WebViewAssetLoader` (an https origin, needed for WebAssembly and fetch). A small JSON message bridge (`addWebMessageListener`) connects the two.
- *Why:* Chaquopy is a Gradle plugin for native Android projects, and the native side (camera, Python, LiteRT, files) is only a handful of services. A plain host keeps the build simple and the web layer portable.
- *Alternatives:* **Capacitor** gives a plugin system and iOS scaffolding, but adds tooling we don't need yet; the web layer can move into Capacitor later unchanged. **Flutter** would mean giving up the web-based renderer and audio and redoing the UI in Dart.

### D2. Capture with ML Kit Document Scanner, region selection in the web UI
Google's on-device ML Kit Document Scanner provides camera capture, gallery import, page edge detection, corner adjustment and perspective correction (score-capture). The straightened page goes to the web UI, where the user drags the box around one exercise; the native side crops at full resolution.
- *Why:* it covers four of the five score-capture requirements with a polished, tested UI, and runs on the device.
- *Permissions and fallback:* the scanner uses Google Play services' camera permission, so the app holds no camera permission. If the scanner cannot run (Play services missing or outdated, camera unusable, scanner error), the app says so and offers a gallery photo through the system photo picker, which needs no permission. That photo skips perspective correction and goes straight to region selection.
- *Network:* ML Kit merges in `INTERNET` for Google's usage logging. The manifest removes it (task 6.2), so nothing is sent.
- *Alternatives:* CameraX plus our own OpenCV edge detection, which is more work and gives a worse UX. *Trade-off:* ML Kit is a proprietary Google Play services component (see Risks). It sits behind a `PageSource` interface so an OpenCV implementation can replace it.

### D3. homr runs in Chaquopy; all model inference runs in Kotlin
homr's Python code (pinned to 0.7.1, vendored with a small patch set) runs inside Chaquopy for image processing and decoding logic. Every model call is redirected through Chaquopy's Java bridge to a Kotlin `InferenceService`:
- **segnet:** LiteRT `.tflite` (fp32 weights, fixed 1×320×320×3), GPU delegate or XNNPACK CPU per D4. Tiles are passed in batches through direct ByteBuffers.
- **encoder and decoder:** ONNX Runtime for Android on the CPU, using homr's existing ONNX files. The encoder may move to the GPU later if profiling shows it is worth it.
- **The decoder loop runs entirely in Kotlin.** homr's decoder is called once per output token with 32 growing key/value cache tensors. Crossing the Python–Java bridge per token would copy that cache hundreds of times per staff. Python passes the encoder output once per staff; Kotlin runs the full autoregressive loop (cache kept native) and returns the token sequence; Python continues with homr's post-processing.
- Title detection (RapidOCR) and PDF input are disabled.
- **Python versions:** Chaquopy's package index has OpenCV only for Python 3.8/3.10 (4.5.1) and numpy up to 1.26.2, while homr 0.7.1 declares Python ≥3.11, numpy ≥2.4 and OpenCV ≥4.13. A scan of homr shows no 3.11-only syntax and only basic numpy calls, so the plan is **Python 3.10 + numpy 1.26.2 + OpenCV 4.5.1 with homr's pins relaxed**, proven first on the Mac with the closest installable versions (MusicXML identical to the reference for exercise 87). Byte-identity for the whole page is not required: OpenCV's float results differ between releases and even between builds, so other exercises on the page may differ slightly (see `docs/gate-results.md` and `vendor/PATCHES.md`). If that fails, in order:
  1. Patch the specific incompatibilities in the vendored homr.
  2. Build newer OpenCV/numpy wheels for Android ourselves (Chaquopy's wheel-build tooling, or PEP 738 Android wheels on Python 3.13+).
  3. Port homr's image processing to Kotlin with the official OpenCV Android SDK.
- *Why:* there's no need for an `onnxruntime` Python wheel on Android, which may not exist in Chaquopy's package index. Accelerator choice lives in one place. And the pilot-proven LiteRT GPU path is used as is.
- *Alternatives:* (a) Python `onnxruntime` inside Chaquopy: availability uncertain, and no GPU. (b) Port homr's ~7.7k lines of Python to Kotlin or C++: best speed but weeks of work; postponed until profiling shows Python is the bottleneck. (c) Pyodide in the WebView: memory risk with 120 MB of models.
- The segnet conversion (fp16→fp32, batch fixed to 1, Resize sizes constant-folded, onnx2tf) becomes a reproducible build script based on `spike/npu/prepare.py` and `fold_resize.py`, with the equivalence checks kept as a test.

### D4. Accelerator self-test decides GPU vs CPU
On first launch, and whenever the app version, a model hash or the GPU driver string changes, the app runs segnet on a bundled reference tile on the CPU and on the GPU. The tile is **self-made**: dense single-staff notation (triplets, slurs, staccato, ledger lines) engraved with Verovio and rasterised at build time, so no copyrighted book content ships in the app. The GPU is used only if:
- symbol-pixel agreement is at least 99.5% (the pilot measured 99.92%), and
- its median over 5 runs is faster than the CPU.

The tile is the densest one on the engraved page that contains stems/rests, noteheads, clefs/keys and staff lines. Segnet's fifth class (other symbols) barely occurs on Verovio's engraving, so the tile cannot cover it. The "GPU driver string" is GL_VENDOR, GL_RENDERER and GL_VERSION (which carries the driver version), plus the build fingerprint, because the OpenCL driver the delegate uses is updated with the system. The result is stored, and the GPU delegate's compiled-kernel cache (in `codeCacheDir`) is enabled to avoid the GPU initialisation on later launches (measured on the S24: about 1.6 s without the cache, 0.17 s with it). Any GPU error during recognition falls back to the CPU for that run and marks the GPU as failed until the next self-test. (score-recognition, "Accelerated with safe fallback")
- *Alternatives:* a per-device allowlist (doesn't scale, and the Exynos and Snapdragon variants of the same S24 already differ); always-CPU (5–7× slower segmentation).

### D5. Recognition runs as a cancellable background job
Recognition runs as a job on the app's single inference thread (the GPU delegate must stay on one thread, D4). Meanwhile a foreground service of type `shortService` (no extra permission, 3-minute limit) keeps the app in the foreground, so the job survives brief app switches. It reports progress per stage and per staff to the UI. It can be cancelled: a cancel flag is checked before every segnet tile and decoder step, and at every progress point. The job writes only to its own cache folder, which is deleted afterwards, so it never creates an exercise. When homr finds no staff, or no noteheads or clefs, the job reports "no music found". Input is the cropped exercise image only, which also cuts the segnet tile count compared with a full page. Before recognition the crop gets a white margin (5% of its width left and right, 12% of its height top and bottom): homr misreads staves that touch the image edge (on the exercise-87 crop bar 15 lost its triplets in every unpadded crop, and was read correctly in all 11 padded variants; see `docs/gate-results.md`).

### D6. One score model in TypeScript; MusicXML is stored and exchanged
The web layer parses MusicXML into an internal score model (parts, measures, notes with pitch, duration, tuplet, tie, slur, articulation, dynamics, repeats). Every downstream function works on this model:
- repairs (bar length → triplets, time-signature inference, range flags)
- editing with undo/redo
- rendering
- playback scheduling

It serialises back to MusicXML for storage. Each exercise keeps two files: `recognised.musicxml`, which is never modified, and `current.musicxml`, the corrected version.
- *Why:* one model avoids drift between what is shown and what is played, and keeps the recognition engine swappable.
- *Alternatives:* repairs in Python with music21 (heavy, and splits the logic across two languages); editing MusicXML DOM directly (fragile).

### D7. Rendering with Verovio (WebAssembly)
Verovio renders the score model's MusicXML to SVG, with stable element ids per note. Those ids map notes to taps (seek and edit) and to the highlighted cursor.
- *Why:* best engraving quality for triplets and slurs, MusicXML input, SVG with ids, LGPL-3.0, and it re-renders a single exercise fast enough after each edit.
- *Alternatives:* OpenSheetMusicDisplay (MIT, built-in cursor, weaker layout control); hand-built VexFlow like Claude's artifact (too much layout work).

### D8. Playback: Web Audio sampler with a lookahead scheduler
A TypeScript scheduler expands the score into a timeline: repeats and first/second endings unrolled, ties merged, articulations applied. A lookahead loop (about 100 ms window) schedules sample playback on a Web Audio `AudioContext`.
- **Transposition:** sounding pitch = written pitch − 14 semitones.
- **Tempo:** notes are scheduled in beats and converted with the current tempo, so changing tempo never changes pitch. A tempo change during playback reschedules from the current note.
- **Legato under a slur:** the next note starts in its sample's sustain section, skipping the attack, with a short crossfade from the previous note.
- **Staccato:** about 50% of the written value with a short release.
- **Breath mark:** about a 1/8-beat gap.
- **Dynamics:** gain levels, using velocity layers if the sample set has them.
- **Cursor:** driven from `AudioContext.currentTime` minus `outputLatency`, so the highlight matches what is heard.
- **Count-in:** a click sample.
- *Alternatives:* native audio (Oboe plus a sampler such as sfizz) gives lower latency but needs native code and isn't portable; pre-rendered audio (Claude's approach) can't offer free tempo.

### D9. Tenor-sax samples: licensed set, chosen by listening
Required:
- per-note sustained samples covering concert A♭2–E5 (written B♭3–F♯6)
- a loopable sustain, or long enough for a whole note at 30 bpm
- a licence compatible with redistribution in an AGPL app (CC0 or CC-BY)

Selection is a task: a listening test renders exercise 87 at 96 and 50 bpm with each candidate.
- **Fallback:** record your own tenor sax, one note per semitone, with a short and a sustained version. The sample format (one file per note plus a JSON map) is chosen so either source plugs in.

### D10. Storage: one folder per exercise, owned by Kotlin
App-private storage holds one folder per exercise with:
- `source.jpg`: the cropped exercise
- `recognised.musicxml`
- `current.musicxml`
- `meta.json`: name, created date, last tempo, count-in, loop range

The web layer reads and writes through the bridge. Deleting an exercise removes its folder.

### D11. Feasibility gate (first milestone)
The gate passes when, on the S24:
- recognition on the phone is faithful to homr on the Mac: bars 1–19 match in pitch, duration, tuplets, slurs and staccato, both for the full reference photo (vs `page.musicxml`) and for the exercise-87 crop (vs the Mac's output for the same crop). homr itself reads a crop slightly differently from the full page (on the Mac as well); those differences are recorded, not counted against the port,
- total recognition time is **at most 30 s (target) and must not exceed 60 s**, and
- the app is not killed for memory.

If it fails, try in this order: CPU-only with int8 segnet (needs an end-to-end accuracy check), then profile and port the slowest Python stages. If neither works, stop and revisit the approach in a new change (for example a self-hosted homr service) rather than building on a failed gate.

### D12. Test fixtures stay local
Photos of the method book and outputs derived from them (`page.musicxml`, `tile.npy`, crops) are copyrighted material. They live in a git-ignored `fixtures/local/` folder. Tests that need them skip with a clear message when the folder is absent. Committed tests use only self-engraved material (D4).

## Risks / Trade-offs

- [Chaquopy has no OpenCV/numpy builds matching homr's declared versions (verified on chaquo.com/pypi-13.1)] → Python 3.10 + numpy 1.26 + OpenCV 4.5.1 with relaxed pins, proven on the Mac first; ordered fallbacks in D3. This is gate task 3.1, because everything in group 3 depends on it.
- [Python pre/post-processing may be slow on the phone (dewarping, staff detection)] → The gate measures it. Cropping to one exercise cuts the work; port hotspots to Kotlin only if measured.
- [Sample quality may disappoint, especially legato] → Listening test before committing (D9); recording your own sax as the fallback; legato crossfade parameters tunable.
- [WebView audio latency varies across devices] → Cursor compensates with `outputLatency`; start latency is acceptable for practice.
- [ML Kit is proprietary inside an AGPL app; F-Droid would reject it] → Fine for personal and Play Store use. It sits behind `PageSource` so an OpenCV implementation can replace it before any F-Droid release.
- [A dependency (e.g. ML Kit) merges the `INTERNET` permission into the manifest] → Remove it with a manifest `tools:node="remove"` entry, then verify the scanner still works offline (task 14.1).
- [homr weights include non-commercial training data] → Acceptable for this free app. Noted in the proposal for any future paid tier.
- [App size ~150 MB (models, Python runtime, wasm)] → Acceptable for personal use. Int8 segnet and model download on first launch are later options.
- [The GPU self-test passes on a reference tile but a driver bug hits other inputs] → Use a reference tile with dense notation (self-engraved, see D4; no book content ships). Repair flags and the user's own review catch odd results; a setting to force the CPU is available for diagnosis.
- [Recognition errors in uncommon notation (D.C./D.S., grace notes, multi-bar rests)] → Out of scope; playback goes straight through, and the user can edit or ignore them.

## Migration Plan

Greenfield, so there is nothing to migrate or roll back. Before the first commit, add `.gitignore` entries for `.venv*/`, `spike/**/` build outputs, `fixtures/local/`, the book photo and Claude's artifacts, and Android/web build directories. Keep `spike/**/results.md` and the scripts as the record of the pilots, and move the book photo and `spike/homr/page.musicxml` into `fixtures/local/` (D12).

## Open Questions

- Which tenor-sax sample set: decided by the listening test in D9 (the approach and format are fixed either way).
- Whether int8 segnet replaces fp32: only relevant if the gate needs the CPU path, or to reduce app size.
- App name and icon.
