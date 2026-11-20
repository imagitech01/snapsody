# Device check, task 8.1 (2026-11-20)

On the `ia_test_api36` emulator, after `make test-device` passed, with the debug build of this change and the
emulator's system language set to Dutch (`cmd locale set-device-locale nl-NL`):

1. `01`: a Dutch phone shows the app in English.
2. `02`: "Rate on Google Play" starts `ACTION_VIEW` with `https://play.google.com/store/apps/details?id=be.imagitech.snapsody`,
   and the Play Store comes on top (signed out: the emulator has no account).
3. `03`: Back returns to Snapsody's Settings.
4. `04`–`06`: on About, "Privacy policy" and "Source code" start `ACTION_VIEW` with the imagitech.be and github.com URLs,
   Chrome comes on top (its first-run screen, on the clean snapshot), and Back returns to About each time.
5. `07`, `08`: the launcher shows the new icon, and the splash uses the new ground.
