# Spec Delta

## Purpose

The instruments a piece can be played with. Each has its own sound, transposition and written range. The user chooses one instrument for every piece in Settings, so the playback sounds like what they will play.

## ADDED Requirements

### Requirement: Instrument choice
The app SHALL offer at least these instruments: tenor saxophone, alto saxophone, B♭ clarinet, piano and guitar. Every instrument SHALL play the piece's single melodic line. Chords and several voices are not supported.

#### Scenario: Instrument list
- **WHEN** the user opens the default-instrument setting
- **THEN** tenor saxophone, alto saxophone, B♭ clarinet, piano and guitar are offered, each with its family and sound

### Requirement: Transposition per instrument
Playback SHALL sound each written note at the instrument's transposition:
- tenor saxophone: a major ninth lower;
- alto saxophone: a major sixth lower;
- B♭ clarinet: a major second lower;
- guitar: an octave lower;
- piano: as written.

#### Scenario: Written G on a tenor saxophone
- **WHEN** a written G4 is played with the tenor saxophone
- **THEN** the sound is concert F3

#### Scenario: Written G on an alto saxophone
- **WHEN** a written G4 is played with the alto saxophone
- **THEN** the sound is concert B♭3

#### Scenario: Written G on a piano
- **WHEN** a written G4 is played with the piano
- **THEN** the sound is concert G4

### Requirement: Written notes are never transposed
The app SHALL never change the written notes for an instrument: not when reading a page, and not when the default instrument changes. The user plays the piece as printed. Only the sound and its transposition follow the instrument.

#### Scenario: Switch to piano
- **WHEN** a piece printed for tenor saxophone is practised with the piano
- **THEN** the score looks the same and the piano plays the written notes as written

#### Scenario: Alto and tenor play the same page
- **WHEN** the same piece is played with the alto saxophone and then with the tenor saxophone
- **THEN** the score is identical both times, and a written G4 sounds as B♭3 on the alto and as F3 on the tenor

### Requirement: Recorded instrument sounds
Each instrument SHALL play with a recorded sound of that instrument, bundled with the app and working offline. Each sound's licence SHALL allow redistribution in a free, open-source app. The app SHALL credit each sound's source and licence.

#### Scenario: Play offline
- **WHEN** the phone is in airplane mode and a piece is played with the clarinet
- **THEN** it plays with the clarinet sound

#### Scenario: Credits
- **WHEN** the user opens the app's credits from Settings
- **THEN** the source and licence of the instrument sounds are listed

### Requirement: Written range per instrument
Each instrument SHALL have a written range, used to warn about notes it cannot play. The tenor and alto saxophones' written range SHALL be B♭3 to F♯6.

#### Scenario: Range follows the instrument
- **WHEN** a piece contains a written A3 and is practised with the tenor saxophone
- **THEN** the A3 is reported as outside the instrument's range

### Requirement: Default instrument
The user SHALL choose a default instrument in Settings. Every piece SHALL play with it. Until the user chooses, the default SHALL be the tenor saxophone.

#### Scenario: Change the default
- **WHEN** the user sets the default instrument to clarinet
- **THEN** every piece opened afterwards plays with the clarinet

### Requirement: Pitch reference
All instrument playback SHALL be tuned to A4 = 440 Hz. The pitch reference is not a setting.

#### Scenario: A4 at 440
- **WHEN** a written note that sounds as A4 is played with any instrument
- **THEN** the sound is at 440 Hz
