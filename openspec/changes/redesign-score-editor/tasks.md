# Tasks

Layers are those of `docs/testing.md`: **quick** (`make test-quick`, node unit tests) and **browser** (`make test-browser`, journeys in headless Chromium). `mock.html` in this folder is the reference for layout, wording and gestures; `design.md` D12 lists where the app differs from it.

## 1. Measure and prepare

- [ ] 1.1 Measure how long Verovio takes to render one bar (`barExcerpt`) of a one-line piece and of a piano piece, in browser-dev and on the emulator, and write the numbers to `evidence/render-one-bar.md` in this change (design D2). Verify: the file exists with both numbers. Manual.
- [x] 1.2 Move the function that gives each bar its ending numbers from `core/playback/timeline.ts` to `core/score/` and use it from both. Verify (quick): `web/test/timeline.test.ts` passes unchanged.
- [x] 1.3 Add `barForEditing` next to `barExcerpt` (design D2): the bar with its own bar lines and endings, without what reaches outside it. Verify (quick): `web/test/editorSession.test.ts` proves the bar lines and an ending are kept, a hairpin and a slur into the next bar are left out, and the score itself is unchanged.

## 2. Note names

- [ ] 2.1 Add `core/score/noteNames.ts` (`noteName`, `midiNoteName`, styles `letters` and `solfege`) and use it where `pitchName` and `midiName` are used, in `describeNote` (`ui/scoreView.ts`) and in `EditorSession.noteLabel`; remove those two from `repairs.ts`. Grep for other places that build a note name from `pitch.step` and route them through it. Verify (quick): new `web/test/noteNames.test.ts` proves C4 = Do4, B♭3 = Si♭3, F♯5 = Fa♯5 and every step of the scale in both styles.
- [ ] 2.2 Add `noteNames` and `editorView` to `SettingsData`, with defaults in `DEFAULT_SETTINGS` and `normaliseSettings`, and setters on `Settings`. Verify (quick): `web/test/settings.test.ts` proves a `settings.json` without the fields loads with `letters` and `notes`, and that both are kept after a save and a load.
- [ ] 2.3 Build the shown warning texts in `app/i18n/index.ts` with the style from the settings. Verify (quick): `web/test/i18n.test.ts` proves a range warning reads "Do6" and names the ends of the range with do re mi when the style is `solfege`.
- [ ] 2.4 Add the "Note names" row (C D E | Do Re Mi) to the Settings screen between the default instrument and the count-in, with its English texts. Verify (browser): `web/test/ui/settings.test.ts` chooses "Do Re Mi", restarts the app and finds it chosen. Check the screen by eye at 360 × 780 (manual).

## 3. Score operations

- [ ] 3.1 `appendNote`, and `deleteNote` leaving a whole-bar rest when the last note of a bar goes (design D5). Verify (quick): `web/test/edit.test.ts` proves "empty a bar and fill it again", a first note replacing the whole-bar rest, and an append in voice 2 leaving voice 1 alone.
- [ ] 3.2 `setDynamic`, `toggleBreath`, `toggleCaesura`. Verify (quick): `web/test/edit.test.ts` proves add, change and remove of a loudness mark in the note's staff; `web/test/musicxml.test.ts` proves each survives writing and reading; `web/test/timeline.test.ts` proves an added *p* lowers the gain from its note on.
- [ ] 3.3 `'final'` as a bar end in `setBarEnd` and `barLinesOf`. Verify (quick): `web/test/edit.test.ts` proves it is stored as `light-heavy` without a repeat, reported as `final`, and keeps an ending; `web/test/timeline.test.ts` proves a later end-repeat goes back to it.
- [ ] 3.4 `setEnding` (design D7). Verify (quick): `web/test/edit.test.ts` proves the scenarios of the spec's "First and second endings" and "Endings stay in order" on the bar lines; `web/test/timeline.test.ts` proves the bar order 1, 2, 3, 4, 1, 2, 3, 5 for the first scenario.
- [ ] 3.5 `addBar`, `deleteBar` and `copyBarBefore`, with `Bar.from` for an added bar (design D5, D8). Verify (quick): `web/test/edit.test.ts` proves every part gets and loses the bar, a slur with an end in a deleted bar is removed, a copied bar has fresh ids, its marks and its inner slurs, and the other part is unchanged.
- [ ] 3.6 `barMap` for added and deleted bars, and its use in `library.ts` (`checkBarMap`, `mapRange`, `mapPractice`, dropped staves). Verify (quick): `web/test/model.test.ts` proves the map for an added, a deleted, a split and a joined bar in one edit; `web/test/library.test.ts` proves the three new scenarios of the spec's "Bar numbers follow a bar-line change" that the pages still cover the piece without gaps, and that a piece with a dropped staff loads again.
- [ ] 3.7 The pickup bar is not flagged (design D11). Verify (quick): `web/test/warnings.test.ts` proves a short first bar gives no warning, a long first bar does, and a short second bar does.

