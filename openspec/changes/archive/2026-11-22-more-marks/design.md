# Design

## Context

See proposal.md for why. Today:

- **What homr 0.7.1 writes** (`vendor/homr/music_xml_generator.py`, `build_articulations`):
  - `strong-accent`, `staccatissimo`, `mordent`, `caesura`, `doit` and `breath-mark` go under `<articulations>`. A mordent there is not valid MusicXML.
  - `trill-mark`, `inverted-turn` (for every turn: homr has only one turn token) and `tremolo` go under `<ornaments>`.
  - The tremolo has text `3`, and its `type` toggles between `start` and `stop` over the whole piece. It is never `single`.
  - `arpeggiate` and `fermata` go directly under `<notations>`.
  - Grace notes are `<grace/>` with a type and no duration.
  - A multi-measure rest is `<measure-style><multiple-rest>n</multiple-rest>` on the first bar. That bar holds a whole-bar rest itself and is followed by n−1 more, so the run is n explicit bars in all (checked in `music_xml_generator.py` during task 1.2).
- **What the app keeps** (`musicxml.ts`): staccato, tenuto, accent, breath mark and fermata, plus grace notes (drawn, but skipped by `timeline.ts`). It drops the rest. In playback a chord member merges only `accent` into the chord's event, so a fermata on a chord member is lost.
- **Verovio check** (20 Nov 2026, this repo's Verovio). A fixture with every mark was drawn twice: once as homr writes it, once in valid MusicXML.
  - Drawn as written by homr: strong accent and staccatissimo (`g.artic`), turn (`g.turn`), trill (`g.trill`), arpeggio (`g.arpeg`), caesura (`g.caesura`), a fermata on a chord note, grace notes, and the start/stop tremolo pair (`g.fTrem`).
  - The mordent is drawn only when it is moved to `<ornaments>` (`g.mordent`). A one-note tremolo needs `type="single"` (`g.bTrem`).
  - A doit is not drawn.
  - `<multiple-rest>3</multiple-rest>` turns three bars into one drawn `g.multiRest` with its number. Verovio then draws fewer `g.measure` groups than the model has bars.
- **Playback** builds one `PlaybackEvent` per written note or chord. Its `pitches` all start at `start` and sound for `sounding`. The cursor, the legato logic (`played[i + 1].index === ev.index + 1`) and the bar spans all depend on that list.

## Goals / Non-Goals

**Goals:**
- Every mark that is drawn is heard, and keeps the beat.
- The model stays in written terms. Ornament notes are worked out at playback time and never stored.
- One playback shape that change `parts-and-accompaniment` can reuse when it merges several parts into one stream.

**Non-Goals:**
- Ornament variants homr does not read: inverted mordent, trill with an accidental above, delayed turn, tremolo with another number of strokes.
- Choosing the trill speed, or the style of an ornament, in the app.

## Decisions

### D1. Model fields

```ts
interface Note {
  // … as today
  strongAccent?: boolean
  staccatissimo?: boolean
  caesura?: boolean
  ornament?: 'trill' | 'turn' | 'mordent'      // at most one per note
  tremolo?: { kind: 'single' | 'start' | 'stop'; strokes: number }
  arpeggio?: boolean                           // on the chord's first note
}
interface Measure {
  // … as today
  multiRest?: number                           // on the first bar of the run: how many bars it covers
}
```

- **One ornament per note.** homr can emit more than one, but a printed note practically never carries two. If it does, the first one read is kept and a warning is given.
- **The arpeggio sits on the chord's first note** because it belongs to the chord. It is read when any chord note has `<arpeggiate/>`, and written on every chord note, as MusicXML expects.
- **The multi-measure rest stays n explicit bars,** as homr writes them. `multiRest` only says that they were printed as one symbol. *Alternative:* one model bar with a length of n bars. Rejected: bar numbers, repeats, the bar check and the editor all assume one bar per bar.

### D2. Reading homr's forms, writing valid MusicXML

- **Reading:**
  - `<mordent>` is accepted under both `<articulations>` and `<ornaments>`.
  - `<inverted-turn>` and `<turn>` are both read as `turn`. homr has a single turn token and writes it as inverted. The printed symbol in the books we use is the regular turn (upper note first).
  - `<doit>` is dropped with a warning.
- **Tremolo pairing (an assumption, since homr does not say which kind):**
  - A `start` whose next note in the same bar has a `stop` forms a two-note tremolo.
  - Any other `start` or `stop` becomes `single`.
  - The number of strokes comes from the element's text, with 3 when it is missing.
- **Writing:** standard MusicXML, as Verovio needs it:
  - `mordent`, `turn` (as `<turn>`), `trill-mark` and `tremolo` under `<ornaments>`;
  - `strong-accent`, `staccatissimo` and `caesura` under `<articulations>`;
  - `arpeggiate` and `fermata` under `<notations>`;
  - `<measure-style><multiple-rest>` on the run's first bar.
- **Drawing the run as one rest:** `serializeMusicXml` gets the option `multiRests: 'collapse' | 'expand'`. (Change `parts-and-accompaniment` moves `multiRest` to a part's bar and collapses a run only when every staff of the drawn part rests.)
  - Practice draws with `collapse`. The `<multiple-rest>` is written only while every bar of the run is still a plain whole-bar rest with nothing else in it (no clef, key, time, barline or direction changes). Otherwise the run is drawn as separate bars.
  - A clef, key or time on the run's *first* bar does not break it, because Verovio draws them before the symbol. A part that opens with a long rest still collapses. (Decided during task 1.3.)
  - The single place that decides whether a run holds is `multiRestRuns(score)` in `model.ts`. The serializer, the bar-to-drawn-measure table (D5) and the clearing of `multiRest` after an edit all ask it.
  - The serializer's default is `collapse`, so a saved file keeps the run. The editor draws with `expand`.
  - The editor draws with `expand`.
  - Saving keeps `multiRest` as long as the run still holds. An edit that breaks the run clears it.

### D3. Playback: an event can carry its own sounds

`PlaybackEvent` gets an optional `sounds`:

```ts
interface Sound { midi: number; offset: Frac; length: Frac; gain: number }  // offset and length in beats, from ev.start
interface PlaybackEvent { /* … as today */ sounds?: Sound[] }
```

- **Without `sounds`,** nothing changes: `pitches` start at `start` and sound for `sounding`. **With `sounds`,** the scheduler plays those instead, each as its own note-on and note-off. The event keeps its `start`, `length`, `noteIds` and `index`, so the cursor, bar spans and legato logic are untouched.
- **Ornament note value:** `ORNAMENT_NOTE = 1/8 beat` (a thirty-second note in quarter-note beats). Ornaments speed up and slow down with the practice tempo, as the rest of the music does. At 120 bpm that is 16 notes per second; at 60 bpm, 8.
- **Trill:** alternates main note and upper note (diatonic in the key in force, with an accidental earlier in the bar honoured), starting on the main note, every `ORNAMENT_NOTE`. The last sound is the main note, so the trill ends where it began. The trill fills the event's `sounding`.
- **Turn:** upper, main, lower, then main held for the rest of the note. Each of the first three lasts `ORNAMENT_NOTE`, at most a quarter of the note each.
- **Mordent:** main, lower, then main held for the rest of the note, with the same rule.
- **Tremolo:** notes of 1/2^(strokes + 2) of a whole note. With 3 strokes that is a thirty-second.
  - A single tremolo repeats the note over its value.
  - A two-note tremolo alternates the two notes over the pair's combined value. The two notes form one event, starting at the first note and with both note ids.
- **Arpeggio:** the chord's notes from low to high, each entering `ARPEGGIO_STEP = 1/16 beat` after the one below, all ending at the chord's end. The lowest note stays on the beat.
- **Grace notes:** each grace note becomes a sound with a negative offset on the event of the note it precedes. The grace notes before a note sound in order, each `GRACE_NOTE = 1/8 beat` long and ending on the beat. Their time is taken from the previous event's sound, so the beat grid does not move. When nothing sounds before them in the played order (the start of the piece, a loop's first bar, a tapped start), they sound in the time just before the start: in the count-in's last beat when it is on, and otherwise playback begins that much earlier. A grace note gets no cursor of its own.
- **Strong accent:** an attack `STRONG_ACCENT_DB = 7` dB above the level (accent is 4), with the same `MAX_ATTACK_GAIN` cap.
- **Staccatissimo:** sounds for a quarter of the value (staccato is a half). Tenuto does not cancel staccatissimo.
- **Caesura:** like the breath mark but with a gap of 1/4 beat (the breath mark's is 1/8), taken from the note's sound.
- **Fermata in a chord:** a fermata on any chord member stretches the chord's event, not only on the first note.
- All the constants sit next to the existing ones in `timeline.ts` and are tuned by ear in one task.

Decided while building it (tasks 3.1–3.3):
- `Sound.offset` and `length` are in quarter-note beats from `ev.start`, as the other event fields are. A grace note has a negative offset.
- A two-note tremolo is one event, as a tie is: its `length` is both written values, `noteIds` holds both, and the cursor highlights both notes for the pair's length. Event indexes stay consecutive.
- Grace notes in the normal case take their time from the end of the previous event's sound: at most `GRACE_NOTE` each, and at most half of the previous note. With nothing before them, the scheduler's start moves earlier by their lead, which falls in the count-in's last beat when the count-in is on. In a loop, the loop's first grace notes sound at the end of the pass before, and the loop's last note is shortened so it does not sound over them. They are scheduled with the pass before, because the next pass is only built once that one is handed out, which at slow tempos is later than they begin.
- A trill note is `min(ORNAMENT_NOTE, sounding / 3)`, with an odd count so the trill ends on the main note. A turn or mordent note is `min(ORNAMENT_NOTE, sounding / 4)`.
- An event with `sounds` is not slurred into or out of. Only the sound on the beat carries an accent.
- A strong accent also sets the event's accent, so it uses the accent path with 7 dB under the same cap. Staccatissimo also counts as staccato for the release and for ending a slur. A caesura and a breath mark on one note take the larger gap, at most half the note.
- An ornament on a chord note, the first or another, is played on that note while the chord's other notes are held. The Marks tab can put a trill on any chord note, so it has to be heard. Tremolo strokes are clamped to 1–6.
- Three combinations stay silent on purpose, because a book practically never prints them and homr reads them only by mistake. The user can see them and delete them:
  - an arpeggio on a chord that also has a tremolo, which plays the tremolo;
  - grace notes before a tied continuation;
  - grace notes before the second note of a two-note tremolo. Both of these would fall inside a sounding event.
- The doit warning goes into the parser's `warnings`, like every other dropped item (further parts, voices). The app shows none of those today, and this change adds no new report.

*Alternative:* turn each ornament note into its own `PlaybackEvent`. Rejected: the cursor would jump around on a trill, the event index would no longer match one written note, and the legato logic would treat a trill as a slur.

*Why this suits change `parts-and-accompaniment`:* that change merges the events of several parts into one stream. An event that carries its own sounds can be merged like any other, and nothing in it depends on the next event.

### D4. Selecting and deleting the new marks

`elements.ts` maps the new SVG groups to an `ElementRef`:
- **`g.artic`**: strong accent and staccatissimo, by their SMuFL glyphs. The Verovio check drew E4AC (marcato above) and E4A8 (staccatissimo stroke above); the below forms (E4AD, E4A9) are added and pinned in a test.
- **`g.trill`, `g.turn`, `g.mordent`**: the ornament of their note.
- **`g.bTrem` and `g.fTrem`**: the tremolo of their note, or of the pair.
- **`g.arpeg`**: the chord's arpeggio.
- **`g.caesura`**: the caesura.

Whether Verovio keeps an id written on these elements is not assumed (task 4.1 checks it). Where a group has no kept id, the existing rule applies (the nth such group in a bar is the nth note in that bar that has the mark), as for fermatas and breath marks today. `ArticulationMark` grows to `'strongAccent' | 'staccatissimo' | 'caesura' | 'ornament' | 'tremolo' | 'arpeggio'`, and `deleteElement` removes the mark (for a two-note tremolo, from both notes).

Found and decided while building it (tasks 4.1–4.3):
- Verovio keeps no written id on any of the new groups (`g.artic`, `g.trill`, `g.turn`, `g.mordent`, `g.bTrem`, `g.fTrem`, `g.arpeg`, `g.caesura`). They are all mapped by glyph (`g.artic`) or by order within the bar, and a chord counts as one note for that order. This also maps a fermata on a chord note other than the first, which was left unmapped before.
- `g.bTrem` and `g.fTrem` wrap their notes, so only the strokes select the tremolo. A tap on a note head still selects the note. A two-note tremolo maps to its first note, and deleting it from either note removes it from both.
- The app writes no `placement`, so a strong accent is always drawn above (E4AC). The below form (E4AD) is mapped and pinned in a test all the same.
- `multiRest` is cleared in `EditSession.apply`: a run that held before the edit and no longer does, by `multiRestRuns`, loses it. So it covers every edit, and undo brings it back.
- Turning a note into a rest clears its new marks. Deleting one note of a two-note tremolo removes the tremolo from the other. Deleting a chord's first note moves the arpeggio to the new first note, or drops it when one note is left.

The Marks tab adds chips for Strong accent, Staccatissimo, Trill, Turn, Mordent, Tremolo and Arpeggio:
- Trill, turn and mordent replace each other.
- Tremolo sets a single tremolo with 3 strokes.
- Arpeggio is disabled unless the selected note is in a chord.

The tab already wraps its chips in a grid, which grows by two rows. That fits at 360 × 780, to be checked by eye.

### D5. The cursor on a collapsed rest

`noteMap.ts` maps model note ids to drawn groups. When the run is collapsed:
- the whole-bar rests of all its bars map to the one `g.multiRest`;
- `lines.ts` and `cursor.ts` treat that group as covering bars k to k+n−1;
- every lookup of a bar by its position among the drawn `g.measure` groups goes through one table from bar index to drawn measure. Today `scoreView.ts` indexes `measureNodes[barIndex]` (the line of a bar, the bar highlight), and `lines.ts` counts measures as bars. A collapsed run is one drawn measure for n bars, so without the table every bar after it would point one or more measures too far. Loop bounds and tap-to-start go through the same table.

The cursor highlights the symbol from the first bar's start to the last bar's end, and a tap on it in practice starts at its first bar.

Found while building it (task 2.2): Verovio gives the `g.multiRest` an id of its own and keeps none of the run's rest ids, so the rests map to it through the table (`drawnBars(score, multiRests)` in `noteMap.ts`, built only from `multiRestRuns`). Collapsed, the fixture's 12 bars are drawn as 9 `g.measure`.

## Risks / Trade-offs

- **[Risk] A turn really printed inverted, or a mordent with or without its stroke, is played the other way.** → homr cannot tell them apart, so neither can we. The user can hear it and swap the mark in the editor. Recorded under Non-Goals.
- **[Risk] Tremolo pairing guesses wrong.** For example, two single tremolos on consecutive notes are read as one pair. → It plays as an alternation between the two notes, and the user can delete it. A unit test pins the rule.
- **[Risk] The bar check flags a two-note tremolo.** homr writes the two notes with their printed values, while in MusicXML the pair together fills one of them, so the bar may not add up. → The fixture of task 1.2 settles which one homr does. If the bar check flags it, the pair counts once in the bar check. *Settled in task 1.2:* homr writes both notes with their full printed values, so a bar holding a pair adds up and neither the bar check nor the repair flags it (pinned in `warnings.test.ts`).
- **[Risk] Ornaments sound mechanical.** → They are practice aids, not performances. The constants are tuned by ear on the phone once (task 5.2).
- **[Trade-off] Pieces saved before this change don't gain the new marks,** because their stored score was written without them. → Re-reading the raw recognition for old pieces is left out on purpose. It would undo the user's edits.

## Migration Plan

No migration. Every new field is optional, and old pieces load as before. A compatibility folder `web/test/fixtures/stores/v2-before-more-marks/` proves it.
