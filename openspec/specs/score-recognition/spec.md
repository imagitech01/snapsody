# score-recognition Specification

## Purpose

Turns the photos of a piece's pages into one machine-readable score (MusicXML) entirely on the phone: each page is read on its own and the pages are combined. It checks the result against basic music rules and makes uncertain parts visible to the user.

## Requirements

### Requirement: On-device recognition
The app SHALL read each scanned page into a single-voice score on the phone itself, without sending the image or any data to a server and without needing a network connection.

#### Scenario: Recognise offline
- **WHEN** the phone is in airplane mode and the user finishes scanning
- **THEN** the pages are read and produce a piece

#### Scenario: No data leaves the phone
- **WHEN** pages are being read
- **THEN** the app makes no network request carrying the images or the music read from them

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
While pages are being read, the app SHALL show which page it is reading out of how many, with progress, and SHALL let the user cancel. Cancelling SHALL stop the reading and return to the screen where adding music started. A new piece SHALL NOT be created, and a piece that pages were being added to SHALL stay unchanged.

#### Scenario: Progress over three pages
- **WHEN** three pages are being read
- **THEN** the screen shows the pages already read, the page being read now and the pages still to come, and the progress never moves backwards

#### Scenario: Cancel recognition
- **WHEN** the user cancels while page 2 of 3 is being read
- **THEN** reading stops, no piece is created, and the screen where the user started adding music is shown again

#### Scenario: Cancel while adding pages
- **WHEN** the user cancels while reading pages that are being added to an existing piece
- **THEN** the existing piece is unchanged

### Requirement: Recognition failure
When no music staff can be found on a page, the app SHALL say which page has no music and SHALL offer to scan again, instead of producing an empty or partial piece.

#### Scenario: Region contains no music
- **WHEN** page 2 of 2 contains only text or blank paper
- **THEN** the app reports that no music was found on page 2, creates no piece, and offers to scan again

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
Notes outside the written range of the instrument in use SHALL be flagged as likely misreads. They SHALL NOT be changed automatically.

#### Scenario: Impossible note
- **WHEN** a note is read as written A3 and the instrument in use is the tenor saxophone
- **THEN** that note is flagged as outside the instrument's range and keeps its pitch as read

#### Scenario: Another instrument
- **WHEN** the same piece is practised with the piano
- **THEN** the written A3 is not flagged

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

### Requirement: Pages combined into one score
The pages of a piece SHALL be read one at a time, in order, and combined into one score with bars numbered continuously. A clef, key or time signature at the start of a later page that repeats the one in force SHALL NOT be added again. The bar-length repair, the time-signature inference and the range check SHALL run on the combined score.

#### Scenario: Two pages
- **WHEN** page 1 is read as 8 bars and page 2 as 6 bars
- **THEN** the piece has bars 1 to 14, with page 2's bars numbered 9 to 14

#### Scenario: Time signature only on the first page
- **WHEN** page 1 starts with 3/4 and page 2 has no time signature
- **THEN** page 2's bars are checked against 3/4, and no inferred time signature is flagged for them

#### Scenario: Key repeated at the top of page 2
- **WHEN** both pages start with a treble clef and one sharp
- **THEN** the combined score has no clef or key change where page 2 begins
