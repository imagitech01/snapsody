"""Python side of the recognition engine (homr in Chaquopy, design D3).

Model inference is not done here: homr's model calls go through homr._backend to the
Kotlin InferenceService (KotlinBackend below).
"""

from __future__ import annotations

import json
import os
import platform
import sys
import time

import numpy as np

TILE = 320

# White margin added around a selected region before recognition, as a fraction of its
# width (left/right) and height (top/bottom). homr misreads staves that touch the image
# edge: on the exercise-87 crop bar 15 lost its triplets without padding, in every crop
# tried; with padding it was read correctly in all 11 variants (openspec/changes/archive/2026-11-18-photo-to-practice-mvp/evidence/gate-results.md).
PAD_X = 0.05
PAD_Y = 0.12


def pad_for_recognition(source_path: str, target_path: str) -> tuple[int, int, int, int]:
    """Writes the image with a white margin to target_path (PNG, lossless) and returns
    the (x, y) offset of the original image inside the padded one and the original's
    (width, height)."""
    import cv2

    image = cv2.imread(source_path)
    if image is None:
        raise ValueError("cannot read image " + source_path)
    height, width = image.shape[:2]
    pad_x, pad_y = int(width * PAD_X), int(height * PAD_Y)
    padded = cv2.copyMakeBorder(
        image, pad_y, pad_y, pad_x, pad_x, cv2.BORDER_CONSTANT, value=(255, 255, 255)
    )
    if not cv2.imwrite(target_path, padded):
        raise OSError("cannot write " + target_path)
    return pad_x, pad_y, width, height


def staves_in_source(staves: "list[dict] | None", offset: tuple[int, int], size: tuple[int, int]) -> "list[dict] | None":
    """The staves homr reports (homr.page_layout: boxes in pixels of the image it read, which
    is the padded one) with their boxes as fractions of the source image (design D7):
    {"box": {"x", "y", "width", "height"}, "firstBar", "lastBar"}, bars numbered from 1 on
    the page. A box is cut to the source image (it may reach into the margin by a pixel of
    rounding). None when there are none, or when a box lies outside the source image."""
    if not staves:
        return None
    offset_x, offset_y = offset
    width, height = size
    result = []
    for staff in staves:
        x, y, box_width, box_height = staff["box"]
        left, top = max(x - offset_x, 0.0), max(y - offset_y, 0.0)
        right, bottom = min(x + box_width - offset_x, width), min(y + box_height - offset_y, height)
        if right <= left or bottom <= top:
            return None
        box = {
            "x": round(left / width, 4),
            "y": round(top / height, 4),
            "width": round((right - left) / width, 4),
            "height": round((bottom - top) / height, 4),
        }
        result.append({"box": box, "firstBar": staff["firstBar"], "lastBar": staff["lastBar"]})
    return result


class KotlinBackend:
    """homr._backend.ModelBackend implemented by be.imagitech.snapsody.inference.InferenceService."""

    def __init__(self, service, accelerator: str = "GPU", progress: "Progress | None" = None) -> None:
        self.service = service
        self.accelerator = accelerator
        self.progress = progress
        self.timings = {"segnet": 0.0, "encoder": 0.0, "decoder": 0.0}
        self.counts = {"segnet_tiles": 0, "staves": 0}

    def segnet_argmax(self, batch_nchw: np.ndarray) -> list[np.ndarray]:
        started = time.perf_counter()
        count = len(batch_nchw)
        nhwc = np.ascontiguousarray(batch_nchw.transpose(0, 2, 3, 1), dtype="<f4")
        classes = self.service.segnetArgmaxBytes(nhwc.tobytes(), count, self.accelerator)
        result = np.frombuffer(bytes(classes), dtype=np.uint8).reshape(count, TILE, TILE)
        self.timings["segnet"] += time.perf_counter() - started
        self.counts["segnet_tiles"] += count
        if self.progress is not None:
            self.progress.tiles_done(count)
        # homr's own np.argmax yields int64; keep the dtype so merge_patches behaves identically
        return list(result.astype(np.int64))

    def encode(self, x: np.ndarray):
        started = time.perf_counter()
        encoded = self.service.encodeBytes(np.ascontiguousarray(x, dtype="<f4").tobytes())
        self.timings["encoder"] += time.perf_counter() - started
        return encoded

    def decode(self, encoded) -> tuple[np.ndarray, np.ndarray]:
        started = time.perf_counter()
        try:
            decoded = self.service.decode(encoded)
        finally:
            encoded.close()
        tokens = np.array(decoded.getTokens(), dtype=np.int64).reshape(-1, 6)
        attention = np.array(decoded.getAttention(), dtype=np.float32).reshape(-1, 2)
        self.timings["decoder"] += time.perf_counter() - started
        self.counts["staves"] += 1
        if self.progress is not None:
            self.progress.staff_done()
        return tokens, attention


