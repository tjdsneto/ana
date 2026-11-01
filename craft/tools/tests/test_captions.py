#!/usr/bin/env python3
"""captions.py pure helpers: line grouping, SRT, ASS, colour — without ffmpeg.

captions.py burns captions by (1) grouping words.json into caption lines, (2) rendering .ass / .srt,
(3) shelling ffmpeg to burn. Step 3 is I/O; this test drives steps 1-2 (group_lines / build_srt /
build_ass / hex_to_ass), so it is fast and hermetic. The burn itself is smoke-tested on a real clip.

captions.py imports only the stdlib, so this runs under any python3.
  python3 craft/tools/tests/test_captions.py   (exit 0 pass / 1 fail), or under pytest.
"""
import importlib.util
import sys
from pathlib import Path

TOOLS = Path(__file__).resolve().parents[1]

WORDS = [
    {"text": "WordPress", "start": 0.00, "end": 0.36, "line": 1},
    {"text": "sites", "start": 0.36, "end": 0.80, "line": 1},
    {"text": "load", "start": 0.80, "end": 1.06, "line": 1},
    {"text": "faster", "start": 1.06, "end": 1.56, "line": 1},
    {"text": "today", "start": 1.56, "end": 1.84, "line": 1},
    {"text": "Awesome", "start": 1.84, "end": 2.30, "line": 2},
    {"text": "Motive", "start": 2.30, "end": 2.60, "line": 2},
    {"text": "ships", "start": 2.60, "end": 2.94, "line": 2},
    {"text": "WPVibe", "start": 2.94, "end": 3.96, "line": 2},
]


def _load():
    spec = importlib.util.spec_from_file_location("captions", TOOLS / "captions.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # side-effect free: main() only runs under __main__
    return mod


def test_group_lines_breaks_on_cap_and_line():
    cap = _load()
    lines = cap.group_lines(WORDS, max_chars=28)
    # char cap splits line 1 after "faster" (27 chars; +today would be 33); line change forces a new
    # caption at "Awesome". So: [WordPress sites load faster] [today] [Awesome Motive ships WPVibe].
    assert [len(ln["words"]) for ln in lines] == [4, 1, 4], [[w["text"] for w in ln["words"]] for ln in lines]
    # each caption line's span = first word start .. last word end
    assert lines[0]["start"] == 0.00 and lines[0]["end"] == 1.56
    assert lines[2]["start"] == 1.84 and lines[2]["end"] == 3.96
    # no caption line mixes VO lines
    for ln in lines:
        assert len({w["line"] for w in ln["words"]}) == 1


def test_hex_to_ass():
    cap = _load()
    assert cap.hex_to_ass("#FFD400") == "&H0000D4FF"  # R=FF G=D4 B=00 -> &H00 BB GG RR
    assert cap.hex_to_ass("000000") == "&H00000000"
    try:
        cap.hex_to_ass("#fff")
    except ValueError:
        pass
    else:
        raise AssertionError("short hex should raise")


def test_build_srt():
    cap = _load()
    srt = cap.build_srt(cap.group_lines(WORDS, 28))
    assert srt.startswith("1\n00:00:00,000 --> 00:00:01,560\nWordPress sites load faster\n")
    assert "3\n00:00:01,840 --> 00:00:03,960\nAwesome Motive ships WPVibe\n" in srt


def test_parse_captions_config():
    cap = _load()
    # OFF cases -> None (no burn)
    assert cap.parse_captions_config({}) is None                       # no `captions` key
    assert cap.parse_captions_config({"captions": False}) is None
    assert cap.parse_captions_config({"captions": "off"}) is None
    assert cap.parse_captions_config({"captions": "nope"}) is None     # unknown string -> fail safe
    # ON cases
    assert cap.parse_captions_config({"captions": True}) == {}          # karaoke defaults
    assert cap.parse_captions_config({"captions": "block"}) == {"style": "block"}
    cfg = cap.parse_captions_config({"captions": {"style": "block", "font_size": 48, "bogus": 1}})
    assert cfg == {"style": "block", "font_size": 48}                   # only recognized keys survive


def test_build_ass_karaoke_vs_block():
    cap = _load()
    lines = cap.group_lines(WORDS, 28)
    acc = cap.hex_to_ass("#FFD400")
    kar = cap.build_ass(lines, 720, 1280, style="karaoke", font="DejaVu Sans", font_size=54,
                        accent_ass=acc, margin_v=70)
    blk = cap.build_ass(lines, 720, 1280, style="block", font="DejaVu Sans", font_size=54,
                        accent_ass=acc, margin_v=70)
    assert "PlayResX: 720" in kar and "PlayResY: 1280" in kar
    assert kar.count("Dialogue:") == len(lines)
    assert "{\\k" in kar                      # karaoke emits per-word \k timing
    assert "{\\k" not in blk                  # block does not
    assert acc in kar and acc not in blk      # highlight colour only in karaoke's PrimaryColour


def test_build_ass_dialogue_field_alignment():
    # The [Events] Format and the Dialogue lines must declare the same fields, or libass shifts them
    # and the trailing separator leaks into Text as a leading comma (caught only by an actual burn).
    cap = _load()
    lines = cap.group_lines(WORDS, 28)
    for style in ("karaoke", "block"):
        ass = cap.build_ass(lines, 720, 1280, style=style, font="DejaVu Sans", font_size=54,
                            accent_ass=cap.hex_to_ass("#FFD400"), margin_v=70)
        fmt = next(l for l in ass.splitlines() if l.startswith("Format:") and "Text" in l and "Start" in l)
        assert "MarginV" in fmt, "Events Format must include MarginV"
        n = len(fmt.split("Format:", 1)[1].split(","))                  # declared field count
        first_words = {w["text"] for w in WORDS}
        for dl in (l for l in ass.splitlines() if l.startswith("Dialogue:")):
            text = dl.split("Dialogue:", 1)[1].split(",", n - 1)[-1]    # everything after the last field sep
            assert not text.startswith(","), f"{style}: Text has a leaked leading comma: {text!r}"
            # Text must begin with real caption content: a karaoke tag or one of the caption words.
            head = text.lstrip("{").split("}")[-1].split()[0] if text else ""
            assert text.lstrip().startswith("{\\k") or head in first_words, f"{style}: unexpected Text head {text[:20]!r}"


if __name__ == "__main__":
    try:
        test_group_lines_breaks_on_cap_and_line()
        test_hex_to_ass()
        test_build_srt()
        test_parse_captions_config()
        test_build_ass_karaoke_vs_block()
        test_build_ass_dialogue_field_alignment()
    except AssertionError as e:
        print(f"CAPTIONS FAIL: {e}")
        sys.exit(1)
    print("CAPTIONS OK (group_lines / srt / ass / colour / config / field-alignment)")
