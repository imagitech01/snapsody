# app-shell Specification

## Purpose

The frame of the Snapsody app: its name and words, the tabs between its main areas, its languages, orientation, behaviour in the background, and the general settings. It keeps the technical side of reading and playing music out of the way, so the app feels like a practice tool.

## Requirements

### Requirement: Name and words
The app SHALL be called Snapsody. It SHALL call what the user practises a "piece". In normal use it SHALL NOT show technical terms such as recognition, MusicXML, model, GPU or accelerator.

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

### Requirement: English only
All text in the app SHALL be in English, whatever the phone's language. The app SHALL NOT offer a choice of language.

#### Scenario: Dutch phone
- **WHEN** the phone's language is Dutch
- **THEN** the app is in English and calls a piece "piece"

#### Scenario: A language chosen in an earlier version
- **WHEN** `settings.json` says the user chose Dutch in an earlier version, and the app starts
- **THEN** the app is in English, and Settings has no Language row

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
The Settings tab SHALL hold the default instrument and the count-in. The default instrument SHALL show as one line with the current choice; choosing it SHALL show the full list to pick from. A change SHALL take effect without restarting the app and SHALL be kept after a restart. Below the settings, Settings SHALL have a "Rate on Google Play" row and, directly under it, an "About Snapsody" row that shows the app's version.

#### Scenario: Change a setting
- **WHEN** the user opens the default instrument in Settings, picks the clarinet from the list, and later restarts the app
- **THEN** Settings shows the clarinet as the default instrument

#### Scenario: The last two rows
- **WHEN** the user opens Settings in version 0.1.2
- **THEN** after the count-in come "Rate on Google Play" and then "About Snapsody", which shows 0.1.2, and there are no Language, Credits, Privacy policy or Source code rows

### Requirement: Works without a network
The whole app SHALL work without a network connection, and SHALL NOT send the user's photos, music or practice data anywhere.

#### Scenario: Airplane mode
- **WHEN** the phone is in airplane mode
- **THEN** adding music, practising, editing and settings all work as usual

### Requirement: Privacy policy and source code
The About screen SHALL have a "Privacy policy" row and a "Source code" row. Each SHALL open its page in the phone's browser: the privacy policy at `https://imagitech.be/snapsody/privacy/`, and the source code at `https://github.com/imagitech01/snapsody`. Opening one SHALL NOT need an internet permission for the app, and SHALL NOT replace the app's own screen.

#### Scenario: Read the privacy policy
- **WHEN** the user opens Settings, then About Snapsody, and taps "Privacy policy"
- **THEN** the phone's browser shows Snapsody's privacy policy, and going back returns to the About screen

#### Scenario: Find the source code
- **WHEN** the user opens Settings, then About Snapsody, and taps "Source code"
- **THEN** the phone's browser shows Snapsody's source code repository

#### Scenario: In Dutch
- **WHEN** the phone's language is Dutch and the user opens Settings, then About Snapsody
- **THEN** the rows are called "Privacy policy" and "Source code", in English, and they open the same pages

### Requirement: Rate on Google Play
The "Rate on Google Play" row SHALL open Snapsody's page in the Play Store (`https://play.google.com/store/apps/details?id=be.imagitech.snapsody`), or in the browser when the phone has no Play Store. The app SHALL NOT ask anything before opening it, and SHALL NOT show a rating prompt of its own.

#### Scenario: Rate the app
- **WHEN** the user taps "Rate on Google Play" in Settings
- **THEN** the Play Store opens on Snapsody's page, and going back returns to Settings

### Requirement: About Snapsody
"About Snapsody" SHALL open a screen with the app's name, its version, its licence (AGPL-3.0), and three rows: "Credits and licences", "Privacy policy" and "Source code". The screen SHALL have its own Back button and SHALL NOT show the tab bar.

#### Scenario: Open About
- **WHEN** the user taps "About Snapsody" in Settings in version 0.1.2
- **THEN** a screen shows Snapsody 0.1.2, free and open source under AGPL-3.0, and the three rows, and Back returns to Settings

### Requirement: Credits and licences
"Credits and licences" SHALL list every major third-party component bundled with the app (its sub-libraries are covered by its entry and licence text), grouped by what it does, each with its version and licence. Opening a component SHALL show its source, any notices its licence asks to be included, and the full text of its licence. All of it SHALL work without a network. A component that is not open source SHALL say so.

#### Scenario: The full list
- **WHEN** the user opens Credits and licences
- **THEN** homr, Verovio, the instrument sounds, the model runtimes, the Python libraries, the app frame, the Android libraries and the page scanner are all listed with a version and a licence

#### Scenario: Read a licence offline
- **WHEN** the phone is in airplane mode and the user opens homr in Credits and licences
- **THEN** its source, its notices and the full text of the GNU Affero General Public License version 3 are shown

#### Scenario: The scanner is not open source
- **WHEN** the user looks at Google ML Kit Document Scanner in Credits and licences
- **THEN** it is marked as not open source and points to the ML Kit terms of service
