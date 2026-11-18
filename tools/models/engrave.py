"""Self-engraved test material: dense single-staff notation rendered by Verovio.

No copyrighted book content (design D12). Used by the segnet equivalence test
(task 2.2) and the accelerator self-test reference tile (task 4.1).

    .venv-convert/bin/python -I tools/models/engrave.py out.png
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

# Exercise-like ABC with what segnet must get right: triplets, slurs, staccato,
# ledger lines above and below the staff, accidentals, rests, ties, dynamics.
TEST_ABC = """X:1
T:
M:3/4
L:1/8
K:G
!mf! ((3GBG) (3.A.B.c d2 | ((3dcB) (3.A.G.F G2 | ((3A,B,C) (3.D.E.F G2 | ((3gab) (3.c'.b.a g2 |
((3B^cd) (3.e.f.g a2 | ((3baf) (3.e.d.c B2 | ((3D,E,F,) (3.G,.A,.B, C2 | ((3ega) (3.b.c'.d' e'2 |
(GA) .B.c d2- | d2 z2 ((3fga) | !f! ((3bag) (3.f.e.d c2 | ((3A,=F,A,) (3.C.E.G B2 |
((3c'd'e') (3.d'.c'.b a2 | ((3_BAG) (3.F.E.D C2 | .G,.A, .B,.C .D.E | G6 |
!p! (3.G.B.d ((3gdB) G2 | (3.A.c.e ((3aec) A2 | ((3F,A,C) (3.E.G.B d2 | ((3c'af) (3.d.B.G E2 |
z2 ((3D^FA) (3.d.f.a | (d'2 b2) .g.e | ((3C,E,G,) (3.C.E.G c2 | (c2 e2) .g.c' |
!mf! ((3e'c'a) (3.f.d.B G2 | ((3=F,A,C) (3.F.A.c f2 | (3.B,.D.G ((3BdB) G2 | (G,2 B,2 D2) |
((3gfe) (3.d.c.B A2 | ((3A,B,^C) (3.D.E.^F G2 | .D.E .F.G .A.B | g6 |]
"""


def engrave_svg(abc: str = TEST_ABC, page_width: int = 1500, scale: int = 40) -> str:
    import verovio

    toolkit = verovio.toolkit()
    toolkit.setOptions(
        {
            "pageWidth": page_width,
            "pageHeight": 2970,
            "scale": scale,
            "adjustPageHeight": True,
            "header": "none",
            "footer": "none",
            "breaks": "auto",
        }
    )
    if not toolkit.loadData(abc):
        raise RuntimeError("Verovio could not load the test ABC")
    return toolkit.renderToSVG(1)


def svg_to_gray(svg: str, width: int = 2000) -> np.ndarray:
    """Rasterise to an 8-bit grayscale page on a white background."""
    import io

    import resvg_py
    from PIL import Image

    png = bytes(resvg_py.svg_to_bytes(svg_string=svg, width=width, background="white"))
    return np.asarray(Image.open(io.BytesIO(png)).convert("L"))


def engraved_page(width: int = 2000) -> np.ndarray:
    return svg_to_gray(engrave_svg(), width)


def main() -> int:
    from PIL import Image

    out = Path(sys.argv[1] if len(sys.argv) > 1 else "engraved_test_page.png")
    page = engraved_page()
    Image.fromarray(page).save(out)
    print(f"wrote {out} {page.shape}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
