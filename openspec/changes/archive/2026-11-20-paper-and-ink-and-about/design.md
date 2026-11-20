# Design

## Context

See proposal.md for why. The look and the About screens come from two interactive mocks the user reviewed on 2026-11-20. Both were built from this repo's CSS, strings and a real Verovio engraving:

- **About:** Settings with one "About Snapsody" row, an About screen, a Credits list and a licence view. The "Rate on Google Play" row was added after a request from another session, as the user decided there.
- **Look:** "direction A, second round". The user chose the **Cards** layout, **sans** titles and the **blue** accent, and said: "don't change anything about the content, just the styling".

Today:

- **Tokens drive most of the look.** `web/src/ui/styles/tokens.css` holds the palette, type sizes, radii and spacing, and every component rule uses only those tokens. The palette is sage green (`--primary #136d58`) on off-white (`--bg #f7f6f1`), with a dark green continue card (`--surface-dark`). The radii are 10 to 28px. The font stack starts with Inter, which is not bundled, so the system font draws everything.
- **One hard-coded colour.** Outside the tokens, there is one shadow colour in `practice.css`. On Android, `styles.xml` sets the splash background `#F7F6F1`.
- **The old look outside the app.** Several places still use it:
  - `tools/icon/make_icon.py` draws the icon (a staff with the playing note on its soft box) in dark green and cream. It writes the Android launcher resources, the old splash PNGs, `web/public/favicon.svg`, `docs/design/icon/` and the splash colour.
  - `tools/store/compose.ts` puts the store screenshots on dark green, with Inter loaded from Google Fonts.
  - `docs/privacy/index.html` has its own purple-accented look with a dark mode.
  - `README.md` shows four screenshots from `docs/screenshots/` and four shields.io badges (blue, Android green, orange, yellow).
  - There is no GitHub Pages site. The repository page is the README.
- **Settings.** `SettingsScreen.tsx` has an inline Credits panel showing `SOUND_CREDITS` from `web/src/app/credits.ts`. It also has link rows for the privacy policy and the source code (`links.ts`, and `ListRow` with `href`, from change `add-privacy-policy` D4/D5). A link opens through Capacitor's `ACTION_VIEW` hand-off, with no plugin and no `INTERNET` permission.
- **Router.** `Screen` is a union of named screens with parameters. Screens pushed above a start screen have their own Back button and no tab bar, like Favorites.
- **No app version in the web layer.** The version lives only in `android/app/build.gradle` (`versionName "0.1.2"`). `web/package.json` says 0.1.0 and is not maintained.
- **Licence texts.** The npm packages ship their own `LICENSE` files. The `verovio` npm package ships none. Verovio's SVG output embeds the Leipzig music font as a data URI. homr's licence is in `vendor/homr-licenses/`. Maven and pip dependencies bring no text into the repo.
- **Two languages today.** `web/src/app/i18n/` has `en.ts` (the typed catalogue) and `nl.ts`. `createI18n` follows `settings.language`, or else the phone's tag from `Device.language()`. Dates use `Intl` with `en-GB` or `nl-BE`. `core/instruments` names each instrument in both languages. Settings has a Language row with a sheet. About 20 test files run something in Dutch, including the store capture (`tools/store/`), which shoots both listings.
- **Spec dependency.** The requirement "Privacy policy and source code" exists only in change `add-privacy-policy`, which waits on one task: the user uploads the page. That change must be archived before this one.

## Goals / Non-Goals

**Goals:**
- The look changes through tokens first, and through component rules only where a shape really differs. Markup, texts and behaviour stay the same, so the journeys keep passing unchanged except for the new Settings rows.
- Credits can't quietly go stale. A test fails when a dependency or a version changes without its entry.

**Non-Goals:**
- **A new icon design.** The icon keeps its mark (D12) and only takes the new colours. A redrawn mark would be a separate piece of work.
- **A dark theme.**
- **A composer field, or any new piece data.** That idea came up in the first mock round and was dropped.
- **Changing the engraving.** Verovio's layout, scale and font stay. Only its ink colour follows the tokens.

## Decisions

