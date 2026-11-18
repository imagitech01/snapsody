"""The two page images of the pages-merge fixture (openspec practice-app 6.3).

One self-engraved exercise of 14 bars (3/4, G major, tenor-saxophone range) split over two images the
way a printed exercise runs over a page break: bars 1-8 on the first page, bars 9-14 on the second.
Page 2 starts with a clef and the key signature but, as printed music does, no time signature
(homr still writes a 3/4 for it, see read_two_page_fixture.py).
No copyrighted material is involved (design D12); the engraving is tools/models/engrave.py's.

Writes web/test/fixtures/two-page/page-1.png and page-2.png. Then, to read them as the app does and
build the expected merged score (the rest of the chain):

    .venv-convert/bin/python -I tools/pages/make_two_page_fixture.py
    .venv-py310/bin/python -I tools/pages/read_two_page_fixture.py
    (cd web && node test/fixtures/make-two-page.ts)

web/test/pages.test.ts spells the exercise out (EXERCISE there) and checks the merged score against
it, so a changed exercise needs that list changed too. The page images and the three outputs above
are reproducible: running the chain twice gives identical files on the same machine (homr's
<!-- imgpos --> comments may move by a pixel on another OpenCV build).
"""

from __future__ import annotations

import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
OUT = REPO / "web" / "test" / "fixtures" / "two-page"
sys.path.insert(0, str(REPO / "tools" / "models"))

from engrave import engrave_svg, svg_to_gray  # noqa: E402

# L:1/8, so G2 is a quarter note and G6 a dotted half. ABC's `c` is C5 and `C` is C4.
PAGE_1 = """X:1
T:
M:3/4
L:1/8
K:G
!mf! G2 B2 d2 | e2 d2 B2 | (GA) B c d2 | G6 |
.A.B .c.d e2 | d2 B2 G2 | (Bc) d e d2 | B4 A2 |
"""

# No M: field: Verovio then engraves the clef and the key signature and no meter.
PAGE_2 = """X:1
T:
L:1/8
K:G
B2 d2 g2 | f2 e2 d2 | (3cde (3fga b2 | !p! d2 B2 G2 | A2 B2 c2 | G6 |]
"""

PAGES = [PAGE_1, PAGE_2]


def main() -> int:
    from PIL import Image

    OUT.mkdir(parents=True, exist_ok=True)
    for n, abc in enumerate(PAGES, start=1):
        page = svg_to_gray(engrave_svg(abc))
        path = OUT / f"page-{n}.png"
        Image.fromarray(page).save(path)
        print(f"wrote {path} {page.shape}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
