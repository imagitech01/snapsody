# Spec Delta

## ADDED Requirements

### Requirement: One bar at a time
The editor SHALL always have a current bar, shown large with its number, the number of bars and how many beats it adds up to. Above it, the line of music that holds it SHALL stay in view as a small overview, with every staff of the part being edited, the current bar highlighted and the bars to check marked. The editor SHALL open on the first bar to check, or on bar 1 when there is none. A line is as many bars as fit the screen's width.

#### Scenario: Open a piece with a flag
- **WHEN** the user opens the editor of a piece whose first warning is about bar 3
- **THEN** bar 3 is the current bar, shown large, and the overview shows the line that holds bar 3 with bar 3 highlighted

#### Scenario: Nothing to check
- **WHEN** the user opens the editor of a 12-bar piece without warnings
- **THEN** bar 1 is the current bar and the editor shows "Bar 1 of 12"

#### Scenario: A piano bar
- **WHEN** the part being edited has two staves
- **THEN** the overview and the large bar both show the right hand and the left hand

### Requirement: Go to another bar
The user SHALL be able to go to another bar with a previous and a next control, by tapping a bar in the overview, by moving the overview one line back or forward (its first bar then becomes the current bar), by choosing a bar in the full score, and by stepping to a warning. When the current bar moves to another line, the overview SHALL show that line.

#### Scenario: Step to the next bar
- **WHEN** bar 3 of 12 is the current bar and the user taps the next control
- **THEN** bar 4 is shown large and the editor shows "Bar 4 of 12"

#### Scenario: Tap a bar in the overview
- **WHEN** the overview shows bars 4 to 7 and the user taps bar 6 in it
- **THEN** bar 6 is the current bar

#### Scenario: Cross to the next line
- **WHEN** the overview shows bars 4 to 7, bar 7 is the current bar and the user taps the next control
- **THEN** bar 8 is the current bar and the overview shows the line that holds bar 8

#### Scenario: Jump a line ahead
- **WHEN** the overview shows bars 4 to 7 and the user moves it one line forward
- **THEN** the overview shows the next line, and its first bar is the current bar

### Requirement: Full score
A "Full score" control SHALL show the whole score of the part being edited in place of the large bar and the tools, with the current bar highlighted and the bars to check marked. Tapping a bar there SHALL make it the current bar and show it large again. Going back without tapping a bar SHALL keep the current bar. The selection, an armed mark and a mark that waits for its last note SHALL stay as they are while the full score is shown.

#### Scenario: Go to another section
- **WHEN** bar 3 is the current bar, the user taps "Full score" and taps bar 41
- **THEN** bar 41 is the current bar, shown large, and the overview shows the line that holds it

#### Scenario: Look and go back
- **WHEN** bar 3 is the current bar, the user taps "Full score" and then goes back
- **THEN** bar 3 is still the current bar

#### Scenario: A piano piece
- **WHEN** the part being edited has two staves and the user taps "Full score"
- **THEN** the whole part is shown with both staves

### Requirement: Notes and Grid views
The large bar SHALL have two views, Notes and Grid, with a switch between them next to the bar number. Both SHALL show the same bar and the same selection, and an edit made in one SHALL show in the other. The app SHALL remember the view last used, for every piece and after a restart. The first time, the editor SHALL open in Notes.

#### Scenario: Switch with a note selected
- **WHEN** the user selects the second note of bar 2 in Notes and switches to Grid
- **THEN** Grid shows bar 2 with the block of that note selected

#### Scenario: A mark survives the other view
- **WHEN** the user puts a staccato on a note in Notes, switches to Grid and drags the block of that note one step up
- **THEN** the note is one step higher and still has its staccato

#### Scenario: The view is remembered
- **WHEN** the user switches to Grid, saves, and later opens the editor of another piece
- **THEN** the editor opens in Grid

### Requirement: Notes view
In Notes, the current bar SHALL be drawn as engraved music, large enough to touch a single note. Tapping a note or rest SHALL select it and show its name and length, with controls to make it shorter or longer. With the Notes tools open, tapping the staff where there is no note SHALL add a note there: at the pitch of the place tapped, with the chosen length, before the note to its right or else at the end. While the finger stays down, the user SHALL be able to drag the new note to its pitch.

