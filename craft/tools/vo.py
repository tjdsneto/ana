#!/usr/bin/env python3
"""vo — voiceover + word timing, the storyboard timeline's spine.

A craft TOOL (not engine code): the render/voice skill calls it. Synthesizes one Kokoro clip per
script line, lays them end to end with a lead-in and inter-line gap, and force-times every word so
cuts / clicks / captions can be anchored to a spoken word (see spec 09, Family A).

Technique lifted from the reference `vo.py` (real-ui-launch-film), re-authored for this repo:
  - TTS: Kokoro ONNX directly (local, keyless) instead of the HyperFrames CLI.
  - Word timing: the `whisper` CLI with --word_timestamps instead of torchaudio's MMS aligner
    (torchaudio is not installed here; whisper is). Clean TTS audio aligns well.

Run under the Kokoro venv python (it has kokoro_onnx + soundfile + numpy):
  "$KOKORO_HOME/venv/bin/python" craft/tools/vo.py --script script.txt --out media [options]

Writes <out>/vo/sNN.wav (cached — delete to redo a line), <out>/vo.wav (48 kHz mono composition
clock) and <out>/words.json = {"duration": s, "words": [{text, start, end, line}]}.
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf

SR = 48000  # composition sample rate


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="voiceover + per-word timing")
    p.add_argument("--script", required=True, help="text file, one VO line per line")
    p.add_argument("--out", required=True, help="output dir (gets vo/, vo.wav, words.json)")
    p.add_argument("--voice", default="af_heart", help="Kokoro voice id")
    p.add_argument("--speed", type=float, default=0.95)
    p.add_argument("--lead", type=float, default=0.6, help="silence before the first line (s)")
    p.add_argument("--gap", type=float, default=0.45, help="silence between lines (s)")
    p.add_argument("--tail", type=float, default=3.0, help="trailing room after the last line (s)")
    p.add_argument("--whisper-model", default="base")
    return p.parse_args()


def kokoro():
    """Load the local Kokoro model from KOKORO_HOME (same layout pr-tts-kokoro expects)."""
    from kokoro_onnx import Kokoro

    home = Path(os.environ.get("KOKORO_HOME", str(Path.home() / ".local/share/kokoro-onnx")))
    model, voices = home / "kokoro-v1.0.onnx", home / "voices-v1.0.bin"
    if not model.exists() or not voices.exists():
        sys.exit(f"vo: Kokoro model not found under {home} (kokoro-v1.0.onnx + voices-v1.0.bin)")
    return Kokoro(str(model), str(voices))


def synth_line(kok, text: str, voice: str, speed: float, out_wav: Path) -> None:
    """Synthesize one line to a 24 kHz wav (cached: skip if it already exists)."""
    if out_wav.exists():
        return
    samples, sr = kok.create(text, voice=voice, speed=speed, lang="en-us")
    sf.write(str(out_wav), samples, sr)


def trimmed_f32(wav: Path) -> np.ndarray:
    """Trim head/tail silence and return 48 kHz mono float32 samples (via ffmpeg)."""
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(wav), "-af",
         "silenceremove=start_periods=1:start_threshold=-45dB,areverse,"
         "silenceremove=start_periods=1:start_threshold=-45dB,areverse",
         "-ar", str(SR), "-ac", "1", "-f", "f32le", "-"],
        capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32)


def whisper_words(clip_wav: Path, model: str) -> list[dict]:
    """Per-word {word,start,end} (clip-relative seconds) from the whisper CLI."""
    with tempfile.TemporaryDirectory() as td:
        subprocess.run(
            ["whisper", str(clip_wav), "--model", model, "--language", "en",
             "--word_timestamps", "True", "--output_format", "json", "--output_dir", td,
             "--fp16", "False", "--verbose", "False"],
            capture_output=True, check=True)
        data = json.loads((Path(td) / (clip_wav.stem + ".json")).read_text())
    out: list[dict] = []
    for seg in data.get("segments", []):
        for w in seg.get("words", []):
            out.append({"word": w["word"].strip(), "start": float(w["start"]), "end": float(w["end"])})
    return out


def line_word_times(disp: list[str], rec: list[dict], clip_s: float) -> list[tuple[float, float]]:
    """Map the SCRIPT line's display words to clip-relative (start,end).

    Keep the script words verbatim (whisper can mis-spell); take whisper's times by index. On a count
    mismatch, fall back to an even split across the clip so every word still gets a usable time.
    """
    if len(rec) == len(disp) and rec:
        return [(r["start"], r["end"]) for r in rec]
    n = len(disp)
    return [(clip_s * i / n, clip_s * (i + 1) / n) for i in range(n)]


def main() -> None:
    a = parse_args()
    out = Path(a.out)
    (out / "vo").mkdir(parents=True, exist_ok=True)
    lines = [l.strip() for l in Path(a.script).read_text().splitlines() if l.strip()]
    if not lines:
        sys.exit("vo: script is empty")

    kok = kokoro()
    clips: list[np.ndarray] = []
    for i, line in enumerate(lines, 1):
        raw_wav = out / "vo" / f"s{i:02d}.wav"
        synth_line(kok, line, a.voice, a.speed, raw_wav)
        clips.append(trimmed_f32(raw_wav))

    starts, t = [], a.lead
    for c in clips:
        starts.append(round(t, 3))
        t += len(c) / SR + a.gap
    duration = round(t - a.gap + a.tail, 2)

    bed = np.zeros(int(duration * SR) + SR, np.float32)
    words: list[dict] = []
    for i, (line, st, clip) in enumerate(zip(lines, starts, clips), 1):
        k = int(st * SR)
        bed[k:k + len(clip)] += clip
        disp = line.split()
        clip_s = len(clip) / SR
        # whisper needs a file: write the trimmed clip, align, then discard
        tmp = out / "vo" / f"s{i:02d}.trim.wav"
        sf.write(str(tmp), clip, SR)
        times = line_word_times(disp, whisper_words(tmp, a.whisper_model), clip_s)
        tmp.unlink(missing_ok=True)
        for word, (ws, we) in zip(disp, times):
            words.append({"text": word, "start": round(st + ws, 3), "end": round(st + we, 3), "line": i})
        print(f"line {i:2d}  {st:6.2f}-{st + clip_s:6.2f}  {line[:60]}")

    sf.write(str(out / "vo.wav"), bed[: int(duration * SR)], SR)
    (out / "words.json").write_text(json.dumps({"duration": duration, "words": words}, indent=0))
    print(f"{len(words)} words timed, film length {duration}s -> {out}/vo.wav, {out}/words.json")


if __name__ == "__main__":
    main()
