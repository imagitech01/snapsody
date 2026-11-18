# Design

## Context

See proposal.md for the motivation. The app today has three parts:

- **Web layer (`web/src/`, vanilla TypeScript in a WebView).**
  - The core is well tested and pure: `score/` (model, MusicXML, repairs, editing, beams) and `playback/` (timeline, scheduler, Web Audio sampler, tempo). Verovio 6.4 (wasm) engraves the score.
  - The screens (`main.ts`, `library.ts`, `practiceControls.ts`, `editor.ts`, `recognition.ts`, `regionSelection.ts`, `flagReview.ts`, `listening.ts`) switch with `replaceChildren` and callbacks. Each one repeats the same DOM helpers.
- **Android host (`android/`, Kotlin).**
  - `MainActivity`, `WebAssets` and `Bridge` run the WebView and an 18-message JSON bridge.
  - `BridgeHandlers` and `ExerciseStore` hold domain knowledge: meta keys and practice keys.
  - The ML Kit scanner runs with `setPageLimit(1)`, and `Cropper` cuts out the app's own region box.
  - Recognition runs as a foreground job: Chaquopy Python (homr + OpenCV) calls `InferenceService` (LiteRT GPU or CPU for segnet, ONNX Runtime for the transformer).
- **Instrument values are hardcoded:**
  - `TRANSPOSE_SEMITONES = -14` (`playback/timeline.ts`);
  - the tenor range (`score/repairs.ts`);
  - `SAMPLES_URL` (`playback/sampleSets.ts`).

Known facts this design relies on:
- A full page takes about 12 s on the GPU and 28 s on the CPU (archived photo-to-practice-mvp `evidence/gate-results.md`).
- homr finds staff bounding boxes internally but does not put them in its MusicXML.
- The score model's durations are fractions, so `divisions` play no part after parsing.
- Beaming of sixteenths and shorter already exists (`score/beams.ts`).

## Goals / Non-Goals

**Goals:**
- Domain logic is written once, in TypeScript, so an iOS host only has to provide a scanner and a reader.
- The UI is thin: screens render state and send intents. Everything else is tested in the quick layer.
- The whole app runs in desktop Chrome with hot reload, without a phone, for UI work.
- The Capacitor shell is proven before any UI is rebuilt.

**Non-Goals:**
- The iOS host itself, and a reader that runs on iOS.
- A UI component library, routing by URL, or server-side anything.
- Changing recognition quality, the models or the accelerator selection. Only the per-staff positions are added to homr's output.
- Several voices or chords (see `instruments`).

## Decisions

### D1. Capacitor shell, behind a spike that runs first

Capacitor (8.x) replaces `MainActivity`, `WebAssets`, `Bridge` and `BridgeHandlers` with its own shell and plugin bridge. The native code we own is two local plugins:
- **Scanner** wraps ML Kit;
- **Reader** wraps the recognition job, its foreground service, Chaquopy and `InferenceService`.
- *Added in review (D4):* a tiny **AtomicFiles** plugin for the fsynced atomic write and rename over a file, because Capacitor's Filesystem rename is not atomic on Android.

Small device needs use existing plugins: back button, lifecycle, keep awake, status bar and filesystem. The exact packages are confirmed in the spike.

The spike is the first task group. It must show all of these on the emulator:
- the Capacitor app, with Chaquopy, homr, LiteRT and ONNX Runtime in its Gradle project, reads a list of committed page images through the Reader plugin as one job, with progress events, and the job survives an app switch;
- Verovio's wasm loads from Capacitor's local origin;
- the sampler plays;
- a file written through the Filesystem plugin survives an app restart;
- the ML Kit scanner opens and returns pages from a plugin.

Only then is the old host deleted.

- *Alternatives:* keep our own host and write a Swift host later. That remains the fallback if the spike fails. The `platform/` port (D2) keeps the rest of the app independent of the choice.
- *Why Capacitor:* it gives the iOS shell, safe areas, the back button, lifecycle and file access for free. The parts that stay ours (scanner and reader) would be ours under any shell.

### D2. Layers and the platform port

