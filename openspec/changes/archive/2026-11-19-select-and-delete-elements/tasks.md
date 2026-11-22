# Tasks

Layers are as in `docs/testing.md`: **quick** (`make test-quick`), **mac** (`make test-mac`) and **device** (`make test-device`, once before archive). Design references are D1–D5 in design.md. Change `edit-bar-lines` is implemented first.

## 1. Model and drawing ids (D1, D2)

- [x] 1.1 Give dynamic, tempo and words items an `id`. It is read from `<direction id>`, or made fresh when missing, and written back when saving. Verify: quick, `web/test/musicxml.test.ts`: the ids round-trip, a file without them gets unique ids, and note ids are unaffected. Add a compatibility folder under `web/test/fixtures/stores/` with a piece saved before this change. Verify: quick, `web/test/storedFormats.test.ts` loads it.
- [x] 1.2 Add the `ElementRef` type and `describeElement(score, ref)`, which gives the kind, the bar and, for a clef, the sign, or undefined when the element is gone. Verify: quick, `web/test/elements.test.ts` for each kind on the `all-elements` fixture.
- [x] 1.3 Add the `drawingIds` serializer option that writes `clef-<bar>`, `slur-<noteId>-<n>`, `tie-<noteId>` and `wedge-<startId>`, and use it in `render.ts`. Verify: quick, `web/test/render.test.ts`: the drawn SVG has `g.clef`, `g.slur`, `g.tie` and `g.hairpin` with those ids, and the stored MusicXML (without the option) has none.
- [x] 1.4 Write the SVG-to-`ElementRef` mapping (D2) as a pure function over the SVG's element tree. It covers dynamics, tempo and text by order within a bar; articulations, fermatas and breath marks per note by glyph; key, time and system-start clefs as the one in force; and bar lines as the bar they close. Verify: quick, `web/test/elements.test.ts`: on the rendered `all-elements` fixture and a bar with two dynamics, every drawn element maps to the expected `ElementRef`, and none is left unmapped.

## 2. Edits (D3, D4)

- [x] 2.1 Add `deleteElement(score, ref)` for dynamics, tempo marks, words, slurs, ties, hairpins and articulations, reusing the existing toggles and removals. It throws `EditError` for the first clef, key or time. Verify: quick, `web/test/edit.test.ts`: each kind is removed alone, undo restores it, and the bar check runs.
- [x] 2.2 Add `setClef(score, bar, clef)` and `deleteClef(score, bar)`, keeping staff positions (D3). Verify: quick, `web/test/edit.test.ts`:
  - treble to bass moves the middle line from B4 to D3, and back again;
  - explicit accidentals stay;
  - key alters are worked out again;
  - only bars up to the next clef change move;
  - the exercise-91 shape (bass clef read at bar 11) plays B4 for the middle line after the deletion, checked with `buildTimeline`.
- [x] 2.3 Add `deleteKey(score, bar)` and `deleteTime(score, bar)` (D4). Verify: quick, `web/test/edit.test.ts`: the D major and misread one-flat case from the spec, and a deleted time change makes the bar check flag the bars that no longer fit.

## 3. Selection and the element panel (D2, D5)

- [x] 3.1 Extend `EditorSession` with an element selection next to the note and bar selections, kept across edits while `describeElement` finds the element, and cleared when it is gone. Verify: quick, the `app/` editor-session tests: select an element, undo the edit that removed it, and the selection comes back.
- [x] 3.2 Hit test in `scoreView.ts`: the element directly under the finger, the smallest first, then the nearest note within reach. Highlight the selected element. Verify: mac, `web/test/ui/edit.test.ts`: tapping the *mf* under a note selects the *mf*, and tapping beside the staff near a note still selects the note.
- [x] 3.3 Build the element panel (D5) with its name, Delete and the clef select, plus the texts in `en.ts` and `nl.ts`. Tapping a bar line opens the bar-line controls from `edit-bar-lines`. Verify: mac, `web/test/ui/edit.test.ts` with a fixture that has a misread bass clef at bar 3:
  - select the clef, the panel says "Clef · bass · bar 3", Delete and save, and the stored MusicXML has no clef at bar 3 and the notes have moved up by 12 diatonic steps;
  - the first clef shows no Delete;
  - deleting a slur and undoing it brings it back.
- [x] 3.4 Check the panel and highlight against frames 06.1–06.3 in `make ui-review`, in English and Dutch at 360 × 780. Record the deviation (D5) in `docs/design/deviations.md`. Verify: manual by eye; `web/test/ui/density.test.ts` stays green.

## 4. Integration

- [x] 4.1 Run `make test-mac` and `openspec validate select-and-delete-elements --strict`. Verify: both are green.
- [x] 4.2 On a Galaxy S24, open exercise 91, delete the clef at bar 11, and play bars 10–14. Verify: manual by eye and by ear on the real phone. The notes stay in place in treble clef, and the passage sounds as in the book.

## Workflow follow-up

- Run the device smoke test (`make test-device`) on the emulator once before archive.
- Archive after `edit-bar-lines`, so both sets of requirements land in `openspec/specs/score-editing/spec.md` in order.
