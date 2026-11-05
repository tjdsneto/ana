#!/usr/bin/env python3
"""text_tags — split a script line into its synth text (kept verbatim, inline audio tags and all) and
its spoken text (tags removed), for the voice seam.

Inline **audio tags** are bracketed performance cues some TTS engines read as direction, not speech —
e.g. `[excited]`, `[whispers]`, `[warm, reassuring]` (ElevenLabs v3/v4). vo.py sends the SYNTH text to
a tag-aware engine so it performs the cue, but must always time + caption only the SPOKEN words — so a
tag never becomes a word in words.json, and a non-tag engine (kokoro/piper, used for no-spend tests)
never speaks the literal word "excited". This module is the one place that split happens; it is pure
and dependency-free so it unit-tests anywhere and keeps vo.py engine-agnostic.
"""
import re

_TAG = re.compile(r"\[[^\]\n]*\]")  # a single bracketed cue, no newline/nesting
_WS = re.compile(r"\s+")


def split_audio_tags(line: str) -> "tuple[str, str]":
    """Return (synth_text, spoken_text). synth_text keeps the line verbatim (outer whitespace trimmed),
    tags included — feed it to a tag-aware engine. spoken_text has every `[...]` tag removed and inner
    whitespace collapsed — use it for alignment/captions, and as the synth text for engines that don't
    consume tags."""
    synth = line.strip()
    spoken = _WS.sub(" ", _TAG.sub("", line)).strip()
    return synth, spoken