### D1. Paper and ink, as tokens
The palette becomes:
- ground `--bg #f1f3f6`, surfaces `--surface #ffffff`;
- muted surface `--surface-muted #eef1f5`, lines `--line #d6dbe3`;
- ink `--ink #1c2433` and `--ink-muted #5c6472`;
- accent `--primary #2c5bbf` with `--primary-tint #e6ecf7`;
- danger `#a8261b`; the score ink is `--ink`.

All radii fold into three:
- 4px for cards, rows, buttons, fields and the score surface;
- 14px for a sheet's top corners;
- round for switches, the play button and the round icon buttons.

`--surface-dark` and its card variant go, because the continue card becomes a white card. The colour for a primary action gets its own token, `--action` (ink), separate from `--primary` (D2). `--scrim` and `--focus` move to the ink and the accent. The values come from the mock. Contrast at those values: muted text on the ground is about 5.3:1, and blue on white about 6:1.

*Alternative:* keep the token names and change values only. That works for most tokens, but the continue card and the primary buttons would then draw in the accent. Splitting `--action` from `--primary` keeps that rule visible in one place.

### D2. The accent marks state, not actions
Blue is for:
- the playing bar and the cursor;
- the selected note and the editor's marks;
- switches that are on and the active tab;
- links, and the "Preview bar" action.

Primary buttons (Continue practising, Add music, Start looping, Save & practice) and the play button are ink. Secondary buttons are white with a thin line, and a destructive one has danger-coloured text and border. The loop and start marks in the score (`--mark-loop`, `--mark-start`) keep distinct hues, retuned so they sit well next to the blue.

### D3. The shapes that change
Only these component rules change beyond tokens. Each is matched to the mock (Cards, sans, blue):
- **Continue card:** white with a line border, not dark green. Its eyebrow, title and meta text become ink and muted ink.
- **Play buttons in a row** (home rotation): a 1.5px ink outline circle instead of a tinted disc.
- **Tab bar:** no tinted pill. The current tab is ink, bold, with a 2px accent line on top.
- **Segmented control** (Rest between repeats): a ink-bordered row, with the chosen segment filled ink.
- **Editor tabs** (Note, Marks, Score): text tabs with a 2px accent underline, not a track with a white thumb.
- **Stepper and select cells:** white cells with a line border.
- **Sheets:** 14px corners, a line on top, and the ground colour.
- **Info notes** in sheets: a 3px accent rule on the left instead of a tinted box.

Everything else follows from the tokens.

### D4. Public Sans, bundled
One variable font, Public Sans (SIL OFL 1.1, by the U.S. Web Design System), serves titles and text. It ships as a single `woff2` (Latin, weights 400 to 700) under `web/src/ui/fonts/`, loaded by an `@font-face` that Vite bundles, with `font-display: block` because the file is local. `--font` becomes `"Public Sans", system-ui, …`. Titles use weight 700 and −0.02em letter spacing. The font is credited (D7) and its licence text ships with the others.

*Alternative:* the system font with tighter tokens. The mock showed that the typeface carries much of the change, and Roboto would bring back the generic look.

### D5. No app name above titles
Already done in the working tree. The `app.name` eyebrow is gone from the start screens, Favorites, the placeholder and the busy step of adding music. The `app.name` text is removed. The tab screens' header gets 12px of top padding, so the title clears the status bar. Other eyebrows that tell the user where they are stay: "Add music" and the editor's.

### D6. About, Credits and Licence are pushed screens
`Screen` gains `about`, `credits` and `licence` (with a component id). Each has a Back button above its header and no tab bar, like Favorites:
- **About** is reached from Settings. Its rows are "Credits and licences" (push `credits`), then "Privacy policy" and "Source code" (the existing link rows).
- **Credits** groups the components under section labels. Each row shows the name and "version · licence". A row pushes `licence`.
- **Licence** shows the version, the licence and the source (a link row), then any notices, then the licence text in a scrolling block.

The About mock showed the licence as a sheet. The AGPL text is about 660 lines, which reads better on a full screen with Back. The content is the same.

### D7. The credits list, the licence files and the test that keeps them true
`web/src/app/credits.ts` becomes the list of components. Each entry has:
- id, name, version, SPDX licence id, source URL and group;
- optional notices, and a "not open source" flag (ML Kit).

