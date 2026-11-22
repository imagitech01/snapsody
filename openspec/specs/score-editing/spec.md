# score-editing Specification

## Purpose

Lets the user fix reading mistakes quickly on the phone, one line of music at a time, so a misread note never forces a new scan.

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

For a note in a chord, pitch and accidental SHALL change that note only, and length, dots, triplet and rest SHALL change the whole chord. Deleting a chord note SHALL delete that note only. Inserting SHALL add to the selected note's voice.

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

#### Scenario: Fix one note of a chord
- **WHEN** the user selects the top note E5 of a C5–E5 chord and steps it up once
- **THEN** the chord becomes C5–F5

#### Scenario: Lengthen a chord
- **WHEN** the user selects any note of a quarter-note chord and sets the length to half
- **THEN** every note of the chord becomes a half note

#### Scenario: Insert in the second voice
- **WHEN** the user selects a note of voice 2 and inserts a note after it
- **THEN** the new note is in voice 2, and voice 1 is unchanged

### Requirement: Edit signatures and tempo
The user SHALL be able to change the key signature of the part being edited, and the piece's time signature and tempo marking. A key change SHALL apply to that part only. The time signature and tempo marking SHALL apply to every part.

#### Scenario: Wrong key signature
- **WHEN** the user changes the key signature from no sharps to one sharp
- **THEN** every F without its own accidental is treated as F♯ in display and playback

#### Scenario: Hold to change the tempo marking quickly
- **WHEN** the user holds a button of the tempo marking down and then undoes
- **THEN** the marking keeps changing while the button is held, and one undo takes the whole hold back

#### Scenario: Key of the melody only
- **WHEN** a tenor-sax melody was read in one sharp with a piano part in no sharps, and the user changes the melody's key to two sharps
- **THEN** the melody has two sharps, and the piano part keeps no sharps

#### Scenario: Time signature for the whole piece
- **WHEN** the user changes the time signature from 4/4 to 3/4 while editing the piano part
- **THEN** both parts are in 3/4

### Requirement: Edits keep bars consistent
After each edit, the app SHALL re-run the bar-length check on every voice of the edited bar and SHALL mark the bars that no longer add up, without blocking the edit. When a part has more than one staff or voice, the warning SHALL name the staff and the voice.

#### Scenario: Edit breaks a bar
- **WHEN** the user lengthens a quarter note to a half note in a full 3/4 bar
- **THEN** the edit is applied and the bar is marked as not adding up

#### Scenario: Left hand too long
- **WHEN** the user lengthens a note in the left hand of bar 5 so that it adds up to 5 beats in 4/4
- **THEN** bar 5 is marked, and the warning says it is the left hand that adds up to 5 beats

### Requirement: Undo
The user SHALL be able to undo and redo edits made in the current editing session.

#### Scenario: Undo a mistake
- **WHEN** the user deletes a note by accident and taps undo
- **THEN** the note is restored

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

### Requirement: Crescendo and diminuendo
The user SHALL be able to add a crescendo or a diminuendo from one note to another, and remove it.

#### Scenario: Crescendo over a bar
- **WHEN** the user adds a crescendo from the first to the last note of bar 3
- **THEN** a crescendo hairpin is shown under bar 3 and the notes play gradually louder

### Requirement: Preview a bar
The user SHALL be able to hear the selected bar on its own, at the piece's practice tempo, as practice plays it: the user's part and the parts that play along, each with its own sound, and the user's line on or off as set in practice. The control for it SHALL sit with the editing tools, next to undo and redo.

#### Scenario: Check a corrected bar
- **WHEN** the user corrects a note in bar 3 and taps "Preview bar 3"
- **THEN** only bar 3 plays, with the correction

#### Scenario: Preview with the accompaniment
- **WHEN** the user corrects a note in bar 3 of the piano part of a melody-and-piano piece, where both parts play in practice
- **THEN** bar 3 plays with the melody and the piano together

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

### Requirement: Fix a clef
The user SHALL be able to delete a clef change, or change any clef between treble and bass, on either staff. The notes SHALL keep their place on the staff, and their pitches SHALL be read again under the clef that now applies. Explicit accidentals SHALL stay on their notes. The clef applies to its staff until the next clef change on that staff.

#### Scenario: Remove a clef read from a hole in the page
- **WHEN** bars 11–14 were read under a bass clef that is not in the book, and the user deletes that clef
- **THEN** bars 11–14 are drawn in treble clef with every note on the same line or space as before, and the note on the middle line of the staff now plays as B4, not D3

