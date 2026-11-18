# Open verifications

These tasks are implemented, or partly implemented, but stay unticked in `tasks.md`. Each
needs either a check by a person on the phone or a screen that a later task builds.

## Group 5: recognition job

### 5.2 Cancel: done
**Done and verified at job level** (`RecognitionTest.cancelDuringSegmentationStopsTheJob`, S24):
- Pressing Cancel during GPU segmentation stops the job within about 60 ms.
- The job's cache folder is removed.
- No `exercises/` folder exists.
- The cancel is not stored as a GPU failure.

**Return to region selection: verified** (`RegionSelectionTest`, S24). Cancelling the
recognition returns to region selection with the same box.

**No exercise created: verified** (group 8, S24).
- `RegionSelectionTest` cancels mid-run and finds the exercises folder unchanged.
- `RecognitionTest` asserts that no exercise folder appears.

5.2 is complete.

### 5.3 "No music found": note
The task is ticked: a self-made image of plain text shows "No music found" with "Adjust
selection" and "Retake photo". Since group 6, "Adjust selection" returns to region selection
with the same page and "Retake photo" opens the scanner again.

### 5.4 Airplane mode: done
The user ran recognition on the S24 in airplane mode on 2026-11-17, from the debug
test-image entry, because capture does not exist yet. Both runs completed (logcat 22:01).
The full offline run, from photo to playback, is task 14.1.

## Group 6: capture (done, 2026-11-17, S24)

- **6.1, camera:** the user photographed exercise 87 through the scanner and got a straightened
  page (2697 × 1590).
  - Selecting exercise 87 gave a crop with only that exercise, and 19 bars were recognised
    (this is also the 6.4 check).
- **6.1, gallery inside the scanner:** a photo of another page (exercises 82–84) came back
  straightened (3811 × 2585). The crop of exercise 82 gave 12 bars.
- **6.2:** the merged debug and release manifests have no `INTERNET`, and the scanner opens.
- **6.3:** the app holds no camera permission (the scanner uses Google Play services'), so the
  task now covers a scanner that cannot run.
  - `CaptureFallbackTest`: after an injected failure the app explains it and opens the
    system photo picker.
  - With `-e manual true`, the user picked a photo (4000 × 3000) and it reached region
    selection.
- **Still open, for 14.1:** whether the scanner works in airplane mode. Google Play services
  delivers it, so it may need to have been opened once with a connection.

## Group 9: score rendering (done, 2026-11-17, S24)

`ScoreRenderTest` passes on the S24:
- **Rendering:** exercise 87 renders as one page, 328 px wide. It shows 127 notes, none
  unmapped, the clef, key, 3/4, 36 triplets with their "3", slurs and staccato.
- **Speed:** the first render takes 460 ms, including loading Verovio; a re-render takes
  about 50 ms.
- **Taps:** tapping each of the 7 notes of bar 1 gives the matching model note (id, bar,
  pitch).

The screenshot looks right: clef, G major, 3/4, *mf*, triplet brackets, staccato dots.

**Open, cosmetic:**
- ~~Eighth notes are flagged, not beamed~~: fixed on 2026-11-18, at the user's request (task
  9.3). Beams are computed by beat when the score is drawn (`web/src/score/beams.ts`). On the S24,
  exercise 87 shows 36 beamed triplet groups, and `ScoreRenderTest` and `EditingTest` still pass.
- The slurs look shorter than printed, because homr places some slur ends where no slur
  started.

## Group 10: playback engine

Unit tests cover 10.1–10.3 and 10.5 (74 web tests pass). On the S24:
- Play starts a Web Audio player (`dumpsys audio`).
- After about 4 s the cursor highlight is at the end of bar 2.

**10.4: done (2026-11-18).** The user checked on the S24 that the highlight keeps step with the
heard notes and scrolls between lines: "yeah, pretty good".

## Group 12: practice controls

12.1, 12.3, 12.4 and 12.6 are done: unit tests, plus `PracticeControlsTest` on the S24.
- 12.1: pause in bar 5 resumes at the paused note.
- 12.3: the tempo is restored after reopening and after an activity restart.
- 12.4: the count-in shows 1-2-3 with 3 clicks.
- 12.6: tapping bar 9 while stopped, and bar 3 while playing, works.

