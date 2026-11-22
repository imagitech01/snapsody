# Design

## Context

See proposal.md for why. Today:

- **What homr 0.7.1 writes** (`vendor/homr/music_xml_generator.py`, `staff_parsing.py`):
  - One `<part>` per part: P1, P2 and so on. A two-staff part is named "Piano", a one-staff part "Voice".
  - Inside a part, `<staves>2</staves>` and notes with `<staff>` and `<voice>`: voices 1–4 on staff 1, 5–8 on staff 2. `<backup>` and `<forward>` move between voices.
  - Chords use `<chord/>`. Keys and clefs are given per part and per staff.
  - A staff hidden in a system gets whole-bar rests, so every part has every bar.
- **What the app keeps** (`musicxml.ts`): the first part, its first staff and its first voice. It drops `<backup>`/`<forward>` and warns "Only the first of N parts is kept" and "N notes in other voices or staves were dropped". Chords in that voice are kept, drawn and played.
- **Model** (`model.ts`): `Score { title?, partName?, measures }`, where each `Measure` holds the bar's attributes and one flat `items` list. 18 modules read `score.measures`, 95 times in all: repairs, warnings, the timeline, editing, elements, lines, beams, pages and the UI.
- **Storage** (`library.ts`): `pages/<n>/recognised.musicxml` keeps homr's raw output unchanged, and `score-<rev>.musicxml` the corrected score. `practice.json` holds `PracticeState`, and `settings.json` the default instrument.
- **Playback** plays one instrument per session (`practiceSession.ts`, `backend(instrument)`). The timeline is one list of events in time order, and legato, ties and the cursor assume that consecutive events are consecutive notes.
- **Page layout:** `addMusic.ts` keeps homr's staff boxes per page, with bar ranges, to show the photo of a line in the editor.
- **Evidence:**
  - The local prototype (`prototype/`, untracked) reads photos with homr 0.7.1 on the Mac and draws every part with Verovio. On one melody-and-piano book page, all 294 notes were read correctly, chords and second voices included.
  - Real phone photos of piano pages and the reading time on a real phone are still untested (task group 1).
- **Mock:** an interactive mock of the practice screen (shared privately in the explore session) shows the agreed look: the "your part" card, the hint, and the Practice tools rows.

## Goals / Non-Goals

**Goals:**
- One model for every piece, where a one-line piece is the simplest case and behaves exactly as today.
- Code that works on one line (repairs, the bar check, the timeline per voice, most of the edits) keeps working unchanged on each voice.
- Playback merges any number of parts with one shared time line: one bar order, one fermata map, one metronome.
- No migration of stored pieces.

**Non-Goals:**
- Editing parts, staves and chord notes (change `edit-parts`).
- Voices that move between staves, beams across staves, and more than two staves in a part.
- A mixer: one switch per part, no volume per part.

## Decisions

### D1. Model: shared bars, parts, staves, voices

```ts
interface Score { title?: string; parts: Part[]; bars: Bar[] }
interface Part  { id: string; name: string; staves: 1 | 2 }          // id: 'P1', 'P2' …, as read
interface Bar   {                                                    // what every part shares
  number: string; time?: TimeSignature; leftBarline?: Barline; rightBarline?: Barline;
  newSystem?: boolean
  parts: PartBar[]                                                   // parallel to Score.parts
}
interface PartBar  { key?: KeySignature; multiRest?: number; staves: StaffBar[] }  // key and multi-measure rest belong to the part
interface StaffBar { clef?: Clef; voices: MeasureItem[][] }          // voices[0] is the staff's first voice
```

