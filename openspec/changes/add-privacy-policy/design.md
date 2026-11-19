# Design

## Context

See proposal.md for why. The facts the policy rests on, checked on 2026-11-19:

- **Permissions.** The merged release manifest (`android/app/build/intermediates/merged_manifests/release/`) declares `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MEDIA_PROCESSING`, `ACCESS_NETWORK_STATE` and the app's own `DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`. There is no `INTERNET`: the source manifest removes it, even though Capacitor and ML Kit both merge it in. There is no camera, storage, location or contacts permission either.
- **Backup.** `android:allowBackup="false"`, with targetSdk 36. Android's Android 12 behaviour changes say this "does disable backups to Google Drive, but doesn't disable D2D transfers" on some manufacturers' phones. So the policy says no cloud backup, and that a phone-to-phone transfer may copy the data straight to the user's new phone.
- **The document scanner** (`play-services-mlkit-document-scanner`). ML Kit's page says that "the entire document scanner flow operates on-device" and that "no camera permission is required - the document scanner leverages the Google Play services' camera permission". ML Kit's Android data disclosure lists what ML Kit sends to Google "for diagnostics and usage analytics": device information, package name and app version, per-installation identifiers "not intended to uniquely identify a user or physical device", performance metrics, API configuration and event types. That data is encrypted in transit and not given to third parties. The page doesn't cover the document scanner by name, so the policy says Google Play services "may" send this kind of data.
- **Google's logging code in the APK.** The merged release manifest has ML Kit's `datatransport` components (`CctBackendFactory`, `JobInfoSchedulerService`), Google's usage logging. Without `INTERNET` it can't send from the app. So the policy says ImagiTech added no analytics code, not that the APK holds none.
- **Storage.** The app's files are in `Directory.Data` (internal `filesDir`) and the reader's work folder is in `cacheDir`. Both are private to the app. Nothing is written to external storage (the FileProvider's `external-path` is from Capacitor's template and holds no user data).
- **Android vitals.** Per Play Console help (answer 9844486), the data comes from "users who have opted in to automatically share usage and diagnostics data". It is reported as a percentage of daily users, with breakdowns by device model and Android version. Google collects it, not the app, so the policy describes it under "Google Play".
- **Play's privacy policy requirements** (User Data policy, answer 10144311). The policy must give: developer information and a privacy contact; the kinds of data accessed, collected, used and shared, and who it's shared with; secure handling; retention and deletion; a "privacy policy" label; and the app name and company. It must be at a public, non-geofenced URL, not a PDF, and not editable.
- **Hosting.** imagitech.be is served by nginx as static HTML (HTTP 200, `text/html`). A standalone HTML file can go there as is.

## Decisions

### D1. One static page, both languages, in the repo
The policy is `docs/privacy/index.html`: a single self-contained file with inline CSS and no scripts, fonts or images from elsewhere. It has English first and Dutch below, with a link to jump between them. It lives in the repo so it's versioned with the app it describes. The user uploads it to `https://imagitech.be/snapsody/privacy/` (a folder, so the file is served as `index.html`).

Alternative: GitHub Pages. The user chose the company's own site.

### D2. The entity and the contact
The page names "ImagiTech", the developer name of the Play account, and gives info@imagitech.be (the user's choice). It doesn't give an address or a company number, because those aren't known here. The user adds them if they want, and the handoff says so.

### D3. No statement about children
The page doesn't say who the app is for. That's the Target audience answer in Play Console, and a mismatch between the two gets flagged. Because the app collects nothing, the policy doesn't need it.

### D4. Opening a link from an app without internet
The rows are plain `<a href="https://…" target="_blank" rel="noopener noreferrer">`. On the phone, Capacitor's `BridgeWebViewClient.shouldOverrideUrlLoading` hands every navigation to `Bridge.launchIntent`. That starts an `ACTION_VIEW` intent for any host that isn't the app's own, so the phone's browser opens the page. It returns true even when no browser is installed (it catches `ActivityNotFoundException`), so the WebView never leaves the app. `capacitor.config.json` has no `allowNavigation` that could keep these hosts inside the WebView. In `npm run dev` and in the UI tests, `target="_blank"` opens a new tab, so the app stays where it is.

No plugin is added: `@capacitor/browser` (Custom Tabs) would be a new dependency for two links.

### D5. ListRow as a link
`ListRow` gets an `href`. With it, the row's main part is an `<a>` instead of a `<button>`, with the same classes and the chevron, so it looks like the other settings rows. Screen readers announce it as a link, which is what it is.

### D6. The URLs in one place
`web/src/app/links.ts` exports `PRIVACY_POLICY_URL` and `SOURCE_CODE_URL`. The listing and the page repeat the privacy URL. If the host ever changes, these three change together.

## Risks / Trade-offs

- **The page must be live before release.** The app and the listing point at a URL that only works once the user has uploaded the file. Task 4.2 checks it.
- **"May" about Google.** The policy can't say exactly what Google Play services sends for the scanner, because Google doesn't document that per API. It quotes ML Kit's general list and points to Google's privacy policy.
