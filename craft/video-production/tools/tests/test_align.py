#!/usr/bin/env python3
"""align.build_words: verbatim-script mapping + schema, without whisper.

align.py times an external clip by (1) decoding it, (2) running whisper, (3) mapping tokens to words.
Steps 1-2 are I/O (ffmpeg + the whisper model); this test drives step 3 — build_words — with CANNED
whisper tokens, so it is fast and hermetic (no model, no audio). The real end-to-end path is smoke-
tested by running align.py on an actual clip.

Run under the Kokoro venv python (align imports vo, which imports numpy + soundfile):
  "$KOKORO_HOME/venv/bin/python" craft/video-production/tools/tests/test_align.py   (exit 0 pass / 1 fail), or pytest.
"""
import importlib.util
import sys
from pathlib import Path

TOOLS = Path(__file__).resolve().parents[1]


def _load_align():
    # align.py does `from vo import ...` (sibling). A direct `python align.py` puts craft/video-production/tools on
    # sys.path[0] automatically; loading it via importlib from here does not, so add it ourselves.
    if str(TOOLS) not in sys.path:
        sys.path.insert(0, str(TOOLS))
    spec = importlib.util.spec_from_file_location("align", TOOLS / "align.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # side-effect free: main() only runs under __main__
    return mod


# Canned whisper tokens: one per script word, strictly increasing times. With one token per display
# word, vo.line_word_times takes its exact-count fast path and returns these times verbatim — so the
# assertions pin build_words' OWN job: assembly, line tags, schema, rounding (not whisper or alignment).
LINES = ["WordPress sites load faster today", "Awesome Motive ships WPVibe"]
REC = [
    {"word": "WordPress", "start": 0.00, "end": 0.36},
    {"word": "sites", "start": 0.36, "end": 0.80},
    {"word": "load", "start": 0.80, "end": 1.06},
    {"word": "faster", "start": 1.06, "end": 1.56},
    {"word": "today", "start": 1.56, "end": 1.84},
    {"word": "Awesome", "start": 1.84, "end": 2.30},
    {"word": "Motive", "start": 2.30, "end": 2.60},
    {"word": "ships", "start": 2.60, "end": 2.94},
    {"word": "WPVibe", "start": 2.94, "end": 3.96},
]
DURATION = 4.2


def test_script_aligned():
    align = _load_align()
    words = align.build_words(REC, LINES, DURATION)
    # verbatim script words, in order (proper nouns survive)
    assert [w["text"] for w in words] == \
        "WordPress sites load faster today Awesome Motive ships WPVibe".split()
    # line tags follow the source lines (5 on line 1, 4 on line 2)
    assert [w["line"] for w in words] == [1, 1, 1, 1, 1, 2, 2, 2, 2]
    # schema + sanity: exactly the 4 keys, monotonic starts, end > start, within the clip
    assert all(set(w) == {"text", "start", "end", "line"} for w in words)
    starts = [w["start"] for w in words]
    assert all(starts[i] <= starts[i + 1] for i in range(len(starts) - 1)), starts
    assert all(w["end"] > w["start"] for w in words)
    assert all(w["end"] <= DURATION + 0.05 for w in words)


def test_no_script_uses_whisper_tokens():
    align = _load_align()
    words = align.build_words(REC, None, DURATION)
    assert [w["text"] for w in words] == [r["word"] for r in REC]
    assert all(w["line"] == 1 for w in words)
    assert [w["start"] for w in words] == [r["start"] for r in REC]


if __name__ == "__main__":
    try:
        test_script_aligned()
        test_no_script_uses_whisper_tokens()
    except AssertionError as e:
        print(f"ALIGN FAIL: {e}")
        sys.exit(1)
    print("ALIGN OK (build_words: verbatim mapping + schema)")
