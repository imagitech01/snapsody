## ADDED Requirements

### Requirement: One line while editing
With nothing selected, the editor SHALL show the whole score. Once a note, rest, bar or element is selected, it SHALL show only the line of music that holds it, so the tools get the room. Arrows SHALL step to the line before or after, selecting its first bar, and "Full score" SHALL show the whole score again. A line is as many bars as fit the screen's width.

#### Scenario: Select a note on the full sheet
- **WHEN** nothing is selected and the user taps a note in bar 5, on the line that holds bars 4 to 7
- **THEN** the score shrinks to that line, showing bars 4 to 7, with the note selected

#### Scenario: Step to the next line
- **WHEN** the line with bars 4 to 7 is shown and the user taps the next-line arrow
- **THEN** the next line is shown and its first bar is selected

#### Scenario: Look for another spot
- **WHEN** a line is shown and the user taps "Full score"
- **THEN** the whole score is shown, the selection stays, and tapping a note shrinks the score to that note's line again

#### Scenario: Warning on another line
- **WHEN** a line is shown and the user taps Next on a warning about bar 12
- **THEN** the line that holds bar 12 is shown with bar 12 selected

## MODIFIED Requirements

### Requirement: Preview a bar
The user SHALL be able to hear the selected bar on its own, at the piece's practice tempo, with the instrument in use. The control for it SHALL sit with the editing tools, next to undo and redo.

#### Scenario: Check a corrected bar
- **WHEN** the user corrects a note in bar 3 and taps "Preview bar 3"
- **THEN** only bar 3 plays, with the correction

## REMOVED Requirements

### Requirement: Original beside the selected bar
**Reason**: The strip of the photo is too small to read on a phone and takes room from the tools. When the user wants to compare, they look at the book.
**Migration**: None. The page photos stay stored with the piece, and adding pages still uses them. The editor no longer shows them.
