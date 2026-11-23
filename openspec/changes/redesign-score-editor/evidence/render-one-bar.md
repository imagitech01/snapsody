# How long Verovio takes to render one bar (task 1.1, design D2)

Run on 23 Nov 2026 on a laptop, in headless Chromium 159 (Playwright 1.65.1), with Verovio 6.4.1 as the app
bundles it. D2 asks whether one bar renders in under about 30 ms; if so, live re-rendering could later replace the
drag overlay. The measurement decides nothing in this change: the overlay is built either way.

## Result

Median of 41 renders after 20 warm-up renders, in milliseconds.

| Where | One-line piece | Piano piece (two staves) |
|---|---|---|
| Browser on a laptop (headless Chromium) | **2.0** | **1.9** |
| Android emulator | *not measured yet* | *not measured yet* |

Both are far under 30 ms on a laptop. A phone is slower than a laptop, often by several times, so the emulator (and
a phone) number is still the one that counts for the decision D2 leaves open.

## What was measured

One render is the call the app makes, timed with `performance.now()` around it in the page:
`renderScore(barExcerpt(score, bar), { width: 360, multiRests: 'expand', parts })` (`core/score/render.ts`,
`app/editorSession.ts`). That includes cutting the bar out of the score, adding the display beams, writing the
MusicXML, Verovio reading it (`loadData`) and laying out and drawing the SVG (`renderToSVG`). It does not include
loading the toolkit (done before the warm-up) or putting the SVG in the page.

- **One-line piece:** `web/test/fixtures/practice-exercise.musicxml`, bar 2 (four beamed eighths and a quarter, one staff).
- **Piano piece:** `web/test/fixtures/melody-piano.musicxml`, bar 3 of the piano part (`parts: ['P2']`): a grand
  staff with chords in the right hand and two voices in the left hand (ten notes, two staves).
- Width 360 (the phone's CSS width), Verovio scale 40 (the default, `DEFAULT_SCALE`).

The drawings were checked in the page after the runs: one measure, with 5 notes on 1 staff and 10 notes on 2
staves.

Two full runs gave the two numbers above within 0.2 ms. Other cases, from these runs and two earlier ones with a 5-render warm-up, for comparison (medians, ms):

| Case | One-line | Piano |
|---|---|---|
| Another bar (bar 5 of each) | 1.7 | 1.9 |
| Scale 80 instead of 40 | 1.9 | 2.1 |
| `barForEditing` instead of `barExcerpt` (task 1.3) | 1.8 | 2.0 |
| With the SVG put in the page and laid out (`innerHTML`, then `getBBox`) | 2.2 | 2.5 |
| Bar 3 of both parts: melody and piano, three staves | | 2.4 to 2.9 |

## How

A throwaway page outside the repository: a small Vite build (the app's Vite 8.3.8, the app's `target` and chunk
settings) of an entry that imports `renderScore`, `barExcerpt` and `barForEditing` from `web/src/` and the two
fixtures as text, served to Playwright's Chromium from a route at `https://localhost/`, as the UI tests serve the
app. The UI tests' harness (`web/test/ui/app.ts`) was not used: it puts `performance.now()` under `page.clock`, so a
timing taken in it means nothing. Nothing was added to the repository for this.

To measure on the emulator, the same call can be timed in the app's WebView with Chrome's remote debugging, or in
browser-dev on the emulator's Chrome; that is left for when the emulator is next started.
