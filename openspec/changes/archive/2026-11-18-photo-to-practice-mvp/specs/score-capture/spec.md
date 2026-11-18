# Spec Delta

## Purpose

Gets a usable image of exactly one exercise from a printed music book into the app, so it can be recognised and practised.

## ADDED Requirements

### Requirement: Photo from camera or gallery
The app SHALL let the user take a new photo of a book page with the phone camera, or pick an existing photo from the phone's gallery.

#### Scenario: Take a new photo
- **WHEN** the user chooses to add an exercise and takes a photo with the camera
- **THEN** the photo is shown in the page-preparation step

#### Scenario: Use an existing photo
- **WHEN** the user chooses to add an exercise and picks a photo from the gallery
- **THEN** that photo is shown in the page-preparation step

#### Scenario: Page scanner cannot run
- **WHEN** the page scanner cannot run (Google Play services missing or outdated, the camera unusable, or the scanner fails) and the user chooses to add an exercise
- **THEN** the app explains that the scanner is not available and still offers picking a photo from the gallery, which goes to region selection without perspective correction

### Requirement: Page perspective correction
The app SHALL detect the page outline in the photo and straighten it into a flat, top-down image. The user SHALL be able to adjust the detected corners before continuing.

#### Scenario: Page photographed at an angle
- **WHEN** the photo shows the page at an angle
- **THEN** the app proposes the page corners and shows a straightened preview

#### Scenario: Wrong corners detected
- **WHEN** the proposed corners do not match the page
- **THEN** the user can drag each corner to the right position and the preview updates

### Requirement: Select a single exercise
The app SHALL require the user to mark the region containing the one exercise to practise, and SHALL pass only that region on to recognition.

#### Scenario: Several exercises on one page
- **WHEN** the straightened page contains exercises 87, 88 and 89 and the user draws a box around exercise 87
- **THEN** only the boxed region is sent to recognition

#### Scenario: Box adjusted before confirming
- **WHEN** the user resizes or moves the selection box
- **THEN** the selected region updates and the user confirms it before recognition starts

### Requirement: Source image kept with the exercise
The app SHALL store the selected exercise image together with the resulting exercise, so the user can compare the recognised score with the original printed music.

#### Scenario: Compare with the original
- **WHEN** the user opens a recognised exercise and asks to see the original
- **THEN** the app shows the cropped photo of that exercise

### Requirement: Works offline
Capture, perspective correction and region selection SHALL work without any network connection.

#### Scenario: No connection
- **WHEN** the phone is in airplane mode and the user adds an exercise from a photo
- **THEN** every capture step completes normally