- **Voices** are numbered per staff from 0. They are written back as MusicXML voices 1–4 on staff 1 and 5–8 on staff 2, as homr does.
- **Directions** (dynamics, hairpins, tempo, words) stay items in a voice's list, as today. A dynamic or hairpin applies to every voice of its staff (D6).
- **Multi-measure rests** (`more-marks`) move to the part's bar, because homr writes `<multiple-rest>` inside one part and a melody can rest while the piano plays. A run is drawn collapsed only when every staff of the drawn part rests in all its bars.
- **Ids:** note ids stay unique in the whole score, so a note id alone finds its part, staff and voice. `noteIndex` grows those three fields.
- **One-line pieces:** a piece read before this change becomes one part (`P1`, staves 1), one staff and one voice.

*Alternative:* keep `Score.measures` for the user's part and store the other parts beside it. Rejected: which part is "yours" is a practice setting, not a property of the score, and a second code path for the other parts would duplicate repairs and playback.

### D2. A voice view in today's shape

`voiceView(score, ref)` returns `{ measures: Measure[] }` in today's `Measure` shape for one voice (`ref = { part, staff, voice }`). Each `Measure`:
- gets the bar's number, time and bar lines, the part's key in force and the staff's clef in force;
- has an `items` array that is **the same array** as the voice's list in the model, not a copy.

So an edit to items through the view edits the model. The bar attributes in the view are read-only copies, and the few functions that set them (time, key, clef, bar lines) move to the score level.

Repairs, the bar check, warnings, the beam helper, the timeline builder per voice, and the item edits of `edit.ts` take a voice view, and their tests keep their current fixtures through `singleVoiceScore(measures)`. Of the 95 uses of `.measures`, those in `musicxml.ts`, `pages.ts`, `noteMap.ts`, `lines.ts` and the UI move to the new model. The rest run on a view.

*Alternative:* rewrite every module against the nested model. Rejected: it is the largest and riskiest part of the change, and it would mix a refactor into behaviour changes.

### D3. Reading and writing MusicXML

- **Reading:**
  - Every `<part>` is read, with a time cursor per measure that follows `<backup>`, `<forward>` and note durations.
  - A note goes to its staff (`<staff>`, default 1) and its voice (`<voice>`, mapped to a per-staff index in order of first use).
  - `<forward>` inside a voice becomes an invisible rest of that length, kept as `rest` with `hidden: true`, so each voice's list still adds up. It is written back as `<forward>`, is not drawn, and cannot be selected.
  - Bar attributes (time, bar lines, repeats, endings, new system) come from the first part. When a later part disagrees, a warning is given and the first part wins.
  - Part names: two staves → "Piano". One staff → "Melody", or "Melody 1", "Melody 2" … when there are several.
- **Writing:** partwise, one `<part>` per part, with `<staves>` and the clefs per staff, the key per part, the shared bar attributes repeated in every part (as MusicXML wants), and voices joined by `<backup>`.
  - The serializer option `parts?: string[]` writes only those parts, for drawing (D7).
  - A score with one part, staff and voice is written exactly as today, so a test pins the output of the existing fixtures byte for byte.

### D4. Combining pages, and the parts step

- **Matching:** `mergePages` matches each page's parts to the first page's parts, in order, by number of staves.
  - A part missing on a page gets whole-bar rests there.
  - A part only on a later page is dropped with a warning.
  - Repairs run per voice. The time-signature inference uses the first part's first voice.
- **The parts step:** a new view in the add-music flow, after reading and before saving. It shows when the combined score has more than one part.
  - Each row has a checkbox (keep), the part's name and its first line drawn small, so two melodies can be told apart. A radio button chooses "I play this".
  - Continue saves the piece with the kept parts only, and stores the choice of part in `practice.json`.
  - Back cancels, as cancelling the reading does.
- **Adding pages later:** `PieceInfo.partsRead` records the shape of the first reading (`{ staves, kept }[]`, in order). Pages added later are matched against it, and parts not kept are dropped again without asking. A piece without `partsRead` (saved before this change) keeps only its first part from added pages, as today.
- **Range check:** it runs on the voices of the user's part only, with that part's instrument (D6). The other parts get the bar check only.

### D5. Your part, as a practice setting