#### Scenario: Shorter
- **WHEN** the user taps a quarter note and taps Shorter
- **THEN** the note is an eighth note and the bar's beat count goes down by half a beat

#### Scenario: Add the next note
- **WHEN** a 4/4 bar holds two quarter notes, the chosen length is a quarter, and the user taps the second line of the staff in the slot after the second note
- **THEN** the bar holds three quarter notes, the third on the second line, and the slot moves after it

#### Scenario: Add a note between two notes
- **WHEN** a bar holds C4 and then E4, and the user taps the staff between them at the height of D4
- **THEN** the bar holds C4, D4 and E4 in that order, and the new note is selected

#### Scenario: Tap in the left hand
- **WHEN** the user taps the lower staff of a piano bar where there is no note
- **THEN** the note is added to the left hand, and the right hand is unchanged

### Requirement: Drag a note to change its pitch
In Notes, dragging a note up or down SHALL change its pitch one staff step at a time, with the name of the note shown and its sound heard while dragging, as one undo step. A drag that starts on a note SHALL be either a pitch change or a slide to another note (see "Slide between two notes"), decided by its first direction, never both. Dragging a chord note SHALL move that note only.

#### Scenario: Drag a note down
- **WHEN** the user drags a note read as C5 down one staff step and lets go
- **THEN** the note is B4, and one undo makes it C5 again

#### Scenario: Drag one note of a chord
- **WHEN** the user drags the top note E5 of a C5–E5 chord up one staff step
- **THEN** the chord is C5–F5

### Requirement: Grid view
In Grid, one voice of the current bar SHALL be drawn as blocks on a grid: a row for each staff position, named by its note, and a column for each sixteenth of the bar, with the beats marked. A block SHALL start at its note's place in the bar and be as long as the note. A staccato note SHALL be drawn as a shortened block, and an accented note with a marked front edge.

#### Scenario: A bar in 6/8
- **WHEN** the piece is in 6/8
- **THEN** the grid has twelve columns, with the two beats of three eighths marked

#### Scenario: A staccato block
- **WHEN** a quarter note has a staccato
- **THEN** its block starts on its beat and is drawn shorter than a quarter, and the note is still a quarter note

### Requirement: Grid shows one staff and voice
In a part with more than one staff or voice, the Grid SHALL show the staff and voice of the selected note, name it, and let the user choose another. The other voices of that staff SHALL be drawn faintly and SHALL NOT react to touch.

#### Scenario: Left hand in the Grid
- **WHEN** the user selects a note of the left hand and switches to Grid
- **THEN** the Grid shows the left hand of the bar, and says so

#### Scenario: Choose the other hand
- **WHEN** the Grid shows the right hand of a piano bar and the user chooses the left hand
- **THEN** the Grid shows the blocks of the left hand of that bar

### Requirement: Edit notes in Grid
In Grid, the user SHALL be able to add a note by tapping an empty cell, change its pitch by dragging its block up or down, move it by dragging it sideways, change its length by dragging the end of its block, and select it by tapping it. A new note SHALL start at the cell tapped, at that row's pitch, with the length chosen in the Notes tools, or shorter when the next note or the end of the bar comes sooner. A tap in the column where a note starts SHALL add a chord note of that note's length.

#### Scenario: Add a note on beat 3
- **WHEN** a 4/4 bar holds a half note on beat 1, the chosen length is a quarter, and the user taps the cell of G4 at beat 3
- **THEN** the bar holds the half note, a quarter note G4 on beat 3, and a quarter rest on beat 4

#### Scenario: Lengthen by dragging the end
- **WHEN** the user drags the end of a quarter-note block on beat 1 to the end of beat 2, with nothing in its way
- **THEN** the note is a half note

#### Scenario: A chord note
- **WHEN** a half note C4 starts on beat 1 and the user taps the cell of E4 at beat 1
- **THEN** the bar holds a half-note chord C4–E4 on beat 1

