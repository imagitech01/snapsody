## MODIFIED Requirements

### Requirement: Recognised content
The recognised score SHALL include, where printed: clef, key signature, time signature, pitches with accidentals, note and rest durations including triplets, grace notes, ties, slurs, staccato, staccatissimo, tenuto, accent, strong accent, fermata, breath marks, caesura, arpeggio, tremolo, trill, turn, mordent, dynamics, bar lines, repeat signs with first/second endings, and multi-measure rests. Tempo words and metronome marks are not recognised.

#### Scenario: Exercise 87 reference
- **WHEN** the reference photo of exercise 87 (`20261111_1701026728888866947001497.jpg`, kept in the local-only fixtures folder) is cropped to exercise 87 and recognised on the phone
- **THEN** the score has G major, 3/4, *mf* and 19 bars, and its pitches, durations, triplets, slurs and staccato in bars 1–19 match homr 0.7.1's output on a Mac for the same image, including a dotted half note G in bar 19

#### Scenario: Tempo marking not read
- **WHEN** an exercise printed with "Moderato" is recognised
- **THEN** the score contains no tempo marking, and the exercise uses the default tempo until the user enters one

#### Scenario: Repeat sign
- **WHEN** an exercise with an end-repeat sign and no start-repeat sign is recognised
- **THEN** the score marks the repeat from the beginning of the exercise to that sign

#### Scenario: Ornaments kept
- **WHEN** homr reads a page with a trill, a turn and a mordent
- **THEN** the piece keeps all three on their notes, a turn read by homr as an inverted turn is kept as a turn, and the mordent is kept as an ornament even though homr writes it among the articulations

#### Scenario: Multi-measure rest
- **WHEN** homr reads a rest over four bars printed as one symbol with the number 4
- **THEN** the piece has four bars of rest, marked as one multi-measure rest of 4

#### Scenario: A mark the app does not draw
- **WHEN** homr reads a "doit" on a note
- **THEN** the note is kept without it, and the reading reports that the mark was dropped