```
web/src/
  ui/        Preact components and screens; no logic beyond presentation
  app/       plain TS, no UI imports: router, library, practice session,
             add-music flow, editor session, settings, i18n; exposes signals
  core/      score/, playback/, instruments/, pages/ (merge); pure, no I/O
  platform/  port.ts (the interface) + adapters:
               capacitor/   the app on the phone
               fake/        mac-layer tests (scripted scanner and reader, in-memory files)
               browserDev/  `vite dev` in desktop Chrome: IndexedDB files,
                            file-input "scanner", reader answers with committed MusicXML
```

The port is the only thing `app/` knows about the platform. It has four parts:
- **files:** read and write text, write atomically, copy (binary), list, remove, rename, and a URL for an image;
- **scanner:** `scan({ maxPages })` returns page images;
- **reader:** `read(images)` returns one job for the ordered pages. It sends progress, done, no-music and failed events per page, and has `cancel`;
- **device:** keep awake, app pause and resume, the back button, and the language.

`app/` and `core/` import nothing from `ui/` or the adapters. The quick layer tests `app/` against the fake adapter.

### D3. Preact with signals; the score view stays imperative

- **State.** `@preact/signals` state lives in `app/` modules. `signals-core` has no UI dependency, so `app/` stays testable in node. Components read signals and call `app/` functions.
- **The score is an island.** A component mounts the Verovio SVG and the existing cursor and highlight code once, and updates them imperatively from playback events. The score never re-renders through Preact during playback.
- **JSX.** The TypeScript compiler builds it with `jsxImportSource: "preact"`, and Vite's built-in JSX transform handles it. No Babel, no extra type checker. The first task confirms that TS 7 and Vite 8 accept it.
- **Styling.** Plain CSS with design tokens as custom properties: the Figma colours, type scale, radii and spacing, written down by hand since Figma has no variables. Sheets, the tab bar, steppers and toggles are small components of our own.
- *Alternatives:*
  - React has a larger ecosystem but is heavier, with no gain here.
  - Svelte 5 and Vue need their own type checkers on TS 7, which is unverified.
  - Vanilla code would mean writing a small framework ourselves.

### D4. Storage in TypeScript on the file port, format version 2

```
pieces/<id>/
  piece.json          { format: 2, id, name, created, lastPracticed, favorite, score,
                        pages: [{ n, firstBar, lastBar, staves: [{ box, firstBar, lastBar }] }],
                        repairs, bars }
  practice.json       { bar, tempo, loop: {start, end} | null, loopRest: 0|1|2,
                        metronome }   (countIn and follow left in D17)
  score-<rev>.musicxml  the corrected, combined score; piece.json's `score` names it
  pages/<n>/source.jpg
  pages/<n>/recognised.musicxml   the page's raw reading, never modified
settings.json         { defaultInstrument, pitchReference, countIn, language | null, scanHintSeen }
```

- **Separate files for separate change rates.** Practice state changes all the time, the score only when editing.
- **Atomic writes.** Write `name.tmp-<ms since 1970, base 36>-<random>`, then replace the target in one step. The time prefix lets the sweep pick the newest of several temps. A new piece is built in `pieces/.tmp-<id>/` and renamed into place. Hidden folders are skipped by listing and swept on start. This is the rule `ExerciseStore` follows today, moved to TS.
  - *Found in review (group 8):* Capacitor's Filesystem `rename` on Android deletes the target before renaming, so it is not atomic, and it never fsyncs. The port's `writeTextAtomic` is therefore a native method of our own (write the temp, fsync, `Os.rename` over the target), not built on `Filesystem.rename`. This is a small third native piece next to the Scanner and the Reader; an iOS host gets it from `Data.write(options: .atomic)`.
  - As a second line of defence, the start-up sweep never deletes a temp file whose target is missing: it promotes it when it validates (the JSON parses, the score parses).
