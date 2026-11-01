#!/usr/bin/env python3
"""musicgen — generative music PROVIDER TOOL (local, free): Meta MusicGen via transformers.

A craft tool behind the music `generate:` seam. Local + keyless: no API, no account. Run under the
dedicated MusicGen venv (torch + transformers) — NOT the Kokoro venv. First run downloads the model
(default facebook/musicgen-small, ~2GB) from HuggingFace; cached after.

  "$HOME/.local/share/musicgen/venv/bin/python" craft/tools/music/musicgen.py \\
      --prompt "warm uplifting corporate" --duration 8 --out bed.wav [--model facebook/musicgen-small] [--device cpu|mps]

Wire into music.py's generate: seam with (one line, {…} are the seam's placeholders):
  export MUSIC_GEN_CMD='<venv>/bin/python <repo>/craft/tools/music/musicgen.py --prompt {prompt} --duration {duration} --out {out}'

musicgen-small is the light model (good enough for a bed); medium/large are much heavier. On a modest
Mac expect CPU generation of tens of seconds to a couple minutes per short clip.
"""
import argparse
import sys
from pathlib import Path

TOKENS_PER_SEC = 50  # MusicGen's audio frame rate; max_new_tokens = duration * this


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="generate a music bed locally with Meta MusicGen (a provider tool)")
    p.add_argument("--prompt", required=True, help="text description of the music to generate")
    p.add_argument("--duration", type=float, default=8.0, help="seconds of audio to generate (default 8)")
    p.add_argument("--out", required=True, help="wav to write")
    p.add_argument("--model", default="facebook/musicgen-small", help="HF model id (default musicgen-small)")
    p.add_argument("--device", default="cpu", choices=("cpu", "mps"), help="cpu (default, reliable) or mps (faster if supported)")
    p.add_argument("--guidance", type=float, default=3.0, help="classifier-free guidance scale")
    return p.parse_args()


def main() -> None:
    a = parse_args()
    try:
        import torch
        from transformers import AutoProcessor, MusicgenForConditionalGeneration
        import soundfile as sf
    except ImportError as e:
        sys.exit(f"musicgen: missing dep ({e}); run under the MusicGen venv "
                 f"(~/.local/share/musicgen/venv), not the Kokoro venv")

    model = MusicgenForConditionalGeneration.from_pretrained(a.model)
    processor = AutoProcessor.from_pretrained(a.model)
    device = a.device
    if device == "mps" and not torch.backends.mps.is_available():
        print("musicgen: mps unavailable, falling back to cpu", file=sys.stderr)
        device = "cpu"
    model.to(device)

    inputs = processor(text=[a.prompt], padding=True, return_tensors="pt").to(device)
    max_new = max(1, int(a.duration * TOKENS_PER_SEC))
    audio = model.generate(**inputs, max_new_tokens=max_new, do_sample=True, guidance_scale=a.guidance)

    sr = model.config.audio_encoder.sampling_rate  # 32000 for musicgen
    wav = audio[0, 0].detach().to("cpu").numpy()
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(out), wav, sr)
    print(f"musicgen: {len(wav) / sr:.1f}s @ {sr} Hz ({a.model}/{device}) -> {out}")


if __name__ == "__main__":
    main()
