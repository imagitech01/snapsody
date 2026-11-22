## ADDED Requirements

### Requirement: Multi-measure rests while editing
The editor SHALL draw each bar of a multi-measure rest as a bar of its own, so that each can be selected and edited. Once one of those bars holds anything other than a whole-bar rest, practice SHALL draw the bars as separate bars too.

#### Scenario: Fix a bar inside a long rest
- **WHEN** a piece has a multi-measure rest of 4 at bars 5–8 and the user opens the editor
- **THEN** bars 5, 6, 7 and 8 are drawn as four bars, each with a whole-bar rest

#### Scenario: A note put into the rest
- **WHEN** the user turns the rest in bar 7 into a note and saves
- **THEN** practice draws bars 5 to 8 as four separate bars, with the note in bar 7

## MODIFIED Requirements

### Requirement: Articulation marks
The user SHALL be able to turn staccato, staccatissimo, tenuto, accent, strong accent, fermata, trill, turn, mordent and tremolo on and off on the selected note, and an arpeggio on and off on the selected chord. A note SHALL carry at most one of trill, turn and mordent. Slurs and ties SHALL be added by choosing their first and last notes. Tapping an active mark SHALL remove it.

#### Scenario: Add a staccato
- **WHEN** the user selects a note and taps Staccato
- **THEN** the Staccato mark is shown as active for that note

#### Scenario: Add a slur
- **WHEN** the user chooses Slur, then taps the first and the last note of a phrase
- **THEN** a slur joins those notes and they play connected

#### Scenario: Remove an accent
- **WHEN** the user selects an accented note and taps the active Accent mark
- **THEN** the accent is removed

#### Scenario: Add a missed trill
- **WHEN** the user selects a note that the book shows with a trill and taps Trill
- **THEN** the trill is drawn over the note and the note plays as a trill

#### Scenario: Swap a turn for a mordent
- **WHEN** the user selects a note with a turn and taps Mordent
- **THEN** the note has a mordent and no turn

#### Scenario: Arpeggio needs a chord
- **WHEN** the selected note is not part of a chord
- **THEN** the Arpeggio mark cannot be turned on

### Requirement: Select any element
In the editor, the user SHALL be able to select any drawn element by tapping it: a note, grace note or rest, a clef, a key or time signature, a dynamic, a tempo mark, other text, a hairpin, a slur, a tie, an articulation, an ornament (trill, turn, mordent, tremolo), an arpeggio, a caesura or a bar line. The selected element SHALL be highlighted, and the editor SHALL name it with its bar. When an element and a note overlap, the element drawn directly under the finger SHALL be selected.

#### Scenario: Select a misread clef
- **WHEN** the user taps the bass clef drawn before bar 11
- **THEN** the clef is highlighted and the editor shows "Clef · bass · bar 11"

#### Scenario: Select a dynamic under a note
- **WHEN** the user taps the *mf* under the first note of bar 3
- **THEN** the *mf* is selected, not the note

#### Scenario: Tap a bar line
- **WHEN** the user taps the bar line at the end of bar 4
- **THEN** bar 4 is selected and the bar-line controls show its start and end

#### Scenario: Delete a misread trill
- **WHEN** the user taps a trill in bar 6 that is not in the book and taps Delete
- **THEN** the trill is gone, and the note plays plainly

#### Scenario: Delete a two-note tremolo
- **WHEN** the user taps the strokes of a two-note tremolo and taps Delete
- **THEN** both notes lose the tremolo and play as written

### Requirement: Delete an element
The user SHALL be able to delete the selected element, as one undo step. Deleting a dynamic, tempo mark, text, hairpin, slur, tie, articulation, ornament, arpeggio or caesura SHALL remove only that element; deleting a two-note tremolo SHALL remove it from both its notes. Deleting a key or time signature change SHALL make the one before it apply again. The first clef, key and time signature of the piece SHALL NOT be deletable; they are changed instead.

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

#### Scenario: Delete a misread arpeggio
- **WHEN** the user selects the arpeggio line beside a chord and taps Delete
- **THEN** the arpeggio is gone, and the chord's notes sound together
