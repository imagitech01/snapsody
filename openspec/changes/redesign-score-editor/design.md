# Design

## Context

See `proposal.md` for the motivation. What shapes the approach:

- The editor's state and rules live in `app/editorSession.ts` (`EditorSession`) and the score operations in `core/score/edit.ts`. The screen (`ui/screens/editor/Editor.tsx` with `NoteTab`, `MarksTab`, `ScoreTab`, `ElementPanel`) only draws them. This split stays.
- The score is drawn by Verovio through `ui/scoreIsland.ts` and `ui/scoreView.ts`. `core/score/elements.ts` (`mapElements`) maps what is drawn back to notes and elements, and `barExcerpt` in `editorSession.ts` already cuts one bar out of a score for the bar preview.
- The dead end named in the proposal: `insertNote(score, id, 'before' | 'after', …)` needs a selected note, and a bar whose notes were deleted has none.
- `mock.html` in this change folder is the interactive mock the user settled on (open it in a browser). It is the reference for layout, wording and gestures. It is a mock: it has one melody line, a stand-in engraver and no chords, staves, voices or triplets. Where this design and the mock differ, this design wins; the differences are named in D12.
- Things already true in the code, checked before writing this:
  - Playback already follows endings (`timeline.ts`), every loudness mark from *ppp* to *fff* (`DYNAMIC_GAIN`), breath marks and caesuras. `musicxml.ts` reads and writes `Barline.style` and `Barline.ending`, so an end bar line and endings survive a save.
  - `edit.ts` treats the style `light-heavy` as a double bar line (`DOUBLE_STYLES`), in the editor and in playback.
  - `timeline.ts` and `beams.ts` treat a short first bar as a pickup. `warnings.ts` does not: it flags it.
  - The page photos and the staff boxes (`PageInfo.staves`) are still stored with every piece, and `Files.imageUrl` still exists. Only the editor's use of them was removed on 2026-11-19 (`PhotoStrip.tsx`, `photoRegion.ts`, `EditorSession.photo`).
  - On save, `barMap(before, after)` in `model.ts` says where each old bar went, through `Bar.from`. It throws when an old bar is in no new bar, and `checkBarMap` in `library.ts` refuses a map with a gap. So it covers split and joined bars only.

## Goals / Non-Goals

**Goals:**

- No state in which a bar cannot take a note.
- Both views work on the same model through the same operations, so a mark or a triplet can never be lost by switching.
- Every new behaviour is a pure function that a node test can prove; the screen only maps gestures to those functions.
- Nothing the current editor can do is lost.

**Non-Goals:**

- Changing the playback engine or the recognition.
- Changing the stored piece format.
- A Grid that can draw everything. It is bounded (D4).
- Tuning the gestures for every phone. One manual check on a real phone is planned; more tuning is later work.

## Decisions

### D1. The screen

From top to bottom:

1. **Header**: Back, the title (as today, with "Name this piece" for a new piece), the check chip ("2 to check · Next"), Preview bar, Undo, Redo and the "Full score" key.
2. **Photo line** (D10).
3. **Overview**: the line of music that holds the current bar, drawn by the existing score island, small, with the current bar highlighted and the flags on it. A tap anywhere in a bar makes that bar current and selects nothing: the notes are too small to hit, and elements are selected in the large bar. Arrows at its ends move it one line.
4. **Bar row**: previous, "Bar 3 of 12", the beats chip ("3½ of 4 beats", green when it adds up), next, and the Notes | Grid switch.
5. **Suggested repairs** (only for a bar that does not add up), as chips.
6. **The surface**: Notes (D2) or Grid (D3).
7. **A one-line hint or message** (what a refused action says).
8. **Tools**: tabs Notes · Marks · Bars · Score, and the tray of the open tab.
9. **Save & practice**.

`Editor.tsx` is rewritten around this. `ScoreTab.tsx` (key, time, tempo, "Add pages") and `ElementPanel.tsx` (the selected clef, dynamic, slur and so on, with Delete) are kept. The part switch stays where it is today. `NoteTab.tsx` and `MarksTab.tsx` are replaced by the Notes, Marks and Bars trays.

