#!/usr/bin/env python3
"""Audio tracks: build.py resolves a film.json `audio` block into src/audio-plan.json — separate
voice / music / sfx tracks with word-anchored times resolved to seconds, for mix.py to sum.

Black-box, same pattern as test_layers.py: synthesize a film, run build.py, assert on the plan.
Hermetic: build.py reads only film.json/shots.json/words.json; audio `src` need not exist.

Run: python3 craft/video-production/tools/tests/test_audio.py   (exit 0 pass / 1 fail), or under pytest.
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

TOOLS = Path(__file__).resolve().parents[1]

BASE = {
    "title": "audio", "size": [1920, 1080], "capture": {"width": 1440},
    "script": ["Alpha bravo charlie delta.", "Echo foxtrot golf hotel."],
    "plates": {"p": {"url": "x"}}, "marks": {},
    "camera": [
        {"at": "Alpha", "plate": "p", "zoom": 1.1, "focus": [720, 400]},
        {"at": "Echo", "plate": "p", "zoom": 1.1, "focus": [720, 1200], "glide": 0.6},
    ],
    "outro": {"at": "line:2", "text": "x"},
}
SHOTS = {"p": {"_h": 3000}}
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


def _build(film, d):
    root = Path(d)
    (root / "src").mkdir(parents=True, exist_ok=True)
    (root / "media").mkdir(parents=True, exist_ok=True)
    (root / "film.json").write_text(json.dumps(film))
    (root / "src/shots.json").write_text(json.dumps(SHOTS))
    (root / "media/words.json").write_text(json.dumps(WORDS))
    r = subprocess.run([sys.executable, str(TOOLS / "build.py"), "--root", str(root)],
                       capture_output=True, text=True)
    assert r.returncode == 0, f"build.py failed: {r.stderr}"
    return root


def test_audio_plan_resolved():
    film = dict(BASE, audio={
        "music": [{"src": "media/music.mp3", "at": "bravo", "gain": -10, "duck": True, "start": 18}],
        "sfx": [{"cue": "whoosh", "at": "golf"}],
    })
    with tempfile.TemporaryDirectory() as d:
        root = _build(film, d)
        plan = json.loads((root / "src/audio-plan.json").read_text())
    m = plan["music"][0]
    assert abs(m["at"] - 0.8) < 1e-6, f"music.at should resolve 'bravo'=0.8, got {m['at']}"
    assert m["gain"] == -10 and m["duck"] is True and m["start"] == 18, f"music fields lost: {m}"
    assert m["src"] == "media/music.mp3", f"music src lost: {m}"
    s = plan["sfx"][0]
    assert s["cue"] == "whoosh" and abs(s["at"] - 3.4) < 1e-6, f"sfx should resolve 'golf'=3.4: {s}"


def test_no_audio_no_plan():
    """Back-compat: a film with no `audio` writes no audio-plan.json (mix.py falls back to today's path)."""
    with tempfile.TemporaryDirectory() as d:
        root = _build(dict(BASE), d)
        assert not (root / "src/audio-plan.json").exists(), "no-audio film must not emit an audio plan"


if __name__ == "__main__":
    tests = [test_audio_plan_resolved, test_no_audio_no_plan]
    failed = 0
    for t in tests:
        try:
            t()
            print(f"  ok  {t.__name__}")
        except AssertionError as e:
            print(f"FAIL  {t.__name__}: {e}")
            failed += 1
    if failed:
        sys.exit(1)
    print(f"AUDIO OK ({len(tests)} tests)")
