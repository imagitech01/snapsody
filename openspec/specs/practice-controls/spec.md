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
