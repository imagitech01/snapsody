## MODIFIED Requirements

### Requirement: Add pages to a piece
From the editor's Score tab, the user SHALL be able to scan more pages for an existing piece. After reading, their music SHALL be added after the piece's last bar, part by part. The existing bars and their corrections SHALL stay unchanged. Parts the user did not keep SHALL be left out of the new pages too, without asking again.

#### Scenario: Forgot the second page
- **WHEN** a piece has 8 bars and the user adds a page that holds 6 more
- **THEN** the piece has 14 bars, the first 8 with their corrections intact

#### Scenario: Add a page to a melody-only piece
- **WHEN** the user kept only the melody of a melody-and-piano piece and adds the next page, which also has both parts
- **THEN** the new bars have the melody only, and no parts step is shown

### Requirement: A new piece opens in the editor
When a new piece has been read and saved, the app SHALL open it in the editor, not in practice. When the reading found more than one part, the parts step SHALL come first, and the piece SHALL be saved once the user continues from it. Going back from the editor SHALL return to the screen adding music was started from. "Save & practice" in the editor then opens it for practice.

#### Scenario: Add a piece
- **WHEN** the user adds a piece of two pages from the home screen and both pages are read
- **THEN** the piece is saved and opens in the editor, and Back returns to the home screen

#### Scenario: Practise straight away
- **WHEN** the new piece is open in the editor and the user taps "Save & practice"
- **THEN** it opens for practice, and Back from practice returns to the home screen

#### Scenario: Parts step first
- **WHEN** the user adds a page with a melody and a piano part
- **THEN** the parts step is shown, and after Continue the piece is saved and opens in the editor

#### Scenario: Back from the parts step
- **WHEN** the parts step is shown and the user goes back
- **THEN** no piece is created, and the screen where the user started adding music is shown again
