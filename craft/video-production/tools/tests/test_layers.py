#!/usr/bin/env python3
"""Layers: build.py composites film.json `layers` as positioned, word-anchored GSAP elements.

A layer places one asset (slice 1: image | text) on the stage over a word-anchored time range, at an
absolute film-pixel position, with a z-order and an optional authored transform (`move`). This is the
element-composition primitive (see tmp/scene-composition-spec.md). Films with no `layers` must render
byte-identical to before (additive superset) — guarded by test_no_layers_unchanged.

Black-box, same pattern as test_board_parity.py: synthesize a film, run build.py, assert on index.html.
Hermetic: no real JPGs (build.py reads only film.json/shots.json/words.json; layer `src` need not exist).

Run: python3 craft/video-production/tools/tests/test_layers.py   (exit 0 pass / 1 fail), or under pytest.
"""
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

TOOLS = Path(__file__).resolve().parents[1]

BASE = {
    "title": "layers", "size": [1920, 1080], "capture": {"width": 1440},
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
    return (root / "index.html").read_text()


def _payload(html):
    m = re.search(r"const P = (\{.*?\}), K = P\.K;", html, re.S)
    assert m, "could not find P payload in index.html"
    return json.loads(m.group(1))


def test_image_layer_rendered():
    film = dict(BASE, layers=[
        {"kind": "image", "src": "assets/overlays/mascot.png",
         "at": "bravo", "until": "golf", "x": 1360, "y": 72, "w": 460, "z": 15},
    ])
    with tempfile.TemporaryDirectory() as d:
        html = _build(film, d)
    P = _payload(html)
    layers = P.get("LAYERS")
    assert layers, "no LAYERS in payload"
    assert len(layers) == 1, f"expected 1 layer, got {len(layers)}"
    L = layers[0]
    assert L["id"] == "l0", f"autogen id expected 'l0', got {L['id']!r}"
    assert abs(L["in"] - 0.8) < 1e-6, f"in should resolve 'bravo'=0.8, got {L['in']}"
    assert abs(L["out"] - 3.4) < 1e-6, f"out should resolve 'golf'=3.4, got {L['out']}"
    assert "assets/overlays/mascot.png" in html, "image src not in index.html"
    assert "L_l0" in html, "layer element id L_l0 not in index.html"
    assert "left:1360" in html and "top:72" in html, "layer not positioned at x,y"
    assert "z-index:15" in html, "layer z not applied"


def test_no_layers_unchanged():
    """Additivity guard: a film with no `layers` emits no layer container/elements and an empty
    LAYERS payload, with the camera machinery intact."""
    with tempfile.TemporaryDirectory() as d:
        html = _build(dict(BASE), d)
    P = _payload(html)
    assert P.get("LAYERS") == [], f"no-layers film should have empty LAYERS, got {P.get('LAYERS')!r}"
    assert 'id="L_' not in html, "no-layers film should emit no layer elements"
    assert 'id="layers"' not in html, "no-layers film should emit no #layers container"
    assert len(P["CAM"]) == len(BASE["camera"]), "camera machinery must be untouched"


def test_text_layer_rendered():
    film = dict(BASE, layers=[
        {"kind": "text", "text": "Set up in **5 steps**", "at": "Alpha", "until": "hotel", "x": 120, "y": 900, "z": 18},
    ])
    with tempfile.TemporaryDirectory() as d:
        html = _build(film, d)
    assert 'class="layer ltext"' in html, "text layer should be a themed .ltext element"
    assert "<b>5 steps</b>" in html, "text layer should apply md bold"
    L = _payload(html)["LAYERS"][0]
    assert abs(L["in"] - 0.4) < 1e-6 and abs(L["out"] - 3.8) < 1e-6, f"text timing wrong: {L}"


def test_move_authored_transform():
    film = dict(BASE, layers=[
        {"kind": "image", "src": "p.png", "at": "Alpha", "until": "hotel", "x": 0, "y": 0,
         "move": {"to": {"scale": 0.32, "x": 1400, "y": 80}, "at": "charlie", "dur": 0.7, "ease": "power2.inOut"}},
    ])
    with tempfile.TemporaryDirectory() as d:
        html = _build(film, d)
    mv = _payload(html)["LAYERS"][0].get("move")
    assert mv, "move not carried into payload"
    assert abs(mv["at"] - 1.2) < 1e-6, f"move.at should resolve 'charlie'=1.2, got {mv['at']}"
    assert abs(mv["dur"] - 0.7) < 1e-6 and mv["ease"] == "power2.inOut", f"move params wrong: {mv}"
    assert mv["to"]["scale"] == 0.32, f"move.to not carried: {mv}"


def test_video_layer_rendered():
    """A kind=video layer emits a <video> element (not <img>) and carries kind through the payload so
    render.mjs can sync the clip's currentTime to the timeline."""
    film = dict(BASE, layers=[
        {"kind": "video", "src": "assets/overlays/selfie.mp4",
         "at": "Alpha", "until": "hotel", "x": 1360, "y": 72, "w": 460, "z": 16},
    ])
    with tempfile.TemporaryDirectory() as d:
        html = _build(film, d)
    assert '<video class="layer"' in html, "video layer should be a <video> element"
    assert "assets/overlays/selfie.mp4" in html, "video src not in index.html"
    assert 'data-in="0.4"' in html, "video layer must expose its resolved in-time as data-in for render.mjs sync"
    assert "<img" not in html.split('id="layers"')[1].split("</div>")[0] if 'id="layers"' in html else True, \
        "video layer must not emit an <img>"
    L = _payload(html)["LAYERS"][0]
    assert L.get("kind") == "video", f"payload layer must carry kind=video, got {L.get('kind')!r}"


def test_layer_asset_ref():
    """A layer may reference an `assets` entry by id instead of inlining src/text; build.py resolves
    kind + src/text from the asset (the layer's own fields override)."""
    film = dict(BASE,
                assets={
                    "mascot": {"kind": "image", "src": "assets/overlays/mascot.png"},
                    "pres": {"kind": "video", "src": "assets/overlays/pres.mp4"},
                    "hero": {"kind": "text", "text": "**Hi**"},
                },
                layers=[
                    {"asset": "mascot", "at": "Alpha", "until": "bravo", "x": 10, "y": 10},
                    {"asset": "pres", "at": "Echo", "until": "golf", "x": 20, "y": 20},
                    {"asset": "hero", "at": "charlie", "until": "delta", "x": 30, "y": 30},
                ])
    with tempfile.TemporaryDirectory() as d:
        html = _build(film, d)
    assert "assets/overlays/mascot.png" in html, "image asset src not resolved"
    assert '<video class="layer"' in html and "assets/overlays/pres.mp4" in html, "video asset not resolved"
    assert "<b>Hi</b>" in html, "text asset not resolved"


def test_layer_asset_unknown():
    """A layer referencing an asset id that isn't in `assets` fails the build, naming the id."""
    film = dict(BASE, assets={}, layers=[{"asset": "ghost", "at": "Alpha", "until": "bravo", "x": 0, "y": 0}])
    with tempfile.TemporaryDirectory() as d:
        root = Path(d)
        (root / "src").mkdir(parents=True, exist_ok=True)
        (root / "media").mkdir(parents=True, exist_ok=True)
        (root / "film.json").write_text(json.dumps(film))
        (root / "src/shots.json").write_text(json.dumps(SHOTS))
        (root / "media/words.json").write_text(json.dumps(WORDS))
        r = subprocess.run([sys.executable, str(TOOLS / "build.py"), "--root", str(root)],
                           capture_output=True, text=True)
    assert r.returncode != 0, "unknown asset id should fail the build"
    assert "ghost" in r.stderr, f"error should name the missing asset id; got: {r.stderr!r}"


def test_layer_ids_autogen():
    film = dict(BASE, layers=[
        {"kind": "image", "src": "a.png", "at": "Alpha", "until": "bravo", "x": 0, "y": 0},
        {"kind": "image", "src": "b.png", "at": "Echo", "until": "golf", "x": 0, "y": 0},
    ])
    with tempfile.TemporaryDirectory() as d:
        html = _build(film, d)
    ids = [L["id"] for L in _payload(html)["LAYERS"]]
    assert ids == ["l0", "l1"], f"autogen ids should be l0,l1, got {ids}"


if __name__ == "__main__":
    tests = [test_image_layer_rendered, test_no_layers_unchanged, test_text_layer_rendered,
             test_move_authored_transform, test_video_layer_rendered,
             test_layer_asset_ref, test_layer_asset_unknown, test_layer_ids_autogen]
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
    print(f"LAYERS OK ({len(tests)} tests)")
