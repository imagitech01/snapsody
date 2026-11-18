"""Build homr's segnet as a LiteRT model for the app (design D3).

Turns homr 0.7.1's segnet (fp16 ONNX, dynamic batch) into
``segnet_fp32_b1.tflite``: fp32 weights, fixed input 1x3x320x320 (NCHW in ONNX,
NHWC in TFLite), Resize sizes folded into constants, converted with onnx2tf.
These are the steps of the GPU pilot (see the archived photo-to-practice-mvp change, evidence/gpu-npu-pilot.md)
as one reproducible script.

    .venv-convert/bin/python -I tools/models/build_segnet.py \
        --onnx vendor/homr/segmentation/segnet_308-..._fp16.onnx --out build/models

After building, the equivalence check (segnet_equivalence.py) compares the
TFLite model with the original fp16 ONNX and the script fails below 99.9 %
symbol-pixel agreement. ``--check-only TFLITE`` runs just the check.

Nothing is downloaded: onnx2tf's test-image sample file is generated locally
(deterministic) and its download function is replaced with one that fails.
Pinned tool versions: tools/models/requirements.txt.
"""

from __future__ import annotations

import argparse
import contextlib
import hashlib
import os
import shutil
import sys
import tempfile
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
from onnx import TensorProto, helper, numpy_helper

# homr 0.7.1 segnet_308 (fp16). The build refuses any other input.
SEGNET_FP16_SHA256 = "60f495496cb41473c0521d0811d8f44b9d5cff892d287974a8aebb3eaee2fa83"
OUTPUT_NAME = "segnet_fp32_b1.tflite"
TILE = 320
F16, F32 = TensorProto.FLOAT16, TensorProto.FLOAT
SAMPLE_FILE = "calibration_image_sample_data_20x128x128x3_float32.npy"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def to_fp32_batch1(model: onnx.ModelProto) -> onnx.ModelProto:
    """fp16 -> fp32 everywhere, batch dimension fixed to 1 (from the GPU pilot)."""
    graph = model.graph
    for i, init in enumerate(graph.initializer):
        if init.data_type == F16:
            arr = numpy_helper.to_array(init).astype(np.float32)
            graph.initializer[i].CopyFrom(numpy_helper.from_array(arr, init.name))
    for info in list(graph.input) + list(graph.output) + list(graph.value_info):
        tensor_type = info.type.tensor_type
        if tensor_type.elem_type == F16:
            tensor_type.elem_type = F32
        if tensor_type.shape.dim and tensor_type.shape.dim[0].dim_param:
            tensor_type.shape.dim[0].ClearField("dim_param")
            tensor_type.shape.dim[0].dim_value = 1
    for node in graph.node:
        if node.op_type == "Cast":
            for attr in node.attribute:
                if attr.name == "to" and attr.i == F16:
                    attr.i = F32
        if node.op_type == "Constant":
            for attr in node.attribute:
                if attr.name == "value" and attr.t.data_type == F16:
                    arr = numpy_helper.to_array(attr.t).astype(np.float32)
                    attr.t.CopyFrom(numpy_helper.from_array(arr))
    onnx.checker.check_model(model)
    return model


