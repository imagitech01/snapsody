# Proposal

## Why

After `parts-and-accompaniment`, a piece can hold a melody and a piano part, two staves, two voices per staff and chords. The editor still edits only the first voice of your part. A misread note in the left hand, in a chord or in the accompaniment cannot be fixed, and fixing a misreading should never need a new scan. This change makes the editor a correction tool for every part, staff, voice and chord note that Snapsody keeps.

It is the third of three changes and builds on `more-marks` and `parts-and-accompaniment`. It lands together with `parts-and-accompaniment`, before the next release, so no piece exists that the editor cannot fix.

## What Changes

- **What you see:**
  - The editor opens on your part. When the piece has more than one part, a part switch at the top lets you edit any other part.
  - A two-staff part is drawn as a grand staff with both voices. The one-line view shows one system, both staves of it.
- **Selecting:**
  - You can tap a single note of a chord, a note in either staff and a note in either voice.
  - The label says where it is, for example *Bar 5 · Left hand · Chord, note 2 of 3*, or *Bar 5 · Right hand · Voice 2*. A one-line piece keeps today's label.
- **Note tools:**
  - Pitch and accidental change the selected note only.
  - Length, dots, triplet and "Make rest" apply to the whole chord.
  - *+ Chord note* adds a note a third above the chord's top note.
  - *To other hand* moves the selected note or chord to the other staff of the piano part.
  - Inserting a note or rest stays in the selected voice. Deleting a chord note removes only that note.
- **Bar lines:**
  - *Bar line before* splits a bar before the selected note, for a bar line homr missed.
  - *Remove bar line* joins a bar with the next one, for a bar line homr read where there is none.
  - Both apply to every part, also in one-line pieces. Bars after them are renumbered, and the pages, the photo lines, the practice position and the loop follow.
  - A bar line is not added where a note sounds across it, and not removed at the end of a printed line or before a clef, key or time change. The editor says why.
- **Bars and warnings:** bars are checked per voice, and each warning names the staff and the voice when the part has more than one (*Bar 5, left hand, voice 2, adds up to 5 beats…*).
- **Score tab:**
  - The key is set per part.
  - The clef is set per staff, also through "Fix a clef".
  - Time signature, tempo marking and bar lines apply to the whole piece.
- **Marks:** dynamics and hairpins belong to a staff, and slurs and ties to a voice. Adding one works in the selected note's staff or voice.
- **Preview a bar:** it plays the bar as practice would, with the parts that play along and your line as set.
- **Not in this change:**
  - adding or removing voices, staves or parts;
  - moving notes from one voice to another, other than *To other hand*;
  - beams or voices that cross between staves;
  - splitting a note into tied notes when a new bar line crosses it;
  - getting back a part you did not keep;
  - MusicXML import or export.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `score-editing`:
  - **New requirements:** "Edit any part", "Select a chord note", "Chord tools", "Marks belong to a staff or voice", "Add a bar line", "Remove a bar line", "Bar numbers follow a bar-line change".
  - **Modified requirements:**
    - "Edit a note": in a voice, chord notes alone or whole chords.
    - "Edits keep bars consistent": per voice, warnings with their staff.
    - "Edit signatures and tempo": key per part, the rest for the whole piece.
    - "Fix a clef": per staff.
    - "One line while editing": a system with all its staves.
    - "Preview a bar": as practice plays it.

## Impact

- `web/src/core/score/edit.ts`:
  - edits take a note's voice from its id;
  - new edits for adding a chord note, moving to the other hand, setting the key per part and the clef per staff, and splitting and joining bars;
  - the voice-view edits of `parts-and-accompaniment` become the editor's only path.
- `web/src/core/score/elements.ts`, `noteMap.ts`, `web/src/ui/scoreView.ts`:
  - a tap resolves to a chord member, through each notehead's id;
  - dynamics and hairpins resolve to their staff.
- `web/src/app/editorSession.ts`: the part being edited, and a selection that carries part, staff and voice.
- `web/src/ui/screens/editor/*`: the part switch, the new label, the new note tools, the Score tab per part and staff.
- `web/src/core/score/warnings.ts`, `en.ts`: warnings with staff and voice.
- `web/src/app/library.ts`: `writeScore` takes a bar map, so the piece's bars, the page and photo-line ranges and `practice.json` follow a bar-line change.
- Stored format: unchanged from `parts-and-accompaniment`; only the numbers in `piece.json` and `practice.json` follow.
- Depends on `more-marks` and `parts-and-accompaniment`. They are archived in that order, so each delta applies on top of the one before.
