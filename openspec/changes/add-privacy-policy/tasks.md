# Tasks

Layers are as in `docs/testing.md`: **quick** (`make test-quick`) and **mac** (`make test-mac`). The device smoke test runs once before archive. Design references are D1–D6 in design.md.

## 1. The privacy policy (D1, D2, D3)

- [x] 1.1 Write `docs/privacy/index.html`: English and Dutch, static, self-contained, covering everything in Play's list (design "Context"). Verify: the page has no `<script>` and no external `src` or stylesheet; every claim matches a fact in design.md "Context"; it opens and reads well in a desktop browser and at 360px wide.

## 2. Settings rows (D4, D5, D6)

- [x] 2.1 Add `web/src/app/links.ts` with `PRIVACY_POLICY_URL` and `SOURCE_CODE_URL`. Give `ListRow` an `href` that renders the main part as `<a target="_blank" rel="noopener noreferrer">`. Verify: quick, `make test-quick` is green (types included).
- [x] 2.2 Add the "Privacy policy" and "Source code" rows to `SettingsScreen`, with their texts in `en.ts` and `nl.ts`. Verify: mac, a new test in `web/test/ui/settings.test.ts` finds both links by name in English and in Dutch, with the right `href`, `target="_blank"` and `rel`, without clicking them. `web/test/i18n.test.ts` (key parity) stays green.

## 3. Store listing

- [x] 3.1 Add the privacy policy URL and the privacy facts to `docs/store/listing.md`. Verify: the URL is the same as `PRIVACY_POLICY_URL`, and the facts match design.md "Context".

## 4. On the phone and online

- [x] 4.1 Emulator smoke test: in Settings, tapping "Privacy policy" opens the browser and Back returns to Settings with the app intact. The same for "Source code". Verify: device, on the ia_test_api36 emulator with adb: a tap starts `ACTION_VIEW` with the imagitech.be or github.com URL, Chrome becomes the top activity, and after Back Snapsody's MainActivity is on top again, with the Settings screen shown (screenshot).
- [ ] 4.2 (user) Upload `docs/privacy/index.html` to `https://imagitech.be/snapsody/privacy/`, and enter that URL in Play Console (Policy and programs → App content → Privacy policy). Verify: `curl -sI https://imagitech.be/snapsody/privacy/` gives 200 and `text/html`, with no redirect to a login and a valid certificate.
