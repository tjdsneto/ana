#!/usr/bin/env python3
"""mix — final soundtrack: voiceover + synthesized UI SFX (+ optional ducked music), mastered to -14 LUFS.

A craft TOOL (not engine code): the render skill calls it. Re-authored from the reference mix.py
(real-ui-launch-film) for this repo — path-driven (--root), music optional. The SFX are made from
numbers (no samples, no licences); a music bed is added only if --music is given, ducked under the
voice. One static gain + a limiter masters the whole mix to the target LUFS (no loudnorm in the chain
— it eats the last seconds).

  python3 craft/tools/mix.py --root <dir> [--music FILE --start 18 --clear 10] [--no-sfx] [--lufs -14]

Reads <root>/media/vo.wav, <root>/src/sfx-cues.json, <root>/src/words.json (duration). Writes
<root>/media/mix.wav (what render should mux) + <root>/media/sfx.wav. Needs ffmpeg + numpy + soundfile.
"""
import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

from sfxgen import GEN, LEAD, SR  # synthesized SFX palette (single source of truth, shared with sfx.py)

ap = argparse.ArgumentParser(description="voiceover + SFX (+ optional music) -> mastered mix.wav")
ap.add_argument("--root", default=".")
ap.add_argument("--music", default=None, help="optional music bed file; omit for VO + SFX only")
ap.add_argument("--start", type=float, default=0.0, help="start offset into the music (s)")
ap.add_argument("--clear", type=float, default=10.0, help="dB the voice sits above the ducked bed")
ap.add_argument("--no-sfx", action="store_true")
ap.add_argument("--lufs", type=float, default=-14.0)
A = ap.parse_args()

ROOT = Path(A.root)
DUR = json.loads((ROOT / "src/words.json").read_text())["duration"] if (ROOT / "src/words.json").exists() \
    else json.loads((ROOT / "media/words.json").read_text())["duration"]
L = int(DUR * SR)
TMP = ROOT / "media/mix-tmp"
TMP.mkdir(parents=True, exist_ok=True)


def ff(*a):
    r = subprocess.run(["ffmpeg", "-v", "error", "-y", *a], capture_output=True, text=True)
    if r.returncode:
        sys.exit(r.stderr)


def fit(x):
    x = np.stack([x, x], 1) if x.ndim == 1 else x
    out = np.zeros((L, 2), np.float32)
    n = min(L, len(x))
    out[:n] = x[:n]
    return out


def band_db(x):  # level in the 300-3400 Hz speech band
    m = x.mean(1)
    f = np.fft.rfft(m)
    fr = np.fft.rfftfreq(len(m), 1 / SR)
    f[(fr < 300) | (fr > 3400)] = 0
    y = np.fft.irfft(f, len(m))
    return 20 * np.log10(np.sqrt(np.mean(np.square(y))) + 1e-9)


# audio tracks plan (build.py), when the film declares an `audio` block: separate voice/music/sfx
# tracks with resolved times. Absent -> the original single-bed path below (back-compat).
PLAN = json.loads((ROOT / "src/audio-plan.json").read_text()) if (ROOT / "src/audio-plan.json").exists() else None


def decode(src, start=0.0):
    """ffmpeg-decode any audio file to SR stereo float32 from `start`s, length <= DUR+1s."""
    out = TMP / f"dec-{abs(hash((str(src), start))) % 10**8}.wav"
    ff("-ss", f"{float(start):.3f}", "-t", f"{DUR + 1:.3f}", "-i", str(src), "-ac", "2", "-ar", str(SR), str(out))
    return fit(sf.read(out, dtype="float32")[0])


def place(buf, x, at=0.0, gain_db=0.0):
    """mix signal x into buf at `at` seconds with gain (dB), clipped to buf length."""
    i = max(0, int(at * SR))
    n = min(len(x), len(buf) - i)
    if n > 0:
        buf[i:i + n] += x[:n] * (10 ** (gain_db / 20))


# ---------- synthesized sound effects (no samples) — palette lives in sfxgen.py (shared with sfx.py)
fx = np.zeros(L, np.float32)
cues = [] if A.no_sfx or not (ROOT / "src/sfx-cues.json").exists() else json.loads((ROOT / "src/sfx-cues.json").read_text())
if PLAN and PLAN.get("sfx") and not A.no_sfx:
    cues = cues + [[c["cue"], c["at"], c.get("gain", -9)] for c in PLAN["sfx"] if c.get("cue")]  # explicit sfx cues from the audio plan
for kind, at, *g in cues:
    if kind not in GEN:
        continue
    s = GEN[kind]().astype(np.float32)
    i = int((at - LEAD.get(kind, 0)) * SR)
    if i < 0:
        s = s[-i:]
        i = 0
    m = min(len(s), L - i)
    if m > 0:
        fx[i:i + m] += s[:m] * (10 ** ((g[0] + 9) / 20) if g else 1.0)  # per-cue gain (dB) relative to the -9 dB sfx bus
