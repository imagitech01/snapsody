# Instrument sounds (practice-app group 7; design D8 and D9)

Every instrument plays recorded samples that are bundled with the app and work offline. They all come
from one General MIDI SoundFont, converted at build time into the sample format of
`web/src/core/playback/samples.ts` (a folder of Ogg/Opus files plus `map.json`). The first version's
FreePats tenor-sax set (CC0, chosen by ear on 2026-11-18) was replaced by the tenor sax from this
SoundFont; its notes are in the git history of this file.

## Decision (task 7.1)

Checked 2026-11-18 against the primary sources (the files were downloaded and read).

**Chosen: MuseScore_General 0.2, MIT License.**

- File: `MuseScore_General.sf2` (SoundFont 2.1, 16-bit, 215,614,036 bytes, mirror date 2020-07-10; the
  file's own name field says "MuseScore_General v0.2", the mirror's `VERSION` file says 0.2.0).
- URL: https://ftp.osuosl.org/pub/musescore/soundfont/MuseScore_General/MuseScore_General.sf2
  (the folder also has `MuseScore_General_License.md`, `_Readme.md`, `_Sample_Sources.csv` and `_Changelog.md`).
- SHA-256: `ee51d2c4b1525e70f19a45909c4fd7a2e26d91d115fa89dbf5a6bc413d8b9bf3`
  (the converter checks it; the same value is in `tools/samples/instruments.json`).
- It is not in the repository (`*.sf2` and `*.sf3` are git-ignored). Download it to
  `build/samples-src/musescore-general-0.2/` (see Reproduce).