#### Scenario: Change the first clef
- **WHEN** a treble-clef piece was read with a bass clef at the start, and the user changes that clef to treble
- **THEN** the whole piece is drawn in treble clef with its notes in the same places, until the next clef change

#### Scenario: Left hand only
- **WHEN** the left hand of a piano part was read in treble clef, and the user changes its first clef to bass
- **THEN** the left hand is drawn in bass clef with its notes in the same places, and the right hand keeps its treble clef

### Requirement: One line while editing
With nothing selected, the editor SHALL show the whole score of the part being edited. Once a note, rest, bar or element is selected, it SHALL show only the line of music that holds it, with every staff of that line, so the tools get the room. Arrows SHALL step to the line before or after, selecting its first bar, and "Full score" SHALL show the whole score again. A line is as many bars as fit the screen's width.

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

#### Scenario: A piano line
- **WHEN** the user taps a note in the left hand of a piano part
- **THEN** the line shows both staves of that system, right hand and left hand

### Requirement: Multi-measure rests while editing
The editor SHALL draw each bar of a multi-measure rest as a bar of its own, so that each can be selected and edited. Once one of those bars holds anything other than a whole-bar rest, practice SHALL draw the bars as separate bars too.

#### Scenario: Fix a bar inside a long rest
- **WHEN** a piece has a multi-measure rest of 4 at bars 5–8 and the user opens the editor
- **THEN** bars 5, 6, 7 and 8 are drawn as four bars, each with a whole-bar rest

#### Scenario: A note put into the rest
- **WHEN** the user turns the rest in bar 7 into a note and saves
- **THEN** practice draws bars 5 to 8 as four separate bars, with the note in bar 7

### Requirement: Edit any part
The editor SHALL open on the user's part. When the piece has more than one part, a part switch SHALL let the user edit any other part. A two-staff part SHALL be drawn with both staves and every voice. Edits to one part SHALL NOT change another part.

#### Scenario: Fix the accompaniment
- **WHEN** the user plays the melody of a melody-and-piano piece, opens the editor and switches to *Piano*
- **THEN** the piano part is drawn as a grand staff, and a note in it can be selected and changed

#### Scenario: One-part piece
- **WHEN** the piece has one part
- **THEN** there is no part switch

#### Scenario: Parts stay apart
- **WHEN** the user deletes a note in bar 3 of the melody
- **THEN** bar 3 of the piano part is unchanged

### Requirement: Select a chord note
The user SHALL be able to select a single note of a chord, a note in either staff and a note in either voice, by tapping it. The editor SHALL name where it is: the bar, the staff when the part has two (*Right hand*, *Left hand*), the voice when the staff has more than one, and for a chord note its place from the bottom.

#### Scenario: Middle note of a chord
- **WHEN** the user taps the middle note of a three-note chord in the left hand of bar 5
- **THEN** that note alone is highlighted, and the editor shows "Bar 5 · Left hand · Chord, note 2 of 3"

#### Scenario: Second voice
- **WHEN** the user taps a note of the second voice in the right hand of bar 7
- **THEN** the editor shows "Bar 7 · Right hand · Voice 2"

#### Scenario: One-line piece
- **WHEN** the user taps the third note of bar 2 in a one-line piece
- **THEN** the editor shows "Bar 2 · Note 3", as before

### Requirement: Chord tools
The user SHALL be able to add a note to the selected note or chord, a third above its top note in the key, with the same length. In a two-staff part, the user SHALL be able to move the selected note or chord to the other staff, where it joins a chord of the same start and length or takes the place of a rest that covers it exactly, leaving a rest of the same length behind. When neither is there, the move SHALL be refused with an explanation.

#### Scenario: Add a missed chord note
- **WHEN** the user selects a C4–E4 chord in C major and taps "+ Chord note"
- **THEN** the chord becomes C4–E4–G4, and the new G4 is selected

#### Scenario: A note read in the wrong hand
- **WHEN** a quarter note C4 was read in the right hand on beat 3, the left hand has a quarter rest on beat 3, and the user taps "To other hand"
- **THEN** the C4 is in the left hand on beat 3, and the right hand has a quarter rest there

#### Scenario: Nowhere to go
- **WHEN** the left hand has a half note sounding across beat 3 and the user moves a right-hand quarter note on beat 3 to the other hand
- **THEN** nothing changes, and the editor explains that the other hand has no rest or chord of the same length there