- **One commit point per piece change.** `piece.json` names its score file (`score`). Editing writes a new `score-<rev>.musicxml`, and adding pages first writes the new page folders and the new score file, then replaces `piece.json` atomically, then deletes the old score file. A crash leaves either the old or the new piece, never a mix. The sweep removes score files and page folders that `piece.json` doesn't reference, and only when `piece.json` parses; it never cleans inside a damaged piece. `writeScore` and `addPages` take the score file the caller based its change on and reject with `conflict` if `piece.json` names another (a stale editor or add-pages flow never overwrites a newer save). Score file names are `score-<1–9 digits>.musicxml`. The app runs the sweep before its first `list()`, so a piece whose `piece.json` only survives as a temp is recovered at start.
- **Images never cross the bridge as data.** The scanner returns file paths, and images are shown through the port's image URL (Capacitor's file URL conversion).
- **The library list reads every `piece.json`.** They are small, and the count is in the tens. A separate index file would only add a consistency problem.
- **Warnings are computed, not stored.** Bar-length, range and inferred-time warnings are worked out from the score and the instrument in use whenever the score is loaded or edited. `piece.json` keeps only the record of automatic repairs. This is what lets the range warning follow the instrument (`score-recognition`, "Range check").
- **The compatibility fixture starts again on the web side.** A committed format-2 piece folder goes into `web/test/fixtures/stores/v2/`. The Kotlin fixture of the first version (`android/app/src/test/resources/stores/`) is deleted with the old store. The project rule in `openspec/config.yaml` is updated to name the new location.

### D5. A fresh start: new application id, no migration

- The first version has been uninstalled from the S24, so there is no data to carry over.
- The app gets a new application id and code namespace, `app.snapsody`. Nothing reads the old `exercises/` folders.
- The app was first named Scoremate (`app.scoremate`). That name was already taken, so it became Snapsody before any release. An installed `app.scoremate` build is a separate app and can be uninstalled.
- The `ExerciseStore` format (format 1) is not supported. Pieces start at format 2.

### D6. Pages: read one at a time, merge in `core/pages`

- **Each page is still recognised on its own,** as today, but the Reader takes the ordered list of pages as **one job** under one foreground service. A queue run from TypeScript would have to start a new foreground service per page, and Android may refuse that once the user has switched to another app. The job reports progress and the result per page, and cancel stops the rest. `app/addMusic` keeps each page's raw reading and merges after the last page.
- **Merging is pure and lives in `core/pages`.** It takes the parsed raw page scores, concatenates their measures, renumbers the bars, drops a clef, key or time attribute at a page start that equals the one in force, gives notes new ids, and records each page's bar range.
- **Order for a new piece:** merge the raw pages first, then run the existing `prepareRecognisedScore` (repairs and time-signature inference) on the merged score. This is why page 2 is checked against page 1's 3/4.
- **Adding pages to an existing piece:** the new pages are merged and prepared with the clef, key and time in force at the end of the piece. The result is appended to the current, corrected score, and existing bars are never re-prepared.
- *Alternatives:*
  - Two separate pieces merged by the user: the same merge, plus a merge screen and a leftover piece.
  - Stitching the page images and reading them once: no XML merge, but homr would get one image with mixed scales.

### D7. Staff positions from homr (a recognition change, with its own verification)

- `vendor/homr` (patched, see `vendor/PATCHES.md`) also reports each detected staff's bounding box in the page image, in reading order, and how many bars came from it. The Reader returns them with the MusicXML.
- `app/` stores them per page as `staves: [{ box, firstBar, lastBar }]`, with boxes as fractions of the page image.
- The editor's photo strip shows the box of the staff that holds the selected bar. When none is known, it shows the whole photo.
- **The same patch says whether the time signature was read or estimated.** homr always writes a `<time>`: when the page has none printed, it writes n/4 from the median bar length, with no mark. Merged as is, a page 2 without a printed meter after a 6/8 page 1 becomes a time change to 3/4 at the page break (found in group 6). The Reader therefore returns `timeEstimated` per page next to the staff positions, outside the MusicXML, so the MusicXML stays byte-identical. `core/pages` treats an estimated time at a page start as absent: on a later page the time in force carries on, and on the first page the existing inference runs and is flagged as inferred.
- **Verification (rule: recognition changes bring their own):**
  - on the Mac, homr with the patch gives byte-identical MusicXML for the committed self-engraved page and for the local reference photos;
  - the staff boxes and bar counts for the engraved page match its known layout;
  - one run on the emulator in the spike shows that the positions reach the web layer.
  - The test layers don't re-test this.