The current bar is `EditorSession` state (a signal), not screen state, because warnings, the photo line and the preview all depend on it. Selecting a note sets the current bar to its bar; the current bar can also be set with no note selected. `selectBar` already exists; the new signal makes "no selection, but a current bar" a normal state.

**Full score** replaces everything between the header and Save & practice with the whole score of the part, drawn by the existing score island, scrolled to the current bar. A tap anywhere in a bar picks that bar and goes back to the bar view; a Back key goes back without picking. It selects no note and changes no session state except the current bar, so a selection, an armed mark and a waiting span survive it (D14). The user asked to keep it for getting to another section of a long piece.

**Decided while applying (2026-11-23), for the frame:**

- The "Full score" key sits at the end of the title row, not after Redo. At 360 px the check chip, Preview, Undo, Redo and "Full score" do not fit one row with 44 px touch targets.
- The check chip keeps a "Previous thing to check" key before it, as today's editor has. Both step from the current bar when nothing is selected.
- The line "You can return to edit this score at any time." under Save & practice is gone, for room (D13).
- With no refusal to show, the message line shows the current bar's warning text.
- A tap on a bar line opens the Bars tools, where the bar-line controls now are.
- When even the bar-number row leaves the large bar less than 170 px (a phone held sideways), the screen scrolls as a whole. D13 only covers the upright phone.

*Alternative considered:* the whole sheet as the start screen, as today. Rejected: the editor then has two modes with different tools, which is part of what felt clunky.

### D2. Notes is drawn by Verovio; a drag is drawn by an overlay

The large bar is rendered by Verovio from a one-bar excerpt of the part being edited, at a scale that fills the width. Taps are mapped with `mapElements`, as today. This gives chords, two staves, voices, triplets, grace notes, clefs and marks without new drawing code, and they look exactly as in practice.

**Decided while applying (2026-11-23), for the Notes surface:**

- The selected note's name and length, with Shorter and Longer, are the first row of the Notes tray (two − / + steppers), not a bubble under the bar: a row of its own would cut into the 170 px of the large bar (D13). Pitch down and up stay as keys beside the drag, and a Natural key is added.
- A tap on an empty place of the bar also deselects a note, so the tools return to "what a tap adds".
- The pitch drag works with the Notes tools open. A drag starts after 8 px, and counts as a pitch drag when it is mostly up or down.
- A tap's pitch is read with the clef in force at the start of the bar; a clef change inside the bar is not followed.
- A bar inside a longer "1st time only" or "2nd time only" stretch shows its bracket in the large bar, left open at the end when the stretch goes on (display only).
- The sound of the first step of a drag can be lost in a browser that only allows sound after a tap; on the phone the app is not held to that.

`barExcerpt` was made for the audio preview: it keeps the clef, key and time in force, but drops the bar lines, the endings and the hairpins that reach outside the bar. The large bar needs a second variant, `barForEditing`, that keeps the bar's own bar lines and endings (so a bar line can be tapped and a bracket is seen) and drops, like the preview, what reaches outside the bar: hairpins, and the slur and tie flags of notes whose partner is in another bar. Those are not lost from view: the Marks tray lists every slur, tie and hairpin that touches the bar, with a remove control (spec "Slurs and hairpins of the bar"), as the mock does, and the overview draws them.

A tap on the staff where there is no note adds a note at that place in the order, as in the mock: on the staff that was tapped, in the voice of the selected note when it is on that staff, else in the staff's first voice. The new note can be dragged to its pitch before the finger lifts; the tap and the drag are one undo step.

A pitch drag must feel immediate, and a Verovio render per step may be too slow on a phone. So:

- While a note is dragged, an overlay draws a ghost notehead that snaps to staff steps. The step size and the staff position come from the staff lines of the rendered SVG. The note's name is shown beside it and its sound is played on each step (the editor's preview sound).
- On release, the pitch change is applied once (one undo step) and the bar is rendered again.

The first task measures how long Verovio takes to render one bar in browser-dev and on the emulator. If it is under about 30 ms, the overlay can be replaced by live re-rendering later; the overlay is built either way, so the measurement decides nothing in this change. It is recorded in the change's `evidence/`.

