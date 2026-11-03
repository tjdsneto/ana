#!/usr/bin/env python3
"""captions — burn word-timed captions onto a video, + an SRT sidecar.

A craft TOOL (not engine code). Consumes the word timeline every other tool already speaks —
`words.json = {"duration", "words":[{text,start,end,line}]}` from vo.py (TTS) or align.py (external
clip) — and burns captions into the video with libass, writing a plain .srt alongside.

Why captions on every video, not just social: web embeds and social feeds autoplay MUTED, so a launch
or feature video loses its whole message with no captions; they also carry accessibility and index as
searchable text. (Family-A on-screen chips are separate — those are per-shot callouts, not the VO.)

Two looks (--style):
  - karaoke (default) — the AM look: the line is on screen and each word lights in the accent colour as
    it is spoken (ASS \\k), driven by the word timings.
  - block — the whole caption line in one colour for its span. Simpler; same legibility.

The .srt sidecar is always line-level (one cue per caption line) — that is what YouTube/SEO/players want.

  python3 craft/video-production/tools/captions.py --in clip.mp4 --words media/words.json --out clip-cc.mp4 \\
      [--style karaoke|block] [--film film.json] [--font "DejaVu Sans"] [--accent "#FFD400"] \\
      [--max-chars 28] [--font-size 54] [--margin-v 70] [--srt clip.srt]

Pipeline use (make-film.sh, post-render): burn ONTO the render in place, gated by film.json —
  python3 craft/video-production/tools/captions.py --film film.json --gated --in film.mp4 --words media/words.json --out film.mp4
`--gated` makes it a no-op (exit 0) unless film.json's `captions` field opts in (true / "karaoke" /
"block" / an object of overrides); `--force-on` burns even without that field. `--out` may equal `--in`.

Needs ffmpeg (with libass) + ffprobe on PATH. Pure helpers (group_lines / build_ass / build_srt /
hex_to_ass / parse_captions_config) are I/O-free and unit-tested in tests/test_captions.py.
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="burn word-timed captions + write an .srt sidecar")
    p.add_argument("--in", dest="inp", required=True, help="source video")
    p.add_argument("--words", required=True, help="words.json (vo.py / align.py)")
    p.add_argument("--out", required=True, help="captioned video to write (may equal --in; written in place)")
    p.add_argument("--film", default=None, help="film.json: theme {accent, fontCss} + (with --gated) the `captions` config")
    # Pipeline gating (make-film). --gated: run only if film.json's `captions` field opts in, else no-op
    # (exit 0, nothing burned). --force-on: burn even with no `captions` field (the make-film `--captions` flag).
    p.add_argument("--gated", action="store_true", help="respect film.json's `captions` field; no-op when it is off/absent")
    p.add_argument("--force-on", action="store_true", help="with --gated, burn even when `captions` is absent (karaoke default)")
    # Style params default to None so film.json's `captions` config can fill them; an explicit flag still wins.
    p.add_argument("--style", choices=("karaoke", "block"), default=None)
    p.add_argument("--font", default=None, help="caption font family (default: film theme or 'DejaVu Sans')")
    p.add_argument("--accent", default=None, help="#RRGGBB highlight for the spoken word (default: film theme or #FFD400)")
    p.add_argument("--font-size", type=int, default=None, help="caption font size in px at the video's height (default 54)")
    p.add_argument("--max-chars", type=int, default=None, help="wrap a caption line at ~this many characters (default 28)")
    p.add_argument("--margin-v", type=int, default=None, help="distance from the bottom edge, px (default 70)")
    p.add_argument("--srt", default=None, help="also write this .srt sidecar (default: <out> with .srt)")
    return p.parse_args()


# ---------- pure helpers (no I/O; unit-tested) ----------

def parse_captions_config(film: dict) -> "dict | None":
    """film.json `captions` field -> a normalized override dict, or None when captions are OFF.

    Accepts: missing / false / "off" / "none" / "" -> None (no captions); true -> {} (karaoke defaults);
    "karaoke" / "block" -> {"style": ...}; an object -> its recognized keys (style, font, accent,
    font_size, max_chars, margin_v) passed through. Anything else -> None (fail safe: no burn)."""
    c = film.get("captions")
    if c in (None, False, "off", "none", ""):
        return None
    if c is True:
        return {}
    if isinstance(c, str):
        return {"style": c} if c in ("karaoke", "block") else None
    if isinstance(c, dict):
        keys = ("style", "font", "accent", "font_size", "max_chars", "margin_v")
        return {k: c[k] for k in keys if k in c}
    return None


def _first(*vals):
    """First non-None value (resolution order: explicit flag > film config > theme > hard default)."""
    for v in vals:
        if v is not None:
            return v
    return None

def group_lines(words: list[dict], max_chars: int) -> list[dict]:
    """Group word dicts into caption lines. Break on a VO `line` change or when the next word would
    exceed max_chars. Each caption line = {start, end, words:[...]} with the original word dicts."""
    lines: list[dict] = []
    cur: list[dict] = []
    cur_line = None
    cur_len = 0
    for w in words:
        wl = len(w["text"])
        same = w.get("line") == cur_line
        fits = cur_len + (1 if cur else 0) + wl <= max_chars
        if cur and (not same or not fits):
            lines.append({"start": cur[0]["start"], "end": cur[-1]["end"], "words": cur})
            cur, cur_len = [], 0
        cur.append(w)
        cur_len += (1 if cur_len else 0) + wl
        cur_line = w.get("line")
    if cur:
        lines.append({"start": cur[0]["start"], "end": cur[-1]["end"], "words": cur})
    return lines


def hex_to_ass(rgb: str) -> str:
    """#RRGGBB -> ASS &HAABBGGRR (opaque): ASS colours are little-endian BGR with an alpha byte."""
    s = rgb.lstrip("#")
    if len(s) != 6:
        raise ValueError(f"expected #RRGGBB, got {rgb!r}")
    r, g, b = s[0:2], s[2:4], s[4:6]
    return f"&H00{b}{g}{r}".upper()


