#!/usr/bin/env python3
"""gemini-image.py pure helpers: key resolution + URL + payload + inline-image decode — no network.

Stdlib only, runs under any python3.
  python3 craft/tools/tests/test_gemini_image.py   (exit 0 pass / 1 fail), or under pytest.
"""
import base64
import importlib.util
import os
import sys
import tempfile
from pathlib import Path

TOOLS = Path(__file__).resolve().parents[1]


def _load():
    spec = importlib.util.spec_from_file_location("gemini_image", TOOLS / "image" / "gemini-image.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_build_url():
    m = _load()
    assert m.build_url("gemini-2.5-flash-image").endswith("/models/gemini-2.5-flash-image:generateContent")


def test_build_payload():
    m = _load()
    p = m.build_payload("a glossy icon")
    assert p["contents"][0]["parts"][0]["text"] == "a glossy icon"
    assert p["generationConfig"]["responseModalities"] == ["IMAGE"]


def test_image_bytes():
    m = _load()
    raw = b"\x89PNG\r\n\x1a\n fake"
    b64 = base64.b64encode(raw).decode()
    resp = {"candidates": [{"content": {"parts": [
        {"text": "here you go"},
        {"inlineData": {"mimeType": "image/png", "data": b64}},
    ]}}]}
    assert m.image_bytes(resp) == raw
    # snake_case variant the API sometimes uses
    resp2 = {"candidates": [{"content": {"parts": [{"inline_data": {"data": b64}}]}}]}
    assert m.image_bytes(resp2) == raw
    # text-only answer (no image part) -> ValueError
    for bad in ({}, {"candidates": []}, {"candidates": [{"content": {"parts": [{"text": "sorry"}]}}]}):
        try:
            m.image_bytes(bad)
            raise AssertionError(f"expected ValueError for {bad!r}")
        except ValueError:
            pass


def test_resolve_key():
    m = _load()
    assert m.resolve_key("v", None, env_names=("GEM_IMG_UNSET",)) == "v"
    with tempfile.TemporaryDirectory() as td:
        f = Path(td) / "k"
        f.write_text("fromfile\n")
        assert m.resolve_key("v", str(f), env_names=("GEM_IMG_UNSET",)) == "fromfile"  # file wins
    os.environ["GEM_IMG_TEST_KEY"] = "envk"
    try:
        # falls back through the env-name list in order
        assert m.resolve_key(None, None, env_names=("GEM_IMG_UNSET", "GEM_IMG_TEST_KEY")) == "envk"
    finally:
        del os.environ["GEM_IMG_TEST_KEY"]
    assert m.resolve_key(None, None, env_names=("GEM_IMG_DEFINITELY_UNSET",)) is None


if __name__ == "__main__":
    try:
        test_build_url()
        test_build_payload()
        test_image_bytes()
        test_resolve_key()
    except AssertionError as e:
        print(f"GEMINI-IMAGE FAIL: {e}")
        sys.exit(1)
    print("GEMINI-IMAGE OK (build_url / build_payload / image_bytes / resolve_key)")
