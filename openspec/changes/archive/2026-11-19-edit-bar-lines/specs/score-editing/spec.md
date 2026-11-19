# Spec Delta

## ADDED Requirements

### Requirement: Edit bar lines
For the selected bar, the user SHALL be able to set how it starts (normal or start-repeat `||:`) and how it ends (normal, double bar line `||` or end-repeat `:||`). For an end-repeat, the user SHALL be able to set how many times the section is played in total, from 2 to 8, with 2 as the default. The editor SHALL show the selected bar's current start and end, and playback SHALL follow the edited signs. First and second endings are not edited, and an ending already on the bar SHALL stay.

#### Scenario: Make a repeat explicit
- **WHEN** an exercise has bar 1 ending in an end-repeat, bar 2 ending in a double bar line, and bar 3 ending in an end-repeat, and the user selects bar 3 and sets its start to start-repeat
- **THEN** bar 3 is drawn with `||:`, and playback order is bars 1, 1, 2, 3, 3, then the bars after it

#### Scenario: Add a missing end-repeat
- **WHEN** recognition missed the end-repeat of bar 2 in a three-bar exercise, and the user sets the end of bar 2 to end-repeat
- **THEN** bar 2 is drawn with `:||`, and playback order is bars 1, 2, 1, 2, 3

#### Scenario: Play a section three times
- **WHEN** bar 2 ends in an end-repeat, and the user sets it to 3×
- **THEN** playback order is bars 1, 2, 1, 2, 1, 2, then the bars after it

#### Scenario: Remove a misread repeat
- **WHEN** recognition read a plain bar line at the end of bar 4 as an end-repeat, and the user sets that end to normal
- **THEN** the bar is drawn with a plain bar line, and playback goes on to bar 5 without repeating

#### Scenario: Show what the selected bar has
- **WHEN** the user selects a note in a bar that starts with `||:` and ends with a double bar line
- **THEN** the controls show start-repeat as the bar's start and double bar line as its end

#### Scenario: Endings stay
- **WHEN** the user changes the repeat count of an end-repeat at the end of a first ending
- **THEN** the first ending is still there, and the second ending is still played on the last pass

#### Scenario: Undo a bar-line edit
- **WHEN** the user sets the end of a bar to end-repeat and taps undo
- **THEN** the bar ends as it did before, and playback no longer repeats there