### Requirement: Grid keeps the bar in order
A block SHALL NOT be moved or lengthened over another note of the voice or past the end of the bar; it then goes back to where it was. Time without a block is rest: the rests of the voice SHALL follow from the blocks, written as rests of standard lengths. The rows SHALL cover the notes of the bar with room above and below, and SHALL extend when a block is dragged to the top or the bottom.

#### Scenario: Something in the way
- **WHEN** the user drags the end of a block over the start of the next note of the voice
- **THEN** the block goes back to its length, and nothing changes

#### Scenario: Rests follow a move
- **WHEN** a 4/4 bar holds a quarter note on beat 1 and rests, and the user drags its block to beat 2
- **THEN** the bar holds a quarter rest, the quarter note on beat 2, and a half rest

### Requirement: Grid leaves alone what it cannot draw
A triplet, a grace note and any note that does not start and end on a sixteenth of the bar SHALL be drawn in Grid as a locked block that cannot be dragged or resized there. An edit made in Grid SHALL NOT change or remove a locked note, a note of another voice, or any mark, clef, key, time signature or text of the bar. The Grid SHALL say that locked notes are edited in Notes.

#### Scenario: A triplet in the bar
- **WHEN** a bar holds an eighth-note triplet on beat 1 and two quarter notes, and the user drags the block of the last quarter note one step up in Grid
- **THEN** that note is one step higher, and the triplet is unchanged in display and playback

#### Scenario: Try to drag a locked block
- **WHEN** the user drags the block of a triplet note in Grid
- **THEN** it does not move, and the Grid says that triplets are edited in Notes

#### Scenario: Marks stay
- **WHEN** a bar holds a slur over its first two notes and a *p* under the first, and the user lengthens the third note in Grid
- **THEN** the slur and the *p* are still there

### Requirement: A bar always takes a note
A bar SHALL never be in a state where no note can be added to it. A bar without notes SHALL hold a whole-bar rest on each staff, and the first note added to a staff SHALL replace that rest. While the first voice of a staff of the current bar adds up to less than the time signature, Notes SHALL show a slot after its last note or rest as the place for the next note. Grid SHALL accept a note in every empty cell. Deleting the last note of a staff's bar SHALL leave a whole-bar rest.

#### Scenario: Empty a bar and fill it again
- **WHEN** the user deletes every note of bar 3, then taps the staff in the slot with a quarter note chosen
- **THEN** bar 3 holds one quarter note, and the slot for the next note is after it

#### Scenario: Emptied bar is saved
- **WHEN** the user deletes every note of bar 3 and saves
- **THEN** bar 3 is saved with a whole-bar rest, and practice plays it as a silent bar

#### Scenario: Full bar
- **WHEN** a 4/4 bar adds up to four beats
- **THEN** Notes shows no slot in it, and a note can still be added between two notes or inserted before or after a selected note

#### Scenario: A second voice stays as it is
- **WHEN** the second voice of a bar holds one quarter note and nothing else
- **THEN** no rest is added to it, it shows no slot, and it is not flagged

### Requirement: Notes tools
The Notes tools SHALL hold the lengths (whole to sixteenth), dotted, triplet, note or rest, the accidentals, insert before and after, delete, the chord note and the move to the other hand. With a note or rest selected, they SHALL change it. With nothing selected, the length, the dot and the choice of note or rest SHALL set what the next tap on the staff or the grid adds.

#### Scenario: Choose what a tap adds
- **WHEN** nothing is selected, the user chooses the eighth note and Rest, and taps the slot
- **THEN** an eighth rest is added

#### Scenario: Change the selected note
- **WHEN** a quarter note is selected and the user taps the half note in the Notes tools
- **THEN** the selected note becomes a half note, and what a tap adds does not change

### Requirement: Ways to add a mark
With a note selected, tapping a mark in the Marks tools SHALL turn it on or off on that note, and the marks the note has SHALL be shown as active. With nothing selected, tapping a mark SHALL arm it: it is shown as armed, and every note tapped after that gets it or loses it. Tapping the armed mark again, or opening the Notes or Bars tools, SHALL disarm it. While a mark is armed or the Marks or Bars tools are open, a tap on the staff or the grid SHALL NOT add a note.