The SoundFont's acknowledgements stay as they are now (its notices). The group labels are ordinary texts in `en.ts`. Names, licences and licence texts are kept as their authors wrote them.

Each entry has a licence file at `web/public/licences/<id>.txt`:
- npm packages: copied from their `LICENSE`;
- Verovio: LGPL-3.0 plus the GPL-3.0 text it refers to, from its repository;
- homr: from `vendor/homr-licenses/`;
- the rest: the upstream licence file at the version shipped, with its copyright lines;
- Apache-2.0 components share one text.

The Licence screen fetches the file from the app's own origin, which works offline.

The entries (versions as of 2026-11-20):

| Group | Entry |
|---|---|
| Reading the music | homr 0.7.1 (AGPL-3.0, plus the training-data note from `NOTICE`) |
| Showing the music | Verovio 6.4.0 (LGPL-3.0); Leipzig music font (OFL-1.1, embedded by Verovio) |
| Instrument sounds | MuseScore_General 0.2 (MIT, with its acknowledgements) |
| Running the models | LiteRT 1.4.2 (Apache-2.0); ONNX Runtime 1.31.1 (MIT) |
| Python on the phone | Chaquopy 17.2.0 (MIT); Python 3.10 (PSF-2.0); NumPy 1.26.2 (BSD-3-Clause); OpenCV 4.5.1 (Apache-2.0); Pillow 11.0.0 (MIT-CMU); typing_extensions 4.16.0 (PSF-2.0) |
| The app itself | Preact 11.1.1, Preact Signals 2.11.4 (with signals-core), Capacitor 8.6.2 (core, android, App, Device, Filesystem), Capacitor Keep Awake 8.0.1 (all MIT); Apache Cordova Android 14.0.1 (Apache-2.0); Public Sans (OFL-1.1) |
| Android libraries | Kotlin and kotlinx; AndroidX; Guava listenablefuture, JetBrains annotations, JSpecify (all Apache-2.0) |
| Scanning pages | Google ML Kit Document Scanner 16.0.0 (ML Kit Terms of Service; not open source) |

`web/test/credits.test.ts` grows three checks:
1. **Completeness.** Every runtime dependency in `web/package.json`, every `implementation` coordinate and pip `install(...)` in `android/app/build.gradle`, and the Chaquopy plugin in `android/build.gradle` is credited, with the same version.
2. **Files.** Every entry has a non-empty licence file.
3. **NOTICE.** `NOTICE` names every entry. It stays the repository's record, and gains the entries it lacks today: Preact, Signals, Capacitor, Keep Awake, Cordova, Leipzig and Public Sans. The existing check that the SoundFont lines match `NOTICE` and `docs/samples.md` stays.

Verovio's own bundled third-party code is checked once, by hand, against its repository. Its notices are added to Verovio's licence file. A test can't see inside the wasm.

*Alternative:* generate the files at build time from `node_modules`, the Gradle cache and pip. That is three tools for files that change only when a dependency changes, and the test already catches that moment.

### D8. The version comes from Gradle
`vite.config.ts` reads `versionName` from `android/app/build.gradle` and defines `__APP_VERSION__`. The UI-test build config does the same. Settings and About show that value. A unit test checks that the reader finds the version in today's file, and fails loudly if the line moves.

*Alternative:* `@capacitor/app`'s `getInfo()`. It is async, needs a port method and a fake, and doesn't work in browser-dev. The Gradle file is the one place the release script already bumps.

### D9. Rate on Google Play is a link row
`links.ts` gains `PLAY_STORE_URL` (`https://play.google.com/store/apps/details?id=be.imagitech.snapsody`). The row is a `ListRow` with `href`, like the privacy row (add-privacy-policy D4). On Android, `ACTION_VIEW` for that URL opens the Play Store app, which claims those links, or the browser when Play is missing.
- *Not `market://`:* it would need native code to fall back to https, and the https link already reaches the Play Store app.
- *Not the In-App Review API:* Google advises against starting it from a button, because quota can make the tap do nothing. Play also forbids asking about sentiment first.

The row shows in every build.

### D10. Settings and About layout
Settings keeps its sections, in this order:
1. Default instrument;
2. Count-in;
3. one group of two rows: Rate on Google Play, then About Snapsody (with the version as its value);
4. the offline line.

