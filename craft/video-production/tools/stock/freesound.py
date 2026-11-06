#!/usr/bin/env python3
"""freesound — a stock-audio PROVIDER TOOL: fetch one licence-clean track from Freesound.

A craft tool, not engine code (see tmp/audio-provider-seam-design.md). It is the first adapter in the
STOCK lane: `music.py` resolving a `"stock:<mood>"` request shells this; the engine never calls it.

This is the lane that may auto-fetch — allowed ONLY because the source returns a known per-item licence
and this tool records it. Default filter is CC0 (public domain, commercial-safe, no attribution); the
returned licence is written into the manifest so the choice stays auditable, exactly like a seeded
library track. Arbitrary web downloads remain forbidden.

BYO-key: the key is resolved at call time, never baked. Precedence `--api-key-file` > `--api-key` >
$FREESOUND_API_KEY (a future BYOK store injects it by param; env stays the local default; prefer the
file/env over a raw `--api-key`, which shows in `ps`). Downloads the high-quality MP3 PREVIEW (token
auth is enough for previews; the full original needs OAuth2) — fine for a bed; mix.py masters it.

  python3 craft/video-production/tools/stock/freesound.py --query "calm ambient" --out-dir craft/video-production/assets/music \\
      [--duration 30] [--license "Creative Commons 0"] [--manifest craft/video-production/assets/music/manifest.json] [--api-key-file KEYFILE]

Stdlib only (urllib) so it runs under any python3. Pure helpers (build_search_params / pick_result /
manifest_entry) are I/O-free and unit-tested in tests/test_freesound.py.
"""
import argparse
import datetime
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

SEARCH_URL = "https://freesound.org/apiv2/search/text/"
DEFAULT_LICENSE = "Creative Commons 0"  # CC0: public domain, no attribution, commercial-safe
PREVIEW_KEY = "preview-hq-mp3"


def resolve_key(value: "str | None", key_file: "str | None", env_name: str) -> "str | None":
    """Resolve an API key by precedence: --api-key-file > --api-key > $ENV. None if none set.
    A key file lets a caller (or a future BYOK store) hand the key over without it showing in `ps`."""
    if key_file:
        return Path(key_file).read_text().strip()
    if value:
        return value
    return os.environ.get(env_name)


# Vocal tags excluded by default — a bed with singing/lyrics competes with the voiceover (CRAFT-BAR §A5).
VOCAL_TAGS = ("vocals", "vocal", "voice", "singing", "lyrics", "speech", "acappella", "choir", "rap")


def build_search_params(query: str, license: str, duration: float, instrumental: bool = True) -> dict:
    """Freesound text-search params (token added separately). Filter pins the licence and, when a
    duration is given, requires a track at least that long (`duration:[d TO *]`). `instrumental`
    (default) excludes vocal-tagged tracks so the bed never fights the VO; pass False for a
    deliberately vocal piece."""
    flt = f'license:"{license}"'
    if duration and duration > 0:
        flt += f" duration:[{duration} TO *]"
    if instrumental:
        flt += "".join(f" -tag:{t}" for t in VOCAL_TAGS)
    return {
        "query": query,
        "filter": flt,
        "fields": "id,name,license,duration,previews,username",
        "sort": "rating_desc",
        "page_size": "15",
    }


def pick_result(results: list, duration: float) -> "dict | None":
    """Prefer the shortest track that still covers `duration` (tightest fit, stable by id); else the
    longest match; with no duration, the top-ranked result. None if there are no results."""
    if not results:
        return None
    if not duration or duration <= 0:
        return results[0]

    def dur(r: dict) -> float:
        return float(r.get("duration", 0) or 0)

    covers = sorted((r for r in results if dur(r) >= duration), key=lambda r: (dur(r), r.get("id", 0)))
    if covers:
        return covers[0]
    return sorted(results, key=lambda r: (-dur(r), r.get("id", 0)))[0]


def _now_iso() -> str:
    return datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat()


def manifest_entry(result: dict, query: str, filename: str) -> dict:
    """A manifest row for a fetched track — the seeded-library shape ({file,mood,duration,license})
    plus provenance (source, source_id, fetched_at) so an auto-fetch is as auditable as a hand-seeded one."""
    return {
        "file": filename,
        "mood": query,
        "duration": round(float(result.get("duration", 0) or 0), 2),
        "license": result.get("license", ""),
        "source": "freesound",
        "source_id": result.get("id"),
        "fetched_at": _now_iso(),
    }


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="fetch one licence-clean stock track from Freesound (a stock provider tool)")
    p.add_argument("--query", required=True, help="search text / mood")
    p.add_argument("--out-dir", required=True, help="dir to cache the downloaded track into")
    p.add_argument("--duration", type=float, default=0.0, help="minimum track length (s); 0 = any")
    p.add_argument("--license", default=DEFAULT_LICENSE, help=f'licence filter (default "{DEFAULT_LICENSE}" = CC0)')
    p.add_argument("--manifest", default=None, help="manifest.json to append the fetched track's row to (for reuse + audit)")
    p.add_argument("--api-key", default=None, help="key by value (visible in `ps`; prefer --api-key-file or $FREESOUND_API_KEY)")
    p.add_argument("--api-key-file", default=None, help="read the key from this file (not visible in `ps`)")
    p.add_argument("--allow-vocals", action="store_true", help="keep vocal-tagged tracks (default excludes them so the bed never fights the VO)")
    return p.parse_args()


def _get_json(url: str) -> dict:
    try:
        with urllib.request.urlopen(url, timeout=60) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:300]
        sys.exit(f"freesound: API error {e.code} — {detail}")
    except urllib.error.URLError as e:
        sys.exit(f"freesound: request failed — {e.reason}")


def main() -> None:
    a = parse_args()
    key = resolve_key(a.api_key, a.api_key_file, "FREESOUND_API_KEY")
    if not key:
        sys.exit("freesound: no key (set $FREESOUND_API_KEY, or pass --api-key-file / --api-key; it is never baked)")

    params = build_search_params(a.query, a.license, a.duration, instrumental=not a.allow_vocals)
    url = f"{SEARCH_URL}?{urllib.parse.urlencode(params)}&token={urllib.parse.quote(key)}"
    data = _get_json(url)
    pick = pick_result(data.get("results", []), a.duration)
    if not pick:
        sys.exit(f"freesound: no {a.license!r} track matches {a.query!r}"
                 + (f" of >= {a.duration}s" if a.duration else ""))

    preview = (pick.get("previews") or {}).get(PREVIEW_KEY)
    if not preview:
        sys.exit(f"freesound: result {pick.get('id')} has no {PREVIEW_KEY}")

    out_dir = Path(a.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    filename = f"freesound-{pick['id']}.mp3"
    dest = out_dir / filename
    try:
        urllib.request.urlretrieve(preview, dest)
    except (urllib.error.URLError, OSError) as e:
        sys.exit(f"freesound: download failed — {e}")

    if a.manifest:
        mpath = Path(a.manifest)
        manifest = json.loads(mpath.read_text()) if mpath.exists() else []
        entry = manifest_entry(pick, a.query, filename)
        # idempotent: replace any prior row for the same cached file
        manifest = [m for m in manifest if m.get("file") != filename]
        manifest.append(entry)
        mpath.parent.mkdir(parents=True, exist_ok=True)
        mpath.write_text(json.dumps(manifest, indent=2))

    print(str(dest.resolve()))
    print(f"freesound: '{pick.get('name')}' (#{pick['id']}, {pick.get('license')}) -> {dest}", file=sys.stderr)


if __name__ == "__main__":
    main()
