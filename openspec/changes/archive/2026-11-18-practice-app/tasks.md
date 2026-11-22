# Tasks

Layers are as in `docs/testing.md`: **quick** (`make test-quick`), **mac** (`make test-mac`) and **device** (`make test-device`, once before archive). Design references are D1–D16 in design.md.

## 1. Capacitor spike (gate, D1)

- [x] 1.1 Create a Capacitor 8 Android project in a spike folder (`spike/capacitor/`). Use application id `app.snapsody`, and serve the current web build from it. Verify: manual check on the emulator that the app starts and shows the web page.
- [x] 1.2 Move the Gradle setup into the spike project: Chaquopy, the homr sync task, LiteRT, ONNX Runtime, `noCompress` and the model packaging. Verify: `./gradlew assembleDebug` succeeds in the spike project, and the APK contains the Python sources and the model assets.
- [x] 1.3 Add a minimal Reader plugin that takes a list of pages as one job (D6) and runs the existing recognition on each, sending progress events per page. Verify: manual emulator check:
  - three bundled self-engraved pages on the CPU give MusicXML per page in the web layer, matching the committed expected output;
  - the job survives switching to another app between pages.

  Record whether the foreground service's time limit allows a long queue, or which service type is needed (Risks).
- [x] 1.4 Check the web platform in the spike:
  - Verovio's wasm loads from Capacitor's local origin, and a wasm file served there loads with `instantiateStreaming`;
  - the sampler plays a note;
  - a file written with the Filesystem plugin survives an app restart.

  Verify: manual emulator check; the results go in `openspec/changes/practice-app/evidence/spike.md`.
- [x] 1.5 Add a minimal Scanner plugin that opens ML Kit with `setPageLimit(10)` and returns the page files. Use an activity-result launcher, or a helper activity if the `IntentSender` doesn't fit (Risks). Verify: manual check on a Galaxy S24 (scanner) that two cropped pages come back as two file paths.
- [x] 1.6 Record the gate decision in `evidence/spike.md`: Capacitor, or the fallback (our own slimmed-down host behind the same port, D1). Verify: the decision is written down and agreed with the user before group 2 starts.

## 2. Web restructure, Preact and the platform port (D2, D3)

- [x] 2.1 Move `score/` and `playback/` to `web/src/core/` and update the imports and tests. Verify: quick (`make test-quick` green, with the same number of core tests as before).
- [x] 2.2 Add `preact` and `@preact/signals` and configure JSX (`jsxImportSource: "preact"`) for TS 7 and Vite 8. Verify: `npm run typecheck` and `npm run build` succeed with one `.tsx` component.
- [x] 2.3 Delete the old screens and the debug code: `main.ts` screens, `library`, `practiceControls`, `editor`, `recognition`, `regionSelection`, `flagReview`, `listening`, `exercises`, `exerciseName`, `bridge`, and the debug sample sets. Also delete their journeys and the tests listed in D15. Leave a placeholder app root. Verify: quick green; `npm run test:ui` runs the harness test only.
- [x] 2.4 Write `platform/port.ts` (files with text read/write, binary copy, rename, list and remove; scanner; reader taking a list of pages; device) and the fake adapter (in-memory files, scripted scanner and reader). Verify: quick, `web/test/fakePlatform.test.ts` (atomic write, copy, rename, list, scripted per-page reader events).
- [x] 2.5 Write the browser-dev adapter: IndexedDB files, a file-input "scanner", and a reader that answers with committed MusicXML. Verify: manual, `npm run dev` in desktop Chrome scans a fixture image and gets the committed score.
- [x] 2.6 Update `docs/testing.md`: layout of the layers, the adapters, and running the app in browser-dev. Verify: the documented commands run as written.

## 3. Instruments (D8)

- [x] 3.1 Add `core/instruments`: the definitions and registry of D8 (tenor and alto sax, clarinet, piano, guitar; violin and trumpet defined but hidden until their sounds exist). Verify: quick, `web/test/instruments.test.ts` (transpositions, ranges, names in en/nl).
- [x] 3.2 Make the timeline take the transposition from the instrument instead of `TRANSPOSE_SEMITONES`. Verify: quick, `web/test/timeline.test.ts`: written G4 sounds as F3 (tenor), B♭3 (alto), F4 (clarinet), G3 (guitar) and G4 (piano).
- [x] 3.3 Make the range check take `writtenRange` from the instrument in use, and compute warnings from score + instrument instead of storing them (D4). Verify: quick, `web/test/warnings.test.ts`: A3 is flagged for tenor and not for piano; fixing the note clears the warning.

