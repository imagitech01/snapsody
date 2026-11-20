# Tasks

Layers are as in `docs/testing.md`: **quick** (`make test-quick`) and **mac** (`make test-mac`). The device smoke test runs once before archive. Design references are D1–D12 in design.md.

## 1. No app name above titles (D5)

- [x] 1.1 Remove the `app.name` eyebrow from Home, Library, Favorites, Settings, the placeholder and the busy step of adding music. Remove the `app.name` text from `en.ts`, `nl.ts` and `web/test/i18n.test.ts`. Give `.screen--tabs .screen-header` 12px of top padding. Verify:
  - quick: `make test-quick` is green, with types;
  - mac: `make test-mac` is green (91 journeys, `density.test.ts` included).

## 2. English only (D11)

- [x] 2.1 Remove the Dutch half of `docs/privacy/index.html` (the `nl` article, the language links and their styles), and move its date to 20 November 2026. Note the change in `add-privacy-policy`'s design D1 and proposal. Verify: `grep -ci 'lang="nl"\|Nederlands' docs/privacy/index.html` gives 0, and the page has no `<script>` and no external `src` or stylesheet.
- [x] 2.2 Remove `nl.ts`, the `nl` locale, `languageFromTag` and `resolveLanguage` from `web/src/app/i18n/`, and the Dutch instrument names from `core/instruments`. `createI18n` takes no language arguments. Update the comments that describe two languages. Verify: quick, `web/test/i18n.test.ts` keeps its English checks (no technical words, placeholders, plurals, dates) and drops parity, "same in both" and the language-resolution tests; `web/test/instruments.test.ts` checks the one name; types are green.
- [x] 2.3 Drop `language` from `SettingsData`, `normaliseSettings`, `setLanguage` and `LANGUAGES` in `app/settings.ts`. An old file's `language` is ignored and not written again. Verify: quick, `web/test/settings.test.ts`:
  - a file with `"language": "nl"` loads and its next save has no `language`;
  - `web/test/storedFormats.test.ts` still loads the committed `v2` fixtures, which keep their `"language": "nl"`.
- [x] 2.4 Remove `Device.language()` from `platform/port.ts` and the Capacitor, browser-dev and fake adapters, and the shell's call to it. Verify: quick, `web/test/fakePlatform.test.ts`, `web/test/capacitorAdapter.test.ts` and `web/test/shell.test.ts` lose their language cases and stay green; `grep -rn "language()" web/src` is empty.
- [x] 2.5 Remove the Language row from `SettingsScreen`, `LanguageSheet` from `SettingsSheets.tsx`, `'language'` from the router's `SheetName`, and the `settings.language*` and `language.*` texts. Verify: mac, `make test-mac` is green:
  - `web/test/ui/settings.test.ts` drops the language tests and checks there is no Language row;
  - the journeys that ran in Dutch (`edit`, `practice`, `addMusic`, `density`, `seeds.ts`, `journey.ts`) run in English only;
  - the `v2-settings` seed still starts, in English.
- [x] 2.6 Make the Play Store side English only:
  - `docs/store/listing.md` loses the nl-NL listing and says "English";
  - `tools/store/capture.ts`, `compose.ts`, `README.md` and `web/test/ui/storePieces.ts` shoot and name English only;
  - `docs/testing.md` ("Checking a screen by eye") and `README.md` (Languages) say English.

  Verify:
  - `grep -rniE "dutch|nederlands|nl-NL|'nl'" docs/store docs/testing.md README.md tools/store web/test/ui/storePieces.ts` finds only the note that the app is English only;
  - `node tools/store/capture.ts --no-build` (after a build) runs through for English.

## 3. Paper and ink (D1, D2, D3, D4)

- [x] 3.1 Bundle Public Sans: a variable `woff2` (Latin, 400–700) from the U.S. Web Design System's latest stable release, in `web/src/ui/fonts/`, with its `OFL.txt`. Add the `@font-face` with `font-display: block`, and put "Public Sans" first in `--font`. Verify:
  - quick: `npm run build` bundles the font file into `dist/assets/`;
  - mac: a check in `web/test/ui/density.test.ts` finds that `document.fonts.check('16px "Public Sans"')` is true once the app has started, so the font loaded from the app's own origin.
- [x] 3.2 Switch the tokens in `tokens.css` to paper and ink (D1):
  - the palette;
  - the three radii;
  - the new `--action` token for primary actions;
  - `--scrim` and `--focus`;
  - the score ink;
  - the retuned loop and start marks.

  Remove `--surface-dark` and `.card--dark`. Move the one inline shadow colour in `practice.css` to a token. Verify:
  - quick: `make test-quick` is green;
  - `grep -nE '#[0-9a-fA-F]{3,8}|rgb\(' web/src/ui/styles/*.css | grep -v tokens.css` is empty.
