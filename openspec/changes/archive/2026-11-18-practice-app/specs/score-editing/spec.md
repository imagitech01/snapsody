# Spec Delta

## MODIFIED Requirements

### Requirement: Flags shown for review
The editor SHALL say how many things need checking: bars that don't add up, notes outside the instrument's range, and an inferred time signature. It SHALL mark each one on the score and let the user step from one to the next. A warning SHALL disappear once it is fixed. Warnings SHALL NOT block practising.

#### Scenario: Review flags
- **WHEN** a piece has two notes outside the instrument's range
- **THEN** the editor shows "2 things to check", both notes are marked, and the user can jump from the first to the second

#### Scenario: No flags
- **WHEN** a piece has nothing to check
- **THEN** no warning or mark is shown

#### Scenario: Fixed by an edit
- **WHEN** the user moves a marked note into the instrument's range
- **THEN** its mark disappears and the count goes down by one

### Requirement: Edit a note
The user SHALL be able to select a note and:
- step its pitch up or down;
- set its accidental (sharp, flat, natural or none);
- set its length (whole to sixteenth, dotted, triplet);
- turn it into a rest or a rest into a note;
- insert a note or rest before or after it;
- delete it.

#### Scenario: Fix a wrong pitch
- **WHEN** the user selects a note read as C5 and steps it down once
- **THEN** the note becomes B4 and the score display updates

#### Scenario: Fix articulation
- **WHEN** the user selects a note and turns staccato on
- **THEN** the note shows a staccato dot and plays shortened

#### Scenario: Make a triplet
- **WHEN** the user selects three eighth notes in turn and sets each to triplet
- **THEN** they are shown and played as an eighth-note triplet

#### Scenario: Insert a rest
- **WHEN** the user selects a note and inserts a quarter rest after it
- **THEN** a quarter rest follows the note

## ADDED Requirements

### Requirement: Articulation marks
The user SHALL be able to turn staccato, tenuto, accent and fermata on and off on the selected note. Slurs and ties SHALL be added by choosing their first and last notes. Tapping an active mark SHALL remove it.

#### Scenario: Add a staccato
- **WHEN** the user selects a note and taps Staccato
- **THEN** the Staccato mark is shown as active for that note

#### Scenario: Add a slur
- **WHEN** the user chooses Slur, then taps the first and the last note of a phrase
- **THEN** a slur joins those notes and they play connected

#### Scenario: Remove an accent
- **WHEN** the user selects an accented note and taps the active Accent mark
- **THEN** the accent is removed

### Requirement: Crescendo and diminuendo
The user SHALL be able to add a crescendo or a diminuendo from one note to another, and remove it.

#### Scenario: Crescendo over a bar
- **WHEN** the user adds a crescendo from the first to the last note of bar 3
- **THEN** a crescendo hairpin is shown under bar 3 and the notes play gradually louder

### Requirement: Preview a bar
The user SHALL be able to hear the selected bar on its own, at the piece's practice tempo, with the instrument in use.

#### Scenario: Check a corrected bar
- **WHEN** the user corrects a note in bar 3 and taps "Preview bar 3"
- **THEN** only bar 3 plays, with the correction

### Requirement: Original beside the selected bar
The editor SHALL show the part of the source photo that holds the selected bar, labelled with its page and bar. When the position of that bar on the photo is not known, it SHALL show the whole photo of its page.

#### Scenario: Compare a bar with the book
- **WHEN** the user selects a note in bar 3 on page 1
- **THEN** the strip of page 1's photo with the staff that holds bar 3 is shown, labelled "Photo 1 · Bar 3"

### Requirement: Save and practice
"Save & practice" SHALL save the edits and open the piece for practice. Leaving the editor with unsaved edits SHALL ask whether to discard them.

#### Scenario: Save and practice
- **WHEN** the user corrects a note and taps "Save & practice"
- **THEN** the piece is saved and opens for practice with the correction

#### Scenario: Leave without saving
- **WHEN** the user has unsaved edits and taps Cancel
- **THEN** the app asks whether to discard the edits, and keeps the editor open if the user says no

## REMOVED Requirements

### Requirement: Exercises are saved
**Reason**: Saving, renaming and deleting are about the stored pieces, not about editing. They move to the new `piece-library` capability, which also covers pages and favorites.
**Migration**: See `piece-library`: "Pieces are saved", "Default name", "Rename" and "Delete a piece".
