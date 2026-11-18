"""Pitch sanity check: the loop section of each file must sit within 40 cents of the note's
equal-tempered concert pitch (A4 = 440; samples are 442-ish, so some drift is expected). A note that
plays once (a set with "attack": "always": piano, guitar) is measured on the 2 s after its first 0.3 s.
  .venv-convert/bin/python -I tools/samples/check_pitch.py build/samples/<candidate> [...]
"""
import json, os, subprocess, sys
import numpy as np
for d in sys.argv[1:]:
    m = json.load(open(os.path.join(d, 'map.json')))
    worst = 0; bad = []
    for k, e in m['notes'].items():
        raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', os.path.join(d, e['file']), '-ac', '1', '-ar', '48000', '-f', 'f32le', '-'],
                             check=True, stdout=subprocess.PIPE).stdout
        x = np.frombuffer(raw, '<f4').astype(float)
        if 'sustainStart' in e:
            seg = x[round(e['sustainStart'] * 48000):round(e['sustainEnd'] * 48000)]
            seg = np.tile(seg, 2 ** 17 // len(seg) + 1)[:2 ** 17]    # a loop is seamless, so tile it: short loops give a coarse spectrum
        else:
            seg = x[round(0.3 * 48000):round(2.3 * 48000)]           # after the strike, before the fade at the end of the file
        seg = seg * np.hanning(len(seg))
        spec = np.abs(np.fft.rfft(seg, 2 ** 19)); fr = np.fft.rfftfreq(2 ** 19, 1 / 48000)
        f0 = 440 * 2 ** ((int(k) - 69) / 12)
        # strongest peak near f0 (allow harmonics to dominate: take the best among f0 windows)
        win = (fr > f0 * 0.93) & (fr < f0 * 1.07)
        pk = fr[win][np.argmax(spec[win])]
        cents = 1200 * np.log2(pk / f0)
        worst = max(worst, abs(cents))
        if abs(cents) > 40: bad.append((k, round(cents)))
    print(d, 'worst deviation %.0f cents' % worst, 'BAD' if bad else 'OK', bad)
