#!/usr/bin/env python3
"""transcribe.py pure helper: shaping faster-whisper segments into the transcript contract.
The model run is thin I/O (lazy-imported in main), so this runs under any python3.
  python3 craft/tools/tests/test_transcribe.py   (exit 0 pass / 1 fail)
"""
import importlib.util
import sys
from pathlib import Path

TOOLS = Path(__file__).resolve().parents[1]


def _load():
    spec = importlib.util.spec_from_file_location("transcribe", TOOLS / "transcribe.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # faster_whisper is imported lazily in main(), so this is safe
    return mod


def test_shape_result():
    m = _load()
    segs = [{
        "start": 0.0, "end": 1.5, "text": " Hello world ",
        "words": [{"word": " Hello", "start": 0.0, "end": 0.6}, {"word": " world", "start": 0.6, "end": 1.5}],
    }]
    r = m.shape_result(segs, 1.52, "en")
    assert r["duration"] == 1.52 and r["language"] == "en"
    assert r["segments"] == [{"start": 0.0, "end": 1.5, "text": "Hello world"}], r["segments"]
    assert r["words"] == [{"text": "Hello", "start": 0.0, "end": 0.6}, {"text": "world", "start": 0.6, "end": 1.5}], r["words"]
    # a segment with no word timings -> no words, still a segment
    r2 = m.shape_result([{"start": 0, "end": 1, "text": "x"}], 1.0, "en")
    assert r2["words"] == [] and r2["segments"] == [{"start": 0.0, "end": 1.0, "text": "x"}]


if __name__ == "__main__":
    try:
        test_shape_result()
    except AssertionError as e:
        print(f"TRANSCRIBE FAIL: {e}")
        sys.exit(1)
    print("TRANSCRIBE OK (shape_result: segments / words / empty)")
