# Play Store graphics

Makes the screenshots, feature graphic and icon for the Google Play listing. The listing's texts
and the captions are in [docs/store/listing.md](../../docs/store/listing.md).

```sh
node tools/store/capture.ts   # raw app screenshots, en and nl  -> build/store/raw/<lang>/
node tools/store/compose.ts   # the Play graphics               -> build/store/play/
```

Both run Playwright's Chromium from `web/node_modules` (`cd web && npm ci` first). Everything they
write is under `build/`, which is git-ignored, so the graphics can be made again at any time.

## capture.ts

Drives the real web app on the UI tests' fake platform (`web/test/ui/app.ts`), at the S24's
360 x 780 viewport with 3x pixels (1080 x 2340). The pieces come from the `store-en` and `store-nl`
seeds (`web/test/ui/storePieces.ts`). Only public-domain melodies are used, typed in for this; the
page photo is that music rendered with Verovio. Never use material from `fixtures/local/`
(copyrighted method books).

## compose.ts

Puts each raw screenshot in a phone on the app's dark green, with the caption from
`docs/store/listing.md` above it. To change a caption, edit the table there and run compose again.

| Output | Size | Play Console field |
|---|---|---|
| `play/<lang>/screenshot-N-<screen>.png` | 1080 x 1920 | Phone screenshots (in order 1-7) |
| `play/<lang>/feature-graphic.png` | 1024 x 500 | Feature graphic |
| `play/icon-512.png` | 512 x 512, 32-bit | App icon |

The pages load Inter, the app's font, from Google Fonts, so compose needs a network connection.