#### Scenario: Note first
- **WHEN** the user selects a note that has an accent and opens the Marks tools
- **THEN** Accent is shown as active, and tapping Tenuto adds a tenuto to that note

#### Scenario: Paint staccato on a line
- **WHEN** nothing is selected, the user taps Staccato and then taps four notes
- **THEN** all four notes have a staccato dot, and Staccato is still shown as armed

#### Scenario: Stop painting
- **WHEN** Staccato is armed and the user opens the Notes tools
- **THEN** Staccato is no longer armed, and a tap on a note selects it without adding a staccato

#### Scenario: No stray note
- **WHEN** the Marks tools are open and the user taps an empty place on the staff
- **THEN** no note is added

### Requirement: Slide between two notes
In Notes, sliding sideways from one note to another note of the bar SHALL add a slur from the first to the second. When a tie, a crescendo or a diminuendo is armed, the slide SHALL add that instead. With a slur, tie, crescendo or diminuendo armed, tapping its first note and then its last note SHALL add it, also when the last note is in another bar.

#### Scenario: Slide a slur
- **WHEN** the user slides in Notes from the first note of a bar to its third note
- **THEN** a slur joins the first to the third note, and no pitch has changed

#### Scenario: Slide a crescendo
- **WHEN** Cresc. is armed and the user slides from the first note of a bar to its last
- **THEN** a crescendo hairpin runs from the first to the last note

#### Scenario: A slur into the next bar
- **WHEN** Slur is armed, the user taps the last note of bar 2, goes to bar 3 and taps its first note
- **THEN** a slur joins the two notes across the bar line

### Requirement: A mark that waits for its last note
After the first note of a slur, tie, crescendo or diminuendo is tapped, the editor SHALL show, above the large bar, which mark is waiting, the bar it starts in, and a Cancel control. This SHALL stay in view, and the mark SHALL stay armed, while the user goes to another bar in any way, including through the full score. The first note SHALL be marked wherever it is drawn. Tapping the last note SHALL add the mark; Cancel or a second tap on the armed mark SHALL end the waiting without adding it.

#### Scenario: A slur over four bars
- **WHEN** Slur is armed, the user taps the first note of bar 2, taps next three times and taps the last note of bar 5
- **THEN** "Slur from bar 2 · tap the last note" is shown in bars 2, 3, 4 and 5 until the last tap, and a slur then runs from bar 2 to bar 5

#### Scenario: Through the full score
- **WHEN** a slur waits for its last note from bar 2, and the user taps "Full score" and taps bar 12
- **THEN** bar 12 is shown large, the slur is still waiting, and tapping a note of bar 12 ends it there

#### Scenario: Cancel
- **WHEN** a crescendo waits for its last note and the user taps Cancel
- **THEN** no crescendo is added, the notice is gone, and Cresc. is no longer armed

#### Scenario: Last note before the first
- **WHEN** a slur waits from the first note of bar 5 and the user goes back and taps the last note of bar 4
- **THEN** a slur runs from the last note of bar 4 to the first note of bar 5

### Requirement: Slurs and hairpins of the bar
The Marks tools SHALL list every slur, tie, crescendo and diminuendo that begins, ends or passes in the current bar, each with the bars it runs over, a control to remove it, and, when it begins or ends in another bar, controls to go to its first and its last bar. In the large bar, such a mark SHALL be drawn up to the edge of the bar, so the user sees that it goes on.

#### Scenario: A slur from the bar before
- **WHEN** a slur runs from the last note of bar 2 to the first note of bar 3, and bar 3 is the current bar
- **THEN** the Marks tools list "Slur, bars 2 to 3", and removing it there removes the slur from both notes

#### Scenario: Go to the other end
- **WHEN** bar 3 is the current bar, the list shows "Slur, bars 2 to 6", and the user taps its control for the last bar
- **THEN** bar 6 is the current bar, with the last note of the slur marked

#### Scenario: A slur that passes through
- **WHEN** a slur runs from bar 2 to bar 6 and bar 4 is the current bar
- **THEN** the large bar shows the slur running in from the left edge and out at the right edge, and the list shows "Slur, bars 2 to 6"

