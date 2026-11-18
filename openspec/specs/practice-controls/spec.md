# practice-controls Specification

## Purpose

Gives the user control over how a piece is played back, so it can be practised slowly, in parts, with a metronome and from any point, and picks up where the user left off.

## Requirements

### Requirement: Play and pause
The user SHALL be able to start, pause and resume playback. Resuming SHALL continue from the paused position.

#### Scenario: Pause and resume
- **WHEN** the user pauses in bar 5 and presses play again
- **THEN** playback continues from where it was paused in bar 5

### Requirement: Free tempo control
The user SHALL be able to set any tempo from 30 to 200 beats per minute. Changing the tempo SHALL NOT change the pitch, and a change during playback SHALL take effect without restarting from the beginning.

#### Scenario: Slow down
- **WHEN** the user sets the tempo of a Moderato exercise to 50 beats per minute
- **THEN** it plays at 50 beats per minute at the same pitch

#### Scenario: Change while playing
- **WHEN** the user changes the tempo during playback in bar 6
- **THEN** playback continues from the current note at the new tempo

#### Scenario: Hold to change quickly
- **WHEN** the user holds the Faster or Slower button down
- **THEN** the tempo keeps changing by one beat per minute, faster the longer the button is held, until the button is let go or the end of the range is reached

### Requirement: Default and remembered tempo
A piece SHALL start at the tempo given by its metronome mark, or else a typical tempo for its tempo word (for example Moderato), or else 80 beats per minute. Tempo markings come from the user (score-editing), since recognition does not read them. The tempo the user last chose for a piece SHALL be remembered for that piece.

#### Scenario: No marking
- **WHEN** a newly added piece without a tempo marking is opened for the first time
- **THEN** its tempo is 80 beats per minute

#### Scenario: Tempo word entered
- **WHEN** the user has set the piece's tempo marking to Moderato and has not chosen a tempo yet
- **THEN** its tempo is set to a typical Moderato value

#### Scenario: Remembered tempo
- **WHEN** the user set a piece to 60 beats per minute and reopens it later
- **THEN** its tempo is 60 beats per minute

### Requirement: Count-in
The user SHALL be able to switch a count-in on or off in Settings. It is one general setting, not a setting of a piece: it SHALL apply to every piece and SHALL be kept after a restart. When on, playback SHALL begin with one bar of audible beats at the current tempo and time signature, shown as a visible count.

#### Scenario: Count-in in 3/4
- **WHEN** count-in is on and the user starts a 3/4 piece
- **THEN** three clicks are heard and counted 1, 2, 3 before the first note

#### Scenario: One switch for every piece
- **WHEN** the user switches the count-in on in Settings and then practises "Ode to Joy" and another piece
- **THEN** both pieces count in

### Requirement: Loop a range of bars
The user SHALL be able to choose a first and a last bar and have playback repeat that range until stopped. Between repeats the user SHALL be able to choose no rest, a rest of one bar or a rest of two bars; the default SHALL be no rest. A count-in, when on, SHALL play only before the first pass.

#### Scenario: Loop bars 9 to 12
- **WHEN** the user loops bars 9–12 with no rest and presses play
- **THEN** bars 9–12 play repeatedly, without a gap between passes, until the user stops

#### Scenario: One bar of rest between repeats
- **WHEN** the user loops bars 2–3 of a 4/4 piece with a rest of one bar at 60 beats per minute
- **THEN** after each pass there are four seconds of silence (or metronome clicks only, when the metronome is on) before bar 2 starts again

#### Scenario: Clear the loop
- **WHEN** the user switches the loop off
- **THEN** playback runs through the whole piece again

### Requirement: Tap to start from a note
The user SHALL be able to tap a note to move the playback position to that note.

#### Scenario: Jump while stopped
- **WHEN** playback is stopped and the user taps the first note of bar 9
- **THEN** pressing play starts from that note

#### Scenario: Jump while playing
- **WHEN** playback is running and the user taps a note in bar 3
- **THEN** playback continues from that note

### Requirement: Metronome
The user SHALL be able to switch a metronome on or off, also during playback. When on, a click SHALL sound on every beat of the time signature, in time with the music and at the current tempo, with the first beat of each bar accented.

#### Scenario: Metronome in 3/4
- **WHEN** the metronome is on and a 3/4 piece plays
- **THEN** three clicks sound in every bar, the first one accented, in time with the notes

#### Scenario: Switch on while playing
- **WHEN** the user switches the metronome on during playback
- **THEN** clicks start from the next beat, without interrupting the music

### Requirement: Restart
The user SHALL be able to restart. Restarting SHALL go to the first bar of the loop when a loop is on, and to the first bar of the piece otherwise. If the piece was playing, it SHALL keep playing from there.

#### Scenario: Restart a loop
- **WHEN** bars 9–12 are looping, the music is in bar 11, and the user taps Restart
- **THEN** playback continues from the start of bar 9

### Requirement: Show a bar without interrupting
The user SHALL be able to scroll the score to bring another bar into view while the music plays. Showing a bar SHALL NOT move or stop the playback. The user SHALL be able to return the view to the playing bar.

#### Scenario: Look at bar 7 while playing
- **WHEN** the piece is playing in bar 2 and the user scrolls the score to bar 7
- **THEN** bar 7 is in view, the music keeps playing from bar 2, and "Return to playing" brings the view back to the playing bar

### Requirement: Practice settings remembered
For each piece, the app SHALL remember:
- the bar the user was at;
- the tempo;
- the loop and its rest;
- metronome on or off.

Opening the piece again SHALL restore them. The instrument and the count-in are general settings, not remembered per piece.

#### Scenario: Reopen a piece
- **WHEN** the user left a piece in bar 10, with bars 9–12 looping with a rest of one bar and the metronome on, and opens it the next day
- **THEN** it opens at bar 10 with that loop, rest and metronome