There is no Language row (D11).

The About screen has, in order:
- header "About Snapsody", subtitle "Version 0.1.2";
- a white card: Snapsody 0.1.2, "Free and open source (AGPL-3.0)", "© 2026 the Snapsody authors";
- one sentence about reading on the phone and the projects it is built on;
- a group of three rows: Credits and licences, Privacy policy, Source code.

The texts are in `en.ts`.

### D11. English only, keeping the catalogue
The user decided the app is English only for now. Removed:
- `nl.ts`, and the `nl` locale;
- `languageFromTag` and `resolveLanguage`;
- the Language row, `LanguageSheet` and the router's `language` sheet;
- the Dutch instrument names;
- `Device.language()` with its Capacitor, browser-dev and fake adapters, because nothing else asks for it.

Kept: `en.ts` as the one typed catalogue, `t()`, the plural rules and the `en-GB` formatting. Screens keep calling `t()`, so a language can come back by adding a catalogue and a choice.

`Settings` drops `language` from its data. `normaliseSettings` ignores the field when an old file has it, as it does with `pitchReference`, and the next save doesn't write it. The committed store fixtures (`web/test/fixtures/stores/v2*/settings.json`) keep their `"language": "nl"`, so `storedFormats.test.ts` proves an old file still loads. The app then shows English.

Tests:
- Those that only repeat an English check in Dutch lose the Dutch half.
- `i18n.test.ts` keeps its checks on the English catalogue (no technical words, placeholders, plurals) and drops parity and the "same in both" list.
- `density.test.ts` runs in English only.
- The store capture shoots the English listing only. `storePieces.ts` keeps one name per piece.

This is done before the restyle and the new screens, so they're written once, in English.

*Alternative:* hide the Language row and keep `nl.ts`. That keeps 330 lines of texts that every later change would have to translate, for a language nobody can choose.

### D12. Everything outside the app takes the same look
After this change, nothing the user publishes keeps the old look. Each place takes the palette from D1 and Public Sans from D4:
- **Icon** (`make_icon.py`):
  - same mark and shapes, in the colours the user picked from the icon preview (variant A, 2026-11-20): ground `#1C2433` (ink), playing box `#2C5BBF` (the accent), staff and barline `#7F8BA0`, the note just played `#B3BDCD`, the playing note `#FFFFFF`;
  - the monochrome layer unchanged.

  The script writes everything that comes from it: the launcher resources, the old splash PNGs, the favicon, `docs/design/icon/` (512px PNG included) and the splash colour (the new ground, `#f1f3f6`).
- **Store graphics** (`compose.ts`):
  - the screenshots sit in a phone on the paper ground, with ink captions in Public Sans;
  - the feature graphic uses the same palette;
  - the font is loaded from the bundled file, not Google Fonts, so compose no longer needs a network.
  - Compose also writes a 1280 × 640 GitHub social preview from the same parts, which the user uploads in the repository settings.
- **Privacy page:** the same ink, paper, line and blue tokens, 4px corners, and Public Sans, embedded as a data URI so the page stays one self-contained file. It is light only, like the app, and its text doesn't change.
- **README:**
  - the four screenshots in `docs/screenshots/` are taken again from the English capture;
  - the badges use the palette: ink for platform and status, blue for the licence, Buy Me a Coffee keeps its own yellow;
  - the icon at the top is the new 512px PNG.

*Alternative:* leave the icon green, as first planned. The user asked for everything in the new style, and a green icon above a blue-and-ink app is the most visible mismatch.

## Risks / Trade-offs

