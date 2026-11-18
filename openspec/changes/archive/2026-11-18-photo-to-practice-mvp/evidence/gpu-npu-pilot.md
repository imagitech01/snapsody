# Pilot: running homr's segmentation model (segnet) on the phone's CPU, GPU and NPU

**Date:** 2026-11-17
**Device:** Samsung Galaxy S24 (SM-S921B), Exynos 2400 (`s5e9945`), Android 17 (SDK 37)
**Tool:** Google's prebuilt LiteRT `benchmark_model` (android_aarch64 nightly), run over adb
**Model:** homr `segnet_308` (fp16 ONNX, 320×320 tiles). A full photo is ~150 tiles; a cropped exercise is far fewer.

## Conclusion

| Path | Per tile (median) | Full page, 150 tiles (avg × 150) | Correct? | Effort |
|---|---|---|---|---|
| **GPU: LiteRT GPU delegate (OpenCL)** | **~21–26 ms** | **~5 s** + ~4 s one-time init (cacheable) | **yes**: 99.92% of symbol pixels on 4 real tiles, same model as timed (fp16 rounding) | **none**: converted model works as is |
| CPU 4 threads, int8 (XNNPACK) | ~68 ms | ~15 s (throttles) | 99.25% of symbol pixels (Mac check only) | int8 calibration |
| CPU 4 threads, fp16 (XNNPACK) | ~116–140 ms | ~36 s (heats up, throttles) | yes | none |
| CPU 4 threads, fp32 | ~177 ms | ~27 s+ | yes | none |
| CPU 1 thread, fp32 | ~440 ms | ~65 s | yes | none |
| NNAPI → Samsung ENN (**ran on ENN's GPU driver, not the NPU**) | ~40 ms (fp16) / ~56 ms (fp32) | ~9–10 s | **NO** with our rewrite (see below) | graph rewrite needed to get it accepted |

**Decision input:** use the **LiteRT GPU delegate, with CPU as the fallback**.

**What this says about the NPU:** we never reached it. Through NNAPI, Samsung's ENN driver placed the whole graph on its own GPU user driver (logcat: 27× `GpuUserDriver::ExecuteSubGraph`, no NPU driver activity). On this phone, NNAPI is not a route to the NPU for this model, and NNAPI is deprecated anyway. Samsung's own NPU SDK is the only other route, and it isn't worth pursuing given the GPU result.

Reference: the Mac (Apple Silicon, CPU, 4 threads) does ~70 ms/tile.

## What happened on the NNAPI/ENN path

1. The **unmodified model is refused entirely**: ENN reports `Operation Not Supported`, so 0 of 56 ops are delegated.
2. One-op probes (`micro_results.txt`) suggested ENN refuses PAD, RESIZE_NEAREST_NEIGHBOR and int8 CONV_2D, all-or-nothing. **Caveat:** "Replacing N out of N" only means accepted at planning time. Some accepted probes (concat, relu+add) then failed to prepare, so the acceptance list is indicative, not confirmed.
3. Exact-maths rewrite (`npu_surgery.py`): nearest-upsample → concat×4 + DEPTH_TO_SPACE; stride-2 convs → kernel+1 with zero weights under SAME; padded maxpool → SAME maxpool s1 + maxpool k1 s2. ENN then accepted 57/57 ops; the rewrite is bit-identical on CPU (max diff 4e-5).
4. **On the device the rewritten model's outputs are wrong**: 0% of symbol pixels match. The one-op checks show **our** upsample substitute (concat×4 + DEPTH_TO_SPACE) gives 75% zeros on ENN. Other exact upsample forms (e.g. a fixed-weight transpose conv) were not tried, so "ENN can't run segnet" is not proven, only "this rewrite miscomputes on ENN".

## Other findings

- int8 quantisation (calibrated on 40 tiles from the photo) agrees with fp32 on 99.25% of symbol pixels (99.76% with int16 activations). It still needs an end-to-end homr check before it is trusted.
- GPU init (~3–5 s) is OpenCL kernel compilation. The GPU delegate can serialise the compiled kernels, so later app launches skip it.
- Outliers: p95 latencies are 5–10× the median on every backend (thermal/DVFS). Run the page as a background job with progress shown.

## Files

- `prepare.py`: fp16 → fp32, batch fixed to 1, equivalence check
- `fold_resize.py`: constant-folds Resize sizes (needed for onnx2tf)
- `npu_surgery.py`: the ENN-compatibility rewrite
- `micro_models.py`, `micro_fix.py`, `micro_check.py`: one-op driver probes
- `tflite_out/` (**the recommended GPU model**), `tflite_int8/`, `tflite_npu/`: converted models
- `results_raw.txt`, `micro_results.txt`: raw benchmark output
- `bin/benchmark_model`: Google prebuilt (sha256 `5d45116e…1374`)

## Not covered by this pilot

- The transformer encoder/decoder (~1.5 s/page on Mac CPU; the encoder may also suit the GPU)
- homr's Python pre- and post-processing time on the phone (Chaquopy)
- An end-to-end run, where the notes come out right, with the GPU segnet swapped into homr
