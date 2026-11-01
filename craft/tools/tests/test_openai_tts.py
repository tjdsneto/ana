#!/usr/bin/env python3
"""openai-tts.py pure helpers: voice fallback + request payload — without the network.

The tool POSTs text to the OpenAI TTS API; the decisions it makes before the call (pick a valid voice,
build the body, only send `speed` for tts-1*) are pure and pinned here. The actual HTTP call is thin I/O.

Stdlib only, so this runs under any python3.
  python3 craft/tools/tests/test_openai_tts.py   (exit 0 pass / 1 fail), or under pytest.
"""
import importlib.util
import sys
from pathlib import Path

TOOLS = Path(__file__).resolve().parents[1]


def _load():
    spec = importlib.util.spec_from_file_location("openai_tts", TOOLS / "tts" / "openai-tts.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # side-effect free: main() only runs under __main__
    return mod


def test_pick_voice():
    m = _load()
    assert m.pick_voice("alloy") == ("alloy", None)            # known passes through
    v, note = m.pick_voice("af_heart")                         # a kokoro id falls back
    assert v == m.DEFAULT_VOICE and note and "af_heart" in note
    assert m.pick_voice(None) == (m.DEFAULT_VOICE, None)       # absent -> default, no note


def test_build_payload():
    m = _load()
    p = m.build_payload("hello", "alloy", "tts-1", 0.95, "wav")
    assert p == {"model": "tts-1", "input": "hello", "voice": "alloy", "response_format": "wav", "speed": 0.95}
    # gpt-4o-mini-tts rejects `speed` -> it must be omitted
    p2 = m.build_payload("hi", "nova", "gpt-4o-mini-tts", 1.0, "mp3")
    assert "speed" not in p2 and p2["model"] == "gpt-4o-mini-tts" and p2["response_format"] == "mp3"


if __name__ == "__main__":
    try:
        test_pick_voice()
        test_build_payload()
    except AssertionError as e:
        print(f"OPENAI-TTS FAIL: {e}")
        sys.exit(1)
    print("OPENAI-TTS OK (pick_voice / build_payload)")
