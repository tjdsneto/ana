#!/usr/bin/env python3
"""sfxgen palette: every generator yields sane, non-silent audio — the source of truth for mix.py + sfx.py.

Needs numpy (run under the Kokoro venv python):
  "$KOKORO_PY" craft/tools/tests/test_sfxgen.py   (exit 0 pass / 1 fail), or under pytest.
"""
import importlib.util
import sys
from pathlib import Path

import numpy as np

TOOLS = Path(__file__).resolve().parents[1]


def _load():
    spec = importlib.util.spec_from_file_location("sfxgen", TOOLS / "sfxgen.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_palette():
    m = _load()
    assert set(m.GEN) == {"click", "tick", "pop", "hit", "whoosh", "swish"}
    assert set(m.LEAD) <= set(m.GEN)  # every lead-in names a real sound
    for name, gen in m.GEN.items():
        x = np.asarray(gen(), dtype=np.float32)
        assert x.ndim == 1 and x.size > 0, f"{name}: empty"
        assert np.all(np.isfinite(x)), f"{name}: non-finite samples"
        peak = float(np.max(np.abs(x)))
        assert 0.0 < peak < 2.0, f"{name}: implausible peak {peak}"


if __name__ == "__main__":
    try:
        test_palette()
    except AssertionError as e:
        print(f"SFXGEN FAIL: {e}")
        sys.exit(1)
    print("SFXGEN OK (6 sounds, finite, non-silent)")