def _ass_time(t: float) -> str:
    t = max(0.0, t)
    cs = int(round(t * 100))
    h, cs = divmod(cs, 360000)
    m, cs = divmod(cs, 6000)
    s, cs = divmod(cs, 100)
    return f"{h:d}:{m:02d}:{s:02d}.{cs:02d}"


def _srt_time(t: float) -> str:
    t = max(0.0, t)
    ms = int(round(t * 1000))
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def build_srt(lines: list[dict]) -> str:
    """Line-level SRT (one cue per caption line) — what players, YouTube and SEO consume."""
    out = []
    for i, ln in enumerate(lines, 1):
        text = " ".join(w["text"] for w in ln["words"])
        out.append(f"{i}\n{_srt_time(ln['start'])} --> {_srt_time(ln['end'])}\n{text}\n")
    return "\n".join(out)


def build_ass(lines: list[dict], width: int, height: int, *, style: str, font: str, font_size: int,
              accent_ass: str, margin_v: int) -> str:
    """Full .ass document. Inactive text = white with a black outline (legible over any footage);
    in karaoke the \\k fill reveals each word in the accent colour as it is spoken."""
    white = "&H00FFFFFF"
    header = "\n".join([
        "[Script Info]",
        "ScriptType: v4.00+",
        "WrapStyle: 2",
        f"PlayResX: {width}",
        f"PlayResY: {height}",
        "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, "
        "Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, "
        "Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        # PrimaryColour = already-spoken (accent) in karaoke; SecondaryColour = not-yet-spoken (white).
        # In block mode only PrimaryColour shows, so set it white there.
        f"Style: Default,{font},{font_size},"
        f"{accent_ass if style == 'karaoke' else white},{white},&H00101010,&H64000000,"
        f"1,0,0,0,100,100,0,0,1,3,0,2,60,60,{margin_v},1",
        "",
        "[Events]",
        # MarginV must be present: the Dialogue lines below use the full 10-field V4+ layout
        # (…,MarginL,MarginR,MarginV,Effect,Text). Omitting it here shifts every field right, so the
        # trailing field separator leaks into Text as a leading comma.
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ])
    events = []
    for ln in lines:
        if style == "karaoke":
            parts, prev = [], ln["start"]
            for w in ln["words"]:
                gap = int(round((w["start"] - prev) * 100))
                dur = max(1, int(round((w["end"] - w["start"]) * 100)))
                if gap > 0:
                    parts.append(f"{{\\k{gap}}}")
                parts.append(f"{{\\k{dur}}}{w['text']} ")
                prev = w["end"]
            text = "".join(parts).rstrip()
        else:
            text = " ".join(w["text"] for w in ln["words"])
        events.append(f"Dialogue: 0,{_ass_time(ln['start'])},{_ass_time(ln['end'])},Default,,0,0,0,,{text}")
    return header + "\n" + "\n".join(events) + "\n"


