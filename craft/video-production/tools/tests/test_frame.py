#!/usr/bin/env python3
"""Frame: build.py wraps the product window in a device shell when film.json sets `frame`.

`frame` selects the chrome drawn around the viewport. Absent (or "browser") = the current path
(a browser window, or a full-bleed board when there is no url) — unchanged. "laptop" wraps that
window in a laptop bezel + deck, scaled to fit the stage; the camera runs inside the screen exactly
as before (laptop is landscape, so no camera-math change). "phone"/"tablet" are reserved for the
next slice (portrait reflow) and must fail loudly until implemented, never render a wrong frame.

Black-box, same pattern as test_layers.py: synthesize a film, run build.py, assert on index.html.
Films with no `frame` must emit no device markup (additive superset) — guarded by test_no_frame_unchanged.

Run: python3 craft/video-production/tools/tests/test_frame.py   (exit 0 pass / 1 fail), or under pytest.
"""
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

TOOLS = Path(__file__).resolve().parents[1]

BASE = {
    "title": "frame", "size": [1920, 1080], "capture": {"width": 1440},
    "url": "https://example.test/app",
    "script": ["Alpha bravo charlie delta.", "Echo foxtrot golf hotel."],
    "plates": {"p": {"url": "x"}},
    "marks": {},
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


def _run(film, d):
    root = Path(d)
    (root / "src").mkdir(parents=True, exist_ok=True)
    (root / "media").mkdir(parents=True, exist_ok=True)
    (root / "film.json").write_text(json.dumps(film))
    (root / "src/shots.json").write_text(json.dumps(SHOTS))
    (root / "media/words.json").write_text(json.dumps(WORDS))
    return subprocess.run([sys.executable, str(TOOLS / "build.py"), "--root", str(root)],
                          capture_output=True, text=True)


def _build(film, d):
    r = _run(film, d)
    assert r.returncode == 0, f"build.py failed: {r.stderr}"
    return (Path(d) / "index.html").read_text()


def _payload(html):
    m = re.search(r"const P = (\{.*?\}), K = P\.K;", html, re.S)
    assert m, "could not find P payload in index.html"
    return json.loads(m.group(1))


def test_laptop_shell_rendered():
    film = dict(BASE, frame="laptop")
    with tempfile.TemporaryDirectory() as d:
        html = _build(film, d)
    assert 'id="device"' in html, "laptop film should emit a #device wrapper"
    assert "laptop" in html, "device wrapper should carry the laptop class"
    assert 'class="lid"' in html, "laptop should draw a screen lid"
    assert 'class="deck"' in html, "laptop should draw a base deck"
    assert 'class="win' in html, "the browser window must still be present inside the laptop screen"
    assert _payload(html).get("FRAME") == "laptop", "payload must carry FRAME=laptop"


def test_no_frame_unchanged():
    """Additivity guard: a film with no `frame` emits no device wrapper, a falsy FRAME payload, the
    browser window path intact, and the camera machinery untouched."""
    with tempfile.TemporaryDirectory() as d:
        html = _build(dict(BASE), d)
    P = _payload(html)
    assert not P.get("FRAME"), f"no-frame film should have falsy FRAME, got {P.get('FRAME')!r}"
    assert 'id="device"' not in html, "no-frame film should emit no #device wrapper"
    assert 'class="deck"' not in html, "no-frame film should draw no deck"
    assert 'class="win' in html, "no-frame film with a url must keep the browser window"
    assert len(P["CAM"]) == len(BASE["camera"]), "camera machinery must be untouched"


def test_browser_frame_is_baseline():
    """An explicit frame:"browser" is the current behavior — no device wrapper."""
    with tempfile.TemporaryDirectory() as d:
        html = _build(dict(BASE, frame="browser"), d)
    assert 'id="device"' not in html, "frame:browser should not wrap a device shell"


def test_phone_not_implemented_yet():
    """phone/tablet are reserved for the portrait slice; they must fail loudly, never mis-render."""
    with tempfile.TemporaryDirectory() as d:
        r = _run(dict(BASE, frame="phone"), d)
    assert r.returncode != 0, "frame:phone should fail until the portrait slice lands"
    assert "phone" in r.stderr and "not" in r.stderr.lower(), f"error should name phone as unimplemented; got: {r.stderr!r}"


def test_unknown_frame_rejected():
    with tempfile.TemporaryDirectory() as d:
        r = _run(dict(BASE, frame="hologram"), d)
    assert r.returncode != 0, "an unknown frame value should fail the build"
    assert "hologram" in r.stderr, f"error should name the bad frame value; got: {r.stderr!r}"


if __name__ == "__main__":
    tests = [test_laptop_shell_rendered, test_no_frame_unchanged, test_browser_frame_is_baseline,
             test_phone_not_implemented_yet, test_unknown_frame_rejected]
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
    print(f"FRAME OK ({len(tests)} tests)")
