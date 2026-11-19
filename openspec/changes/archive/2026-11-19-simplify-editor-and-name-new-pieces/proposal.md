# Proposal

## Why

Trying the editor in an interactive mock showed that it spreads attention over things that do not help with fixing a reading. The full sheet takes room while you work on one spot. The photo strip is too small to read. The Pages, Go to bar and + Add pages row sits between you and the music. Separately, every new piece gets a date for a name, so the first thing after adding a piece is always a trip to the editor just to type its title.

## What Changes

- **The score shrinks to one line while you edit.** With nothing selected, the editor shows the whole sheet, as the practice screen does, to find the spot. Selecting a note, a bar or an element shrinks the score to the one line that holds it, so the tools below get the room. Previous and next arrows step a line at a time, and **Full score** brings the whole sheet back. A line is what Verovio lays out to fit the screen, however many bars that is.
- **BREAKING (spec):** the photo of the selected bar ("Original beside the selected bar") is removed. To compare with the book, the user looks at the book.
- The **Pages, Go to bar and + Add pages** buttons above the score are removed, and so are the page photos sheet and the go-to-bar sheet. The warnings' Previous and Next still jump to a bar.
- **Preview bar** moves from the photo strip to the tools head, next to Undo and Redo.
- **Add pages** moves into the editor's Score tab, as a quiet row at its foot. It works as before: it saves first if needed, then scans pages that go after the last bar.
- **Adding a piece ends in the editor, not in practice.** The new piece opens in the editor with its title field highlighted and the caption "Name this piece". The date name is selected, so one tap types over it. The keyboard does not open by itself. From there, Save & practice opens the piece for practice as today.

Not in this change: a title read from the page by recognition, and a review step before the piece is saved.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `score-editing`: adds "One line while editing". "Preview a bar" now places its control next to undo and redo. Removes "Original beside the selected bar".
- `score-capture`: adds "A new piece opens in the editor". "Add pages to a piece" now names the Score tab.
- `piece-library`: "Default name" asks for a name when the new piece opens in the editor.

## Impact

- `web/src/ui/screens/editor/`:
  - `Editor.tsx` loses the pill row, the sheets and `PhotoStrip`.
  - `ScoreTab.tsx` gains Add pages.
  - The tools head gains Preview bar.
  - `EditorSheets.tsx`, `PhotoStrip.tsx` and `photoRegion.ts` are deleted.
- `web/src/ui/scoreIsland.ts` and `scoreView.ts`: a "one line" mode that shows only the line holding a given bar, with no free scrolling.
- `web/src/app/editorSession.ts`: no longer serves photos, and knows when it was opened for a new piece. `web/src/app/router.ts`: the editor route can say the piece is new.
- `web/src/ui/screens/AddMusicScreen.tsx`: a new piece hands over to the editor instead of practice.
- Texts in `en.ts` and `nl.ts`: new ones for the line strip and "Name this piece". The keys of the removed sheets and the photo strip are deleted.
- Tests: `web/test/ui/edit.test.ts` and `web/test/ui/addMusic.test.ts` change. Unit tests cover the session's new-piece state and the line geometry.
- Stored piece format: unchanged.
