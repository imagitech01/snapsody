# Tasks

Layers are as in `docs/testing.md`: **quick** (`make test-quick`) and **mac** (`make test-mac`). This change touches test tooling and docs only; there is no device smoke test for it.

## 1. Remove the comparison

- [x] 1.1 Remove the `ui-review` target and its line in the Makefile header. Delete `web/test/ui/review.ts` and `web/test/ui/reviewPage.ts`. Remove the `review` imports and calls from `practice`, `library`, `addMusic`, `edit`, `settings` and `harness` in `web/test/ui/`, and `REVIEW_DIR` and `DESIGN_DIR` from `paths.ts`. Verify: mac, `make test-mac` is green and `grep -rn "review(page\|ui-review\|UI_REVIEW" web Makefile` is empty.
- [x] 1.2 Delete `docs/design/figma/`. Verify: `grep -rn "figma/" web docs README.md` finds nothing that points at it.

## 2. Docs and rules

- [x] 2.1 Replace the "Design review" section of `docs/testing.md` with the by-eye check in browser-dev (R3), and drop the review page from the comments in `web/test/ui/vite.config.ts`, `web/dev/gallery.tsx` and `web/src/ui/styles/tokens.css`. Note at the top of `docs/design/deviations.md` that the Figma design is finished and the file is a record (R2), and drop its mentions of the review page. Verify: `grep -rn "ui-review\|review page" docs web/src web/dev web/test README.md` finds only the history note in `deviations.md`.
- [x] 2.2 In `openspec/config.yaml`, replace the Figma task rule with the browser-dev check (R3) and remove the Figma design rule. Verify: `openspec validate retire-figma-review --strict` is green.
