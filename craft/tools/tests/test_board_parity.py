#!/usr/bin/env python3
"""Parity: storyboard-board.py's camera math must equal build.py's.

The board previews each beat by cropping the capture to the window the RENDER will frame. If the two
tools' camera math drift, the board becomes a lie. This test synthesizes a tiny film, runs build.py
(the renderer's source of truth), reads the clamped camera keyframes it embeds in index.html
(P.CAM[i].a = [x, y, z]), and asserts storyboard-board.beat_window() produces the same values.

Hermetic: no runtime artifacts, no real JPGs (build.py reads only film.json/shots.json/words.json).

Run: python3 craft/tools/tests/test_board_parity.py   (exit 0 pass / 1 fail), or under pytest.
"""
import importlib.util
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

TOOLS = Path(__file__).resolve().parents[1]

FILM = {
    "title": "parity", "size": [1920, 1080], "capture": {"width": 1440},
    "script": ["Alpha bravo charlie delta.", "Echo foxtrot golf hotel."],
    "plates": {"p": {"url": "x"}},
    "marks": {"m": "sel"},
    "camera": [
        {"at": "Alpha", "plate": "p", "zoom": 1.5, "focus": [700, 400]},
        {"at": "charlie", "plate": "p", "zoom": 1.7, "focus": "m", "glide": 1.0},
        {"at": "Echo", "plate": "p", "zoom": 1.3, "focus": [200, 5800]},  # exercises clamping at edges
        {"at": "golf", "plate": "p", "zoom": 1.0, "focus": [720, 3000], "glide": 0.8},
    ],
    "outro": {"at": "line:2", "text": "x"},
}
SHOTS = {"p": {"m": [400, 2000, 800, 40], "_h": 6000}}
WORDS = {"duration": 6.0, "words": [
    {"text": "Alpha", "start": 0.4, "end": 0.8, "line": 1},
    {"text": "bravo", "start": 0.8, "end": 1.2, "line": 1},
    {"text": "charlie", "start": 1.2, "end": 1.6, "line": 1},
    {"text": "delta.", "start": 1.6, "end": 2.0, "line": 1},
    {"text": "Echo", "start": 2.6, "end": 3.0, "line": 2},
    {"text": "foxtrot", "start": 3.0, "end": 3.4, "line": 2},
    {"text": "golf", "start": 3.4, "end": 3.8, "line": 2},
    {"text": "hotel.", "start": 3.8, "end": 4.4, "line": 2},
]}


def _load_board_module():
    spec = importlib.util.spec_from_file_location("sb", TOOLS / "storyboard-board.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # side-effect free: main() only runs under __main__
    return mod


def _build_cam(root):
    (root / "src").mkdir(parents=True, exist_ok=True)
    (root / "media").mkdir(parents=True, exist_ok=True)
    (root / "film.json").write_text(json.dumps(FILM))
    (root / "src/shots.json").write_text(json.dumps(SHOTS))
    (root / "media/words.json").write_text(json.dumps(WORDS))
    r = subprocess.run([sys.executable, str(TOOLS / "build.py"), "--root", str(root)],
                       capture_output=True, text=True)
    assert r.returncode == 0, f"build.py failed: {r.stderr}"
    hx = (root / "index.html").read_text()
    m = re.search(r"const P = (\{.*?\}), K = P\.K;", hx, re.S)
    assert m, "could not find P payload in index.html"
    return [k["a"] for k in json.loads(m.group(1))["CAM"]]


def test_board_parity():
    sb = _load_board_module()
    with tempfile.TemporaryDirectory() as d:
        root = Path(d)
        theirs = _build_cam(root)
        g = sb.geometry(FILM)
        mine = [sb.beat_window(g, SHOTS, c)[3] for c in FILM["camera"]]
    assert len(mine) == len(theirs), f"beat count {len(mine)} != {len(theirs)}"
    for i, (a, b) in enumerate(zip(mine, theirs)):
        assert all(abs(x - y) < 0.05 for x, y in zip(a, b)), f"beat {i}: board {a} != build {b}"


if __name__ == "__main__":
    try:
        test_board_parity()
    except AssertionError as e:
        print(f"PARITY FAIL: {e}")
        sys.exit(1)
    print("PARITY OK (board camera math == build.py)")
