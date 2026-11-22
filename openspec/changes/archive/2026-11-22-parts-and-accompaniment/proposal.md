# Proposal

## Why

homr 0.7.1 reads much more of a page than Snapsody keeps. On a method-book page with a melody and a piano accompaniment, it reads the melody, both piano staves, the chords and the second voices. The app's parser then keeps only the first part, the first staff and the first voice, and warns about the rest. Half the page is gone, and piano students cannot use the app at all.

Snapsody becomes a play-along app for those pieces too. You keep the parts you want, you choose the one you play, and the others play along.

This is the second of three changes. It builds on `more-marks`, which is applied first. Change `edit-parts` makes the editor fix these pieces, and the two land together, before the next release.

## What Changes

- **Score model:** a piece holds parts, a part holds one or two staves, and a staff holds one or more voices.
  - A bar holds what all parts share: number, time signature, bar lines, repeats and endings.
  - Each part has its own key. Each staff has its own clef.
  - Each voice holds today's list of notes, rests, chords and marks.
  - A one-line piece is one part with one staff and one voice. It behaves exactly as today.
- **Reading:** the parser and the writer keep every part, staff and voice that homr reads.
  - Pages are combined by matching their parts. A page where a part is missing gets rests for it.
  - The bar-length repair and the warnings run per voice.
  - The range check runs only on your part, with your part's instrument.
- **Choosing parts after reading:** when a reading finds more than one part, a step lists them, all ticked (for example *Melody* and *Piano*). You choose which to keep and which one you play. With one part, nothing changes from today. When pages are added later, their parts are matched to the piece's.
- **Practice:**
  - Only your part is drawn. A piano part keeps both staves, and when you take one hand, the other hand fades.
  - A card for your part sits next to the metronome. One tap turns the sound of your own line off and on.
  - A hint appears the first time a piece with several parts opens.
  - Practice tools gets two rows. *Your part* lets you choose your part and, under *Plays along*, switch each other part on or off. *Instrument for this piece* defaults to the instrument in Settings.
- **Sound:**
  - Every kept part plays, merged in time.
  - Your part, and any other one-staff part, sounds as the piece's instrument, with its transposition. A piano part sounds as piano, at concert pitch.
  - Metronome, count-in, tempo, fermatas and repeats are shared by all parts.
  - The cursor follows your part.
- **Library:** existing pieces keep working with no migration. They are one part with one staff and one voice.
- **Specs and texts:** the "melody only" limit is removed from the instruments spec, and the Play Store listing text no longer says Snapsody reads only single-line melodies.
- **A first look, not a gate:** a few real piano pages go through the local prototype, and one is read on a real phone for its reading time. What they show goes into the notes of this change. The work does not wait for it.
- **Not in this change:**
  - Upgrading homr, which stays at 0.7.1.
  - MusicXML import or export.
  - Getting back a part you did not keep. The raw readings stay stored, so this can come later.
  - A different sound for each accompaniment part beyond the rule above.
  - What homr does not read: lyrics, fingering, pedal, 8va lines, segno, coda and D.C., glissando, chord symbols, percussion and tab.
  - Editing the new structure. Until change `edit-parts` lands, the editor edits the first voice of your part, as today.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `score-recognition`:
  - "On-device recognition" reads into a score with parts, not a single-voice score.
  - "Recognised content" (as left by `more-marks`) adds parts, staves, voices and chords.
  - "Pages combined into one score" matches parts across pages.
  - "Range check" runs on your part.
  - New requirement "Choose the parts to keep".
- `score-capture`: "A new piece opens in the editor" shows the parts step first when there are several parts. "Add pages to a piece" matches the new pages' parts.
- `score-playback`:
  - New requirements "Only your part is drawn" and "Other parts play along".
  - "Cursor follows playback" follows the notes of your part.
- `practice-controls`:
  - New requirements "Your part", "Your line on or off", "Parts hint" and "Instrument for this piece".
  - "Practice settings remembered" adds your part, the parts that play along, your line's sound and the piece's instrument.
- `instruments`:
  - "Instrument choice" drops the melody-only limit.
  - "Default instrument" becomes the default for pieces without their own instrument.
  - New requirement "Piano parts sound as piano".

## Impact

- `web/src/core/score/model.ts`: the new structure (design D1), plus a voice view in today's shape, so per-voice code keeps working (design D2).
- `web/src/core/score/musicxml.ts`: reads and writes every part, staff and voice, with `<backup>`/`<forward>`, `<staff>` and `<voice>`.
- `web/src/core/score/repairs.ts`, `warnings.ts`, `prepare.ts`: per voice; the range check on your part only.
- `web/src/app/addMusic.ts`, `pages.ts` (combining pages), and a new parts step in `web/src/ui/screens/AddMusicViews.tsx`.
- `web/src/core/playback/timeline.ts`, `scheduler.ts`, `cursor.ts`, `player.ts`: one merged stream, events tagged by voice, the sound per part, your line's mute.
- `web/src/core/score/render.ts`, `web/src/ui/scoreView.ts`: draw your part only, and fade the other hand.
- `web/src/app/practiceSession.ts`, `library.ts` (`PracticeState`), `web/src/ui/screens/PracticeScreen.tsx`, `ToolsSheet.tsx`, `en.ts`.
- Stored piece format: still MusicXML (now with several parts), plus new optional fields in the practice state and the piece info. Compatibility folders under `web/test/fixtures/stores/`.
- Bridge: no new plugin calls or events. homr already returns every part on the phone.
- `openspec/specs/instruments/spec.md`, `docs/store/listing.md`.
- Depends on `more-marks`. Followed by `edit-parts`, which lands before the release.