- **[Risk] Missed colours.** A colour or radius slips past the tokens, and a screen keeps a green detail. → After the token switch, grep `web/src/ui` for hex values and `rgb(` outside `tokens.css`. Every screen, sheet, dialog and notice is looked at by eye, in portrait and landscape.
- **[Risk] Taller or wider text.** Public Sans is wider than Roboto, so a row or button could wrap or overflow at 360px. → `density.test.ts` (44px targets, no sideways scroll) runs as before, and the by-eye pass looks for wrapping.
- **[Risk] Missing licence texts.** A Maven or pip licence text isn't where expected. → Take it from the project's repository at the shipped tag, and note the URL at the top of the file.
- **[Trade-off] The Play listing changes in steps.** The icon, the feature graphic and the screenshots are uploaded by hand. Until the user uploads them, the store shows the old look while the new build is live. → Group 7 makes all of them in one run, and the handoff lists every file and where it goes.
- **[Risk] A Dutch user upgrades.** A user who had Dutch gets English after the update. → It's an early app with few users. The store listing and the release notes say "English", and nothing is lost.
- **[Risk] Archive order.** Archiving before `add-privacy-policy` would fail on the MODIFIED requirement. → Tasks say so, and that change waits only on the user's upload.

## Migration Plan

Nothing is stored differently. Rolling back means reverting the commits. The splash colour and the font file go with them.

## Decisions made during apply

- **The "In Dutch" scenario stays, reworded.** OpenSpec refuses a MODIFIED requirement that drops a scenario, so "Privacy policy and source code" keeps its "In Dutch" scenario, which now says a Dutch phone shows the English row names. It says the same as "English only".
- **The look follows the reviewed mock's CSS layer.** The "Paper and Ink" mock (direction A, round 2) carries a CSS layer over the app's styles. Group 3 ports it into the app's own files. Its open points, as the user saw them in the mock:
  - Ink, not blue, also for the step numbers in "Before you scan", the star in the Favorites note, the tempo − and +, the editor's Back arrow and a star that is off. A star that is on stays blue.
  - The play button is a 56px circle in portrait and 44px on its side.
  - The Licence screen scrolls as a whole, with no scroll area inside it, and licence texts are reflowed: hard line breaks inside a paragraph are joined.
  - ML Kit's licence file says it is not open source and where its terms are.
  - Metronome on is drawn like a switch that is on: blue tint and a blue line.
  - Back and More stay small grey squares, and Delete in the confirm dialog stays solid red.
  - Values D1 doesn't give: `--line-strong #c3cad5`, `--line-control #9aa3b1`, `--danger-tint #f8e8e6`, `--scroll-thumb` and `--thumb-line #b3bdcd`, a white `--thumb`, `--shadow-float rgb(20 26 38 / 0.22)`, `--scrim rgb(20 26 38 / 0.38)`, `--focus` the accent.
  - The loop and start marks get `#b5541c` and `#1f7a4d`. The flag marks keep their colours.
- **Public Sans comes from the release's variable TrueType.** Release v2.001, the latest stable one, ships no variable WOFF2, only `PublicSans[wght].ttf` (weights 100 to 900) and static WOFF2 files. The app's copy is that TrueType limited to 400–700 and compressed to WOFF2 with fontTools: one 39 KB file. `web/src/ui/fonts/README.md` has the commands. The OFL names no Reserved Font Name, so the modified file keeps the name.
- **Credits list the big parts, not their sub-libraries.** The licence check found more shipped code than D7 lists: Chaquopy's native support libraries (libc++, libjpeg, libpng, FreeType, OpenBLAS, libgfortran), Capacitor Filesystem's ionfilesystem-android, the other music fonts in Verovio's wasm, and some 45 AndroidX artifacts. The user decided (2026-11-20): "we dont need to list all the sublibraries of components we use. so the big parts need to be listed, not the rest". So the entries stay as in D7. A component's licence file still carries the notices its own licence text includes, such as the third-party notices in Verovio's (task 4.2) and NumPy's bundled licences.
- **Versions in the credits are those in the build files.** D7's table says Capacitor 8.6.2 for all its packages, but App is 8.1.2, Device 8.0.3 and Filesystem 8.1.5. Python shows 3.10, as `build.gradle` asks (Chaquopy resolves 3.10.22). LiteRT 1.4.2 has no git tag, so its text comes from v1.4.1, which is the shared Apache-2.0 text.
- **Smaller decisions in groups 6 and 7.** About's Source code row shows the GitHub address, as in the mock. The store capture writes English only, straight into `build/store/raw/` and `build/store/play/`, without a language folder. The README screenshots are those captures, scaled to 400px wide as before. The icon script now also writes the splash colour into `styles.xml`, and its `--preview` renders the round, squircle and monochrome masks.
