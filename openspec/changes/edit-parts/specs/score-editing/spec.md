## ADDED Requirements

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

## MODIFIED Requirements

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

### Requirement: Edits keep bars consistent
After each edit, the app SHALL re-run the bar-length check on every voice of the edited bar and SHALL mark the bars that no longer add up, without blocking the edit. When a part has more than one staff or voice, the warning SHALL name the staff and the voice.

#### Scenario: Edit breaks a bar
- **WHEN** the user lengthens a quarter note to a half note in a full 3/4 bar
- **THEN** the edit is applied and the bar is marked as not adding up

#### Scenario: Left hand too long
- **WHEN** the user lengthens a note in the left hand of bar 5 so that it adds up to 5 beats in 4/4
- **THEN** bar 5 is marked, and the warning says it is the left hand that adds up to 5 beats

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

### Requirement: Preview a bar
The user SHALL be able to hear the selected bar on its own, at the piece's practice tempo, as practice plays it: the user's part and the parts that play along, each with its own sound, and the user's line on or off as set in practice. The control for it SHALL sit with the editing tools, next to undo and redo.

#### Scenario: Check a corrected bar
- **WHEN** the user corrects a note in bar 3 and taps "Preview bar 3"
- **THEN** only bar 3 plays, with the correction

#### Scenario: Preview with the accompaniment
- **WHEN** the user corrects a note in bar 3 of the piano part of a melody-and-piano piece, where both parts play in practice
- **THEN** bar 3 plays with the melody and the piano together