The slot for the next note is an overlay too: a dashed box after the last note or rest of each voice that is short, placed from the rendered positions. It only marks the place: a tap in it is a tap after the last note, which calls `appendNote` (D5) with the pitch of the staff step under the finger. It is shown for the first voice of each staff; a short later voice is legal today and stays as it is. A bar without notes is rendered with its whole-bar rest and the slot.

Gesture rule for a drag that starts on a note: nothing happens until the finger has moved 8 px; then the larger axis decides. Vertical is a pitch drag. Horizontal is a slide to another note (a slur, or the armed span). The decision is not changed during the gesture. The surface has `touch-action: none` and uses pointer capture, as the mock does.

*Alternative considered:* a hand-written engraver for the large bar, as in the mock. Rejected: it would have to re-implement chords, beams, voices and every mark, and would look different from practice.

### D3. Grid is drawn by the app from a pure model

Grid does not use Verovio. A new pure module `core/score/grid.ts` turns one voice of one bar into a description: the rows (staff steps with their note names), the columns (sixteenths, from the time signature), the blocks (start, length, row, locked or not, staccato, accent) and the loudness strip. The screen draws that description as SVG and turns gestures into the operations of D5.

- Rows are staff steps in the key, like the lines and spaces of the staff, so a row never needs an accidental to exist. An accidental is shown in the block's label and set in the Notes tools.
- The rows cover the bar's notes plus three steps above and below, at least an octave, and grow by a step when a block is dragged to the edge. There is no vertical scrolling, so a vertical drag is never ambiguous.
- Which staff and voice: the voice of the selected note, else the first voice of the first staff. A chip above the grid names it ("Left hand", "Voice 2") and switches it when the part has more than one.
- The other voices of the staff are drawn as faint blocks that cannot be touched.

### D4. What Grid cannot draw

A sixteenth grid cannot hold a triplet, a grace note or anything shorter than a sixteenth. Those are drawn as locked blocks (hatched), at their real place and length for a triplet, as a thin mark for a grace note. A gesture on one does nothing and shows "Edit triplets and grace notes in Notes".

The rule that makes this safe: Grid never rewrites a bar. Every Grid gesture is one operation of D5 on one note (add, move, change length, change pitch, delete). The rests between the notes are recomputed by that operation for the gaps it touched only. So a locked note, another voice and every mark stay untouched by construction. A move or a length change that would overlap a locked note is refused like any other overlap.

*Alternative considered:* a finer grid when the bar has triplets. Rejected for now: twelve and sixteen do not share a grid without 48 columns, which is too fine to touch.

**Decided while applying (2026-11-23), for the Grid (group 8):**

- A cell is one sixteenth wide (the width after the row names, shared by the columns: about 18 px in 4/4 on a phone) and one staff step high, between 16 and 26 px, as the mock's 16 px rows. When the rows do not fit at 16 px (a piano bar), they scroll inside the Grid, by the row names at the left, which take no Grid gesture; the beat numbers and the loudness strip stay. The cells take every touch, so a vertical drag on them is never a scroll. This replaces "there is no vertical scrolling" in D3.
- A drag on a block decides its way after 8 px by the larger axis, as in Notes (D2): up or down is a pitch change, sideways a move. Not both in one gesture, so each gesture stays one operation (D4). A drag from the block's end changes its length to the longest note value that ends at or before the column line nearest the finger.
- The block is drawn where it would go while the finger is down; the session makes the change on release, or refuses it and the block is drawn where it was, with the reason on the message line. A locked block does not follow the finger; the release says "Edit triplets and grace notes in Notes."
- A tap on a block selects its note, a locked one too, so the Notes tools can change it; with a mark armed it paints it, as in Notes. A tap on an empty cell adds what a tap adds only with the Notes tools open and no mark armed; else it puts the selection away. Drags work with any tools open.
- The voice chip is a native choice ("Left hand", "Left hand, voice 2", "Voice 2") above the beat numbers, shown only when the part has more than one staff or voice.
- A tap or slide on the strip under no note says "Loudness goes under a note." A slide that ends between two notes ends on the nearest one.

### D5. New operations in `edit.ts`

All pure, all on `Score | VoiceScore` like the existing ones, all throwing `EditError` with a reason the screen can explain:

