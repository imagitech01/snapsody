# score-editing Specification

## Purpose

Lets the user fix reading mistakes quickly on the phone, with the original photo beside the selected bar, so a misread note never forces a new scan.

## Requirements

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

### Requirement: Edit signatures and tempo
The user SHALL be able to change the piece's key signature, time signature and tempo marking.

#### Scenario: Wrong key signature
- **WHEN** the user changes the key signature from no sharps to one sharp
- **THEN** every F without its own accidental is treated as F♯ in display and playback

#### Scenario: Hold to change the tempo marking quickly
- **WHEN** the user holds a button of the tempo marking down and then undoes
- **THEN** the marking keeps changing while the button is held, and one undo takes the whole hold back

### Requirement: Edits keep bars consistent
After each edit, the app SHALL re-run the bar-length check and SHALL mark the bars that no longer add up, without blocking the edit.

#### Scenario: Edit breaks a bar
- **WHEN** the user lengthens a quarter note to a half note in a full 3/4 bar
- **THEN** the edit is applied and the bar is marked as not adding up

### Requirement: Undo
The user SHALL be able to undo and redo edits made in the current editing session.

#### Scenario: Undo a mistake
- **WHEN** the user deletes a note by accident and taps undo
- **THEN** the note is restored

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

### Requirement: Edit bar lines
For the selected bar, the user SHALL be able to set how it starts (normal or start-repeat `||:`) and how it ends (normal, double bar line `||` or end-repeat `:||`). For an end-repeat, the user SHALL be able to set how many times the section is played in total, from 2 to 8, with 2 as the default. The editor SHALL show the selected bar's current start and end, and playback SHALL follow the edited signs. First and second endings are not edited, and an ending already on the bar SHALL stay.

#### Scenario: Make a repeat explicit
- **WHEN** an exercise has bar 1 ending in an end-repeat, bar 2 ending in a double bar line, and bar 3 ending in an end-repeat, and the user selects bar 3 and sets its start to start-repeat
- **THEN** bar 3 is drawn with `||:`, and playback order is bars 1, 1, 2, 3, 3, then the bars after it

#### Scenario: Add a missing end-repeat
- **WHEN** recognition missed the end-repeat of bar 2 in a three-bar exercise, and the user sets the end of bar 2 to end-repeat
- **THEN** bar 2 is drawn with `:||`, and playback order is bars 1, 2, 1, 2, 3

#### Scenario: Play a section three times
- **WHEN** bar 2 ends in an end-repeat, and the user sets it to 3×
- **THEN** playback order is bars 1, 2, 1, 2, 1, 2, then the bars after it

#### Scenario: Remove a misread repeat
- **WHEN** recognition read a plain bar line at the end of bar 4 as an end-repeat, and the user sets that end to normal
- **THEN** the bar is drawn with a plain bar line, and playback goes on to bar 5 without repeating

#### Scenario: Show what the selected bar has
- **WHEN** the user selects a note in a bar that starts with `||:` and ends with a double bar line
- **THEN** the controls show start-repeat as the bar's start and double bar line as its end

#### Scenario: Endings stay
- **WHEN** the user changes the repeat count of an end-repeat at the end of a first ending
- **THEN** the first ending is still there, and the second ending is still played on the last pass

#### Scenario: Undo a bar-line edit
- **WHEN** the user sets the end of a bar to end-repeat and taps undo
- **THEN** the bar ends as it did before, and playback no longer repeats there

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