### Requirement: Marks belong to a staff or voice
A dynamic or a crescendo or diminuendo SHALL belong to a staff, and apply to every voice of it. A slur or tie SHALL belong to a voice, and join notes of that voice only. Adding one SHALL use the staff or voice of the notes the user chooses.

#### Scenario: Dynamic in the left hand
- **WHEN** the user selects a dynamic *p* under the left hand and changes it to *f*
- **THEN** the left hand plays louder from there, and the right hand does not change

#### Scenario: Slur across voices
- **WHEN** the user starts a slur on a note in voice 1 and taps a note in voice 2 as its last note
- **THEN** no slur is added, and the editor explains that a slur joins notes of one voice

### Requirement: Add a bar line
The user SHALL be able to add a bar line before the selected note or rest, splitting its bar in two in every part. A rest that crosses the new bar line SHALL be split with it. When a note in any part sounds across it, or it would fall inside a triplet, the bar line SHALL NOT be added, and the editor SHALL say where. The bars after it SHALL be renumbered. The change SHALL be one undo step.

#### Scenario: A missed bar line
- **WHEN** bar 6 of a 3/4 melody was read with six quarter notes because a bar line was missed, and the user selects the fourth note and taps "Bar line before"
- **THEN** bar 6 holds the first three notes and bar 7 the last three, the old bar 7 is now bar 8, and neither bar is marked as not adding up

#### Scenario: The rest of the piece follows
- **WHEN** the piano part has a whole-bar rest in that bar
- **THEN** the piano part has a whole-bar rest in both new bars

#### Scenario: A note across the bar line
- **WHEN** the left hand holds a half note across the point where the user adds a bar line
- **THEN** no bar line is added, and the editor explains that a note in the left hand sounds across it

#### Scenario: The end of the bar moves along
- **WHEN** the bar ends in an end-repeat and the user adds a bar line inside it
- **THEN** the end-repeat is at the end of the second of the two bars

#### Scenario: Not before the first note
- **WHEN** the user selects the first note of a bar
- **THEN** "Bar line before" is not offered

### Requirement: Remove a bar line
The user SHALL be able to remove the bar line at the end of the selected bar, joining it with the next bar in every part. The joined bar SHALL keep how the first bar starts and how the second ends. The bar line SHALL NOT be removed after the last bar, at the end of a printed line or page, or when the next bar starts with a clef, key or time signature change or an ending; the editor SHALL say why. The bars after it SHALL be renumbered. The change SHALL be one undo step.

#### Scenario: An extra bar line
- **WHEN** bar 3 of a 4/4 piece was read as two bars of two beats each, bars 3 and 4, and the user selects bar 3 and taps "Remove bar line"
- **THEN** bar 3 holds the notes of both and adds up to four beats, and the old bar 5 is now bar 4

#### Scenario: From the bar line itself
- **WHEN** the user taps the bar line at the end of bar 3
- **THEN** bar 3 is selected, and "Remove bar line" is offered with its bar-line controls

#### Scenario: Two rests become one
- **WHEN** the piano part has a whole-bar rest in both bars that are joined
- **THEN** the piano part has one whole-bar rest in the joined bar

#### Scenario: A clef change in the way
- **WHEN** the next bar starts with a clef change and the user taps "Remove bar line"
- **THEN** nothing changes, and the editor explains that the clef change must be deleted first

#### Scenario: The end of a printed line
- **WHEN** the selected bar is the last bar of a line in the photo of the page
- **THEN** "Remove bar line" is not offered

### Requirement: Bar numbers follow a bar-line change
When a piece is saved after bar lines were added or removed, the piece's number of bars, the bars of each page and of each line in its photos, and the practice position and loop SHALL follow the new numbering, so they hold the same music as before.

#### Scenario: A loop after the change
- **WHEN** the loop is bars 9 to 12, and the user adds a bar line in bar 6 and saves
- **THEN** the loop is bars 10 to 13, over the same music

#### Scenario: A loop around the change
- **WHEN** the loop is bars 5 to 8, and the user adds a bar line in bar 6 and saves
- **THEN** the loop is bars 5 to 9

#### Scenario: The photo of the line
- **WHEN** the user added a bar line in bar 6, saved, and selects the new bar 7
- **THEN** the photo shows the line of the page that held the old bar 6
