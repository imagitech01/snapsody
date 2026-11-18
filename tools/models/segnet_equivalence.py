"""Equivalence check: segnet TFLite vs homr's original fp16 ONNX (task 2.2).

Both models run on a 12-tile grid (3 rows x 4 columns of 320x320 tiles spread
over the page). The page is preprocessed exactly like homr does before segnet:
autocrop, resize to 1920 px wide, CLAHE, grey to 3-channel, values 0..255.

Metric, symbol-pixel agreement: among pixels where either model's argmax is a
symbol class (anything but background, class 0), the fraction where both
argmaxes agree. The check fails below 99.9 %.

Pages:
- the self-engraved page (tools/models/engrave.py): always
- the book photo in fixtures/local/: when present, otherwise skipped with a message
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parents[2]
BOOK_PHOTO = REPO / "fixtures" / "local" / "20261111_1701026728888866947001497.jpg"
THRESHOLD = 0.999
TILE = 320
GRID = (3, 4)  # rows, columns


def _homr():
    vendor = str(REPO / "vendor")
    if vendor not in sys.path:
        sys.path.insert(0, vendor)
    from homr.autocrop import autocrop_with_offset
    from homr.color_adjust import apply_clahe
    from homr.resize import resize_image

    return autocrop_with_offset, resize_image, apply_clahe


def preprocess_bgr(image_bgr: np.ndarray) -> np.ndarray:
    """homr's pre-segnet pipeline; returns the grey page segnet sees."""
    autocrop_with_offset, resize_image, apply_clahe = _homr()
    image, _ = autocrop_with_offset(image_bgr)
    return apply_clahe(resize_image(image))


def grid_tiles(gray: np.ndarray, grid: tuple[int, int] = GRID) -> np.ndarray:
    """Tiles as N x 3 x 320 x 320 float32 (NCHW, 0..255), like homr's extract_patch."""
    h, w = gray.shape
    if h < TILE or w < TILE:
        raise ValueError(f"page {w}x{h} is smaller than one tile")
    ys = np.linspace(0, h - TILE, grid[0]).round().astype(int)
    xs = np.linspace(0, w - TILE, grid[1]).round().astype(int)
    tiles = [gray[y : y + TILE, x : x + TILE] for y in ys for x in xs]
    stacked = np.stack(tiles).astype(np.float32)
    return np.repeat(stacked[:, None], 3, axis=1)


def run_onnx_fp16(onnx_path: Path, tiles: np.ndarray) -> np.ndarray:
    import onnxruntime as ort

    session = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    out = [session.run(None, {"input": t[None].astype(np.float16)})[0] for t in tiles]
    return np.concatenate(out).astype(np.float32).argmax(axis=1)  # N x H x W


def run_tflite(tflite_path: Path, tiles: np.ndarray) -> np.ndarray:
    from ai_edge_litert.interpreter import Interpreter

    interpreter = Interpreter(model_path=str(tflite_path))
    interpreter.allocate_tensors()
    inp = interpreter.get_input_details()[0]["index"]
    outp = interpreter.get_output_details()[0]["index"]
    results = []
    for tile in tiles:
        interpreter.set_tensor(inp, tile.transpose(1, 2, 0)[None].copy())
        interpreter.invoke()
        results.append(interpreter.get_tensor(outp)[0].argmax(axis=-1))  # NHWC
    return np.stack(results)


def symbol_pixel_agreement(reference: np.ndarray, candidate: np.ndarray) -> tuple[float, int]:
    symbol = (reference != 0) | (candidate != 0)
    count = int(symbol.sum())
    if count == 0:
        raise ValueError("no symbol pixels in the test tiles")
    return float((reference[symbol] == candidate[symbol]).mean()), count


def check_page(name: str, gray: np.ndarray, onnx_path: Path, tflite_path: Path) -> bool:
    tiles = grid_tiles(gray)
    agreement, count = symbol_pixel_agreement(run_onnx_fp16(onnx_path, tiles), run_tflite(tflite_path, tiles))
    ok = agreement >= THRESHOLD
    print(
        f"  {name}: {len(tiles)} tiles, {count} symbol pixels, agreement {agreement * 100:.3f} % "
        f"({'PASS' if ok else 'FAIL'}, threshold {THRESHOLD * 100:.1f} %)"
    )
    return ok


def run_checks(onnx_path: Path, tflite_path: Path) -> bool:
    import cv2

    from engrave import engraved_page  # tools/models/engrave.py

    print(f"segnet equivalence: {tflite_path.name} vs {onnx_path.name}")
    engraved = cv2.cvtColor(engraved_page(), cv2.COLOR_GRAY2BGR)
    ok = check_page("self-engraved page", preprocess_bgr(engraved), onnx_path, tflite_path)
    if BOOK_PHOTO.exists():
        photo = cv2.imread(str(BOOK_PHOTO))
        ok = check_page("book photo (fixtures/local)", preprocess_bgr(photo), onnx_path, tflite_path) and ok
    else:
        print(f"  book photo: SKIPPED ({BOOK_PHOTO} not present; local-only fixture)")
    return ok
