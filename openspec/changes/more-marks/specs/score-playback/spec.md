## ADDED Requirements

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

## MODIFIED Requirements

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
