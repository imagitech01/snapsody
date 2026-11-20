## MODIFIED Requirements

### Requirement: Recorded instrument sounds
Each instrument SHALL play with a recorded sound of that instrument, bundled with the app and working offline. Each sound's licence SHALL allow redistribution in a free, open-source app. The app SHALL credit each sound's source and licence.

#### Scenario: Play offline
- **WHEN** the phone is in airplane mode and a piece is played with the clarinet
- **THEN** it plays with the clarinet sound

#### Scenario: Credits
- **WHEN** the user opens Settings, then About Snapsody, then Credits and licences, and opens the instrument sounds
- **THEN** the source and licence of the instrument sounds are shown, with the acknowledgements their licence asks to include
