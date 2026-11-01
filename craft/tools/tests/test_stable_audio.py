#!/usr/bin/env python3
"""stable-audio.py pure helpers: request fields, multipart encoding, key resolution — no network.

Stdlib only, runs under any python3.
  python3 craft/tools/tests/test_stable_audio.py   (exit 0 pass / 1 fail), or under pytest.
"""
import importlib.util
import os
import sys
import tempfile
from pathlib import Path

TOOLS = Path(__file__).resolve().parents[1]


def _load():
    spec = importlib.util.spec_from_file_location("stable_audio", TOOLS / "music" / "stable-audio.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_build_fields():
    m = _load()
    f = dict(m.build_fields("warm pad", 12.4, "mp3", "stable-audio-2.5", None))
    assert f["prompt"] == "warm pad"
    assert f["duration"] == "12"           # rounded to int seconds, stringified
    assert f["output_format"] == "mp3"
    assert f["model"] == "stable-audio-2.5"
    assert "steps" not in f                # omitted when None
    assert dict(m.build_fields("x", 8, "wav", "m", 50))["steps"] == "50"


def test_multipart_encode():
    m = _load()
    body, ctype = m.multipart_encode([("prompt", "hello world"), ("duration", "8")])
    assert ctype.startswith("multipart/form-data; boundary=")
    boundary = ctype.split("boundary=", 1)[1]
    text = body.decode("utf-8")
    assert f"--{boundary}\r\n" in text
    assert 'Content-Disposition: form-data; name="prompt"' in text
    assert "hello world" in text
    assert text.rstrip().endswith(f"--{boundary}--")  # closing delimiter


def test_resolve_key():
    m = _load()
    assert m.resolve_key("v", None, "SA_UNSET_X") == "v"
    with tempfile.TemporaryDirectory() as td:
        f = Path(td) / "k"
        f.write_text("fromfile\n")
        assert m.resolve_key("v", str(f), "SA_UNSET_X") == "fromfile"
    os.environ["SA_TEST_KEY"] = "envk"
    try:
        assert m.resolve_key(None, None, "SA_TEST_KEY") == "envk"
    finally:
        del os.environ["SA_TEST_KEY"]
    assert m.resolve_key(None, None, "SA_DEFINITELY_UNSET") is None


if __name__ == "__main__":
    try:
        test_build_fields()
        test_multipart_encode()
        test_resolve_key()
    except AssertionError as e:
        print(f"STABLE-AUDIO FAIL: {e}")
        sys.exit(1)
    print("STABLE-AUDIO OK (build_fields / multipart_encode / resolve_key)")
