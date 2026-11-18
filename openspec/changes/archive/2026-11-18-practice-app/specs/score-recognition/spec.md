# Spec Delta

## MODIFIED Requirements

### Requirement: On-device recognition
The app SHALL read each scanned page into a single-voice score on the phone itself, without sending the image or any data to a server and without needing a network connection.

#### Scenario: Recognise offline
- **WHEN** the phone is in airplane mode and the user finishes scanning
- **THEN** the pages are read and produce a piece

#### Scenario: No data leaves the phone
- **WHEN** pages are being read
- **THEN** the app makes no network request carrying the images or the music read from them

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

### Requirement: Range check
Notes outside the written range of the instrument in use SHALL be flagged as likely misreads. They SHALL NOT be changed automatically.

#### Scenario: Impossible note
- **WHEN** a note is read as written A3 and the instrument in use is the tenor saxophone
- **THEN** that note is flagged as outside the instrument's range and keeps its pitch as read

#### Scenario: Another instrument
- **WHEN** the same piece is practised with the piano
- **THEN** the written A3 is not flagged

## ADDED Requirements

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