### D8. Instruments in `core/instruments`

One definition per instrument:
- `id`;
- names in English and Dutch;
- family;
- `transpose` (semitones from written to sounding);
- `writtenRange` (MIDI);
- `clef`;
- `sound` (the sample folder).

The registry:

| id | transpose | written range | sound source |
|---|---|---|---|
| tenor-sax | −14 | B♭3–F♯6 | GM 67 |
| alto-sax | −9 | B♭3–F♯6 | GM 66 |
| clarinet | −2 | E3–C7 | GM 72 |
| piano | 0 | A0–C8 | GM 1 |
| guitar | −12 | E3–B5 | GM 25 (nylon) |
| violin, trumpet | 0, −2 | G3–E7, F♯3–D6 | GM 41, GM 57 (shown: they passed the listening check on 18 Nov 2026) |

How it's used:
- The timeline takes `transpose` from the instrument in use instead of the constant. It applies only to the sound. Nothing ever rewrites the written notes in the score (`instruments`, "Written notes are never transposed").
- The range warning takes `writtenRange`.
- Clef is used only for the default clef when a page has none.
- The practice session plays with the default instrument it opened with; there is no instrument for one session (D17).
- The default comes from `settings.json`, and is the tenor sax until the user chooses.

### D9. Sounds: a General MIDI SoundFont, converted at build time

- **A new converter,** `tools/samples/convert_soundfont.*`, reads an SF2 or SF3 file and a config that lists, per instrument, the GM program, the note range and the sampling step (every third semitone). It writes the existing sample format: `map.json` plus OGG files, sustain loop points taken from the SoundFont's loop data, and gain.
- **The runtime sampler doesn't change,** apart from two things:
  - choosing the folder per instrument;
  - a playback-rate factor for the pitch reference (`pitchReference / 440`);
  - *added after the sound task:* an `"attack": "always"` flag per sample folder, so piano and guitar (one-shot samples with a baked end fade) start every note from the strike, slurred ones included. Their SoundFont loops sit in the silent tail of the decay (see `docs/samples.md`).
- **Candidates:** MuseScore General, FluidR3 GM and GeneralUser GS. Their licences are to be confirmed in the first sound task. Only a licence that allows redistribution in an AGPL app qualifies. Its text goes into `NOTICE` and the in-app credits.
- **FreePats goes.** The tenor sax comes from the SoundFont like every other instrument. The FreePats set (`web/public/samples/tenor-sax/`), `tools/samples/convert_freepats_tenor.py` and its `NOTICE` entry are removed.
- **Size:** about 2–3 MB per instrument with step 3.
- **Already covered by tests:** the mac-layer "decode every sample" test covers every instrument folder without a change.

### D10. Playback additions in `core/playback`

- **Metronome.** The timeline already knows the beats (count-in uses them). A metronome track of click events is scheduled from the same beat grid. It has an accent on beat 1, follows tempo changes and loops, and is switched on or off between scheduler lookahead windows, so a change takes effect on the next beat.
- **Rest between repeats.** Loop expansion inserts `loopRest × bar length` of silence after each pass. When the metronome is on, the rest is filled with its clicks.
- **Fermata.** The timeline stretches the note to twice its value, so cursor and audio stay in sync automatically.
- **Tenuto and accent.** Tenuto removes the articulation gap. Accent raises the gain of the attack, about +4 dB, falling back to the dynamic level within the note's first 150 ms.
- **Hairpins.** A new model item `wedge {type: crescendo|diminuendo, start/stop note}` is read from and written to MusicXML `<wedge>`. Notes under a wedge get gains interpolated from the level at the start to the next dynamic, or one step (for example mf to f) when there is none.
- **Model and MusicXML round trip:**
  - `Note` gains `tenuto`, `accent` and `fermata`;
  - `edit.ts` gains the matching operations, plus note-to-rest and rest-to-note.

### D11. Practice session, home and library in `app/`

- **The practice session** owns:
  - the player;
  - the scroll-away state (following is always on otherwise, D17);
  - loop, rest, metronome and tempo, and it follows the count-in setting (D17);
  - the current bar.

  It writes `practice.json` debounced after changes, and at once on pause, on leaving the piece and on the app going to the background. It sets `lastPracticed` when playback first starts in a session.
