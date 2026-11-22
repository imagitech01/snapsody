# score-playback Specification

## Purpose

Lets the user see the piece as one continuous score and hear how it should sound on the chosen instrument, with a cursor showing which note is playing.

## Requirements

### Requirement: Score display
The app SHALL display the piece as engraved sheet music in written (transposed) pitch, as it appears in the book. A piece of several pages SHALL be shown as one continuous score, without page breaks or page separators. It SHALL be readable on a phone screen in portrait and in landscape. A multi-measure rest SHALL be drawn as one symbol with its number of bars, and the cursor SHALL stay on it while those bars play.

#### Scenario: Open an exercise
- **WHEN** the user opens a saved piece
- **THEN** the score is shown with clef, key signature, time signature, notes, articulations, ornaments and bar lines

#### Scenario: Two pages as one score
- **WHEN** the user opens a piece read from two pages
- **THEN** its bars run on continuously, with no page break or page label between them

#### Scenario: Eighth notes are beamed by beat
- **WHEN** a bar contains consecutive eighth notes or shorter within one beat
- **THEN** they are shown joined by beams, as in the book, even when the recognition gives no beam information, and the saved exercise files are not changed

#### Scenario: Multi-measure rest in practice
- **WHEN** a piece with a multi-measure rest of 4 bars is played
- **THEN** the rest is drawn as one symbol with the number 4, it stays highlighted for all four bars, and the music after it starts after four bars

### Requirement: Articulation in playback
Playback SHALL:
- connect notes under a slur without a new attack;
- shorten staccato notes clearly;
- hold tenuto notes for their full value;
- play accented notes with a stronger attack;
- hold a note under a fermata about twice its written length;
- join tied notes into one sound;
- leave a short gap at breath marks.

#### Scenario: Slur then staccato
- **WHEN** a triplet with a slur over notes 1–2 and a staccato on note 3 is played
- **THEN** notes 1 and 2 sound connected, and note 3 starts with a new attack and is clearly shorter than its written value

#### Scenario: Tie
- **WHEN** two tied notes of the same pitch are played
- **THEN** they sound as one continuous note

#### Scenario: Accent
- **WHEN** an accented note follows an unaccented note at the same dynamic
- **THEN** the accented note starts clearly louder

#### Scenario: Fermata
- **WHEN** a quarter note with a fermata is played at 60 beats per minute
- **THEN** it sounds for about two seconds, and the next note follows after it

### Requirement: Dynamics in playback
Playback SHALL play louder or softer according to printed dynamic marks (at least *p*, *mp*, *mf*, *f*), and at *mf* when none is present. Under a crescendo or diminuendo, the loudness SHALL change gradually from the start to the end of the hairpin.

#### Scenario: Forte section
- **WHEN** a piece starts at *mf* and later has *f*
- **THEN** the notes after *f* sound louder than those before

#### Scenario: Crescendo
- **WHEN** a crescendo runs over four notes
- **THEN** each of the four notes sounds louder than the one before

### Requirement: Repeats followed
Playback SHALL follow repeat signs and first/second endings in the order a player would. An end-repeat sign SHALL send playback back to the last start-repeat sign. Without one, it goes back to the last double bar line, or else to the beginning. An end-repeat sign is never a place to go back to. A section SHALL be played twice unless a number of times is given. D.C., D.S., Coda and Fine instructions are outside this change and SHALL be played straight through.

#### Scenario: Simple repeat
- **WHEN** an exercise has bars 1–2, an end-repeat sign, then bar 3
- **THEN** playback order is bars 1, 2, 1, 2, 3

#### Scenario: End-repeat after a double bar line
- **WHEN** an exercise has bar 1 with an end-repeat sign, bar 2, a double bar line, then bar 3 with an end-repeat sign and bar 4, and no start-repeat signs
- **THEN** playback order is bars 1, 1, 2, 3, 3, 4

#### Scenario: Two end-repeats without start-repeat signs
- **WHEN** an exercise has bar 1 with an end-repeat sign, bar 2 with an end-repeat sign, then bar 3, and no start-repeat signs or double bar lines
- **THEN** playback order is bars 1, 1, 2, 1, 2, 3

#### Scenario: First and second endings
- **WHEN** an exercise has a repeated section with a first and a second ending
- **THEN** the first ending is played the first time and the second ending the second time

### Requirement: Cursor follows playback
During playback the app SHALL highlight the notes of the user's part and the bar currently sounding, in time with the audio, and SHALL scroll so the current bar stays visible. When the user's part has two staves or two voices, every note of it that is sounding SHALL be highlighted. Following is not a setting: it SHALL always be on, except while the user has scrolled away. Then the music SHALL keep playing and the view SHALL stay where the user put it until the user returns to the playing bar.

#### Scenario: Highlight in sync
- **WHEN** the piece is playing
- **THEN** the highlighted note and bar change when the heard note changes, with no visible lag

#### Scenario: Next line
- **WHEN** the user has not scrolled away and playback moves to a line that is off screen
- **THEN** the view scrolls to show it

#### Scenario: Look ahead while playing
- **WHEN** the piece is playing in bar 2 and the user scrolls to bar 9
- **THEN** the music keeps playing, the view stays at bar 9, and a "Return to playing" action brings the view back to the playing bar and resumes following

