#!/usr/bin/env python3
"""Convert a General MIDI SoundFont (SF2) into the app's sample folders (design D9; the
format is documented in web/src/core/playback/samples.ts).

  .venv-convert/bin/python -I tools/samples/convert_soundfont.py \
      build/samples-src/musescore-general-0.2/MuseScore_General.sf2 \
      [--config tools/samples/instruments.json] [--out web/public/samples] \
      [--only tenor-sax,piano] [--report build/samples-report]

  .venv-convert/bin/python -I tools/samples/convert_soundfont.py FILE.sf2 --inspect 67

Reads the SoundFont's own samples (no synthesis: filters, envelopes and modulators of the
presets are not applied) and writes, per instrument in the config, a folder with one mono
48 kHz Ogg/Opus file per sampled note plus map.json:

  - Notes: every `step` semitones (3) across the instrument's sounding range, plus the top
    note when it is two semitones away. The app's sampler repitches the nearest file by at
    most one semitone.
  - Each file is what the SoundFont plays for that key at velocity `velocity`: the zone of
    the GM preset covering the key, resampled by the zone's root key, tuning and scale
    tuning, so the file sits at the equal-tempered pitch of its key (A4 = 440 Hz).
    Linked left/right zones are averaged into mono.
  - Loop points come from the SoundFont's loop data (sampleModes 1 or 3 and the sample's
    loop addresses). They are written sample-exact for the 48 kHz file. The loop is
    repeated to at least 0.3 s, in the source domain and by a whole number of repeats chosen
    so that its length is (nearly) a whole number of output samples; that keeps a short
    pitch-synchronous loop seamless after resampling.
  - An instrument whose sound decays (piano, guitar) has `"attack": "always"` in the config: the
    sampler then starts every note at its attack, a slurred one too (samples.ts), and plays it once,
    without a loop. The file is the SoundFont's sample as it plays up to its loop end, which sits in the
    tail of a long decay and is not looped. The SoundFont's samples end while still audible, so the last
    `endFade` seconds (default 1 s, at most 40 % of the file) fade to silence, and map.json gets
    `"attack": "always"` and notes without `sustainStart`/`sustainEnd`. (The earlier alternative, a
    config `"loop"` that makes an artificial short loop after the strike, is still supported:
    see fixed_loop_note.)
  - A SoundFont loop whose waveform jumps at the seam (see seam_metrics) gets a short
    cross-fade baked in.
  - `gain` (at most 1) evens out the held loudness between notes: every file is peak-
    normalised, `gain` brings its loop section down to a common RMS (TARGET_RMS).

Only SF2 is read (lossless samples); an SF3 would add a second lossy generation.
Needs numpy and ffmpeg (libopus). The output is deterministic: running twice gives
byte-identical files. Setup and the SoundFont's source: docs/samples.md.
"""
import argparse
import hashlib
import json
import math
import os
import struct
import subprocess
import sys

import numpy as np

SR = 48000                  # output sample rate
PEAK = 0.89                 # file peak after normalising
TARGET_RMS = 0.10           # held loudness the gain aims at
MIN_LOOP_S = 0.3            # loops are repeated up to this length (check_map.mjs wants the same)
TAIL_S, TAIL_FADE_S = 0.10, 0.06   # codec padding after the loop end: the loop continued, faded out
END_FADE_S, END_FADE_MAX = 1.0, 0.4   # a note that plays once fades out over this long, at most this share of the file
LEAD_SILENCE_DB = -50       # leading silence below this is trimmed (5 ms kept)
SEAM_STEP_MAX, SEAM_CURVE_MAX = 3.0, 6.0   # as tools/samples/check_loops.py
CROSSFADE_S = 0.03
ENV_HOP, ENV_WIN = int(0.01 * SR), int(0.1 * SR)    # loudness envelope: 100 ms windows every 10 ms
KERNEL_HALF, KERNEL_BETA = 24, 8.0   # windowed-sinc resampler
OPUS_KBPS = 80

