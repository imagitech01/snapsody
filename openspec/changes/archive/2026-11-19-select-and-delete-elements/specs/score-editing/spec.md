# Spec Delta

## ADDED Requirements

### Requirement: Select any element
In the editor, the user SHALL be able to select any drawn element by tapping it: a note or rest, a clef, a key or time signature, a dynamic, a tempo mark, other text, a hairpin, a slur, a tie, an articulation or a bar line. The selected element SHALL be highlighted, and the editor SHALL name it with its bar. When an element and a note overlap, the element drawn directly under the finger SHALL be selected.

#### Scenario: Select a misread clef
- **WHEN** the user taps the bass clef drawn before bar 11
- **THEN** the clef is highlighted and the editor shows "Clef · bass · bar 11"

#### Scenario: Select a dynamic under a note
- **WHEN** the user taps the *mf* under the first note of bar 3
- **THEN** the *mf* is selected, not the note

#### Scenario: Tap a bar line
- **WHEN** the user taps the bar line at the end of bar 4
- **THEN** bar 4 is selected and the bar-line controls show its start and end

### Requirement: Delete an element
The user SHALL be able to delete the selected element, as one undo step. Deleting a dynamic, tempo mark, text, hairpin, slur, tie or articulation SHALL remove only that element. Deleting a key or time signature change SHALL make the one before it apply again. The first clef, key and time signature of the piece SHALL NOT be deletable; they are changed instead.

#### Scenario: Delete a wrong dynamic
- **WHEN** the user selects a misread *f* in bar 5 and taps Delete
- **THEN** the *f* is gone, and playback from bar 5 keeps the dynamic before it

#### Scenario: Delete a key change
- **WHEN** a key change to one flat was misread at bar 9 of a piece in D major, and the user deletes it
- **THEN** from bar 9 on, every F and C without its own accidental is treated as F♯ and C♯ again

#### Scenario: The first clef cannot be deleted
- **WHEN** the user selects the clef at the start of the piece
- **THEN** there is no Delete action, only the choice of clef

#### Scenario: Undo a deletion
- **WHEN** the user deletes a slur and taps undo
- **THEN** the slur is back on the same notes

### Requirement: Fix a clef
The user SHALL be able to delete a clef change, or change any clef between treble and bass. The notes SHALL keep their place on the staff, and their pitches SHALL be read again under the clef that now applies. Explicit accidentals SHALL stay on their notes. The clef applies until the next clef change.

#### Scenario: Remove a clef read from a hole in the page
- **WHEN** bars 11–14 were read under a bass clef that is not in the book, and the user deletes that clef
- **THEN** bars 11–14 are drawn in treble clef with every note on the same line or space as before, and the note on the middle line of the staff now plays as B4, not D3

#### Scenario: Change the first clef
- **WHEN** a treble-clef piece was read with a bass clef at the start, and the user changes that clef to treble
- **THEN** the whole piece is drawn in treble clef with its notes in the same places, until the next clef change
