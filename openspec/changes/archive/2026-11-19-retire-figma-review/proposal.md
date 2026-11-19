# Proposal

## Why

The app now implements the Figma design as closely as it will. From here on, changes are designed on a mock of the real screen, not in Figma, and the frames will not be updated. `make ui-review`, which puts each screen next to its Figma frame, would compare new screens with frames that no longer describe them. Keeping it means every UI task names a frame and records deviations from a design nobody maintains.

## What Changes

- **BREAKING (spec):** the test suite no longer compares screens with the Figma design. `make ui-review`, `web/test/ui/review.ts`, `web/test/ui/reviewPage.ts` and the `review()` calls in the journey tests are removed.
- `docs/design/figma/` (the frame list and the exported frames) is removed.
- `docs/design/deviations.md` stays as a record of how the shipped screens differ from the last Figma design. Nothing adds to it.
- The OpenSpec rules no longer ask a UI task or design to name Figma frames and deviations. A UI task is checked by eye in the app in browser-dev at the phone's size, in English and Dutch, named as manual.
- `docs/testing.md`, the Makefile and code comments drop their mentions of the review page.

Not in this change: anything in the app itself.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `test-suite`: removes "Screens can be compared with the design".

## Impact

- Test tooling only: `Makefile`, `web/test/ui/` (review files, `paths.ts`, `vite.config.ts` comment, the journey tests' `review()` calls), `web/dev/gallery.tsx` comment, `web/src/ui/styles/tokens.css` comment.
- Docs: `docs/testing.md`, `docs/design/deviations.md`, `docs/design/figma/` (removed).
- `openspec/config.yaml` rules.
- The active change `simplify-editor-and-name-new-pieces` plans checks in `make ui-review` (tasks 3.5 and 4.2). It is updated to check by eye in browser-dev instead.
