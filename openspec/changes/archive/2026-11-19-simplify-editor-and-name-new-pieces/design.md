# Design

## Context

See proposal.md for why. The shape came out of an interactive mock of the editor (an artifact built from this repo's CSS, strings and a real Verovio engraving). The user tried it and commented on it. Today:

- The editor (`ui/screens/editor/Editor.tsx`) stacks, from the top:
  - the title field;
  - a score card with three pills (Pages, Go to bar, + Add pages);
  - the warnings;
  - the score island, 11rem high, scrolling the whole sheet;
  - `PhotoStrip` with "Preview bar N";
  - the tools.
- The Pages and Go to bar pills open the router sheets `'pages'` and `'goto'` (`EditorSheets.tsx`). Nothing else uses those sheets or their texts.
- `EditorSession` serves the photos: `photo`, `photos()`, `photoUrl()` and `PagePhoto`. `photoRegion.ts` crops the strip.
- The score island lays the score out for its width with Verovio. Each line is a `g.system` that already fits the width. The island scrolls itself, and `shownBar` scrolls it to a bar.
- Adding a new piece ends in `AddMusicScreen.handOver` with `router.replace({ name: 'practice', pieceId })`. The stack is then `[home or library, practice]`.
- "+ Add pages" in the editor is the only way into `add-music` with a `pieceId`. When that flow ends, it pops back to the editor, which reopens on the longer score.
- A new piece is named `i18n.defaultPieceName(addedAt)`, for example "19 Nov 14:05". The editor's title input is plain, and `EditorSession.setTitle` marks the session dirty when the trimmed title differs from the saved name.

The screen follows the interactive mock the user reviewed. It is not compared with Figma: the Figma design is finished (change `retire-figma-review`). D6 lists what is checked by eye.

## Goals / Non-Goals

**Goals:**
- Showing one line reuses the island's drawing, hit-testing and marks unchanged: no second render and no SVG surgery.
- The new-piece state lives in the session and the route, so a test can open the editor as "new" without going through scanning.

**Non-Goals:**
- Pinch to zoom, or a larger engraving scale for the line.
- Keeping the page photos reachable anywhere in the app.

## Decisions

### D1. One line = the island clipped to one system, not a re-render

The island gets an optional signal `line: ReadonlySignal<number | null>`, the index of a bar whose line to show. When it is set:
- the island finds that bar's `g.system`, through a new `ScoreView.lineElement(barIndex)`;
- it sets its own height to the system's height plus the bar box padding;
- it scrolls to the system's top and stops user scrolling (`overflow: hidden`).

On re-layout (rotation, an edit that changes the line breaks), it measures again. When `line` is null, the island is the full scroller, as in practice.

The editor passes `line = selection's bar` unless "Full score" is on. The score card's height follows: the full sheet gets a taller box than today's 11rem, and one line takes the line's own height.

*Alternative:* crop the SVG's viewBox to the system, as the mock did. Rejected. Verovio nests an inner `svg.definition-scale` that sizes itself to the outer viewBox, so a crop needs pinning that inner svg and converting between two coordinate systems. The mock first shipped an empty strip because of exactly this. The island's own coordinates, `barRect` and the hit test already work in page pixels. Clipping changes none of them.

*Alternative:* render a second, larger engraving of the line. Rejected, because the line already fits the width. A larger scale would wrap it into two lines, which defeats the point.

### D2. Line navigation and Full score

The strip under the score holds:
- the previous-line arrow;
- the label "Line 2 of 6 · Bars 4–7";
- the next-line arrow;
- "Full score".

The arrows select the first bar of the other line, through `EditorSession.selectBar`, so the bar-line controls and Preview follow.

"Full score" is screen state (`Editor.tsx`), like the tab. It keeps the selection. While it is on, the island is the full scroller and scrolls to the selected bar, and the strip shows "Tap a note to zoom in" with a button back to the selected bar's line. Any tap that selects (a note, an element, a bar line) turns it off. With nothing selected, the island always shows the full score.

The warnings' Previous and Next select a bar, so they land in that bar's line. Picking the notes of a slur, tie or hairpin keeps working across lines, because the arrows change the selection without ending the pick.

Line geometry is a pure function, `linesOf(view)` → `{ firstBar, lastBar }[]`, read from the drawn systems. The label and the arrows use it.

### D3. What goes, what moves

- **Goes:**
  - the pill row;
  - `EditorSheets.tsx`, and the sheet names `'pages'` and `'goto'` from `SheetName`;
  - `PhotoStrip.tsx` and `photoRegion.ts`;
  - `EditorSession.photo`, `photos()`, `photoUrl()`, `PagePhoto` and `PhotoView`;
  - the texts `editor.pages*`, `editor.goToBar`, `tools.goToBar*` and `editor.photo*`.
  The stored photos stay. Adding pages still saves them, and nothing deletes them.
- **"Preview bar N" / "Stop preview"** moves into the tools head, before Undo and Redo, as a text button with the play or pause icon. It is off while nothing is selected. Its behaviour is unchanged (`previewBar`, `stopPreview`).
- **"Add pages"** moves to the foot of the Score tab, as a full-width secondary row: "Add pages", with the caption "Scan more pages; they go after bar 19". The handler is today's `addPages`, unchanged: it asks to save first, then pushes `add-music` with the `pieceId`.

### D4. A new piece hands over to the editor

`Screen` for the editor gains an optional `isNew: true`. `AddMusicScreen.handOver` does `router.replace({ name: 'editor', pieceId, isNew: true })` for a new piece. The add-pages ending (`pop`) is unchanged.

Replace drops add-music's own guard. The editor screen is on top when its session opens, so the editor's leave guard lands on the right entry (the condition `EditorScreen` already relies on). That gives the stacks:

| Action | Stack after |
|---|---|
| Add a piece | `[home, editor]` |
| Back with no edits | `[home]` |
| Save & practice (nothing below is practice of this piece, so `saveAndPractice` replaces) | `[home, practice]` |

*Alternative:* keep handing over to practice and open the editor on top. Rejected: Back from the editor would then land in practice of a piece the user never chose to practise yet.

### D5. "Name this piece": the session knows, the field shows

`openEditor(…, pieceId, { isNew })` sets a session signal `naming`. It is true for a new piece until:
- the title is changed (`setTitle`);
- a save succeeds;
- or the user leaves.

While `naming` is on, the editor:
- tints the title field and shows the caption "Name this piece" in place of "Title";
- on the field's first focus, selects its whole text, so typing replaces the date name;
- does not focus the field, so no keyboard opens.

Nothing else changes: an untouched date name saves as it is, and an empty name is still refused.

*Alternative:* autofocus the field. Rejected: the user chose no keyboard, because it covers the score.

### D6. Checked by eye in browser-dev

There are no frames for the new states, and `docs/design/deviations.md` is a record that is no longer added to. The new states are checked by eye in the app in browser-dev at 360 × 780, in English and Dutch:

- the full sheet with nothing selected;
- the one-line state with the line strip under it;
- Preview in the tools head;
- the Score tab with Add pages at its foot;
- the naming state of the title, and the end of adding a piece landing on it.

## Risks / Trade-offs

- [A line taller than usual (a high ledger passage, a tempo mark above) makes the strip tall] → The strip is the system's own height. That is what the page already shows, and the tools scroll under it. It is checked by eye in browser-dev (D6).
- [Re-layout after an edit moves bars between lines] → The island measures the line again after each layout, by the selected bar, not by a stored line number.
- [Losing the photo comparison] → The user chose this in the mock review. The photos stay stored, so a later change can bring a full-page view back.
- [Tests relied on the photo strip and the pills (`edit.test.ts` frame test, the photo-strip test, the go-to and pages sheets test)] → Those tests are removed or rewritten in the tasks.

## Calls made while building

Made during `/opsx:apply` without stopping, as the user asked; each is small and easy to change.

- **Order.** Tasks 3.1 (the pills, sheets and photo strip go; Preview moves) and 3.3 (Add pages moves) were done with group 1. Removing the photos from the session (1.3) cannot typecheck while the strip and the sheets still use them, and the pill row held Add pages.
- **Preview with nothing selected** is shown, off, as "Preview" ("Beluisteren"), so the tools head does not jump when a bar is selected.
- **Add pages caption:** "Scan more pages; they go after bar {bar}." ("Scan meer pagina's; ze komen na maat {bar}."), with the piece's bar count.
- **Tests:** the router tests that used the removed sheet names use `tools` and `instrument`. The bar-lines journey selects a bar without a note by tapping its bar line, as "Go to bar" is gone.
- **The line geometry** lives in `core/score/lines.ts` (`linesOf` over the same `SvgTree` as `mapElements`, bars from 0), so the quick layer tests it without a DOM. `ScoreView.lines` holds it after each layout, and the island hands it to the editor through `onLines`. The island's `line` is a bar from 1, like its `bar`.
- **No scrolling to measure against:** the editor's island keeps its scroll bar's room (`scrollbar-gutter: stable`), so switching to one line, which stops the scrolling, does not widen the score and lay it out again with other line breaks.
- **Full sheet height:** 24rem, as in the mock the user reviewed (it was 11rem). The page scrolls to the tools under it.
- **The strip in Full score** reads "Tap a note to zoom in." with "Back to bar {bar}", which shows the selection's line again. Dutch: "Regel 2 van 6", "Vorige regel", "Volgende regel", "Hele partituur", "Tik op een noot om in te zoomen.", "Terug naar maat {bar}".
- **What ends Full score:** a tap that selects a note or an element (a bar line too), the line arrows, and the warnings' Previous and Next. An empty tap does not: it only puts away the selected element.
- **Naming texts:** "Name this piece" / "Geef dit muziekstuk een naam". The press that focuses the title selects the date name, and its own mouseup is cancelled so the caret does not undo the selection. Only the first focus selects; after that the field behaves as a plain text field.
- **The device smoke test** (`EndToEndSmokeTest`) now waits for the editor after reading, checks that it asks for a name, and goes on through Save & practice. It is compiled here and runs before archive.
- **The tools head wraps:** Preview, Undo and Redo are one group at the right. When they leave the heading less than 5.5rem (Dutch: "Maat 5 beluisteren", "Ongedaan maken", "Opnieuw"), the heading takes a row of its own above them. In Dutch the line strip's label also takes two short lines ("Regel 2 van 8 · Maat / 3–5").
- **Add pages on a named new piece** (found in review): the editor's stack entry still said `isNew`, so after adding pages the editor asked for the name again. Once naming has ended, Add pages swaps that entry for a plain editor entry before it opens adding music. A piece still under its untouched date name keeps being asked about.

