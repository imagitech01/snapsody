# Design

## Context

`make ui-review` (test-pyramid design T4) runs the UI journeys with `UI_REVIEW=1`. Each `review(page, '<frame>')` call then captures the screen at 360 × 780 into `build/ui-review/`, and `reviewPage.ts` writes a page with each capture beside its exported frame from `docs/design/figma/`, with an overlay and the notes from `docs/design/deviations.md`. Without `UI_REVIEW`, `review()` returns at once, so the test layers do not depend on it. The OpenSpec config asks every UI task to name its frame and be checked in `make ui-review`, and every UI design to list frames and deviations.

## Goals / Non-Goals

**Goals:**
- Remove the comparison with Figma: the command, its code, the frames, the rules that ask for it, and the spec requirement.
- Keep a by-eye check for UI work, in the app itself.

**Non-Goals:**
- No change to the app, the test layers or the journeys' assertions.
- No screenshot page without frames in its place.

## Decisions

### R1. Remove the tooling, not leave it unused
`review.ts`, `reviewPage.ts`, `frames.json` and the frame PNGs only serve the comparison. Left in place, the `review()` calls would keep inviting new frame names. They are removed, with `REVIEW_DIR` and `DESIGN_DIR` in `paths.ts`. `PHONE_LANDSCAPE` in `app.ts` stays: `density.test.ts` uses it.
Alternative: keep `make ui-review` as a page of screenshots without frames. Not asked for, and browser-dev already shows the real screens.

### R2. `deviations.md` stays, as a record
Code comments point to it (the tokens, the icon, the library rows, the favorites screen), and it explains why the screens look as they do. It gets a note at the top that the Figma design is finished and that the file is no longer added to. Its mentions of the review page go.

### R3. The by-eye check moves to browser-dev
The rules say: a UI task is checked by eye in the app in browser-dev (`npm run dev`) at 360 × 780, in English and Dutch, named as manual. A design for UI work no longer lists frames. The other rules stay.

## Risks / Trade-offs

- [The exported frames leave the repo, so `deviations.md` describes frames that are no longer next to it] → The Figma file still exists, and the notes say what differs in words. Git history keeps the PNGs.
