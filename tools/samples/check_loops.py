#!/usr/bin/env python3
"""Measures the loop seam of every note in a sample set (the crackle check; see docs/samples.md).

  .venv-convert/bin/python -I tools/samples/check_loops.py web/public/samples/* ...

The player loops [sustainStart, sustainEnd) of each file, so the sample before sustainEnd is followed
by the sample at sustainStart. A loop that is not continuous makes a tick every loop length. Per note,
on the decoded file (ffmpeg, native sample rate):

  step   |x[start] - x[end-1]| relative to the 99th percentile of |x[i+1]-x[i]| inside the loop
  curve  second difference across the seam relative to the 99th percentile of the second difference
  level  RMS of the 25 ms before the loop end versus the 25 ms after the loop start, in dB

step and curve near or below 1 mean the seam is as smooth as the waveform itself. Notes with step > 3,
curve > 6 or level > 1.5 dB are listed as "check by ear". This only measures the file; the player's
envelope (fades, crossfades) is covered by web/test/sampler.test.ts.

A set with "attack": "always" (piano, guitar) has notes that play once, without a loop; they are skipped.
"""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np


def decode(path: Path):
    probe = json.loads(subprocess.run(
        ["ffprobe", "-v", "error", "-show_streams", "-of", "json", str(path)], check=True, capture_output=True).stdout)
    rate = int(probe["streams"][0]["sample_rate"])
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-ac", "1", "-f", "f32le", "-"], check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype="<f4").astype(np.float64), rate


def measure(x, rate, start_s, end_s):
    s = int(round(start_s * rate))
    e = min(int(round(end_s * rate)), len(x))
    loop = x[s:e]
    d1 = np.abs(np.diff(loop))
    d2 = np.abs(np.diff(loop, 2))
    p1 = np.percentile(d1, 99)
    p2 = np.percentile(d2, 99)
    step = abs(x[s] - x[e - 1])
    # the sequence the player produces across the seam: x[e-2], x[e-1], x[s], x[s+1]
    seam = np.array([x[e - 2], x[e - 1], x[s], x[s + 1]])
    curve = max(abs(seam[2] - 2 * seam[1] + seam[0]), abs(seam[3] - 2 * seam[2] + seam[1]))
    n = int(0.025 * rate)
    before = np.sqrt(np.mean(x[e - n:e] ** 2))
    after = np.sqrt(np.mean(x[s:s + n] ** 2))
    level = 20 * np.log10(max(after, 1e-9) / max(before, 1e-9))
    return step / p1, curve / p2, level


def main(dirs):
    worst_all = []
    for d in map(Path, dirs):
        map_ = json.loads((d / "map.json").read_text())
        rows = []
        for key, e in sorted(map_["notes"].items(), key=lambda kv: int(kv[0])):
            if "sustainStart" not in e:
                continue
            x, rate = decode(d / e["file"])
            rows.append((int(key), *measure(x, rate, e["sustainStart"], e["sustainEnd"])))
        if not rows:
            print(f"{d}: no loops (every note plays once), nothing to check")
            continue
        steps = np.array([r[1] for r in rows])
        curves = np.array([r[2] for r in rows])
        levels = np.array([abs(r[3]) for r in rows])
        print(f"{d}: {len(rows)} notes; step median {np.median(steps):.2f} max {steps.max():.2f}; "
              f"curve median {np.median(curves):.2f} max {curves.max():.2f}; level mismatch max {levels.max():.2f} dB")
        bad = [r for r in rows if r[1] > 3 or r[2] > 6 or abs(r[3]) > 1.5]
        for midi, step, curve, level in bad:
            print(f"  check by ear: note {midi}: step {step:.2f}, curve {curve:.2f}, level {level:+.2f} dB")
            worst_all.append((d, midi))
    return 0


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    sys.exit(main(sys.argv[1:]))