# ---------- I/O ----------

def video_size(path: Path) -> tuple[int, int]:
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
         "-of", "csv=s=x:p=0", str(path)],
        capture_output=True, text=True, check=True)
    w, h = r.stdout.strip().split("x")
    return int(w), int(h)


def main() -> None:
    a = parse_args()
    src, out = Path(a.inp), Path(a.out)

    film = json.loads(Path(a.film).read_text()) if a.film else {}

    # Gating (pipeline use). --gated: the film's `captions` field decides. Off/absent -> no-op (exit 0)
    # unless --force-on. Ungated (standalone): always burn with karaoke defaults.
    cfg: "dict | None" = {}
    if a.gated or a.force_on:
        cfg = parse_captions_config(film)
        if cfg is None:
            if not a.force_on:
                return  # captions are off for this film — nothing to do
            cfg = {}

    theme = film.get("theme", {})
    style = _first(a.style, cfg.get("style"), "karaoke")
    font = _first(a.font, cfg.get("font"), theme.get("fontCss"), "DejaVu Sans")
    accent = _first(a.accent, cfg.get("accent"), theme.get("accent"), "#FFD400")
    font_size = _first(a.font_size, cfg.get("font_size"), 54)
    max_chars = _first(a.max_chars, cfg.get("max_chars"), 28)
    margin_v = _first(a.margin_v, cfg.get("margin_v"), 70)

    if not src.exists():
        sys.exit(f"captions: input not found: {src}")
    words = json.loads(Path(a.words).read_text())["words"]
    if not words:
        sys.exit(f"captions: {a.words} has no words")

    lines = group_lines(words, max_chars)
    w, h = video_size(src)
    ass = build_ass(lines, w, h, style=style, font=font, font_size=font_size,
                    accent_ass=hex_to_ass(accent), margin_v=margin_v)

    srt_path = Path(a.srt) if a.srt else out.with_suffix(".srt")
    srt_path.write_text(build_srt(lines))

    # ffmpeg cannot read and write the same file in one pass; when --out == --in, burn to a sibling temp
    # then atomically replace the original.
    in_place = src.exists() and out.resolve() == src.resolve()
    target = out.with_name(f".{out.stem}.cc-tmp{out.suffix}") if in_place else out

    with tempfile.TemporaryDirectory() as td:
        (Path(td) / "subs.ass").write_text(ass)
        # Re-encode video (burn is a filter); copy audio untouched. ffmpeg's filtergraph parser mangles
        # an absolute path inside `ass=...` (the '/'s read as option syntax), so run from the temp dir
        # and reference the subtitle by basename; src/target stay absolute, unaffected by cwd.
        r = subprocess.run(
            ["ffmpeg", "-v", "error", "-y", "-i", str(src.resolve()), "-vf", "ass=subs.ass",
             "-c:a", "copy", str(target.resolve())],
            cwd=td, capture_output=True, text=True)
        if r.returncode != 0:
            target_unlink = target if in_place else None
            if target_unlink and target_unlink.exists():
                target_unlink.unlink()
            sys.exit(f"captions: ffmpeg burn failed — {r.stderr.strip()[:300]}")

    if in_place:
        os.replace(target, out)

    print(f"{len(lines)} caption lines ({style}) -> {out}; sidecar -> {srt_path}")


if __name__ == "__main__":
    main()
