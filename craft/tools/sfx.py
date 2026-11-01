#!/usr/bin/env python3
"""sfx — produce ONE synthesized UI sound effect as a wav (no samples, no licences).

A craft tool: the standalone sibling of mix.py's in-film SFX. Both draw the palette from sfxgen.py, so
"produce a whoosh" gives the same sound the render would place. Local, keyless, instant.

  python3 craft/tools/sfx.py whoosh --out whoosh.wav [--gain-db -3]
  python3 craft/tools/sfx.py --list          # print the available sound names

Names: click · tick · pop · hit · whoosh · swish. Output is 48 kHz mono, peak-guarded against clipping.
Needs numpy + soundfile (run under the Kokoro venv python, like vo.py / mix.py).
"""
import argparse
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

from sfxgen import GEN, SR


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="produce one synthesized UI sound effect as a wav")
    p.add_argument("name", nargs="?", help=f"sound to produce ({', '.join(sorted(GEN))})")
    p.add_argument("--out", default=None, help="wav to write (required unless --list)")
    p.add_argument("--gain-db", type=float, default=0.0, help="level trim in dB (default 0)")
    p.add_argument("--list", action="store_true", help="print the available sound names and exit")
    return p.parse_args()


def main() -> None:
    a = parse_args()
    if a.list:
        print(" ".join(sorted(GEN)))
        return
    if not a.name or a.name not in GEN:
        sys.exit(f"sfx: pick a sound name ({', '.join(sorted(GEN))}); got {a.name!r}. Use --list.")
    if not a.out:
        sys.exit("sfx: --out is required")

    x = GEN[a.name]().astype(np.float32)
    if a.gain_db:
        x = x * (10 ** (a.gain_db / 20))
    peak = float(np.max(np.abs(x))) if x.size else 0.0
    if peak > 1.0:  # guard against clipping after a gain boost
        x = x / peak

    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(out), x, SR)
    print(f"sfx: {a.name} {len(x) / SR:.2f}s -> {out}")


if __name__ == "__main__":
    main()
