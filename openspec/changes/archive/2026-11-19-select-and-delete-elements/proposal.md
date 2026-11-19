# Proposal

## Why

Recognition sometimes reads things that are not in the book. A hole punched in the page became a bass clef at bar 11 of exercise 91, and from there on the notes are drawn, and played, in the wrong clef. In the editor you can only select notes and bars, so a wrong clef, dynamic, tempo mark, slur or other mark cannot be removed. Fixing a misreading should never need a new scan.

## What Changes

- In the editor, every drawn element can be tapped to select it, not only notes and rests: clefs, key and time signature changes, dynamics, tempo marks, other text, hairpins, slurs, ties, articulations (staccato, tenuto, accent, fermata, breath mark) and bar lines.
- A selected element is highlighted, and the editor says what it is (for example "Clef · bass · bar 11"). Every element except the piece's first clef, key and time signature has a **Delete** action. Each deletion is one undo step, and the bar-length check runs again afterwards.
- **A clef can be changed or deleted, and the notes keep their place on the staff.** Their pitches are read again under the clef that applies now. This fixes a misread clef without moving a single note, which is what the user sees in the book. Deleting a clef change makes the clef before it apply again. Any clef, including the first one, can be changed between treble and bass.
- Deleting a key or time signature change makes the one before it apply again. Notes without their own accidental follow the key that now applies.
- Tapping a bar line selects its bar and opens the bar-line controls of change `edit-bar-lines`, which this change builds on.
- Not in this change: adding elements other than the ones the editor can already add (notes, rests, marks, slurs, ties, hairpins), deleting or changing tuplets (the Note tab's triplet choice already covers that), and endings.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `score-editing`: adds the requirements "Select any element", "Delete an element" and "Fix a clef", so that elements other than notes can be selected and deleted.

## Impact

- `web/src/core/score/model.ts`: dynamics, tempo marks and text items get a stable id, as notes have, so that a selection survives edits. Like note ids, they are stored as an `id` attribute, here on `<direction>`. Pieces saved without them get fresh ids when loaded (design D1).
- `web/src/core/score/edit.ts`: new edits to delete a dynamic, tempo mark or text item, delete a clef, key or time change, and set a clef while keeping note positions. It reuses the existing removal of slurs, ties, hairpins and articulations.
- `web/src/core/score/musicxml.ts`: when writing for drawing, ids go on clefs, slurs, ties and hairpins. Verovio keeps these, which was checked against Verovio in this repo on 18 Nov 2026.
- `web/src/ui/scoreView.ts`: finding what is under the finger, for every kind of element (D2), and highlighting it.
- `web/src/app/editorSession.ts` and `web/src/ui/screens/editor/`: the selection becomes "a note, a bar, or an element", with a panel for the selected element. Its texts go in `en.ts` and `nl.ts`.
- Stored piece format: still MusicXML, now with an optional `id` on `<direction>`. A compatibility folder under `web/test/fixtures/stores/` proves that older pieces still load.
- Depends on `edit-bar-lines` for the bar-line part. Implement that change first.