def install_backend(service, accelerator: str = "GPU", progress: "Progress | None" = None) -> KotlinBackend:
    from homr import _backend

    backend = KotlinBackend(service, accelerator, progress)
    _backend.set_backend(backend)
    import homr.segmentation.inference_segnet as segmentation

    segmentation._segnet_inference = None
    return backend


# ---- recognition job (design D5, tasks 5.1-5.3) ---------------------------------------------


class NoMusicFound(Exception):
    """homr found no staff (or no noteheads or clefs) in the image."""


class Cancelled(Exception):
    """The user cancelled the recognition."""


# homr 0.7.1 raises plain Exceptions with these messages when the image holds no music
# (checked on self-made plain-text and blank images).
NO_MUSIC_MESSAGES = ("No staffs found", "No noteheads or clefs found")

# Overall progress (0..1) at the start of each stage; segment and read advance within theirs.
STAGES = {"prepare": 0.02, "segment": 0.05, "detect": 0.42, "read": 0.47, "write": 0.97}


class Progress:
    """Reports progress to a Kotlin listener (be.imagitech.snapsody.reader.ProgressListener)
    and checks for cancellation at every report."""

    def __init__(self, listener) -> None:
        self.listener = listener
        self.tiles = 0
        self.tiles_total = 0
        self.staves = 0
        self.staves_total = 0

    def report(self, stage: str, fraction: float, **detail) -> None:
        if self.listener is None:
            return
        if self.listener.isCancelled():
            raise Cancelled()
        self.listener.progress(stage, float(min(max(fraction, 0.0), 1.0)), json.dumps(detail))

    def stage(self, stage: str) -> None:
        self.report(stage, STAGES[stage])

    def start_segment(self, total: int) -> None:
        self.tiles, self.tiles_total = 0, total
        self.report("segment", STAGES["segment"], tile=0, tiles=total)

    def tiles_done(self, count: int) -> None:
        self.tiles += count
        total = max(self.tiles_total, self.tiles)
        span = STAGES["detect"] - STAGES["segment"]
        self.report("segment", STAGES["segment"] + span * self.tiles / total, tile=self.tiles, tiles=total)

    def start_read(self, total: int) -> None:
        self.staves, self.staves_total = 0, total
        self.report("read", STAGES["read"], staff=0, staves=total)

    def staff_done(self) -> None:
        self.staves += 1
        total = max(self.staves_total, self.staves)
        span = STAGES["write"] - STAGES["read"]
        self.report("read", STAGES["read"] + span * self.staves / total, staff=self.staves, staves=total)


