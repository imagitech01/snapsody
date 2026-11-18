import cv2

from homr.clahe import apply_clahe_gray
from homr.type_definitions import NDArray


def apply_clahe(image: NDArray) -> NDArray:
    image = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    # patched (instrument_assist): deterministic CLAHE, identical on every OpenCV
    # version and platform (see homr/clahe.py)
    return apply_clahe_gray(image, clip_limit=1.0, tile_grid=(8, 8))
