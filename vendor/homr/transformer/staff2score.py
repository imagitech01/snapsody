import os
from time import perf_counter

import numpy as np
from PIL import Image

from homr import _backend  # patched: model backend (Android)
from homr.simple_logging import eprint
from homr.transformer.configs import Config
from homr.transformer.decoder_inference import get_decoder
from homr.transformer.encoder_inference import Encoder
from homr.transformer.vocabulary import EncodedSymbol
from homr.type_definitions import NDArray


class Staff2Score:
    """
    Inference class for Tromr. Use predict() for prediction
    """

    def __init__(self, config: Config) -> None:
        self.config = config
        if _backend.backend is None:  # patched: Android runs the transformer in Kotlin
            self.encoder = Encoder(self.config)
            self.decoder = get_decoder(self.config)

        if not os.path.exists(self.config.filepaths.rhythmtokenizer):
            raise RuntimeError(
                "Failed to find tokenizer config" + self.config.filepaths.rhythmtokenizer
            )  # noqa: E501

    def predict(self, image: NDArray) -> list[EncodedSymbol]:
        """
        Inference an image (NDArray) using Tromr.
        """
        x = _transform(image=image)

        t0 = perf_counter()
        if _backend.backend is not None:  # patched: Android runs the transformer in Kotlin
            out = _decode_with_backend(_backend.backend, x, self.config)
            eprint(f"Inference Time Tromr: {perf_counter()-t0}")
            return out

        # Create special tokens
        start_token = np.array([[1]], dtype=np.int64)
        nonote_token = np.array([[0]], dtype=np.int64)

        # Generate context with encoder. The encoder and decoder may run in
        # different precisions (e.g. the CoreML encoder is fp16 while the
        # decoder stays on the fp32 CPU model), so cast the context to the
        # dtype the decoder expects before handing it over.
        context = self.encoder.generate(x)
        context_dtype = np.float16 if self.decoder.fp16 else np.float32
        if context.dtype != context_dtype:
            context = context.astype(context_dtype)

        # Make a prediction using decoder
        out = self.decoder.generate(
            start_token,
            nonote_token,
            seq_len=self.config.max_seq_len,
            eos_token=self.config.eos_token,
            context=context,
        )

        eprint(f"Inference Time Tromr: {perf_counter()-t0}")

        return out


def _decode_with_backend(backend: "_backend.ModelBackend", x: NDArray, config: Config) -> list[EncodedSymbol]:
    """patched: the same symbols as ScoreDecoder.generate, decoded natively (Android)."""
    from homr.transformer.decoder_inference import detokenize

    tokens, attention = backend.decode(backend.encode(x.astype(np.float32)))
    vocabs = [
        config.rhythm_vocab, config.pitch_vocab, config.lift_vocab,
        config.position_vocab, config.articulation_vocab, config.slur_vocab,
    ]
    inverse = [{v: k for k, v in vocab.items()} for vocab in vocabs]
    symbols = []
    for ids, coordinates in zip(tokens, attention, strict=True):
        rhythm, pitch, lift, position, articulation, slur = (
            detokenize(np.array([[int(i)]]), inv)[0] for i, inv in zip(ids, inverse, strict=True)
        )
        symbols.append(
            EncodedSymbol(
                rhythm=rhythm, pitch=pitch, lift=lift, articulation=articulation,
                slur=slur, position=position, coordinates=np.asarray(coordinates, dtype=np.float32),
            )
        )
    return symbols


class ConvertToArray:
    def __init__(self) -> None:
        self.mean = np.array([0.7931]).reshape(1, 1, 1)
        self.std = np.array([0.1738]).reshape(1, 1, 1)

    def normalize(self, array: NDArray) -> NDArray:
        return (array - self.mean) / self.std

    def __call__(self, image: NDArray) -> NDArray:
        arr = np.array(image) / 255
        arr = arr[np.newaxis, np.newaxis, :, :]
        return self.normalize(arr).astype(np.float32)


_transform = ConvertToArray()


def test_transformer_on_image(path_to_img: str) -> None:
    """
    Tests the transformer on an image and prints the results.
    Args:
        path_to_img(str): Path to the image to test
    """

    model = Staff2Score(Config())
    image = Image.open(path_to_img)
    out = model.predict(np.array(image))
    eprint(out)


if __name__ == "__main__":
    import sys

    test_transformer_on_image(sys.argv[1])
