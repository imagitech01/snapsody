"""The raw page readings of the pages-merge fixture (openspec practice-app 6.3), made on the Mac.

Reads web/test/fixtures/two-page/page-{1,2}.png (tools/pages/make_two_page_fixture.py) the way the
app's job reads a page: the page gets the white recognition margin (ia_engine.pad_for_recognition),
then homr runs with the app's ProcessingConfig, on the CPU. Each reading is homr's MusicXML as it
comes, never edited, and is written to page-{1,2}.musicxml next to the image. Run it in
.venv-py310 (Python 3.10, numpy 1.26.2, OpenCV 4.5.4, the closest to Chaquopy's 4.5.1) with the
three ONNX models linked into vendor/homr (see vendor/PATCHES.md):

    .venv-py310/bin/python -I tools/pages/read_two_page_fixture.py

homr's <!-- imgpos --> comments may move by a pixel between OpenCV builds, so the readings are
only reproducible on the same build; the merged score the test compares against
(web/test/fixtures/make-two-page.ts) does not carry them.

homr 0.7.1 always starts a reading with a time signature: when none is printed it writes n/4 from
the median bar length (music_xml_generator.py). So page 2, which has none printed, is read as 3/4,
and the merge drops it as a repeat. The Reader also reports it as estimated (homr patch 8,
tools/homr/staff_positions.py), and core/pages then treats it as absent, with the same result. A reading with no time signature at all, which the merge and the
repairs also handle, is built by hand in web/test/pages.test.ts.

The ia_engine import follows the engine's folder; when the engine moves (practice-app group 8),
change SRC below.
"""

from __future__ import annotations

import shutil
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
FIXTURE = REPO / "web" / "test" / "fixtures" / "two-page"
SRC = REPO / "android" / "app" / "src" / "main" / "python"
sys.path.insert(0, str(REPO / "vendor"))
sys.path.insert(0, str(REPO / "tools" / "models"))
sys.path.insert(0, str(SRC))

from make_inference_fixtures import disable_accelerators  # noqa: E402

disable_accelerators()
from homr.main import ProcessingConfig, process_image  # noqa: E402
from homr.music_xml_generator import XmlGeneratorArguments  # noqa: E402
from ia_engine import pad_for_recognition  # noqa: E402


def main() -> int:
    for page in sorted(FIXTURE.glob("page-*.png")):
        with tempfile.TemporaryDirectory() as work:
            padded = Path(work) / (page.stem + ".png")
            pad_for_recognition(str(page), str(padded))
            config = ProcessingConfig(False, False, False, False, -1, False, False, False, False)
            xml = Path(process_image(str(padded), config, XmlGeneratorArguments(False, None, None)))
            target = FIXTURE / (page.stem + ".musicxml")
            shutil.copyfile(xml, target)
            print(f"wrote {target}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
