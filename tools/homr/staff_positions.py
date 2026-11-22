"""The staff positions and the time-signature flag the app's Reader reports for a page (practice-app
design D7, task 10.4), made on a Mac the way the job makes them.

Each image gets the white recognition margin (ia_engine.pad_for_recognition), then homr runs with the
app's ProcessingConfig on the CPU and fills a homr.page_layout.PageLayout, and ia_engine.staves_in_source
turns its boxes into fractions of the source image. Prints one JSON object per image: the staves (boxes
as fractions, bars numbered from 1 on the page), timeEstimated, homr's pixel layout, and the SHA-256 of
the MusicXML. With --overlay DIR, also writes <image>.staves.jpg there with the boxes drawn on the image.

Run it in .venv-py310 with the models linked into vendor/homr (see vendor/PATCHES.md):

    .venv-py310/bin/python -I tools/homr/staff_positions.py [--overlay DIR] image...
"""

from __future__ import annotations

import dataclasses
import hashlib
import json
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "vendor"))
sys.path.insert(0, str(REPO / "tools" / "models"))
sys.path.insert(0, str(REPO / "android" / "app" / "src" / "main" / "python"))

from make_inference_fixtures import disable_accelerators  # noqa: E402

disable_accelerators()
from homr.main import ProcessingConfig, process_image  # noqa: E402
from homr.music_xml_generator import XmlGeneratorArguments  # noqa: E402
from homr.page_layout import PageLayout  # noqa: E402
from ia_engine import pad_for_recognition, staves_in_source  # noqa: E402


def read(image: Path) -> dict:
    with tempfile.TemporaryDirectory() as work:
        padded = Path(work) / (image.stem + ".png")
        offset_x, offset_y, width, height = pad_for_recognition(str(image), str(padded))
        layout = PageLayout()
        config = ProcessingConfig(False, False, False, False, -1, False, False, False, False)
        xml = Path(process_image(str(padded), config, XmlGeneratorArguments(False, None, None), layout))
        return {
            "image": str(image),
            "size": [width, height],
            "staves": staves_in_source(layout.staves(), (offset_x, offset_y), (width, height)),
            "timeEstimated": layout.time_estimated,
            "homr": dataclasses.asdict(layout),
            "musicxml_sha256": hashlib.sha256(xml.read_bytes()).hexdigest(),
        }


def overlay(result: dict, out_dir: Path) -> None:
    import cv2

    image = cv2.imread(result["image"])
    height, width = image.shape[:2]
    for staff in result["staves"] or []:
        box = staff["box"]
        left, top = int(box["x"] * width), int(box["y"] * height)
        right, bottom = int((box["x"] + box["width"]) * width), int((box["y"] + box["height"]) * height)
        cv2.rectangle(image, (left, top), (right, bottom), (0, 0, 255), 3)
        label = f"{staff['firstBar']}-{staff['lastBar']}"
        cv2.putText(image, label, (left + 4, max(top - 8, 20)), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (0, 0, 255), 3)
    out_dir.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(out_dir / (Path(result["image"]).stem + ".staves.jpg")), image)


def main(argv: list[str]) -> int:
    out_dir = None
    if argv[:1] == ["--overlay"]:
        out_dir, argv = Path(argv[1]), argv[2:]
    if not argv:
        print(__doc__, file=sys.stderr)
        return 2
    for name in argv:
        result = read(Path(name))
        if out_dir is not None:
            overlay(result, out_dir)
        print(json.dumps(result))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
