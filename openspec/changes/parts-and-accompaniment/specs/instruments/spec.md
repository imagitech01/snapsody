## ADDED Requirements

### Requirement: Piano parts sound as piano
A part with two staves SHALL always sound as piano, at written pitch, whatever instrument the piece uses. Its written range SHALL be the piano's.

#### Scenario: Piano accompaniment of a sax piece
- **WHEN** a piece with a melody and a piano part plays with the tenor saxophone
- **THEN** the melody sounds as tenor saxophone, a major ninth lower, and the piano part sounds as piano at written pitch

#### Scenario: Playing the piano part
- **WHEN** the user's part is the piano part and the piece's instrument is the clarinet
- **THEN** the piano part sounds as piano, and only the melody sounds as clarinet

## MODIFIED Requirements

### Requirement: Instrument choice
The app SHALL offer at least these instruments: tenor saxophone, alto saxophone, B♭ clarinet, piano and guitar. Every instrument SHALL play the notes of the part it is given, chords and several voices included.

#### Scenario: Instrument list
- **WHEN** the user opens the default-instrument setting
- **THEN** tenor saxophone, alto saxophone, B♭ clarinet, piano and guitar are offered, each with its family and sound

#### Scenario: Chords on the guitar
- **WHEN** a one-staff part with chords plays with the guitar
- **THEN** every note of each chord sounds, an octave lower than written

### Requirement: Default instrument
The user SHALL choose a default instrument in Settings. Every piece without an instrument of its own SHALL play with it. Until the user chooses, the default SHALL be the tenor saxophone.

#### Scenario: Change the default
- **WHEN** the user sets the default instrument to clarinet
- **THEN** every piece without an instrument of its own plays with the clarinet when it is opened afterwards

#### Scenario: A piece with its own instrument
- **WHEN** a piece is set to alto saxophone and the user changes the default to clarinet
- **THEN** that piece still plays with the alto saxophone
