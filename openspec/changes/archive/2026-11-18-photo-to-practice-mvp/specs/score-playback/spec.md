# Spec Delta

## Purpose

Lets the user see the exercise and hear how it should sound on a tenor saxophone, with a cursor showing which note is playing.

## ADDED Requirements

### Requirement: Score display
The app SHALL display the exercise as engraved sheet music in written (transposed) pitch, as it appears in the book, readable on a phone screen in portrait orientation.

#### Scenario: Open an exercise
- **WHEN** the user opens a saved exercise
- **THEN** the score is shown with clef, key signature, time signature, notes, articulations and bar lines

#### Scenario: Eighth notes are beamed by beat
- **WHEN** a bar contains consecutive eighth notes or shorter within one beat
- **THEN** they are shown joined by beams, as in the book, even when the recognition gives no beam information, and the saved exercise files are not changed

### Requirement: Tenor saxophone sound
Playback SHALL use a recorded tenor-saxophone sound bundled with the app, working offline, and that sound's licence SHALL allow redistribution in a free, open-source app.

#### Scenario: Play offline
- **WHEN** the phone is in airplane mode and the user presses play
- **THEN** the exercise plays with the tenor-saxophone sound

### Requirement: Concert pitch
Playback SHALL sound each written note a major ninth lower (B♭ tenor saxophone transposition), so it matches what a tenor saxophone produces when playing the written note.

#### Scenario: Written G
- **WHEN** a written G4 is played
- **THEN** the sound is concert F3

### Requirement: Articulation in playback
Playback SHALL connect notes under a slur without a new attack, SHALL shorten staccato notes clearly, SHALL join tied notes into one sound, and SHALL leave a short gap at breath marks.

#### Scenario: Slur then staccato
- **WHEN** a triplet with a slur over notes 1–2 and a staccato on note 3 is played
- **THEN** notes 1 and 2 sound connected, and note 3 starts with a new attack and is clearly shorter than its written value

#### Scenario: Tie
- **WHEN** two tied notes of the same pitch are played
- **THEN** they sound as one continuous note

### Requirement: Dynamics in playback
Playback SHALL play louder or softer according to printed dynamic marks (at least *p*, *mp*, *mf*, *f*), and at *mf* when none is present.

#### Scenario: Forte section
- **WHEN** an exercise starts at *mf* and later has *f*
- **THEN** the notes after *f* sound louder than those before

### Requirement: Repeats followed
Playback SHALL follow repeat signs and first/second endings in the order a player would. D.C., D.S., Coda and Fine instructions are outside this change and SHALL be played straight through.

#### Scenario: Simple repeat
- **WHEN** an exercise has bars 1–2, an end-repeat sign, then bar 3
- **THEN** playback order is bars 1, 2, 1, 2, 3

#### Scenario: First and second endings
- **WHEN** an exercise has a repeated section with a first and a second ending
- **THEN** the first ending is played the first time and the second ending the second time

### Requirement: Cursor follows playback
During playback the app SHALL highlight the note currently sounding, in time with the audio, and SHALL scroll so the current line stays visible.

#### Scenario: Highlight in sync
- **WHEN** the exercise is playing
- **THEN** the highlighted note changes when the heard note changes, with no visible lag

#### Scenario: Next line
- **WHEN** playback moves to a line that is off screen
- **THEN** the view scrolls to show it

### Requirement: Playback reflects edits
Playback SHALL always use the exercise's current, corrected score.

#### Scenario: Play after correcting
- **WHEN** the user corrects a note and presses play
- **THEN** the corrected note is heard