- [x] 3.3 Restyle the shapes listed in D3: continue card, row play buttons, tab bar, segmented control, editor tabs, stepper and select cells, sheets, info notes. Primary buttons and the play button use `--action`. Blue stays on state only (D2). Verify: mac, `make test-mac` is green with no journey changed, because no text, role or order changed; `density.test.ts` passes (44px targets, no sideways scroll).
- [x] 3.4 Look at every screen in browser-dev at 360 × 780 (and 780 × 360 for Practice): Home (first launch and with pieces), Library, Favorites, Practice playing, the loop and tools sheets, the confirm dialog, a notice, adding music (hint, reading, busy), the editor (Note, Marks, Score; one line and full score), and Settings with the instrument sheet. Look for green left over, accent on actions, wrapping and clipped text. Verify: manual by eye (the user).

## 4. The credits list and the licence texts (D7)

- [x] 4.1 Turn `web/src/app/credits.ts` into the list of components from D7:
  - group, name, version, SPDX licence, source, optional notices, and the "not open source" flag;
  - the SoundFont's acknowledgements become its notices, unchanged.

  Add `web/public/licences/<id>.txt` for each entry:
  - npm packages from their `LICENSE`;
  - Verovio as LGPL-3.0 plus GPL-3.0;
  - homr from `vendor/homr-licenses/`;
  - Leipzig and Public Sans from their `OFL.txt`;
  - the others from the upstream repository at the shipped tag, with that URL on the first line;
  - Apache-2.0 components share one text.

  Verify: quick, `web/test/credits.test.ts`: every entry has a non-empty licence file, and the SoundFont lines still match `NOTICE` and `docs/samples.md`.
- [x] 4.2 Check Verovio's repository at 6.4.0 for third-party code compiled into the toolkit. Add the notices it requires to `verovio.txt`, and list the libraries in the entry's notices. Verify: quick, the file carries each library's licence notice; the commit message lists what was found and the repository paths read.
- [x] 4.3 Add the completeness checks to `web/test/credits.test.ts`:
  - every runtime dependency in `web/package.json`, every `implementation` coordinate and pip `install(...)` in `android/app/build.gradle`, and the Chaquopy plugin version in `android/build.gradle` maps to a credited entry with the same version;
  - `NOTICE` names every entry.

  Add the missing entries to `NOTICE`: Preact, Signals, Capacitor, Keep Awake, Cordova, Leipzig and Public Sans, plus the Pillow version. Verify: quick, the test is green. It turns red when a version in `package.json` or `build.gradle` changes without its entry (tried once by hand, then reverted).

## 5. The app version in the web layer (D8)

- [x] 5.1 Add a small pure reader for `versionName` in a `build.gradle` text. Use it in `vite.config.ts` and `test/ui/vite.config.ts` to define `__APP_VERSION__`, declared for TypeScript. Verify: quick, a new `web/test/appVersion.test.ts` reads `0.1.2` from today's `android/app/build.gradle`, and throws on a text without `versionName`.

## 6. Settings, About, Credits and Licence (D6, D9, D10)

- [x] 6.1 Add `about`, `credits` and `licence` (with a component id) to `Screen` in `app/router.ts`, and add `PLAY_STORE_URL` to `links.ts`. Verify: quick, `web/test/router.test.ts` pushes and pops each one, and the tab bar is hidden on all three.
- [x] 6.2 In Settings, remove the Credits panel and the Privacy policy and Source code rows. After the count-in, add one group with "Rate on Google Play" (a link row to `PLAY_STORE_URL`) and "About Snapsody" (version as its value; it pushes `about`). Add the texts to `en.ts`, and remove the `credits.*` texts that are no longer used. Verify: mac, `web/test/ui/settings.test.ts`:
  - the old credits test and the privacy/source test are replaced;
  - "Rate on Google Play" is a link with the Play URL, `target="_blank"` and `rel`;
  - "About Snapsody" shows 0.1.2;
  - nothing is clicked that leaves the app.
