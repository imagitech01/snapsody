"""Check vendor/homr/clahe.py against the installed OpenCV's CLAHE.

Run it with an OpenCV 4.14 environment (the version that produced the
reference): every case must match bit for bit. With older OpenCV builds a small
number of x.5-tie pixels is expected to differ, which is why the patch exists.

    python tools/homr/check_clahe.py [image]
"""

import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "vendor"))
from homr.clahe import apply_clahe_gray  # noqa: E402


def main() -> int:
    rng = np.random.default_rng(0)
    cases = []
    if len(sys.argv) > 1:
        page = cv2.cvtColor(cv2.imread(sys.argv[1]), cv2.COLOR_BGR2GRAY)
        cases.append(("image", page, 1.0))
    else:
        page = cv2.GaussianBlur(rng.integers(0, 256, (1440, 1920), dtype=np.uint8), (0, 0), 3)
    for i in range(120):
        h, w = int(rng.integers(16, 1700)), int(rng.integers(16, 2100))
        kind = i % 3
        if kind == 0:
            image = rng.integers(0, 256, (h, w), dtype=np.uint8)
        elif kind == 1:
            image = cv2.GaussianBlur(rng.integers(0, 256, (h, w), dtype=np.uint8), (0, 0), 5)
        else:
            image = cv2.resize(page, (w, h))
        cases.append((f"{kind}:{h}x{w}", image, [1.0, 2.0, 40.0, 0.5][i % 4]))
    failing = 0
    for name, image, clip in cases:
        expected = cv2.createCLAHE(clipLimit=clip, tileGridSize=(8, 8)).apply(image)
        differing = int((apply_clahe_gray(image, clip) != expected).sum())
        if differing:
            failing += 1
            print("MISMATCH", name, clip, differing)
    print(f"OpenCV {cv2.__version__}: {len(cases)} cases, {failing} mismatching")
    return 1 if failing else 0


if __name__ == "__main__":
    sys.exit(main())
