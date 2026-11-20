## ADDED Requirements

### Requirement: Your part
In a piece with more than one kept part, or with a two-staff part, the user SHALL be able to choose their part in Practice tools, under *Your part*. A two-staff part SHALL offer both hands, the right hand and the left hand. Below the choice, under *Plays along*, every other part SHALL have its own switch, on by default. When the user takes one hand, the other hand SHALL be listed there too. One-line pieces SHALL NOT show this row.

#### Scenario: Switch to the piano
- **WHEN** the user plays the melody of a melody-and-piano piece and chooses *Piano* under *Your part*
- **THEN** the piano part is drawn, the cursor follows it, and the melody is listed under *Plays along*

#### Scenario: Practise without the accompaniment
- **WHEN** the user switches the piano off under *Plays along*
- **THEN** only the user's own line is heard

#### Scenario: One-line piece
- **WHEN** the user opens Practice tools for a one-line exercise
- **THEN** there is no *Your part* row

### Requirement: Your line on or off
Next to the metronome, practice SHALL show a card for the user's part, which turns the sound of the user's own line on or off with one tap, also during playback. It SHALL be on by default. When off, the cursor SHALL still follow the user's part, and the parts that play along SHALL still be heard. The card SHALL be shown only in pieces with the *Your part* row.

#### Scenario: Play it yourself
- **WHEN** a melody-and-piano piece is playing and the user taps the melody card
- **THEN** the melody is no longer heard, the piano goes on, and the cursor keeps following the melody

#### Scenario: Hear it again
- **WHEN** the user taps the card again
- **THEN** the melody is heard again from the next note

### Requirement: Parts hint
The first time a piece with the *Your part* row is opened for practice, the app SHALL show a short hint that names the parts and points to *Your part* in Practice tools. It SHALL NOT be shown again for that piece.

#### Scenario: First practice of a piano piece
- **WHEN** a piano piece is opened for practice for the first time
- **THEN** a hint says that the user can take one hand in Practice tools, and the app plays the other

#### Scenario: Second time
- **WHEN** the same piece is opened again
- **THEN** no hint is shown

### Requirement: Instrument for this piece
In Practice tools, the user SHALL be able to choose the instrument of the piece, under *Instrument for this piece*. Until the user chooses, it SHALL be the default instrument from Settings, and it SHALL follow that default when it changes. The user's part and every other one-staff part SHALL play with it. A piece without a one-staff part SHALL NOT show this row.

#### Scenario: A clarinet piece in a sax player's library
- **WHEN** the default instrument is tenor saxophone and the user sets one piece to clarinet
- **THEN** that piece plays with the clarinet, and the other pieces still play with the tenor saxophone

#### Scenario: Default changed later
- **WHEN** a piece has no instrument of its own and the user changes the default to alto saxophone
- **THEN** that piece plays with the alto saxophone

#### Scenario: Piano only
- **WHEN** the user opens Practice tools for a piece that has only a piano part
- **THEN** there is no *Instrument for this piece* row

## MODIFIED Requirements

### Requirement: Practice settings remembered
For each piece, the app SHALL remember:
- the bar the user was at;
- the tempo;
- the loop and its rest;
- metronome on or off;
- the user's part, and which other parts play along;
- whether the user's own line is heard;
- the piece's own instrument, once chosen.

Opening the piece again SHALL restore them. The default instrument and the count-in are general settings, not remembered per piece.

#### Scenario: Reopen a piece
- **WHEN** the user left a piece in bar 10, with bars 9–12 looping with a rest of one bar and the metronome on, and opens it the next day
- **THEN** it opens at bar 10 with that loop, rest and metronome

#### Scenario: Reopen a piano piece
- **WHEN** the user left a melody-and-piano piece with the left hand as their part, the melody switched off, their own line off and the instrument set to clarinet, and opens it again
- **THEN** it opens with the left hand as their part, the melody off, their own line off and the clarinet as its instrument
