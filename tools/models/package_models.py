"""Package the recognition models into the Android app's assets (task 2.3).

Copies segnet (LiteRT, built by build_segnet.py) and homr 0.7.1's transformer
encoder/decoder (fp32 ONNX, the files homr uses on the CPU) into
android/model-assets/models/ and writes models.json with their SHA-256 hashes.
It also packages the accelerator self-test tile and its CPU reference output
(make_selftest_tile.py, task 4.1), which must belong to the same segnet build.
That directory is git-ignored; the Gradle build adds it as an assets source
and fails without it. The hashes also key the accelerator self-test (task 4.2).

    python3 tools/models/package_models.py \
        [--segnet build/models/segnet_fp32_b1.tflite] [--homr vendor/homr] [--selftest build/models]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
TRANSFORMER = "pytorch_model_509-2293bba14bfea47d9d28411339362af15fce4c31"
# Pinned hashes: homr 0.7.1 release files and the segnet build output.
PINNED = REPO / "tools" / "models" / "pinned_hashes.json"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--segnet", type=Path, default=REPO / "build" / "models" / "segnet_fp32_b1.tflite")
    parser.add_argument("--homr", type=Path, default=REPO / "vendor" / "homr")
    parser.add_argument("--selftest", type=Path, default=REPO / "build" / "models")
    parser.add_argument("--out", type=Path, default=REPO / "android" / "model-assets" / "models")
    args = parser.parse_args()

    pinned = json.loads(PINNED.read_text())
    sources = {
        "segnet": args.segnet,
        "encoder": args.homr / "transformer" / f"encoder_{TRANSFORMER}.onnx",
        "decoder": args.homr / "transformer" / f"decoder_{TRANSFORMER}.onnx",
    }
    selftest_info_path = args.selftest / "selftest.json"
    if not selftest_info_path.exists():
        print(f"missing {selftest_info_path}; run make_selftest_tile.py first", file=sys.stderr)
        return 1
    selftest_info = json.loads(selftest_info_path.read_text())
    if selftest_info["segnet_sha256"] != pinned["segnet"]:
        print("the self-test reference was made with another segnet build; rerun make_selftest_tile.py", file=sys.stderr)
        return 1
    sources["selftest_tile"] = args.selftest / "selftest_tile.u8"
    sources["selftest_reference"] = args.selftest / "selftest_ref_cpu.u8"
    args.out.mkdir(parents=True, exist_ok=True)
    entries = []
    for role, src in sources.items():
        if not src.exists():
            print(f"missing {role} model: {src}", file=sys.stderr)
            return 1
        digest = sha256(src)
        if role in pinned and digest != pinned[role]:
            print(f"{role}: {src.name} has sha256 {digest}, expected {pinned[role]}", file=sys.stderr)
            return 1
        target = args.out / src.name
        shutil.copyfile(src, target)
        entries.append({"role": role, "file": src.name, "bytes": target.stat().st_size, "sha256": digest})
        print(f"{role:8s} {src.name} {target.stat().st_size} bytes {digest[:12]}…")
    for stale in args.out.iterdir():
        if stale.name != "models.json" and stale.name not in {e["file"] for e in entries}:
            stale.unlink()
    manifest = {
        "homr": "0.7.1",
        "models": entries,
        "selftest": {
            "tile_size": selftest_info["tile_size"],
            "symbol_pixels": selftest_info["symbol_pixels"],
            "source": selftest_info["source"],
        },
    }
    (args.out / "models.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"wrote {args.out / 'models.json'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
