# Proposal

## Why

The first change (photo-to-practice-mvp) proved the hard part: it reads a printed exercise on the phone and plays it back faithfully. But the app still looks like a technical demo. Region boxes, recognition stages, flags and accelerator settings are in the foreground, and practising is an afterthought.

This change turns it into a usable practice app, **Snapsody**. Practising a piece is the core of the app. Reading the music becomes one quiet step inside "add music".

Now is the right time:
- The engine is proven.
- The redesign exists in Figma.
- More instruments are wanted.
- The architecture has to keep an iOS version possible before the UI is rebuilt on top of it.

## What Changes

**Name and words**
- The app is called **Snapsody**.
- What the user practises is a **Piece** (Dutch: *muziekstuk*); "exercise" disappears from the UI.
- The UI is in English and Dutch.

**App shell**
- Three tabs: Practice, Library and Settings.
- A new visual style, based on the Figma design.
- Practice works in portrait and landscape.
- The screen stays on while a piece plays.

**Practice home**
- Continue the last piece where you left off: same bar, same tempo.
- "In your rotation" lists the favorite pieces, one tap to play.

**Practising a piece**
- One continuous score with no page separators. This deviates from Figma on purpose.
- The current bar is highlighted. Following playback can be switched off.
- Restart, play/pause and a tempo stepper.
- **New:** a metronome during playback, and loops with a rest of 0, 1 or 2 bars between repeats.
- Count-in is kept.
- Scroll to another bar while the music keeps playing.
- A tools sheet with: edit, favorite, count-in (slimmed down after the user tried it; design D17).
- Each piece remembers its place, tempo, loop and metronome. The instrument and the count-in are general settings.

**Library**
- All pieces, each with a summary line.
- Search, favorites (a star) and delete.

**Adding music**
- The system page scanner (ML Kit) takes several pages and crops each one in its own UI.
- Each page is read in turn, with progress, cancel and "no music found".
- The pages become **one piece** with continuous bar numbers.
- "Add pages" appends pages to an existing piece, for an exercise that continues overleaf.

**Editing a piece**
- The redesigned editor has a title field, the source photo next to the selected bar, and a preview of the selected bar.
- **Note:** pitch, accidental, length (dotted, triplets), rests, insert before or after, delete.
- **Marks:** staccato, slur and tie, plus new tenuto, accent, fermata, crescendo and diminuendo.
- **Score:** key, time signature and written tempo.
- Undo and redo.
- Gentle warnings for bars that don't add up and for recognition doubts.
- "Save & practice".

**Instruments**
- Tenor sax, alto sax, clarinet, piano and guitar, plus violin and trumpet when a good sound exists.
- Each one is a single definition: sound, transposition, written range and clef.
- A default instrument in Settings, which a practice session can switch.
- Piano and guitar are **melody only**: one line, no chords.
- The written notes are never transposed. The user plays the piece as printed, and each instrument sounds the printed notes the way that instrument does, so the same piece sounds lower on a tenor than on an alto.

**Sounds**
- One General MIDI SoundFont with a permissive licence, converted at build time into the existing sample format. It replaces the FreePats tenor-sax set for every instrument.
- The playback engine stays as it is.

**Playback**
- New marks are heard: tenuto, accent, fermata, crescendo and diminuendo.
- Metronome and rest between loop repeats.
- The sound and transposition follow the instrument in use.

