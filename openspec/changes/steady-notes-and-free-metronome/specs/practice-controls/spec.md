# Spec Delta

## MODIFIED Requirements

### Requirement: Metronome
The user SHALL be able to switch a metronome on or off, also during playback. When on, a click SHALL sound on every beat of the time signature, in time with the music and at the current tempo, with the first beat of each bar accented.

The metronome SHALL also work on its own. Switching it on while the piece is not playing SHALL start the clicks at once, at the current tempo and in the time signature of the bar the piece would start from, and they SHALL follow a tempo change. Switching it off SHALL stop them. Starting the piece SHALL end the clicks on their own and continue them in time with the music. Opening a piece whose metronome was left on SHALL NOT start clicks by itself. Leaving the practice screen SHALL stop the clicks.

#### Scenario: Metronome in 3/4
- **WHEN** the metronome is on and a 3/4 piece plays
- **THEN** three clicks sound in every bar, the first one accented, in time with the notes

#### Scenario: Switch on while playing
- **WHEN** the user switches the metronome on during playback
- **THEN** clicks start from the next beat, without interrupting the music

#### Scenario: Metronome without the music
- **WHEN** a 4/4 piece is stopped at 80 beats per minute and the user switches the metronome on
- **THEN** clicks sound at 80 beats per minute, every fourth one accented, and no notes are played

#### Scenario: Change the tempo of the metronome on its own
- **WHEN** the metronome clicks on its own at 80 and the user sets the tempo to 100
- **THEN** the clicks continue at 100 beats per minute

#### Scenario: Play takes over
- **WHEN** the metronome clicks on its own and the user presses Play
- **THEN** the piece starts as it otherwise would, and every click from then on is in time with the music

#### Scenario: Reopen with the metronome on
- **WHEN** the user opens a piece that was left with the metronome on
- **THEN** the metronome shows as on and nothing sounds until the user presses Play or switches the metronome off and on