- `appendNote(target, where: VoiceRef, bar, what)`: adds a note or rest at the end of a voice's bar; in a bar that holds only a whole-bar rest, replaces that rest. This is what removes the dead end.
- `deleteNote` changes: when the first voice of a staff's bar has no item left, it gets a whole-bar rest, written the way `splitBar` writes one for the other parts. Today `deleteNote` leaves the list empty, which is the dead end. A later voice may stay empty.
- `placeNote(target, where, bar, start: Frac, length, pitch)`, `moveNote(target, id, start: Frac)`, `resizeNote(target, id, length: Frac)`: the Grid's add, move and change length. Each refuses an overlap and fills the gaps it leaves or makes with rests of standard lengths, split at the beats.
- `setDynamic(target, noteId, mark | undefined)`: one `DynamicItem` directly before the note, in the note's staff (spec "Marks belong to a staff or voice"); replaces or removes the one there.
- `toggleBreath`, `toggleCaesura`: the `breath` and `caesura` flags that `Note` already has.
- `setEnding(score, bar, 1 | 2 | undefined)`: see D7.
- `setBarEnd` gets a fourth choice `'final'`: style `light-heavy` without a repeat. `barLinesOf` reports `'final'` for it instead of `'double'`. `DOUBLE_STYLES` keeps it, so playback still goes back to it like a double bar line.
- `addBar(score, bar, 'before' | 'after')`, `deleteBar(score, bar)`, `copyBarBefore(target, where, bar)`: see D8 for the numbering. `addBar` and `deleteBar` work on `score.bars` and every part, like `splitBar` and `joinBars`. `copyBarBefore` works on the part being edited only, and gives the copied notes fresh ids (`freshId`).

The existing operations are used unchanged for everything else, including `splitBar` (scissors) and `joinBars` ("Join with next").

### D6. Suggested repairs

A new pure module `core/score/suggest.ts`: `suggestRepairs(score, where, bar): Suggestion[]`. It tries a fixed list of single changes on a copy of the voice's bar and keeps those after which the bar adds up:

1. one note or rest dotted, undotted, halved or doubled;
2. one rest removed;
3. a rest of the missing length added at the end (only when the missing length is one standard length);
4. a bar line where the bar is exactly two bars long and a note starts at the middle (`canSplitBefore`);
5. joining with the next bar when the two together add up (`canRemoveBarLineAfter`).

Order: first the changes that touch no note (3, then 4, then 5), then 1 and 2 from the left of the bar. At most four are returned, so that in a bar of three quarter notes in 4/4 the added rest is offered next to "quarter → half" for each note. The mock's `fixes` function is the model for the labels ("E4 (1) → dotted quarter": the note's name and its place in the bar). Each suggestion carries the operation to run and the parts of its label (note id, kind of change), so the screen builds the text with the note-name setting (D9).

It does not guess beyond one change. That keeps it predictable, and a wrong guess costs one Undo.

**Decided while applying (2026-11-23), for the Bars tools and the suggested repairs:**

- One row above the large bar shows, in this order of priority: the notice of a waiting slur or hairpin, a refusal, the suggested repairs, the warning's text. So a bar that does not add up shows its repairs and the beats chip ("3½ of 4 beats"), not the warning sentence. The row is as high as an empty one, so the large bar does not move; the chips scroll sideways.
- A key that cannot be used now (Delete bar, "Join with next") is drawn off but still takes a tap, and the tap says why on the message line.
- The repeat count is shown off, not hidden, when the bar does not end with a repeat.
- A scissors mark is 44 px high to touch. It is 44 px wide where the notes leave room; between close notes (eighths, sixteenths) each mark gets half the distance to its neighbour.
- In Grid the scissors show the places of the voice shown; in Notes, of every voice of the part.

### D7. Endings

`Barline.ending` already exists (`number`, `type: 'start' | 'stop' | 'discontinue'`) on the left bar line of an ending's first bar and the right bar line of its last. `setEnding(score, bar, n)` works on a derived view: for each bar, the ending number it lies in (the function that `timeline.ts` already has for playback is moved to `core/score/` and shared).