## 4. Score model: new marks, hairpins, rests (D10)

- [x] 4.1 Add `tenuto`, `accent` and `fermata` to `Note`, and a `wedge` item, with MusicXML read and write. Verify: quick, `web/test/musicxml.test.ts` round-trips each mark and a crescendo/diminuendo.
- [x] 4.2 Add the edit operations: toggle tenuto, accent and fermata; add and remove a wedge from one note to another; note-to-rest and rest-to-note; insert before and after. Verify: quick, `web/test/edit.test.ts` with undo/redo for each operation, and the bar check after each.
- [x] 4.3 Make sure Verovio shows the new marks and hairpins. Verify: quick, `web/test/render.test.ts` finds the tenuto, accent, fermata and hairpin elements in the SVG.

## 5. Playback additions (D10)

- [x] 5.1 Metronome track from the beat grid, with beat 1 accented, following tempo and loops, switchable between lookahead windows. Verify: quick, `web/test/scheduler.test.ts` (clicks per bar in 3/4 and 6/8, switching on mid-play starts at the next beat).
- [x] 5.2 Rest between loop repeats (0, 1 or 2 bars), filled with clicks when the metronome is on, and count-in only before the first pass. Verify: quick, `web/test/timeline.test.ts` (a loop of bars 2–3 in 4/4 with a 1-bar rest at 60 BPM gives a 4 s gap).
- [x] 5.3 Fermata stretch, tenuto with no articulation gap, an accent attack boost, and hairpin gain interpolation. Verify: quick, `web/test/timeline.test.ts` and `web/test/player.test.ts` (fermata about 2×, accent gain above the neighbours, crescendo rising note by note).
- [x] 5.4 Pitch reference as a playback-rate factor, plus instrument switching during playback without a restart. Verify: quick, `web/test/sampler.test.ts` (442 Hz gives a rate factor of 442/440) and `web/test/player.test.ts` (switching instrument keeps the position).

## 6. Pages merge (D6)

