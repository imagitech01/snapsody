"""Pluggable model backend. instrument_assist patch, see vendor/PATCHES.md.

On Android every model call goes to the Kotlin InferenceService (design D3); the
app registers a backend here before running homr. With no backend registered (the
desktop) homr uses onnxruntime exactly as before.
"""

from typing import Any, Protocol

from homr.type_definitions import NDArray


class ModelBackend(Protocol):
    def segnet_argmax(self, batch_nchw: NDArray) -> NDArray:
        """batch_nchw: B x 3 x 320 x 320 float32 (0..255) -> B x 320 x 320 class ids."""

    def encode(self, x: NDArray) -> Any:
        """x: 1 x 1 x 256 x 1280 float32 -> an opaque handle to the native encoder output."""

    def decode(self, encoded: Any) -> tuple[NDArray, NDArray]:
        """-> (steps x 6 token ids: rhythm, pitch, lift, position, articulation, slur;
        steps x 2 attention values). Releases the encoder output."""


backend: ModelBackend | None = None


def set_backend(new_backend: ModelBackend | None) -> None:
    global backend  # noqa: PLW0603
    backend = new_backend