**By ear (person):**
- **12.2: done (2026-11-18).** The user heard the same pitch at 50 and 96 bpm on the S24. A tempo
  change in bar 6 continuing from bar 6 was already checked on the device.
- **12.5: done (2026-11-18).** The user listened to the loop on the S24: "there is no gap in the
  loop". The scheduling is exact in the unit tests.
- **Count-in click:** judge its sound. It is a 1760 Hz accent and 1175 Hz other beats,
  `CLICK` in `web/src/playback/webaudio.ts`.

## User test, 2026-11-17 (build 87ddd9e)

The user tried the app on the S24: "stuff works great".
- **Small crackle in the audio** with the synthesised placeholder samples. Check again with the
  FreePats tenor-sax set (11.4). If it remains, look at the loop seams and the crossfade or
  release ramps in `web/src/playback/webaudio.ts` (`PLAYBACK_TUNING`).

## Group 13: editing (done, 2026-11-18, S24)

- 13.3 and 13.4 are ticked on unit tests:
  - A key change to one sharp makes un-marked Fs sound F♯; playback takes pitch from the same
    sounding alteration.
  - "Moderato" gives a default of 108.
  - Lengthening a quarter to a half flags a full 3/4 bar, and editing continues.
- `EditingTest` passes on the S24, with real taps:
  - **13.1:** two injected flags are marked, and Next/Previous move through them.
  - **13.2:** the first note of bar 5, stepped to C5 and then down once, is B4 in
    `current.musicxml`, drawn on the middle line, and the panel reads "Bar 5: B4"
    (`screenshots/editing_b4.png`).
  - **13.5:** after the edit, `current.musicxml` differs and `recognised.musicxml` is
    byte-identical; undoing a delete restores the note.
- `PracticeControlsTest` and `ScoreRenderTest` still pass.
- **Edit panel layout, changed after the first phone run:** the panel was 440 of 780 px, so the
  score had less than half the screen and the test's tap landed on the panel. The tools are now
  in five tabs (Pitch, Length, Marks, Insert, Score), and only one group shows at a time. The
  panel is now 229 px (29%).
- **Decisions, confirmed by the user on 2026-11-18:** key and time edits apply at bar 1, and
  later changes are kept. Edits save immediately, and Done returns to practice.
- **Delete leaves a short, flagged bar.** The user did not see the flag. It was set (bar notes
  turn amber, "To check" lists it), but that list is off-screen while editing. The edit panel
  now shows the flag of the selected note's bar, and beats read as "2⅔", not "8/3".

## 11.4 Bundled sound (done, 2026-11-18)
The mf layer is bundled. On the S24 the user judged that slurred notes connect, staccato notes are
clearly short, and the sax has no crackle (the crackle was only in the synth placeholder). No
change to `PLAYBACK_TUNING` was needed.

## 11.3 Listening page (done, 2026-11-18): the user chose the mf layer

**Phone steps:**
1. Install a debug build; it contains both FreePats candidates.
2. Make sure exercise 87 is in the library.
3. Library → "Developer (debug build)" → "Listening page (sample sets)".
4. Tap "Check that every file decodes". Expect "all 33 files decode" for each set.
   `ListeningTest` already passed on the S24 on 2026-11-18, with both FreePats sets packaged:
   Ogg/Opus decodes in the WebView, 33 samples per set.
5. For each set, listen to "Play at 96" and "Play at 50". Tap "Choose this sound" on the
   winner, then tell me the choice so it can be recorded in `docs/samples.md`.
6. ~~Run `app.instrumentassist.ListeningTest`~~ (passed, 2026-11-18).

**Crackle:**
- Three causes that could click were fixed: a release during a fade-in jumped to full gain, a
  zero-length release, and a stop before a note started.
- The placeholder loop seams measure clean.
- If the crackle remains, compare the latency hint `interactive` with `playback` on the
  listening page; it may be an audio underrun on the device.
- Seam notes to check by ear: mf 44, 50, 58, 65, 74; f 44, 64.

**Size:** the release APK is 239 MB, against the design's estimate of about 150 MB. The models
(about 157 MB, stored uncompressed for memory mapping) are most of it. Worth a look before any
store release; the design already lists int8 segnet and downloading the models on first
launch as options.
