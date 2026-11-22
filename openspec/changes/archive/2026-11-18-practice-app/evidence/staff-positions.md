# Staff positions and the time-signature flag (task 10.4, design D7)

Run on 18 Nov 2026 on the development Mac (Apple Silicon) in `.venv-py310` (Python 3.10.22, OpenCV
4.5.4, numpy 1.26.2, ONNX Runtime 1.23.2, everything on the CPU), and on the `ia_test_api36`
emulator (arm64, API 36). The change is homr patch 8 (`vendor/PATCHES.md`).

| Check (D7, "recognition changes bring their own verification") | Result |
|---|---|
| `tools/homr/run_homr.py` gives byte-identical MusicXML before and after the patch | **pass**, 5 of 5 pages |
| The app-path readings of the two-page fixture are unchanged | **pass** (`git diff` empty) |
| Staff boxes and bars per staff match the engraved pages' known layout | **pass** |
| `timeEstimated` is true for `two-page/page-2` (no printed meter) and false for page 1 | **pass** |
| The positions reach the web layer on the emulator | **pass** |

## What the patch reports

`process_image(..., layout)` fills a `homr.page_layout.PageLayout`:
- the box of each system that gave the first voice symbols, in reading order, in pixels of the image
  homr read. A box is the staff lines only, with no ledger lines, stems or text;
- the measures of the first part that each system gave;
- the total number of measures;
- `time_estimated`: true when homr wrote its n/4 estimate because the first measure had no `<time>`.

The MusicXML does not change. `ia_engine.staves_in_source` removes the recognition margin and turns
the boxes into fractions of the scanned page. It cuts a box to the page, since the second system of
the book photo starts 12 px left of it. The Reader sends the result on the `done` event as
`staves: [{ box: { x, y, width, height }, firstBar, lastBar }]` (bars numbered from 1 on the page)
and `timeEstimated`.

**What "the counts don't add up" can catch.** The bars per system are differences of a running count
that ends at the page's total, so they always sum to the page's bars on the homr side. What is
checked:
- **On the homr side** (`PageLayout.staves()`): one count per box, and at least one bar per system.
  Otherwise `staves` is null and nothing is sent.
- **In the Kotlin Reader** (`StaffPosition.listFrom`): fractions from 0 to 1, and bars that run on
  from 1 without a gap.
- **In the Capacitor adapter:** the shape.
- **In `addMusic.stavesForPiece`:** the staves cover the page's bar range in the merged piece exactly.
  This is the check that can catch a real mismatch.

None of these can see a measure that homr merged or dropped *within* a system: the count is then off
by one for that system and the box shown for its bars is still the right one, unless the measure
falls at a system boundary (Risks).

## 1. Byte-identical MusicXML (`run_homr.py`)

- **Before:** the committed `vendor/homr` (HEAD, without patch 8) was copied with
  `tools/homr/run_homr.py` into a scratch folder, with the models linked.
- **After:** the patched tree, once with `--layout` (the layout is filled and written as
  `<image>.layout.json`) and once without.
- Every run used `--cpu --no-title`. Images were copied to scratch folders because the CLI writes
  next to the image.

| Page | What it is | SHA-256 of the MusicXML (first 16) | before = after `--layout` = after plain |
|---|---|---|---|
| `two-page-1.png` | `web/test/fixtures/two-page/page-1.png`, self-engraved | `132b3ba55054b160` | yes |
| `two-page-2.png` | `web/test/fixtures/two-page/page-2.png`, self-engraved | `11098dc62dbcae87` | yes |
| `etude.jpg` | `web/test/fixtures/page.jpg`, synthetic page (8 × 4 bars, no clef or meter) | `f94529771f352824` | yes |
| `exercise87_crop.jpg` | `fixtures/local/`, local reference photo (crop) | `bc00a29963e911ba` | yes |
| `book-photo.jpg` | `fixtures/local/20261111_…jpg`, local reference photo | `da046fe8d86b7903` | yes |

The crop's MusicXML is also byte-identical to `fixtures/local/exercise87_crop.mac.musicxml`, made on
17 Nov.

**The app's path.** `tools/pages/read_two_page_fixture.py` was run again. It pads the page and runs
homr with the app's `ProcessingConfig`, through the patched `process_image`, which the engine now
calls with a layout. `git diff --exit-code web/test/fixtures/two-page/` is empty. The padded crop
read by `tools/homr/staff_positions.py` is byte-identical to
`fixtures/local/exercise87_crop_padded.mac.musicxml` (`030af7acf34f193f`).

## 2. Boxes and bars per staff

