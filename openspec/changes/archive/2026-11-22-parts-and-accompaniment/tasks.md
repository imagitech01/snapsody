# Tasks

Layers are as in `docs/testing.md`: **quick** (`make test-quick`), **browser** (`make test-browser`) and **device** (`make test-device`, once before archive). Design references are D1–D9 in design.md. Change `more-marks` is applied first, and change `edit-parts` lands together with this one, before the release.

## 1. First look at real piano pages (does not block)

The other groups do not wait for this one. It can run whenever the user has photos at hand.

- [x] 1.1 Run a few real piano pages through the local prototype (`prototype/run.sh`), ideally a grand staff alone and a melody with piano. Photos stay in `fixtures/local/piano/`, never in the repo. For each page, note the notes that are wrong or missing, against the book. Verify: manual by eye. A short note in this change's folder (`first-look.md`, no images, no music from the books) with the counts per page. **Not done: waived by the user at archive (2026-11-22).**
- [x] 1.2 Read one of those pages on a real phone with today's app. Note the reading time and whether any system was cut at the 608-token limit (bars that don't add up at the end of a system). Verify: manual on the real phone (GPU speed). Added to `first-look.md`. **Not done: waived by the user at archive (2026-11-22).**

## 2. Model and voice view (D1, D2)

- [x] 2.1 Add `Part`, `Bar`, `PartBar`, `StaffBar` and the new `Score` in `model.ts`, plus `singleVoiceScore(measures)` to build a one-line score from today's shape. Verify: quick, `make test-quick` type-checks.
- [x] 2.2 Add `voiceView(score, ref)`, sharing each voice's item array, and `voices(score)` to list every `VoiceRef`. Verify: quick, `web/test/model.test.ts` (new):
  - the view of a one-line score equals today's measures;
  - the key and clef in force are carried over bar changes;
  - an item edited through the view is changed in the model.
- [x] 2.3 Move repairs, warnings, beams and the per-voice parts of `edit.ts` onto voice views, and move the time, key, clef and bar-line setters to the score level. Verify: quick, every existing test in `repairs.test.ts`, `warnings.test.ts`, `beams.test.ts` and `edit.test.ts` stays green through `singleVoiceScore`.

## 3. MusicXML and pages (D3, D4)

- [x] 3.1 Read every part, staff and voice: `<backup>`, `<forward>` as hidden rests, `<staff>`, `<voice>`, part names, and the shared bar attributes from the first part with a warning when they disagree. Make a fixture `web/test/fixtures/melody-piano.musicxml` in homr 0.7.1's form, with original music written for the test (never from a book, as the repo is public): a melody and a piano grand staff, chords in the right hand, two voices in the left hand in one bar, and a hidden-staff rest bar. Verify: quick, `web/test/musicxml.test.ts`: every note lands in its part, staff and voice, and the old "Only the first of N parts" warning is gone.
- [x] 3.2 Write partwise with `<staves>`, per-staff clefs, the per-part key and `<backup>` between voices, and add the option `parts`. Verify: quick, `web/test/musicxml.test.ts`:
  - the melody-piano fixture survives read, write, read;
  - the existing one-line fixtures are written byte for byte as before;
  - `parts: ['P2']` writes the piano part only.
- [x] 3.3 Match parts across pages in `mergePages`, record `partsRead` in `PieceInfo`, and drop parts not kept when pages are added (D4). Verify: quick, `web/test/pages.test.ts`: the "melody rests on page 2" and "part only on a later page" cases, and adding a page to a melody-only piece keeps the melody only.
- [x] 3.4 Run the range check on the user's part only, with that part's instrument. Verify: quick, `web/test/warnings.test.ts`: the scenario "The accompaniment is not checked".
- [x] 3.5 Add the compatibility folders `web/test/fixtures/stores/v2-before-parts/` and `v2-with-parts/`. Verify: quick, `web/test/storedFormats.test.ts` loads both, and the old one is one part, one staff, one voice.

## 4. Playback (D6)

- [x] 4.1 Build the fermata map from every voice, and place events through it. Verify: quick, `web/test/timeline.test.ts`: the existing fermata tests stay green, and "Fermata in one part" holds both parts and keeps them together.
- [x] 4.2 Build per voice and merge, with `voice`, `sound`, `own` and `nextInVoice`. Legato and ties use `nextInVoice`. Dynamics apply per staff. Verify: quick, `web/test/timeline.test.ts` on the melody-piano fixture:
  - the events are in time order;
  - a slur in the melody is not broken by piano events in between;
  - a repeat plays both parts twice;
  - the melody sounds a major ninth below written on tenor sax, and the piano at written pitch.