## 4. Grid model and suggested repairs

- [ ] 4.1 `placeNote`, `moveNote` and `resizeNote` in `edit.ts`, refusing overlaps and filling gaps with rests of standard lengths split at the beats. Verify (quick): `web/test/edit.test.ts` proves the scenarios of the spec's "Edit notes in Grid" and "Grid keeps the bar in order", and that marks and other voices are unchanged after each.
- [ ] 4.2 `core/score/grid.ts`: the description of a voice's bar (rows, columns, blocks, locked blocks, the loudness strip). Verify (quick): new `web/test/grid.test.ts` proves 16 columns in 4/4 and 12 in 6/8 with their beats, the rows around the notes, a triplet and a grace note as locked blocks, staccato and accent on the blocks, and the strip's marks and hairpins.
- [ ] 4.3 `core/score/suggest.ts` (design D6). Verify (quick): new `web/test/suggest.test.ts` proves the four scenarios of the spec's "Suggested repairs", the order and the limit of four from design D6, none for a bar that adds up, and none for a pickup bar.

## 5. Editor session

- [ ] 5.1 The current bar as session state: opening on the first warning or bar 1, previous and next, set by selecting a note or stepping to a warning, kept in range after bars are added or deleted. Verify (quick): `web/test/editorSession.test.ts`.
- [ ] 5.2 The view (Notes or Grid, read from and written to the settings), the Grid's staff and voice following the selection, what a tap adds (length, dot, note or rest), and the armed mark with its disarm rules. Verify (quick): `web/test/editorSession.test.ts`.
- [ ] 5.3 Session actions for every new operation, each one undo step, with the refusals turned into messages: add a note at the slot, the Grid gestures, loudness marks, breath, caesura, endings, end bar line, add, delete and copy a bar (Delete not offered for the only bar of a page or piece), apply a suggestion. Verify (quick): `web/test/editorSession.test.ts` proves one undo step each and the two "not offered" cases.
- [ ] 5.4 Save with added and deleted bars passes the new bar map to the library, also on a second save in the same session (design D8). Verify (quick): `web/test/editorSession.test.ts` proves a save after "add a bar, delete another" writes the pages and the loop of the spec's scenarios, and that a second save in the same session, after one more deleted bar, maps from the first save and not from the loaded score.
- [ ] 5.5 The waiting span as session state (design D14): set by the first tap, kept through every way of going to another bar, ended by the last note, Cancel, a second tap on the mark or another tab; and `spansOfBar` for the spans that begin, end or pass in a bar. Verify (quick): `web/test/editorSession.test.ts` proves the four scenarios of the spec's "A mark that waits for its last note"; `web/test/edit.test.ts` proves `spansOfBar` for a slur that starts in, ends in and passes through a bar.

## 6. The new screen: frame and Notes

