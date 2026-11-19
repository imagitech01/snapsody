# Tasks

Layers are as in `docs/testing.md`: **quick** (`make test-quick`) and **mac** (`make test-mac`). The device smoke test runs once before archive. Design references are D1–D6 in design.md.

## 1. Session and route (D3, D4, D5)

- [x] 1.1 Add `isNew?: true` to the editor `Screen` in `app/router.ts`, and remove `'pages'` and `'goto'` from `SheetName`. Verify: quick, `npm run typecheck` (or the `make test-quick` type step) is green, and `web/test/router.test.ts` still passes.
- [x] 1.2 Add an `isNew` option to `openEditor` and a `naming` signal on `EditorSession`. `naming` is true for a new piece and turns false on `setTitle`, on a successful save, and on close. `EditorScreen` passes `screen.isNew`. Verify: quick, `web/test/editorSession.test.ts`:
  - a new piece starts `naming` and an existing one does not;
  - typing a title ends it;
  - a save ends it;
  - an untouched date name saves unchanged;
  - an empty title is still refused.
- [x] 1.3 Remove `photo`, `photos()`, `photoUrl()`, `PagePhoto` and `PhotoView` from `EditorSession`, and delete `photoRegion.ts` and its test. Verify: quick, `web/test/editorSession.test.ts` drops the photo assertions, and `make test-quick` is green with no reference left (`grep -r photoUrl web/src` is empty).

## 2. One line in the score island (D1, D2)

- [x] 2.1 Add `linesOf`, a pure function over the drawn SVG's element tree, that gives `{ firstBar, lastBar }` per `g.system`. Add `ScoreView.lineElement(barIndex)`. Verify: quick, `web/test/render.test.ts` or a new `web/test/lines.test.ts`: on the rendered practice-exercise fixture at 360px, every bar is in exactly one line, the lines run in order, and their count matches the systems drawn.
- [x] 2.2 Give `mountScoreIsland` an optional `line` signal. When it is set, the island takes the height of that bar's system plus the bar padding, scrolls to it, and does not scroll under user input. It measures again after each re-layout. When it is null, the island behaves as today. Verify: mac, `web/test/ui/edit.test.ts` (the line test in 3.2): the island's height equals the selected line's height, and only that line's bars intersect the visible area. `web/test/ui/practice.test.ts` stays green, because practice never sets `line`.

## 3. The editor screen (D2, D3, D5, D6)

- [x] 3.1 Remove the pill row, `EditorSheets.tsx` and `PhotoStrip.tsx`, and their texts in `en.ts` and `nl.ts` (`editor.pages*`, `editor.goToBar`, `tools.goToBar*`, `editor.photo*`). Move "Preview bar N" / "Stop preview" into the tools head, before Undo and Redo, off while nothing is selected. Verify: mac, `web/test/ui/edit.test.ts`:
  - the frame test (line 131) no longer looks for the pills or the photo, and finds "Preview bar 3" in the tools head, which plays that bar;
  - the photo-strip test (line 185) and the sheets test (line 230) are deleted;
  - `web/test/i18n.test.ts` (key parity) stays green.
- [x] 3.2 Pass `line` to the island from the selection, with the line strip under the score: the arrows, "Line 2 of 6 · Bars 4–7" and "Full score". Full score is screen state that keeps the selection. Any selecting tap ends it, and with nothing selected the full score shows. Add the texts in `en.ts` and `nl.ts`. Verify: mac, a new test in `web/test/ui/edit.test.ts` that goes through the four scenarios of `score-editing` "One line while editing":
  - full sheet, then tap a note in bar 5 and see its line;
  - the next-line arrow selects the next line's first bar;
  - Full score keeps the selection, and a tap goes back to one line;
  - Next on a warning lands on the line of the warned bar.
  It also checks that a slur can be picked from a note on one line to a note on the next, using the arrow between the two taps.
- [x] 3.3 Move Add pages to the foot of the Score tab, with its caption, keeping today's handler. Verify: mac, `web/test/ui/edit.test.ts`: the add-pages test (line 696) opens it from the Score tab, asks to save the edits first, and comes back to the editor on the longer score.
- [x] 3.4 Show the naming state: the tinted title field, the caption "Name this piece" (in `en.ts` and `nl.ts`), select-all on first focus, and no autofocus. Verify: mac, a new test in `web/test/ui/edit.test.ts` that opens a seeded piece with `isNew` through the test router:
  - the caption shows and the field is not focused;
  - a tap on the title and typing "Ode to Joy" replaces the date name, and Save & practice stores it;
  - in a second run, a tap on a note first leaves the title highlighted;
  - an editor opened from practice shows no caption.
- [x] 3.5 Check by eye in browser-dev (`npm run dev`) at 360 × 780, in English and Dutch (D6): the full sheet, the one-line state, the line strip, Preview in the tools head, the Score tab with Add pages, and the naming state. Verify: manual by eye. `web/test/ui/density.test.ts` stays green.

## 4. Adding a piece ends in the editor (D4)

- [x] 4.1 In `AddMusicScreen.handOver`, replace with `{ name: 'editor', pieceId, isNew: true }` for a new piece. Added pages keep the `pop`. Verify: mac, `web/test/ui/addMusic.test.ts`:
  - the main journey (line 82) ends with the stack `[home, editor]`, showing "Name this piece";
  - Back goes to home;
  - Save & practice gives `[home, practice]`;
  - the add-pages journey (line 287) still returns to the editor;
  - the Dutch journey (line 315) passes.
- [x] 4.2 Check by eye in browser-dev at 360 × 780 that adding a piece ends on the editor in its naming state (D6). Verify: manual by eye.

## 5. Integration

- [x] 5.1 Run `make test-mac` and `openspec validate simplify-editor-and-name-new-pieces --strict`. Verify: both are green.

## Workflow follow-up

- Run the device smoke test (`make test-device`) on the emulator once before archive.
- When archiving, update the Purpose line of `openspec/specs/score-editing/spec.md`, which still mentions "the original photo beside the selected bar".