- **Home and library** are derived signals over the list of `piece.json` files:
  - "continue" is the piece with the latest `lastPracticed`;
  - the rotation is the favorites;
  - search matches the name, normalised to lower case without diacritics.
- **"Show a bar"** scrolls the score view and sets follow to paused. "Return to playing" clears that. Neither touches the player.

### D12. Navigation, back button, device

- **Navigation.** `app/router` keeps a tab signal and a screen stack (home, library, favorites, settings, practice, editor, add-music, reading). Sheets are a separate overlay stack. No URL routing is used; in browser-dev the hash only mirrors the screen, for reloads.
- **Back button.** It closes the top sheet, otherwise pops the screen. In the editor with unsaved edits, it asks first (`score-editing`, "Save and practice").
- **Hand-offs (decided while building `app/`, not in the specs):**
  - After a new piece is read and saved, practice opens. Warnings never block practising, and the editor is one tap away in the tools sheet.
  - "+ Add pages" in the editor asks to save unsaved edits first. After the pages are added, the editor reopens on the new score.
  - "Save & practice" from an editor opened over a practice screen pops back to that practice screen, which reopens its session on the saved score. Opened from anywhere else, it replaces the editor with practice.
- **Keep awake.** On while the player is playing, released on pause and stop.
- **Background.** The app pause event, or `visibilitychange` in the browser, pauses the player and saves the session.
- **Orientation.** Rotation is allowed everywhere. Practice has its own landscape layout (frame 02.2); other screens just reflow.

### D13. English and Dutch without a library

- `app/i18n` holds two typed catalogues, `en.ts` and `nl.ts`. TypeScript makes `nl` provide every key of `en`.
- Plurals use `Intl.PluralRules`, and dates use `Intl.RelativeTimeFormat` and `Intl.DateTimeFormat` ("Practised yesterday", default piece names).
- The language comes from `settings.language`, else the device language (Dutch when it starts with `nl`), else English.
- *Alternative:* i18next or similar. It isn't needed for two languages and about 200 strings.

### D14. Figma frames implemented, and planned deviations

Implemented:

| Frame | Screen |
|---|---|
| 01 | Practice home |
| 02.1 | Practise, portrait |
| 02.2 | Practise, landscape |
| 02.3 | Loop sheet |
| 02.4 | Tools sheet (slimmed down in D17) |
| 03.1 | Library |
| 03.2 | Favorites |
| 05 | Reading pages |
| 06.1 | Edit, Note tab |
| 06.2 | Edit, Marks tab |
| 06.3 | Edit, Score tab |
| 07 | Settings |

Planned deviations (recorded in `docs/design/deviations.md`):

| Where | Deviation | Reason |
|---|---|---|
| all | "SIGHTREAD" becomes "Snapsody" | The user's choice of name; the first choice, "Scoremate", was already taken |
| 02.1, 02.2 | No page separators or page labels in the score | One continuous score per piece (user decision) |
| 02.5 | Not built (D17): no instrument for one session | The instrument is a general setting only (user feedback) |
| 02.6 | Not built: no "Show bar" and no page list; scrolling the score shows any bar, and "Return to playing" comes back (D17) | There are no pages in the practice score, and a bar number to type was not useful |
| 04.1, 04.2, 04.3 | Replaced by the ML Kit scanner's own screens, after a hint screen of ours (no frame) | The system scanner already captures, crops, reorders and retakes, and does it well |
| 05 | No fake "Notes detected" overlay; shows the page being read with a progress line | The overlay would claim detail we don't have |
| 06.x | "Pages 1/3" shows the page photos; the photo strip shows the staff, not an exact bar crop | homr gives staff positions, not bar positions |
| 06.2 | Slur, tie and hairpins chosen by first and last note, as the frame's hint says | — |
| 07 | No separate "Playback sound" row (the sound follows the instrument); pitch reference is adjustable; language and credits rows added | Spec: `instruments`, `app-shell` |
| 07 | The instrument list is ours (D8); Figma's piano, guitar, violin and flute were placeholders | — |
| 07 | A count-in switch is added under "Practising" (D17); it is the only place to switch it | The count-in is a general setting |
| 02.1, 02.2 | Controls smaller than the frames; in portrait, Loop has the shape of Restart (D17) | More room for the music (user feedback) |
| all | Empty states, the scanner-unavailable message, the unsaved-edits question and "no music on page N" have no frames | Designed in the same visual language |

