# Proposal

## Why

The user cannot change bar lines in the editor yet. Repeat signs and double bar lines come only from recognition, so a missed or misread sign makes playback repeat the wrong bars. Exercise books also often leave out the start-repeat sign `||:`, and the app then has to guess where the repeat begins (since commit 2f20ea7 it goes back to the last double bar line). Being able to set the signs is the reliable fix: what the user writes is what plays.

## What Changes

- In the editor, for the selected bar, the user can set:
  - how the bar **starts**: normal or start-repeat `||:`;
  - how the bar **ends**: normal, double bar line `||` or end-repeat `:||`;
  - for an end-repeat, how many times the section is played in total (2× by default, up to 8×).
- These edits work like the other edits: one undo step each, the bar-length check runs again, the score redraws straight away, and saving writes them to the piece.
- Playback follows the edited signs. A start-repeat the user adds takes priority over the double-bar-line fallback, as any start-repeat does.
- First and second endings (the 1. and 2. brackets) cannot be edited yet. An edit to a bar's start or end leaves any ending already on it unchanged.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `score-editing`: adds the requirement "Edit bar lines", covering the start and end of the selected bar and the number of passes of an end-repeat.

## Impact

- `web/src/core/score/edit.ts`: new edits that set a bar's start, its end and its repeat count, keeping the MusicXML bar lines consistent. A double bar line can be written on either side of a bar boundary, and endings stay.
- `web/src/app/editorSession.ts`: what the selected bar's start and end are now, for the controls.
- `web/src/ui/screens/editor/`: the bar-line controls in the editor (see design for where they go), plus the i18n texts in `web/src/app/i18n/en.ts` and `nl.ts`.
- `web/src/core/playback/timeline.ts`: no change in behaviour. A test pins down that a start-repeat the user adds wins over the double-bar-line fallback.
- Stored piece format: unchanged. Bar lines are already MusicXML `<barline>` elements, which the piece's score file reads and writes.
- Tests: quick-layer unit tests for the edits, and the editor journey in `web/test/ui/edit.test.ts`.
