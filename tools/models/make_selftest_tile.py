"""Build the accelerator self-test reference tile and its CPU reference output (task 4.1).

The tile is self-made, so no book content ships in the app (design D4, D12):
1. The dense test notation in engrave.py (triplets, slurs, staccato, ledger lines) is
   engraved with Verovio and rasterised to PNG.
2. homr's pre-segnet pipeline is applied (autocrop, resize, CLAHE).
3. Of the candidate 320 x 320 tiles, those where segnet finds each required class
   (stems/rests, noteheads, clefs/keys, staff) with at least MIN_CLASS_PIXELS pixels
   are kept, and of those the one with the most symbol pixels wins. Class 5 ("other
   symbols") hardly occurs on Verovio's engraving (at most 6 pixels in any tile), so it
   is not required.

Its CPU reference is the argmax of the packaged LiteRT segnet on a Mac's CPU.

Writes to build/models/ (package_models.py then copies both files into the app):
- selftest_tile.u8       320 x 320 uint8, the grey tile exactly as segnet sees it
- selftest_ref_cpu.u8    320 x 320 uint8 class ids (0 = background)
- selftest_tile.png      the same tile, for looking at
- selftest.json          provenance, the segnet hash the reference belongs to, pixel counts

    .venv-convert/bin/python -I tools/models/make_selftest_tile.py
"""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).parent))
OUT = REPO / "build" / "models"
SEGNET = OUT / "segnet_fp32_b1.tflite"
TILE = 320
STRIDE = 80
CANDIDATES = 60  # darkest candidate tiles that are run through segnet
REQUIRED_CLASSES = (1, 2, 3, 4)  # stems/rests, noteheads, clefs/keys, staff
MIN_CLASS_PIXELS = 150
MIN_SYMBOL_PIXELS = 12000


def main() -> int:
    import cv2
    from PIL import Image

    from engrave import engraved_page
    from segnet_equivalence import preprocess_bgr, run_tflite

    if not SEGNET.exists():
        print(f"missing {SEGNET}; run build_segnet.py first", file=sys.stderr)
        return 1
    gray = preprocess_bgr(cv2.cvtColor(engraved_page(), cv2.COLOR_GRAY2BGR))
    assert gray.dtype == np.uint8, gray.dtype
    h, w = gray.shape
    positions = [(y, x) for y in range(0, h - TILE + 1, STRIDE) for x in range(0, w - TILE + 1, STRIDE)]
    ink = [int((gray[y : y + TILE, x : x + TILE] < 128).sum()) for y, x in positions]
    darkest = [positions[i] for i in np.argsort(ink)[::-1][:CANDIDATES]]
    tiles = np.stack([gray[y : y + TILE, x : x + TILE] for y, x in darkest])
    nchw = np.repeat(tiles[:, None].astype(np.float32), 3, axis=1)
    classes = run_tflite(SEGNET, nchw)  # N x 320 x 320
    flat = classes.reshape(len(tiles), -1)
    symbol_counts = (flat != 0).sum(axis=1)
    complete = np.array([all((t == c).sum() >= MIN_CLASS_PIXELS for c in REQUIRED_CLASSES) for t in flat])
    if not complete.any():
        print(f"no candidate tile contains classes {REQUIRED_CLASSES}", file=sys.stderr)
        return 1
    best = int(np.argmax(np.where(complete, symbol_counts, -1)))
    tile, reference = tiles[best], classes[best].astype(np.uint8)
    present = sorted(int(c) for c in np.unique(reference))
    symbol_pixels = int(symbol_counts[best])
    if symbol_pixels < MIN_SYMBOL_PIXELS:
        print(f"densest tile has only {symbol_pixels} symbol pixels (< {MIN_SYMBOL_PIXELS})", file=sys.stderr)
        return 1

    OUT.mkdir(parents=True, exist_ok=True)
    tile.tofile(OUT / "selftest_tile.u8")
    reference.tofile(OUT / "selftest_ref_cpu.u8")
    Image.fromarray(tile).save(OUT / "selftest_tile.png")
    info = {
        "source": "tools/models/engrave.py TEST_ABC (self-engraved, Verovio), homr preprocessing",
        "page_size": [w, h],
        "tile_origin": {"x": darkest[best][1], "y": darkest[best][0]},
        "tile_size": TILE,
        "segnet_sha256": hashlib.sha256(SEGNET.read_bytes()).hexdigest(),
        "reference": "argmax of segnet_fp32_b1.tflite, LiteRT CPU (Mac)",
        "symbol_pixels": symbol_pixels,
        "classes_present": present,
        "class_pixels": {str(c): int((reference == c).sum()) for c in present},
    }
    (OUT / "selftest.json").write_text(json.dumps(info, indent=2) + "\n")
    print(json.dumps(info, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