### D15. Tests

- **Kept and moved to `core/`:** the score, playback, repairs, beams, tempo, timeline, scheduler and sampler unit tests.
- **Deleted:**
  - the journeys of screens that no longer exist (`web/test/ui/{practice,edit,library,scan,touchAndClock,sampleSets}.test.ts`) and `fakeBridge`;
  - `sampleSets.test.ts` (the debug sample sets), `exerciseName.test.ts` (replaced by the default-name test), and `bridgeContract.test.ts` (replaced by the plugin contract test);
  - on the JVM, `BridgeContractTest` and `ExerciseStoreTest`; the stored-format test moves to web.

  `practiceExercise.test.ts` and the other unit tests are kept where they test `core/` logic. The test harness, the `ui-review` page and the Playwright runner stay.
- **New quick tests:**
  - `core/`: pages merge, instruments, metronome, loop rest, fermata, accent, hairpins, MusicXML round trip of the new marks;
  - `app/`: library and search, practice session persistence, add-music flow with the fake reader (progress, cancel, no music), editor session warnings, i18n catalogue completeness.
- **Mac journeys, one per main flow:**
  1. add music: hint, fake scan of 2 pages, reading, one piece;
  2. practise: home, continue, play, loop with rest, metronome, show bar;
  3. edit: note, mark, preview, save & practice;
  4. library: search, star, delete;
  5. settings: default instrument, language.
- **Plugin contract:** `fixtures/bridge/` (directory kept) holds one example per Scanner and Reader call and event. The web fake and the Kotlin plugin handlers, kept as plain handler classes behind thin Capacitor adapters so they run on the JVM, are both checked against them.
- **Smoke test:** rewritten for the Capacitor activity. The androidTest build gives the Scanner plugin a page source that returns a bundled self-engraved page instead of opening ML Kit.
- **Also updated:** `make ui-review` and `docs/design/figma/frames.json` cover the frames of D14. `docs/testing.md` is updated.

### D16. Prepared for iOS, not built

- `ui/`, `app/` and `core/` are platform-free.
- An iOS host needs four things:
  - `cap add ios`;
  - a Scanner plugin (VisionKit document camera; whether it can crop and reorder is unverified);
  - a Reader plugin (the open question: Python on iOS, a port, or another engine behind the same image-to-MusicXML contract);
  - an audio-session setting, so Web Audio plays with the mute switch on (to verify).
- Nothing in this change depends on Android beyond the Scanner and Reader plugins and the small AtomicFiles write (`Data.write(options: .atomic)` on iOS).

### D17. Fewer practice settings, smaller controls (user feedback, 18 Nov 2026)

After trying the built app, the user asked for these changes before the archive:

- **The tools sheet keeps Edit and Favorite.**
  - "Go to bar" goes: scrolling the score shows any bar, and "Return to playing" comes back. `showBar` stays, for the scroll.
  - The instrument for one session goes, with its sheet (frame 02.5). The instrument is the default from Settings only, and the session no longer has `setInstrument`. `Player.setInstrument` stays in `core/`.
  - "Follow playback" goes: the view always follows, except while the user has scrolled away.
- **The count-in is a general setting, switched in Settings only.** It lives in `settings.json` (`countIn`, default off), not `practice.json`. A first version also kept the switch in the tools sheet; the user found that it still looked per piece there, so it was taken out. The session follows the setting while it is open.
- **`practice.json` drops `countIn` and `follow`.** The format stays 2: the fields are left out of what is written, and ignored when an older file still has them. The v2 fixture keeps them on purpose, to test that.
- **The practice controls are smaller.**
  - Portrait: Restart 48, Play 64 × 52, the tempo and the metronome 48 high. Loop is drawn like Restart (a 48 square with its label under it) at the same distance from Play. Before, it was a pill of another size that ran into Play when its label was long ("Herhaling 10–12").
  - Landscape: one row 48 high.
  - Nothing is under the 44 touch target.
