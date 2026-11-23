# Google Play listing

The texts of the Play Store listing, in English (en-US). The app and the listing are English only. The screenshots and the
feature graphic are made by `tools/store/` (see its README). Play's limits: app name 30 characters,
short description 80, full description 4000.

Keep the texts honest about what the app does today (README "Current limits"): recognition isn't
perfect, and reading a piano grand staff from a phone photo is newer and less tested than a melody.

---

## English (en-US)

### App name

Snapsody: Sheet Music Practice

### Short description

Snap your sheet music, hear how it goes and play along at your own tempo.

### Full description

Practising from a method book, and the exercise has no recording? Take a photo of the page. Snapsody reads the notes, plays them with a real instrument sound and follows along in the score, so you can hear how it goes and play along at your own pace.

SNAP, READ, PLAY
• Photograph one or more pages with your phone's document scanner.
• Snapsody reads the music on your phone itself. Nothing is uploaded, and there is no account.
• The pages become one piece with continuous bar numbers, ready to practise.

PRACTISE THE WAY YOU WANT
• Follow-along highlighting shows where you are in the score.
• Slow the tempo down, then speed it up again as you improve.
• Metronome and a one-bar count-in.
• Loop the hard bars, with an optional rest between repeats.
• Every piece remembers its bar, tempo, loop and metronome.

SEVEN INSTRUMENT SOUNDS
Tenor sax, alto sax, clarinet, piano, guitar, violin and trumpet, from sampled sounds that ship inside the app. The written notes stay as they are; only the sound is transposed for your instrument.

FIX WHAT THE READER MISSED
Recognition isn't perfect, so there is a score editor. Change notes, rests, lengths, ties, slurs, articulations, dynamics, key, time signature and tempo, one bar at a time, and listen to a bar before you save. Snapsody gently points out bars that don't add up and notes it was unsure about.

YOUR MUSIC, YOUR PHONE
• Works fully offline: the app has no internet permission.
• No account, no ads, no tracking.
• Your pieces, photos and settings stay on your device.
• Open source (AGPL-3.0).

GOOD TO KNOW
• Snapsody reads printed method-book music: a melody for sax, clarinet, trumpet or violin, a melody with a piano accompaniment, or a piano piece on a grand staff, chords included. Choose the part you play, and the other parts play along. It doesn't read lyrics, fingering, pedal marks or chord symbols.
• Scanning uses Google's document scanner, which comes with Google Play services.

### Screenshot captions

| # | Screen | Headline | Subline |
|---|---|---|---|
| 1 | play-along | Play along with your own sheet music | The score follows the music, note by note. |
| 2 | reading | Snap a photo. Snapsody reads the notes. | On your phone itself. Nothing is uploaded. |
| 3 | loop | Slow it down. Loop the hard bars. | Tempo, metronome, count-in and loops. |
| 4 | editor | Fix a note in a few taps | Notes, lengths, marks, key and tempo. |
| 5 | home | Pick up where you left off | Every piece keeps its bar, tempo and loop. |
| 6 | instruments | Seven real instrument sounds | Sax, clarinet, piano, guitar, violin and trumpet. |
| 7 | library | All your music in one place | Search, favorites and your practice rotation. |

Feature graphic: "Snap your sheet music. Play along."

---

## Privacy policy

Play Console → Policy and programs → App content → Privacy policy:

    https://imagitech.be/snapsody/privacy/

The page is [`docs/privacy/index.html`](../privacy/index.html) (English only, like the app). ImagiTech hosts it;
upload it again whenever it changes. The same URL is `PRIVACY_POLICY_URL` in `web/src/app/links.ts`,
behind the Privacy policy row in Settings.

### Privacy facts

The privacy policy and the Data safety form both rest on these facts. Checked on 2026-11-19 (openspec
change `add-privacy-policy`, design "Context", which gives the sources). If any of them changes,
update the policy, its date and the Data safety form together.

- **No internet permission.** The merged release manifest declares only `FOREGROUND_SERVICE`,
  `FOREGROUND_SERVICE_MEDIA_PROCESSING`, `ACCESS_NETWORK_STATE` and the app's own
  `DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`. No camera, storage, location or contacts permission.
- **Nothing leaves the phone through the app.** No account, ads, analytics, tracking or crash reporting
  added by ImagiTech. ML Kit brings Google's `datatransport` logging into the APK, but it can't send
  without `INTERNET`. Photos, scores, practice state and settings are in the app's internal storage
  (`filesDir`, `cacheDir`).
- **Android vitals.** Google may show ImagiTech aggregated crash and performance data in Play Console,
  from users who opted in to share usage and diagnostics. Google collects it, not the app.
- **No cloud backup.** `android:allowBackup="false"`. On some phones, a phone-to-phone transfer can still
  copy the app's data to the user's new phone.
- **Deletion.** Deleting a piece removes its score, photos and practice settings (`piece-library`
  "Delete a piece"). Uninstalling, or clearing the app's storage, removes everything.
- **Google's document scanner** runs in Google Play services, on the device, with Play services' own camera
  permission. According to ML Kit's data disclosure, Play services may send Google diagnostics and
  usage data (device and app info, per-installation IDs, performance, API configuration, events),
  encrypted in transit and not shared with third parties. That is Google's collection, not ImagiTech's.
