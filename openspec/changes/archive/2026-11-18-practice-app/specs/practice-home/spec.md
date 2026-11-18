# Spec Delta

## Purpose

The Practice tab's start screen. It gets the user practising again in one tap: it continues the last piece where they left off and keeps their favorite pieces close.

## ADDED Requirements

### Requirement: Continue practising
The start screen SHALL show the piece the user practised last, with the bar they were at, their tempo, and whether the metronome and a loop are on. Continuing SHALL open that piece at that bar and tempo, with its loop and metronome as they were.

#### Scenario: Pick up where you left off
- **WHEN** the user last practised "Ode to Joy" at 60 beats per minute and left it in bar 2
- **THEN** the start screen shows "Ode to Joy", bar 2 of its bars and 60 BPM, and continuing opens it at bar 2 at 60 BPM

#### Scenario: Nothing practised yet
- **WHEN** the user has pieces but has not practised any of them
- **THEN** no continue card is shown

### Requirement: Practice rotation
The start screen SHALL list the user's favorite pieces as their rotation. Each entry SHALL show the piece's name and length, and SHALL start practising it in one tap at its remembered place. A link SHALL open the full list of favorites.

#### Scenario: Play a favorite
- **WHEN** "C major warm-up" is a favorite and the user taps its play button
- **THEN** the piece opens and starts playing at its remembered place and tempo

#### Scenario: No favorites
- **WHEN** the user has no favorite pieces
- **THEN** the rotation explains that starring a piece adds it here

### Requirement: Shortcuts to the library and adding music
The start screen SHALL offer to browse all pieces and to add music.

#### Scenario: Add music from the start screen
- **WHEN** the user taps "Add music" on the start screen
- **THEN** adding music starts as it does from the library

### Requirement: First launch
When there are no pieces yet, the start screen SHALL invite the user to add their first music, and SHALL say in one line what happens: photograph the pages, and Snapsody plays them.

#### Scenario: Empty app
- **WHEN** the app is opened for the first time
- **THEN** the start screen shows the invitation to add music and no empty lists
