# score-capture Specification

## Purpose

Gets the pages of one piece from a printed music book into the app as clean photos, scanned on the phone (cropped and straightened, up to 10 pages in one go), so they can be read and practised. Pages can be added to a piece later.

## Requirements

### Requirement: Photo from camera or gallery
The app SHALL let the user add music by photographing pages with the camera or importing photos from the gallery, both through the phone's page scanner. When the scanner cannot run, the app SHALL say so and SHALL NOT offer another way to add music.

#### Scenario: Take a new photo
- **WHEN** the user chooses to add music and photographs a page in the scanner
- **THEN** that page is used for the new piece

#### Scenario: Use an existing photo
- **WHEN** the user chooses to add music and imports a photo from the gallery in the scanner
- **THEN** that photo is used for the new piece

#### Scenario: Page scanner cannot run
- **WHEN** the page scanner cannot run (Google Play services missing or outdated, the camera unusable, or the scanner fails) and the user chooses to add music
- **THEN** the app explains in plain words that the page scanner is not available on this phone right now, and no piece is created

### Requirement: Page perspective correction
The app SHALL detect the page outline in the photo and straighten it into a flat, top-down image. The user SHALL be able to adjust the detected corners before continuing.

#### Scenario: Page photographed at an angle
- **WHEN** the photo shows the page at an angle
- **THEN** the app proposes the page corners and shows a straightened preview

#### Scenario: Wrong corners detected
- **WHEN** the proposed corners do not match the page
- **THEN** the user can drag each corner to the right position and the preview updates

### Requirement: Source image kept with the piece
The app SHALL keep the cropped photo of every page with the piece, so the user can compare the score with the printed music.

#### Scenario: Compare with the original
- **WHEN** the user opens a two-page piece in the editor
- **THEN** the cropped photos of both pages are available to view

### Requirement: Works offline
Scanning, perspective correction and cropping SHALL work without any network connection.

#### Scenario: No connection
- **WHEN** the phone is in airplane mode and the user adds music
- **THEN** every scanning step completes normally

### Requirement: Crop each page to the music
The user SHALL be able to crop each page in the scanner to the part they want to practise. Only the cropped image SHALL be read. A page that is not cropped SHALL be read whole.

#### Scenario: Several exercises on one page
- **WHEN** the page holds exercises 87, 88 and 89 and the user crops it to exercise 87 in the scanner
- **THEN** only exercise 87 is read

#### Scenario: Whole page
- **WHEN** the user keeps the whole page
- **THEN** all the music on the page is read into the piece

### Requirement: Several pages in one piece
The user SHALL be able to scan up to 10 pages for one piece in one go. The pages SHALL become one piece in the order the scanner returns them; the user reorders, retakes and deletes pages in the scanner.

#### Scenario: Exercise continues overleaf
- **WHEN** exercise 42 starts at the bottom of page 12 and ends at the top of page 13, and the user scans both pages, each cropped to exercise 42
- **THEN** one piece is created that holds all of exercise 42

### Requirement: Hint before scanning
Before the scanner opens, the app SHALL tell the user in one short screen to crop each page to the music they want, and to add the next page when the music continues there. The user SHALL be able to skip this hint for the future.

#### Scenario: First time adding music
- **WHEN** the user adds music for the first time
- **THEN** the hint is shown before the scanner opens

#### Scenario: Hint switched off
- **WHEN** the user has chosen not to see the hint again
- **THEN** adding music opens the scanner directly

### Requirement: Add pages to a piece
From the editor's Score tab, the user SHALL be able to scan more pages for an existing piece. After reading, their music SHALL be added after the piece's last bar, part by part. The existing bars and their corrections SHALL stay unchanged. Parts the user did not keep SHALL be left out of the new pages too, without asking again.

#### Scenario: Forgot the second page
- **WHEN** a piece has 8 bars and the user adds a page that holds 6 more
- **THEN** the piece has 14 bars, the first 8 with their corrections intact

#### Scenario: Add a page to a melody-only piece
- **WHEN** the user kept only the melody of a melody-and-piano piece and adds the next page, which also has both parts
- **THEN** the new bars have the melody only, and no parts step is shown

### Requirement: A new piece opens in the editor
When a new piece has been read and saved, the app SHALL open it in the editor, not in practice. When the reading found more than one part, the parts step SHALL come first, and the piece SHALL be saved once the user continues from it. Going back from the editor SHALL return to the screen adding music was started from. "Save & practice" in the editor then opens it for practice.

#### Scenario: Add a piece
- **WHEN** the user adds a piece of two pages from the home screen and both pages are read
- **THEN** the piece is saved and opens in the editor, and Back returns to the home screen

#### Scenario: Practise straight away
- **WHEN** the new piece is open in the editor and the user taps "Save & practice"
- **THEN** it opens for practice, and Back from practice returns to the home screen

#### Scenario: Parts step first
- **WHEN** the user adds a page with a melody and a piano part
- **THEN** the parts step is shown, and after Continue the piece is saved and opens in the editor

#### Scenario: Back from the parts step
- **WHEN** the parts step is shown and the user goes back
- **THEN** no piece is created, and the screen where the user started adding music is shown again