```ts
interface PracticeState {
  // … as today
  part?: { id: string; hand?: 'right' | 'left' }   // absent: the first part, both hands
  silent?: string[]                                // parts or hands switched off under "Plays along": 'P1', 'P2:left' …
  ownLine?: boolean                                // absent: true
  instrument?: string | null                       // absent or null: the default from Settings
  partsHintSeen?: boolean
}
```

- **Your line** is the voices of your part, or of the chosen hand's staff. A hand is the staff of a two-staff part: right is staff 1, left is staff 2.
- **What sounds:** every kept part and hand that is not your line and not in `silent` plays along. Your line sounds while `ownLine` is true.
- **Old files:** these fields are absent in older `practice.json` files, and every field falls back.

### D6. Playback: per-voice timelines merged on one time map

1. **Bar order.** The bar order (repeats, endings) is worked out once from the shared bars, as today.
2. **Fermata map.** A first pass over every voice collects each fermata as an interval in written time, from the note's start to its end. The intervals give one piecewise map from written to played time, where each fermata interval is stretched by `FERMATA_STRETCH`. Every voice is placed through the same map, so a fermata in one part holds all parts, and a long note across it is stretched with it. This replaces today's per-event stretching. For a single voice the result is the same, which the existing fermata tests pin.
3. **Events per voice.** Each voice is turned into events by today's builder, through a voice view. Each event gets `voice: VoiceRef`, `sound: InstrumentId`, and `own: boolean` (part of your line). The dynamics of a staff are read from all its voices and applied to every voice of it.
4. **Merging.** The events are merged and sorted by start, then by part, staff and voice. `index` is the position in the merged list. Legato and ties look up `nextInVoice` instead of `index + 1`.
5. **Sound per part.** A two-staff part uses `piano`. Any other part uses the piece's instrument: `practice.instrument`, or else the default from Settings. Transposition and range follow that instrument. The session backend loads every instrument it needs: `backend(instruments: Instrument[])`.
6. **Your line off.** Events with `own: true` are kept for the cursor but not scheduled. Turning your line back on schedules them from the next event on, as switching the metronome on mid-play does today.
7. **Cursor.** It highlights every `own` event that is sounding at the playing time, not one event, and it uses the bar spans for the bar.
8. **Shared timing.** Count-in, metronome, loops and "start from a tapped note" all use the shared bar spans. A tapped note starts playback at its start time, for every part.

*Alternative:* one timeline from all voices at once in a single new builder. Rejected: the per-voice builder already handles slurs, ties, staccato, accents, dynamics, hairpins and the ornaments of `more-marks`, and it is well tested. Merging after building keeps all of that.

### D7. Drawing your part

- **Practice** draws with `parts: [yourPart.id]`.
  - A two-staff part is drawn as a grand staff, with the brace Verovio adds for `<staves>2`.
  - With one hand chosen, the score view adds a class to the other staff's `g.staff` in each `g.measure`, by position: staff 1 or 2 within the measure. CSS fades it, as in the mock.
- **Lines and scrolling:** `lines.ts` works on `g.system`, which holds both staves, so a line is a system.
- **Photo of a line:** no change is needed. homr's layout patch (`vendor/homr/page_layout.py`, patch 8) already gives one box per system, the union of its staffs, with the bars of the first part. Bars are shared by all parts, so those ranges hold for every part. Checked on the prototype's melody-and-piano page: four systems of three staves each, each with one box and bars 1–6, 7–12, 13–18 and 19–24.

### D8. The editor until `edit-parts`

The editor opens the voice view of the first voice of your part and edits it as today. Score-level edits (time, key, clef, bar lines) go through the new score-level functions. This keeps every existing editor test green. `edit-parts` replaces this with full part, staff and chord-note editing, before the release.

### D9. Practice screen

