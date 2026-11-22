# Design

## Context

See proposal.md for why. After `parts-and-accompaniment`:

- **The model** has parts, staves and voices (that change's D1). `voiceView(score, ref)` gives one voice in the old `Measure[]` shape, sharing its item arrays (D2). Note ids are unique in the whole score, and `noteIndex` finds a note's part, staff and voice.
- **The editor** opens the voice view of the first voice of your part (that change's D8). The time, key, clef and bar-line setters already work at the score level.
- **`edit.ts`** today:
  - chords are runs of notes where every note after the first has `chord: true` (`chordSpan`);
  - `deleteNote` lets the next chord note take over as the base;
  - `setDuration` and `insertNote` act on the chord through its base;
  - `noteToRest` refuses a chord member ("delete it instead");
  - hairpins start and stop on "melody notes", never chord members or grace notes.
- **Drawing:** Verovio draws each chord note as its own `g.note` inside a `g.chord` (seen in the `more-marks` check). Whether each keeps the model's note id, as single notes do today, is confirmed in task 3.2. If it does, a tap can resolve to one chord member. Today `scoreView.ts` maps a tap to the nearest `g.note` and the editor treats it as the whole chord's note.
- **Selection** (`editorSession.ts`): `{ bar, noteId }` or an element. The bar is an index into the shared bars.

## Goals / Non-Goals

**Goals:**
- Every note Snapsody keeps can be selected and corrected, in any part, staff, voice or chord.
- One-line pieces look and behave exactly as before: same labels, same tools, same tests.
- Each edit stays in one part, and score-level edits (time, tempo, bar lines, adding or removing a bar line) stay in sync across parts.
- A missed or extra bar line can be fixed without a new scan, and everything that counts bars (pages, photo lines, practice position, loop) follows.

**Non-Goals:**
- Adding or removing parts, staves or voices.
- Splitting a note into tied notes when a new bar line crosses it.
- Free voice reassignment: *To other hand* is the only move.
- Cross-staff notation.

## Decisions

### D1. The editor edits a part, not a voice

- **`EditorSession`** gets `part: string`. It starts as your part from `practice.json`, or the first part.
- **Drawing:** the editor draws that part only (`parts: [part]`), every staff and voice, with `multiRests: 'expand'` (`more-marks` D2).
- **The part switch** is a segmented control above the score, shown when the piece has more than one part. Switching keeps the undo history, because it is one history for the piece. Switching clears the selection.
- **Undo across parts:** an undo of an edit in another part switches to that part first, so the user sees what changed.

*Alternative:* draw every part in the editor, as the book does. Rejected: on a phone, a melody with a grand staff is three staves per line and the tools lose their room. The user also corrects one part at a time against the book.

### D2. Selection carries the voice, and a chord member

- **The selection** becomes `{ bar, noteId }` as today. Part, staff, voice and chord place are derived from `noteIndex(noteId)`, never stored twice.
- **Hit test:** `scoreView.ts` returns the `g.note` under the finger, which in a chord is the single member. A rest or a stem resolves to the chord's base note, as today.
- **The label** is built from the derived place:
  - `Bar {bar}`;
  - then `Right hand`, `Left hand` or the staff number, when the part has two staves;
  - then `Voice {n}`, when the staff has more than one voice;
  - then `Chord, note {i} of {n}`, counted from the bottom, for a chord member; or `Note {n}` / `Rest {n}`, counted in its voice.

  A one-line piece gives today's `Bar 2 · Note 3`. Hidden rests (`parts-and-accompaniment` D3) are not drawn, cannot be selected, and are not counted.
- **Highlight:** only the selected `g.note` is highlighted. Tools that act on the whole chord (D3) highlight the whole `g.chord` while their button is pressed.

### D3. Note tools on chords

| Tool | Acts on |
|---|---|
| Pitch up or down, accidental | the selected note only. A unison with another chord note is allowed (homr can read one). |
| Length, dots, triplet | the whole chord, through its base (as today) |
| Make rest | the whole chord: it becomes one rest of its length. This replaces today's refusal for a chord member. |
| Make note (on a rest) | as today |
| + Note before or after, + Rest before or after | the selected note's voice, next to the whole chord |
| Delete note | the selected note only; when it was the base, the next member takes over (as today). A lone note is deleted as today. |
| + Chord note (new) | adds a note a third above the chord's top note, diatonic in the key in force, with the chord's length and no accidental; selects it |
| To other hand (new, two-staff parts only) | see D4 |

### D4. To other hand

`moveToOtherStaff(score, noteId)` moves the selected note, or the whole chord when its base is selected, to the other staff's **first voice**, at the same start:
- **(a)** If that voice has a chord or note starting there with the same length, the moved notes join it.
- **(b)** If it has a rest that starts there with the same length, the rest is replaced.
- **(c)** Otherwise `EditError` with the explanation of the spec.

The source keeps a rest of the same length when the whole chord left, and nothing when only one member did. Slurs and ties on the moved notes are removed, and the other ends of them go with them, as `noteToRest` does today. Articulations stay.

*Alternative:* allow cross-staff notes (MusicXML `<staff>` per note within one voice). Rejected: the other parts of the app assume a voice belongs to one staff (`parts-and-accompaniment` D1).

### D5. Edits in a voice

Every note edit finds its voice from the note id and runs on `voiceView` (`parts-and-accompaniment` D2), so the existing edit code and tests apply per voice. The bar check after an edit runs on every voice of the edited bar.

The warnings carry `{ part, staff, voice }`. The text names the staff and voice only when the part has more than one, so one-line texts stay as they are. For example:
- `warning.bar-length.staff`: "Bar {bar}, {staff}, adds up to …"
- `warning.bar-length.voice`: "Bar {bar}, {staff}, voice {voice}, adds up to …"

### D6. Score tab and clefs

- **Key:** "Key" acts on the part being edited (`setKey(score, part, fifths)`), and its label says so when there are several parts ("Key of Piano").
- **Shared:** time signature, tempo marking and bar lines act on the shared bars, so every part follows.
- **Clefs:** a clef is selected on the score (`select-and-delete-elements`) and belongs to its staff. `clefAt`, `setClef` and `deleteClef` take `{ part, staff }`, and the drawn clef ids become `clef-<part>-<staff>-<bar>`. Fixing a clef re-reads the pitches of that staff only.

### D7. Marks per staff or voice

- **Slurs and ties** are chosen by two taps, as today, and both notes must be in one voice. Otherwise `EditError` with the spec's explanation.
- **Hairpins** start and stop on notes of one staff, in any of its voices, but never on chord members other than the base, or on grace notes (as today).
- **Dynamics** are items in the first voice of their staff (`parts-and-accompaniment` D1) and apply to the whole staff in playback. Changing or deleting one is unchanged.

### D8. Preview as practice plays it

"Preview bar N" builds the same merged timeline as practice (`parts-and-accompaniment` D6) from the edited score and the piece's practice state (your part, the parts that play along, your line on or off, the instrument). It plays bar N only. The preview backend loads the instruments that bar needs.

### D9. Add and remove a bar line

Bars are shared by all parts (`parts-and-accompaniment` D1), so both edits work on the score, across every part, staff and voice. They also apply to one-line pieces, which are one part with one voice.

- **`splitBar(score, noteId)`:**
  - The split point is the start of the selected note in its bar. A grace note's point is that of the note it leads to. The tool is not offered for the first item of a voice, as that would leave an empty bar.
  - In every voice, the items before the point go to the first bar and the rest to the second. A grace note at the point goes with the note after it.
  - An item that crosses the point:
    - a whole-bar rest becomes a whole-bar rest in both bars;
    - a hidden rest is split into two hidden rests;
    - any other rest is split into rests of standard lengths, the longest first;
    - a sounding note, a chord or any item of a triplet refuses the edit (`EditError` naming the part, staff and voice, as in D5).
  - The first bar keeps the clef, key and time changes and how the bar starts. The second bar gets how the bar ends, including an ending's stop. An ending that starts on the bar then covers both.
  - Slurs, ties and hairpins that now cross the new bar line stay as they are. Dynamics stay on their notes.
- **`joinBars(score, bar)`** joins bar `bar` with the next one:
  - Every voice is the first bar's items followed by the second's.
  - Two whole-bar rests become one. A whole-bar rest next to notes becomes a rest of the time signature's bar length, and the bar check marks the bar if it no longer adds up.
  - The joined bar keeps how the first bar starts and how the second ends. The signs between them (an end-repeat, a double bar line, a start-repeat) are dropped: removing the bar line is what the user asked.
  - It refuses (`EditError`) after the last bar, or when the second bar starts with a clef, key or time change, or with an ending. The user deletes those first (`select-and-delete-elements`), so nothing is lost silently.
  - It is not offered when the bar is the last of a staff box in the page's layout (`PageInfo.staves`) or of a page. A printed line always ends at a bar line, and the page and line ranges stay simple (D10).
- **Both:**
  - The printed bar numbers after the change are renumbered in order.
  - A split or join that touches the bars of a multi-measure rest clears its `multiRest`, as other edits do (`more-marks` D2).
  - The selection stays on the selected note, or on the joined bar.
  - The bar check (D5) runs on both bars, or on the joined one.
- **Where:** "Bar line before" sits on the Note tab, next to *+ Note before*. "Remove bar line" sits in the Marks tab's *Bar N* group, with the bar-line controls, so tapping a bar line leads to it.

*Alternative:* split a crossing note into two tied notes instead of refusing. Left out for now: after a missed or extra bar line, homr has misread the same place in every staff, so a crossing note is rare, and a tie the user didn't ask for is harder to notice than a refusal.

### D10. Keep bar numbers in step

Today `writeScore` never changes a piece's bar count, and each page and each staff box in `piece.json` holds a bar range (`PageInfo`, `Staff`). `practice.json` holds the bar the user was at and the loop.

- **Tracking:** while editing, each bar carries a transient `from: number[]`, the indices in the saved score of the bars it holds. A split gives both halves the same `from`; a join concatenates them. It lives in the score copies, so undo and redo keep it right with no extra work. It is never written to MusicXML.
- **The map:** at save, `from` gives for each saved bar the range of new bars that now hold it. It is a contiguous range because the edits keep the order.
- **`writeScore(id, musicxml, basedOn, barMap?)`** applies the map in the same atomic commit:
  - the piece's `bars`;
  - every page's and staff box's range: a range's first bar is the first new bar of its first old bar, and its last bar the last new bar of its last old bar. As joins never cross a page or staff-box end (D9), the ranges still follow each other and cover every bar;
  - `practice.json`: the bar is the first new bar of the old one, the loop start the first new bar of its start, and the loop end the last new bar of its end.
- `repairs` are a record of what reading changed and keep their bar numbers.
- Without bar-line edits the map is left out, and saving is as today.

## Risks / Trade-offs

- **[Risk] On a small screen, tapping one chord member is fiddly.** → The hit test takes the notehead nearest the finger vertically within the chord. Stepping the pitch up or down is the usual fix anyway. Checked by eye at 360 × 780 (task 6.2).
- **[Risk] The undo history across parts confuses the user.** → An undo switches to the part it changes (D1). A journey test covers it.
- **[Risk] *To other hand* refuses too often.** For example, the other hand has two eighth rests where a quarter note goes. → The refusal explains what is there. Merging rests is a possible follow-up, not needed for the common misread (a single note on the wrong staff).
- **[Trade-off] Only the edited part is drawn,** so a correction cannot be checked against the other part by eye. → "Preview bar" plays both, and the photo of the line is available as today.

- **[Risk] A practice write with the old bar numbers lands after the save.** For example, a delayed save of `practice.json` from the practice screen under the editor. → The router makes the practice screen again when it comes back, so it reads the new numbers. Task 5.3 checks that the practice session has written its settings before the editor opens, so nothing old is still waiting.
- **[Trade-off] A bar line at the end of a printed line can't be removed.** → A printed line ends at a bar line in the books this app is for. Allowing it would need a range rule for a bar split over two lines of the photo.

## Migration Plan

None. The stored format is the one of `parts-and-accompaniment`: `piece.json` and `practice.json` keep their shape, only their numbers follow.

## Implementation notes

Calls made while applying the change, where the code differed from what this design assumed.

- **`noteIndex` did not exist yet** (D2, D5). It is now `noteIndex(score)` in `model.ts`: id → part, staff, voice, bar and index in the voice's items, with `placeOfNote(score, id)` for one note.
- **Note edits take the whole score** (D5). Each note edit of `edit.ts` takes a `Score` or a voice view. Given a score, it runs on the view of the note's own voice (`voiceOfNote`). So the editor passes the score, and the tests of one voice keep passing a view. `EditSession.apply` hands the edit the whole score, and it checks the multi-measure rests of every part, not only of one voice.
- **Chords, as found in the code** (D3):
  - `setDuration` changed only the selected note, not the whole chord. It now sets every note of the chord.
  - Triplets counted each chord note as a note of the triplet. A chord now counts once, and its first note carries the bracket.
  - The "next note" of a chord note was its neighbour in the same chord. Now the next note is the next chord or note of the voice. A tie on a chord note goes to the note of the same step and octave in the next chord, so tie and untie also work on chord notes.
  - "Make rest" returns the rest's id (the chord's first note), so the editor selects it. Deleting a chord note selects the chord that is left.
- **Clefs, keys and element references** (D6):
  - Clef drawing ids are `clef-<part>-<staff>-<bar>` for every staff, the first part's too. Verovio keeps the id only on a clef change, so the first clef of a staff is still found by its place.
  - A clef reference carries its part and staff, and a key reference its part. A reference without them means the first part's first staff, so one-line code and tests keep working.
  - `describeElement` and `deleteElement` take the whole score. `mapElements` takes the drawn part, where the nth `g.staff` of a bar is the part's nth staff.
  - Setting or deleting a clef re-reads every voice of that staff. Setting a key re-reads every voice of the part.
- **Hairpins across voices** (D7): the MusicXML reader tied a hairpin's ends to first-voice notes only, so a hairpin ending in voice 2 lost its end on save. It now takes the note written right after the start and right before the stop, in any voice of the staff, which is where the writer puts them. The editor orders a staff's notes by bar, then start, then voice. A hairpin from a later voice back to an earlier voice of the same bar is refused: its stop would be written before its start and be lost on save.
- **The editor session** (D1, D2):
  - `EditorSession.part` replaces the fixed edited voice. Selecting a note of another part switches to it, so Next on a warning about another part shows that part. A bar warning switches too.
  - An undo or redo switches to the part whose bars it changed. One that changes every part, or the number of bars, keeps the part shown.
  - The label names the voice only when the staff has more than one voice with notes in that bar, so the left hand of a bar with one voice reads "Bar 5 · Left hand · …". Warnings name the voice by the same rule. A chord counts once in "Note n".
  - Highlighting the whole chord while a whole-chord tool's button is pressed (D2) is not done. The chord's notes all change, and the selected note stays highlighted.
- **Bar lines added and removed** (D9):
  - `splitBar(score, noteId)` returns the note's id; `joinBars(score, barIndex)` returns nothing. Both throw `BarLineError`, an `EditError` with a `reason` (`first`, `end`, `across`, `triplet`, `rest`, `last`, `clef`, `key`, `time`, `ending`) and the voice it is about, so the editor can show its own text. `splitPoint` and `canSplitBefore` hold the "not before the first note" rule for both the edit and the editor.
  - A grace note at the end of a bar, with no note after it, also gets no bar line before it (`end`).
  - The point between two notes of one triplet refuses, as an item across it does. Triplets are counted in runs, as `normaliseTuplets` brackets them, not read from the source's tuplet marks.
  - A rest across the point is split into plain whole, half, quarter, eighth, 16th, 32nd and 64th rests, longest first, in both bars. The first piece keeps the rest's id. A length these cannot make refuses (`rest`).
  - A voice that is one whole-bar rest becomes a whole-bar rest in both bars, whether or not it crosses the point. The first is as long as the point, the second as long as the longest voice from the point on, so "A missed bar line" leaves neither bar marked. A staff's first voice left with nothing in one bar gets a whole-bar rest there.
  - Printed numbers: every later bar whose number is a whole number moves by one, up for a split and down for a join, and the second bar of a split takes the first's number plus one. Other numbers ("12a") stay as they are.
  - Endings: the left bar line, with an ending's start, stays on the first bar and the right one, with its stop, goes to the second, so the ending covers both. An ending start written on the right bar line moves to the first bar's left bar line.
  - Joining also refuses when an ending stops at that bar line (on the first bar's right bar line), not only when one starts there: dropping it would change which bars are in the ending.
  - A join fills a later voice that is shorter in the first bar (or empty there) with a hidden rest up to the first bar's length, so the second bar's notes keep their place in time. A whole-bar rest next to notes becomes one rest of the bar's value (a whole rest in 4/4, a dotted half in 3/4), or rests of standard lengths when no single value fits. When two whole-bar rests become one, a hairpin on the second goes to the first.
  - Both edits clear the multi-measure rests over the bars they touch themselves: `EditSession` compares runs by bar index, which moves.
  - Both mark the triplets and work out the accidentals again in the bars they change, in every voice, so an accidental no longer carries across a new bar line and does across a removed one.
- **`from` is a span, not a list of indices** (D10): `Bar.from` is `[start, end)` on a line where the loaded bar `i` is `[i, i + 1)`. Absent on every bar means each bar is its own loaded bar, so the editor stamps nothing when it opens; the first split or join stamps every bar. A split cuts the span where the bar is split, in proportion to the bar's length; a join puts the two spans together. With a list of loaded indices, the two halves of a split bar had the same `from`, so after a save the next map could not tell them apart and mapped each to both. Two bars hold the same music when their spans overlap.
- **The bar map** (D10): `barMap(saved, current)` in `model.ts` maps each bar of the score as last saved to the current bars whose spans overlap its own, and is undefined when nothing moved. `EditorSession.save` passes it only when there is one, so a split that was undone saves as before. The saved score moves on as soon as `writeScore` succeeds, so a retry after a failed rename does not map again.
- **`writeScore(id, musicxml, basedOn, barMap?)`**: without a map it does exactly what it did. With one it checks the map (one range per bar, in order, from bar 1), carries the pages' and staff boxes' ranges over it and runs the page check before writing anything. It reads practice.json and writes the mapped one in the same change, before piece.json commits it, and puts the old text back when the change fails where the store can see it. A crash between the two writes leaves practice.json with the new numbers on the old score; a file can't be part of the piece.json commit without a new format, and practice.json is only a convenience. Only `bar` and `loop` change in it; a practice.json that is missing or does not read is left alone. A map that does not fit (a join across a page end made without the editor's check) is `invalid`; `save` reports it as `failed`, as only the rename's `invalid` means an empty name.
- **What the editor offers** (D9): `EditorSession.canAddBarLineBefore(noteId)` and `canRemoveBarLineAfter(barIndex)` (from 0, in the working score). The second matches the working bars to the piece as last saved through `from`: the bar line between the two halves of a split bar is never the end of a printed line, and any other bar line is not offered where a page or a staff box of the saved piece ends.
- **No old practice write after a save** (Risks, task 5.3): opening the editor over the practice screen unmounts it, and closing its session queues the practice.json write at once. The library runs its writes in order, so that write is done before any save of the editor maps the numbers. A library test pins this.
- **Bar-line refusals** say where (D9): "A note in the left hand sounds across that point…", "…in the melody…", or no place in a one-line piece. "Bar line before" sits in a third row of the Note tab, with "+ Chord note" and "To other hand", because the first row is full.
