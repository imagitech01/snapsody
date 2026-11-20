# Proposal

## Why

homr 0.7.1 reads more marks than Snapsody keeps. A strong accent, staccatissimo, arpeggio, tremolo, trill, turn, mordent or caesura in the book is read and then dropped by the app's parser, so it is neither drawn nor played. Grace notes are drawn but stay silent. A fermata on a chord note other than the first is lost in playback, and a multi-measure rest shows as a row of empty bars. A mark that is drawn but not played would look like a bug, so the rule is: **everything Snapsody draws, it also plays**.

This is the first of three changes that make Snapsody keep everything homr reads. It is small and independent of the other two. Change `parts-and-accompaniment` (parts, staves, voices and chords in practice) and change `edit-parts` (the editor for those pieces) come after it and build on its spec text.

## What Changes

- **Reading:** the parser keeps strong accent, staccatissimo, arpeggio, tremolo (one note repeated, or two notes alternating), trill, turn, mordent, caesura and multi-measure rests. It also handles the way homr writes these marks:
  - a mordent written among the articulations;
  - every turn written as an inverted turn;
  - a tremolo written as start and stop, never as a single-note tremolo.

  Saving writes every kept mark back as valid MusicXML.
- **Drawing:** each kept mark is drawn where the book has it. A run of bars that homr read as one multi-measure rest is drawn as one symbol with its count in practice, and as separate bars in the editor.
- **Playing:**
  - a strong accent is louder than an accent;
  - staccatissimo is shorter than staccato;
  - an arpeggio rolls the chord upwards;
  - a tremolo repeats its note, or alternates between its two notes;
  - a trill alternates with the note above in the key;
  - a turn and a mordent play their few notes at the start of the note;
  - a caesura leaves a gap before the next note;
  - a grace note sounds just before the beat;
  - a fermata on any note of a chord holds the whole chord.
- **Editing:** the Marks tab can set and remove strong accent, staccatissimo, trill, turn, mordent, tremolo (on one note) and arpeggio (on a chord), as it does staccato today. A caesura is like a breath mark: it can be selected and deleted, not added. Each of these marks can be tapped to select it and deleted, like the marks the editor already knows. A two-note tremolo read from the page can be deleted but not created. Grace notes can be selected, changed and deleted like any note, but not added.
- **Not in this change:**
  - homr's "doit" mark, which Verovio does not draw. It is dropped with a warning, so it stays neither drawn nor played, as today.
  - Pieces already saved keep the marks they have. A mark appears on pages read after this change.
  - Parts, staves, voices and chords beyond today's first voice (change `parts-and-accompaniment`).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `score-recognition`: "Recognised content" lists the new marks and multi-measure rests.
- `score-playback`: new requirements "Ornaments in playback", "Grace notes in playback", "Chord marks in playback" and "Stronger and shorter marks in playback". "Score display" draws a multi-measure rest as one symbol.
- `score-editing`: "Articulation marks" covers the new marks, "Select any element" names them, and "Delete an element" removes them. A new requirement, "Multi-measure rests while editing", draws each bar of a multi-measure rest on its own in the editor.

## Impact

- `web/src/core/score/model.ts`: new optional fields on `Note` (strong accent, staccatissimo, caesura, ornament, tremolo, arpeggio) and on `Measure` (multi-measure rest count). Each is optional, so older pieces load unchanged.
- `web/src/core/score/musicxml.ts`: reads homr's forms and writes valid MusicXML (design D1, D2). A serializer option draws multi-measure rests as separate bars for the editor.
- `web/src/core/playback/timeline.ts` and `scheduler.ts`: a playback event can carry the notes it actually sounds (design D3), which ornaments, arpeggios, tremolos and grace notes use. The cursor still moves per written note.
- `web/src/core/score/elements.ts`, `edit.ts`, `web/src/ui/screens/editor/MarksTab.tsx`, `en.ts`: selecting, toggling and deleting the new marks.
- `web/src/core/score/noteMap.ts`, `cursor.ts`: the cursor over a multi-measure rest drawn as one symbol.
- Stored piece format: still MusicXML, with more elements. A compatibility folder under `web/test/fixtures/stores/` proves that pieces saved before this change still load.
- Specs and listing: no text changes beyond the three specs above.
