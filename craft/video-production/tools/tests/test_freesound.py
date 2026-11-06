#!/usr/bin/env python3
"""freesound.py pure helpers: search params, track pick, manifest row — without the network.

The tool searches Freesound, picks a track, downloads its preview, records a manifest row. The search
query it builds (licence + duration filter), which result it picks, and the row it records are pure and
pinned here; the HTTP GET + download are thin I/O.

Stdlib only, so this runs under any python3.
  python3 craft/video-production/tools/tests/test_freesound.py   (exit 0 pass / 1 fail), or under pytest.
"""
import importlib.util
import os
import sys
import tempfile
from pathlib import Path

TOOLS = Path(__file__).resolve().parents[1]

RESULTS = [
    {"id": 1, "duration": 20, "license": "http://creativecommons.org/publicdomain/zero/1.0/"},
    {"id": 2, "duration": 40, "license": "http://creativecommons.org/publicdomain/zero/1.0/"},
    {"id": 3, "duration": 60, "license": "http://creativecommons.org/publicdomain/zero/1.0/"},
]


def _load():
    spec = importlib.util.spec_from_file_location("freesound", TOOLS / "stock" / "freesound.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_build_search_params():
    m = _load()
    p = m.build_search_params("calm ambient", "Creative Commons 0", 30)
    assert p["query"] == "calm ambient"
    assert 'license:"Creative Commons 0"' in p["filter"]
    assert "duration:[30 TO *]" in p["filter"]
    assert p["sort"] == "rating_desc" and p["page_size"] == "15"
    # no duration -> no duration clause
    assert "duration:[" not in m.build_search_params("x", "Creative Commons 0", 0)["filter"]
    # instrumental is the default — a vocal bed competes with the VO, so vocal tags are excluded
    assert "-tag:vocals" in p["filter"]
    assert "-tag:singing" in p["filter"]
    # opt out for a deliberately vocal track
    flt2 = m.build_search_params("anthem", "Creative Commons 0", 30, instrumental=False)["filter"]
    assert "-tag:vocals" not in flt2


def test_pick_result():
    m = _load()
    assert m.pick_result(RESULTS, 35)["id"] == 2     # shortest covering 35s
    assert m.pick_result(RESULTS, 100)["id"] == 3    # none covers -> longest
    assert m.pick_result(RESULTS, 0)["id"] == 1      # no duration -> top-ranked (first)
    assert m.pick_result([], 30) is None


def test_manifest_entry():
    m = _load()
    e = m.manifest_entry(RESULTS[2], "calm ambient", "freesound-3.mp3")
    assert e["file"] == "freesound-3.mp3"
    assert e["mood"] == "calm ambient"
    assert e["duration"] == 60.0
    assert e["source"] == "freesound" and e["source_id"] == 3
    assert e["license"].endswith("zero/1.0/")
    assert "fetched_at" in e  # provenance stamp present (value is the call time)


def test_resolve_key():
    m = _load()
    assert m.resolve_key("v", None, "FS_UNSET_X") == "v"
    with tempfile.TemporaryDirectory() as td:
        f = Path(td) / "k"
        f.write_text("fromfile\n")
        assert m.resolve_key("v", str(f), "FS_UNSET_X") == "fromfile"  # file wins over value
    os.environ["FS_TEST_KEY"] = "envk"
    try:
        assert m.resolve_key(None, None, "FS_TEST_KEY") == "envk"
    finally:
        del os.environ["FS_TEST_KEY"]
    assert m.resolve_key(None, None, "FS_DEFINITELY_UNSET") is None


if __name__ == "__main__":
    try:
        test_build_search_params()
        test_pick_result()
        test_manifest_entry()
        test_resolve_key()
    except AssertionError as e:
        print(f"FREESOUND FAIL: {e}")
        sys.exit(1)
    print("FREESOUND OK (build_search_params / pick_result / manifest_entry / resolve_key)")