def recognise(service, image_path: str, accelerator: str, out_dir: str, pad: bool = True, listener=None) -> dict:
    """Runs homr on one image with the Kotlin backend; the MusicXML is written to out_dir.

    With pad (default) the image first gets the white recognition margin. Progress and
    cancellation go through listener (may be None). Raises NoMusicFound or Cancelled.
    Returns a report with per-stage timings (seconds) and what ran on which accelerator.
    """
    import shutil

    import homr.main as homr_main
    import homr.segmentation.inference_segnet as segnet_module
    from homr.debug import Debug
    from homr.main import ProcessingConfig, process_image
    from homr.music_xml_generator import XmlGeneratorArguments
    from homr.page_layout import PageLayout

    progress = Progress(listener)
    progress.stage("prepare")
    backend = install_backend(service, accelerator, progress)
    tiles_before = {a: service.segnetTileCount(a) for a in ("GPU", "CPU")}
    os.makedirs(out_dir, exist_ok=True)
    stem = os.path.splitext(os.path.basename(image_path))[0]
    if pad:
        work_image = os.path.join(out_dir, stem + ".png")
        offset_x, offset_y, width, height = pad_for_recognition(image_path, work_image)
    else:
        import cv2

        work_image = os.path.join(out_dir, os.path.basename(image_path))
        shutil.copyfile(image_path, work_image)
        offset_x, offset_y = 0, 0
        height, width = cv2.imread(image_path).shape[:2]

    xml_seconds = [0.0]
    originals = {
        "inference": segnet_module.inference,
        "detect_staffs_in_image": homr_main.detect_staffs_in_image,
        "parse_staffs": homr_main.parse_staffs,
        "generate_xml": homr_main.generate_xml,
        "write_teaser": Debug.write_teaser,
    }

    def inference(image_org, use_gpu_inference, batch_size, step_size, win_size):
        step = step_size if step_size > 0 else win_size // 2
        height, width = image_org.shape[:2]
        total = len(range(0, max(height, win_size), step)) * len(range(0, max(width, win_size), step))
        progress.start_segment(total)
        result = originals["inference"](image_org, use_gpu_inference, batch_size, step_size, win_size)
        progress.stage("detect")
        return result

    def detect_staffs_in_image(*args, **kwargs):
        try:
            return originals["detect_staffs_in_image"](*args, **kwargs)
        except Exception as e:  # homr signals "no music" with plain Exceptions
            if type(e) is Exception and str(e) in NO_MUSIC_MESSAGES:
                raise NoMusicFound(str(e)) from e
            raise

    def parse_staffs(debug, staffs, *args, **kwargs):
        progress.start_read(sum(len(row.staffs) for row in staffs))
        return originals["parse_staffs"](debug, staffs, *args, **kwargs)

    def generate_xml(*args, **kwargs):
        progress.stage("write")
        started = time.perf_counter()
        try:
            return originals["generate_xml"](*args, **kwargs)
        finally:
            xml_seconds[0] += time.perf_counter() - started

    segnet_module.inference = inference
    homr_main.detect_staffs_in_image = detect_staffs_in_image
    homr_main.parse_staffs = parse_staffs
    homr_main.generate_xml = generate_xml
    Debug.write_teaser = lambda self, *args, **kwargs: None  # preview image: not needed in the app
    started = time.perf_counter()
    try:
        config = ProcessingConfig(False, False, False, False, -1, False, False, False, False)
        layout = PageLayout()
        xml_path = process_image(work_image, config, XmlGeneratorArguments(False, None, None), layout)
    finally:
        segnet_module.inference = originals["inference"]
        homr_main.detect_staffs_in_image = originals["detect_staffs_in_image"]
        homr_main.parse_staffs = originals["parse_staffs"]
        homr_main.generate_xml = originals["generate_xml"]
        Debug.write_teaser = originals["write_teaser"]
    total = time.perf_counter() - started
    with open(xml_path, encoding="utf-8") as f:
        if "<pitch>" not in f.read():
            raise NoMusicFound("no notes recognised")
    t = backend.timings
    return {
        "image": os.path.basename(image_path),
        "accelerator": accelerator,
        "padded": pad,
        "musicxml": xml_path,
        # Where the staves are and whether the time signature was estimated (design D7),
        # next to the MusicXML, which they don't change.
        "staves": staves_in_source(layout.staves(), (offset_x, offset_y), (width, height)),
        "timeEstimated": layout.time_estimated,
        "seconds": {
            "total": total,
            "segnet": t["segnet"],
            "encoder": t["encoder"],
            "decoder": t["decoder"],
            "musicxml": xml_seconds[0],
            "staff_processing": total - t["segnet"] - t["encoder"] - t["decoder"] - xml_seconds[0],
        },
        "counts": backend.counts,
        # What actually ran: a GPU request falls back to the CPU on any GPU error (task 4.4).
        "segnet_tiles_by_accelerator": {a: service.segnetTileCount(a) - n for a, n in tiles_before.items()},
        "gpu_failure": service.gpuFailureMessage(),
    }


def run_job(service, image_path: str, accelerator: str, out_dir: str, listener) -> str:
    """Entry point of the Kotlin recognition job. Returns JSON with "status": "ok" (with the
    report), "no_music" or "cancelled". Any other error propagates to Kotlin."""
    try:
        report = recognise(service, image_path, accelerator, out_dir, True, listener)
        return json.dumps({"status": "ok", "report": report})
    except NoMusicFound as e:
        return json.dumps({"status": "no_music", "message": str(e)})
    except Cancelled:
        return json.dumps({"status": "cancelled"})


def selftest() -> str:
    """Imports homr and its native dependencies; returns a one-line report."""
    started = time.perf_counter()
    import cv2
    import PIL

    import homr
    import homr.main  # noqa: F401  (pulls in every processing module)
    from homr._ort import ort

    elapsed = time.perf_counter() - started
    return (
        f"python {platform.python_version()} ({sys.implementation.name}), numpy {np.__version__}, "
        f"opencv {cv2.__version__}, pillow {PIL.__version__}, homr imported from {homr.__file__} "
        f"(onnxruntime: {'absent' if ort is None else ort.__version__}), import took {elapsed:.2f} s"
    )
