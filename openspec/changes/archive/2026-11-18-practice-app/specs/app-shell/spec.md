# Spec Delta

## Purpose

The frame of the Snapsody app: its name and words, the tabs between its main areas, its languages, orientation, behaviour in the background, and the general settings. It keeps the technical side of reading and playing music out of the way, so the app feels like a practice tool.

## ADDED Requirements

### Requirement: Name and words
The app SHALL be called Snapsody. It SHALL call what the user practises a "piece" ("muziekstuk" in Dutch). In normal use it SHALL NOT show technical terms such as recognition, MusicXML, model, GPU or accelerator.

#### Scenario: Adding music in plain words
- **WHEN** the user adds music and the pages are being read
- **THEN** the screen talks about reading pages and the new piece, and no technical term appears

#### Scenario: Launcher name
- **WHEN** the app is installed
- **THEN** it appears on the phone as "Snapsody"

### Requirement: Main tabs
The app SHALL have three main areas: Practice, Library and Settings. A tab bar SHALL switch between them from each area's start screen. Practising, editing and adding music SHALL use the full screen, without the tab bar.

#### Scenario: Switch area
- **WHEN** the user is on the Practice start screen and taps Library
- **THEN** the library is shown and the Library tab is marked as current

#### Scenario: Practising hides the tabs
- **WHEN** the user opens a piece to practise
- **THEN** the tab bar is not shown until the user goes back

### Requirement: English and Dutch
All text in the app SHALL be available in English and Dutch. The app SHALL use Dutch when the phone's language is Dutch and English otherwise, unless the user chooses a language in Settings.

#### Scenario: Dutch phone
- **WHEN** the phone's language is Dutch and the user has not chosen a language
- **THEN** the app is in Dutch and calls a piece "muziekstuk"

#### Scenario: Language chosen in Settings
- **WHEN** the user chooses English in Settings on a Dutch phone
- **THEN** the app switches to English immediately and stays in English after a restart

### Requirement: Practice in portrait and landscape
The practice screen SHALL work in portrait and landscape. Turning the phone SHALL NOT stop playback or lose the position.

#### Scenario: Turn the phone while playing
- **WHEN** a piece is playing in bar 5 and the user turns the phone to landscape
- **THEN** the landscape layout is shown, playback continues without a gap, and bar 5 stays in view

### Requirement: Screen stays on while playing
The screen SHALL NOT turn off while a piece is playing. When playback is paused or stopped, the phone's normal screen timeout SHALL apply again.

#### Scenario: Long practice loop
- **WHEN** a loop plays for longer than the phone's screen timeout
- **THEN** the screen stays on

#### Scenario: Paused
- **WHEN** the user pauses and leaves the phone alone
- **THEN** the screen turns off after the phone's normal timeout

### Requirement: Playback pauses in the background
When the app goes to the background, playback SHALL pause, and the piece SHALL be in the same place when the user returns.

#### Scenario: Phone call
- **WHEN** a piece is playing in bar 7 and the user switches to another app
- **THEN** playback pauses and, back in Snapsody, the piece is paused in bar 7

### Requirement: Back closes the top layer first
The system back action SHALL first close an open sheet or dialog, and otherwise go back one screen.

#### Scenario: Back with the tools sheet open
- **WHEN** the practice tools sheet is open and the user presses back
- **THEN** the sheet closes and the piece stays open

### Requirement: General settings
The Settings tab SHALL hold the default instrument, the count-in and the language. The default instrument and the language SHALL each show as one line with the current choice; choosing it SHALL show the full list to pick from. A change SHALL take effect without restarting the app and SHALL be kept after a restart.

#### Scenario: Change a setting
- **WHEN** the user opens the default instrument in Settings, picks the clarinet from the list, and later restarts the app
- **THEN** Settings shows the clarinet as the default instrument

### Requirement: Works without a network
The whole app SHALL work without a network connection, and SHALL NOT send the user's photos, music or practice data anywhere.

#### Scenario: Airplane mode
- **WHEN** the phone is in airplane mode
- **THEN** adding music, practising, editing and settings all work as usual
