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
    p.add_argument("--film", default=None, help="film.json to read voice{id,speed,lead,gap}+tail from (CLI flags override)")
    p.add_argument("--voice", default=None, help="Kokoro voice id")
    p.add_argument("--speed", type=float, default=None)
    p.add_argument("--lead", type=float, default=None, help="silence before the first line (s)")
    p.add_argument("--gap", type=float, default=None, help="silence between lines (s)")
    p.add_argument("--tail", type=float, default=None, help="trailing room after the last line (s)")
    p.add_argument("--whisper-model", default="base")
    a = p.parse_args()
    # Defaults, then film.json (if given), then explicit CLI flags win.
    d = {"voice": "af_heart", "speed": 0.95, "lead": 0.6, "gap": 0.45, "tail": 3.0}
    if a.film:
        f = json.loads(Path(a.film).read_text())
        v = f.get("voice", {})
        d.update(voice=v.get("id", d["voice"]), speed=v.get("speed", d["speed"]),
                 lead=v.get("lead", d["lead"]), gap=v.get("gap", d["gap"]), tail=f.get("tail", d["tail"]))
    for k in ("voice", "speed", "lead", "gap", "tail"):
        if getattr(a, k) is None:
            setattr(a, k, d[k])
    return a


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

    Keep the script words verbatim (whisper can mis-spell, split or merge words: "WP"+"Forms",
    "awesomemotive.com" as two tokens). Whisper's token count then differs from the script's, so match by
    letter position instead of index: each script word takes the whisper tokens whose letters cover the
    same share of the line. With no whisper tokens at all, split the clip by letters (closer to real
    speech than an even split).
    """
    def n_letters(x: str) -> int:
        return max(1, sum(c.isalnum() for c in x))

    n = len(disp)
    if len(rec) == n and rec:
        return [(r["start"], r["end"]) for r in rec]
    lens = [n_letters(w) for w in disp]
    total = sum(lens)
    if not rec:
        edge = [clip_s * sum(lens[:i]) / total for i in range(n + 1)]
        return [(edge[i], edge[i + 1]) for i in range(n)]
    rl = [n_letters(r["word"]) for r in rec]
    rtot = sum(rl)
    # whisper-letter midpoint of each token; a script word owns tokens whose midpoint falls in its span
    mids, acc = [], 0
    for L in rl:
        mids.append((acc + L / 2) / rtot)
        acc += L
    out, lo, cum = [], 0, 0
    for i, w in enumerate(lens):
        cum += w
        hi_frac = cum / total
        toks = [k for k, m in enumerate(mids) if (cum - w) / total <= m < hi_frac or (i == n - 1 and m >= (cum - w) / total)]
        if not toks:  # no token midpoint inside the span: borrow the nearest one
            toks = [min(range(len(mids)), key=lambda k: abs(mids[k] - (cum - w / 2) / total))]
        out.append((rec[toks[0]]["start"], rec[toks[-1]]["end"]))
    fixed, prev = [], 0.0  # keep starts monotonic, every word at least 50 ms
    for st, en in out:
        st = max(st, prev)
        en = max(en, st + 0.05)
        fixed.append((st, en))
        prev = en
    return fixed


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
