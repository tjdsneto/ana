#!/usr/bin/env python3
"""transcribe — speech → a word-timed transcript JSON, via faster-whisper (local, CTranslate2).

A craft tool for the edit-footage leaf: pick cut points by what is SAID, not just by time (the André-
style "cut the fillers / find the line" editing). Extracts audio with ffmpeg, runs faster-whisper, and
emits {duration, language, segments:[{start,end,text}], words:[{text,start,end}]} — the timecodes Claude
turns into EDL in/out ranges.

Run under the faster-whisper venv: ~/.local/share/faster-whisper/venv on a dev box, or $FW_PY
(/opt/fw-venv/bin/python) in the engine image, where the package + the base model are baked.
faster-whisper is CTranslate2, far lighter than torch/WhisperX.

  <venv>/bin/python craft/video-production/tools/transcribe.py --in take.mp4 [--out take.words.json] [--model base] [--lang en]

shape_result is pure (unit-tested in tests/test_transcribe.py); the ffmpeg + model run are thin I/O.
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path


def shape_result(segments: list, duration: float, language: str) -> dict:
    """Shape faster-whisper's segments (as plain dicts) into the transcript contract."""
    segs, words = [], []
    for s in segments:
        segs.append({"start": round(float(s["start"]), 3), "end": round(float(s["end"]), 3), "text": s["text"].strip()})
        for w in s.get("words") or []:
            words.append({"text": w["word"].strip(), "start": round(float(w["start"]), 3), "end": round(float(w["end"]), 3)})
    return {"duration": round(float(duration), 3), "language": language, "segments": segs, "words": words}


def decode_pcm(src: str):
    """Decode src to 16 kHz mono float32 via ffmpeg, returned as a numpy array. Passing the array to
    faster-whisper bypasses its PyAV decode path (which breaks across PyAV versions) and is
    deterministic — ffmpeg owns the resample."""
    import numpy as np

    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", src, "-vn", "-ar", "16000", "-ac", "1", "-f", "f32le", "-"],
        capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32)


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="speech -> word-timed transcript JSON (faster-whisper)")
    p.add_argument("--in", dest="inp", required=True, help="audio or video file")
    p.add_argument("--out", default=None, help="JSON file to write (default: stdout)")
    p.add_argument("--model", default="base", help="faster-whisper model (tiny|base|small|medium|large-v3)")
    p.add_argument("--lang", default=None, help="language code to force (default: auto-detect)")
    return p.parse_args()


def main() -> None:
    a = parse_args()
    if not Path(a.inp).exists():
        sys.exit(f"transcribe: input not found: {a.inp}")
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        sys.exit("transcribe: faster-whisper not installed; run under the faster-whisper venv "
                 "(~/.local/share/faster-whisper/venv)")

    audio = decode_pcm(a.inp)
    model = WhisperModel(a.model, device="cpu", compute_type="int8")
    seg_iter, info = model.transcribe(audio, word_timestamps=True, language=a.lang)
    segments = [
        {"start": s.start, "end": s.end, "text": s.text,
         "words": [{"word": w.word, "start": w.start, "end": w.end} for w in (s.words or [])]}
        for s in seg_iter
    ]

    result = shape_result(segments, info.duration, info.language)
    out = json.dumps(result, indent=2)
    if a.out:
        Path(a.out).write_text(out)
        print(f"transcribe: {len(result['words'])} words, {result['duration']}s ({result['language']}) -> {a.out}")
    else:
        print(out)


if __name__ == "__main__":
    main()
