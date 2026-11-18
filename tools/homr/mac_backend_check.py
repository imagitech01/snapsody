"""Checks homr's model-backend patch on the Mac (vendor/homr/_backend.py).

Registers a backend built from onnxruntime (segnet argmax, encoder, and the replica
decoder loop that returns token ids, like the Kotlin InferenceService) and checks that
homr's MusicXML is byte-identical to a run without a backend.

    .venv-convert/bin/python -I tools/homr/mac_backend_check.py IMAGE
"""

import shutil
import sys
import tempfile
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "vendor"))
sys.path.insert(0, str(REPO / "tools" / "models"))

from make_inference_fixtures import disable_accelerators, replica_decode  # noqa: E402

disable_accelerators()
from homr import _backend  # noqa: E402
from homr.main import ProcessingConfig, process_image  # noqa: E402
from homr.music_xml_generator import XmlGeneratorArguments  # noqa: E402
from homr.segmentation.inference_segnet import Segnet  # noqa: E402
from homr.transformer.configs import Config  # noqa: E402
from homr.transformer.decoder_inference import get_decoder  # noqa: E402
from homr.transformer.encoder_inference import Encoder  # noqa: E402


class OrtBackend:
    def __init__(self) -> None:
        self.segnet = Segnet(use_gpu_inference=False)
        config = Config()
        config.use_gpu_inference = False  # fp32 on the CPU, as homr's plain CPU run and the phone
        config.use_coreml_encoder = False
        self.encoder = Encoder(config)
        self.decoder = get_decoder(config)
        self.calls = {"segnet_tiles": 0, "staves": 0}

    def segnet_argmax(self, batch):
        self.calls["segnet_tiles"] += len(batch)
        return list(np.argmax(self.segnet.run(batch), axis=1))

    def encode(self, x):
        return self.encoder.generate(x)

    def decode(self, encoded):
        self.calls["staves"] += 1
        return replica_decode(self.decoder, encoded)


def run(image: Path, workdir: Path, backend) -> str:
    _backend.set_backend(backend)
    import homr.segmentation.inference_segnet as seg

    seg._segnet_inference = None
    target = workdir / image.name
    shutil.copyfile(image, target)
    config = ProcessingConfig(False, False, False, False, -1, False, False, False, False)
    return Path(process_image(str(target), config, XmlGeneratorArguments(False, None, None))).read_text()


def main() -> int:
    image = Path(sys.argv[1])
    with tempfile.TemporaryDirectory() as a, tempfile.TemporaryDirectory() as b:
        plain = run(image, Path(a), None)
        backend = OrtBackend()
        patched = run(image, Path(b), backend)
    print("backend calls:", backend.calls)
    print("MusicXML byte-identical with and without the backend:", plain == patched)
    return 0 if plain == patched else 1


if __name__ == "__main__":
    sys.exit(main())
