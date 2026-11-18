"""Run the vendored homr (vendor/homr) like its CLI.

    python tools/homr/run_homr.py [--cpu] [--layout] [homr args...] image.jpg

--cpu disables every GPU/CoreML provider, so segnet runs on the ONNX Runtime
CPU path (useful to separate accelerator effects from library-version effects).
--layout also writes <image>.layout.json next to the MusicXML: the staff boxes (pixels
of the image), bars per staff and whether the time signature was estimated
(homr.page_layout, practice-app design D7). The MusicXML is the same with or without it.
Models are expected next to the vendored sources (git-ignored, see vendor/PATCHES.md).
"""

import importlib
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "vendor"))

args = sys.argv[1:]
if args and args[0] == "--cpu":
    args = args[1:]
    import homr.onnx_providers as providers

    def _no() -> bool:
        return False

    names = ("coreml_available", "cuda_available", "rocm_available")
    for name in names:
        setattr(providers, name, _no)
    for module in ("homr.main", "homr.segmentation.inference_segnet"):
        loaded = importlib.import_module(module)
        for name in names:
            if hasattr(loaded, name):
                setattr(loaded, name, _no)

write_layout = bool(args) and args[0] == "--layout"
if write_layout:
    args = args[1:]
    import dataclasses
    import json

    import homr.main as homr_main
    from homr.page_layout import PageLayout

    process_image = homr_main.process_image

    def _process_image_with_layout(image_path, config, xml_generator_args):  # type: ignore[no-untyped-def]
        layout = PageLayout()
        xml_file = process_image(image_path, config, xml_generator_args, layout)
        with open(os.path.splitext(image_path)[0] + ".layout.json", "w", encoding="utf-8") as f:
            json.dump({**dataclasses.asdict(layout), "staves": layout.staves()}, f, indent=2)
        return xml_file

    homr_main.process_image = _process_image_with_layout

from homr.main import main  # noqa: E402

sys.argv = ["homr", *args]
main()