#### Scenario: Nothing to list
- **WHEN** the current bar has no slur, tie, crescendo or diminuendo
- **THEN** the list is not shown

### Requirement: Loudness marks
The user SHALL be able to put a loudness mark (*pp*, *p*, *mp*, *mf*, *f* or *ff*) on a note, change it and remove it. A note SHALL carry at most one. Playback SHALL follow it from that note on.

#### Scenario: Add a missed piano
- **WHEN** the user selects the first note of bar 5 and taps *p* in the Marks tools
- **THEN** a *p* is drawn under that note, and playback is soft from bar 5 on

#### Scenario: Change a loudness mark
- **WHEN** the selected note has a *p* and the user taps *f*
- **THEN** the note has an *f* and no *p*

#### Scenario: Remove a loudness mark
- **WHEN** the selected note has an *f* and the user taps the active *f*
- **THEN** the note has no loudness mark, and playback keeps the loudness from before it

### Requirement: Loudness strip in Grid
In Grid, a strip under the blocks SHALL show the loudness marks and the crescendos and diminuendos of the bar. Tapping the strip under a note SHALL step that note's mark through *p*, *mf*, *f* and none. Sliding along the strip from a note to a later note SHALL add a crescendo between them; sliding from a note to an earlier note SHALL add a diminuendo between them.

#### Scenario: Tap the strip
- **WHEN** a note has no loudness mark and the user taps the strip under it twice
- **THEN** the note has an *mf*

#### Scenario: Tap the strip under another mark
- **WHEN** a note has an *ff* and the user taps the strip under it
- **THEN** the note has no loudness mark

#### Scenario: Slide forward
- **WHEN** the user slides along the strip from under the first note to under the last note of the bar
- **THEN** a crescendo runs from the first to the last note

#### Scenario: Slide back
- **WHEN** the user slides along the strip from under the last note to under the first note of the bar
- **THEN** a diminuendo runs from the first to the last note

### Requirement: First and second endings
The user SHALL be able to mark the current bar as "1st time only" or "2nd time only", and to remove that mark. Neighbouring bars with the same mark SHALL form one ending, drawn as one bracket with its number. Playback SHALL follow the endings. An ending with other numbers that was read from the page SHALL stay as it is until the user removes it.

#### Scenario: Add a missed first and second ending
- **WHEN** bars 1 to 4 are repeated, the user marks bar 4 as "1st time only" and bar 5 as "2nd time only"
- **THEN** bar 4 has a bracket "1.", bar 5 has a bracket "2.", and playback order is bars 1, 2, 3, 4, 1, 2, 3, 5, then the bars after it

#### Scenario: Two bars in one ending
- **WHEN** bar 3 and bar 4 are both marked "1st time only"
- **THEN** one bracket "1." runs over bars 3 and 4

#### Scenario: Remove a misread ending
- **WHEN** bar 8 was read with a bracket "1." that is not in the book, and the user turns "1st time only" off for bar 8
- **THEN** the bracket is gone, and playback plays bar 8 on every pass

### Requirement: Endings stay in order
When a bar is marked "1st time only" and the last bar of that ending has no end-repeat, the editor SHALL add the end-repeat in the same undo step. A bar SHALL be marked "2nd time only" only when it comes directly after a first ending or after a bar already marked "2nd time only"; otherwise the editor SHALL refuse and say why.

#### Scenario: The end-repeat comes along
- **WHEN** bar 4 ends in a plain bar line and the user marks it as "1st time only"
- **THEN** bar 4 ends in an end-repeat, and one undo removes the bracket and the end-repeat together

#### Scenario: A second ending out of place
- **WHEN** the user marks bar 7 as "2nd time only" and bar 6 is in no ending
- **THEN** nothing changes, and the editor explains that a second ending comes directly after a first ending

### Requirement: Add a bar
The user SHALL be able to add an empty bar before or after the current bar. It SHALL be added in every part, hold a whole-bar rest in each, and become the current bar. The bars after it SHALL be renumbered. The change SHALL be one undo step.

#### Scenario: A missed bar
- **WHEN** the reading skipped a bar between bars 6 and 7, and the user goes to bar 6 and adds a bar after it
- **THEN** the new bar 7 is empty in every part and is the current bar, and the old bar 7 is now bar 8

