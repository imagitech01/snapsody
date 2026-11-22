# Deviations from the Figma design

A record, no longer added to. The Figma design is finished (2026-11-19) and is not updated; later changes
are checked by eye in the app (`docs/testing.md`, "Checking a screen by eye"), not against the frames. The notes
describe the screens as they were on 2026-11-19; a later change may have changed a screen without a note here.

While the app was built against Figma, each frame it was compared with had a section here: what differed from the
frame and why. The comparison was `make ui-review` (removed by the change `retire-figma-review`), which showed each
journey's capture ("the review captures …" below) beside its frame with these notes. The frames themselves are in the
Figma file; the exported PNGs are in git history under `docs/design/figma/`.

## All frames: denser than the frames (D18)

- After the checks on a Galaxy S24 ("large texts and a lot of space between everything"), the whole app is denser than the frames
  (practice-app design D18). The review and the mac journeys now run at the phone's own size, 360 × 780 (780 × 360 in
  landscape); the Figma frame is shown next to each screen scaled to the same height, so sizes and spacing differ on purpose.
- **Type, one step smaller per role:** screen title 30 → 22, continue card title 28 → 20, sheet title and practice title
  24 → 18, section titles 19 and 18 → 16, the tempo value 30 → 20, a bar number in the loop sheet 24 → 20, large button
  text 15 → 14, row titles 15 and 16 → 14 and 15. Body text (14) and captions (10 to 13) stay. The `--fs-N` tokens keep their meaning.
- **Space, about two thirds:** gutter 24 → 16, between sections 32 → 20, between blocks 24 → 16, between rows 12 to 14 → 8,
  padding in cards and sheets 20 to 24 → 12 to 16. The band above the first line of a screen is gone (4px under the status bar).
- **Heights:** primary button 52 → 44, tab bar 66 → 56 (plus the bottom inset), list rows 68 → 56 (compact 52, large 72, a row
  with a thumbnail 60), the thumbnail 48 × 54 → 40 × 44, search field 46 → 44. Root font size 16 and the touch target 44 are unchanged.
- **Every control is at least 44 × 44** (guarded by `web/test/ui/density.test.ts`, which also checks there is no sideways
  scroll, in English and Dutch). So the editor's tabs (30 → 44 high), its pills, Undo and Redo, the pitch stepper's buttons and the
  back button are taller or wider than the frames', and a switch's button is 44 × 44 around its 36 × 22 track.
- Not changed: Verovio's scale, colours, content and order of each screen, behaviour.

## 01 · Practice home

- Built as the real screen (practice-app task 12.1: `web/src/ui/screens/HomeScreen.tsx`); the review captures it from
  the `library` seed of the mac journey (`web/test/ui/practice.test.ts`): "Ode to Joy" to continue, one favorite in the
  rotation (the frame draws two).
- "SIGHTREAD" becomes "Snapsody".
- "practice" is spelled "practise" ("Let's practise", "Continue practising"), as everywhere in the app (the
  catalogue is British English).
- The frames use Inter. It is not bundled (the app is offline and the repository has no font file), so the
  system font stands in and letters are a little wider or narrower. `--font` in `tokens.css` names Inter
  first, so adding the font file changes nothing else.
- The play triangle is drawn in one colour, the text colour (green). The frame draws it with a dark fill and
  a green outline.
- The status bar (9:41, signal, battery) and the home indicator are the phone's, so the app does not draw them. The
  review capture sets the safe areas to what the frame leaves for them (48px and 26px) so that the overlay lines
  up; the capture shows an empty status bar.