sf.write(ROOT / "media/sfx.wav", fx, SR)

def duck_env(voice):
    """a 0..1 envelope that rises while `voice` is speaking (for ducking a bed under it)."""
    k = int(0.02 * SR)
    lev = np.sqrt(np.convolve(np.square(voice[:, 0]), np.ones(k) / k, "same"))
    gate = np.clip((lev - 0.01) / 0.03, 0, 1)
    att, rel = np.exp(-1 / (0.025 * SR)), np.exp(-1 / (0.42 * SR))
    g = np.empty(L)
    acc = 0.0
    for i, v in enumerate(gate):
        c = att if v > acc else rel
        acc = c * acc + (1 - c) * v
        g[i] = acc
    return g


# ---------- voice, (optional) bed, ducking
if PLAN:
    # multi-track: sum voice clip(s), sum music clip(s) ducked under the voice, + SFX
    voclips = PLAN.get("voice") or [{"src": "media/vo.wav", "at": 0, "gain": 0}]
    vo = np.zeros((L, 2), np.float32)
    for c in voclips:
        place(vo, decode(ROOT / c.get("src", "media/vo.wav")), c.get("at", 0), c.get("gain", 0))
    beds = [c for c in PLAN.get("music", []) if c.get("src")]
    if beds:
        tt = np.arange(L) / SR
        duck = (10 ** (-7 * duck_env(vo) / 20))[:, None]                                  # 7 dB dip under the voice
        bedsum = np.zeros((L, 2), np.float32)
        for c in beds:
            b = np.zeros((L, 2), np.float32)
            place(b, decode(ROOT / c["src"], c.get("start", 0)), c.get("at", 0), c.get("gain", 0))
            fi, fo = float(c.get("fade_in", 0.4)), float(c.get("fade_out", 1.6))        # per-clip fades (s); defaults = the old fixed ones
            b *= (np.clip(tt / max(fi, 1e-3), 0, 1) * np.clip((DUR - tt) / max(fo, 1e-3), 0, 1) ** 1.5)[:, None]
            if c.get("duck", True):
                b *= duck
            bedsum += b
        mix = vo + bedsum + fit(fx) * 10 ** (-9 / 20)
    else:
        mix = vo + fit(fx) * 10 ** (-9 / 20)
else:
    vo = fit(sf.read(ROOT / "media/vo.wav", dtype="float32")[0])
    clear = A.clear
    if A.music:
        ff("-ss", f"{A.start:.3f}", "-t", f"{DUR + 1:.3f}", "-i", A.music, "-ac", "2", "-ar", str(SR), str(TMP / "bed.wav"))
        bed = fit(sf.read(TMP / "bed.wav", dtype="float32")[0])
        tt = np.arange(L) / SR
        bed *= (np.clip(tt / 0.4, 0, 1) * np.clip((DUR - tt) / 1.6, 0, 1) ** 1.5)[:, None]   # fade in, 1.6 s fade out
        g = duck_env(vo)
        duck = 10 ** (-7 * g / 20)                                                           # 7 dB dip under the voice
        speech = g > 0.5
        bed_d = bed * duck[:, None]
        clear = band_db(vo[speech]) - band_db(bed_d[speech]) if speech.any() else A.clear
        bed_d *= 10 ** ((clear - A.clear) / 20)
        mix = vo + bed_d + fit(fx) * 10 ** (-9 / 20)
    else:
        mix = vo + fit(fx) * 10 ** (-9 / 20)                                                 # VO + SFX only
sf.write(TMP / "pre.wav", mix, SR)


def lufs(p):
    r = subprocess.run(["ffmpeg", "-i", str(p), "-af", "loudnorm=print_format=json", "-f", "null", "-"], capture_output=True, text=True)
    return float(re.findall(r'"input_i"\s*:\s*"(-?[\d.]+)"', r.stderr)[-1])


gain = A.lufs - lufs(TMP / "pre.wav")
ff("-i", str(TMP / "pre.wav"), "-af", f"volume={gain:.2f}dB,alimiter=limit=0.841:level=disabled", "-ar", str(SR), str(ROOT / "media/mix.wav"))
has_music = bool(A.music) or bool(PLAN and PLAN.get("music"))
tracks = f"plan: {len(PLAN.get('voice') or [1])} voice + {len(PLAN.get('music', []))} music" if PLAN else ('music bed' if A.music else 'no music')
print(f"media/mix.wav: {DUR}s, {tracks}, master {gain:+.2f} dB -> {lufs(ROOT / 'media/mix.wav'):.1f} LUFS, {len(cues)} sfx cues")