- [ ] 6.1 Rewrite `Editor.tsx` as the frame of design D1: header with the check chip, Preview, Undo and Redo; the overview line with its line arrows; the bar row with the beats chip and the Notes | Grid switch; the message line; the four tabs; Save & practice. Keep the title and naming of a new piece, the part switch, `ScoreTab` and `ElementPanel`. Add the English texts. Verify (browser): in `web/test/ui/edit.test.ts`, the journeys for naming, renaming, conflicts, Cancel and back, Save & practice, "Add pages", the Score tab and the part switch pass on the new screen, the layout follows design D13 at 360 × 780 for a one-line piece and a piano piece (checked by eye, manual), and a new journey proves the scenarios of "One bar at a time" and "Go to another bar".
- [ ] 6.2 The Notes surface: the bar rendered large from `barExcerpt`, tap to select with name and length, Shorter and Longer, the slot overlay, a tap on the staff to add a note at that place (between two notes, at the end, in the staff tapped) with the drag that follows it, the pitch drag with the ghost notehead, the note name and the sound (design D2). Verify (browser): a journey in `web/test/ui/edit.test.ts` empties a bar, fills it again through the slot, adds a note between two notes, drags a note one step down, and finds the stored score changed accordingly.
- [ ] 6.3 The Notes tray (lengths, dot, triplet, note or rest, accidentals, insert before and after, delete, chord note, to other hand), acting on the selection or on what a tap adds. Verify (browser): the journeys for rests, inserts, deletes, triplets, chord notes and "To other hand" in `web/test/ui/edit.test.ts` pass on the new tray.
- [ ] 6.4 Selecting and deleting any element in the large bar, with `ElementPanel`; a tap in the overview only makes its bar current. Verify (browser): the journeys for the clef, the slur, the trill, the arpeggio and the bar line in `web/test/ui/edit.test.ts` pass.
- [ ] 6.5 Check the frame and Notes by eye in browser-dev at 360 × 780, with a one-line piece and a piano piece, in both note-name styles. Manual.
- [ ] 6.6 "Full score" in the header: the whole part in place of the bar view, scrolled to the current bar; a tap in a bar picks it and goes back; Back keeps the bar. Verify (browser): a journey in `web/test/ui/edit.test.ts` proves the scenarios of the spec's "Full score", with a piece long enough to scroll.

## 7. Marks

- [ ] 7.1 The Marks tray: the articulations and ornaments of today, arpeggio, breath, caesura, slur, tie, Cresc., Dim. and *pp* to *ff*; note first (active marks lit) and mark first (armed, painted on every tapped note, disarmed by a second tap or another tab). Verify (browser): a journey in `web/test/ui/edit.test.ts` paints staccato on four notes, adds a *p* to a selected note, and finds both stored; the existing Marks journeys pass. The tray lists the slurs, ties and hairpins that touch the bar, with remove (spec "Slurs and hairpins of the bar"); the journey removes a slur that comes from the bar before.
- [ ] 7.2 The slide in Notes from note to note for a slur, or for the armed tie, crescendo or diminuendo, with the 8 px axis rule (spec "Slide between two notes"); the two-tap way across bars. Verify (browser): a journey slides a slur over three notes without a pitch change, and adds a slur from the last note of a bar to the first of the next with two taps.
- [ ] 7.3 Check the slide against the pitch drag on a real phone with a finger: ten slurs and ten pitch changes on a one-line piece, none taken for the other. Manual, on a phone (a by-hand check of a gesture).
- [ ] 7.4 Check the Marks tray, an armed mark and the list of slurs and hairpins by eye in browser-dev at 360 × 780. Manual.
- [ ] 7.5 The waiting-span notice above the surface with Cancel, the first note drawn as picked in the large bar, the overview and the full score, and the overlay that draws a span up to the edge of the large bar (design D14); the list's keys to go to a span's first and last bar. Verify (browser): a journey arms Slur, taps a note in bar 2, goes through "Full score" to bar 5, sees the notice there, taps a note, and finds the slur stored from bar 2 to bar 5; then goes to bar 3, finds "Slur, bars 2 to 5" in the list and goes to its last bar with the key. Check by eye that the notice and the overlay are clear (manual).

