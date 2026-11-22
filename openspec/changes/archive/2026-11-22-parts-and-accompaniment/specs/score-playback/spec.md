## ADDED Requirements

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

## MODIFIED Requirements

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