- Setting 1 or 2 on a bar changes that view for the one bar, then writes the bar lines again for the run of neighbouring bars with the same number: `start` on the first, `stop` on the last for a first ending, `discontinue` on the last for a second ending.
- When a first ending's last bar has no end-repeat, `setBarEnd(…, 'repeat')` is applied in the same undo step.
- 2 is refused unless the bar before lies in ending 1 or 2.
- An ending whose number is not "1" or "2" (for example "1, 2") is shown with its number and can only be removed.

**Decided while applying (2026-11-23), for the Marks tools:**

- A lit Slur, Tie, Cresc. or Dim. key on a selected note removes that mark from the note (spec: "Tapping an active mark SHALL remove it"); it does not arm. So a note that already ends a slur starts a new one mark first, or by a slide.
- A mark stays armed after its slur or hairpin is added, until it is tapped again or another tab is opened.
- While a slur or hairpin waits for its last note, a refusal takes the notice's place for that moment, beside Cancel. A second row would push Save & practice off the screen on a piano bar (D13).
- The hints of an armed mark are the first line of the tray, not the message line.
- The marks of a note are five keys across, so the words fit; Arpeggio has a key, off for a single note.
- The slide with an armed tie, crescendo or diminuendo is proven in the quick layer; the browser journey slides a slur.

### D8. Bar numbers after added and deleted bars

`Bar.from` (the stretch of the loaded score a bar holds) stays the basis. Two additions:

- An added bar gets an empty stretch at the place it was added (`from: [k, k]`), an id that is unique in the session, and the side it was added on.
- `barMap` returns, for each old bar, its new range or `null` when no new bar holds its music, and a list of the added bars with the old bar each one belongs to. It no longer throws for a deleted bar.

`library.ts` uses it like this (`mapRange`, `mapPractice`, `checkBarMap`):

- A page or staff range goes from its first surviving old bar's first new bar to its last surviving old bar's last new bar, and is extended by the added bars that belong to one of its old bars. The ranges of the pages still cover the piece without gaps, which `checkPages` keeps checking.
- A staff with no surviving bar is dropped from `PageInfo.staves`. A page always keeps a bar, because Delete is not offered for the only bar of a page (the session checks this against the piece as last saved plus the edits so far).
- The practice bar moves to the next surviving bar, else the last bar. The loop keeps its surviving bars; with none, `loop` is removed from the practice state.

A second save in the same session (for example after a rename that failed) maps from the score as last saved, which may itself hold added bars. That is why an added bar carries an id: an added bar of the saved score maps to the bar with the same id in the working score, or to nothing when it was deleted since. `from` keeps counting in the score as loaded, so nothing is rebased and undo across a save keeps working.

`checkPages` only requires that the pages cover the piece without gaps; the staves of a page do not have to, so dropping a staff keeps a piece loadable.

**Decided while applying (2026-11-23), after a review of the first version found overlapping lines and refused saves:**

- `library.ts` does not map each range by its ends. It gives every new bar one owner, an old bar (an added bar: the bar it belongs to; else the first old bar that holds it), keeps the owners in order from left to right, and a page or line is the new bars whose owner lies in it. So the pages and the lines of a page cannot overlap or leave a gap.
- A line keeps an added bar also when the bar it was added next to is deleted (the spec: an added bar belongs to the printed line of the bar it was added next to). A line is dropped only when it holds no bar at all.
- The practice bar on a deleted bar moves to the first bar that follows its place, which can be a bar added there.
- A bar of the working score that the score as last saved does not hold and that has no owner there (a deleted bar brought back by an undo after a save) belongs to the bar before it. Known limit: when it was the first bar of its page or line, it lands on the page or line before. `from` cannot say where it sat. The data stays consistent. After such an undo a save can still be refused for a page left without bars or a join across a page; the session's checks (task 5.3) must not offer those.
- Two bars joined across the place of a deleted bar hold that bar's stretch too, so a loop on the deleted bar alone becomes the joined bar and is not cleared.
- Delete bar is a little stricter than "not the only bar of a page": a page must also keep a bar that was not added in the session. Else "add a bar, delete the page's other bars, save, undo" leaves a score the library refuses to save. "Join with next" and Delete are both checked by trying the edit on a copy against what the library would write (`barsAfterSave`), so the editor never offers what a save refuses.
- Suggestion labels carry the note's place in the bar, as D6 and the mock say ("E4 (1) → dotted quarter"); the spec scenario writes it without the place.
- An ending that runs over more than one bar: Verovio draws a bracket in a one-bar excerpt only when the ending starts and ends in that bar. How the large bar shows it is decided with the screen (group 6).