## 8. Grid

- [ ] 8.1 The Grid surface drawn from `grid.ts`: rows with note names, beat columns, blocks, locked blocks, the faint other voices, the staff and voice chip. Tap a cell to add, drag a block up, down and sideways, drag its end, tap to select; a refused gesture puts the block back and shows why. Verify (browser): a journey in `web/test/ui/edit.test.ts` adds a note on beat 3, lengthens it by its end, fails to drag a triplet block, and finds the stored bar as expected with the triplet unchanged.
- [ ] 8.2 The loudness strip: the marks and hairpins of the bar, tap to step *p*, *mf*, *f*, none, slide forward for a crescendo and back for a diminuendo. Verify (browser): a journey taps the strip twice under a note and slides from the first to the last note, and finds an *mf* and a crescendo stored.
- [ ] 8.3 Switching between Notes and Grid keeps the bar and the selection, and the view is remembered. Verify (browser): a journey proves the three scenarios of the spec's "Notes and Grid views".
- [ ] 8.4 Check Grid by eye in browser-dev at 360 × 780 in 4/4, 3/4 and 6/8, with a triplet bar and a left hand, in both note-name styles. Manual.

## 9. Bars

- [ ] 9.1 The Bars tray: how the bar starts and ends (normal, double, repeat with its count, end), "1st time only" and "2nd time only", "+ Bar before", "+ Bar after", "Same as bar before", "Join with next" and Delete bar. Verify (browser): the bar-line journeys in `web/test/ui/edit.test.ts` pass on the new tray, and a new journey adds a first and a second ending, adds a bar, deletes another, saves, and finds the score, `piece.json` and the loop as the specs say.
- [ ] 9.2 The scissors: with the Bars tab open, a mark at every place a bar line can be added, between the notes in Notes and above the grid in Grid. Verify (browser): the "add a bar line" journeys in `web/test/ui/edit.test.ts` use the scissors and pass, including the refusal for a note of the other part.
- [ ] 9.3 The suggested repairs as chips under the bar row, with their texts in the note-name style. Verify (browser): a journey opens a piece with a 3½-beat bar, taps "E4 → dotted quarter", finds the flag gone, and undoes it in one step.
- [ ] 9.4 Check the Bars tray, the scissors and the suggestions by eye in browser-dev at 360 × 780. Manual.

## 10. Screen-wide checks and docs

- [ ] 10.1 Update the editor part of `web/test/ui/density.test.ts` for the four tabs and both views. Verify (browser): `make test-browser` passes.
- [ ] 10.2 Remove what the old screen leaves unused (`NoteTab.tsx`, `MarksTab.tsx`, their styles and texts, the one-line state). Verify (quick): `make test-quick` passes, including `web/test/layers.test.ts` and `web/test/i18n.test.ts`.
- [ ] 10.3 Replace `docs/screenshots/edit-score.png` with the new editor (Notes view, a bar with a suggestion) at the size of the other screenshots. Verify: the README shows the new picture.

## 11. The photo line

- [ ] 11.1 Give `EditorSession` the photo of the current bar back (page, staff box, `photoUrl`), following unsaved bar changes through the bar map. Verify (quick): `web/test/editorSession.test.ts` proves the line for a bar, for an added bar, and the whole page when no staff is known.
- [ ] 11.2 The photo line above the overview and the large view with pinch and drag (design D10). Verify (browser): a journey in `web/test/ui/edit.test.ts` finds the line of bar 6's staff, opens it large and closes it. Check by eye at 360 × 780 that a line of a real page photo can be read when opened large (manual).

## 12. Integration

- [ ] 12.1 Play a piece by ear after editing it with the new tools: an added *p*, a breath mark, a first and second ending, a deleted bar. Manual, by ear.
- [ ] 12.2 Run `make test-browser`, then `make test-device` once on the emulator. Verify: both pass.

## Workflow follow-up

- Archive the change after the device smoke test.
