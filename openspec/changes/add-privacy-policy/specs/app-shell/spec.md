## ADDED Requirements

### Requirement: Privacy policy and source code
The Settings tab SHALL have a "Privacy policy" row and a "Source code" row. Each SHALL open its page in the phone's browser: the privacy policy at `https://imagitech.be/snapsody/privacy/`, and the source code at `https://github.com/imagitech01/snapsody`. Opening one SHALL NOT need an internet permission for the app, and SHALL NOT replace the app's own screen.

#### Scenario: Read the privacy policy
- **WHEN** the user opens Settings and taps "Privacy policy"
- **THEN** the phone's browser shows Snapsody's privacy policy, and going back returns to Settings

#### Scenario: Find the source code
- **WHEN** the user opens Settings and taps "Source code"
- **THEN** the phone's browser shows Snapsody's source code repository

#### Scenario: In Dutch
- **WHEN** the app is in Dutch and the user opens Settings
- **THEN** the rows are called "Privacybeleid" and "Broncode", and they open the same pages
