# Tasks

Layers are as in `docs/testing.md`: **quick** (`make test-quick`), **mac** (`make test-mac`) and **device** (`make test-device`, once before archive). Design references are D1–D4 in design.md.

## 1. Bar-line edits in the core (D1)

- [x] 1.1 Add `barLinesOf(score, index)` to `web/src/core/score/edit.ts`. It returns the bar's start (`normal` | `repeat`), its end (`normal` | `double` | `repeat`) and its pass count (2 when there is no `times`). It reads a double bar line written on either side of the boundary. Verify: quick, `web/test/edit.test.ts`: a `light-light` right bar line, a `light-light` left bar line on the next bar, a recognised `light-heavy` without a repeat, a start-repeat, and an end-repeat with `times="3"` each read as expected.
- [x] 1.2 Add `setBarStart(score, index, start)`, `setBarEnd(score, index, end)` and `setRepeatTimes(score, index, times)`, writing as in the D1 table. The boundary is normalized to the right bar line of the bar before it, endings are kept, `times` is written only when it is not 2, and these throw `EditError` for an index out of range, for times outside 2–8, or for times on a bar that does not end in a repeat. Verify: quick, `web/test/edit.test.ts`:
  - each value round-trips through `serializeMusicXml`/`parseMusicXml`;
  - setting the end to normal also removes a double bar line on the next bar's left;
  - a bar line with an ending keeps the ending after each edit;
  - undo and redo in `EditSession` restore the previous bar lines.
- [x] 1.3 Pin down the playback that follows the edits. Verify: quick, `web/test/timeline.test.ts`:
  - the exercise-82 shape with `setBarStart(…, 2, 'repeat')` plays 1, 1, 2, 3, 3, 4;
  - a missing end-repeat added with `setBarEnd` plays 1, 2, 1, 2, 3;
  - `setRepeatTimes(…, 3)` plays the section three times;
  - an end set back to normal plays straight through;
  - a first and second ending still play correctly after `setRepeatTimes` on the first ending's bar.

## 2. Editor session (D1)

- [x] 2.1 Expose the selected bar's bar lines from `EditorSession` (a computed signal from `barLinesOf`, undefined when no bar is selected), so the controls show the current values after every edit, undo and redo. Verify: quick, the `app/` editor-session tests: selecting a bar without a note gives its bar lines, and an edit and its undo update them.

## 3. Controls in the Marks tab (D2, D4)

- [x] 3.1 Add the "Bar N" group under the note marks in `web/src/ui/screens/editor/MarksTab.tsx`. It has a start `SelectField`, an end `SelectField`, and a compact `Stepper` for the passes that shows only for an end-repeat, with hold-to-repeat as one undo step through `amend`. It is disabled with no bar selected. Add the texts to `web/src/app/i18n/en.ts` and `nl.ts`. Verify: mac, `web/test/ui/edit.test.ts`: select bar 3 of a fixture, set the start to start-repeat and save, and the stored MusicXML has `<repeat direction="forward"/>` on bar 3. Set an end to end-repeat, raise it to 3×, and undo once back to 2×. With no bar selected, the group is disabled.
- [x] 3.2 Check the new group against frame 06.2 in `make ui-review`, in English and Dutch at 360 × 780, and record the deviation (D2: a bar-line group added under the note marks) in `docs/design/deviations.md` under 06.2. Verify: manual by eye in `make ui-review`. Also `web/test/ui/density.test.ts` stays green: no sideways scroll and no touch box under 44 × 44.
- [x] 3.3 Check by eye that a start-repeat added mid-line and at the start of a system, a double bar line, and an end-repeat are drawn correctly by Verovio after an edit, and note whether a count other than 2 is drawn (design Open Questions). Verify: manual by eye in `make ui-review` or `npm run dev`; the result goes in design.md Open Questions.

## 4. Spec and integration

- [x] 4.1 Run `make test-mac` and `openspec validate edit-bar-lines --strict`. Verify: both are green.
- [x] 4.2 By ear on a Mac: play exercise 82 after adding `||:` to bar 3, and hear bar 3 repeat, not the half G. Verify: manual by ear in `npm run dev` with the exercise's MusicXML.

## Workflow follow-up

- Run the device smoke test (`make test-device`) on the emulator once before archive.
- Archive the change after review, so the "Edit bar lines" requirement is synced into `openspec/specs/score-editing/spec.md`.
