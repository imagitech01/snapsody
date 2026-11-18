// Writes the expected merged score of the two-page fixture (openspec practice-app 6.3).
//
//   node test/fixtures/make-two-page.ts      (from web/) rewrites two-page/merged.musicxml
//
// The fixture is one self-engraved exercise (14 bars, 3/4, G major) split over two images the way a
// printed exercise runs over a page break (two-page/page-1.png: bars 1-8, page-2.png: bars 9-14).
// The chain that makes it, none of it run by the tests:
//
//   .venv-convert/bin/python -I tools/pages/make_two_page_fixture.py   the two images (Verovio)
//   .venv-py310/bin/python -I tools/pages/read_two_page_fixture.py     homr's reading of each: page-N.musicxml
//   node test/fixtures/make-two-page.ts                                 this: the merged score
//
// merged.musicxml is what `preparePages` makes of the two raw readings. test/pages.test.ts checks
// that the committed file is this generator's output, and the music in it against the exercise.

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { preparePages } from '../../src/core/pages/pages.ts'

const here = (name: string): string => fileURLToPath(new URL(`./two-page/${name}`, import.meta.url))

/** homr's readings of the two page images, as it wrote them. */
export const TWO_PAGE_READINGS = [here('page-1.musicxml'), here('page-2.musicxml')]
/** The page images the readings were made from. */
export const TWO_PAGE_IMAGES = [here('page-1.png'), here('page-2.png')]
/** The expected merged score. */
export const TWO_PAGE_MERGED = here('merged.musicxml')

/** The merged score the two readings give. */
export function twoPageMerged(): string {
  return preparePages(TWO_PAGE_READINGS.map((path) => readFileSync(path, 'utf8'))).musicxml
}

if ((import.meta as { main?: boolean }).main) {
  writeFileSync(TWO_PAGE_MERGED, twoPageMerged())
}
