# Play Store graphics

Makes the screenshots, feature graphic and icon for the Google Play listing, and the GitHub social preview. The listing's texts
and the captions are in [docs/store/listing.md](../../docs/store/listing.md).

```sh
node tools/store/capture.ts   # raw app screenshots (English)  -> build/store/raw/
node tools/store/compose.ts   # the Play graphics + social preview -> build/store/play/, build/store/github/
```

Both run Playwright's Chromium from `web/node_modules` (`cd web && npm ci` first). Everything they
write is under `build/`, which is git-ignored, so the graphics can be made again at any time.

## capture.ts

Drives the real web app on the UI tests' fake platform (`web/test/ui/app.ts`), at a typical phone's
360 x 780 viewport with 3x pixels (1080 x 2340), in English: the app is English only. The pieces come
from the `store` seed (`web/test/ui/storePieces.ts`). Only public-domain melodies are used, typed in for this; the
page photo is that music rendered with Verovio. Never use material from `fixtures/local/`
(copyrighted method books).

## compose.ts

Puts each raw screenshot in a phone on the app's paper ground (`#f1f3f6`), with the caption from
`docs/store/listing.md` above it in ink (`#1c2433`), in Public Sans. To change a caption, edit the table there and run compose again.

| Output | Size | Play Console field |
|---|---|---|
| `play/screenshot-N-<screen>.png` | 1080 x 1920 | Phone screenshots (in order 1-7) |
| `play/feature-graphic.png` | 1024 x 500 | Feature graphic |
| `play/icon-512.png` | 512 x 512, 32-bit | App icon |
| `github/social-preview.png` | 1280 x 640 | GitHub social preview (not Play) |

compose needs no network: the pages embed Public Sans from `web/src/ui/fonts/` as a `data:` URI, and
the colours are the app's (`web/src/ui/styles/tokens.css`).

### The social preview

GitHub does not read the image from the repository. Upload `build/store/github/social-preview.png`
by hand: repository **Settings, General, Social preview, Edit, Upload an image**. Do it again
whenever the image changes.