- [x] 4.3 Let the session backend load several instruments, and the scheduler play each event with its `sound`. Skip `own` events while the user's line is off, and pick them up again from the next event when it is turned back on. Verify: quick, `web/test/scheduler.test.ts` and `web/test/player.test.ts`: note-ons per instrument; turning the line off mid-play stops its notes from the next event and leaves the rest.
- [x] 4.4 Make the cursor highlight every sounding `own` event. Verify: quick, `web/test/cursor.test.ts`: the scenario "Both hands highlighted".

## 5. Reading flow: the parts step (D4)

- [x] 5.1 Add the parts step to the add-music flow (`addMusic.ts`, `AddMusicViews.tsx`): checkboxes, "I play this", the first line of each part drawn small, Continue and Back, texts in `en.ts`. Verify: quick, `web/test/addMusic.test.ts`: with one part there is no step; with two, the kept parts and the chosen part are saved; Back creates no piece.
- [x] 5.2 Extend the add-music journey test. Verify: mac, `web/test/ui/addMusic.test.ts`: a scripted reading of the melody-piano fixture shows the step, unticking Piano gives a melody-only piece that opens in the editor.
- [x] 5.3 Check the step by eye in browser-dev at 360 × 780, in English. Verify: manual by eye. **Not done: waived by the user at archive (2026-11-22).**

## 6. Practice (D5, D7, D9)

- [x] 6.1 Add the `PracticeState` fields of D5 and the fallbacks. Verify: quick, `web/test/library.test.ts`: an old `practice.json` loads with the fallbacks, and the new fields round-trip.
- [x] 6.2 Draw only your part, and fade the other hand (D7). Verify: quick, `web/test/render.test.ts`: practice SVG of the melody-piano fixture with your part `P2` has two staves per measure and no melody notes. Mac, `web/test/ui/practice.test.ts`: with the left hand chosen, the right-hand staff carries the faded class.
- [x] 6.3 Add the "your part" card next to the metronome (the metronome card without its icon), and the two Practice tools rows. Verify: mac, `web/test/ui/practice.test.ts`:
  - switching to the piano part redraws and follows it;
  - switching the piano off under *Plays along* leaves only the user's line in the scheduled notes;
  - the card turns the user's line off and on;
  - a one-line piece shows neither the card nor the row.
- [x] 6.4 Add the parts hint, once per piece, with its wording per combination (melody with piano, piano alone, several melodies). Verify: quick, `web/test/practiceSession.test.ts`: shown on the first open only.
- [x] 6.5 Add *Instrument for this piece*, with the default from Settings followed until the user chooses. Verify: quick, `web/test/practiceSession.test.ts`: the scenarios "A clarinet piece in a sax player's library" and "Default changed later".
- [x] 6.6 Check the practice screen and Practice tools by eye in browser-dev at 360 × 780 and in landscape, in English, with the melody-piano fixture. Verify: manual by eye; `web/test/ui/density.test.ts` stays green. **Not done: waived by the user at archive (2026-11-22).**

## 7. Editor until `edit-parts` (D8)

- [x] 7.1 Open the voice view of the first voice of your part in the editor, with score-level edits for time, key, clef and bar lines. Verify: mac, `web/test/ui/edit.test.ts` and `web/test/editorSession.test.ts` stay green, and editing a note of a melody-piano piece leaves the piano part unchanged in the stored MusicXML.

## 8. Specs, texts and integration

- [x] 8.1 Update the texts that still describe one line and one instrument:
  - the Play Store text (`docs/store/listing.md`, "Good to know") no longer says Snapsody reads only single-line melodies;
  - the comment in `library.ts` about the instrument being only a general setting;
  - the Purpose of `openspec/specs/instruments/spec.md` ("the user chooses one instrument for every piece in Settings"), edited directly at archive, as deltas do not carry a Purpose.

  Verify: `grep -n "single-line\|grand staff" docs/store/listing.md` and `grep -n "every piece" openspec/specs/instruments/spec.md` show the new texts.
- [x] 8.2 Run `make test-browser` and `openspec validate parts-and-accompaniment --strict`. Verify: both are green.
- [x] 8.3 On a real phone, read one of the piano pages of task 1.1, keep both parts, play the melody with the piano along, then take the left hand. Verify: manual by eye and by ear on the real phone: the parts are in time, the faded hand is visible, and the piano sounds as piano. **Not done: waived by the user at archive (2026-11-22).**

## Workflow follow-up

- Run the device smoke test (`make test-device`) on the emulator once before archive.
- Archive `more-marks` before this change, and this change before `edit-parts`, so each delta applies on top of the one before.