#### Scenario: A missed first bar
- **WHEN** the user goes to bar 1 and adds a bar before it
- **THEN** the new bar is bar 1, and the old bar 1 is now bar 2

### Requirement: Delete a bar
The user SHALL be able to delete the current bar, in every part, as one undo step. The bar SHALL go with its notes, its marks, its repeat signs and its endings; a slur, tie, crescendo or diminuendo with an end in it SHALL be removed. The bars after it SHALL be renumbered. Delete SHALL NOT be offered for the only bar of the piece or the only bar of a page.

#### Scenario: A bar that is not in the book
- **WHEN** the user deletes bar 4 of a 12-bar piece
- **THEN** the piece has 11 bars in every part, and the old bar 5 is now bar 4

#### Scenario: Delete under a slur
- **WHEN** a slur runs from bar 3 into bar 4 and the user deletes bar 4
- **THEN** the slur is removed, and bar 3 keeps its notes

#### Scenario: Undo a deleted bar
- **WHEN** the user deletes a bar and taps undo
- **THEN** the bar is back with its notes, marks and bar lines, and the bars after it have their old numbers

#### Scenario: The only bar of a page
- **WHEN** page 2 of a piece holds one bar and it is the current bar
- **THEN** Delete bar is not offered

### Requirement: Same as the bar before
The user SHALL be able to make the current bar the same as the bar before it. In the part being edited, its notes and rests SHALL be replaced by a copy of those of the bar before, with their accidentals and note marks and the slurs, ties, crescendos and diminuendos that lie wholly inside that bar. Bar lines, repeat signs, endings, loudness marks and the other parts SHALL NOT change. It SHALL NOT be offered for the first bar.

#### Scenario: Same as the bar before
- **WHEN** bar 2 holds four staccato eighth notes and a half note, bar 3 is empty, and the user taps "Same as bar before" in bar 3
- **THEN** bar 3 holds the same four staccato eighth notes and half note, and the piano part of bar 3 is unchanged

#### Scenario: Bar lines are not copied
- **WHEN** bar 2 ends in an end-repeat and the user makes bar 3 the same as bar 2
- **THEN** bar 3 ends as it did before

### Requirement: Suggested repairs
For a current bar that does not add up, the editor SHALL offer up to four changes that would each make it add up with one tap: changing the length of one note or rest, removing or adding one rest, adding a bar line inside it, or joining it with the next bar. Each SHALL say what it changes, naming the note, and applying one SHALL be one undo step. A change that touches more than one note SHALL NOT be offered. When no single change helps, or the bar adds up, none SHALL be offered.

#### Scenario: A missed dot
- **WHEN** a 4/4 bar holds a quarter note E4, an eighth note and a half note (3½ beats)
- **THEN** the editor offers "E4 → dotted quarter" among its suggestions, and tapping it makes the bar add up to 4 beats

#### Scenario: A missed bar line
- **WHEN** a 3/4 bar holds six quarter notes
- **THEN** the editor offers a bar line after the third note, and tapping it makes two bars of three beats

#### Scenario: Short at the end
- **WHEN** a 4/4 bar holds three quarter notes and nothing else
- **THEN** the editor offers to add a quarter rest at the end

#### Scenario: Nothing simple helps
- **WHEN** a 4/4 bar adds up to 6¼ beats and no single change makes it 4
- **THEN** no suggestion is shown, and the bar stays marked

### Requirement: Line from the photo
Above the overview, the editor SHALL show the printed line of the page photo that holds the current bar, across the width of the screen. Tapping it SHALL open it large, where the user can zoom in and move it, and close it again. When the place of the line on its page is not known, the editor SHALL show the whole page. An added bar SHALL show the line of the bar it was added next to.

#### Scenario: Compare with the book
- **WHEN** bar 6 is the current bar and it was read from the second line of page 1
- **THEN** the editor shows the second line of the photo of page 1 above the overview

#### Scenario: Look closer
- **WHEN** the user taps the photo line and zooms in on a bar
- **THEN** the line is shown large over the editor, zoomed in, until the user closes it

