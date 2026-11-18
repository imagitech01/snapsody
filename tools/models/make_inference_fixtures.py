"""The page image for the device smoke test (EndToEndSmokeTest, openspec test-pyramid T7).

Writes android/app/src/androidTest/assets/fixtures/engraved_page.png: the whole self-engraved page
(tools/models/engrave.py), so no copyrighted material is involved. The model-level fixtures this
script used to write (segnet tiles, staff input, encoder and decoder references) were read only by
the instrumented model tests, which the test-pyramid change deleted; see git history.

disable_accelerators() and replica_decode() stay here for tools/homr/mac_backend_check.py.

    .venv-convert/bin/python -I tools/models/make_inference_fixtures.py
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parents[2]
OUT = REPO / "android" / "app" / "src" / "androidTest" / "assets" / "fixtures"
sys.path.insert(0, str(REPO / "vendor"))
sys.path.insert(0, str(Path(__file__).parent))


def disable_accelerators() -> None:
    import importlib

    import homr.onnx_providers as providers

    names = ("coreml_available", "cuda_available", "rocm_available")
    for name in names:
        setattr(providers, name, lambda: False)
    for module in ("homr.main", "homr.segmentation.inference_segnet"):
        loaded = importlib.import_module(module)
        for name in names:
            if hasattr(loaded, name):
                setattr(loaded, name, lambda: False)


def replica_decode(decoder, context: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """homr's ScoreDecoder.generate, recording token ids and attention."""
    tokens, attention = [], []
    last = {"rhythms": 1, "pitchs": 0, "lifts": 0, "articulations": 0, "slurs": 0}
    cache, kv_in, kv_out = decoder.init_cache()
    reduced = context[:, :1]
    heads = ["out_rhythms", "out_pitchs", "out_lifts", "out_positions", "out_articulations", "out_slurs", "attention"]
    for step in range(decoder.max_seq_len):
        feeds = {k: np.array([[v]], dtype=np.int64) for k, v in last.items()}
        feeds["context"] = context if step == 0 else reduced
        feeds["cache_len"] = np.array([step], dtype=np.int64)
        for name, value in zip(kv_in, cache):
            feeds[name] = value.numpy()
        outputs = decoder.net.run(heads + kv_out, feeds)
        ids = [int(outputs[i][:, -1, :].argmax()) for i in range(6)]
        if ids[0] == decoder.eos_token:
            break
        import onnxruntime as ort

        cache = [ort.OrtValue.ortvalue_from_numpy(o) for o in outputs[7:]]
        tokens.append(ids)
        attention.append(np.asarray(outputs[6], dtype=np.float32).reshape(-1))
        last = {"rhythms": ids[0], "pitchs": ids[1], "lifts": ids[2], "articulations": ids[4], "slurs": ids[5]}
    return np.asarray(tokens, dtype=np.int32), np.asarray(attention, dtype=np.float32)


def main() -> int:
    import cv2

    from engrave import engraved_page

    OUT.mkdir(parents=True, exist_ok=True)
    # Earlier versions also wrote model fixtures here; remove them so only the smoke test's input is bundled.
    for stale in ("segnet_tiles.f32", "segnet_ref_cpu.u8", "staff_input.f32", "encoder_output.f32",
                  "decoder_tokens.i32", "decoder_attention.f32", "fixtures.json"):
        (OUT / stale).unlink(missing_ok=True)
    cv2.imwrite(str(OUT / "engraved_page.png"), cv2.cvtColor(engraved_page(), cv2.COLOR_GRAY2BGR))
    print(f"wrote {OUT / 'engraved_page.png'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
