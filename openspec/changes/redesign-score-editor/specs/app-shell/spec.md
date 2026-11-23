# Spec Delta

## ADDED Requirements

### Requirement: Note names
The app SHALL name notes in one of two ways, chosen in Settings: with letters (C D E F G A B) or with do re mi (Do Re Mi Fa Sol La Si, where Do is C). Both SHALL carry the accidental and the same octave number, so C4 is Do4 and B♭3 is Si♭3. The choice SHALL apply everywhere the app names a note: in the editor, in the warnings and in the instrument's range. Letters SHALL be the choice until the user changes it. The choice SHALL NOT change the music, how it is drawn as notes, or how it sounds.

#### Scenario: Do re mi in the editor
- **WHEN** the note names are set to do re mi and the user selects a note on the first line of the treble staff
- **THEN** the editor names it Mi4

#### Scenario: A flat
- **WHEN** the note names are set to do re mi and the selected note is B♭3
- **THEN** the editor names it Si♭3

#### Scenario: A range warning
- **WHEN** the note names are set to do re mi and a note C6 is above the instrument's written range
- **THEN** the warning names the note Do6, and names the ends of the range the same way

#### Scenario: Letters by default
- **WHEN** the app is used for the first time
- **THEN** notes are named with letters

## MODIFIED Requirements

### Requirement: General settings
The Settings tab SHALL hold the default instrument, the note names and the count-in. The default instrument SHALL show as one line with the current choice; choosing it SHALL show the full list to pick from. The note names SHALL be a choice between "C D E" and "Do Re Mi". A change SHALL take effect without restarting the app and SHALL be kept after a restart. Below the settings, Settings SHALL have a "Rate on Google Play" row and, directly under it, an "About Snapsody" row that shows the app's version.

#### Scenario: Change a setting
- **WHEN** the user opens the default instrument in Settings, picks the clarinet from the list, and later restarts the app
- **THEN** Settings shows the clarinet as the default instrument

#### Scenario: The last two rows
- **WHEN** the user opens Settings in version 0.1.2
- **THEN** after the count-in come "Rate on Google Play" and then "About Snapsody", which shows 0.1.2, and there are no Language, Credits, Privacy policy or Source code rows

#### Scenario: Change the note names
- **WHEN** the user sets the note names to "Do Re Mi" in Settings, and later restarts the app
- **THEN** Settings shows "Do Re Mi", and the editor names notes with do re mi
