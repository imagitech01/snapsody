"""Download homr 0.7.1's model files into vendor/homr/ (the first step of `make models`).

The app needs three of homr's ONNX models: segnet (fp16, converted to LiteRT by
build_segnet.py) and the transformer encoder and decoder (fp32, packaged as they are).
They are not committed. This fetches them from homr's own GitHub release, the same place
homr downloads them from on its first run, and checks each file against the SHA-256 in
pinned_hashes.json. A file that is already there with the right hash is kept, so the
script is safe to rerun.

Standard library only, so it runs with any Python 3.10+:

    python3 -I tools/models/fetch_models.py [--homr vendor/homr]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
PINNED = REPO / "tools" / "models" / "pinned_hashes.json"
RELEASE = "https://github.com/liebharc/homr/releases/download/onnx_checkpoints/"
SEGNET = "segnet_308-3296ccd40960f90ca6ab9c035cca945675d30a0f"
TRANSFORMER = "pytorch_model_509-2293bba14bfea47d9d28411339362af15fce4c31"
# role in pinned_hashes.json -> path inside vendor/homr/. Each file comes in a zip of the
# same name on the release (homr's download_weights in vendor/homr/main.py).
MODELS = {
    "segnet_fp16": f"segmentation/{SEGNET}_fp16.onnx",
    "encoder": f"transformer/encoder_{TRANSFORMER}.onnx",
    "decoder": f"transformer/decoder_{TRANSFORMER}.onnx",
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def fetch(name: str, target: Path, expected: str) -> None:
    url = RELEASE + Path(name).stem + ".zip"
    print(f"downloading {url}", flush=True)
    with tempfile.TemporaryDirectory(prefix="homr_models_", dir=target.parent) as tmp:
        archive = Path(tmp) / "model.zip"
        request = urllib.request.Request(url, headers={"User-Agent": "snapsody-fetch-models"})
        with urllib.request.urlopen(request, timeout=60) as response, open(archive, "wb") as out:
            shutil.copyfileobj(response, out, 1 << 20)
        with zipfile.ZipFile(archive) as zf:
            # Extract only the expected member, by name, never a path from the archive.
            members = [m for m in zf.namelist() if Path(m).name == Path(name).name]
            if len(members) != 1:
                raise SystemExit(f"{url}: expected one {Path(name).name}, found {zf.namelist()}")
            extracted = Path(tmp) / "model.onnx"
            with zf.open(members[0]) as src, open(extracted, "wb") as out:
                shutil.copyfileobj(src, out, 1 << 20)
        digest = sha256(extracted)
        if digest != expected:
            raise SystemExit(f"{url}: {Path(name).name} has sha256 {digest}, expected {expected}")
        if target.is_symlink() or target.exists():
            target.unlink()  # a wrong file or a link to one; a link's own target is left alone
        extracted.replace(target)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--homr", type=Path, default=REPO / "vendor" / "homr")
    args = parser.parse_args()

    pinned = json.loads(PINNED.read_text())
    for role, name in MODELS.items():
        target = args.homr / name
        if target.exists() and sha256(target) == pinned[role]:
            print(f"{role:11s} {target.name} is up to date")
            continue
        if target.exists():
            print(f"{role:11s} {target.name} has the wrong hash; downloading it again")
        fetch(name, target, pinned[role])
        print(f"{role:11s} {target.name} ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