`piece.json` and `practice.json` keep their shape, so no compatibility folder under `web/test/fixtures/stores/` is needed. The bar map is passed in memory and never stored.

### D9. Note names

A new pure module `core/score/noteNames.ts`: `noteName(pitch, style)` and `midiNoteName(midi, style)` with `style: 'letters' | 'solfege'`. It replaces `pitchName` and `midiName` in `repairs.ts`. Octave numbers are the same in both styles (C4 = Do4), accidentals are ♯ and ♭ after the syllable.

`SettingsData` gets `noteNames: 'letters' | 'solfege'` (default `'letters'`) and `editorView: 'notes' | 'grid'` (default `'notes'`). `normaliseSettings` fills both for an older `settings.json`, so no migration is needed. Settings shows the note names as a two-way choice between the default instrument and the count-in.

The warnings are built in two places: `warnings.ts` writes an English `message`, and `app/i18n/index.ts` builds the shown text from the warning's fields. The shown text takes the style from the settings; the `message` field keeps letters (it is for logs and tests).

### D10. The photo line comes back

This reverses a decision of 2026-11-19 ("the photo strip is too small to read"). The user saw the line again in the mock, as a drawing, and kept it. Two things are different from the strip that was removed:

- It can be opened large: a tap shows the line over the editor, where it can be pinched and dragged. The small line is only the reminder of where you are.
- It no longer shares its room with the Preview button, and the editor below it shows one bar, so the line gets the full width.

