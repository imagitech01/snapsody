# Manual checks on a Galaxy S24 (task 16.2)

Done by the user on 18 Nov 2026 on a Galaxy S24 (SM-S921B), with the release candidate of the app
(`app.snapsody`, the build of commit 22c3db1). Reported as "everything works".

| Check | Result |
|---|---|
| Scanning a two-page exercise into one piece | **pass** |
| Each instrument and the metronome, by ear | **pass**: tenor sax, alto sax, clarinet, piano and guitar work, with no crackle (the same verdict as task 7.3). Violin and trumpet were hidden on the phone then; the user listened to them in browser-dev the same day and they passed (task 7.3), so they are now shown. |
| Portrait and landscape practice, by eye | **pass** as function. The look did not pass: see below. |
| The screen stays on during a long loop | **pass** |

## The look (feedback, handled by design D18)

The user's words: "in general i notice app is large, large texts and a lot of space between everything. this takes
away from the practice focus. also in landscape there is a lot of empty space with no use."

What the phone runs at, read with `adb` the same day: the display is 1080 × 2340 at 480 dpi, so the WebView's CSS
viewport is **360 × 780** (780 × 360 in landscape), not the 384 × 832 the mac journeys used. The system font scale is
0.9 (smaller than normal), and the app sets no `textZoom`, so the system setting does not make the text bigger. The
narrower viewport alone makes the app look about 7 % larger relative to the screen than in the review
screenshots, on top of the frames' own sizes.
