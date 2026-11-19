# Design

## Context

See proposal.md for why. Today:

- The score model (`web/src/core/score/model.ts`) gives each measure an optional `leftBarline` and `rightBarline`, each with `style`, `repeat` (`forward` | `backward`), `times` and `ending`. MusicXML reading and writing (`musicxml.ts`) already round-trips all of these, so the stored piece needs no new format.
- Recognition writes a double bar line in either of two places: as the `light-light` right bar line of the bar before the boundary, or as the left bar line of the bar after it. `expandMeasureOrder` (`core/playback/timeline.ts`) reads both.
- Editor edits are pure functions in `core/score/edit.ts` that change a `Score` and throw `EditError` when they cannot be done. `EditorSession.apply` runs each one as an undo step (or as part of the last one with `amend`) and re-runs the bar-length check. The selection is a bar with or without a note (`chosen.value = { bar, noteId }`), so a bar can be selected without a note, for example through "Go to bar".
- The editor has three tabs (Figma frames 06.1 Notes, 06.2 Marks, 06.3 Score). None of the frames has bar-line controls. The Score tab uses `SelectField` for key and time, and the `Stepper` (with hold-to-repeat and `amend`) for the tempo.
- The bar preview (`barExcerpt`) already removes bar lines, so a previewed bar plays once. That stays.

## Goals / Non-Goals

**Goals:**
- Three pure edits in `edit.ts`: the start of a bar, the end of a bar, and the number of passes of an end-repeat. A matching reader gives the bar's current start, end and count, whichever way recognition wrote them.
- After an edit, the bar lines on the boundary between two bars are stored in one place (normalized), so drawing and playback never see two signs that contradict each other.

**Non-Goals:**
- Editing first and second endings, D.C., D.S., coda or fine.
- Final bar lines (`light-heavy` without a repeat) as a choice of their own. One that recognition reads counts as a double bar line, which is how playback already treats it.
- Drawing the repeat count on the score (see Open Questions).

## Decisions

### D1. Three values per bar, mapped onto MusicXML bar lines

| Control | Value | Written as |
|---|---|---|
| Start | normal | `leftBarline` loses `repeat` and `style`. It is removed altogether when it has no ending. |
| Start | start-repeat | `leftBarline = { style: 'heavy-light', repeat: 'forward', ending? }` |
| End | normal | `rightBarline` loses `repeat`, `times` and `style`, and the next bar's left double bar line (one with no repeat) is removed |
| End | double | `rightBarline = { style: 'light-light', ending? }`, and the next bar's left double bar line is removed |
| End | end-repeat | `rightBarline = { style: 'light-heavy', repeat: 'backward', times?, ending? }`, and the next bar's left double bar line is removed |

Reading: the end is *end-repeat* when `rightBarline.repeat === 'backward'`. It is *double* when the right bar line has a double style and no repeat, or when the next bar's left bar line has a double style and no repeat. Otherwise it is *normal*. The start is *start-repeat* when `leftBarline.repeat === 'forward'`, and *normal* otherwise.

`times` is written only when it is not 2, because MusicXML's default is 2 and the recognised scores leave it out. Its range is 2–8, and an edit outside that range throws `EditError`.

Why "the end of a bar" owns the double bar line: the user selects the bar before the line, which is where the book shows the line. Writing the double bar line on one side only (the right bar line of the bar before) makes reading back unambiguous. *Alternative:* edit the boundary between two bars as one thing. That matches MusicXML less well, and it needs a way to select a boundary instead of a bar.

Endings are never touched: every write keeps the `ending` field of the bar line it rewrites.

### D2. Controls in the Marks tab, under the note marks

A "Bar N" group at the bottom of the Marks tab (frame 06.2) holds:
- a `SelectField` for the start: "Normal" or "Start repeat ‖:";
- a `SelectField` for the end: "Normal", "Double bar line ‖" or "End repeat :‖";
- a compact `Stepper` for the number of passes ("2×" … "8×"), shown only when the end is an end-repeat. A held button is one undo step, through `amend`, as for the tempo.

The group acts on the selected bar, with or without a selected note, and is disabled when no bar is selected.

*Why the Marks tab:* bar lines are marks on the score, like slurs, and they belong to a place in the music, not to the whole piece (the Score tab). Adding a fourth tab would cost width on a 360 px phone, and the 44 px touch-target rule makes the tab bar the tightest row on the screen. *Alternatives:* a fourth "Bar" tab (rejected for width), or the Score tab (rejected because everything there applies to the whole piece).

**Deviation from Figma (to record in `docs/design/deviations.md` under 06.2):** frame 06.2 has no bar-line group. The group is added below the note marks for the reasons above, in the same style as the Score tab's selects and stepper.

### D3. Playback is unchanged

`expandMeasureOrder` already gives a forward repeat priority over the double-bar-line fallback (`forwardSign`) and follows `times`. A new test in `web/test/timeline.test.ts` pins this down for the "Make a repeat explicit" scenario, built from the edited score rather than from hand-written XML.

### D4. i18n

The control labels and options go into `en.ts` and `nl.ts`. They use the musical symbols (‖:, :‖) next to the words, because players recognise the symbols more readily than the names.

As built (18 Nov 2026): the fields are labelled "Starts with", "Ends with" and "Played" ("Begint met", "Eindigt met", "Gespeeld"), and the plain choice reads "Plain bar line" ("Gewone maatstreep") rather than D2's "Normal", which says less on its own beside "Double bar line". With no bar selected the group's heading is "Bar lines" ("Maatstrepen").

## Risks / Trade-offs

- [Recognition writes a double bar line on the left of the bar after the boundary, and on the right of the bar before it] → The reader accepts both, and every write normalizes the boundary to the right bar line of the bar before. A unit test covers both inputs.
- [A start-repeat with no end-repeat after it plays straight through, which may surprise the user] → That is standard notation and what playback already does. No warning is added now. The bar-length flags are not a good home for it, and a lone `||:` is rare.
- [Verovio may not draw a repeat count other than 2] → The control shows the count, and playback follows it. See Open Questions.
- [A count above 2 on the end-repeat of a "1." ending still plays the section twice] → Found while implementing task 1.3: on pass 2 the "1." ending is skipped, so its end-repeat is never reached again. The control shows 3×, playback plays 2×. To play it three times the ending would have to read "1, 2". Not solved in this change; `web/test/timeline.test.ts` pins the current order. Open for the user to decide (for example: no stepper on a bar inside an ending, or widen the ending's numbers with the count).
- [Drawing `heavy-light` at the start of a system] → Verovio draws start-repeats at the start of a line as it does for recognised scores today. This is checked by eye in `make ui-review`.

## Migration Plan

None. Old pieces load unchanged, and their bar lines simply show in the new controls.

## Open Questions

- Should a repeat count other than 2 also appear on the score, as "3×" above the end-repeat? That would mean adding a words direction when saving, or a Verovio option. It can be decided after the first by-eye review without changing the edits or the controls.
  - Mac check during implementation (headless Chromium, 18 Nov 2026, not the user's by-eye review of task 3.3): Verovio does **not** draw a count other than 2; an end-repeat set to 3× looks the same as 2×. A start-repeat at the start of a system (bars 3 and 9 of "Ode to Joy"), a double bar line and an end-repeat drew correctly after an edit. A start-repeat on bar 2 made Verovio move bar 2 to the start of a line, so a start-repeat strictly in the middle of a line is still to be checked by eye.
  - The user's by-eye check (task 3.3, 19 Nov 2026): every bar line drew correctly after an edit. The count is still not drawn, so the question of a "3×" mark stays open.