`EditorSession` gets the photo of the current bar back (page number and staff box, from `PageInfo.staves`, through the bar numbers as last saved plus D8's map for unsaved bar changes) and `photoUrl`. The crop is CSS on the page image, as the removed `photoRegion.ts` did; its logic can be taken from git history (commit `9ca7862^`).

It is the last task group, so it can be dropped without touching the rest.

**Decided while applying (2026-11-23), for the photo line:**

- The line is 44 px high, not the 40 px of D13, so it is a full touch target.
- When room is short the screen gives way in this order: the overview becomes the bar-number row; then the photo line becomes a "Photo" key in the title row, before "Full score"; then the screen scrolls. A two-staff part always gets the key. The key is not in the bar row: that row has 30 px to spare at 360 px.
- The large view shows the whole page photo, opened on the line with the line framed, so the lines around it can be read too. The mock shows the line alone.
- An added bar shows the line of the bar it was added next to; both halves of a split bar keep their line. When a save would be refused (D8's known limit), the line is taken from the pages as last saved and can be a neighbouring one.
- The frame measures only after the overview has drawn its first line, and needs 2 px to spare before it goes back to a fuller layout; without these the layout could flip without end.

### D11. A pickup bar is not flagged

`voiceWarnings` in `warnings.ts` skips the bar-length warning for bar index 0 when the bar is shorter than the time signature. A first bar that is too long is still flagged. `suggestRepairs` returns nothing for a bar without a warning, so a pickup gets no suggestions.

Trade-off: a first bar that is short because a note was misread is no longer flagged. That is accepted, because the player already plays every short first bar as a pickup, so the flag told the user something the app did not act on.

### D12. Where this differs from the mock

- A fourth tab, **Score**, holds key, time, tempo and "Add pages" (today's `ScoreTab`). The mock opened a sheet from a tap on the clef; a tap on a clef, key or time signature keeps selecting it, as the spec says.
- The Bars tab has "+ Bar before" and "+ Bar after" where the mock had "+ Empty bar".
- "Play 3×" is the existing repeat count (2 to 8) next to the end-repeat, not a key of its own.
- There is no "Short first bar" key (D11).
- The mock's page-level note-name switch is the Settings row.
- The mock's Save key says a short bar is filled with rests. The app does not do that: a short bar stays flagged and is saved as it is, as today.
- The mock's Reset key is for trying the mock; the app has Undo and "discard edits" on leaving.
- The mock's loudness strip steps a note with *pp*, *mp* or *ff* to no mark; the app does the same, and those three are set in the Marks tray.

### D14. A span that waits for its last note, and spans longer than the view

The waiting span is session state (`pending: { kind, from: noteId }`), not screen state, so it survives going to another bar and the full score. While it is set:

- A notice row sits directly above the surface: "Slur from bar 2 · tap the last note" and Cancel. It takes the row of the suggestion chips and the message line (D13), which are hidden meanwhile.
- The first note is drawn as picked in the large bar, in the overview and in the full score, when it is in view.
- Previous, next, a tap in the overview, the line arrows, the full score and stepping to a warning do not cancel it. Cancel, a second tap on the armed mark, and opening the Notes or Bars tools do.
- The two notes may be tapped in either order; `compareInTime` puts them in order, as the editor does today.

For a span that is already there and reaches outside the current bar: `barForEditing` (D2) cannot keep a slur whose other note is not in the excerpt. So the screen draws it itself as an overlay on the large bar: an arc (or the hairpin's lines) from the note where it starts or from the left edge, to the note where it ends or to the right edge, in the selection colour's muted tone. It is a hint, not Verovio's engraving, and it is not tappable; the Marks tray's list is where it is removed and where its two "go to" keys are (`core/score/` gets a pure `spansOfBar(score, part, bar)` that both use).

*Alternative considered:* show two or more bars in the large view while a span is being made. Rejected: the bars get too small to touch, and a span can be longer than any view.

### D13. Fitting 360 × 780

The mock was checked at 400 × 880 with one staff. The app is checked at 360 × 780 and has a title, a fourth tab and piano bars. The rules:

- The screen does not scroll as a whole, because the surface takes every touch (`touch-action: none`).
- Fixed heights: header (title row plus the row with the check chip, Preview, Undo and Redo), bar row, tabs, Save & practice.
- The photo line is 40 px high. In a two-staff part it is a "Photo" key in the bar row instead, which opens the large view.
- The overview is one line of music at the island's smallest readable scale; in a two-staff part it shows both staves.
- The tray has a fixed height of three rows of keys and scrolls inside itself when it holds more.
- The surface gets what is left, with a minimum of 170 px. When that minimum does not fit (a piano bar on a small phone), the overview gives way first: it shrinks to a row of bar numbers with the flags.
- The suggestion chips, the message line and the waiting-span notice (D14) share one row: the notice comes first, then a message, then the chips.

## Risks / Trade-offs

- [The slide for a slur and the drag for a pitch are told apart by the first 8 px] → The rule is one constant; it is checked by hand on a real phone, and the two-tap way stays for every span.
- [Verovio renders the bar again after every edit, which may flicker] → The island already swaps the SVG in one step; the first task measures the time.
- [Grid looks like it can do everything, and then a triplet does not move] → Locked blocks look different (hatched) and say where to edit them.
- [Suggested repairs offer a change that adds up but is not what the book says] → At most four (D6), each named, one Undo away; the photo line is right above.
- [Deleting a bar is a large change for one tap] → It is one undo step, and Delete sits apart from the other bar keys, in the warning colour.
- [The editor journey test (`web/test/ui/edit.test.ts`, about 1200 lines) is tied to the old screen] → It is rewritten group by group with the screen, not at the end; the tests of behaviour that does not change (naming, saving, conflicts, parts) keep their bodies and get new selectors.
- [The photo line may again be judged too small] → It is the last group and independent (D10).

## Migration Plan

No data migration. `settings.json` gains two optional fields with defaults. The old editor screen is replaced in one change; there is no setting to go back to it. Rollback is reverting the change: pieces saved by the new editor stay readable, because the MusicXML uses only elements the reader already knows (`<ending>`, `<bar-style>`, `<dynamics>`, `<breath-mark>`, `<caesura>`).

## Open Questions

- Whether Notes can re-render live during a pitch drag instead of using the overlay. The measurement of the first task answers it; it does not change the tasks.
