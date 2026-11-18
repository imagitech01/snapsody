# Spec Delta

## Purpose

Gives the user control over how an exercise is played back, so it can be practised slowly, in parts and from any point.

## ADDED Requirements

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

### Requirement: Default and remembered tempo
An exercise SHALL start at the tempo given by its metronome mark, or else a typical tempo for its tempo word (for example Moderato), or else 80 beats per minute. Tempo markings come from the user (score-editing), since recognition does not read them. The tempo the user last chose for an exercise SHALL be remembered for that exercise.

#### Scenario: No marking
- **WHEN** a freshly recognised exercise without a tempo marking is opened for the first time
- **THEN** its tempo is 80 beats per minute

#### Scenario: Tempo word entered
- **WHEN** the user has set the exercise's tempo marking to Moderato and has not chosen a tempo yet
- **THEN** its tempo is set to a typical Moderato value

#### Scenario: Remembered tempo
- **WHEN** the user set exercise 87 to 60 beats per minute and reopens it later
- **THEN** its tempo is 60 beats per minute

### Requirement: Count-in
The user SHALL be able to switch a count-in on or off. When on, playback SHALL begin with one bar of audible beats at the current tempo and time signature, shown as a visible count.

#### Scenario: Count-in in 3/4
- **WHEN** count-in is on and the user starts a 3/4 exercise
- **THEN** three clicks are heard and counted 1, 2, 3 before the first note

### Requirement: Loop a range of bars
The user SHALL be able to select a start bar and an end bar and have playback repeat that range until stopped. A count-in, when on, SHALL play only before the first pass.

#### Scenario: Loop bars 9 to 12
- **WHEN** the user selects bars 9–12 to loop and presses play
- **THEN** bars 9–12 play repeatedly, without a gap between passes, until the user stops

#### Scenario: Clear the loop
- **WHEN** the user clears the loop selection
- **THEN** playback runs through the whole exercise again

### Requirement: Tap to start from a note
The user SHALL be able to tap a note to move the playback position to that note.

#### Scenario: Jump while stopped
- **WHEN** playback is stopped and the user taps the first note of bar 9
- **THEN** pressing play starts from that note

#### Scenario: Jump while playing
- **WHEN** playback is running and the user taps a note in bar 3
- **THEN** playback continues from that note
