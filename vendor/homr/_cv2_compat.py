"""Version-independent wrappers around OpenCV functions whose output convention
changed between releases. instrument_assist patch, see vendor/PATCHES.md.
"""

from typing import Any

import cv2


def min_area_rect(points: Any) -> tuple[tuple[float, float], tuple[float, float], float]:
    """``cv2.minAreaRect`` with its angle always in OpenCV 4.14's range [-90, 0).

    OpenCV 4.5.x returns angles in (0, 90] for the same rectangles. Each result is
    rewritten into the equivalent 4.14 form by value, so the function is a no-op on
    4.14 output and needs no version check (Chaquopy's 4.5.1 was not available to
    test against directly).
    """
    (cx, cy), (w, h), angle = cv2.minAreaRect(points)
    # Turn by quarter turns until the angle is in [-90, 0); each odd quarter
    # turn swaps width and height. E.g. 4.5.x (w, h, 45) -> (h, w, -45),
    # (w, h, 90) -> (w, h, -90) and a flat segment (w, 0, 180) -> (0, w, -90).
    turns = 0
    while angle >= 0.0:
        angle -= 90.0
        turns += 1
    while angle < -90.0:
        angle += 90.0
        turns += 1
    if turns % 2:
        w, h = h, w
    return (cx, cy), (w, h), angle
