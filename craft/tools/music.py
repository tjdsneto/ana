#!/usr/bin/env python3
"""music — resolve a film's music request to ONE audio file for mix.py --music.

A craft TOOL (not engine code). mix.py already does the hard part — fade, duck under the voice, master
to -14 LUFS — but only once handed a `--music FILE`. This tool decides WHICH file, from the `music`
field of film.json (or --request), and prints its path to stdout so make-film.sh can feed mix.py.

Three sources, chosen by the request string:
  - a PATH ("assets/beds/calm.mp3", or any .wav/.mp3/.m4a/...) -> bring-your-own, returned as-is.
  - "library:<mood>" or a bare "<mood>" -> pick from the local library (craft/assets/music/, a
    manifest.json of {file, mood, duration, license}). License-safe + offline; you/the brand seed the
    tracks (this tool never downloads audio). Picks the shortest track that still covers the film;
    if none is long enough, the longest match (mix.py fades it to length).
  - "generate:<prompt>" -> a generative bed via the $MUSIC_GEN_CMD seam (intended: ACE-Step, free +
    local). The command is configurable so we don't hard-code one generator's CLI; it is NOT run here
    unless $MUSIC_GEN_CMD is set. See --help for the placeholder contract.

Empty / missing request -> prints nothing, exits 0 (mix.py then runs VO + SFX only).

  python3 craft/tools/music.py --film FILM.json [--words words.json | --duration S] [--library DIR] [--out DIR]
  python3 craft/tools/music.py --request "library:energetic" --duration 32

Pure helpers (parse_request / pick_track) are I/O-free and unit-tested in tests/test_music.py.
"""
import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

AUDIO_EXT = {".wav", ".mp3", ".m4a", ".aac", ".flac", ".ogg", ".opus"}


def parse_request(spec: "str | None") -> tuple[str, str]:
    """Request string -> (kind, value). kind in {none, file, library, generate}."""
    if not spec or not spec.strip():
        return ("none", "")
    s = spec.strip()
    if s.startswith("generate:"):
        return ("generate", s[len("generate:"):].strip())
    if s.startswith("library:"):
        return ("library", s[len("library:"):].strip())
    if Path(s).suffix.lower() in AUDIO_EXT:
        return ("file", s)
    return ("library", s)  # a bare word is a mood


def pick_track(manifest: list[dict], mood: str, duration: float) -> "dict | None":
    """Choose a track whose `mood` contains `mood` (case-insensitive). Prefer the shortest that still
    covers `duration` (tightest fit, stable by file name); else the longest match. None if no match."""
    def dur(m: dict) -> float:
        return float(m.get("duration", 0) or 0)

    cands = [m for m in manifest if mood.lower() in str(m.get("mood", "")).lower()]
    covers = sorted((m for m in cands if dur(m) >= duration), key=lambda m: (dur(m), str(m.get("file", ""))))
    if covers:
        return covers[0]
    longest = sorted(cands, key=lambda m: (-dur(m), str(m.get("file", ""))))
    return longest[0] if longest else None


# ---------- I/O ----------

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="resolve a film's music request to one file for mix.py --music",
        epilog="generate: seam — $MUSIC_GEN_CMD is a shell template with {prompt} {duration} {out} "
               "placeholders, e.g. MUSIC_GEN_CMD='ace-step --prompt {prompt} --seconds {duration} "
               "--out {out}'. Unset -> generate: errors (no generator wired).")
    p.add_argument("--film", default=None, help="film.json; its `music` field is the request unless --request is given")
    p.add_argument("--request", default=None, help="music request string (overrides film.json's `music`)")
    p.add_argument("--words", default=None, help="words.json to read the film duration from")
    p.add_argument("--duration", type=float, default=None, help="film duration (s); overrides --words")
    p.add_argument("--library", default=None, help="music library dir (default: craft/assets/music next to this tool)")
    p.add_argument("--out", default=None, help="dir to write a generated track into (default: alongside --words)")
    return p.parse_args()


def film_duration(a: argparse.Namespace) -> float:
    if a.duration is not None:
        return a.duration
    if a.words and Path(a.words).exists():
        return float(json.loads(Path(a.words).read_text()).get("duration", 0) or 0)
    return 0.0


def main() -> None:
    a = parse_args()
    spec = a.request
    if spec is None and a.film and Path(a.film).exists():
        spec = json.loads(Path(a.film).read_text()).get("music")
    kind, value = parse_request(spec)

    if kind == "none":
        return  # no music; print nothing

    if kind == "file":
        p = Path(value)
        if not p.exists():
            sys.exit(f"music: file not found: {value}")
        print(str(p.resolve()))
        return

    lib = Path(a.library) if a.library else Path(__file__).resolve().parent.parent / "assets" / "music"

    if kind == "library":
        manifest_path = lib / "manifest.json"
        if not manifest_path.exists():
            sys.exit(f"music: no library manifest at {manifest_path} (seed craft/assets/music/)")
        manifest = json.loads(manifest_path.read_text())
        pick = pick_track(manifest, value, film_duration(a))
        if not pick:
            sys.exit(f"music: no library track matches mood {value!r}")
        track = (lib / pick["file"]) if not Path(pick["file"]).is_absolute() else Path(pick["file"])
        if not track.exists():
            sys.exit(f"music: manifest points to a missing file: {track}")
        print(str(track.resolve()))
        return

    if kind == "generate":
        tmpl = os.environ.get("MUSIC_GEN_CMD")
        if not tmpl:
            sys.exit("music: generate: requested but no generator wired — set $MUSIC_GEN_CMD "
                     "(template with {prompt} {duration} {out}; intended generator: ACE-Step)")
        out_dir = Path(a.out) if a.out else (Path(a.words).parent if a.words else Path.cwd())
        out_dir.mkdir(parents=True, exist_ok=True)
        out = out_dir / "music-gen.wav"
        cmd = tmpl.format(prompt=value, duration=film_duration(a), out=str(out))
        r = subprocess.run(cmd, shell=True, capture_output=True, text=True)
        if r.returncode != 0 or not out.exists():
            sys.exit(f"music: generator failed — {r.stderr.strip()[:300]}")
        print(str(out.resolve()))
        return


if __name__ == "__main__":
    main()
