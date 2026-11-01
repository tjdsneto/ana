#!/usr/bin/env python3
"""vo — voiceover + word timing, the storyboard timeline's spine.

A craft TOOL (not engine code): the voice-production skill calls it and chooses the TTS engine.
Synthesizes one clip per script line with the selected engine, lays them end to end with a lead-in
and inter-line gap, and force-times every word so cuts / clicks / captions can be anchored to a
spoken word (see spec 09, Family A). The timing + laydown are engine-agnostic; only the synth differs.

Engines (--engine): `kokoro` (default) — Kokoro ONNX, higher quality; `piper` — fast, lightweight,
broad voice/language catalogue (good for drafts or languages Kokoro lacks). Both local and keyless.

Technique lifted from the reference `vo.py` (real-ui-launch-film), re-authored for this repo:
  - TTS: Kokoro ONNX / Piper CLI directly (local, keyless) instead of the HyperFrames CLI.
  - Word timing: the `whisper` CLI with --word_timestamps instead of torchaudio's MMS aligner
    (torchaudio is not installed here; whisper is). Clean TTS audio aligns well.

Run under the Kokoro venv python (it has soundfile + numpy + whisper; piper is a separate binary):
  "$KOKORO_HOME/venv/bin/python" craft/tools/vo.py --script script.txt --out media [options]

Writes <out>/vo/<engine>/sNN.wav (cached — delete to redo a line), <out>/vo.wav (48 kHz mono
composition clock) and <out>/words.json = {"duration": s, "words": [{text, start, end, line}]}.
"""
import argparse
import difflib
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf

SR = 48000  # composition sample rate

# Voice provider seam (tmp/audio-provider-seam-design.md): name -> an adapter TOOL that writes an audio
# file from text on stdin. vo.py shells it per line and keeps owning the timing + laydown. kokoro/piper
# stay in-process (they are local binaries already); new + all API providers land here as their own tool.
TTS_TOOLS = {"openai-tts": Path(__file__).resolve().parent / "tts" / "openai-tts.py"}


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="voiceover + per-word timing")
    p.add_argument("--script", required=True, help="text file, one VO line per line")
    p.add_argument("--out", required=True, help="output dir (gets vo/, vo.wav, words.json)")
    p.add_argument("--film", default=None, help="film.json to read voice{id,speed,lead,gap}+tail from (CLI flags override)")
    p.add_argument("--voice", default=None, help="voice id (Kokoro id for kokoro; an OpenAI voice for openai-tts)")
    p.add_argument("--speed", type=float, default=None)
    p.add_argument("--lead", type=float, default=None, help="silence before the first line (s)")
    p.add_argument("--gap", type=float, default=None, help="silence between lines (s)")
    p.add_argument("--tail", type=float, default=None, help="trailing room after the last line (s)")
    p.add_argument("--whisper-model", default="base")
    p.add_argument("--engine", choices=("kokoro", "piper", *TTS_TOOLS.keys()), default="kokoro",
                   help="voice engine: local kokoro/piper, or a provider tool (e.g. openai-tts)")
    p.add_argument("--piper-bin", default=None, help="piper binary (default: $PIPER_BIN or 'piper')")
    p.add_argument("--piper-model", default=None, help="piper .onnx voice (default: $PIPER_MODEL or $VOICE_MODEL)")
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


def make_synth(a: argparse.Namespace):
    """Return synth(text, out_wav) for the chosen engine. Each synth caches: skip if the wav exists.

    Both engines write a wav that trimmed_f32() later normalizes to 48 kHz mono, so the engine's own
    sample rate does not matter downstream — only the (engine-agnostic) word timing + laydown do.
    """
    if a.engine == "kokoro":
        kok = kokoro()

        def synth(text: str, out_wav: Path) -> None:
            if out_wav.exists():
                return
            samples, sr = kok.create(text, voice=a.voice, speed=a.speed, lang="en-us")
            sf.write(str(out_wav), samples, sr)

        return synth

    if a.engine == "piper":
        piper_bin = a.piper_bin or os.environ.get("PIPER_BIN", "piper")
        model = a.piper_model or os.environ.get("PIPER_MODEL") or os.environ.get("VOICE_MODEL")
        if not model or not Path(model).exists():
            sys.exit(f"vo: piper model not found ({model!r}); set --piper-model or $VOICE_MODEL")
        # Piper paces with --length_scale (inverse of speed: >1 is slower), so map our `speed`.
        length_scale = round(1.0 / a.speed, 3) if a.speed else 1.0

        def synth(text: str, out_wav: Path) -> None:
            if out_wav.exists():
                return
            subprocess.run(
                [piper_bin, "--model", str(model), "--length_scale", str(length_scale), "--output_file", str(out_wav)],
                input=text.encode("utf-8"), capture_output=True, check=True)

        return synth

    tool = TTS_TOOLS.get(a.engine)
    if tool:
        if not tool.exists():
            sys.exit(f"vo: provider tool missing: {tool}")

        def synth(text: str, out_wav: Path) -> None:
            if out_wav.exists():
                return
            # The provider tool resolves its own key ($OPENAI_API_KEY etc.) at call time; vo.py never sees it.
            r = subprocess.run(
                [sys.executable, str(tool), "--out", str(out_wav), "--voice", str(a.voice),
                 "--speed", str(a.speed), "--format", "wav"],
                input=text.encode("utf-8"), capture_output=True)
            if r.returncode != 0:
                sys.exit(f"vo: {a.engine} failed — {r.stderr.decode('utf-8', 'replace').strip()[:300]}")

        return synth

    sys.exit(f"vo: unknown engine {a.engine!r}")