The app's path is `tools/homr/staff_positions.py`: the engine's `pad_for_recognition`, homr, then
`staves_in_source`. Boxes are fractions of the source image. Each image was checked by eye with the
boxes and bar ranges drawn on it: every box sits on its system's five lines, from the clef to the
final barline.
- `two-page` pages 1 and 2, `page.jpg` and the crop: `--overlay`, the app's path.
- The book photo: the pixel boxes of the `run_homr.py --layout` run.

**`two-page/page-1.png`** (2000 × 664). Engraved as 5 + 3 bars, 3/4 printed.

| Staff | x | y | width | height | bars |
|---|---|---|---|---|---|
| 1 | 0.0302 | 0.2096 | 0.9339 | 0.1537 | 1–5 |
| 2 | 0.0302 | 0.6402 | 0.5443 | 0.1498 | 6–8 |

`timeEstimated` **false**.

**`two-page/page-2.png`** (2000 × 664). Engraved as 5 + 1 bars, with no meter printed.

| Staff | x | y | width | height | bars |
|---|---|---|---|---|---|
| 1 | 0.0302 | 0.2117 | 0.9339 | 0.1470 | 1–5 |
| 2 | 0.0302 | 0.6442 | 0.1793 | 0.1459 | 6–6 |

`timeEstimated` **true**. homr's 3/4 for this page is its estimate.

**Both pages against the engraving.** In pixels, page 1's systems span x 52–1927 and 52–1146, and
y 140–237 and 428–528. That is where `make_two_page_fixture.py`'s staff lines are. Page 2's short
second system ends at x 417, at its final double barline.

**`page.jpg`** (1240 × 1754). Synthetic: 8 systems of 4 bars, no clef and no meter.
- Bars per staff: 4, 4, 4, 4, 4, 4, 4, 4.
- Every box: x 0.0703, width 0.8594 (px 87–1153, the staff lines' extent).
- y: 0.1253, 0.2230, 0.3176, 0.4149, 0.5139, 0.6108, 0.7059, 0.8039, about 170 px apart as drawn.
- `timeEstimated` **true**.

**Local reference photos** (not committed):
- **`exercise87_crop.jpg`** (2212 × 966): bars per staff 4, 5, 5, 5 (19 bars, as printed).
  `timeEstimated` false (3/4 printed).
- **`book-photo`** (2212 × 1659): bars per staff 4, 5, 5, 5, 5, 8.
  - The first four systems are exercise 87, as in the crop. Their boxes have the same x and width
    as the crop's.
  - Exercise 88 is the fifth system, exercise 89 the sixth. homr reads the photo as one piece.
  - `timeEstimated` false.

## 3. The emulator: the positions reach the web layer

- The debug APK of this change (`./gradlew assembleDebug`, which includes `homr/page_layout.py`) was
  installed on the `ia_test_api36` emulator.
- `two-page/page-1.png` and `page-2.png` were copied into `files/scans/d7/`.
- One Reader job was started from the WebView over the Chrome DevTools protocol, through Capacitor's
  bridge. It called `Capacitor.nativePromise('Reader', 'read', …)` and listened with
  `Capacitor.addListener('Reader', 'readerEvent', …)`.
- The job took 25.4 s and finished `done`.

| Page | MusicXML | `staves` in the WebView | `timeEstimated` |
|---|---|---|---|
| 0 | 6193 chars (the committed `page-1.musicxml` is 6193 bytes) | 1–5 at (0.0302, 0.2096, 0.9339, 0.1537); 6–8 at (0.0302, 0.6402, 0.5443, 0.1498) | false |
| 1 | 5384 chars (`page-2.musicxml`: 5384 bytes) | 1–5 at (0.0302, 0.2117, 0.9339, 0.1470); 6–6 at (0.0302, 0.6442, 0.1793, 0.1459) | true |

The boxes are a Mac's to the fourth decimal. The emulator's recognition stack differs from a Mac's
(segnet on LiteRT, OpenCV 4.5.1; see `spike.md`), and on these pages any difference stayed below the
4-decimal precision the engine sends. Mapping the event to the
port's `ReaderEvent` (`toReaderEvent`) is covered by `web/test/capacitorAdapter.test.ts`, not
repeated here. The scans were removed afterwards.

## Not covered here

- **The test layers don't re-test the recognition** (D7). The quick layer covers the contract:
  - `fixtures/bridge/reader.done.json` with `staves` and `timeEstimated`;
  - `ReaderHandlerTest`;
  - `pluginContract.test.ts`;
  - `capacitorAdapter.test.ts`;
  - `addMusic.test.ts`;
  - `pages.test.ts`, which shows that an estimated time at a page start counts as absent.
- **A real phone photo** went through a Mac path only (the book photo above). A Galaxy S24 run is
  10.6's smoke test, before archive.
