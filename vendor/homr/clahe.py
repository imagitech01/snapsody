"""Deterministic CLAHE, bit-identical to OpenCV 4.14's ``createCLAHE().apply()``
for 8-bit grayscale images.

instrument_assist patch (see vendor/PATCHES.md). OpenCV's CLAHE output depends on
how the compiler fused the float multiply-adds in the build: 4.10 and 4.14 differ
on about 0.01 % of pixels (ties at x.5) of homr's preprocessed page, which is also
the image the transformer's staff crops are cut from. Chaquopy ships OpenCV 4.5.1
for aarch64. This numpy version reproduces the arithmetic of the 4.14 build that
produced the Mac reference output, on any platform and OpenCV version. (Measured
on the book photo it makes the preprocessing stage identical; on its own it did
not change any recognised note.)

Fused multiply-add fma(p, q, r) is emulated as round_f32(p * q + r) in float64:
the product of two float32 values is exact in float64.
"""

import numpy as np

from homr.type_definitions import NDArray

_F32 = np.float32
_F64 = np.float64


def _fma(p: NDArray, q: NDArray, r: NDArray) -> NDArray:
    return (np.asarray(p, _F64) * np.asarray(q, _F64) + np.asarray(r, _F64)).astype(_F32)


def _tile_luts(src: NDArray, clip_limit: float, tiles_x: int, tiles_y: int) -> tuple[NDArray, int, int]:
    h, w = src.shape
    if w % tiles_x or h % tiles_y:
        # OpenCV quirk: once padding is needed, it pads *both* axes by
        # tiles - (size % tiles), which is a full extra tile on an axis that
        # already divides evenly.
        pad_y = tiles_y - h % tiles_y
        pad_x = tiles_x - w % tiles_x
        # numpy's "reflect" is OpenCV's BORDER_REFLECT_101
        src_lut = np.pad(src, ((0, pad_y), (0, pad_x)), mode="reflect")
    else:
        src_lut = src
    tile_h = src_lut.shape[0] // tiles_y
    tile_w = src_lut.shape[1] // tiles_x
    total = tile_h * tile_w
    lut_scale = _F32(255) / _F32(total)
    clip = max(int(clip_limit * total / 256), 1) if clip_limit > 0 else 0

    luts = np.empty((tiles_y * tiles_x, 256), np.uint8)
    for k in range(tiles_y * tiles_x):
        ty, tx = divmod(k, tiles_x)
        tile = src_lut[ty * tile_h : (ty + 1) * tile_h, tx * tile_w : (tx + 1) * tile_w]
        hist = np.bincount(tile.ravel(), minlength=256).astype(np.int64)
        if clip > 0:
            excess = hist - clip
            clipped = int(excess[excess > 0].sum())
            hist = np.minimum(hist, clip)
            batch, residual = divmod(clipped, 256)
            hist += batch
            if residual:
                step = max(256 // residual, 1)
                hist[np.arange(0, 256, step)[:residual]] += 1
        cumulative = np.cumsum(hist).astype(_F32)
        luts[k] = np.clip(np.rint(cumulative * lut_scale), 0, 255).astype(np.uint8)
    return luts, tile_h, tile_w


def _axis(n: int, tile: int, tiles: int) -> tuple[NDArray, NDArray, NDArray, NDArray]:
    inv = _F32(1) / _F32(tile)
    pos = _fma(np.arange(n, dtype=_F32), inv, _F32(-0.5))
    first = np.floor(pos).astype(np.int64)
    weight = (pos - first.astype(_F32)).astype(_F32)
    weight1 = (_F32(1) - weight).astype(_F32)
    return np.maximum(first, 0), np.minimum(first + 1, tiles - 1), weight, weight1


def apply_clahe_gray(
    src: NDArray, clip_limit: float = 1.0, tile_grid: tuple[int, int] = (8, 8)
) -> NDArray:
    if src.dtype != np.uint8 or src.ndim != 2:
        raise ValueError("apply_clahe_gray expects an 8-bit single-channel image")
    tiles_x, tiles_y = tile_grid
    luts, tile_h, tile_w = _tile_luts(src, clip_limit, tiles_x, tiles_y)
    h, w = src.shape
    tx1, tx2, xa, xa1 = _axis(w, tile_w, tiles_x)
    ty1, ty2, ya, ya1 = _axis(h, tile_h, tiles_y)
    values = src.astype(np.int64)
    xa, xa1 = xa[None, :], xa1[None, :]
    ya, ya1 = ya[:, None], ya1[:, None]

    def lut(ty: NDArray, tx: NDArray) -> NDArray:
        return luts[ty[:, None] * tiles_x + tx[None, :], values].astype(_F32)

    top = _fma(lut(ty1, tx1), xa1, (lut(ty1, tx2) * xa).astype(_F32))
    bottom = _fma(lut(ty2, tx1), xa1, (lut(ty2, tx2) * xa).astype(_F32))
    result = _fma(top, ya1, (bottom * ya).astype(_F32))
    return np.clip(np.rint(result), 0, 255).astype(np.uint8)
