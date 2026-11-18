"""Optional onnxruntime import. instrument_assist patch, see vendor/PATCHES.md.

There is no onnxruntime Python package on Android: there, model inference runs in
Kotlin (InferenceService, design D3) and ``ort`` is None. On a desktop with
onnxruntime installed homr behaves as before.
"""

from typing import Any

ort: Any
try:
    import onnxruntime as ort
except ImportError:  # Android (Chaquopy)
    ort = None