def fold_resize_sizes(model: onnx.ModelProto) -> onnx.ModelProto:
    """Replace Resize 'sizes' computed at runtime with constants (from the GPU pilot).

    With the batch fixed, the sizes only depend on the input shape, so a zero
    input gives the same values as a real tile.
    """
    size_inputs = [n.input[3] for n in model.graph.node if n.op_type == "Resize"]
    probe = onnx.ModelProto()
    probe.CopyFrom(model)
    for name in size_inputs:
        probe.graph.output.append(helper.make_tensor_value_info(name, TensorProto.INT64, None))
    session = ort.InferenceSession(probe.SerializeToString(), providers=["CPUExecutionProvider"])
    zeros = np.zeros((1, 3, TILE, TILE), np.float32)
    values = session.run(size_inputs, {"input": zeros})
    for name, value in zip(size_inputs, values):
        model.graph.initializer.append(numpy_helper.from_array(value.astype(np.int64), name))
    produced = set(size_inputs)
    keep = [n for n in model.graph.node if not (set(n.output) & produced)]
    del model.graph.node[:]
    model.graph.node.extend(keep)
    while True:
        used = {i for n in model.graph.node for i in n.input} | {o.name for o in model.graph.output}
        keep = [n for n in model.graph.node if set(n.output) & used]
        if len(keep) == len(model.graph.node):
            break
        del model.graph.node[:]
        model.graph.node.extend(keep)
    used = {i for n in model.graph.node for i in n.input}
    inits = [i for i in model.graph.initializer if i.name in used]
    del model.graph.initializer[:]
    model.graph.initializer.extend(inits)
    onnx.checker.check_model(model)
    return model


@contextlib.contextmanager
def offline_onnx2tf(workdir: Path):
    """Supply onnx2tf's sample data locally and make any download attempt fail."""
    rng = np.random.default_rng(308)
    np.save(workdir / SAMPLE_FILE, rng.random((20, 128, 128, 3), dtype=np.float32))
    import onnx2tf.utils.common_functions as common

    def no_download(*args, **kwargs):  # pragma: no cover - only hit on a regression
        raise RuntimeError("onnx2tf tried to download data; the build must stay offline")

    original_get = common.requests.get
    common.requests.get = no_download
    cwd = os.getcwd()
    os.chdir(workdir)
    try:
        yield
    finally:
        os.chdir(cwd)
        common.requests.get = original_get


def convert(static_onnx: Path, workdir: Path) -> Path:
    import onnx2tf

    out_dir = workdir / "tflite"
    with offline_onnx2tf(workdir):
        onnx2tf.convert(
            input_onnx_file_path=str(static_onnx),
            output_folder_path=str(out_dir),
            non_verbose=True,
        )
    produced = out_dir / f"{static_onnx.stem}_float32.tflite"
    if not produced.exists():
        raise FileNotFoundError(f"onnx2tf did not write {produced}")
    return produced


def build(onnx_path: Path, out_dir: Path, keep_intermediate: bool = False) -> Path:
    digest = sha256(onnx_path)
    if digest != SEGNET_FP16_SHA256:
        raise SystemExit(f"unexpected segnet ONNX {onnx_path} (sha256 {digest}); expected homr 0.7.1")
    out_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="segnet_build_") as tmp:
        work = Path(tmp)
        model = fold_resize_sizes(to_fp32_batch1(onnx.load(onnx_path)))
        static_onnx = work / "segnet_fp32_b1_static.onnx"
        onnx.save(model, static_onnx)
        tflite = convert(static_onnx, work)
        target = out_dir / OUTPUT_NAME
        shutil.copyfile(tflite, target)
        if keep_intermediate:
            shutil.copyfile(static_onnx, out_dir / static_onnx.name)
    print(f"wrote {target} ({target.stat().st_size} bytes, sha256 {sha256(target)})")
    return target


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--onnx", type=Path, required=True, help="homr 0.7.1 segnet fp16 ONNX")
    parser.add_argument("--out", type=Path, default=Path("build/models"))
    parser.add_argument("--keep-intermediate", action="store_true", help="also keep the static fp32 ONNX")
    parser.add_argument("--check-only", type=Path, metavar="TFLITE", help="only run the equivalence check")
    parser.add_argument("--skip-check", action="store_true", help="build without the equivalence check")
    args = parser.parse_args()
    if args.check_only:
        tflite = args.check_only
    else:
        tflite = build(args.onnx, args.out, args.keep_intermediate)
        if args.skip_check:
            return 0
    sys.path.insert(0, str(Path(__file__).parent))
    from segnet_equivalence import run_checks

    if not run_checks(args.onnx, tflite):
        print("equivalence check FAILED")
        return 1
    print("equivalence check passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