- Licence text, from `MuseScore_General_License.md` (the acknowledgements "must be included in any
  derivative work", so `NOTICE` repeats this block):

  ```
  FluidR3 (original version) by Frank Wen Copyright (c) 2000-02
  Mono conversion (FluidR3Mono) by Michael Cowgill Copyright (c) 2014-17
  Adaptation for MuseScore_General.sf2 by S. Christian Collins Copyright (c) 2018-19
  Temple Blocks instrument provided by Ethan Winer Copyright (c) 2002
  Drumline Cymbals provided by Michael Schorsch Copyright (c) 2016

  MuseScore_General.sf2 is shared under the MIT license as described in COPYING, as was FluidR3Mono and FluidR3 before it.

  COPYING
  Mono version:  Copyright (c) 2014-16 Michael Cowgill
  Copyright (c) 2000-2002, 2008 Frank Wen <getfrank@gmail.com>

  Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
  associated documentation files (the "Software"), to deal in the Software without restriction,
  including without limitation the rights to use, copy, modify, merge, publish, distribute,
  sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
  furnished to do so, subject to the following conditions:

  The above copyright notice and this permission notice shall be included in all copies or
  substantial portions of the Software.

  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
  NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
  NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
  DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT
  OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
  ```

  MIT allows copying, modification and redistribution (including in a GPL-3.0 or AGPL-3.0 app) as
  long as the notice travels with it. The same text sits in the SF2 file (`ICMT`: "Released under
  the MIT license"; `ICOP`: "Frank Wen 2000-02, Michael Cowgill 2014-17, S. Christian Collins 2018-20").
- Where the instruments we use come from (`MuseScore_General_Sample_Sources.csv`, which names a
  source only where the samples are not FluidR3Mono's):

  | Instrument (GM preset) | Samples |
  |---|---|
  | Tenor Sax, Alto Sax, Clarinet, Nylon String Guitar, Violin | no credit listed: FluidR3Mono (Frank Wen, Michael Cowgill). The original FluidR3 readme thanks Scott Hanan, Steve Aupperle and Chris Gillman for the saxes and Chris Prola for the clarinet. |
  | Grand Piano | "Splendid Grand" for AKAI S5000 (Steinway D, close-mic), edited by S. Christian Collins. "Original License: Public Domain (confirmed via AKAI rep.)" |
  | Trumpet | "Samples: uncredited. License: Public Domain." The provenance is the weakest of the set. |

### The three candidates

| SoundFont | Licence (primary source) | Verdict |
|---|---|---|
| **MuseScore General 0.2** | MIT (above). | **Chosen.** The clearest grant: an OSI licence with the credits in one file, shipped by MuseScore (GPL-3.0). Same winds as FluidR3 (below), and a better piano. |
| FluidR3 GM | MIT, by Frank Wen: "I hereby release Fluid under the MIT license, as described in COPYING" (README and COPYING as reproduced in `MuseScore_General_License.md`; Debian main ships `fluid-soundfont` with `License: MIT`, https://metadata.ftp-master.debian.org/changelogs/main/f/fluid-soundfont/unstable_copyright). The OSUOSL archive `fluid-soundfont.tar.gz` (SHA-256 `c815769e44d86f1507b946a6c48c997c7f650699aea1ec4b11ba66e3415c26b9`) holds only the 2001 readme (`Fluid R3- Readme.doc`), which says both "Released to Public Domain on 12/25/01" and, in its Q&A, that "the samples are copyrighted, so you may not redistribute any part of my work to public domain without my written consent" and "All Rights Reserved". | Not chosen. Its licence is also MIT, but the original text contradicts itself and the MIT grant comes from a later release. MuseScore General carries the same terms for the same winds, so choosing FluidR3 would not remove that question; it only loses the better piano. |
| GeneralUser GS 2.0.3 (S. Christian Collins, 2026-02-22) | "GeneralUser GS License v2.0" (https://github.com/mrbumpy409/GeneralUser-GS, `documentation/LICENSE.txt`): free use "in your software projects" and to "modify the SoundFont", but it also says "I cannot be 100% sure where all of the samples originated ... If you become aware of any restricted samples being used in GeneralUser GS, please let me know". | Rejected: a custom licence, not one of the standard free-software licences, and the author states that the origin of some samples is unknown. Redistributing derived samples inside an AGPL app is not clearly allowed. Its sound was not evaluated. |

On wind quality: for tenor sax, alto sax and clarinet, MuseScore General and FluidR3 are the same
recordings, so the two cannot be told apart on loops or sample counts. Only GeneralUser GS has its
own winds, and it is out on licence grounds. The sound of the chosen set is for the listening check
below.

**Residual risk for the user to accept** (not blocking, but not nothing): the winds are FluidR3
recordings contributed by third parties and released as MIT by their compiler (Frank Wen); the
2001 readme text above says otherwise. MuseScore (GPL-3.0) and Debian (main) have shipped them under MIT
for years. The trumpet is credited only as "uncredited, public domain".

## What the converter does

`tools/samples/convert_soundfont.py` reads the SF2 and writes `web/public/samples/<id>/` per instrument
of `tools/samples/instruments.json` (GM program, sounding range, step 3 and the SoundFont's SHA-256).
Only SF2 is read: it holds the samples losslessly, and an SF3 (Ogg Vorbis inside) would add a
second lossy generation before our Opus. D9's "SF2 or SF3" is therefore SF2 only.

- **Notes:** every third semitone of the sounding range (written range plus transposition, D8), plus
  the top note when it is two away; the sampler repitches the nearest file by at most one semitone.
- **Each file** is what the SoundFont plays for that key at velocity 64 (mf): the zone of the GM preset
  that covers the key, resampled by the zone's root key, tuning and scale tuning so that the file sits
  at the equal-tempered pitch of its key (Kaiser-windowed sinc, mono, 48 kHz). Linked left/right zones
  (the piano) are averaged. Verified: the pitch of every loop by FFT (the loop tiled to 2.7 s) is within
  5 cents of equal temperament for most notes (piano and guitar, which have no loop: the 2 s after the first
  0.3 s). The exceptions are the samples' own tuning: tenor 71 (+11 cents), alto 79 and 81 (+15 and -24),
  violin above 72 (up to 23 cents either way), and the piano's recorded stretch tuning (-20 cents in the bass, +33 cents at the top C). The sign of the SoundFont's
  pitch corrections is right: the alto's corrections of +15 to +32 cents come out within 2 cents.
- **Loops** come from the SoundFont's loop data (`sampleModes` 1 or 3 and the sample's loop addresses
  with the zone's address offsets). They are written sample-exact for the 48 kHz file. The loop is
  repeated to at least 0.3 s, and the resampling step is adjusted by under 0.06 cent so that the loop is a
  whole number of output samples, so that a short loop does not tick at the wrap. A loop whose
  waveform jumps at the seam would get a 30 ms cross-fade; none needed one.
- **Piano and guitar** are different (a deviation from D9, see below): they decay, and the SoundFont's loops sit
  in the inaudible tail of the decay. Their config has `"attack": "always"`: the file is the SoundFont's sample as
  it plays up to its loop end, with no loop, and `map.json` has `"attack": "always"` and no `sustainStart` or
  `sustainEnd`. The samples end while still audible (25 to 61 dB below the loudest 100 ms for the piano, 13 to
  28 dB for the guitar), so the last second of each file (at most 40 % of it; `endFade` in the config) is a
  raised-cosine fade to silence, which is how a held note dies away.
- **Gain** in `map.json` (never above 1): each file is peak-normalised to 0.89, and `gain` brings its
  loop section (for the piano and guitar: its loudest 100 ms) to an RMS of 0.10, the level the
  FreePats set was normalised to.
- **Not applied:** the presets' filters, envelopes, LFOs, reverb and modulators. The result is the
  SoundFont's samples, not its rendering, so the tone is probably brighter and less shaped than
  MuseScore's own playback.
- **Deterministic:** running it twice gives byte-identical files (checked with `diff -r` of two runs,
  `map.json` included). A different numpy or ffmpeg build may give different bytes with the same sound.

### Deviations from D9, for the user to see

1. **Piano and guitar always start from the attack: a change in the runtime sampler.** D9 says the sampler
   changes only in the folder choice and the pitch factor; this adds one small, documented change. The reason: the
   sampler starts a slurred note at `sustainStart`, and the SoundFont's loops of the two instruments that decay
   sit in the tail of the decay (the piano's start 2 to 12 s into the sample, C4: 3 s, A0: 12 s; the guitar's are
   8 to 27 ms long at the very end of samples of 0.6 to 4.5 s), so a slurred note would enter silent. The first
   fix, an artificial short loop after the strike (the config's `"loop"`, which the converter still supports with
   `length`, `earliest`, `latest` and `entryDrop`), made slurred notes enter 7 to 23 dB quieter than a struck note
   and pulse while held, because a decaying sound was looped. What changed instead:
   - `map.json` has an optional top-level `"attack": "always"` (`SampleMap.attack` in `samples.ts`). In such a
     set the sampler starts every note at 0 with its attack, a slurred one too. A normal set is unchanged: a
     slurred note still starts at `sustainStart` (`sampler.test.ts` covers both).
   - A slurred note of such a set fades in over the 5 ms of an attack (`PLAYBACK_TUNING.attackFade`), not over
     the 40 ms of the legato crossfade, so that the strike, the loudest part of a decaying note, is not buried
     under a slow fade-in. The note before it still fades out over 40 ms: the notes overlap, as struck notes do.
   - In such a set a note may leave out `sustainStart` and `sustainEnd` (both or neither; `parseSampleMap` refuses
     it in a normal set, where a slurred note would have nowhere to enter). The sampler plays such a note once,
     without a loop, and the source ends with the file. A note held longer than its file just ends there, after
     the fade of the last second (0.3 to 1 s for the shortest files), instead of looping a piece of the tail.
   - Files are the SoundFont's natural samples: the piano's are 1.9 to 14.4 s long (30 files, 235 s), the
     guitar's 0.8 to 4.8 s (11 files, 27 s). Sounding C4 (60) is 7.3 s on the piano; the guitar's notes from
     sounding G3 (55) up are 2.0 s or less, and from C♯4 (61) up 1.3 s or less, so a held guitar note in the middle
     of its range ends after one or two seconds (a nylon string rings longer). That is the SoundFont's own
     truncation: listen for it on the held notes.
   - Memory: once the piano folder is loaded its 235 s of audio take about 45 MB decoded (mono, 32-bit float
     at 48 kHz); the guitar's take about 5 MB.
2. **Size.** The files are below D9's 2 to 3 MB per instrument (table below), except the piano's, which is
   2.4 MB: the winds' and the violin's samples are 1 to 3 s long with 0.2 to 0.3 s loops.
3. **Clarinet loops are very short in the SoundFont**: 1 to 48 ms (17 ms or less from sounding C♯5 (61) up,
   and 1 to 9 ms from sounding A♯5 (70): 53 to 372 samples). They are repeated to 0.3 s so the sound is the
   same, but the tone may be buzzy or static. From sounding B5 (83) to the top of the range (94) one sample
   (root key 84, 0.09 s long) is repitched by -1 to +10 semitones.
4. **Trumpet below sounding E4 (64)** is one sample (root key 64) pitched down by up to an octave.
   The written trumpet range F♯3 to D6 sounds E3 to C6 (52 to 84), so a third of the range is affected.
5. **Loop level.** `check_loops.py` flags notes whose level changes by more than 1.5 dB across the wrap:
   alto 79 (+5.1 dB) and 73 (-1.8), tenor 71 (-2.4), violin 73 (+3.9), 94 (+3.8), 97 (+3.3), 100 (+3.6),
   85 (-3.6), 79 (-2.4) and 82 (-1.7) (piano and guitar have no loop). The waveform is
   continuous at every wrap of the winds and the violin (the jump and curvature measures are at most 1.8
   times their typical value), so the level change is the SoundFont's own loop (vibrato or a slow swell).
   No SoundFont loop needed the converter's cross-fade. Listen for a slow pulse on long notes at these pitches.
6. **Wraps in the real looper** (`check_wraps.mjs`, Chromium's decoder and Web Audio loop, entering at
   `sustainStart`): the second difference at the wrap stays within 1.8 times its 99th percentile for every
   note of the winds and the violin. The piano and the guitar have no loop and are skipped. (With the earlier
   artificial loops, piano 21 and guitar 55 had a quiet tick once per loop, from the Opus coding error.)

## Reproduce

```sh
# once: a Python environment with numpy (git-ignored by .venv*/); ffmpeg with libopus and Node 22+ are also needed
python3 -m venv .venv-convert && .venv-convert/bin/python -m pip install numpy

# the SoundFont (not in the repository; git-ignored)
mkdir -p build/samples-src/musescore-general-0.2 && cd build/samples-src/musescore-general-0.2
curl -O https://ftp.osuosl.org/pub/musescore/soundfont/MuseScore_General/MuseScore_General.sf2
shasum -a 256 MuseScore_General.sf2   # ee51d2c4b1525e70f19a45909c4fd7a2e26d91d115fa89dbf5a6bc413d8b9bf3
cd ../../..

# convert (writes web/public/samples/<id>/; --only tenor-sax,piano for some; --report DIR writes the per-note report)
.venv-convert/bin/python -I tools/samples/convert_soundfont.py build/samples-src/musescore-general-0.2/MuseScore_General.sf2 --report build/samples-report

# checks: maps and files, loop seams (needs a look at the "check by ear" lines), pitch
node tools/samples/check_map.mjs web/public/samples/*
.venv-convert/bin/python -I tools/samples/check_loops.py web/public/samples/*
.venv-convert/bin/python -I tools/samples/check_pitch.py web/public/samples/*
node tools/samples/check_wraps.mjs          # every note looped in headless Chromium (needs `npm ci` in web/)

# which zones the SoundFont has for a GM program (1-based), e.g. the tenor sax
.venv-convert/bin/python -I tools/samples/convert_soundfont.py build/samples-src/musescore-general-0.2/MuseScore_General.sf2 --inspect 67
```

The last run used Python 3.12.16, numpy 2.1.3 and ffmpeg 9.0.2 (libopus), on macOS; it reproduced the committed
bytes of a folder that had not changed (clarinet), and two runs for the piano and guitar are byte-identical.
`check_loops.py` and `check_wraps.mjs` skip notes without a loop. `check_pitch.py` measures those on the 2 s after
their first 0.3 s; the piano's top C comes out +33 cents, the sample's recorded stretch tuning, not a conversion
error. `convert_soundfont.py` checks that the GM program has the preset name the config expects
(D8's numbers are 1-based GM numbers: 67 is "Tenor Sax", while 68 would silently give the baritone), and
`check_map.mjs` takes the range per instrument from the same config. The config's `range` must agree with
D8 and `core/instruments` (task 3.1); a cross-check test is not written yet. Opus is 80 kbps, mono, 48 kHz.
In the mac layer, `web/test/ui/samples.test.ts` decodes every file in Chromium.

## Sizes (task 7.4)

Bytes of the `.ogg` files per folder, plus a `map.json` of 1.0 to 2.2 KB. Last conversion. The piano and the
guitar have no loop: they play once, from the attack, and fade out at the end of the file (deviation 1); their
gain is measured on the strike.

| Folder | GM preset | Sounding range | Files | Size | Loop from | Gain (held level; strike for piano and guitar) |
|---|---|---|---|---|---|---|
| `tenor-sax` | 67 Tenor Sax | 44-76 | 12 | 424,447 B (0.42 MB) | SoundFont (0.40-0.54 s after repeating) | 0.29-0.51 |
| `alto-sax` | 66 Alto Sax | 49-81 | 12 | 175,867 B (0.18 MB) | SoundFont (0.38-0.51 s) | 0.27-0.44 |
| `clarinet` | 72 Clarinet | 50-94 | 16 | 163,163 B (0.16 MB) | SoundFont (repeated to 0.30-0.34 s) | 0.21-0.32 |
| `piano` | 1 Grand Piano | 21-108 | 30 | 2,435,836 B (2.44 MB) | none, plays once (`attack: always`; 1.9-14.4 s) | 0.21-0.67 |
| `guitar` | 25 Nylon String Guitar | 40-71 | 11 | 314,772 B (0.31 MB) | none, plays once (`attack: always`; 0.8-4.8 s) | 0.21-0.40 |
| `violin` | 41 Violin | 55-100 | 16 | 293,381 B (0.29 MB) | SoundFont (0.31-0.40 s) | 0.28-0.53 |
| `trumpet` | 57 Trumpet | 52-84 | 12 | 152,032 B (0.15 MB) | SoundFont (0.33-0.60 s) | 0.45-0.65 |
| Total | | | 109 | 3,959,498 B (3.96 MB) | | |

Decisions (listening check by the user, 18 Nov 2026): **tenor sax, alto sax, clarinet, piano and guitar pass**
(each works, no crackle). These are the five the instruments spec requires. **Violin and trumpet pass too**, in a
second listening by the user the same day ("they all sound good, include them all"), so they are shown: all seven
instruments are offered. The `hidden` flag in `web/src/core/instruments/instruments.ts` stays for a future
instrument whose sound is not ready.

## Listening check (task 7.3, by the user)

The tests prove that every file decodes and the maps are right; only the ear can say whether it is
usable. Do it on speakers or headphones, in browser-dev.

**The listening page.** With `cd web && npm run dev` running, open `http://localhost:5173/dev/listen.html`
(the port is the one `npm run dev` prints). It needs no practice screen, so the check can be done now. For every
instrument, the visible and the hidden ones, a row of buttons plays through the real player and sampler: **Legato**
(a slurred scale, up and down in eighth notes), **Staccato** (the same scale), **Held low, mid and high** (one
note for 8 s at 60 bpm), **Accent** (accents on beats 1 and 3, at mf and then at ff) and **Crescendo** (pp to ff
over eight notes). The page has a tempo field (for the scales, accent and crescendo; try 50 and 96), a
metronome switch and a pitch-reference field (430 to 450 Hz), which take effect while a phrase plays, and a Stop
button. It shows the audio clock (it runs while sound plays) and any error. Compare the instruments side by side
with the same phrase and tempo. The practice screen, with a real piece that has slurs and staccato notes and its
session-instrument switch (tasks 13.1 and 13.3), is the second look.

For each instrument (tenor sax, alto sax, clarinet, piano, guitar; then violin and trumpet):

1. **Legato.** A slurred run, at 50 and at 96 bpm. Notes should connect with no gap and no bump
   where one fades into the next. Slurred notes of the winds and the violin start in the loop, without
   the attack: listen for a dip in level. Piano and guitar notes are struck each time, also when slurred
   (deviation 1): they should sound like struck notes that overlap, as loud as an unslurred one.
2. **Staccato.** Short notes should be clearly short, with no tail, click or thump at the release.
3. **No crackle.** Hold single notes for 4 s or more at a low, a middle and a high pitch (headphones):
   there should be no tick at each loop wrap (every 0.3 to 0.6 s), and no slow pulse. Check the
   flagged pitches in deviation 5, and the clarinet's high register (deviation 3), where the loops are 1 to 9 ms.
   The piano and the guitar have no loop: the held note should die away smoothly, with no cut when the sample
   ends (the guitar's notes from sounding G3 (55) up end after 0.8 to 2 s, see deviation 1).
4. **Register changes.** A scale and a leap across the range: no step in loudness or timbre where
   the sample changes (every third semitone), nothing out of tune. The tenor and alto edges (their
   lowest and highest notes) and the trumpet below sounding E4 are the likeliest to sound wrong.
5. **Loudness.** The instruments should be about equally loud, and the metronome click should
   stay audible over each.

Decide per instrument: good enough, or not. Record it here, with the date, and tick 7.3 and 7.4.
Result: see "Decisions" under Sizes (18 Nov 2026).
If an instrument is not good enough, the options are another velocity layer (`velocity` in the config), a
different loop (`loop` in the config), a longer or shorter end fade for piano and guitar (`endFade`), or a
different SoundFont.
