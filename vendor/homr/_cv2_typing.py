"""Compatibility shim for ``cv2.typing``.

``cv2.typing`` only exists from OpenCV 4.8. Chaquopy ships OpenCV 4.5.1, so
fall back to plain aliases there. homr uses these names only in annotations.
(instrument_assist patch, see vendor/PATCHES.md)
"""

from typing import Any

try:
    from cv2.typing import MatLike, Rect, RotatedRect  # type: ignore[import-not-found]
except ImportError:  # OpenCV < 4.8
    MatLike = Any  # type: ignore[misc]
    Rect = Any  # type: ignore[misc]
    RotatedRect = Any  # type: ignore[misc]

__all__ = ["MatLike", "Rect", "RotatedRect"]