#### Scenario: Both hands highlighted
- **WHEN** the right hand plays quarter notes over a whole note in the left hand
- **THEN** each right-hand quarter note is highlighted in turn, and the left-hand whole note stays highlighted for the whole bar

### Requirement: Playback reflects edits
Playback SHALL always use the exercise's current, corrected score.

#### Scenario: Play after correcting
- **WHEN** the user corrects a note and presses play
- **THEN** the corrected note is heard

### Requirement: Ornaments in playback
Every ornament that is drawn SHALL also be heard. A trill SHALL alternate with the note above it in the key, starting on the written note. A turn or mordent SHALL play its notes quickly at the start of its note, which then holds. A tremolo SHALL repeat its note, or alternate between the two notes of a two-note tremolo. Ornament notes SHALL keep the beat: the next written note SHALL start on time.

#### Scenario: Trill in G major
- **WHEN** a quarter note A4 with a trill is played in G major
- **THEN** it alternates between A4 and B4, starting on A4, for the length of the quarter note, and the next note starts on its beat

#### Scenario: Trill under a key's sharp
- **WHEN** a quarter note E5 with a trill is played in G major
- **THEN** it alternates between E5 and F♯5

#### Scenario: Turn
- **WHEN** a half note D5 with a turn is played in C major
- **THEN** E5, D5, C5 sound quickly at the start of the note and D5 is held for the rest of the half note

#### Scenario: Mordent
- **WHEN** a quarter note G4 with a mordent is played in C major
- **THEN** G4, F4 sound quickly and G4 is held for the rest of the quarter note

#### Scenario: Two-note tremolo
- **WHEN** a two-note tremolo between C5 and E5 is played
- **THEN** C5 and E5 alternate quickly for the length of the tremolo

### Requirement: Grace notes in playback
A grace note SHALL sound shortly before the beat of the note it belongs to, and that note SHALL still start on its beat.

#### Scenario: Grace note before the beat
- **WHEN** a grace note D5 comes before a quarter note C5 on beat 2
- **THEN** the D5 sounds shortly before beat 2, and the C5 starts exactly on beat 2

### Requirement: Chord marks in playback
An arpeggio SHALL roll its chord from the lowest note up, all notes held to the end of the chord. A fermata on any note of a chord SHALL hold the whole chord.

#### Scenario: Arpeggio
- **WHEN** a chord C4–E4–G4 with an arpeggio is played
- **THEN** C4 sounds on the beat, then E4 and then G4 enter shortly after, and all three are held to the end of the chord

#### Scenario: Fermata on the top note of a chord
- **WHEN** a quarter-note chord with a fermata on its top note is played at 60 beats per minute
- **THEN** the whole chord sounds for about two seconds, and the next note follows after it

### Requirement: Stronger and shorter marks in playback
A strong accent SHALL be played louder than an accent. Staccatissimo SHALL be shorter than staccato. A caesura SHALL leave a short silence before the next note, which still starts on its beat.

#### Scenario: Strong accent
- **WHEN** a note with a strong accent follows a note with an accent at the same dynamic
- **THEN** the note with the strong accent starts louder than the accented note

#### Scenario: Staccatissimo
- **WHEN** a quarter note with staccatissimo follows a quarter note with staccato
- **THEN** the staccatissimo note sounds shorter than the staccato note

#### Scenario: Caesura
- **WHEN** a quarter note with a caesura is followed by another note
- **THEN** a short silence is heard between the two notes, and the second note starts on its beat

### Requirement: Only your part is drawn
In practice, the app SHALL draw only the user's part. A part with two staves SHALL be drawn with both. When the user plays one hand of a two-staff part, the other staff SHALL be drawn faded. Other parts SHALL NOT be drawn.

#### Scenario: Melody with piano
- **WHEN** the user plays the melody of a melody-and-piano piece
- **THEN** only the melody staff is drawn

#### Scenario: Both hands
- **WHEN** the user plays the piano part with both hands
- **THEN** both piano staves are drawn, joined by a brace, as a grand staff

#### Scenario: Left hand only
- **WHEN** the user plays the left hand of the piano part
- **THEN** both staves are drawn, and the right-hand staff is faded

### Requirement: Other parts play along
Playback SHALL play every kept part that is switched on to play along, together with the user's part and in time with it. The user's part and every other one-staff part SHALL sound with the piece's instrument. A two-staff part SHALL sound as piano. Tempo, count-in, metronome, fermatas and repeats SHALL apply to all parts alike.

#### Scenario: Melody with piano
- **WHEN** the user plays the tenor-sax melody and the piano part plays along
- **THEN** the piano is heard with the melody, both in time, and the piano sounds at written pitch while the melody sounds a major ninth lower

#### Scenario: Fermata in one part
- **WHEN** only the melody has a fermata on beat 3 of bar 8
- **THEN** the piano holds there too and both parts go on together after it

#### Scenario: Repeat
- **WHEN** a piece with a melody and a piano part repeats bars 1 to 4
- **THEN** both parts play bars 1 to 4 twice

#### Scenario: Left hand plays along
- **WHEN** the user plays the right hand of the piano part
- **THEN** the left hand is heard as piano, with the user's line
