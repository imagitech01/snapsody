# Tasks

Layers are as in `docs/testing.md`: **quick** (`make test-quick`), **mac** (`make test-mac`) and **device** (`make test-device`, once before archive). Design references are D1–D10 in design.md. Changes `more-marks` and `parts-and-accompaniment` are applied first. This change lands together with `parts-and-accompaniment`, before the release. The fixture `web/test/fixtures/melody-piano.musicxml` comes from that change.

## 1. Edits on any voice and chord (D3, D4, D5)

- [x] 1.1 Route every note edit through the note's voice (`noteIndex` → `voiceView`), and run the bar check on every voice of the edited bar. Verify: quick, `web/test/edit.test.ts`:
  - all existing tests stay green;
  - on the melody-piano fixture, an edit in the left hand's voice 2 changes only that voice;
  - "Parts stay apart" holds.
- [x] 1.2 Chord rules (D3): pitch and accidental on the member, length, dots, triplet and "Make rest" on the whole chord, delete on the member only, and inserting next to the whole chord in the same voice. Verify: quick, `web/test/edit.test.ts`: the scenarios "Fix one note of a chord", "Lengthen a chord", "Insert in the second voice", plus "Make rest" on a member giving one rest.
- [x] 1.3 Add `addChordNote` (a third above in the key, selected after) and `moveToOtherStaff` (D4). Verify: quick, `web/test/edit.test.ts`:
  - "Add a missed chord note" in C major and in D major (F♯ above D);
  - "A note read in the wrong hand";
  - joining a chord of the same length;
  - "Nowhere to go" throws `EditError`;
  - slurs on a moved note are removed at both ends.
- [x] 1.4 Add warnings with part, staff and voice, and their texts in `en.ts` (D5). Verify: quick, `web/test/warnings.test.ts`: "Left hand too long" names the left hand, and a one-line piece's text is unchanged.

## 2. Score-level edits (D6, D7)

- [x] 2.1 `setKey` per part. `clefAt`, `setClef` and `deleteClef` per staff, with clef ids `clef-<part>-<staff>-<bar>`. Time, tempo and bar lines stay shared. Verify: quick, `web/test/edit.test.ts` and `web/test/elements.test.ts`: "Key of the melody only", "Time signature for the whole piece", "Left hand only" (clef), and the existing clef tests through a one-line score.
- [x] 2.2 Slurs and ties within one voice, hairpins within one staff (D7). Verify: quick, `web/test/edit.test.ts`: "Slur across voices" throws `EditError`, and a hairpin on the left hand plays louder on the left hand only (`buildTimeline`).

## 3. Editor session and selection (D1, D2)

- [x] 3.1 Add `part` to `EditorSession`: it starts on your part, switching clears the selection, and an undo switches to the part it changes. Verify: quick, `web/test/editorSession.test.ts`: open on the piano part when it is your part; edit the melody, switch to the piano, undo, and the session is on the melody again with the edit undone.
- [x] 3.2 Confirm that Verovio keeps the note id of every chord member, then hit test to the single chord member and build the label from the derived place (D2). Verify: quick, `web/test/elements.test.ts` on the rendered fixture: each chord member resolves to its own id. Then `web/test/editorSession.test.ts` for the labels "Bar 5 · Left hand · Chord, note 2 of 3", "Bar 7 · Right hand · Voice 2" and the one-line "Bar 2 · Note 3".
- [x] 3.3 One line while editing shows the whole system of the part: both staves of a piano line. Verify: quick, `web/test/lines.test.ts`: on the piano part, the line of a left-hand note holds both staves.

## 4. Editor screen

- [x] 4.1 The part switch above the score (only with several parts), and drawing the edited part only, with multi-measure rests expanded. Verify: mac, `web/test/ui/edit.test.ts`: on a melody-piano piece, switch to *Piano*, select a left-hand chord note, step it up, save; the stored MusicXML has the change in P2 and P1 unchanged.
- [x] 4.2 The new Note-tab tools *+ Chord note* and *To other hand* (the latter only in two-staff parts), and the Score tab's "Key of {part}". Texts in `en.ts`. Verify: mac, `web/test/ui/edit.test.ts`: "+ Chord note" adds and selects the new note; *To other hand* is absent in a one-line piece; a refused move shows its explanation.
- [x] 4.3 Preview a bar as practice plays it (D8). Verify: quick, `web/test/editorSession.test.ts`: the preview's timeline for bar 3 holds both parts' notes when both play in practice, and leaves out your line when it is off.

## 5. Add and remove a bar line (D9, D10)

- [x] 5.1 Add `splitBar` and `joinBars` in `edit.ts` (D9), with `from` on each bar. Verify: quick, `web/test/edit.test.ts`:
  - "A missed bar line" and "An extra bar line" on a one-line score, with the printed numbers after them renumbered;
  - on the melody-piano fixture, the piano's whole-bar rest is split, and two are joined into one;
  - a rest that crosses the point is split into standard lengths; a note or a triplet across it throws `EditError` naming the staff;
  - the end-repeat moves to the second bar; the joined bar keeps the first start and the second end;
  - joining refuses after the last bar, before a clef, key or time change, and before an ending;
  - undo and redo of each restore the bars and their `from`.
- [x] 5.2 Build the bar map from `from` at save, and let `writeScore` take it (D10): the piece's bars, the page and staff-box ranges, and `practice.json` in one commit. Verify: quick, `web/test/library.test.ts`: the loop scenarios "A loop after the change" and "A loop around the change"; the ranges still pass the page check; a save without the map leaves `piece.json` as today. Plus `web/test/editorSession.test.ts`: a split followed by undo saves no map.
- [x] 5.3 Put "Bar line before" on the Note tab (not offered for the first item of a voice) and "Remove bar line" in the Marks tab's *Bar N* group (not offered at the end of a staff box, a page or the piece), with the refusal texts in `en.ts`. Check that the practice session has written `practice.json` before the editor opens over it. Verify: mac, `web/test/ui/edit.test.ts`: tap a bar line, remove it, save, and the stored score has one bar fewer and `piece.json` one bar fewer; add a bar line, Save & practice, and the practice screen shows the loop over the same music; a refused split shows its explanation.

## 6. Integration

- [x] 6.1 Run `make test-mac` and `openspec validate edit-parts --strict`. Verify: both are green.
- [ ] 6.2 Check the editor by eye in browser-dev at 360 × 780, in English, on the melody-piano fixture: the part switch, a piano line with both staves, the label, the new tools, the bar-line tools and the Score tab. Verify: manual by eye; `web/test/ui/density.test.ts` stays green.
- [ ] 6.3 On the S24, open a piece read from one of the piano photos of `parts-and-accompaniment` task 1.1, and fix a chord note, a note in the wrong hand, a left-hand clef and a missed or extra bar line. Then play it in practice. Verify: manual by eye and by ear on the real phone: a single chord note can be tapped, and the fixes are heard.

## Workflow follow-up

- Run the device smoke test (`make test-device`) on the emulator once before archive. One run can cover this change and `parts-and-accompaniment` when they land together.
- Archive after `parts-and-accompaniment`, so this change's `score-editing` delta applies on top of the ones before it.
