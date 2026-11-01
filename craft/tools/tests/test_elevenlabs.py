#!/usr/bin/env python3
"""elevenlabs.py pure helpers: voice mapping, payload, key resolution — without the network.

Stdlib only, runs under any python3.
  python3 craft/tools/tests/test_elevenlabs.py   (exit 0 pass / 1 fail), or under pytest.
"""
import importlib.util
import os
import sys
import tempfile
from pathlib import Path

TOOLS = Path(__file__).resolve().parents[1]


def _load():
    spec = importlib.util.spec_from_file_location("elevenlabs", TOOLS / "tts" / "elevenlabs.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_pick_voice():
    m = _load()
    assert m.pick_voice("rachel") == (m.KNOWN_VOICES["rachel"], None)   # friendly name -> id
    assert m.pick_voice("ADAM") == (m.KNOWN_VOICES["adam"], None)       # case-insensitive
    raw = "abcdefghijklmnopqrst12"                                      # >=20 chars, no space -> trusted id
    assert m.pick_voice(raw) == (raw, None)
    v, note = m.pick_voice("af_heart")                                 # a kokoro id -> default + note
    assert v == m.KNOWN_VOICES[m.DEFAULT_VOICE] and note
    assert m.pick_voice(None) == (m.KNOWN_VOICES[m.DEFAULT_VOICE], None)


def test_build_payload():
    m = _load()
    p = m.build_payload("hello", "eleven_multilingual_v2", 0.95)
    assert p["text"] == "hello" and p["model_id"] == "eleven_multilingual_v2"
    assert p["voice_settings"]["speed"] == 0.95
    # speed clamped into the 0.7-1.2 window
    assert m.build_payload("x", "m", 2.0)["voice_settings"]["speed"] == 1.2
    assert m.build_payload("x", "m", 0.1)["voice_settings"]["speed"] == 0.7


def test_resolve_key():
    m = _load()
    assert m.resolve_key("v", None, "EL_UNSET_X") == "v"
    with tempfile.TemporaryDirectory() as td:
        f = Path(td) / "k"
        f.write_text("fromfile\n")
        assert m.resolve_key("v", str(f), "EL_UNSET_X") == "fromfile"
    os.environ["EL_TEST_KEY"] = "envk"
    try:
        assert m.resolve_key(None, None, "EL_TEST_KEY") == "envk"
    finally:
        del os.environ["EL_TEST_KEY"]
    assert m.resolve_key(None, None, "EL_DEFINITELY_UNSET") is None


if __name__ == "__main__":
    try:
        test_pick_voice()
        test_build_payload()
        test_resolve_key()
    except AssertionError as e:
        print(f"ELEVENLABS FAIL: {e}")
        sys.exit(1)
    print("ELEVENLABS OK (pick_voice / build_payload / resolve_key)")