- **Fixed with it:** after "Save & practice" with a new title, the practice heading showed the old name until the piece was opened again. The editor read the list again only later, and the heading preferred the list's name. Now the editor reads the list again after a rename, and the heading prefers the name the session read.

### D18. A denser look, and the height for the score in landscape (user feedback, 18 Nov 2026)

After the checks on the S24 the user said: "in general i notice app is large, large texts and a lot of space between everything. this takes away from the practice focus. also in landscape there is a lot of empty space with no use." The phone runs the WebView at **360 × 780** CSS px (480 dpi; `evidence/device-checks.md`), narrower than the 384 × 832 the mac journeys used, so the app looked bigger there than in the review. The frames' sizes are the other half: they are generous for a 400 px wide frame.

- **Look at the user's phone.** The mac journeys and `make ui-review` render at 360 × 780 and 780 × 360. The Figma PNG stays next to each screen for comparison.
- **Type, one step smaller per role.** The role classes and component rules change, not the meaning of the `--fs-N` tokens:
  - screen title 30 → 22, the continue card's title 28 → 20, sheet title and practice title 24 → 18;
  - section titles 19 and 18 → 16, the tempo value 30 → 20, large button text 15 → 14;
  - body and row text (14) and captions (10–13) stay.
- **Space, about two-thirds.**
  - The gutter goes from 24 to 16. Gaps between sections go from 32 to 20 and from 24 to 16, and gaps in a list from 12–14 to 8.
  - Padding inside cards and sheets goes from 20–24 to 12–16. The empty band above a screen's first line goes.
- **Heights.**
  - The primary button goes from 52 to 44, and the tab bar from 66 to 56 (plus the inset).
  - The root font size stays 16 px, and `--tap` stays 44: nothing anyone taps is smaller than 44 × 44 (D17).
- **Practice, portrait.**
  - The header is one row about 48 high: back, then the title with "Bar 2 of 12 · Following" under it at caption size, then the tools button.
  - The controls stay as D17 drew them, with less space around them. The labels under Restart and Loop drop to caption size.
- **Practice, landscape: the score gets the height.**
  - The header and the controls fold into one bar about 48 high at the top. From left to right: back, the title with the bar position under it (cut off with an ellipsis when long), then Restart, Play, the tempo stepper, the metronome, Loop and the tools button.
  - The metronome is an icon button that shows its state (on: tinted). Restart and Loop have no label under them; their names are their accessible names.
  - The score takes all the height that is left. The side insets (the camera cutout) are kept clear.
