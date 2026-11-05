#!/usr/bin/env python3
"""text_tags.split_audio_tags — pure, dep-free. Run: python3 craft/video-production/tools/tests/test_text_tags.py
(exit 0 pass / 1 fail), or under pytest."""
import importlib.util
from pathlib import Path

TOOLS = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("text_tags", TOOLS / "tts" / "text_tags.py")
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
split = m.split_audio_tags


def test_no_tags_passthrough():
    assert split("Ask your AI for a popup.") == ("Ask your AI for a popup.", "Ask your AI for a popup.")


def test_leading_tag_kept_in_synth_stripped_from_spoken():
    synth, spoken = split("[excited] Ask your AI for a popup.")
    assert synth == "[excited] Ask your AI for a popup."
    assert spoken == "Ask your AI for a popup."


def test_mid_line_tag_stripped_and_whitespace_collapsed():
    synth, spoken = split("Say it [whispers] in plain English.")
    assert synth == "Say it [whispers] in plain English."
    assert spoken == "Say it in plain English."


def test_adjacent_tags():
    synth, spoken = split("[excited][fast] Go.")
    assert synth == "[excited][fast] Go."
    assert spoken == "Go."


def test_natural_language_tag():
    synth, spoken = split("[warm, reassuring] You choose what it can do.")
    assert spoken == "You choose what it can do."


def test_double_space_after_removed_tag_collapses():
    # removing the tag leaves "power,  but" -> collapse to one space
    _, spoken = split("Give AI the power, [pause] but keep the control.")
    assert spoken == "Give AI the power, but keep the control."


def test_trims_outer_whitespace():
    synth, spoken = split("   [excited]  Hello.  ")
    assert synth == "[excited]  Hello."
    assert spoken == "Hello."


if __name__ == "__main__":
    import traceback
    fails = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"ok   {name}")
            except Exception:
                fails += 1
                print(f"FAIL {name}")
                traceback.print_exc()
    raise SystemExit(1 if fails else 0)
