#!/usr/bin/env python3
"""Derive linkable slice-chunks from CRAFT-BAR.md (the canonical source).

CRAFT-BAR.md stays the single hand-edited source of truth that 30+ skills read whole by path. This
tool slices it into per-section chunk files under references/craft-bar/ so a reviewer (or a producer)
can link ONLY the slice it needs — §A1 frame, §A3 anti-slop, the §B-launch profile — instead of the
whole 84-line doc. The slices are contiguous byte-exact substrings, so concatenating them in order
reproduces the original exactly; `--check` asserts that and fails if a chunk has drifted from source.

The per-deliverable chunks (deliverable-*.md) are NOT slices of CRAFT-BAR.md — they are hand-authored
addenda and this tool leaves them untouched.

Usage:
    python3 split.py          # (re)write the slice-chunks from CRAFT-BAR.md
    python3 split.py --check   # assert the chunks on disk match CRAFT-BAR.md (CI/pre-commit gate)
"""

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REFS = HERE.parent.parent / ".claude/references"
SRC = REFS / "CRAFT-BAR.md"
OUT = REFS / "craft-bar"

# (marker that starts a segment, chunk filename). The first segment is everything before the first
# marker (the preamble). Markers are matched as literal substrings, in order.
SEGMENTS = [
    ("## A. Universal taste bar", "a0-universal-header.md"),
    ("### A1.", "a1-frame.md"),
    ("### A2.", "a2-proof.md"),
    ("### A3.", "a3-slop.md"),
    ("### A4.", "a4-pacing.md"),
    ("### A5.", "a5-sound.md"),
    ("## B. Per-type structure", "b0-pertype-header.md"),
    ("### B-launch", "b-launch.md"),
    ("### B-demo", "b-demo.md"),
    ("### B-teaser", "b-teaser.md"),
    ("### B-explainer", "b-explainer.md"),
    ("## How reviewers use this", "how-reviewers-use.md"),
]
PREAMBLE = "00-preamble.md"


def slice_source():
    """Return [(filename, text)] of contiguous byte-exact slices whose concat == the source."""
    text = SRC.read_text()
    bounds = []
    for marker, fname in SEGMENTS:
        i = text.index(marker)  # raises if a marker is missing — a loud, correct failure
        bounds.append((i, fname))
    offsets = [0] + [i for i, _ in bounds] + [len(text)]
    names = [PREAMBLE] + [f for _, f in bounds]
    return [(names[k], text[offsets[k]:offsets[k + 1]]) for k in range(len(names))]


def main():
    check = "--check" in sys.argv
    slices = slice_source()
    assert "".join(t for _, t in slices) == SRC.read_text(), "roundtrip mismatch — markers are wrong"
    OUT.mkdir(exist_ok=True)
    drift = []
    for fname, body in slices:
        p = OUT / fname
        if check:
            if not p.exists() or p.read_text() != body:
                drift.append(fname)
        else:
            p.write_text(body)
    if check:
        if drift:
            print("DRIFT — these chunks differ from CRAFT-BAR.md:", ", ".join(drift))
            sys.exit(1)
        print(f"OK — {len(slices)} slice-chunks in sync with CRAFT-BAR.md")
    else:
        print(f"wrote {len(slices)} slice-chunks to {OUT}")


if __name__ == "__main__":
    main()
