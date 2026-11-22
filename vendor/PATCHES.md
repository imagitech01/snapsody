# Vendored homr: patch log

`vendor/homr/` is homr **0.7.1** (AGPL-3.0, licence in `vendor/homr-licenses/`), copied
from the PyPI wheel. The original line endings (a mix of CRLF and LF) are kept so that a
diff against the wheel shows only our changes.

**Not committed:**
- the three ONNX model files. They are git-ignored; `tools/models/` packages them into
  the app.
- ONNX Runtime's CoreML compile caches.

For a Mac run, link the models from an installed homr 0.7.1 into
`vendor/homr/segmentation/` and `vendor/homr/transformer/`.

**Reproducing the diff:**

```sh
diff -ru --exclude=__pycache__ --exclude='*.onnx' --exclude='*.coreml_cache' \
  <site-packages>/homr vendor/homr
```

Every changed line is marked `patched (instrument_assist)` or `# patched:`.

## Target versions

Chaquopy offers Python 3.10 with numpy 1.26.2 and opencv-python 4.5.1. homr 0.7.1
declares Python ≥3.11, numpy ≥2.4 and OpenCV ≥4.13. The pins are relaxed by not
installing homr's own metadata.

## Patches

| # | File(s) | Change | Why |
|---|---------|--------|-----|
| 1 | `_cv2_typing.py` (new); `bounding_boxes.py`, `note_detection.py`, `staff_detection.py` | Import `cvt` from a shim that falls back to `Any` aliases | `cv2.typing` only exists from OpenCV 4.8. homr uses it only in annotations. |
| 2 | `main.py` | `render_pdf_to_image`, `detect_title` and `download_ocr_weights` become lazy wrappers | PDF input (pypdfium2) and title detection (RapidOCR) are disabled on Android (design D3), so homr must import without those packages. The CLI behaves as before. |
| 3 | `clahe.py` (new); `color_adjust.py` | Replace `cv2.createCLAHE(...).apply` with a numpy CLAHE that is bit-identical to OpenCV 4.14 | OpenCV's CLAHE output depends on how the build fused float multiply-adds. On a 121-case check, 4.5.4 differs from 4.14 on 107 cases. This makes the preprocessed page identical on every OpenCV version and platform. Verified with `tools/homr/check_clahe.py` (0 mismatches against 4.14). |
| 4 | `_cv2_compat.py` (new); `bounding_boxes.py` (5 calls), `staff_detection.py` (1 call) | `cv2.minAreaRect` → `min_area_rect`, which rewrites the angle into 4.14's range [-90, 0) | OpenCV 4.5.x reports the same rectangles with angles in (0, 90], with width and height swapped. The rewrite works by value (no-op on 4.14), because Chaquopy's 4.5.1 could not be tested directly. |
| 5 | `_ort.py` (new); `main.py`, `onnx_providers.py`, `segmentation/inference_segnet.py`, `transformer/encoder_inference.py`, `transformer/decoder_inference.py` | `import onnxruntime as ort` → `from homr._ort import ort`, which is `None` when onnxruntime is missing. The GPU-availability checks return False without it, one runtime annotation becomes a string, and `download_utils` (requests) is imported only when downloading models. | Android has no onnxruntime Python package or network access. There, inference runs in Kotlin (task 3.4). On the Mac nothing changes: the MusicXML is byte-identical before and after this patch. |

| 6 | `_backend.py` (new); `segmentation/inference_segnet.py`, `transformer/staff2score.py` | A pluggable model backend. When one is registered, `inference()` sends each tile batch to `backend.segnet_argmax` (argmax computed natively, returned as int64 like `np.argmax`). `Staff2Score` skips its ONNX sessions, and `predict()` decodes via `backend.encode`/`backend.decode` (token ids), then homr's own `detokenize` into `EncodedSymbol`s. | On Android the models run in Kotlin (`InferenceService`, design D3). With no backend nothing changes. Verified on the Mac with an onnxruntime backend (`tools/homr/mac_backend_check.py`): the MusicXML is byte-identical with and without it. |
| 7 | `staff_parsing.py` | `cv2.resize(image, canvas_size)` gets `tuple(int(v) for v in canvas_size)` instead of a numpy array | OpenCV 4.5.1 on a Galaxy S24 raises "new style getargs format but argument is not a tuple" for an array `dsize`. Newer OpenCV accepts both, so the result is the same. |
| 8 | `page_layout.py` (new); `main.py`, `staff_parsing.py`, `music_xml_generator.py` | Staff positions and the time-signature flag (practice-app design D7). `process_image` takes an optional `PageLayout` and fills it: `parse_staffs(page_layout=)` records the box of each system that gives the first voice symbols, in reading order, in pixels of the input image (through `page_to_input_image`; the union of the system's staffs, staff lines only), at the moment it appends the voice's `newline`; `generate_xml(layout)` → `build_part` → `build_measures` records, for the first part only, the measures written at each `newline` (the last system takes what is still open at the end) and sets `time_estimated` where it writes its n/4 estimate because the first measure has no `<time>`. `PageLayout.staves()` numbers the bars per system from 1, or gives None when there is not one count per box or a system has no measure of its own. Nothing reaches the MusicXML. | The app shows the photo of the staff that holds a bar, and treats an estimated time at a page start as absent (`core/pages`). Without a layout nothing changes. Verified on the Mac (`openspec/changes/archive/2026-11-18-practice-app/evidence/staff-positions.md`): `tools/homr/run_homr.py` gives byte-identical MusicXML before and after the patch, with and without `--layout`, for the self-engraved pages and the local reference photos, and the app-path readings of the two-page fixture are unchanged. |

On a Galaxy S24 (task 3.2), `import homr.main` succeeds under Chaquopy with Python 3.10.22,
numpy 1.26.2, OpenCV 4.5.1 and Pillow 11.0.0. Title detection (rapidocr) and PDF input
(pypdfium2) are not installed there, so both are disabled.

## Known remaining differences (OpenCV 4.5.x vs 4.14)

Measured on the book photo with the patches above. See `openspec/changes/archive/2026-11-18-photo-to-practice-mvp/evidence/gate-results.md`, section
"3.1 Python-version path".

- **`minAreaRect`:** sub-pixel float noise (< 0.01 px), plus one tie where two different
  rectangles have the same minimal area.
- **`fitEllipse`:** 4.14 handles thin and degenerate contours where 4.5.x returns
  `nan`/`inf`. The noteheads affected on this page are removed by homr's size filter
  in both versions.
- **Staff dewarping:** the span points differ. The transformer input is bit-identical
  for staves 0–2 (exercise 87, bars 1–19) but differs for staves 3–5, which changes a few
  notes and a dynamic from bar 25 on.
