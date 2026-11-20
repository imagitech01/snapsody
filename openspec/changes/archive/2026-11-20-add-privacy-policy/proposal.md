# Proposal

## Why

Google Play won't publish Snapsody without a privacy policy. It must be at a public https URL, entered in Play Console, and reachable from inside the app. Play asks for one even when an app collects no data. The AGPL also asks for a way to get the source code from the app. That link is still open from the Play Store release work.

## What Changes

- **A privacy policy for Snapsody**, in English (Dutch was dropped on 2026-11-20), as one static web page: `docs/privacy/index.html`. ImagiTech hosts it at `https://imagitech.be/snapsody/privacy/` (the user uploads it). It says what the app keeps and where: everything stays on the phone, there is no internet permission, no account, no ads and no analytics. It names the one outside party, Google's document scanner in Google Play services, and what ML Kit says Google receives from it. It covers retention and deletion and the contact point (info@imagitech.be).
- **Settings gets two link rows** above the offline note: **Privacy policy** and **Source code**. Each opens its page in the phone's browser. The app itself still has no internet permission: the browser does the loading.
- **The store listing** (`docs/store/listing.md`) gets the privacy policy URL and the privacy facts that the policy and the Data safety form both rest on.

Not in this change: filling in the Data safety form in Play Console, and the company's legal details (address, company number) on the page. The user adds those.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `app-shell`: adds "Privacy policy and source code".

## Impact

- `web/src/app/links.ts` (new): the two URLs, in one place.
- `web/src/ui/components/ListRow.tsx`: a row can be a link (`href`).
- `web/src/ui/screens/SettingsScreen.tsx`: the two rows. Texts in `en.ts` and `nl.ts`. Styles for a link row in `components.css`.
- `web/test/ui/settings.test.ts`: the rows and their URLs.
- `docs/privacy/index.html` (new), `docs/store/listing.md`.
