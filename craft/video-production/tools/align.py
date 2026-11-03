#!/usr/bin/env python3
"""align — word-time an EXTERNAL audio/video clip onto the storyboard's words.json schema.

A craft TOOL (not engine code). vo.py times the TTS it synthesizes; align.py does the same for a clip
produced ELSEWHERE — an avatar / cinematic render (HeyGen / Higgsfield), a screen recording, or a
selfie take — so a non-engine clip drops onto the same word-anchored timeline that captions, assemble
and mix already read.

Reuses vo.py's whisper alignment (no logic forked):
  - whisper_words(): per-word {word,start,end} from the clip.
  - line_word_times(): when the spoken --script is known, force whisper's timing onto the VERBATIM
    script words, so proper nouns whisper mis-hears ("WordPress", product names) stay correct. Without
    a script, whisper's own tokens are the words.

The audio is read straight from the file at its TRUE timeline (no silence trim / pause squeeze — those
are TTS-laydown concerns) so every time matches the actual clip. Video in, audio auto-extracted by
ffmpeg.

  python3 craft/video-production/tools/align.py --in clip.mp4 [--script script.txt] --out media [--whisper-model base]

Writes <out>/words.json = {"duration": s, "words": [{text, start, end, line}]} — the same schema vo.py
emits. Does NOT write vo.wav: the external clip owns its own audio; this tool only times it.
"""
import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

# Reuse vo.py's alignment verbatim (same dir). Importing vo loads numpy + soundfile only; the Kokoro
# model is loaded lazily inside vo.kokoro(), so align never needs a TTS engine installed.
from vo import SR, line_word_times, whisper_words


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="word-time an external audio/video clip -> words.json")
    p.add_argument("--in", dest="inp", required=True, help="audio or video file to time")
    p.add_argument("--out", required=True, help="output dir (gets words.json)")
    p.add_argument("--script", default=None,
                   help="the spoken text, one VO line per line; when given, words.json uses the VERBATIM "
                        "script words instead of whisper's (recommended — keeps proper nouns)")
    p.add_argument("--whisper-model", default="base")
    return p.parse_args()


def ffprobe_duration(path: Path) -> float:
    """True container duration (s) of the input, via ffprobe."""
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nokey=1:noprint_wrappers=1", str(path)],
        capture_output=True, text=True, check=True)
    return float(r.stdout.strip())


def decode_wav(src: Path, dst: Path) -> None:
    """Decode any audio/video to 48 kHz mono wav at its real timeline (no trimming)."""
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-i", str(src), "-vn", "-ar", str(SR), "-ac", "1", str(dst)],
        capture_output=True, check=True)


def build_words(rec: list[dict], lines: "list[str] | None", duration: float) -> list[dict]:
    """whisper tokens (+ optional verbatim script lines) + clip duration -> the words.json `words`.

    With `lines`: lay the verbatim script words across the whole clip's whisper tokens in one pass —
    whisper times are file-absolute, so clip_s = the full duration and no offset is added — tagging each
    word with its source line. Without `lines`: whisper's own tokens are the words (one segment, line 1).
    Pure (no I/O): the file decode / whisper run happen in main(); this is the unit under test.
    """
    if lines:
        disp = [w for line in lines for w in line.split()]
        line_of = [i for i, line in enumerate(lines, 1) for _ in line.split()]
        times = line_word_times(disp, rec, duration)
        return [{"text": w, "start": round(ws, 3), "end": round(we, 3), "line": lno}
                for w, lno, (ws, we) in zip(disp, line_of, times)]
    return [{"text": r["word"], "start": round(r["start"], 3), "end": round(r["end"], 3), "line": 1}
            for r in rec]


def main() -> None:
    a = parse_args()
    src = Path(a.inp)
    if not src.exists():
        sys.exit(f"align: input not found: {src}")
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)

    duration = round(ffprobe_duration(src), 2)

    with tempfile.TemporaryDirectory() as td:
        wav = Path(td) / "clip.wav"
        decode_wav(src, wav)
        rec = whisper_words(wav, a.whisper_model)

    if not rec:
        sys.exit(f"align: whisper found no speech in {src} — is there a voice track?")

    lines = None
    if a.script:
        lines = [l.strip() for l in Path(a.script).read_text().splitlines() if l.strip()]
        if not lines:
            sys.exit("align: --script is empty")
    words = build_words(rec, lines, duration)

    (out / "words.json").write_text(json.dumps({"duration": duration, "words": words}, indent=0))
    src_kind = "script-aligned" if a.script else "whisper tokens"
    print(f"{len(words)} words timed ({src_kind}), clip {duration}s -> {out}/words.json")


if __name__ == "__main__":
    main()
