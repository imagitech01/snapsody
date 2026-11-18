# score-playback Specification

## Purpose

Lets the user see the piece as one continuous score and hear how it should sound on the chosen instrument, with a cursor showing which note is playing.

## Requirements

### Requirement: Score display
The app SHALL display the piece as engraved sheet music in written (transposed) pitch, as it appears in the book. A piece of several pages SHALL be shown as one continuous score, without page breaks or page separators. It SHALL be readable on a phone screen in portrait and in landscape.

#### Scenario: Open an exercise
- **WHEN** the user opens a saved piece
- **THEN** the score is shown with clef, key signature, time signature, notes, articulations and bar lines

#### Scenario: Two pages as one score
- **WHEN** the user opens a piece read from two pages
- **THEN** its bars run on continuously, with no page break or page label between them

#### Scenario: Eighth notes are beamed by beat
- **WHEN** a bar contains consecutive eighth notes or shorter within one beat
- **THEN** they are shown joined by beams, as in the book, even when the recognition gives no beam information, and the saved exercise files are not changed

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
Playback SHALL follow repeat signs and first/second endings in the order a player would. D.C., D.S., Coda and Fine instructions are outside this change and SHALL be played straight through.

#### Scenario: Simple repeat
- **WHEN** an exercise has bars 1–2, an end-repeat sign, then bar 3
- **THEN** playback order is bars 1, 2, 1, 2, 3

#### Scenario: First and second endings
- **WHEN** an exercise has a repeated section with a first and a second ending
- **THEN** the first ending is played the first time and the second ending the second time

### Requirement: Cursor follows playback
During playback the app SHALL highlight the note and the bar currently sounding, in time with the audio, and SHALL scroll so the current bar stays visible. Following is not a setting: it SHALL always be on, except while the user has scrolled away. Then the music SHALL keep playing and the view SHALL stay where the user put it until the user returns to the playing bar.

#### Scenario: Highlight in sync
- **WHEN** the piece is playing
- **THEN** the highlighted note and bar change when the heard note changes, with no visible lag

#### Scenario: Next line
- **WHEN** the user has not scrolled away and playback moves to a line that is off screen
- **THEN** the view scrolls to show it

#### Scenario: Look ahead while playing
- **WHEN** the piece is playing in bar 2 and the user scrolls to bar 9
- **THEN** the music keeps playing, the view stays at bar 9, and a "Return to playing" action brings the view back to the playing bar and resumes following

### Requirement: Playback reflects edits
Playback SHALL always use the exercise's current, corrected score.

#### Scenario: Play after correcting
- **WHEN** the user corrects a note and presses play
- **THEN** the corrected note is heard
