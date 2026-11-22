# Spec Delta

## Purpose

Turns the selected exercise image into a machine-readable score (MusicXML) entirely on the phone, checks it against basic music rules, and makes uncertain parts visible to the user.

## ADDED Requirements

### Requirement: On-device recognition
The app SHALL recognise the selected exercise image into a single-voice score on the phone itself, without sending the image or any data to a server and without needing a network connection.

#### Scenario: Recognise offline
- **WHEN** the phone is in airplane mode and the user confirms an exercise region
- **THEN** recognition runs and produces a score

#### Scenario: No data leaves the phone
- **WHEN** recognition runs
- **THEN** the app makes no network request carrying the image or the recognised music

### Requirement: Recognised content
The recognised score SHALL include, where printed: clef, key signature, time signature, pitches with accidentals, note and rest durations including triplets, ties, slurs, staccato, breath marks, dynamics, bar lines, and repeat signs with first/second endings. Tempo words and metronome marks are not recognised.

#### Scenario: Exercise 87 reference
- **WHEN** the reference photo of exercise 87 (`20261111_1701026728888866947001497.jpg`, kept in the local-only fixtures folder) is cropped to exercise 87 and recognised on the phone
- **THEN** the score has G major, 3/4, *mf* and 19 bars, and its pitches, durations, triplets, slurs and staccato in bars 1–19 match homr 0.7.1's output on a Mac for the same image, including a dotted half note G in bar 19

#### Scenario: Tempo marking not read
- **WHEN** an exercise printed with "Moderato" is recognised
- **THEN** the score contains no tempo marking, and the exercise uses the default tempo until the user enters one

#### Scenario: Repeat sign
- **WHEN** an exercise with an end-repeat sign and no start-repeat sign is recognised
- **THEN** the score marks the repeat from the beginning of the exercise to that sign

### Requirement: MusicXML as the result format
Recognition SHALL produce its result as MusicXML, and every later step (editing, playback) SHALL work from that MusicXML, so another recognition engine can be added later without changing those steps.

#### Scenario: Result handed on
- **WHEN** recognition finishes
- **THEN** the exercise holds a MusicXML score that the editing and playback steps open

### Requirement: Progress and cancel
While recognition runs, the app SHALL show progress and SHALL let the user cancel. Cancelling SHALL return to the region-selection step without creating an exercise.

#### Scenario: Cancel recognition
- **WHEN** the user cancels during recognition
- **THEN** recognition stops, no exercise is created, and the region-selection step is shown again

### Requirement: Recognition failure
When no music staff can be found in the selected region, the app SHALL say so and offer to adjust the selection or retake the photo, instead of producing an empty or partial exercise.

#### Scenario: Region contains no music
- **WHEN** the user selects a region that contains only text or blank paper
- **THEN** the app reports that no music was found and offers to reselect or retake

### Requirement: Bar-length repair
After recognition, the app SHALL check that each bar's durations add up to the time signature. Where a bar of eighth notes only adds up when read as triplets, it SHALL repair the bar to triplets; bars it cannot repair SHALL be flagged.

#### Scenario: Missing triplet marks
- **WHEN** a 3/4 bar is recognised as six plain eighths and a quarter (4 beats)
- **THEN** the six eighths are repaired to two triplet groups and the bar adds up to 3 beats

#### Scenario: Unrepairable bar
- **WHEN** a bar's durations do not add up and no triplet repair fixes it
- **THEN** the bar is flagged as needing review

### Requirement: Missing time-signature repair
When an exercise has no recognised time signature, the app SHALL infer one from the bar contents if most bars agree on the same length, and SHALL flag that it was inferred.

#### Scenario: Time signature not read
- **WHEN** an exercise in common time is recognised without a time signature and its bars each add up to four quarter notes
- **THEN** the score gets a 4/4 time signature marked as inferred

### Requirement: Range check
Notes outside the written range of the tenor saxophone (written B♭3 to F♯6) SHALL be flagged as likely misreads. They SHALL NOT be changed automatically.

#### Scenario: Impossible note
- **WHEN** a note is recognised as written A3
- **THEN** that note is flagged as outside the tenor range and keeps its recognised pitch

### Requirement: Accelerated with safe fallback
Recognition SHALL use the phone's GPU only when a built-in self-test shows the GPU gives the same result as the CPU and is faster; otherwise it SHALL use the CPU. The choice SHALL never change the recognised music.

#### Scenario: GPU passes the self-test
- **WHEN** the self-test output on the GPU matches the CPU reference within tolerance and is faster
- **THEN** recognition uses the GPU

#### Scenario: GPU gives a different result
- **WHEN** the GPU self-test output differs from the CPU reference beyond tolerance
- **THEN** recognition uses the CPU

#### Scenario: GPU unavailable or failing
- **WHEN** the GPU path cannot be initialised or fails during recognition
- **THEN** recognition continues or restarts on the CPU and still produces a score

#### Scenario: Self-test repeated after a change
- **WHEN** the app or its models are updated
- **THEN** the self-test runs again before the GPU is used
