# Tasks

Layers are as in `docs/testing.md`: **quick** (`make test-quick`), **browser** (`make test-browser`) and **device** (`make test-device`, once before archive). Design references are D1–D5 in design.md. This change comes first of the three: `parts-and-accompaniment` and `edit-parts` build on it.

## 1. Model and reading (D1, D2)

- [x] 1.1 Add the fields of D1 to `Note` and `Measure` in `model.ts`, all optional. Verify: quick, `make test-quick` stays green (a type check plus the existing tests).
- [x] 1.2 Read the new marks in `musicxml.ts`:
  - `strong-accent`, `staccatissimo`, `caesura`;
  - `mordent` under articulations or ornaments, `turn` and `inverted-turn` as `turn`, `trill-mark`;
  - `tremolo` with the pairing rule of D2, `arpeggiate` on any chord note;
  - `<multiple-rest>` as `multiRest` on the first bar;
  - `doit` dropped with a warning.

  Add a fixture `web/test/fixtures/homr-marks.musicxml` written the way homr 0.7.1 writes these marks (from `build_articulations`). Verify: quick, `web/test/musicxml.test.ts`: every mark lands on the right note, two tremolos on non-adjacent notes are both `single`, and the doit warning is given.
- [x] 1.3 Write the marks back as valid MusicXML (D2), with the serializer option `multiRests: 'collapse' | 'expand'`. A run is collapsed only while it is still plain whole-bar rests. Verify: quick, `web/test/musicxml.test.ts`: read, write and read again keeps every mark; the written mordent sits under `<ornaments>`; a run with a note in it is written without `<multiple-rest>`.
- [x] 1.4 Add the compatibility folder `web/test/fixtures/stores/v2-before-more-marks/` with a piece saved before this change. Verify: quick, `web/test/storedFormats.test.ts` loads it unchanged.

## 2. Drawing (D2, D5)

- [x] 2.1 Draw with `collapse` in practice and `expand` in the editor (`render.ts` callers). Verify: quick, `web/test/render.test.ts` on the fixture of 1.2:
  - practice has one `g.multiRest`, the editor one `g.measure` per bar;
  - `g.mordent`, `g.turn`, `g.trill`, `g.arpeg`, `g.caesura`, `g.bTrem`, `g.fTrem` and the strong-accent and staccatissimo `g.artic` are all present.
- [x] 2.2 Map a collapsed run's rests to its `g.multiRest` in `noteMap.ts`, and add the table from bar index to drawn measure (D5). Route every bar lookup through it: `scoreView.ts` (`measureNodes[barIndex]`, the line of a bar), `lines.ts`, `cursor.ts`, loop bounds and tap-to-start. Verify: quick, `web/test/cursor.test.ts` and `web/test/lines.test.ts`: the cursor stays on the symbol for all n bars, the next note after it is highlighted on time, and the line of the bar after the run is the right line. Mac, `web/test/ui/practice.test.ts`: a loop that starts after the run starts on the right bar.

## 3. Playback (D3)

- [x] 3.1 Add `sounds` to `PlaybackEvent` and let the scheduler play them when present. Events without `sounds` are unchanged. Verify: quick, `web/test/scheduler.test.ts`: an event with three sounds gives three note-ons at the right beats, and existing tests stay green.
- [x] 3.2 Build the sounds in `timeline.ts` for trill, turn, mordent, single and two-note tremolo, arpeggio and grace notes, with the constants of D3. Verify: quick, `web/test/timeline.test.ts` for each scenario of "Ornaments in playback", "Grace notes in playback" and "Chord marks in playback":
  - A4 trill in G major alternates A4/B4, E5 alternates E5/F♯5;
  - the turn on D5 is E5, D5, C5, then D5 held;
  - the mordent on G4 is G4, F4, then G4 held;
  - the grace D5 ends exactly on beat 2, and a grace note on the first note of the piece sounds before it with the count-in off;
  - the arpeggio's lowest note is on the beat;
  - the next written note starts on its beat in every case.
- [x] 3.3 Strong accent, staccatissimo, caesura, and a fermata on any chord note. Verify: quick, `web/test/timeline.test.ts`:
  - the strong accent's `attackGain` is above an accent's at the same dynamic;
  - staccatissimo `sounding` is shorter than staccato;
  - the caesura leaves a gap and the next note is on its beat;
  - the chord with a fermata on its top note lasts two beats.

## 4. Editing (D4)

- [x] 4.1 Map the new SVG groups to `ElementRef` in `elements.ts` (D4). First check which of them keep a written id in this repo's Verovio, and use the id where it is kept and the order within the bar where it is not. Verify: quick, `web/test/elements.test.ts` on the rendered fixture of 1.2: every new mark maps to the right note, and none is left unmapped.
- [x] 4.2 Add the toggles to `edit.ts`:
  - strong accent, staccatissimo, trill, turn and mordent (each replacing the others), single tremolo, and arpeggio (chords only, else `EditError`);
  - `deleteElement` for every new mark, a two-note tremolo from both notes.

  An edit that puts anything into a multi-measure rest's bars clears `multiRest`. Verify: quick, `web/test/edit.test.ts`: each toggle and delete, undo of each, and the multi-measure rest scenario of "Multi-measure rests while editing".
- [x] 4.3 Add the chips to `MarksTab.tsx`, with their texts in `en.ts`. Verify: mac, `web/test/ui/edit.test.ts`:
  - select a note, tap Trill, save, and the stored MusicXML has `<trill-mark/>` on it;
  - tap the trill on the score, Delete, and it is gone;
  - Arpeggio is disabled on a single note.
- [ ] 4.4 Check the Marks tab by eye in browser-dev (`npm run dev`) at 360 × 780, in English: the extra chips fit without scrolling past the tools, and the new marks are highlighted when selected. Verify: manual by eye; `web/test/ui/density.test.ts` stays green.

## 5. Integration

- [x] 5.1 Run `make test-browser` and `openspec validate more-marks --strict`. Verify: both are green.
- [ ] 5.2 Tune the constants of D3 by ear: play the fixture of 1.2 at 60 and 120 bpm with the tenor sax and the piano, in browser-dev and on a real phone. Verify: manual by ear, on the real phone: trills, turns and grace notes sound like practice-tempo ornaments and never push the beat.

## Workflow follow-up

- Run the device smoke test (`make test-device`) on the emulator once before archive.
