# Spec Delta

## Purpose

Lets the user fix recognition mistakes quickly on the phone and keeps exercises, so a misread note never forces a retake and practised exercises can be reopened later.

## ADDED Requirements

### Requirement: Flags shown for review
After recognition, the app SHALL visibly mark every bar or note flagged by the repair checks (unrepairable bar, inferred time signature, out-of-range note), and SHALL let the user step from one flag to the next.

#### Scenario: Review flags
- **WHEN** a recognised exercise has two flagged notes
- **THEN** both are marked on the score and the user can jump from the first to the second

#### Scenario: No flags
- **WHEN** a recognised exercise has no flags
- **THEN** no review marks are shown

### Requirement: Edit a note
The user SHALL be able to select a note and change its pitch (step up or down, accidental), its duration (including dotted and triplet), and its slur, tie and staccato markings, or delete it, or insert a note or rest next to it.

#### Scenario: Fix a wrong pitch
- **WHEN** the user selects a note read as C5 and steps it down once
- **THEN** the note becomes B4 and the score display updates

#### Scenario: Fix articulation
- **WHEN** the user selects a note and turns staccato on
- **THEN** the note shows a staccato dot and plays shortened

### Requirement: Edit signatures and tempo
The user SHALL be able to change the exercise's key signature, time signature and tempo marking.

#### Scenario: Wrong key signature
- **WHEN** the user changes the key signature from no sharps to one sharp
- **THEN** every F without its own accidental is treated as F♯ in display and playback

### Requirement: Edits keep bars consistent
After each edit, the app SHALL re-run the bar-length check and SHALL mark the bars that no longer add up, without blocking the edit.

#### Scenario: Edit breaks a bar
- **WHEN** the user lengthens a quarter note to a half note in a full 3/4 bar
- **THEN** the edit is applied and the bar is marked as not adding up

### Requirement: Undo
The user SHALL be able to undo and redo edits made in the current editing session.

#### Scenario: Undo a mistake
- **WHEN** the user deletes a note by accident and taps undo
- **THEN** the note is restored

### Requirement: Exercises are saved
Each recognised exercise, with its corrections, its source image and its name, SHALL be saved on the phone, and the user SHALL be able to reopen, rename and delete saved exercises.

#### Scenario: Reopen later
- **WHEN** the user closes the app after correcting exercise 87 and reopens it the next day
- **THEN** exercise 87 is listed and opens with the corrections intact

#### Scenario: Name defaults
- **WHEN** an exercise is created
- **THEN** it gets a default name the user can change (for example the date and time of capture)

#### Scenario: Delete an exercise
- **WHEN** the user deletes a saved exercise and confirms
- **THEN** the exercise and its image are removed from the phone
