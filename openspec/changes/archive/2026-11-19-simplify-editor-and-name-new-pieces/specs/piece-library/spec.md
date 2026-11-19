## MODIFIED Requirements

### Requirement: Default name
A new piece SHALL get a default name made from the date and time it was added, and the user SHALL be able to change it. When the new piece opens in the editor, the editor SHALL ask for a name without getting in the way: it SHALL highlight the title with the date name selected and the caption "Name this piece", and it SHALL NOT open the keyboard by itself.

#### Scenario: New piece
- **WHEN** a piece is added on 18 November at 14:05
- **THEN** its name shows that date and time until the user renames it

#### Scenario: Name it right away
- **WHEN** a new piece opens in the editor and the user taps the title and types "Ode to Joy"
- **THEN** the typing replaces the date name, and after "Save & practice" the piece is called "Ode to Joy"

#### Scenario: Fix notes first
- **WHEN** a new piece opens in the editor and the user taps a note without touching the title
- **THEN** no keyboard has opened, the note is selected, and the title keeps its highlight until it is changed or the piece is saved

#### Scenario: Not asked again
- **WHEN** the user opens an existing piece in the editor from practice
- **THEN** the title is not highlighted and there is no "Name this piece" caption
