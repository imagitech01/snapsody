# Proposal

## Why

Snapsody looks generic. Sage green, soft tinted pills and big rounded cards would fit any app, and nothing in the look says "music". The user picked a new look from a mock (direction A, second round): paper white and ink, square-ish cards, a sans typeface and one blue accent that only marks state.

The Credits panel in Settings is also incomplete. It lists only the instrument sounds. It leaves out homr (AGPL-3.0, the reason the app is AGPL), Verovio (LGPL-3.0), the model runtimes, the Python stack, the app frame and the Android libraries. Some of those, such as Preact and Capacitor, are missing from `NOTICE` too. Settings also has three loose rows for credits, privacy and source code. The user wants those grouped behind one row, plus a way for people to rate the app on Google Play.

Finally, the user decided on 2026-11-20 that Snapsody is English only for now. The app, its Play Store listing and its privacy policy drop Dutch. The Dutch texts would otherwise need upkeep for every new screen, starting with the ones in this change.

## What Changes

- **New look, same content.** Every screen moves to "paper and ink":
  - a cool off-white ground with white cards that have a thin border and a 4px radius;
  - ink-blue text and ink primary buttons;
  - Public Sans, bundled with the app, for everything;
  - blue (#2c5bbf) only for state: the playing bar and cursor, the selected note, switches that are on, the active tab and links.

  No text, order, control or behaviour changes because of the look. The score is engraved as before, in the new ink colour.
- **No app name above titles.** The "Snapsody" eyebrow is removed from the start screens and from Favorites, the placeholder and the busy step of adding music. That saves room for practising. This part is already in the working tree.
- **About Snapsody.** The Credits, Privacy policy and Source code rows in Settings become one "About Snapsody" row, which shows the version. It opens an About screen with the version and the licence (AGPL-3.0), and three rows: Credits and licences, Privacy policy, and Source code. Privacy policy and Source code open the same pages in the browser as today.
- **Complete credits.** "Credits and licences" lists every major third-party component the app ships, grouped by what it does. Sub-libraries are not listed separately (the user, 2026-11-20). Each row shows its version and licence. Tapping a component shows its source, the notices its licence asks for, and its full licence text. The texts are bundled, so this works offline. `NOTICE` gains the components it is missing. A test keeps the app's list, `NOTICE` and the build files in step.
- **Rate on Google Play.** A row in Settings, directly above About Snapsody, opens Snapsody's page in the Play Store. It asks nothing first. There is no in-app review dialog and no feedback email.
- **BREAKING: English only.** The Language row and its list leave Settings, and the Dutch texts go. The app no longer follows the phone's language. A phone in Dutch shows English. A language chosen earlier is ignored, and is dropped from `settings.json` on the next save. The English catalogue and `t()` stay, so a language can come back later. The Play Store listing becomes English only, and the store screenshots are English only. The privacy policy page is already English only: its Dutch half was removed on 2026-11-20, before the user uploads it.
- **Everything around the app in the same look.** These all move to paper and ink:
  - the launcher icon (same mark, new colours), the favicon and the splash;
  - the Play Store screenshots and feature graphic;
  - a new GitHub social preview image;
  - the privacy policy page;
  - the README's screenshots, icon and badges.

  Nothing published keeps the old green.
- **No donation link** anywhere in the app. The GitHub page behind Source code already has one.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `app-shell`:
  - "Name and words" drops the Dutch word.
  - "General settings" loses the language and adds the Rate on Google Play row and the About Snapsody row.
  - "English and Dutch" is removed, and "English only" is added.
  - "Privacy policy and source code" moves both rows from Settings to the About screen. This requirement comes from the change `add-privacy-policy`, which must be archived first.
  - Adds the requirements "About Snapsody" and "Credits and licences".
- `instruments`: in "Recorded instrument sounds", the credits are reached through About Snapsody.

## Impact

- **Look:**
  - `web/src/ui/styles/` (tokens first, then the shapes that differ), and a bundled font file with its `@font-face`;
  - `tools/icon/make_icon.py` and everything it writes: the Android launcher and splash resources, `styles.xml`'s splash colour, `web/public/favicon.svg` and `docs/design/icon/`.
- **Screens:**
  - `web/src/ui/screens/SettingsScreen.tsx`, plus new About, Credits and Licence screens;
  - `web/src/app/router.ts` (new screen names), `web/src/app/links.ts` (the Play Store URL);
  - `web/src/app/credits.ts` (the full list), the texts in `en.ts`, and licence texts under `web/public/licences/`.
- **English only:**
  - `web/src/app/i18n/` loses `nl.ts` and the language choice; `settings.ts` drops `language`;
  - `SettingsSheets.tsx` loses `LanguageSheet`, and the router loses the `language` sheet;
  - `Device.language()` goes from the port and its three adapters;
  - `core/instruments` keeps one name per instrument;
  - the tests that run in Dutch, the store capture (`tools/store/`, `storePieces.ts`), `docs/store/listing.md`, `docs/testing.md` and `README.md` follow.
- **Build:** the app version reaches the web layer from `android/app/build.gradle` at build time.
- **Records and publishing:**
  - `NOTICE`;
  - `docs/store/` (the listing becomes English only);
  - `tools/store/compose.ts` (new look, local font, social preview);
  - `docs/privacy/index.html` (restyled);
  - `README.md` and `docs/screenshots/`.
- **Tests:**
  - `web/test/credits.test.ts` checks completeness and versions;
  - `web/test/ui/settings.test.ts` covers the rows, About, Credits and a licence;
  - the density journey at 360 × 780 runs as before.
- Pieces are stored as before. `settings.json` no longer writes `language`, and an old file that has it still reads. No plugin or permission is added.
