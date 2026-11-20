## MODIFIED Requirements

### Requirement: Name and words
The app SHALL be called Snapsody. It SHALL call what the user practises a "piece". In normal use it SHALL NOT show technical terms such as recognition, MusicXML, model, GPU or accelerator.

#### Scenario: Adding music in plain words
- **WHEN** the user adds music and the pages are being read
- **THEN** the screen talks about reading pages and the new piece, and no technical term appears

#### Scenario: Launcher name
- **WHEN** the app is installed
- **THEN** it appears on the phone as "Snapsody"

### Requirement: General settings
The Settings tab SHALL hold the default instrument and the count-in. The default instrument SHALL show as one line with the current choice; choosing it SHALL show the full list to pick from. A change SHALL take effect without restarting the app and SHALL be kept after a restart. Below the settings, Settings SHALL have a "Rate on Google Play" row and, directly under it, an "About Snapsody" row that shows the app's version.

#### Scenario: Change a setting
- **WHEN** the user opens the default instrument in Settings, picks the clarinet from the list, and later restarts the app
- **THEN** Settings shows the clarinet as the default instrument

#### Scenario: The last two rows
- **WHEN** the user opens Settings in version 0.1.2
- **THEN** after the count-in come "Rate on Google Play" and then "About Snapsody", which shows 0.1.2, and there are no Language, Credits, Privacy policy or Source code rows

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

## REMOVED Requirements

### Requirement: English and Dutch
**Reason**: The app is English only for now. Its store listing and its privacy policy are English only too.
**Migration**: Nothing to do for the user: a phone in Dutch shows the app in English, and a language chosen earlier in Settings is ignored and dropped from `settings.json` on the next save. The text catalogue stays, so a language can be added back later.

## ADDED Requirements

### Requirement: English only
All text in the app SHALL be in English, whatever the phone's language. The app SHALL NOT offer a choice of language.

#### Scenario: Dutch phone
- **WHEN** the phone's language is Dutch
- **THEN** the app is in English and calls a piece "piece"

#### Scenario: A language chosen in an earlier version
- **WHEN** `settings.json` says the user chose Dutch in an earlier version, and the app starts
- **THEN** the app is in English, and Settings has no Language row

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
