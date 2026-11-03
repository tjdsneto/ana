#!/usr/bin/env python3
"""openai-image.py pure helpers: key resolution + request payload + b64 decode — without the network.

The tool POSTs a prompt to the OpenAI Images API; the decisions before the call (build the body, read
the key) and after (decode data[0].b64_json) are pure and pinned here. The HTTP call itself is thin I/O.

Stdlib only, so this runs under any python3.
  python3 craft/video-production/tools/tests/test_openai_image.py   (exit 0 pass / 1 fail), or under pytest.
"""
import base64
import importlib.util
import os
import sys
import tempfile
from pathlib import Path

TOOLS = Path(__file__).resolve().parents[1]


def _load():
    spec = importlib.util.spec_from_file_location("openai_image", TOOLS / "image" / "openai-image.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_build_payload():
    m = _load()
    p = m.build_payload("a glossy icon", "gpt-image-1", "1024x1024")
    assert p == {"model": "gpt-image-1", "prompt": "a glossy icon", "size": "1024x1024", "n": 1}
    # no response_format is ever sent (gpt-image-1 rejects it)
    assert "response_format" not in p


def test_image_bytes():
    m = _load()
    raw = b"\x89PNG\r\n\x1a\n fake"
    resp = {"data": [{"b64_json": base64.b64encode(raw).decode()}]}
    assert m.image_bytes(resp) == raw
    # empty / malformed -> ValueError, not a silent empty file
    for bad in ({}, {"data": []}, {"data": [{}]}):
        try:
            m.image_bytes(bad)
            raise AssertionError(f"expected ValueError for {bad!r}")
        except ValueError:
            pass


def test_resolve_key():
    m = _load()
    assert m.resolve_key("v", None, "OAI_IMG_UNSET") == "v"
    with tempfile.TemporaryDirectory() as td:
        f = Path(td) / "k"
        f.write_text("fromfile\n")                                   # trailing newline stripped
        assert m.resolve_key("v", str(f), "OAI_IMG_UNSET") == "fromfile"  # file wins over value
    os.environ["OAI_IMG_TEST_KEY"] = "envk"
    try:
        assert m.resolve_key(None, None, "OAI_IMG_TEST_KEY") == "envk"
    finally:
        del os.environ["OAI_IMG_TEST_KEY"]
    assert m.resolve_key(None, None, "OAI_IMG_DEFINITELY_UNSET") is None


if __name__ == "__main__":
    try:
        test_build_payload()
        test_image_bytes()
        test_resolve_key()
    except AssertionError as e:
        print(f"OPENAI-IMAGE FAIL: {e}")
        sys.exit(1)
    print("OPENAI-IMAGE OK (build_payload / image_bytes / resolve_key)")
