#!/usr/bin/env python3
"""openai-tts — a voice PROVIDER TOOL: synthesize one narration clip via the OpenAI TTS API.

A craft tool, not engine code (see tmp/audio-provider-seam-design.md). It is one adapter behind the
voice seam: `vo.py --engine openai-tts` shells this per script line; the engine never calls it. It does
exactly one thing — text in, an audio file out — so vo.py keeps owning the word timing + laydown, the
same as for the local kokoro/piper engines.

BYO-key: the key is resolved at call time, never baked. Precedence `--api-key-file` > `--api-key` >
$OPENAI_API_KEY. A future BYOK store (DB / password manager) injects it by param; env stays the local
default. Prefer `--api-key-file` or the env var over a raw `--api-key` (a value on the command line is
visible in the process list). No key -> a clear error (never a silent fallback to a paid default).

  echo "Your line here." | python3 craft/video-production/tools/tts/openai-tts.py --out line.wav [--voice alloy] \\
      [--model tts-1] [--speed 0.95] [--format wav] [--api-key-file KEYFILE]
  python3 craft/video-production/tools/tts/openai-tts.py --text "Your line." --out line.wav

Stdlib only (urllib) so it runs under any python3 — including the Kokoro venv python vo.py uses.
Pure helpers (pick_voice / build_payload) are I/O-free and unit-tested in tests/test_openai_tts.py.
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

API_URL = "https://api.openai.com/v1/audio/speech"
# OpenAI TTS voices (tts-1 / tts-1-hd / gpt-4o-mini-tts share the set). Kept here so a kokoro-style
# voice id from film.json (e.g. "af_heart") falls back cleanly instead of erroring at the API.
KNOWN_VOICES = ("alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse")
DEFAULT_VOICE = "alloy"
DEFAULT_MODEL = "tts-1"  # reliably supports `speed` + wav; override to gpt-4o-mini-tts (no speed) via --model


def pick_voice(requested: "str | None", known=KNOWN_VOICES, default=DEFAULT_VOICE) -> "tuple[str, str | None]":
    """Return (voice, note). An unknown/absent id (e.g. a kokoro voice) falls back to the default, with
    a note explaining the swap; a known id passes through with no note."""
    if requested and requested in known:
        return requested, None
    if requested:
        return default, f"voice {requested!r} is not an OpenAI voice; using {default!r}"
    return default, None


def resolve_key(value: "str | None", key_file: "str | None", env_name: str) -> "str | None":
    """Resolve an API key by precedence: --api-key-file > --api-key > $ENV. None if none set.
    A key file lets a caller (or a future BYOK store) hand the key over without it showing in `ps`."""
    if key_file:
        return Path(key_file).read_text().strip()
    if value:
        return value
    return os.environ.get(env_name)


def build_payload(text: str, voice: str, model: str, speed: float, fmt: str) -> dict:
    """The JSON body for POST /v1/audio/speech. `speed` is only sent for tts-1* (gpt-4o-mini-tts rejects
    it — it takes `instructions` instead), so an unsupported-param 400 never happens."""
    body = {"model": model, "input": text, "voice": voice, "response_format": fmt}
    if model.startswith("tts-1"):
        body["speed"] = speed
    return body


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="synthesize one clip via the OpenAI TTS API (a voice provider tool)")
    p.add_argument("--out", required=True, help="audio file to write")
    p.add_argument("--text", default=None, help="text to speak (default: read from stdin)")
    p.add_argument("--text-file", default=None, help="file to read the text from (overrides --text/stdin)")
    p.add_argument("--voice", default=None, help=f"OpenAI voice (default {DEFAULT_VOICE}); a non-OpenAI id falls back")
    p.add_argument("--model", default=DEFAULT_MODEL, help=f"TTS model (default {DEFAULT_MODEL})")
    p.add_argument("--speed", type=float, default=1.0, help="0.25-4.0 (tts-1* only)")
    p.add_argument("--format", dest="fmt", default="wav", help="response_format: wav|mp3|opus|aac|flac|pcm")
    p.add_argument("--api-key", default=None, help="key by value (visible in `ps`; prefer --api-key-file or $OPENAI_API_KEY)")
    p.add_argument("--api-key-file", default=None, help="read the key from this file (not visible in `ps`)")
    return p.parse_args()


def main() -> None:
    a = parse_args()
    key = resolve_key(a.api_key, a.api_key_file, "OPENAI_API_KEY")
    if not key:
        sys.exit("openai-tts: no key (set $OPENAI_API_KEY, or pass --api-key-file / --api-key; it is never baked)")

    if a.text_file:
        text = Path(a.text_file).read_text()
    elif a.text is not None:
        text = a.text
    else:
        text = sys.stdin.read()
    text = text.strip()
    if not text:
        sys.exit("openai-tts: no text to speak (--text, --text-file, or stdin)")

    voice, note = pick_voice(a.voice)
    if note:
        print(f"openai-tts: {note}", file=sys.stderr)

    payload = build_payload(text, voice, a.model, a.speed, a.fmt)
    req = urllib.request.Request(
        API_URL, data=json.dumps(payload).encode("utf-8"), method="POST",
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            audio = r.read()
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:300]
        sys.exit(f"openai-tts: API error {e.code} — {detail}")
    except urllib.error.URLError as e:
        sys.exit(f"openai-tts: request failed — {e.reason}")

    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(audio)
    print(f"openai-tts: {len(audio)} bytes ({a.model}/{voice}/{a.fmt}) -> {out}")


if __name__ == "__main__":
    main()
