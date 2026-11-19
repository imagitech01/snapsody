# Design

## Context

See proposal.md for why. Today:

- The editor selects a bar, with or without a note (`EditorSession.chosen = { bar, noteId }`). `scoreView.ts` finds the note under the finger through `g.note`, `g.rest` and `g.mRest`, whose SVG ids are the model's note ids. That works because `serializeMusicXml` writes `<note id>` and Verovio keeps it.
- The model holds clefs, keys and times per measure (a mid-bar change is moved to the start of its bar when it is read). Dynamics, tempo marks and text are measure items without an id. Slurs are numbered marks on notes, ties are flags on notes, hairpins refer to their first and last note, and articulations are flags on notes.
- Pitches are stored as written pitch (step, octave and alter), worked out by recognition under the clef it read. A wrong clef therefore means wrong pitches, not just a wrong drawing.
- Verovio check (18 Nov 2026, this repo's Verovio, the `all-elements` fixture with `id` attributes added): Verovio **keeps** the ids of a clef change (`<clef>` inside a bar), `<slur>`, `<tied>` and a hairpin (`<wedge>` start). It **makes up its own** ids for dynamics, tempo marks, text (`g.dir`), articulations, bar lines, key and time signatures, tuplets, and the clefs drawn at the start of each system.
- Existing removals to reuse: `toggleSlur`, `toggleTie`, `removeWedge`, and the articulation toggles in `edit.ts`.

## Goals / Non-Goals

**Goals:**
- One selection model, "a note, a bar, or an element", where each element is described in model terms, so the selection is independent of Verovio's ids.
- A reliable mapping from a tap to that description, for every kind listed in the spec.
- Fixing a clef keeps the notes where they are on the staff.

**Non-Goals:**
- Dragging or moving elements, multi-select, and adding new kinds of elements.
- Tuplets and endings (see proposal).

## Decisions

### D1. An element reference in model terms

```ts
type ElementRef =
  | { kind: 'clef' | 'key' | 'time'; bar: number }          // the change at that bar, or the first one at bar 0
  | { kind: 'dynamic' | 'tempo' | 'words'; id: string }      // new item ids
  | { kind: 'slur'; noteId: string; number: number }        // the slur that starts on that note
  | { kind: 'tie'; noteId: string }                          // the tie that starts on that note
  | { kind: 'wedge'; startId: string }
  | { kind: 'articulation'; noteId: string; mark: 'staccato' | 'tenuto' | 'accent' | 'fermata' | 'breath' }
  | { kind: 'barline'; bar: number }                         // selects the bar (edit-bar-lines)
```

Dynamic, tempo and words items get an `id`, given when the score is read (as `nextId` does for notes) and written as `<direction id>`. A stored piece without them gets fresh ids, so old pieces load unchanged. *Alternative:* refer to them by (bar, index). Rejected, because an insert or delete in the same bar would make the reference point at another item, and undo and redo would select the wrong one.

### D2. From a tap to an element: ids where Verovio keeps them, order where it does not

When drawing, the serializer (with a `drawingIds` option, like `beams`) writes ids that Verovio keeps:
- `clef-<bar>` on a clef change;
- `slur-<noteId>-<n>` on a slur start;
- `tie-<noteId>` on a tie start;
- `wedge-<startId>` on a hairpin start.

These ids are written for drawing only and never stored.

For the rest, the score view reads the element's place in the SVG:
- **Dynamics, tempo marks and text:** the nth `g.dynam`, `g.tempo` or `g.dir` in the nth `g.measure` is the nth model item of that kind in that bar. Verovio draws them in source order within a bar; a unit test on the fixture pins that down.
- **Articulations:** a `g.artic`, `g.fermata` or `g.breath` inside or attached to a `g.note` belongs to that note. Which mark it is comes from its SMuFL glyph (`use` href or code point). If the glyph cannot be read, the note's own marks are matched in a fixed order. Task 1.4 settles this.
- **Key and time signatures, and clefs at system starts:** a `g.keySig`, `g.meterSig` or `g.clef` resolves to the key, time or clef *in force* at the bar where it is drawn. A courtesy signature at the start of a system therefore selects the change that is in force there, or the first one.
- **Bar lines:** a `g.barLine` selects the bar it closes.

Hit test: first the element drawn directly under the finger, the smallest one when several overlap. Only when there is none, the nearest note within reach, as today. *Alternative:* a separate "elements" mode, so taps on notes are never ambiguous. Rejected, because one mode is simpler, and the scenarios show the order of precedence is enough.

### D3. Fixing a clef keeps staff positions

`setClef(score, bar, clef)` and `deleteClef(score, bar)` work out the clef in force before and after the edit, for each bar up to the next clef change. Every note in that range is moved by the difference in staff position, in diatonic steps. Treble to bass is 12 steps down: the middle line goes from B4 to D3. Explicit accidentals stay with their notes, and `resolveAlters` then works out the alters from the key for the changed bars. Rests and unpitched items are untouched. The first clef can be changed but not deleted.

*Alternative:* keep the pitches and only change the clef, so the notes move on the staff. Rejected, because recognition reads positions correctly. When it misreads a clef, the positions are right and the pitches are wrong.

### D4. Deleting key and time changes

`deleteKey(score, bar)` removes the change and runs `resolveAlters` from that bar to the next key change. `deleteTime(score, bar)` removes the change, and the bar check flags any bars that no longer fit. Neither applies to bar 0, whose key and time are set in the Score tab.

### D5. The element panel

When an element (not a note or bar) is selected, the tool area shows a compact panel above the tabs: the element's name and bar ("Clef · bass · bar 11"), a **Delete** button (danger tone, where allowed), and for a clef, a treble/bass `SelectField`. Tapping a note or an empty part of the score returns to the normal tabs. An articulation or slur selected this way can also be removed from the Marks tab, as before. The panel is a shortcut, not a replacement.

**Figma:** frames 06.1–06.3 have no element panel. Planned deviation, recorded in `docs/design/deviations.md` under 06.x: the panel sits above the tabs and uses the existing chip and select styles, so the tabs stay as in the frames.

### Implementation notes (made during apply, 19 Nov 2026)

Calls made while implementing, and what the Verovio 6.4 drawing turned out to be:

- **D1 ids.** Direction ids are numbered `d1`, `d2`, ... A direction id never takes an id a note already has, so note ids come out as before. One `<direction>` that gives several items (two dynamics) gives the first item its id and the others fresh ones. `mergePages` gives direction ids afresh, as it does note ids, because each page numbers its own from `d1`. `setTempoMarking` keeps the id of the marking it replaces.
- **Compatibility store.** The piece format (`piece.json`, `PIECE_FORMAT = 2`) does not change: the `id` on `<direction>` is optional MusicXML. A new folder, `web/test/fixtures/stores/v2-before-direction-ids/`, holds a piece written by the code before this change, with a tempo mark, two dynamics in one bar, and words. It goes next to `v2/`, which is unchanged.
- **D2 dynamics, tempo and words** are matched in one sequence, not per class. Verovio draws a tempo mark of words only (as the serializer writes it) as `g.dir`, not `g.tempo`. In a bar, `g.dynam`, `g.tempo` and `g.dir` are drawn in source order across kinds, so the nth of them is the nth drawn direction item of the bar. If the counts ever differ, the code falls back to matching by kind.
- **D2 fermatas and breath marks** are drawn at bar level after the notes, not inside `g.note`. The nth `g.fermata` (or `g.breath`) of a bar is the mark of the nth note of the bar that has one. Staccato, tenuto and accent are inside the note and are told apart by glyph.
- **D2 key, time and clef at a system break.** A courtesy key, time or clef at the end of a system is drawn in the staff of the last bar, after its layer. A signature after the layer therefore maps to the one in force at the next bar; one before the layer maps to the one in force at its own bar. A clef change is drawn inside the layer of the bar before it and keeps its `clef-<bar>` id.
- **D2 split slurs, ties and hairpins.** The second piece of one that runs onto the next system is drawn at system level, outside any bar. It carries the drawing id as a class `id-<id>`.
- **D2 bar lines.** A start-repeat drawn at the start of bar N selects bar N, as the bar's right bar line does. The bar-line controls of bar N show both its start and its end.
- **Bars in `ElementRef` and in `clef-<bar>`** are indexes from 0. The selection and the texts count from 1.
- **Selection after a delete.** The session keeps the deleted element's reference, so undo selects it again, as the spec scenario asks. `selectedElement` is undefined while the element is gone. The next edit made while it is gone forgets the reference, so adding the same mark again later does not select it by surprise.

- **Hit test order (D2).** A tap is checked in this order:
  1. The smallest mapped element painted under the finger (`elementsFromPoint`).
  2. A note painted under the finger.
  3. The box of an element that is not a slur, tie or hairpin, within 6 px, unless a note is as near or nearer. This slack is there because a clef's box has gaps where nothing is drawn. Spanner boxes never count, because they cover the notes under them. For an articulation, only note heads and rests count as near, because the note's own box holds its staccato dot or accent. A UI test taps 3 px beside a staccato dot and gets the dot.
  4. The nearest note within reach, as before.

  Element hit-testing is opt-in. Only the editor turns it on, so practice taps are unchanged.
- **Taps around the panel (D5).** A tap on empty score puts the element panel away and keeps its bar selected. While the notes of a new slur, tie or hairpin are being chosen, only notes count. A tap on a bar line also switches to the Marks tab, where the bar-line controls are.
- **Panel contents (D5).** In place of Delete, a first clef, key or time signature shows "The first one is changed, not deleted." The clef choice is treble or bass only; a C clef shows as treble. A hairpin is named "Crescendo or diminuendo", because the reference does not carry its type.

## Risks / Trade-offs

- [Verovio's order of `g.dynam` and `g.dir` in a bar may not match source order for items at the same time position] → A unit test on the `all-elements` fixture and a two-dynamics bar. If the order differs, the mapping falls back to sorting both by horizontal position.
- [Small glyphs, such as a staccato dot, are hard to hit with a finger] → The hit test takes the smallest element within a few pixels of the finger. Marks can still be removed from the Marks tab with the note selected.
- [A misread clef change that recognition also used to break a beam or slur] → Out of scope. Only pitches move, and beams are recomputed for drawing anyway (`beams.ts`).
- [Verovio upgrades can change SVG classes] → The order mapping lives in one module with its own unit test against the bundled Verovio.

## Migration Plan

None beyond the D1 id fallback. Pieces stored before this change load and get ids in memory, and those ids are saved with the next save.
