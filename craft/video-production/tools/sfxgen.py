#!/usr/bin/env python3
"""sfxgen — synthesized UI sound effects from numbers (no samples, no licences).

The single source of truth for the craft's SFX palette. Two tools draw on it: `mix.py` embeds the
sounds into a film's timeline at word-anchored cues; `sfx.py` emits one sound standalone ("produce a
whoosh"). The formulas were authored in mix.py (reference: real-ui-launch-film) and hoisted here so
both callers stay identical.

Each generator returns a float array at SR (48 kHz, mono), peak roughly < 1.0. `rng` is a fixed-seed
PRNG so the noise-based sounds (click/hit/whoosh) are reproducible.
"""
import numpy as np

SR = 48000  # composition sample rate
rng = np.random.default_rng(7)


def t(d):
    return np.arange(int(d * SR)) / SR


def env(n, a, d):
    return np.minimum(np.arange(n) / max(1, a * SR), 1) * np.exp(-np.arange(n) / (d * SR))


def lp(x, k):
    y = np.empty_like(x)
    acc = 0.0
    for i, v in enumerate(x):
        acc += k * (v - acc)
        y[i] = acc
    return y


def click():
    x = t(0.06)
    return (np.sin(2 * np.pi * 2400 * x) * env(len(x), 0.0002, 0.006) + rng.standard_normal(len(x)) * env(len(x), 0.0002, 0.003) * 0.4) * 0.5


def tick():
    x = t(0.05)
    return np.sin(2 * np.pi * 1800 * x) * env(len(x), 0.0002, 0.008) * 0.35


def pop():
    x = t(0.12)
    f = 900 * np.exp(-x * 30) + 380
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * env(len(x), 0.001, 0.03) * 0.45


def hit():
    x = t(0.4)
    f = 200 * np.exp(-x * 12) + 55
    return (np.sin(2 * np.pi * np.cumsum(f) / SR) * env(len(x), 0.001, 0.1) + lp(rng.standard_normal(len(x)), 0.3) * env(len(x), 0.0005, 0.03) * 0.5) * 0.7


def whoosh(d=0.6):
    x = t(d)
    n = rng.standard_normal(len(x))
    k = 0.02 + 0.3 * np.sin(np.pi * x / d) ** 2
    y = np.empty_like(n)
    acc = 0.0
    for i, v in enumerate(n):
        acc += k[i] * (v - acc)
        y[i] = acc
    return y * np.sin(np.pi * x / d) ** 1.5 * 0.5


def swish():
    return whoosh(0.35) * 0.8


GEN = {"click": click, "tick": tick, "pop": pop, "hit": hit, "whoosh": whoosh, "swish": swish}
LEAD = {"whoosh": 0.3, "swish": 0.18}  # sweeps peak on the cut, so they start a little before it