# SoundFont generator numbers (SF 2.04, section 8.1.2)
G_START, G_END, G_LOOP_START, G_LOOP_END = 0, 1, 2, 3
G_START_C, G_END_C, G_LOOP_START_C, G_LOOP_END_C = 4, 12, 45, 50
G_INSTRUMENT, G_KEY_RANGE, G_VEL_RANGE = 41, 43, 44
G_KEYNUM, G_VELOCITY = 46, 47
G_COARSE, G_FINE, G_SAMPLE_ID, G_SAMPLE_MODES, G_SCALE, G_ROOT = 51, 52, 53, 54, 56, 58
SAMPLE_MONO, SAMPLE_RIGHT, SAMPLE_LEFT = 1, 2, 4


class ConvertError(Exception):
    pass


# --------------------------------------------------------------------------- SF2 reading

class SoundFont:
    def __init__(self, path):
        self.data = open(path, 'rb').read()
        d = self.data
        if d[:4] != b'RIFF' or d[8:12] != b'sfbk':
            raise ConvertError(f'{path}: not a SoundFont (no RIFF sfbk)')
        parts = {}
        for cid, o, s in self._chunks(12, len(d)):
            if cid == b'LIST':
                kind = d[o:o + 4]
                for c2, o2, s2 in self._chunks(o + 4, o + s):
                    parts[(kind, c2)] = (o2, s2)
        major, minor = struct.unpack_from('<HH', d, parts[(b'INFO', b'ifil')][0])
        if major >= 3:
            raise ConvertError(f'{path}: SoundFont {major}.{minor} (SF3, compressed samples) is not supported; use the SF2')
        self.version = f'{major}.{minor}'
        o, s = parts.get((b'INFO', b'INAM'), (0, 0))
        self.name = d[o:o + s].split(b'\0')[0].decode('latin1')
        so, ss = parts[(b'sdta', b'smpl')]
        self.pcm = np.frombuffer(d, dtype='<i2', count=ss // 2, offset=so)
        self.low = None
        if (b'sdta', b'sm24') in parts:   # 24-bit samples: the low byte lives in its own chunk
            o24, s24 = parts[(b'sdta', b'sm24')]
            self.low = np.frombuffer(d, dtype='u1', count=s24, offset=o24)

        def recs(name, fmt):
            o, s = parts[(b'pdta', name)]
            n = struct.calcsize(fmt)
            return [struct.unpack_from(fmt, d, o + i * n) for i in range(s // n)]

        self.phdr = recs(b'phdr', '<20sHHHIII')
        self.pbag, self.pgen = recs(b'pbag', '<HH'), recs(b'pgen', '<Hh')
        self.inst = recs(b'inst', '<20sH')
        self.ibag, self.igen = recs(b'ibag', '<HH'), recs(b'igen', '<Hh')
        self.shdr = [Sample(i, *r) for i, r in enumerate(recs(b'shdr', '<20sIIIIIBbHH'))]

    def _chunks(self, off, end):
        while off + 8 <= end:
            size = struct.unpack_from('<I', self.data, off + 4)[0]
            yield self.data[off:off + 4], off + 8, size
            off += 8 + size + (size & 1)

    @staticmethod
    def _zones(bag, gen, first, last):
        return [{op: amt for op, amt in gen[bag[b][0]:bag[b + 1][0]]} for b in range(first, last)]

    def preset(self, bank, program):
        """(name, zones) of a preset; each zone is flattened from preset zone x instrument zone."""
        for i, (name, num, bk, bag, _, _, _) in enumerate(self.phdr[:-1]):
            if bk != bank or num != program:
                continue
            pzones = self._zones(self.pbag, self.pgen, bag, self.phdr[i + 1][3])
            pglobal = pzones[0] if pzones and G_INSTRUMENT not in pzones[0] else {}
            flat = []
            for pz in pzones:
                if G_INSTRUMENT not in pz:
                    continue
                pg = {**pglobal, **pz}
                ii = pg[G_INSTRUMENT]
                izones = self._zones(self.ibag, self.igen, self.inst[ii][1], self.inst[ii + 1][1])
                iglobal = izones[0] if izones and G_SAMPLE_ID not in izones[0] else {}
                for iz in izones:
                    if G_SAMPLE_ID not in iz:
                        continue
                    flat.append(Zone(self.shdr[iz[G_SAMPLE_ID]], {**iglobal, **iz}, pg))
            return name.split(b'\0')[0].decode('latin1'), flat
        raise ConvertError(f'no preset bank {bank} program {program}')

    def samples(self, start, end):
        """Sample points [start, end) as floats in -1..1."""
        v = self.pcm[start:end].astype(np.float64)
        if self.low is None:
            return v / 32768.0
        return (v * 256 + self.low[start:end]) / (1 << 23)


class Sample:
    def __init__(self, index, name, start, end, loop_start, loop_end, rate, pitch, correction, link, kind):
        self.index, self.name = index, name.split(b'\0')[0].decode('latin1')
        self.start, self.end, self.loop_start, self.loop_end = start, end, loop_start, loop_end
        self.rate, self.pitch, self.correction, self.link, self.kind = rate, pitch, correction, link, kind


def _range(value, default=(0, 127)):
    return default if value is None else (value & 0xFF, (value >> 8) & 0xFF)


class Zone:
    """One sample zone of a preset, with the generators that matter for the raw samples."""

    def __init__(self, sample, igen, pgen):
        self.sample, self.igen, self.pgen = sample, igen, pgen
        pk, ik = _range(pgen.get(G_KEY_RANGE)), _range(igen.get(G_KEY_RANGE))
        pv, iv = _range(pgen.get(G_VEL_RANGE)), _range(igen.get(G_VEL_RANGE))
        self.keys = (max(pk[0], ik[0]), min(pk[1], ik[1]))
        self.vels = (max(pv[0], iv[0]), min(pv[1], iv[1]))
        self.root = igen.get(G_ROOT, -1)
        if self.root < 0:
            self.root = sample.pitch if sample.pitch != 255 else 60
        self.scale = igen.get(G_SCALE, 100) + pgen.get(G_SCALE, 0)
        self.cents = (igen.get(G_COARSE, 0) + pgen.get(G_COARSE, 0)) * 100 + igen.get(G_FINE, 0) + pgen.get(G_FINE, 0) + sample.correction
        self.modes = igen.get(G_SAMPLE_MODES, 0) & 3
        if G_KEYNUM in igen or G_VELOCITY in igen:
            raise ConvertError(f'sample {sample.name}: fixed key or velocity generators are not supported')

    def covers(self, key, velocity):
        return self.keys[0] <= key <= self.keys[1] and self.vels[0] <= velocity <= self.vels[1]

    def addresses(self):
        """(start, end, loop_start, loop_end) in absolute sample points, with the address offsets."""
        g, s = self.igen, self.sample
        start = s.start + g.get(G_START, 0) + 32768 * g.get(G_START_C, 0)
        end = s.end + g.get(G_END, 0) + 32768 * g.get(G_END_C, 0)
        ls = s.loop_start + g.get(G_LOOP_START, 0) + 32768 * g.get(G_LOOP_START_C, 0)
        le = s.loop_end + g.get(G_LOOP_END, 0) + 32768 * g.get(G_LOOP_END_C, 0)
        return start, end, ls, le


def pick_zones(zones, key, velocity):
    """The zone (or linked left/right pair) the SoundFont plays for key and velocity, and how many candidates there were."""
    cands = [z for z in zones if z.covers(key, velocity)]
    if not cands:
        raise ConvertError(f'no zone covers key {key} at velocity {velocity}')
    first = cands[0]
    if first.sample.kind in (SAMPLE_LEFT, SAMPLE_RIGHT):
        partner = next((z for z in cands if z.sample.index == first.sample.link and z.sample.link == first.sample.index), None)
        if partner is not None:
            return [first, partner], len(cands) // 2
    return [first], len(cands)


# --------------------------------------------------------------------------- audio

def interpolate(x, pos, step):
    """x at the (fractional) source positions pos, by Kaiser-windowed sinc; step is the source samples per output sample."""
    cut = min(1.0, 1.0 / step)                      # low-pass when the source runs faster than the output
    half = int(math.ceil(KERNEL_HALF / cut))
    padded = np.concatenate([np.zeros(half), x, np.zeros(half + 1)])
    taps = np.arange(-half + 1, half + 1)
    norm = np.i0(KERNEL_BETA)
    out = np.empty(len(pos))
    for a in range(0, len(pos), 2048):
        p = pos[a:a + 2048]
        base = np.floor(p).astype(np.int64)
        d = p[:, None] - (base[:, None] + taps[None, :])
        window = np.i0(KERNEL_BETA * np.sqrt(np.clip(1 - (d / half) ** 2, 0, None))) / norm
        weights = np.sinc(cut * d) * cut * window
        idx = np.clip(base[:, None] + taps[None, :] + half, 0, len(padded) - 1)
        out[a:a + 2048] = np.sum(weights * padded[idx], axis=1)
    return out


def seam_metrics(x, ls, le):
    """How smoothly the loop wraps (the measures of tools/samples/check_loops.py): the jump across the seam
    against the typical step inside the loop, the second difference across the seam against the typical one,
    and the level change in dB across it."""
    loop = x[ls:le]
    d1 = np.abs(np.diff(loop))
    d2 = np.abs(np.diff(loop, 2))
    ref1 = np.percentile(d1, 99) + 1e-9
    ref2 = np.percentile(d2, 99) + 1e-9
    step = abs(x[ls] - x[le - 1]) / ref1
    curve = abs((x[ls] - x[le - 1]) - (x[le - 1] - x[le - 2])) / ref2
    n = int(0.025 * SR)
    before = math.sqrt(np.mean(x[max(ls, le - n):le] ** 2)) + 1e-12
    after = math.sqrt(np.mean(x[ls:ls + n] ** 2)) + 1e-12
    return step, curve, abs(20 * math.log10(after / before))


def seam_is_bad(m):
    """A discontinuity in the waveform. A level change across the seam (m[2]) is the SoundFont's own loop
    (vibrato, a slow swell) and a cross-fade does not cure it, so it is only reported."""
    return m[0] > SEAM_STEP_MAX or m[1] > SEAM_CURVE_MAX


def crossfade_into_end(x, ls, le, xf):
    """Blend the last xf samples before the loop end with the xf samples before the loop start (equal power),
    so the wrap runs from the material that precedes the loop into the loop start."""
    t = (np.arange(xf) + 0.5) / xf
    out = np.cos(t * math.pi / 2)
    inn = np.sin(t * math.pi / 2)
    x[le - xf:le] = x[le - xf:le] * out + x[ls - xf:ls] * inn


def mix_pair(arrays):
    n = min(len(a) for a in arrays)
    return sum(a[:n] for a in arrays) / len(arrays)


def build_note(sf, cfg, key, velocity):
    """Decode, resample and loop one note. Returns the audio (float64, SR), loop points (output samples) and a report dict."""
    zones, ncand = pick_zones(cfg['zones'], key, velocity)
    z = zones[0]
    start, end, ls_abs, le_abs = z.addresses()
    arrays = [sf.samples(*zz.addresses()[:2]) for zz in zones]
    x = mix_pair(arrays)
    rate = z.sample.rate
    cents = (key - z.root) * z.scale + z.cents
    step = rate * 2 ** (cents / 1200) / SR          # source samples per output sample
    info = {'key': key, 'sample': z.sample.name + ('+' + zones[1].sample.name if len(zones) > 1 else ''), 'root': z.root,
            'cents': cents, 'candidates': ncand}

    # leading silence
    env = np.abs(x)
    t0 = max(0, int(np.argmax(env > env.max() * 10 ** (LEAD_SILENCE_DB / 20))) - int(0.005 * rate))
    x = x[t0:]

    loop_cfg = cfg.get('loop')
    if cfg.get('attack') == 'always' and loop_cfg is None:
        le = le_abs - start - t0
        if z.modes in (1, 3) and 0 < le <= len(x):
            x = x[:le]                # the SoundFont plays to the loop end and then wraps; the wrap is not played here
        y = one_shot_note(x, step, cfg.get('endFade', END_FADE_S), info)
        return y, None, None, info
    if loop_cfg is None:
        ls, le = ls_abs - start - t0, le_abs - start - t0
        if z.modes not in (1, 3) or not (0 <= ls < le <= len(x)):
            raise ConvertError(f'key {key} ({z.sample.name}): no usable loop in the SoundFont; give the instrument a "loop" in the config')
        y, ls_i, le_i = periodic_note(x, ls, le, step, info)
    else:
        y, ls_i, le_i = fixed_loop_note(x, step, loop_cfg, info)
    return y, ls_i, le_i, info


def one_shot_note(x, step, end_fade, info):
    """A note that plays once (the config's `"attack": "always"`): the whole sample, resampled, with its last
    `end_fade` seconds (at most END_FADE_MAX of the file) faded to silence by a raised cosine. The SoundFont's
    samples end while still audible (a decay cut off, then looped), so the fade is what lets a held note die away."""
    n = int(len(x) / step)
    y = interpolate(x, np.arange(n) * step, step)
    fade = min(int(end_fade * SR), int(END_FADE_MAX * n))
    loudest = rms_envelope(y, ENV_HOP, ENV_WIN).max()
    ends_at = math.sqrt(np.mean(y[-ENV_WIN:] ** 2))               # the level the SoundFont's sample ends at, before the fade
    y[n - fade:] *= 0.5 * (1 + np.cos(np.linspace(0, math.pi, fade)))
    info.update(end_db=round(20 * math.log10(ends_at / loudest + 1e-9), 1), fade=round(fade / SR, 2))
    return y


def periodic_note(x, ls, le, step, info):
    """A note looped at the SoundFont's loop points: output samples, loop start and end (exact), repeats."""
    length = le - ls
    # The loop, repeated k times to at least MIN_LOOP_S, must be a whole number of output samples, or the wrap is
    # off by a fraction of a sample (a tick on every pass). So the step is adjusted by at most 0.5 / n_loop
    # (under 0.06 cent at 0.3 s) until k * length / step is that whole number.
    k = max(1, math.ceil(MIN_LOOP_S * SR * step / length))
    n_loop = round(k * length / step)
    best, step = k, k * length / n_loop
    ls_i = math.ceil(ls / step)                       # output index of the loop start; output position j is source ls + (j - ls_i) * step
    total = ls_i + n_loop
    # the source as the SoundFont plays it: the part before the loop, then the loop for ever
    reach = ls + (total - ls_i) * step + KERNEL_HALF * max(1.0, step) + 4
    reps = int(math.ceil((reach - ls) / length)) + 1
    ext = np.concatenate([x[:ls], np.tile(x[ls:le], reps)])
    pos = ls + (np.arange(total) - ls_i) * step
    y = interpolate(ext, pos, step)
    le_i = ls_i + n_loop
    info.update(loop_src=(ls, le, length), repeats=best, loop_out=n_loop)
    return finish_loop(y, ls_i, le_i, info), ls_i, le_i


def fixed_loop_note(x, step, loop_cfg, info):
    """A note that keeps its natural decay up to a loop placed after the strike (the config's "loop"):
    `length` seconds long, starting at the latest point in [`earliest`, `latest`] seconds where the loop still
    averages within `entryDrop` dB of the note's loudest 100 ms (a slurred note enters there). The loop end is
    aligned by cross-correlation and cross-faded into the audio before the start. The envelope is not changed."""
    n_loop = round(loop_cfg['length'] * SR)
    xf = round(loop_cfg.get('crossfade', 0.08) * SR)
    search = round(loop_cfg.get('search', 0.02) * SR)
    earliest, latest = round(loop_cfg['earliest'] * SR), round(loop_cfg['latest'] * SR)
    drop = loop_cfg.get('entryDrop', 12.0)
    have = min(int(len(x) / step) - KERNEL_HALF - 2, latest + n_loop + search)   # output samples to use
    min_loop = round(MIN_LOOP_S * SR) + search            # moving the end back by `search` must leave MIN_LOOP_S
    n_loop = min(max(n_loop, min_loop), have - earliest - search)
    if n_loop < min_loop or earliest < xf:
        raise ConvertError(f'key {info["key"]}: the sample is too short for a loop after {loop_cfg["earliest"]} s')
    y = interpolate(x, np.arange(have) * step, step)
    env = rms_envelope(y, ENV_HOP, ENV_WIN)
    peak_level = env.max()
    power = np.concatenate([[0.0], np.cumsum(y * y)])
    starts = np.arange(earliest, min(latest, have - n_loop - search) + 1, ENV_HOP)
    loop_db = 10 * np.log10((power[starts + n_loop] - power[starts]) / n_loop / peak_level ** 2 + 1e-12)
    ok = np.nonzero(loop_db >= -drop)[0]
    ls_i = int(starts[ok[-1]]) if len(ok) else earliest
    # align the loop end: the xf samples before it should resemble the xf samples before the start (the cross-fade partner)
    ref = y[ls_i - xf:ls_i]
    lo = ls_i + n_loop - search
    seg = y[lo - xf:ls_i + n_loop + search]
    dots = np.correlate(seg, ref, 'valid')
    energy = np.sqrt(np.convolve(seg ** 2, np.ones(xf), 'valid') + 1e-12)
    delta = int(np.argmax(dots / energy)) - search
    le_i = ls_i + n_loop + delta
    y = y[:le_i].copy()
    level = lambda a, b: 20 * math.log10(math.sqrt(np.mean(y[a:b] ** 2)) / peak_level + 1e-9)
    info.update(loop_out=le_i - ls_i, shift=delta, baked=xf, entry_db=round(level(ls_i, ls_i + ENV_WIN), 1),
                decay_db=round(level(le_i - ENV_WIN - xf, le_i - xf) - level(ls_i, ls_i + ENV_WIN), 1))
    crossfade_into_end(y, ls_i, le_i, xf)
    return finish_loop(y, ls_i, le_i, info, allow_bake=False), ls_i, le_i


def finish_loop(y, ls_i, le_i, info, allow_bake=True):
    """Seam check (and a cross-fade for a bad seam), then the tail: the loop continued and faded out."""
    y = y[:le_i].copy()
    info['seam'] = tuple(round(float(v), 2) for v in seam_metrics(y, ls_i, le_i))
    if allow_bake and seam_is_bad(info['seam']):
        xf = min(int(CROSSFADE_S * SR), ls_i, (le_i - ls_i) // 3)
        if xf >= 32:
            crossfade_into_end(y, ls_i, le_i, xf)
            info['baked'] = xf
            info['seam_after'] = tuple(round(float(v), 2) for v in seam_metrics(y, ls_i, le_i))
    tail = np.resize(y[ls_i:le_i], int(TAIL_S * SR))        # the loop carries on after its end
    fade = int(TAIL_FADE_S * SR)
    tail[-fade:] *= 0.5 * (1 + np.cos(np.linspace(0, math.pi, fade)))
    return np.concatenate([y, tail])


def rms_envelope(y, hop, win):
    """RMS of the win-sample windows that start every hop samples."""
    c = np.concatenate([[0.0], np.cumsum(y * y)])
    i = np.arange(max(0, (len(y) - win) // hop + 1)) * hop
    return np.sqrt((c[i + win] - c[i]) / win)


def level_and_gain(y, ls_i, le_i, at_attack):
    """Peak-normalise the file; the gain (never above 1) brings the note to TARGET_RMS. The level of a sustained
    note is its loop section. A note that decays (config "level": "attack", the default when the config has a
    "loop" or "attack": "always") is measured at its loudest 100 ms, since its SoundFont loop would be in the tail."""
    y = y * (PEAK / np.abs(y).max())
    rms = float(rms_envelope(y, ENV_HOP, ENV_WIN).max()) if at_attack else math.sqrt(np.mean(y[ls_i:le_i] ** 2))
    return y, min(1.0, TARGET_RMS / rms), rms


def encode_opus(y, path, kbps):
    pcm = y.astype('<f4').tobytes()
    cmd = ['ffmpeg', '-v', 'error', '-f', 'f32le', '-ar', str(SR), '-ac', '1', '-i', '-',
           '-c:a', 'libopus', '-b:a', f'{kbps}k', '-vbr', 'on', '-application', 'audio', '-frame_duration', '20',
           '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:a', '+bitexact', '-f', 'ogg', '-y', path]
    subprocess.run(cmd, input=pcm, check=True)


# --------------------------------------------------------------------------- driver

def sounding_keys(lo, hi, step):
    keys = list(range(lo, hi + 1, step))
    if hi - keys[-1] >= 2:
        keys.append(hi)
    return keys


def convert_instrument(sf, name, cfg, defaults, soundfont, out_dir, report_dir):
    bank, program = cfg.get('bank', defaults['bank']), cfg['gmProgram'] - 1      # D8 lists the 1-based GM numbers
    preset_name, zones = sf.preset(bank, program)
    if preset_name != cfg['presetName']:
        raise ConvertError(f'{name}: GM {cfg["gmProgram"]} is "{preset_name}" in this SoundFont, the config expects "{cfg["presetName"]}"')
    velocity = cfg.get('velocity', defaults['velocity'])
    step_semis = cfg.get('step', defaults['step'])
    kbps = cfg.get('opusKbps', defaults['opusKbps'])
    lo, hi = cfg['range']
    os.makedirs(out_dir, exist_ok=True)
    for f in os.listdir(out_dir):                    # no stale files from an earlier set of notes
        if f == 'map.json' or f.endswith('.ogg'):
            os.remove(os.path.join(out_dir, f))
    notes, lines, total = {}, [], 0
    attack = cfg.get('attack')
    if attack not in (None, 'always'):
        raise ConvertError(f'{name}: "attack" is "always" or left out, not {attack!r}')
    ncfg = {'zones': zones, 'loop': cfg.get('loop'), 'attack': attack, 'endFade': cfg.get('endFade', END_FADE_S)}
    level_mode = cfg.get('level', 'attack' if 'loop' in cfg or attack == 'always' else 'loop')
    if attack == 'always' and 'loop' not in cfg and level_mode != 'attack':
        raise ConvertError(f'{name}: a note without a loop has no sustain section to measure; use "level": "attack"')
    built = []
    for key in sounding_keys(lo, hi, step_semis):
        y, ls_i, le_i, info = build_note(sf, ncfg, key, velocity)
        y, gain, rms = level_and_gain(y, ls_i, le_i, level_mode == 'attack')
        built.append((key, y, ls_i, le_i, gain, rms, info))
    for key, y, ls_i, le_i, gain, rms, info in built:
        fname = f'{key}.ogg'
        encode_opus(y, os.path.join(out_dir, fname), kbps)
        size = os.path.getsize(os.path.join(out_dir, fname))
        total += size
        lead = f'{key:3d}  {info["sample"]:28s} root {info["root"]:3d} {info["cents"]:+7.1f} ct  len {len(y) / SR:5.2f}s  '
        if ls_i is None:
            notes[str(key)] = {'file': fname, 'gain': round(gain, 4)}
            lines.append(f'{lead}plays once, ends at {info["end_db"]} dB re its loudest 100 ms, faded out over {info["fade"]} s  '
                         f'gain {gain:.3f} (rms {rms:.3f})  {size} B')
            continue
        notes[str(key)] = {'file': fname, 'sustainStart': round(ls_i / SR, 9), 'sustainEnd': round(le_i / SR, 9), 'gain': round(gain, 4)}
        lines.append(f'{lead}loop {ls_i / SR:6.3f}-{le_i / SR:6.3f} ({(le_i - ls_i) / SR:5.3f}s'
                     f'{" x" + str(info["repeats"]) if "repeats" in info else ""})  seam {info["seam"]}'
                     f'{" -> " + str(info["seam_after"]) if "seam_after" in info else ""}'
                     f'{" entry " + str(info["entry_db"]) + " dB, decay " + str(info["decay_db"]) + " dB, end shift " + str(info["shift"]) if "shift" in info else ""}  '
                     f'gain {gain:.3f} (rms {rms:.3f})  {size} B')
    name_text = f'{cfg["name"]}, from {soundfont["title"]}, GM {cfg["gmProgram"]} "{preset_name}"'
    map_json = {'format': 1, **({'attack': 'always'} if attack else {}), 'name': name_text,
                'license': soundfont['license'] + (' ' + cfg['credit'] if 'credit' in cfg else ''), 'source': soundfont['url'], 'notes': notes}
    with open(os.path.join(out_dir, 'map.json'), 'w') as f:
        json.dump(map_json, f, indent=1)
        f.write('\n')
    head = f'{name}: GM {cfg["gmProgram"]} "{preset_name}" bank {bank}, keys {lo}..{hi} step {step_semis}, velocity {velocity}; {len(notes)} notes, {total} bytes'
    if report_dir:
        os.makedirs(report_dir, exist_ok=True)
        with open(os.path.join(report_dir, f'{name}.txt'), 'w') as f:
            f.write('\n'.join([head] + lines) + '\n')
    print(head)
    return total


def inspect(sf, program, bank):
    name, zones = sf.preset(bank, program - 1)
    print(f'GM {program} (bank {bank}): "{name}", {len(zones)} zones')
    for z in sorted(zones, key=lambda z: (z.vels, z.keys)):
        s = z.sample
        start, end, ls, le = z.addresses()
        print(f'  keys {z.keys[0]:3d}-{z.keys[1]:3d} vel {z.vels[0]:3d}-{z.vels[1]:3d}  {s.name:24s} type {s.kind} {s.rate} Hz  root {z.root:3d} {z.cents:+d} ct  '
              f'mode {z.modes}  loop {ls - start}..{le - start} of {end - start}')


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('soundfont')
    ap.add_argument('--config', default=os.path.join(here, 'instruments.json'))
    ap.add_argument('--out', default=os.path.join(here, '..', '..', 'web', 'public', 'samples'))
    ap.add_argument('--only', help='comma-separated instrument ids')
    ap.add_argument('--report', help='folder for one report per instrument (loop points, seams, gains)')
    ap.add_argument('--inspect', type=int, metavar='GM_PROGRAM', help='list the zones of a preset (1-based GM program) and exit')
    ap.add_argument('--skip-sha256', action='store_true', help='do not compare the SoundFont with the SHA-256 in the config')
    a = ap.parse_args()
    config = json.load(open(a.config))
    sha = hashlib.sha256(open(a.soundfont, 'rb').read()).hexdigest()
    if not a.skip_sha256 and sha != config['soundfont']['sha256']:
        sys.exit(f'{a.soundfont}: SHA-256 {sha} is not the {config["soundfont"]["sha256"]} of {config["soundfont"]["title"]}')
    sf = SoundFont(a.soundfont)
    try:
        if a.inspect is not None:
            inspect(sf, a.inspect, config['defaults']['bank'])
            return
        wanted = a.only.split(',') if a.only else list(config['instruments'])
        for name in wanted:
            if name not in config['instruments']:
                sys.exit(f'unknown instrument "{name}"; the config has {", ".join(config["instruments"])}')
            convert_instrument(sf, name, config['instruments'][name], config['defaults'], config['soundfont'], os.path.join(a.out, name), a.report)
    except ConvertError as e:
        sys.exit(f'error: {e}')


main()