- [x] 6.3 Build the About screen (D10): Back, header and version, the app card, the sentence, and the rows Credits and licences, Privacy policy and Source code. Privacy policy and Source code reuse the existing link rows and URLs. Verify: mac, `web/test/ui/settings.test.ts` opens About from Settings. It finds the version and AGPL-3.0, the two links with their URLs and attributes, and that Back returns to Settings.
- [x] 6.4 Build the Credits screen (groups, each row "version · licence", the ML Kit row marked "Not open source") and the Licence screen. The Licence screen shows version, licence, the source as a link, the notices, and the licence text fetched from `licences/<id>.txt`, with an error line if it can't be read. Verify:
  - quick: a unit test on the module that groups the entries for display, so groups come in D7 order and every entry appears once;
  - mac: `web/test/ui/settings.test.ts` opens Credits, finds homr, Verovio, MuseScore_General and ML Kit with their versions and licences, opens homr and finds "GNU AFFERO GENERAL PUBLIC LICENSE" and the training-data note, opens MuseScore_General and finds the five acknowledgements, and Back walks back to Settings. Network requests other than the app's own origin are refused in that harness, so "offline" is covered.
- [x] 6.5 Look at Settings, About, Credits and two Licence screens (homr, ML Kit) in browser-dev at 360 × 780. Verify: manual by eye (the user).

## 7. Everything outside the app (D12)

- [x] 7.1 Recolour the icon in `tools/icon/make_icon.py` to variant A of the icon preview (D12 lists the five colours); the splash colour is the new ground. Run it, so it writes the launcher resources, the old splash PNGs, `web/public/favicon.svg`, `docs/design/icon/` and `styles.xml`. Verify:
  - quick: `git diff --stat` lists only files the script writes, and `cd android && ./gradlew assembleDebug` succeeds;
  - `python3 tools/icon/make_icon.py --preview <dir>` renders the round, squircle and monochrome masks, and the user has looked at them (manual by eye).
- [x] 7.2 Restyle `tools/store/compose.ts`:
  - the paper ground, ink captions and Public Sans, loaded from `web/src/ui/fonts/` instead of Google Fonts;
  - the feature graphic in the same palette;
  - a new 1280 × 640 `build/store/github/social-preview.png`.

  Update `tools/store/README.md` (no network needed, the social preview). Verify:
  - `node tools/store/capture.ts && node tools/store/compose.ts` runs with the network off and writes the English screenshots, the feature graphic, `icon-512.png` and the social preview;
  - the user has looked at them all (manual by eye).
- [x] 7.3 Restyle `docs/privacy/index.html` to the app's look: the paper, ink, line and blue tokens, 4px corners, light only, and Public Sans embedded as a `data:` URI. The text doesn't change. Verify:
  - `grep -cE '<script|src="http|href="http[^"]*\.css|@import' docs/privacy/index.html` gives 0;
  - `diff` of the page's visible text before and after is empty;
  - it reads well in a desktop browser and at 360px wide (manual by eye).
- [x] 7.4 Bring the README up to date:
  - copy four English captures (home, play along, reading pages, editor) from `build/store/raw/` into `docs/screenshots/`;
  - set the badge colours to the palette (ink for platform and status, blue for the licence; Buy Me a Coffee keeps its yellow);
  - make sure the icon at the top is the new 512px PNG;
  - the Languages line says English.

  Verify: the README renders on GitHub's preview of the branch, or with `gh markdown-preview` if available, showing the new images (manual by eye).

## 8. Device

- [x] 8.1 `make test-device` on the emulator, once before archive. Also on the emulator with adb:
  - tapping "Rate on Google Play" starts `ACTION_VIEW` with the Play URL, and the Play Store or Chrome comes on top;
  - Back returns to Snapsody's Settings (screenshot);
  - About's two links behave as in add-privacy-policy 4.1;
  - with the emulator's system language set to Dutch, the app shows English;
  - the launcher shows the new icon and the splash uses the new ground.

  Verify: device, the smoke test passes and the screenshots are saved with the change.
- [x] 8.2 On the S24: Home, Practice, the editor and About in the new look, and the new icon on the home screen. Check Public Sans, the status bar icons over the new ground, and the playing bar's blue in daylight. Verify: manual by eye on the real phone (the user).

## Workflow follow-up

- The user removes the Dutch (nl-NL) store listing in Play Console, and keeps English (en-US) only. In the same visit, upload the new icon, feature graphic and screenshots from `build/store/play/`.
- The user uploads `build/store/github/social-preview.png` in the GitHub repository settings (Settings, General, Social preview).
- The user uploads the restyled, English-only `docs/privacy/index.html` (add-privacy-policy 4.2).
- Archive `add-privacy-policy` before this change. Its delta adds the requirement "Privacy policy and source code" that this change modifies.
- Then archive this change.
