## ADDED Requirements

### Requirement: A new piece opens in the editor
When a new piece has been read and saved, the app SHALL open it in the editor, not in practice. Going back from there SHALL return to the screen adding music was started from. "Save & practice" in the editor then opens it for practice.

#### Scenario: Add a piece
- **WHEN** the user adds a piece of two pages from the home screen and both pages are read
- **THEN** the piece is saved and opens in the editor, and Back returns to the home screen

#### Scenario: Practise straight away
- **WHEN** the new piece is open in the editor and the user taps "Save & practice"
- **THEN** it opens for practice, and Back from practice returns to the home screen

## MODIFIED Requirements

### Requirement: Add pages to a piece
From the editor's Score tab, the user SHALL be able to scan more pages for an existing piece. After reading, their music SHALL be added after the piece's last bar. The existing bars and their corrections SHALL stay unchanged.

#### Scenario: Forgot the second page
- **WHEN** a piece has 8 bars and the user adds a page that holds 6 more
- **THEN** the piece has 14 bars, the first 8 with their corrections intact