**Architecture**
- **BREAKING:** a Capacitor shell replaces the app's own WebView host and JSON bridge. A spike that runs first must show that recognition, rendering, playback and storage work in it.
- The UI is rebuilt in Preact with signals.
- The code is layered: `ui/`, `app/`, `core/`, and a `platform/` port.
- Storage moves from Kotlin to TypeScript.
- Native code is limited to two plugins, the page scanner and the music reader, plus one atomic file write (found necessary in review: Capacitor's own rename is not atomic on Android).

**Stored data**
- **BREAKING:** a new storage format with a piece and its pages, under a new application id. Exercises saved by the first version are not carried over; that version has been uninstalled.

**Removed**
- The app's own crop box.
- The gallery-photo fallback when the scanner can't run.
- The flag-review mode, replaced by warnings.
- Debug pages: the listening page, test images and the force-CPU switch.
- The FreePats tenor-sax sample set and its conversion tool.
- The old UI code and its tests.

**Tests**
- Obsolete journeys and bridge examples are removed.
- New journeys cover each main flow.
- The quick layer stays fast.
- One end-to-end smoke test runs before archive.

**Out of scope**
- The iOS app itself (the architecture is only prepared for it).
- Chords, several voices and grand staffs.
- D.C., D.S. and Coda.
- Sync, sharing and accounts.
- Listening to the user's own playing.

## Capabilities

### New Capabilities

- `app-shell`: the app's frame. It covers its name, the tabs, the languages, orientation, keeping the screen on, and the Settings screen's general options.
- `practice-home`: the Practice tab's start screen. It covers continuing the last piece and the favorites rotation.
- `piece-library`: the pieces stored on the phone. It covers their pages and source photos, listing, search, favorites, renaming and deleting.
- `instruments`: the instruments a piece can be played with. It covers their sounds and licences, transposition, written range, the default instrument, and the fixed pitch reference (A4 = 440 Hz).

### Modified Capabilities

- `score-capture`: the ML Kit scanner takes several pages and crops them in its own UI. The app's region box and the gallery fallback go. Pages can be added to an existing piece.
- `score-recognition`:
  - Pages are read one by one and combined into one score before the repairs run.
  - Cancel and "no music found" now lead back to the scanner.
  - The range check uses the instrument in use instead of the tenor sax.
- `score-editing`:
  - Flag review becomes gentle warnings.
  - New marks, plus rests, insert before or after, and a bar preview.
  - The source photo is shown next to the selected bar.
  - Saving and deleting move to `piece-library`.
- `score-playback`:
  - The continuous score has a highlighted bar, works in landscape, and can stop following playback.
  - Tenuto, accent, fermata and hairpins are heard.
  - The tenor-sax sound and concert pitch move to `instruments`.
- `practice-controls`:
  - New: a metronome, a rest between loop repeats, restart, and go to a bar while playing.
  - Each piece remembers its place and its practice settings.
- `test-suite`: the fake bridge becomes a fake platform adapter, the contract describes plugin calls, the smoke test runs in the Capacitor app, and the storage-format check covers pieces.

## Impact

- **`web/`:**
  - New dependencies: `preact`, `@preact/signals` and the Capacitor packages.
  - The UI is rewritten in `ui/`, `app/` and `platform/`. The score and playback modules move into `core/` and are largely kept.
  - New strings in English and Dutch, and one sample folder per instrument.
  - Deleted: `regionSelection`, `listening`, `flagReview`, the debug sample sets and the old screens.
- **`android/`:**
  - A Capacitor Android project replaces `MainActivity`, `WebAssets`, `Bridge`, `BridgeHandlers` and `ExerciseStore`, along with the crop and gallery code.
  - The Chaquopy, homr, LiteRT, ONNX Runtime and ML Kit setup moves into it.
  - The recognition job and its foreground service become the Reader plugin. The ML Kit scanner becomes the Scanner plugin.
  - The application id becomes `app.snapsody`.
- **`vendor/homr`:** reports where each staff is on the page, for the source photo in the editor.
- **`tools/samples/`:** a SoundFont-to-sample-set converter replaces the FreePats converter. The SoundFont's licence replaces FreePats in `NOTICE`.
- **Tests and contracts:**
  - `fixtures/bridge/` becomes the plugin contract.
  - The stored-format fixtures start again on the web side with the new format; the Kotlin fixture of the first version is deleted.
  - `openspec/config.yaml` rules that name the bridge or the Kotlin store fixtures get updated.
- **Docs:** `docs/testing.md`, `docs/design/deviations.md` and `docs/design/figma/frames.json`.