def trimmed_f32(wav: Path) -> np.ndarray:
    """Trim head/tail silence and return 48 kHz mono float32 samples (via ffmpeg)."""
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(wav), "-af",
         "silenceremove=start_periods=1:start_threshold=-45dB,areverse,"
         "silenceremove=start_periods=1:start_threshold=-45dB,areverse",
         "-ar", str(SR), "-ac", "1", "-f", "f32le", "-"],
        capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32)


def squeeze_pauses(x: np.ndarray, max_pause: float = 0.2, floor_db: float = -45.0) -> np.ndarray:
    """Cut silent runs inside a clip down to `max_pause` seconds (TTS comma pauses read as dead air)."""
    hop = SR // 100  # 10 ms frames
    n = len(x) // hop
    if n == 0:
        return x
    rms = np.sqrt(np.mean(np.square(x[: n * hop].reshape(n, hop)), axis=1)) + 1e-9
    quiet = 20 * np.log10(rms) < floor_db
    keep, i = [], 0
    limit = int(max_pause * 100)
    while i < n:
        j = i
        while j < n and quiet[j] == quiet[i]:
            j += 1
        run = min(j - i, limit) if quiet[i] else j - i
        keep.append(x[i * hop:(i + run) * hop])
        i = j
    keep.append(x[n * hop:])
    return np.concatenate(keep)


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
    # Align the two letter streams (script vs whisper) with difflib, so a mis-heard or repeated word
    # ("AIOSEO" -> "AEOCO", "forms" -> "for Forms") shifts only itself, not every word after it.
    def letters(x: str) -> str:
        return "".join(c.lower() for c in x if c.isalnum())

    sc = "".join(letters(w) for w in disp)
    wc = "".join(letters(r["word"]) for r in rec)
    tok_of = [k for k, r in enumerate(rec) for _ in letters(r["word"])]
    blocks = [m for m in difflib.SequenceMatcher(None, sc, wc, autojunk=False).get_matching_blocks() if m.size]
    anchors = [(0, 0)] + [(m.a + d, m.b + d) for m in blocks for d in (0, m.size)] + [(len(sc), len(wc))]
    anchors = sorted(set(anchors))

    def to_whisper(pos: int) -> int:  # script letter position -> whisper letter position, interpolated
        for (a0, b0), (a1, b1) in zip(anchors, anchors[1:]):
            if a0 <= pos <= a1:
                return b0 if a1 == a0 else round(b0 + (b1 - b0) * (pos - a0) / (a1 - a0))
        return len(wc)

    first, count = {}, {}
    for pos, k in enumerate(tok_of):
        first.setdefault(k, pos)
        count[k] = count.get(k, 0) + 1

    def time_at(pos: int) -> float:  # whisper letter boundary -> seconds, linear inside a token
        pos = min(max(pos, 0), len(wc))
        if pos >= len(wc):
            return rec[tok_of[-1]]["end"]
        k = tok_of[pos]
        frac = (pos - first[k]) / count[k]
        return rec[k]["start"] + frac * (rec[k]["end"] - rec[k]["start"])

    def end_at(pos: int) -> float:  # end of the last whisper letter before the boundary
        q = min(max(pos - 1, 0), len(wc) - 1)
        k = tok_of[q]
        return rec[k]["start"] + (q + 1 - first[k]) / count[k] * (rec[k]["end"] - rec[k]["start"])

    out, cum = [], 0
    for L in lens:
        out.append((time_at(to_whisper(cum)), end_at(to_whisper(cum + L))))
        cum += L
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
    # Cache per engine so switching engines never reuses the other engine's clips.
    vodir = out / "vo" / a.engine
    vodir.mkdir(parents=True, exist_ok=True)
    lines = [l.strip() for l in Path(a.script).read_text().splitlines() if l.strip()]
    if not lines:
        sys.exit("vo: script is empty")

    synth = make_synth(a)
    clips: list[np.ndarray] = []
    for i, line in enumerate(lines, 1):
        raw_wav = vodir / f"s{i:02d}.wav"
        synth(line, raw_wav)
        clips.append(squeeze_pauses(trimmed_f32(raw_wav)))

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
        tmp = vodir / f"s{i:02d}.trim.wav"
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