- **Not changed:** the engraving size of the score (Verovio's scale), colours, the content and order of each screen, and behaviour.
- **Guard.** A mac test at 360 × 780 and 780 × 360, in English and in Dutch, opens home, library, favorites, settings, practice with its two sheets, and the editor:
  - the page never scrolls sideways;
  - every button and link has a touch box of at least 44 × 44.
  
  A control that looks smaller gets its 44 from padding or a larger hit area. Any exception is listed in the test with its reason.
- *Settled while building it (task 11.4):*
  - The 44 rule made some editor controls taller: the Note, Marks and Score tabs (30 → 44), the three pills, Undo and Redo, Preview and back. The compact pitch stepper's buttons are 44 wide.
  - A toggle is a 44 × 44 button with the 36 × 22 track drawn in its middle.
  - The invitation title on an empty home or library is 18.
  - In landscape, "Bar 2 of 12 · Following" is one line under the title, cut off with an ellipsis.
  - The add-music photo box is clamped to 9–20 rem.
  - The review does not mock side insets, so the landscape bar's side padding is checked only on the phone.
- Recorded in `docs/design/deviations.md` as one general entry ("All frames: denser than the frames, D18"), plus the landscape practice layout under 02.2.

### D19. A plain practice header and a shorter Settings screen (user feedback, 18 Nov 2026)

After trying D18 on the S24 the user said "better", and asked for these changes:

- **The practice header shows only the title.** "Bar 1 of 88" and "Following" go, in portrait and landscape. "Return to playing" stays, because it is the way back after scrolling away. The session still knows the bar and the follow state; only the header stops showing them.
- **Settings: the default instrument and the language are one line each.** The line shows the current choice. Tapping it opens a sheet with the whole list as radio buttons. Picking one saves it at once and closes the sheet. Back or Close leaves the choice as it was.
  - The language list is: the phone's language (the current default, shown with the language it resolves to), English and Nederlands.
  - The count-in keeps its switch, and the credits stay.
  - Asked for afterwards: the green note card at the top goes (the subtitle stays, as on every tab), and so does the "Practising" label above the count-in, so the rows follow each other without a heading.
- **The pitch reference goes.** Nobody wants to change it, so playback is always A4 = 440 Hz.
  - It goes from Settings, from `app/settings`, from `settings.json` and from the sessions.
  - `settings.json` stays format 2: `pitchReference` is no longer written, and it is ignored when an older file still has it. The v2 fixture keeps the field on purpose, to test that.
  - `core/playback` keeps its rate factor (`pitchReference / 440`, D9) with 440 as the only value the app passes. It is tested and small, and `web/dev/listen.html` still uses it.
  - The `instruments` spec now says playback is tuned to 440, and the `app-shell` spec drops the setting.
- **Fixed with it: dark icons in the system bars.** With the phone in dark mode, the status bar and the navigation buttons had white icons on the app's light screen. Capacitor 8's SystemBars plugin follows the phone's dark mode by default (`DEFAULT`), and the activity theme was DayNight. Now the theme is `Theme.AppCompat.Light.NoActionBar` with light status and navigation bars, and `capacitor.config.json` sets `SystemBars.style` to `LIGHT`. The app has one light look, so this does not depend on the phone's mode.
- **Not changed:** the home card's "Bar 2 of 12 · 60 BPM" (the user named only the practice header), and the instrument and language names.

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| Chaquopy, homr sync and model packaging don't fit Capacitor's Android project | The spike is first, and the old host stays until it passes. On failure, fall back to our own slimmed-down host behind the same port. |
| A queue of up to 10 pages (about 28 s each on the CPU) runs past the 3-minute `shortService` limit that today's single-page job uses | The spike (1.3) runs three pages on the CPU, with an app switch, and records which foreground service type the Reader needs for long queues. The Reader runs the whole list as one job (D6). |
| ML Kit's scanner gives an `IntentSender`, and Capacitor's activity-result helpers expect an `Intent` | The spike registers an activity-result launcher from the plugin. If that fails, the plugin starts the scanner from a small helper activity. |
| A big single change stays unfinished for a long time | Tasks are ordered: spike, then core, then app, then UI flow by flow. The app runs in browser-dev throughout, and each group ends green in the quick and mac layers. |
| SoundFont winds sound synthetic | Compare the candidate SoundFonts by ear and pick the best for the winds. An instrument only ships when it passes the listening check. The five required ones are standard GM programs. |
| The APK grows by about 15–20 MB of samples | Sample every third semitone, OGG at a moderate quality. Measured in the sound task. |
| A tie or slur across the page break is lost | Not detectable from separate pages. The user adds it in the editor (Marks: Tie). |
| homr's bars per staff are off (merged or dropped measures) | The strip then shows the wrong staff, at worst a neighbouring one. When the counts don't add up to the page's bars, store no positions and show the whole photo. |
| Warnings computed at load time make large pieces slower to open | Pieces are tens of bars, and the checks are linear in the notes. |
| Self-built sheets and gestures feel clumsy | Keep them simple: a tap on the backdrop or Close dismisses, a drag only on the handle. Check by eye on the S24 at the end. |

## Migration Plan

None. The first version is uninstalled, and Snapsody installs as a new app (`app.snapsody`) with an empty library.

## Open Questions

- **Which SoundFont, and whether violin and trumpet ship.** Decided in the sound task by licence and by ear. This doesn't change the approach.
- **The app icon.** Not part of the design file. Drawn in this change (`tools/icon/make_icon.py`, sources in `docs/design/icon/`): a staff on the app's deep green, with the note being played on the soft box the practice screen draws behind the playing bar (chosen by the user from five directions). One script writes the adaptive icon (with a monochrome layer for themed icons), the bitmaps, the launch screens and the web favicon.