#### Scenario: Position unknown
- **WHEN** the piece has no positions for the lines of page 2 and the current bar is on page 2
- **THEN** the whole photo of page 2 is shown, and it can be opened large

## MODIFIED Requirements

### Requirement: Flags shown for review
The editor SHALL say how many things need checking: bars that don't add up, notes outside the instrument's range, and an inferred time signature. It SHALL mark each one in the overview and on the large bar, and let the user step from one to the next; stepping SHALL make the bar of that warning the current bar. A warning SHALL disappear once it is fixed. Warnings SHALL NOT block practising. A first bar of the piece that adds up to less than the time signature is a pickup and SHALL NOT be flagged; a first bar that adds up to more SHALL be flagged.

#### Scenario: Review flags
- **WHEN** a piece has two notes outside the instrument's range
- **THEN** the editor shows "2 to check", both notes are marked, and the user can jump from the first to the second

#### Scenario: No flags
- **WHEN** a piece has nothing to check
- **THEN** no warning or mark is shown

#### Scenario: Fixed by an edit
- **WHEN** the user moves a marked note into the instrument's range
- **THEN** its mark disappears and the count goes down by one

#### Scenario: Warning on another line
- **WHEN** bar 5 is the current bar and the user steps to a warning about bar 12
- **THEN** bar 12 is the current bar and the overview shows the line that holds it

#### Scenario: Pickup bar
- **WHEN** a 4/4 piece starts with a bar that holds one quarter note
- **THEN** that bar is not flagged, and practice counts it as the last beat before bar 2

### Requirement: Articulation marks
The user SHALL be able to turn staccato, staccatissimo, tenuto, accent, strong accent, fermata, trill, turn, mordent, tremolo, a breath mark and a caesura on and off on a note, and an arpeggio on and off on a chord. A note SHALL carry at most one of trill, turn and mordent. A breath mark and a caesura SHALL come after their note. Slurs and ties SHALL be added by choosing their first and last notes. Tapping an active mark SHALL remove it. How a mark is put on a note is described in "Ways to add a mark" and "Slide between two notes".

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

#### Scenario: Add a missed breath mark
- **WHEN** the user selects the last note of bar 4 and taps Breath
- **THEN** a breath mark is drawn after that note, and playback leaves a short gap before bar 5

### Requirement: Edit bar lines
For the current bar, the user SHALL be able to set how it starts (normal or start-repeat `||:`) and how it ends (normal, double bar line `||`, end-repeat `:||` or end bar line). For an end-repeat, the user SHALL be able to set how many times the section is played in total, from 2 to 8, with 2 as the default. The editor SHALL show the current bar's start and end, and playback SHALL follow the edited signs. For playback, an end bar line SHALL count as a double bar line. Changing how a bar starts or ends SHALL keep an ending that is on it.

#### Scenario: Make a repeat explicit
- **WHEN** an exercise has bar 1 ending in an end-repeat, bar 2 ending in a double bar line, and bar 3 ending in an end-repeat, and the user goes to bar 3 and sets its start to start-repeat
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
- **WHEN** the current bar starts with `||:` and ends with a double bar line
- **THEN** the controls show start-repeat as the bar's start and double bar line as its end

#### Scenario: Endings stay
- **WHEN** the user changes the repeat count of an end-repeat at the end of a first ending
- **THEN** the first ending is still there, and the second ending is still played on the last pass

#### Scenario: Undo a bar-line edit
- **WHEN** the user sets the end of a bar to end-repeat and taps undo
- **THEN** the bar ends as it did before, and playback no longer repeats there

#### Scenario: Close the piece
- **WHEN** the last bar of a piece was read with a plain bar line, and the user sets its end to end bar line
- **THEN** the last bar is drawn with a thin and a thick line

### Requirement: Add a bar line
The user SHALL be able to add a bar line before a note or rest, splitting its bar in two in every part. With the Bars tools open, every place between two notes where a bar line can be added SHALL show a scissors mark, in Notes between the notes and in Grid above the grid; tapping one SHALL add the bar line there. A rest that crosses the new bar line SHALL be split with it. When a note in any part sounds across it, or it would fall inside a triplet, the bar line SHALL NOT be added, and the editor SHALL say where. The bars after it SHALL be renumbered. The change SHALL be one undo step.