- The tab bar is 56px (the frame's is 66, see D18) plus the bottom inset of the phone, so on a phone with a
  gesture bar it sits higher than in the frame.
- The card's text follows the data: "Metronome off", and "Loop 9–12" when a loop is set. "See all" is only there when
  the rotation has an entry.
- A rotation row opens the piece (without playing) when pressed; the play button at its end opens it and plays.
  The frame shows only the play button.
- States the frame does not draw (designed in the same look): pieces but nothing practised (no card, the subtitle
  asks to choose a piece), and no favorites ("Star a piece and it appears here.").
- "Browse all music" goes to the Library tab; "See all" opens the favorites over the home, so the tab bar is hidden
  there (see 03.2).

## 01 · Practice home · first launch

- No frame: the invitation of `practice-home` "First launch" is ours, in the same look: a white card with the title, the
  one line of what happens and the primary "Add music" button, and no empty lists. The title keeps its place; the
  subtitle ("Pick up where you left off.") is left out, as there is nothing to pick up.

## 02.1 · Play along — Portrait

- Built as the real screen (task 13.1: `PracticeScreen.tsx`, `styles/practice.css`); the review captures the `library` seed of the
  practice journey while "Ode to Joy" plays from bar 2 at 60 BPM, as the frame draws it.
- **The header shows only the title (design D19)**, in portrait and landscape: the frame's "Bar 2 of 12 · Following" line is
  gone. "Return to playing" stays over the score after the user scrolled away. The session still knows the bar and the follow state.
- **Smaller controls than the frame (design D17)**, so the music has more room. Restart 44, Play 64 × 48 (D18), the tempo and
  the metronome 48 high, with less space around them. Loop has the shape of Restart (a 44 square with its label under it,
  "Herhaling 10–12"), at the same distance from Play. The frame's Loop pill was another size and ran into Play when its
  label was long. With a loop on, the square and its label take the green of the metronome when it is on.
- **No page separators or page labels** (design D14, spec `score-playback` "Score display"): the pages of a piece are one
  continuous score, so the frame's "PAGE 2 · BARS 5–8" rules are not drawn. The score is the engraved piece (Verovio), not
  the frame's hand-drawn staves, so its notes, clef and spacing differ, and a bar number is shown at the start of each line.
- The score island (task 11.3) draws the playing bar as a green tint behind the staff with a cursor line at
  the sounding note, as the frame does, and also colours the sounding note itself (the frame leaves it dark),
  so the note is told apart from its neighbours without relying on the line alone.
- The island's box is the bar's drawing as Verovio gives it, so the tint also covers a tempo marking or a clef
  at the start of a line; the frame's box is a fixed rectangle behind the staff.
- The header says "Bar 2 of 12 · Following" as the frame does; while the user looks at another bar it says "Showing bar N",
  and "Not following" when following is switched off. The frame has no such states.
- **"Return to playing"** is not in the frame: it is a green button over the foot of the score, shown whenever the view is
  not following (a bar is shown, the user scrolled, or following is off).
- **The count-in** is a large number in a circle over the middle of the score while the clicks sound ("Count-in 2 of 4" for a
  screen reader). The frame has none. No frame draws a switch for the count-in either, so there is none on the screen or in the
  tools sheet yet: a piece plays with the count-in it was left with, which is off until a switch is designed.
- The tempo steps by 1 BPM a press (30 to 200), as the spec's "any tempo" needs; the stepper has no press-and-hold repeat yet.
- The status bar (9:41, signal, battery) and the home indicator are the phone's, so the app does not draw them (see 01).
- The title is cut with an ellipsis when it does not fit; the frame's "Ode to Joy" is short.
- A tap on a note moves where Play starts (spec `practice-controls` "Tap to start from a note"); the frame does not show it.
- Messages the frame does not have: the piece is missing or damaged ("This piece no longer exists."), and the sound could not
  be loaded (a line over the top of the score).

## 02.2 · Play along — Landscape

- Built as the real screen (task 13.1), the same component as the portrait one with its own layout when the window is wider than
  high. The review captures a 780 × 360 window with no status bar (frames.json: `safeTop` 0) and a 14px bottom inset.
- **One bar about 48 high on top (design D18)**, where the frame has a header row and a row of controls under the score. From
  left to right: Back, the piece's title (cut off with an ellipsis when long; no bar position, design D19), Restart, Play,
  the tempo stepper, the metronome, Loop and the tools button. The score gets all the height under it.
- The metronome is an icon button that shows its state by its tint (green when on); its name and its pressed state are those of
  portrait. Restart and Loop have no label in landscape; Loop's words ("Loop off", "Loop 9–12") stay its accessible name, and a
  loop that is on tints its icon. The frame's wide metronome box and Loop pill are gone.
- The side insets (a camera cutout) are kept clear with the screen's left and right padding.
- Turning the phone mid-play lays the score out again and keeps the sounding bar in view; the music does not stop.

## 02.3 · Practice — Loop setup

- Built as the real sheet (task 13.2: `LoopSheet.tsx`), over the real practice screen; the review captures it from the
  practice journey (`web/test/ui/practice.test.ts`) with the scrim over the screen, as the frame draws it dimmed.
- "From bar" and "To bar" are native lists (the phone's own picker) drawn under the frame's boxes: the box shows the
  number and a chevron, a tap opens the list of bars. They start at the bar the user is at and the one after it (the frame
  shows 2 and 3); the two ends stay in order (moving one past the other takes the other along).
- "Start looping bars 2–3" sets the loop and the rest and closes the sheet; it does not start the music (the spec says the
  user then presses play). With a loop on, a secondary "Switch loop off" button comes under it (no frame).
- The sheet is as high as its content plus the bottom inset of the phone, up to the window; the frame's is 600px and
  leaves 46px under the foot. On the review capture (26px inset) the sheet is 12px higher than the frame, and
  everything in it is 12px higher with it. Its content scrolls when the window is low (landscape).
- A sheet slides in; closing it is immediate (there is no exit animation).
- Dismissing is as the spec says: a tap on the scrim, Close, or a drag down on the handle. Dragging elsewhere
  in the sheet is the content's own.

## 02.4 · Practice — More tools

- Built as the real sheet (task 13.2: `ToolsSheet.tsx`), over the real practice screen (see 02.3).
- **Slimmed down after the user tried it (design D17):** the sheet has two rows, "Edit score" and "Favorite".
  - "Go to music" (and 02.6) is not built. Scrolling the score shows any bar, and "Return to playing" on the screen comes back. The practice score has no pages for a page list.
  - "Practice instrument" is not built: the instrument is the default from Settings (see 02.5).
  - "Follow playback" is not built: the view always follows the music, except while the user has scrolled away.
  - There is no count-in switch here: the count-in is a general setting, switched in Settings (07) only. (A first version had it here; it looked like a setting of the piece.) The count itself shows large over the score (02.1).
- "Edit score" pushes the editor over the practice screen.
- "Favorite" is the star of the piece, as in the library.
- The "›" at the end of a row is drawn as an icon in the text colour, lighter than the frame's glyph.
- The frames show a switch only in its on state. The off state is ours: the track in the line colour
  (`--line-strong`), the knob on the left.
- The sheet's height follows its content (see 02.3).

## 02.5 · Practice — Instrument

- **Not built (design D17).** The user found an instrument per practice session not useful: the instrument is chosen once,
  in Settings (07), and every piece plays with it. frames.json marks the frame `replacedBy`.

## Tokens and components (all frames)

- Read by hand from frames 01, 02.3, 02.4, 03.1, 06.1 and 07 into `web/src/ui/styles/tokens.css`. The colours, the
  type sizes (10 to 30px), the radii (7 to 28px) and the 4px spacing unit are the frames' own.
- One look, light: Figma has no dark design, so `color-scheme` is light and a phone in dark mode shows the same
  screens.
- The segmented control has the two looks of the frames: separate pills (02.3 "Rest between repeats") and a track
  with a white selected pill (06.1 Note / Marks / Score). Both are one component with a `look`.
- The stepper has the two sizes of the frames: the tempo control (02.3) and the pitch control (06.1). It has no
  press-and-hold repeat yet.
- A destructive confirm dialog (a danger-coloured confirm button) and the danger button have no frame: "Delete
  note" in 06.1 is the only red, and the dialog is new. They are drawn from the same tokens.
- Focus is shown with a ring only for the keyboard; a tap shows none.
- Added for the screens of group 12, with no frame of their own: a bin and a cross icon (the library row's delete and the
  search field's clear button), an icon button look without a background in the muted text colour (the bin), a
  disclosure row (a row with a chevron that turns down and `aria-expanded`: the credits), and the notice that tells
  the user a change did not work (a pale red bar over the foot of the screen with an OK button). The score thumbnail
  of the library rows is drawn once for every piece: a piece has no picture of its own. The two notes on it are redrawn (two
  filled heads and a beam), not the frame's own path.

## 03.1 · Music library

- Built as the real screen (task 12.2: `LibraryScreen.tsx`); the review captures the `library` seed of
  `web/test/ui/library.test.ts`: four pieces, one a favorite.
- **A bin at the end of each row** (name "Delete “<name>”"). The frame has no way to delete, and `piece-library`
  "Delete a piece" asks for one; the bin asks for confirmation first. It makes a row's text narrower, so a long
  summary line wraps to a second line. Where the delete should live is the user's decision.
- The summary line follows `piece-library` "Library list": "3 pages · 12 bars · Practised today", or "Added …" when
  the piece was never practised. The frame's "Scanned today" and "Practiced yesterday" are replaced by these.
- A star in a row is filled when the piece is a favorite; the frame draws every star as an outline.
- The search field is an input; a cross clears it once it holds text. A search with no match says "Nothing matches
  “…”". An empty library shows the invitation to add music instead of the field and the list.
- The section title "All your music" is 18px as in the frame; "Favorites" ends 8px inside the gutter as in the frame.
- "Add music" and its hint come after the list, in the scrolling content. The frame pins them at the foot; with a long
  list they are below it.
- Every piece has the same thumbnail (a pale page, five lines, two notes), since a piece has no picture of its own.
- Not in the frame: a line for a folder in the library that could not be read ("A piece in your library could not be
  opened."), which is not listed and is left alone.

## 03.2 · Favorites

- Built as the real screen (task 12.2: `FavoritesScreen.tsx`); the review captures two favorites (the frame shows three).
- It is opened over the library or the home, not as a tab, so the tab bar is not shown (the router shows the bar only
  on a start screen, design D12) and a Back button sits above the header. The frame shows the tab bar with Library
  marked. The system back button does the same.
- Rows show the library's summary line (with when the piece was practised or added); the frame stops at the bars.
  A filled star takes the piece out of the list; the frame draws an outline.
- "Score" becomes "piece" in the note card ("Star any piece to find it here."). "3 FAVORITES" is the plural of the count.
- With no favorite the screen shows one card: "No favorites yet" and how to add one (no frame).
- "Tap a star again to remove a favorite." sits under the list after a rule, and moves with it; the frame fixes it at y=632.

## 06.1 · Edit score — Notes

- Built as the real screen (tasks 15.1 and 15.2: `web/src/ui/screens/editor/`); the review captures "Ode to Joy" made with
  three pages, staff positions and a picture drawn by the journey, with bar 3 and its fourth note selected
  (`web/test/ui/edit.test.ts`). The planned deviations of design D14 apply: "Pages 1 / 3" shows the page photos, and the
  photo strip shows the staff, not an exact bar crop.
- **The page scrolls where the frame fits one screen.** The frame lays everything out at 900px. Here the header, the score,
  the photo and the tools scroll together and Save & practice stays at the foot, so a phone lower than the content still reaches
  everything. The capture shows the top of the page: the lower rows of the tools are cut off at its foot.
- **One more row of tools.** The Note tab has the frame's three rows and a fourth: Make rest, + Rest before and + Rest after
  (`score-editing` "Edit a note" needs them). Triplet sits beside Dotted, so the length selector is narrower than the
  frame's and shows "Quarter (1/4)" with less room around it.
- The score is the real score island (task 11.3): the bar of the selection is tinted behind the staff and the selected note is
  drawn in the accent colour. The frame draws a 29 × 43 box on the note. The island is 176px high (the frame's is 180px)
  and has its own scroll bar; the frame's separate track is not drawn. The practice screen's cursor line is hidden here.
- The pills are 36px high (the frame's are 30px), so that they are easier to touch. "Pages 1 / 3 ⌄" opens a sheet with the
  photo of every page, each with a "Go to bar" button; "Go to bar…" opens a sheet with a number field; "+ Add pages" asks to
  save unsaved edits first, then opens adding music for this piece (design D12). The sheets and that question have no frame.
- **The photo strip** shows the staff that holds the selected bar, with a margin of half the staff's height above and below and
  2% of the page at the sides (the reader's boxes cover the staff lines only, design D7), at the proportions of that part of the
  photo and no taller than 96px (the frame's strip is 64px high and cropped to the picture's width). Without staff positions
  it shows the whole photo of the page (no taller than 192px), under the same label. Before a bar is chosen there is no
  photo to show, and the strip says so. "Preview bar 3" becomes "Stop preview" while it plays.
- **The pitch** is "−  F5  +" with the accidental in the name ("E♭5"), as in the frame, and a rest shows "Rest". The
  accidental selector says "None" for a note with no printed accidental; the frame says "Natural", which is a printed sign
  of its own. A note's length, accidental and pitch are off on a rest, and the whole tab is off until a note is selected.
- Undo and Redo are on all three tabs, and Redo is muted while there is nothing to redo. The frame draws Redo on this tab only.
- **What needs checking** (`score-editing` "Flags shown for review", no frame): a pale amber strip at the top of the score card
  with "2 things to check", Previous and Next, and the text of the warning Next went to. It is only there when there is
  something to check. The notes of a flagged bar and a flagged note are marked on the score in the amber and red of the
  score island's marks.
- "Save & practice" is pinned at the foot, and the reason a save failed (an empty name, a piece changed elsewhere, a full phone)
  appears above it in the pale red of the notice. A change that cannot be made says why under the tools, in the same red.
- Back and Cancel both leave the editor, and both ask the discard question while there are unsaved edits. The back button
  is 36px square (the frame's icon is 24px) for the same reason as the pills. The phone's status bar and home indicator are not drawn.

## 06.2 · Edit score — Marks

- Built as the real screen (task 15.3: `MarksTab.tsx`); the review captures bar 3, note 4 with Staccato on. The deviations
  of 06.1 apply to everything around the tab.
- Slur, tie, hairpins are chosen by first and last note, as the frame's hint says (design D14): the chip starts the choice and is
  drawn with a dashed outline, and the line under the chips says "Tap the first note." and then "Now tap the last note." in
  place of the frame's first hint line; the second hint line is the frame's. A mark the selected note already has shows its
  chip as on, and tapping it removes the whole slur, tie or hairpin. A tie only joins a note to the next one with the same pitch,
  and a hairpin cannot overlap another; a choice that cannot be made says why, and nothing changes.
- "Cresc." and "Dim." are written in full ("Crescendo", "Diminuendo"): the chips have room, and the spec calls them by those names.
- Staccato, Tenuto and Accent are off on a rest (they cannot be on one) and all four single-note marks are off while no note is selected.
- The frame draws the staccato dot under the note head; the real score draws it where the engraver puts it.
- A "Bar N" group is added under the marks (change `edit-bar-lines`, design D2); the frame has none. It sets how the selected bar
  starts (plain or start-repeat ‖:) and ends (plain, double bar line ‖ or end-repeat :‖), and for an end-repeat how many times
  the section is played (2× to 8×). It uses the Score tab's selects and compact stepper, a label column and an 11rem control
  column, under a thin divider. It acts on the selected bar, with or without a note, and is disabled with no bar selected
  ("Bar lines" is its heading then). The review captures it as "06.2 · Edit score — Marks · bar lines" (and "· Dutch"), scrolled so
  the group shows.

## 06.2 · Edit score — Element panel

- The frames have no panel for a selected element; this is a planned deviation (design D5). Tapping a clef, key or time
  signature, dynamic, tempo mark, text, hairpin, slur, tie or articulation selects it, draws it in the accent colour, and shows a
  compact panel **above the tabs** (the tabs and the selection line stay as in the frames): the element's name and bar
  ("Clef · bass · bar 3", "Dynamic · mf · bar 2"), a red **Delete** chip (the same chip as "Delete note"), and for a clef a
  Treble/Bass select in the tabs' own select style. The first clef, key and time signature have no Delete, and say so in a hint line.
- Tapping a note or an empty part of the score puts the panel away. Tapping a bar line selects its bar and shows the Marks tab, whose
  "Bar N" group sets how the bar starts and ends.
- Change `select-and-delete-elements`, design D5. The panel applies to the three tabs (frames 06.1 to 06.3); the review captures it
  with an *mf* selected, scrolled so the panel shows.

## 06.2 · Edit score — Element panel · clef

- No frame: the panel for a clef, with its Treble/Bass select and Delete. See "06.2 · Edit score — Element panel".

## 06.2 · Edit score — Element panel · Dutch

- No frame: the same panel with the language set to Dutch, to see the longer words fit.

## 06.3 · Edit score — Score settings

- Built as the real screen (task 15.4: `ScoreTab.tsx`); the review captures the piece with one sharp. The deviations of 06.1
  apply to everything around the tab.
- **The key is listed by its sharps and flats** ("No sharps or flats", "1 sharp", "3 flats"), where the frame says "C major ⌄":
  the editor sets the number of sharps or flats and leaves the mode alone, so a key name could be wrong for a minor piece.
- The time signature is chosen from 2/4 to 12/8, with the piece's own added when it is none of those, and "Not set" when the
  piece has none. A change to it is checked against the bars at once (the bars that no longer add up are flagged).
- The written tempo is the metronome mark printed in the piece, moved in steps of 2 beats per minute between 30 and 200. Without
  a mark it starts from the tempo the piece plays at now. A tempo word that is there is kept; it cannot be changed here.
  The line under it is the frame's: "Written tempo · practice speed stays separate."
- The three choices are the phone's own pickers (a native list), so they look like the phone's, not like the frame's boxes.

## 07 · Global instrument settings

- Built as the real screen (task 12.3: `SettingsScreen.tsx`). The planned deviations of design D14 apply: no separate
  "Playback sound" row (the sound follows the instrument), and language and credits rows are added. The frame's
  "Pitch reference" row is not built: the pitch reference was removed (design D19), playback is always A4 = 440 Hz.
- **Added: the count-in switch** (its "Practising" label was dropped in D19) (design D17), between the default instrument and the language. It is the
  only place to switch the count-in, for every piece. The note at the top no longer says that switching while
  practising leaves the default alone: there is no switching while practising any more.
- **The default instrument and the language are one line each (design D19)**: the label, the current choice and a chevron
  (52px high), where the frame lists every instrument on the screen. Tapping a line opens a sheet with the whole list as radio
  buttons; picking one saves it and closes the sheet, and Close, a tap outside or back leaves it as it was. The language line
  shows "Same as the phone" when no language was chosen; in the sheet that row says what it resolves to ("Same as the phone (English)").
- The screen is the Settings tab, so its title is "Settings". The subtitle keeps the frame's words, as every tab has one. The frame's green note card ("Your starting sound for practice") is left out, so that the settings come right after the title (user feedback, design D19).
- The instrument list (in its sheet) is the app's (design D8): the seven instruments that are offered (tenor and alto saxophone, B♭
  clarinet, piano, guitar, violin, trumpet; violin and trumpet passed the listening check on 18 Nov 2026). The frame's
  piano, guitar, violin and flute were placeholders. The line under a name is the instrument's family ("Woodwind"),
  where the frame has "Concert pitch · Grand piano". "See all instruments →" is not needed, as every offered instrument is listed.
- **No "Pitch reference" (design D19).** It was a card with a stepper (430 to 450 Hz); nobody wants to change it, so it is gone
  from Settings, from `settings.json` (an older file's value is ignored) and from the sessions.
- "Language" has the same kind of sheet: "Same as the phone", "English", "Nederlands".
- "Credits" is a row that opens the credits below it (a disclosure, not another screen): the source and licence of the
  instrument sounds and the licence's own acknowledgements, in English as the licence gives them.
- Under the credits, one line says the app works without a network.
- When the settings could not be read at start, a change still works until the app is closed, and a notice says so (no frame).
- The rows are 64px high ("compact") with an 8px gap, as in the frame; the group labels are 12px above their rows.

## 07 · Global instrument settings · Dutch

- No frame: the same screen with the language set to Dutch, to see the longer words fit.

## 04.1 · Capture pages, 04.2 · Crop selected music, 04.3 · Review page order

- Not built (design D14). The phone's page scanner (ML Kit) already captures, crops, reorders and retakes pages, and does
  it well, so its own screens stand where these three frames are, after the hint screen below. The frames stay listed in
  `frames.json` as replaced, with no exported PNG.

## 04 · Before you scan (hint)

- No frame: the hint of `score-capture` "Hint before scanning" is ours, in the same look. It is built as the real screen
  (task 14.1: `AddMusicScreen.tsx`, `AddMusicViews.tsx`); the review captures its first showing from `web/test/ui/addMusic.test.ts`.
- The Back button sits above the header, as in the favorites, and the eyebrow says "Add music". Two numbered white cards
  hold the two hints (crop each page, add the next page), a switch "Don't show this again" follows, and the primary
  "Open the scanner" button is pinned at the foot.
- The two texts and the switch are the spec's. Nothing else is said: no picture of the scanner, as its screens are the phone's.

## 05 · Process scan

- Built as the real screen (task 14.1); the review captures the second of two pages being read, with a page photo from a
  committed test image (`web/test/fixtures/page.jpg`).
- The frame's **"Notes detected" tag, scanning beam and glow over a staff, and the green page-detection corners are not
  drawn** (design D14): they would claim a detail the reader does not report. What is shown is the page being read, as the
  scanner gave it.
- **The page photo is shown whole (contain) on a quiet ground, not cropped to fill its box (cover).** A scan is the user's own
  crop of any shape (a strip of one exercise, or a whole page); the frame's wood-table photo always fills a 352 x 374 box.
  The box is as high as the frame's (374px) on a tall window and lower on a short one.
- **Not in the frame: a progress line.** A bar and the percentage sit under "Reading page 2 of 3" (spec `score-recognition`
  "Progress and cancel": which page of how many, with progress). It never moves backwards.
- **Not in the frame: Cancel.** A secondary "Cancel" button at the foot stops the reading and goes back to where adding started;
  the Back button above the header and the system Back do the same. The frame's only foot text, "Keep this screen open. It won’t
  take long.", is kept above the button.
- The eyebrow "SCAN / 3 OF 4" and the line "3 pages → 1 continuous score" are not drawn: the steps they count are the scanner's.
  The eyebrow says "Add music"; the line under the title says that Snapsody is reading the pages and making a new piece (or
  adding them to the named piece, when pages are added from the editor).
- The Back button is the app's (a square tonal button above the header, as in the favorites), not the frame's bare arrow beside
  the eyebrow, so the title sits lower than in the frame.
- The page list has the frame's three icons (a check, a clock, a ring) and its text sizes, but one line per page, "Page 1", with its
  state at the end of the line in the muted colour ("Read", "Reading…", "Waiting"), as a piece can have up to ten pages. The
  frame's "Page 1 read", "Reading page 2" and "Page 3 next · then combine" are not said.
- The heading is "Reading page 2 of 3" without the frame's ellipsis.
- The body scrolls when ten pages do not fit; the Cancel button stays at the foot.

## 05 · Process scan · no music on page 2

- No frame: "no music on page N" (spec `score-recognition` "Recognition failure") is ours, in the look of the first-launch
  invitation: the title, one white card with what happened, the primary "Scan again" and a secondary "Cancel".
- Scanning again opens the scanner for all the pages once more; nothing of the first attempt is kept. A page that could not
  be read, or a piece that could not be saved, has the same card with its own words ("Page 1 could not be read. … Nothing was
  added.", "The piece was not saved").

## 05 · Process scan · scanner not available

- No frame: the message of `score-capture` "Page scanner cannot run" is ours, in the same card. It explains in plain words and
  has one button, "OK", which goes back: the spec offers no other way to add music.
