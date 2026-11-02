#!/usr/bin/env python3
"""image.py pure helpers: request parsing, provider/model resolution, stub SVG, provenance — no I/O.

Stdlib only, runs under any python3.
  python3 craft/tools/tests/test_image.py   (exit 0 pass / 1 fail), or under pytest.
"""
import importlib.util
import sys
from pathlib import Path

TOOLS = Path(__file__).resolve().parents[1]


def _load():
    spec = importlib.util.spec_from_file_location("image_tool", TOOLS / "image.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # side-effect free: main() only runs under __main__
    return mod


def test_parse_request():
    m = _load()
    assert m.parse_request(None) == ("none", "")
    assert m.parse_request("   ") == ("none", "")
    assert m.parse_request("generate: a glossy icon") == ("generate", "a glossy icon")
    assert m.parse_request("library:icon-grid") == ("library", "icon-grid")
    assert m.parse_request("file:assets/logo.png") == ("file", "assets/logo.png")
    assert m.parse_request("assets/logo.PNG") == ("file", "assets/logo.PNG")  # ext detection, case-insensitive
    assert m.parse_request("a dark launch key visual") == ("generate", "a dark launch key visual")  # bare = prompt


def test_resolve_provider():
    m = _load()
    assert m.resolve_provider(None, env={}) == "stub"                       # default
    assert m.resolve_provider("GEMINI", env={}) == "gemini"                 # arg wins, lowercased
    assert m.resolve_provider(None, env={"IMAGE_PROVIDER": "openai"}) == "openai"  # env fallback
    assert m.resolve_provider("stub", env={"IMAGE_PROVIDER": "openai"}) == "stub"  # arg over env


def test_resolve_model():
    m = _load()
    assert m.resolve_model(None, "openai", env={}) == "gpt-image-1"         # provider default
    assert m.resolve_model(None, "gemini", env={}) == "gemini-2.5-flash-image"
    assert m.resolve_model("x-model", "openai", env={}) == "x-model"        # arg wins
    assert m.resolve_model(None, "openai", env={"IMAGE_MODEL": "env-model"}) == "env-model"
    assert m.resolve_model(None, "stub", env={}) is None                    # no default for stub
    assert m.resolve_model(None, "custom", env={}) is None


def test_pick_image():
    m = _load()
    manifest = [
        {"file": "a.png", "tags": "icon grid dark", "prompt": "a grid of app icons"},
        {"file": "b.png", "tags": "map", "prompt": "dotted world map"},
    ]
    assert m.pick_image(manifest, "grid")["file"] == "a.png"
    assert m.pick_image(manifest, "WORLD")["file"] == "b.png"               # case-insensitive, matches prompt
    assert m.pick_image(manifest, "nonexistent") is None


def test_stub_svg():
    m = _load()
    svg = m.stub_svg("a glossy icon", "800x600")
    assert svg.startswith("<svg") and 'width="800"' in svg and 'height="600"' in svg
    assert "IMAGE STUB" in svg and "a glossy icon" in svg
    # square shorthand + prompt escaping
    sq = m.stub_svg("a & b <tag>", "512")
    assert 'width="512"' in sq and 'height="512"' in sq
    assert "&amp;" in sq and "&lt;tag&gt;" in sq and "<tag>" not in sq.replace("<svg", "").replace("</svg>", "")


def test_provenance():
    m = _load()
    p = m.provenance("gemini", "gemini-2.5-flash-image", "a prompt", "1024x1024")
    assert p["provider"] == "gemini" and p["model"] == "gemini-2.5-flash-image"
    assert p["prompt"] == "a prompt" and p["size"] == "1024x1024"
    assert "T" in p["created"]  # ISO-8601 timestamp


if __name__ == "__main__":
    try:
        test_parse_request()
        test_resolve_provider()
        test_resolve_model()
        test_pick_image()
        test_stub_svg()
        test_provenance()
    except AssertionError as e:
        print(f"IMAGE FAIL: {e}")
        sys.exit(1)
    print("IMAGE OK (parse_request / resolve_provider / resolve_model / pick_image / stub_svg / provenance)")
