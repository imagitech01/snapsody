# Proposal

## Why

The editor is clunky and has dead ends: a bar whose notes were all removed can take no note any more, because a note can only be inserted next to a selected note. Some things the player already follows cannot be put right in the editor at all: a missed loudness mark, a missed first or second ending, a missing or extra bar. Trying three different editors in an interactive mock showed that editing by touch on one big bar, and on a beat grid, both work much better than tabs of buttons under a line of small notes.

## What Changes

- **BREAKING (spec):** the editor works on **one bar at a time**. The line of music that holds the bar stays in view, small, as an overview; the bar itself is shown large. The editor no longer starts on the whole sheet; "Full score" stays as a key that shows the whole sheet to pick another bar.
- The large bar has **two views behind a switch**, and the choice is remembered:
  - **Notes**: the bar as engraved music. Tap the staff to add a note, drag a note up or down to change its pitch, tap it for its length.
  - **Grid**: the bar as blocks on a grid of pitches and beats. Tap a cell to add a note, drag a block to move it, drag its end to change its length.
- **A bar always has a place for the next note.** An empty bar holds a whole-bar rest and shows a slot to tap.
- A slur, tie, crescendo or diminuendo that waits for its last note says so in a notice that stays in view while the user goes to another bar, with Cancel. Those that run across bars are listed with the bar, with keys to go to either end.
- **Marks** can be added in four ways: note first and then the mark; mark first and then every note that is tapped; sliding from one note to another for a slur, tie, crescendo or diminuendo; and a loudness strip under the grid.
- New marks that can be **added** (until now they could only be deleted, although playback follows them): loudness marks *pp* to *ff*, breath mark, caesura.
- **Bars** get new tools:
  - "Did you mean": a bar that does not add up offers the one-tap changes that would make it right.
  - Scissors between the notes add a bar line; "Join with next" removes one (both exist today as buttons).
  - Add an empty bar, delete a bar, make a bar the same as the bar before.
  - An **end bar line** as a fourth way a bar can end.
  - **First and second endings** ("1st time only", "2nd time only") can be added and removed.
- A first bar that is shorter than the time signature (a pickup) is no longer flagged as not adding up.
- The **line of the page photo** that holds the bar is shown again above the reading, and can now be opened large. It was removed on 2026-11-19 because it was too small to read.
- **Note names** become one app-wide setting: C D E F G A B or Do Re Mi Fa Sol La Si, both with the octave number (C4 = Do4). It is used wherever the app names a note.
- Everything the editor can do today stays: chords, two staves, voices, the part switch, triplets, grace notes, clef fixes, key, time and tempo, multi-measure rests, selecting and deleting any element, bar preview, undo and redo, the name of a new piece, Save & practice.

Not in this change: D.C., D.S., Coda and Fine; adding a key, time or tempo change in the middle of a piece; lyrics, fingering, chord symbols and new text; a keypad, handwriting, an on-screen piano or MIDI input; choosing between Notes and Grid.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `score-editing`: one bar at a time with a Notes and a Grid view; a bar always takes a note; four ways to add marks; loudness marks, breath mark and caesura can be added; end bar line and first and second endings; add, delete and copy a bar; suggested repairs; the photo line is back; a pickup bar is not flagged; bar numbers follow added and deleted bars.
- `app-shell`: Settings holds the note names; the app names notes by that setting everywhere.

## Impact

- **UI** (`web/src/ui/screens/editor/`): `Editor.tsx`, `NoteTab.tsx` and `MarksTab.tsx` are replaced by the new screen; `ScoreTab.tsx`, `ElementPanel.tsx` and `EditorScreen.tsx` stay with small changes. New: the Notes surface, the Grid surface, the overview line, the photo line, the trays.
- **Score logic** (`web/src/core/score/`): new operations in `edit.ts` (add a note to an empty bar, loudness marks, breath mark, caesura, endings, end bar line, add, delete and copy a bar, move a note in time); new pure modules for the grid, the suggested repairs and the note names; `warnings.ts` stops flagging a pickup bar; `model.ts` bar map covers added and deleted bars.
- **App** (`web/src/app/`): `editorSession.ts` (current bar, view, armed mark, photo of the bar), `settings.ts` (note names, last editor view), `library.ts` (pages, staves, practice position and loop follow added and deleted bars), `i18n/en.ts`.
- **Stored data**: `settings.json` gets two optional fields with defaults. `piece.json`, `practice.json` and the MusicXML keep their format.
- **Playback**: no change to the engine. Endings, loudness marks, breath marks and caesuras are already played.
- **Tests**: unit tests for the new pure modules and operations; the editor journey in `web/test/ui/edit.test.ts` is rewritten; the settings journey gets the new row.
- **Docs**: `docs/screenshots/edit-score.png` is replaced.
- No new dependency.
