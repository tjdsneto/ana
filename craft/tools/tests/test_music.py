#!/usr/bin/env python3
"""music.py pure helpers: request parsing + library track selection.

music.py resolves a film's music request to one file by (1) parsing the request string, (2) for the
library case, picking a track from the manifest, (3) returning a path (or shelling a generator). Steps
1-2 are pure; this test pins them with a canned manifest. The file/generate branches are thin I/O.

music.py imports only the stdlib, so this runs under any python3.
  python3 craft/tools/tests/test_music.py   (exit 0 pass / 1 fail), or under pytest.
"""
import importlib.util
import sys
from pathlib import Path

TOOLS = Path(__file__).resolve().parents[1]

MANIFEST = [
    {"file": "a.mp3", "mood": "calm ambient", "duration": 30},
    {"file": "b.mp3", "mood": "energetic upbeat", "duration": 40},
    {"file": "c.mp3", "mood": "energetic", "duration": 60},
    {"file": "d.mp3", "mood": "calm", "duration": 20},
]


def _load():
    spec = importlib.util.spec_from_file_location("music", TOOLS / "music.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # side-effect free: main() only runs under __main__
    return mod


def test_parse_request():
    m = _load()
    assert m.parse_request(None) == ("none", "")
    assert m.parse_request("   ") == ("none", "")
    assert m.parse_request("generate:warm uplifting") == ("generate", "warm uplifting")
    assert m.parse_request("stock:calm ambient") == ("stock", "calm ambient")
    assert m.parse_request("library:calm") == ("library", "calm")
    assert m.parse_request("energetic") == ("library", "energetic")       # bare word = mood
    assert m.parse_request("assets/beds/x.mp3") == ("file", "assets/beds/x.mp3")
    assert m.parse_request("beds/Track.WAV") == ("file", "beds/Track.WAV")  # ext case-insensitive


def test_pick_track():
    m = _load()
    # tightest cover: energetic >=35 -> b (40), not c (60)
    assert m.pick_track(MANIFEST, "energetic", 35)["file"] == "b.mp3"
    # calm >=25 -> a (30) covers; d (20) does not
    assert m.pick_track(MANIFEST, "calm", 25)["file"] == "a.mp3"
    # calm >=50 -> none covers, fall back to longest calm match -> a (30)
    assert m.pick_track(MANIFEST, "calm", 50)["file"] == "a.mp3"
    # substring + case-insensitive mood match
    assert m.pick_track(MANIFEST, "AMBIENT", 10)["file"] == "a.mp3"
    # no match
    assert m.pick_track(MANIFEST, "jazz", 10) is None


if __name__ == "__main__":
    try:
        test_parse_request()
        test_pick_track()
    except AssertionError as e:
        print(f"MUSIC FAIL: {e}")
        sys.exit(1)
    print("MUSIC OK (parse_request / pick_track)")