#### Scenario: A missed bar line
- **WHEN** bar 6 of a 3/4 melody was read with six quarter notes because a bar line was missed, and the user opens the Bars tools and taps the scissors between the third and the fourth note
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
- **WHEN** the Bars tools are open
- **THEN** there is no scissors mark before the first note of the bar

### Requirement: Remove a bar line
The user SHALL be able to remove the bar line at the end of the current bar with "Join with next", joining it with the next bar in every part. The joined bar SHALL keep how the first bar starts and how the second ends. The bar line SHALL NOT be removed after the last bar, at the end of a printed line or page, or when the next bar starts with a clef, key or time signature change or an ending; the editor SHALL say why. The bars after it SHALL be renumbered. The change SHALL be one undo step.

#### Scenario: An extra bar line
- **WHEN** bar 3 of a 4/4 piece was read as two bars of two beats each, bars 3 and 4, and the user goes to bar 3 and taps "Join with next"
- **THEN** bar 3 holds the notes of both and adds up to four beats, and the old bar 5 is now bar 4

#### Scenario: From the bar line itself
- **WHEN** the user taps the bar line at the end of bar 3
- **THEN** bar 3 is the current bar, and the Bars tools are open with "Join with next" and its bar-line controls

#### Scenario: Two rests become one
- **WHEN** the piano part has a whole-bar rest in both bars that are joined
- **THEN** the piano part has one whole-bar rest in the joined bar

#### Scenario: A clef change in the way
- **WHEN** the next bar starts with a clef change and the user taps "Join with next"
- **THEN** nothing changes, and the editor explains that the clef change must be deleted first

#### Scenario: The end of a printed line
- **WHEN** the current bar is the last bar of a line in the photo of the page
- **THEN** "Join with next" is not offered

### Requirement: Bar numbers follow a bar-line change
When a piece is saved after bar lines or bars were added or removed, the piece's number of bars, the bars of each page and of each line in its photos, and the practice position and loop SHALL follow the new numbering, so they hold the same music as before. An added bar SHALL belong to the page and the printed line of the bar it was added next to. A practice position on a deleted bar SHALL move to the bar that follows it, or to the last bar when none follows. A loop SHALL lose the deleted bars it held, and a loop that held only deleted bars SHALL be cleared. A printed line whose bars were all deleted SHALL hold no bars any more.

#### Scenario: A loop after the change
- **WHEN** the loop is bars 9 to 12, and the user adds a bar line in bar 6 and saves
- **THEN** the loop is bars 10 to 13, over the same music

#### Scenario: A loop around the change
- **WHEN** the loop is bars 5 to 8, and the user adds a bar line in bar 6 and saves
- **THEN** the loop is bars 5 to 9

#### Scenario: The photo of the line
- **WHEN** the user added a bar line in bar 6, saved, and goes to the new bar 7
- **THEN** the photo shows the line of the page that held the old bar 6

#### Scenario: A loop over a deleted bar
- **WHEN** the loop is bars 5 to 8, and the user deletes bar 6 and saves
- **THEN** the loop is bars 5 to 7, over the music that is left

#### Scenario: A loop that is gone
- **WHEN** the loop is bar 6 only, and the user deletes bar 6 and saves
- **THEN** practice has no loop

#### Scenario: An added bar and its page
- **WHEN** page 1 holds bars 1 to 8 and page 2 bars 9 to 16, and the user adds a bar after bar 8 and saves
- **THEN** page 1 holds bars 1 to 9 and page 2 bars 10 to 17

## REMOVED Requirements

### Requirement: One line while editing
**Reason**: The editor now works on one bar at a time, shown large, with its line as a small overview that is always in view. It no longer starts on the whole sheet and shrinks to a line on a tap. The whole sheet stays available on request (see "Full score").
**Migration**: None for stored data. To look for another spot, the user taps "Full score" and a bar, steps bar by bar, taps a bar in the overview, or steps through the warnings (see "Go to another bar").