- **The card:** a "your part" card sits next to the metronome card. It shows the part or hand name and On/Off, and a tap toggles `ownLine`. To make room, the metronome card loses its icon.
- **The hint:** a toast-style hint shows once per piece (`partsHintSeen`). Its text names the parts: for a melody with piano, "Melody with a piano accompaniment. Try ⋯ › Your part."
- **Practice tools** gets two rows:
  - *Your part*: radio rows for each part, and for a piano part, both hands, right hand and left hand. Under them, *Plays along* with a switch per part or hand.
  - *Instrument for this piece*: the instrument list, with "Default (tenor saxophone)" first.
- **When the rows show:** *Your part* and the card show only when there is more than one part or a two-staff part. *Instrument for this piece* shows only when the piece has a one-staff part.
- **Texts** go in `en.ts` only, as the app is English only.

### D10. Calls made while applying

- **The view's attributes:** a view measure carries the part's key, the staff's clef and the part's `multiRest` only on the bars where the model sets them, as the model did before parts. "In force" means the part's key goes to every staff's view and each staff gets its own clef. This keeps the view of a one-line score equal to today's measures, and keeps `isPlainRestBar` and the writer unchanged.
- **`VoiceRef`** is `{ part: string; staff: number; voice: number }`: the part by its id (`P1`, as in `practice.json`), the staff and the voice by index from 0.
- **Voices per staff:** every bar of a staff has the same number of voices. A voice with nothing in a bar has an empty list there, so a view always shares the model's arrays. The bar check skips an empty voice after the first, and the writer leaves it out.
- **Ids:** a view keeps a link to its score (`VoiceScore.of`). `freshId`, `freshDirectionId` and `usedIds` take the ids of the whole score through it, so a new id never repeats one in another part or voice.
- **Hidden rests** (`Note.hidden`, from `<forward>`) count in the bar check and in time, and are skipped by drawing (written as `<forward>`), selection, the note index, warnings and the range check.
- **Part names:** homr's "Voice" and "Piano", or a missing name, become "Piano", "Melody" or "Melody 1", "Melody 2" … only when the score has several parts or a piano part. A one-part, one-staff score keeps its name as read, so one-line pieces are stored exactly as before.
- **`<forward>`:** one with a `<voice>` (as the writer writes it) is a hidden rest in that voice. One without (homr's form) only moves the time cursor, and each voice gets a hidden rest where its next note starts after its own end. A later voice that ends early is filled to the end of the bar. Hidden rests have no stored id and get a fresh one at each reading; nothing refers to them.
- **Voice numbers:** on staff 2, a raw voice 1–4 counts as 5–8, because homr writes the follow-on bars of a multi-measure rest without moving staff 2's rest to voice 5. Voice indices follow the voice numbers used on each staff across the whole part, lowest first, not the order of first use.
- **No padding at the end of a bar:** a voice after the first may end early, and the bar check flags it only when it is too long. An empty first voice next to a busy later voice gets one hidden rest the length of the time signature in force. A direction that falls inside a hidden rest splits it, so it keeps its time.
- **Pages added to a piece saved before parts** are cut down to their first part, first staff and first voice, as the old reader did.
- **Drawing ids of clefs:** `clef-<bar>` stays for the first staff of the first part. Every other staff uses `clef-<bar>-<part>-<staff>`.
- **Warnings:** `computeWarnings(view, instrument)` stays for one voice. `computeScoreWarnings(score, yourPart, pieceInstrument)` runs the bar check on every voice and the range check on your part only, with `instrumentOfPart` (piano for a two-staff part).
- **Pages:** `preparePages` takes the kept set and returns `partsRead`. A missing part's whole-bar rests take the time in force, or without one the longest first-voice bar of that page.
- **Playback:** fermata intervals from every voice, silent ones included, are joined where they touch or overlap, and each joined interval is stretched once, so muting a part never changes the timing. The session backend keeps `backend(instrument)` for the piece's instrument, and every other sound loads once through `useSound`. A one-line piece loads only its own sound, as before. Starting or restarting at a point (a tapped note, a tempo change, Play after pause, a new loop rest) goes back to the start of the own note, as before, plays every event from that time in every part, and strikes again the notes of the other voices that are still sounding there. An instrument switch that cannot swap the timeline in place restarts the same way.
- **The parts step** draws the first three bars of each part with the app's own renderer (one Verovio page per part). A part left out because it only starts on a later page is told through the shell's notice ("A part that only starts on a later page was left out."), shown after the editor opens. If writing `practice.json` fails, the piece is still saved and opens on the first part.
- **Practice screen:**
  - The metronome card loses its icon only in portrait and only next to the part card. One-line pieces keep it as before.
  - In landscape, the part card is a 44 px square with a short name: "M" or "M2" for a melody, "R", "L" or "R+L" for the hands. The tint shows On or Off, as for the metronome.
  - Choosing another part clears *Plays along* and turns your line back on, as in the mock. A change of part or *Plays along* while playing restarts at the time reached, not at a note's start, and strikes again every note still sounding there, so the music never jumps back. Turning your line off or on never restarts.
  - The Your part and Instrument sheets replace the tools sheet rather than stacking on it.
  - A one-line piece now shows *Instrument for this piece* in Practice tools, as the spec asks for any piece with a one-staff part. This revises practice-app D17 ("no instrument" in the tools).
- **Hint wording** (the open question): a melody with piano gives "Melody with a piano accompaniment. Try ⋯ › Your part.", and a piano piece "A piano piece. Take one hand in ⋯ › Your part, and the app plays the other." Several melodies give "{count} parts: {names}. Choose yours in ⋯ › Your part.", and anything else "{names}. Choose your part in ⋯ › Your part." The hint is marked seen when it is shown.
- **Browser-dev:** `/?reading=melody-piano` makes the browser-dev reader answer with the melody-and-piano fixture, so the parts step and the practice screen of a two-part piece can be checked by eye (tasks 5.3 and 6.6).
- **Writer pins:** `web/test/fixtures/written/` holds today's writer output for the existing one-line fixtures, as stored, as drawn and as drawn in the editor. They were made with the code before this change, and the byte-for-byte test of task 3.2 compares with them.

## Risks / Trade-offs

- **[Risk] homr is not reliable enough on real phone photos of piano pages.** → Task group 1 is a first look: a few real piano pages through the prototype, and one on a real phone. It does not block the work; what it shows tunes the parts step and the warnings.
- **[Risk] Reading takes too long on the phone for dense three-staff systems,** or a system hits homr's limit of 608 tokens and is cut short. → Measured in the first look (task 1.2). If it is slow, the progress screen already shows per-staff progress. A system cut at the limit is flagged by the bar check, because its bars don't add up.
- **[Risk] The page-matching rule (in order, by number of staves) matches the wrong parts** when pages differ, for example a melody that is printed on page 1 only. → Handled: a part missing on a page gets rests. The odd remaining case, a part that appears later, is dropped with a warning. The test fixtures include a two-page piece (task 3.3).
- **[Risk] The fermata map changes timing for existing one-line pieces.** → The existing fermata tests stay green unchanged, and the map is the identity without fermatas.
- **[Risk] Sharing item arrays between the model and the voice view leads to aliasing bugs.** → The view is rebuilt after each edit (each edit already works on a fresh copy of the score, `editSession.ts`), and a test edits through a view and checks the model.
- **[Trade-off] The editor is limited between this change and `edit-parts`.** → The two land together, and no release is cut in between.
- **[Trade-off] Parts not kept cannot be brought back.** → The raw reading is still stored, so a later change can offer it.

## Migration Plan

No migration. A stored score with one part loads as one part with one staff and one voice. Absent `practice.json` fields fall back (D5), and a missing `partsRead` means "first part only" (D4). Two compatibility folders prove it:
- `web/test/fixtures/stores/v2-before-parts/`: a piece saved before this change;
- `web/test/fixtures/stores/v2-with-parts/`: a melody-and-piano piece saved by it.

## Open Questions

- None left: the hint wording was settled in task 6.4 (D10).
