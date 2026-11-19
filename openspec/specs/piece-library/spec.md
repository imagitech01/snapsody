# piece-library Specification

## Purpose

The pieces kept on the phone: each piece's pages and photos, its corrected score and practice settings, and how the user finds, stars, renames and deletes them.

## Requirements

### Requirement: Pieces are saved
Each piece SHALL be saved on the phone with its name, its pages with their source photos, its corrected score and its practice settings. A saved piece SHALL open unchanged after the app or the phone restarts.

#### Scenario: Reopen later
- **WHEN** the user closes the app after correcting a piece and opens it the next day
- **THEN** the piece is listed and opens with its corrections and practice settings intact

### Requirement: Original reading kept
The music as first read from each page SHALL be kept unchanged next to the corrected score, so later corrections never lose the original reading.

#### Scenario: Edit after reading
- **WHEN** the user corrects notes in a two-page piece and saves
- **THEN** the corrected score is saved, and the original reading of each page is still stored unchanged

### Requirement: Saving never leaves a damaged piece
An interrupted save SHALL leave the piece as it was before or as it is after the save, never partly written.

#### Scenario: App killed while saving
- **WHEN** the app is killed while a piece is being saved
- **THEN** on the next launch the piece opens in either its previous or its new state

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

### Requirement: Library list
The library SHALL list all pieces, the most recently practised or added first. Each entry SHALL show the name, a star, and a summary line with the number of pages (when more than one), the number of bars, and when it was last practised or added.

#### Scenario: Summary line
- **WHEN** a two-page piece of 24 bars was practised yesterday
- **THEN** its entry reads like "2 pages · 24 bars · Practised yesterday"

#### Scenario: Empty library
- **WHEN** there are no pieces
- **THEN** the library invites the user to add music instead of showing an empty list

### Requirement: Search
The library SHALL filter the list while the user types, matching any part of a piece's name, ignoring case and accents.

#### Scenario: Find a piece
- **WHEN** the user types "ode" in the search field
- **THEN** "Ode to Joy" is listed and pieces without "ode" in their name are not

#### Scenario: No match
- **WHEN** no name matches the search
- **THEN** the library says that nothing matches

### Requirement: Favorites
The user SHALL be able to star and unstar a piece in the library and in the practice tools. The favorites SHALL have their own list.

#### Scenario: Star a piece
- **WHEN** the user taps the star of "Even eighths"
- **THEN** the star is filled, and "Even eighths" appears in the favorites list and the practice rotation

#### Scenario: Unstar from the favorites list
- **WHEN** the user taps a filled star in the favorites list
- **THEN** the piece leaves the favorites list and stays in the library

### Requirement: Rename
The user SHALL be able to rename a piece through its title in the editor. An empty name SHALL NOT be accepted.

#### Scenario: Rename in the editor
- **WHEN** the user changes the title to "Ode to Joy" and saves
- **THEN** the library lists the piece as "Ode to Joy"

### Requirement: Delete a piece
The user SHALL be able to delete a piece after confirming. Deleting SHALL remove its score, photos and practice settings from the phone.

#### Scenario: Delete with confirmation
- **WHEN** the user deletes a piece and confirms
- **THEN** the piece disappears from the library, the rotation and the continue card, and its files are removed

#### Scenario: Change of mind
- **WHEN** the user starts deleting a piece and cancels
- **THEN** nothing is removed
