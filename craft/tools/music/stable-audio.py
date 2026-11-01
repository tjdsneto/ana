#!/usr/bin/env python3
"""stable-audio — generative music PROVIDER TOOL: Stable Audio via the Stability AI API.

A craft tool behind the music `generate:` seam — the keyed, higher-quality alternative to local
MusicGen. Runs under any python3 (stdlib urllib; no venv, no torch). The key is the Stability AI
Developer Platform key (platform.stability.ai), NOT the consumer stableaudio.com login.

BYO-key: resolved at call time, --api-key-file > --api-key > $STABILITY_API_KEY. Never baked.

  python3 craft/tools/music/stable-audio.py --prompt "warm uplifting corporate" --duration 12 --out bed.mp3 \\
      [--model stable-audio-2.5] [--format mp3|wav] [--api-key-file KEYFILE]

Wire into music.py's generate: seam with (one line; {…} are music.py's placeholders):
  export MUSIC_GEN_CMD="python3 <repo>/craft/tools/music/stable-audio.py --prompt \"{prompt}\" --duration {duration} --out \"{out}\""

NOTE: endpoint + form fields follow Stability's v2beta text-to-audio as of Nov 2026; the API is still
evolving, so the exact path/model may need a tweak on the first real call. Unit-tested offline; live
run pending a key.
"""
import argparse
import os
import sys
import urllib.error
import urllib.request
import uuid
from pathlib import Path

DEFAULT_ENDPOINT = "https://api.stability.ai/v2beta/audio/stable-audio-2/text-to-audio"
DEFAULT_MODEL = "stable-audio-2.5"


def resolve_key(value: "str | None", key_file: "str | None", env_name: str) -> "str | None":
    """Resolve an API key by precedence: --api-key-file > --api-key > $ENV. None if none set."""
    if key_file:
        return Path(key_file).read_text().strip()
    if value:
        return value
    return os.environ.get(env_name)


def build_fields(prompt: str, duration: float, output_format: str, model: str, steps: "int | None") -> "list[tuple[str, str]]":
    """The multipart text fields for the text-to-audio request (order preserved, all stringified)."""
    fields = [
        ("prompt", prompt),
        ("duration", str(int(round(duration)))),
        ("output_format", output_format),
        ("model", model),
    ]
    if steps:
        fields.append(("steps", str(steps)))
    return fields


def multipart_encode(fields: "list[tuple[str, str]]") -> "tuple[bytes, str]":
    """Encode text-only fields as multipart/form-data. Returns (body, content_type)."""
    boundary = f"----craft{uuid.uuid4().hex}"
    out = []
    for name, value in fields:
        out.append(f"--{boundary}\r\n")
        out.append(f'Content-Disposition: form-data; name="{name}"\r\n\r\n')
        out.append(f"{value}\r\n")
    out.append(f"--{boundary}--\r\n")
    body = "".join(out).encode("utf-8")
    return body, f"multipart/form-data; boundary={boundary}"


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="generate music via the Stability AI Stable Audio API (a provider tool)")
    p.add_argument("--prompt", required=True, help="text description of the music")
    p.add_argument("--duration", type=float, default=8.0, help="seconds (Stable Audio supports up to ~190)")
    p.add_argument("--out", required=True, help="audio file to write")
    p.add_argument("--model", default=DEFAULT_MODEL, help=f"model (default {DEFAULT_MODEL})")
    p.add_argument("--format", dest="fmt", default="mp3", help="output_format: mp3|wav (default mp3)")
    p.add_argument("--steps", type=int, default=None, help="diffusion steps (optional)")
    p.add_argument("--endpoint", default=DEFAULT_ENDPOINT, help="override the API endpoint")
    p.add_argument("--api-key", default=None, help="key by value (visible in `ps`; prefer --api-key-file or $STABILITY_API_KEY)")
    p.add_argument("--api-key-file", default=None, help="read the key from this file (not visible in `ps`)")
    return p.parse_args()


def main() -> None:
    a = parse_args()
    key = resolve_key(a.api_key, a.api_key_file, "STABILITY_API_KEY")
    if not key:
        sys.exit("stable-audio: no key (set $STABILITY_API_KEY, or pass --api-key-file / --api-key; "
                 "it is the platform.stability.ai developer key, never baked)")

    fields = build_fields(a.prompt, a.duration, a.fmt, a.model, a.steps)
    body, content_type = multipart_encode(fields)
    req = urllib.request.Request(
        a.endpoint, data=body, method="POST",
        headers={"Authorization": f"Bearer {key}", "Content-Type": content_type, "Accept": "audio/*"})
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            audio = r.read()
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:400]
        sys.exit(f"stable-audio: API error {e.code} — {detail}")
    except urllib.error.URLError as e:
        sys.exit(f"stable-audio: request failed — {e.reason}")

    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(audio)
    print(f"stable-audio: {len(audio)} bytes ({a.model}/{a.fmt}) -> {out}")


if __name__ == "__main__":
    main()