- [x] 6.1 Add `core/pages`: merge parsed raw pages, renumber bars, drop a repeated clef, key or time at page starts, give notes new ids, and return each page's bar range. Verify: quick, `web/test/pages.test.ts` (8 + 6 bars give bars 1–14; a repeated key gives no change at bar 9; ids are unique).
- [x] 6.2 Run the repairs on the merged score, and append prepared pages to an existing corrected score using the clef, key and time in force at its end. Verify: quick, `web/test/pages.test.ts` (page 2 without a time signature is checked against page 1's 3/4 and gets no inferred flag; existing bars are unchanged after appending).
- [x] 6.3 Commit a self-engraved two-page fixture (one exercise split over two images) and its expected merged score. Verify: quick, `web/test/pages.test.ts` uses it; `tools/` regenerates it reproducibly.

## 7. Instrument sounds (D9)

- [x] 7.1 Choose the General MIDI SoundFont. Check the licences of MuseScore General, FluidR3 GM and GeneralUser GS, and only take one that may be redistributed in an AGPL app. Verify: the decision and licence text are recorded in `docs/samples.md`, and the licence goes into `NOTICE`.
- [x] 7.2 Write `tools/samples/convert_soundfont` (config per instrument: GM program, range, step 3; output map.json + OGG with loop points and gain). Verify: running it twice gives identical output; `tools/samples/check_map.mjs` passes for each folder.
- [x] 7.3 Generate sample folders for tenor sax, alto sax, clarinet, piano and guitar (plus violin and trumpet). Remove the FreePats set (`web/public/samples/tenor-sax/`), `tools/samples/convert_freepats_tenor.py` and its `NOTICE` entry. Verify: mac, the "decode every sample" test covers all folders; manual by ear: each instrument, legato, staccato, no crackle, decided side by side in browser-dev. All seven passed by ear (18 Nov 2026), so violin and trumpet are shown.
- [x] 7.4 Record the size per instrument in `docs/samples.md` (replacing the FreePats notes), and show violin and trumpet only if they passed 7.3. Verify: `docs/samples.md` lists the sizes and the decisions.

## 8. Storage and settings (D4, D5)

- [x] 8.1 Add the `app/library` store on the file port: format 2 layout, atomic writes, temp-folder build of a new piece, sweep of hidden folders, list and delete. Verify: quick, `web/test/library.test.ts` against the fake platform (a write interrupted between the temp file and the rename leaves the old piece).
- [x] 8.2 Add `app/settings` (default instrument, pitch reference, language, scan hint seen) with defaults. Verify: quick, `web/test/settings.test.ts` (defaults, and the value survives a reload).
- [x] 8.3 Add a committed v2 piece folder in `web/test/fixtures/stores/v2/`, and update the project rule in `openspec/config.yaml` that names the stored-format folder. Verify: quick, `web/test/storedFormats.test.ts` loads every folder under `stores/`.

## 9. App layer (D11, D12, D13)

- [x] 9.1 Add `app/i18n` with `en.ts` and `nl.ts`, plurals and relative dates, and language from settings or the device. Verify: quick, `web/test/i18n.test.ts` (nl has every key; "Practised yesterday" and "Gisteren geoefend"; plural pages).
- [x] 9.2 Add `app/router`: tabs, screen stack, sheet stack, and back behaviour. Verify: quick, `web/test/router.test.ts` (back closes the sheet first, then pops; back in the editor with edits asks first).
- [x] 9.3 Add `app/practiceSession`: player wiring, session instrument, tempo, loop and rest, count-in, metronome, follow, show bar and return, debounced `practice.json` saves, saving on pause and background, and `lastPracticed`. Verify: quick, `web/test/practiceSession.test.ts` with a controlled clock (restored settings, restart goes to the loop start, the session instrument is not saved).
- [x] 9.4 Home and library signals: continue piece, rotation, favorites, search ignoring case and accents, summary line. Verify: quick, `web/test/home.test.ts` and `web/test/search.test.ts`.
- [x] 9.5 Add `app/addMusic`: hint, scan, read the pages in turn, merge, save, add pages to a piece; cancel, no music on page N, and scanner unavailable. Verify: quick, `web/test/addMusic.test.ts` with the fake scanner and reader (no piece on cancel; the existing piece is unchanged when adding is cancelled).
- [x] 9.6 Add `app/editorSession`: selection, edits with undo/redo, live warnings, bar preview, title, dirty state and save & practice. Verify: quick, `web/test/editorSession.test.ts`.

## 10. Native plugins and the Capacitor Android app (D1, D7, D15)

- [x] 10.1 Turn the spike into the real `android/` project (Capacitor):
  - application id and namespace `app.snapsody`, app name "Snapsody";
  - delete `MainActivity`, `WebAssets`, `Bridge`, `BridgeHandlers`, `ExerciseStore` with its stored-format fixtures (`src/test/resources/stores/`), `Cropper`, `GalleryPageSource` and the old bridge fixtures.

  Verify: `./gradlew assembleDebug`; quick (JVM tests) green.
- [x] 10.2 Build the Scanner plugin as a plain handler class plus a thin Capacitor adapter (ML Kit, BASE mode, gallery import, up to 10 pages; "unavailable" when Play services can't run it). Verify: quick, a JVM test of the handler against `fixtures/bridge/scanner.*.json`.
- [x] 10.3 Build the Reader plugin as a handler plus adapter. One job takes the ordered list of pages, under one foreground service of the type chosen in 1.3. It sends progress per page, results per page, and cancel, no music (with the page) and failed. Verify: quick, a JVM test of the handler against `fixtures/bridge/reader.*.json`; `web/test/pluginContract.test.ts` checks the fake platform against the same examples.
- [x] 10.4 Patch `vendor/homr` to report the staff boxes and bars per staff, and whether the page's time signature was read or estimated (`timeEstimated`, D7), and return them from the Reader. Make `core/pages` treat an estimated time at a page start as absent (quick, `web/test/pages.test.ts`: an estimated 3/4 on page 2 after a 6/8 page 1 gives no time change). Store no positions when the counts don't add up. Record the patch in `vendor/PATCHES.md`. Verify (own verification, D7): on a Mac, `tools/homr/run_homr.py` gives byte-identical MusicXML before and after the patch for the engraved page and the local reference photos, and the boxes match the engraved page's layout; results in `evidence/staff-positions.md`.
- [x] 10.5 Add the Capacitor adapter of the platform port (files on the Filesystem plugin, except `writeTextAtomic`, which is a native method of our own with fsync and an atomic rename (D4), and missing paths, parent folders, file-versus-folder removal and rename onto a folder mapped to the port's semantics; image URLs, keep awake, app pause and resume, back button, device language). Verify: quick, `web/test/capacitorAdapter.test.ts` against mocked plugin objects that reproduce the real plugin's behaviour (delete-then-rename, `DoesNotExist` on missing paths, `NoParentDirectory`, `DestinationDirectoryExists`), and a JVM test of the native atomic write.
- [x] 10.6 Rewrite the smoke test for the Capacitor activity: a bundled page through an injected page source, reading, a saved piece, rendering, playback, and a restart. Verify: `./gradlew assembleDebugAndroidTest` builds it. It runs once, before archive, in 16.3.

## 11. UI foundation (D3, D14)

- [x] 11.1 Add the design tokens (colours, type, radii, spacing from the Figma frames) as CSS custom properties, plus the base styles and safe areas. Verify: manual by eye in `make ui-review` against frame 01. The review passed on 18 Nov 2026 except the system bars: their icons were white on the light app with the phone in dark mode. Fixed (D19, light system bars), and the user confirmed it on a Galaxy S24 (18 Nov 2026).
- [x] 11.2 Add the shared components: tab bar, sheet (backdrop, handle, Close), stepper, toggle, segmented control, list row, card, primary and secondary buttons, confirm dialog. Verify: mac, `web/test/ui/harness.test.ts` mounts each by role and name; manual by eye in `make ui-review`.
- [x] 11.3 Add the score island: a component that mounts Verovio and the cursor, with highlight bar and note, follow and scroll-away, and tap on a note. Portrait and landscape layout widths. Verify: quick, `web/test/cursor.test.ts` still green; mac journey in 13.1.
- [x] 11.4 Make the app denser, and give the score the height in landscape (D18, user feedback after 16.2): the mac journeys and the review at a Galaxy S24's 360 × 780 and 780 × 360; type one step smaller per role; space about two-thirds; primary button 44, tab bar 56; the practice header in one row; in landscape one bar on top with the header and the controls, and the score under it. Verify: mac, `make test-mac` green at the new viewport, and a new test (360 × 780 and 780 × 360, English and Dutch, every main screen and sheet) finds no sideways scroll and no touch box under 44 × 44; deviations recorded; review by eye in `make ui-review`, then one look on a Galaxy S24 in portrait and landscape.

## 12. UI: home, library, favorites, settings (frames 01, 03.1, 03.2, 07)

- [x] 12.1 Build the practice home (frame 01): continue card, rotation, browse and add music, first-launch invitation. Verify: mac, `web/test/ui/practice.test.ts` (first part) and the review by eye; deviations recorded in `docs/design/deviations.md`.
- [x] 12.2 Build the library and favorites (frames 03.1, 03.2): search, star, summary lines, delete with confirmation, empty states. Verify: mac, `web/test/ui/library.test.ts` (search, star, delete); review by eye; deviations recorded.
- [x] 12.3 Build settings (frame 07): default instrument, pitch reference, language, credits (sound licences). Verify: mac, `web/test/ui/settings.test.ts` (switching to Dutch changes the texts and persists); review by eye; deviations recorded.
- [x] 12.4 Update `docs/design/figma/frames.json` with frames 01, 03.2 and 07 and export their PNGs. Verify: `make ui-review` shows them next to the screens.

## 13. UI: practising a piece (frames 02.1–02.4; 02.5 dropped by D17)

- [x] 13.1 Build the practice screen, portrait (02.1) and landscape (02.2): header with bar position and follow state, score island, Restart, Play/Pause, Loop, BPM stepper, metronome toggle, count-in visible count, "Return to playing". Verify: mac, `web/test/ui/practice.test.ts` (continue from home, play, pause, tempo, metronome, show bar and return, landscape viewport); review by eye; deviations recorded (no page separators). Ticked on the mac part; the review by eye passed on 18 Nov 2026.
- [x] 13.2 Build the loop sheet (02.3: from and to bar, rest Off / 1 bar / 2 bars) and the tools sheet (02.4: edit and favorite, after D17). Verify: mac, `web/test/ui/practice.test.ts` (loop with rest, star from tools, the tools sheet has only those two rows); review by eye; 02.6 deviation recorded. Ticked on the mac part; the review by eye passed on 18 Nov 2026.
- [x] 13.3 ~~Build the session-instrument sheet (02.5).~~ Dropped by D17: the instrument is a general setting only. The sheet, its route and `PracticeSession.setInstrument` are removed.
- [x] 13.4 Update `frames.json` with 02.2–02.5 and their PNGs. Verify: `make ui-review` shows them. (D17 later marked 02.5 `replacedBy` and removed its PNG.)
- [x] 13.5 Act on the user's feedback (D17): the title is current after Save & practice; the tools sheet has Edit and Favorite; the count-in is a general setting, switched in Settings only; the view always follows; the practice controls are smaller, with Loop shaped like Restart. Verify: quick, `web/test/practiceSession.test.ts`, `settings.test.ts`, `storedFormats.test.ts`; mac, `web/test/ui/edit.test.ts` (new title on the practice heading) and `practice.test.ts` (scroll away and return, count-in from Settings in every piece, tools rows); review by eye in portrait and landscape, in Dutch. Ticked on the quick and mac parts; the review by eye passed on 18 Nov 2026.
- [x] 13.6 Act on the second feedback (D19): the practice header shows only the title, in portrait and landscape; Settings shows the default instrument and the language as one line each, with a sheet listing the choices; the pitch reference is removed from Settings, `app/settings`, `settings.json` and the sessions (playback at 440). Verify: quick, `settings.test.ts` (no `pitchReference` written; an old file with it still loads), `storedFormats.test.ts`, `practiceSession.test.ts`; mac, `web/test/ui/settings.test.ts` (open the instrument line, pick the clarinet, the line shows it and it is kept; the same for Nederlands; back closes the sheet without a change), `practice.test.ts` (the header has the title and no bar position), `density.test.ts` green with the new sheets; review by eye on a Galaxy S24.

## 14. UI: adding music (frame 05, hint, errors)

- [x] 14.1 Build the hint screen (no frame, D14), the reading screen (frame 05: page photo, "Reading page 2 of 3", page list, cancel), "no music on page N" with Scan again, and the scanner-unavailable message. Verify: mac, `web/test/ui/addMusic.test.ts` (fake scan of 2 pages, then one piece opens; scripted no-music on page 2; cancel creates nothing); review by eye; 04.x and 05 deviations recorded.
- [x] 14.2 Update `frames.json` with frame 05 and its PNG (04.x stay listed as replaced by the scanner). Verify: `make ui-review` shows it.

## 15. UI: editing a piece (frames 06.1–06.3)

- [x] 15.1 Build the editor frame: title, page photos, go to bar, + Add pages, score island with selection, photo strip ("Photo 1 · Bar 3", or the whole photo when there are no positions), Preview bar, Undo/Redo, warnings count with next, Save & practice, Cancel with the discard question. Verify: mac, `web/test/ui/edit.test.ts` (select, preview, save & practice opens practice; cancel with edits asks); review by eye.
- [x] 15.2 Build the Note tab (06.1): pitch − / +, accidental, length with dotted and triplet, rest toggle, note before and after, delete. Verify: mac, `web/test/ui/edit.test.ts` (step a pitch down and save: the stored score changes and the original reading does not); review by eye.
- [x] 15.3 Build the Marks tab (06.2): staccato, tenuto, accent and fermata toggles; slur, tie, cresc. and dim. by first and last note. Verify: mac, `web/test/ui/edit.test.ts` (add a slur and a crescendo, both visible after save); review by eye.
- [x] 15.4 Build the Score tab (06.3): key, time signature and written tempo. Verify: mac, `web/test/ui/edit.test.ts` (changing the key re-renders); review by eye; deviations recorded.
- [x] 15.5 Update `frames.json` with 06.2 and 06.3 and their PNGs. Verify: `make ui-review` shows them.

## 16. Integration

- [x] 16.1 Run quick and mac warm and check the budgets (quick ≤ 30 s, mac ≤ 3 min). Verify: the times are recorded in `docs/testing.md`. Quick 2.8–3.1 s, mac 87–95 s, warm.
- [x] 16.2 Manual checks on a Galaxy S24 (scanner, by ear, by eye):
  - scanning a two-page exercise into one piece;
  - each instrument and the metronome by ear;
  - portrait and landscape practice by eye;
  - the screen stays on during a long loop.

  Verify: the results are recorded in `evidence/device-checks.md`. All four passed (18 Nov 2026); the look is handled by D18 (11.4).
- [x] 16.3 Run the device smoke test once on the emulator. Verify: `make test-device` passes. Passed on 18 Nov 2026 in 81 s (reading and save of the page 35 s, on the CPU).
- [x] 16.4 Validate the change. Verify: `openspec validate practice-app --strict` passes.

## Workflow follow-up

- Archive the change after review, and sync the delta specs into `openspec/specs/`.
- Remove `spike/capacitor/` if it was not turned into `android/` in place. (Done in task 10.1: it became `android/`, and the rest was deleted.)
