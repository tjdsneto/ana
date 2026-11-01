#!/usr/bin/env python3
"""elevenlabs — a voice PROVIDER TOOL: synthesize one narration clip via the ElevenLabs TTS API.

A craft tool, not engine code (see tmp/audio-provider-seam-design.md). Second API voice adapter behind
the voice seam, same shape as openai-tts: `vo.py --engine elevenlabs` shells it per line; vo.py keeps
owning the word timing + laydown. Kept in the checklist as working-pending-key — it needs only an API
key, like openai-tts.

BYO-key: resolved at call time, precedence --api-key-file > --api-key > $ELEVENLABS_API_KEY. Never
baked; no key -> a clear error. ElevenLabs sends the key in the `xi-api-key` header.

  echo "Your line." | python3 craft/tools/tts/elevenlabs.py --out line.mp3 [--voice rachel] \\
      [--model eleven_multilingual_v2] [--speed 0.95] [--api-key-file KEYFILE]

Returns MP3 by default (downstream always ffmpeg-decodes, so the container does not matter). Stdlib
only (urllib). Pure helpers (pick_voice / build_payload) are unit-tested in tests/test_elevenlabs.py.
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

API_BASE = "https://api.elevenlabs.io/v1/text-to-speech"
# ElevenLabs addresses voices by opaque voice_id, so map a few friendly names to their public legacy
# ids (and let a raw id pass through). A Kokoro-style id (e.g. "af_heart") is unknown -> default.
KNOWN_VOICES = {
    "rachel": "21m00Tcm4TlvDq8ikWAM",
    "adam": "pNInz6obpgDQGcFmaJgB",
    "antoni": "ErXwobaYiN019PkySvjV",
    "domi": "AZnzlk1XvdvUeBnXmlld",
}
DEFAULT_VOICE = "rachel"
DEFAULT_MODEL = "eleven_multilingual_v2"
DEFAULT_FORMAT = "mp3_44100_128"


def resolve_key(value: "str | None", key_file: "str | None", env_name: str) -> "str | None":
    """Resolve an API key by precedence: --api-key-file > --api-key > $ENV. None if none set."""
    if key_file:
        return Path(key_file).read_text().strip()
    if value:
        return value
    return os.environ.get(env_name)


def pick_voice(requested: "str | None", known=KNOWN_VOICES, default=DEFAULT_VOICE) -> "tuple[str, str | None]":
    """Return (voice_id, note). A known friendly name maps to its id; a raw id (>=20 chars, no spaces)
    passes through; anything else (absent, or a Kokoro id) falls back to the default voice, with a note."""
    if requested:
        low = requested.lower()
        if low in known:
            return known[low], None
        if len(requested) >= 20 and " " not in requested:
            return requested, None  # looks like a voice_id — trust it
        return known[default], f"voice {requested!r} is not a known ElevenLabs voice; using {default!r}"
    return known[default], None


def build_payload(text: str, model: str, speed: float) -> dict:
    """POST body. `speed` goes in voice_settings, clamped to the API's accepted 0.7-1.2 range."""
    return {
        "text": text,
        "model_id": model,
        "voice_settings": {"stability": 0.5, "similarity_boost": 0.75, "speed": max(0.7, min(1.2, speed))},
    }


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="synthesize one clip via the ElevenLabs TTS API (a voice provider tool)")
    p.add_argument("--out", required=True, help="audio file to write (mp3)")
    p.add_argument("--text", default=None, help="text to speak (default: read from stdin)")
    p.add_argument("--text-file", default=None, help="file to read the text from (overrides --text/stdin)")
    p.add_argument("--voice", default=None, help="friendly name (rachel/adam/…) or a raw voice_id; default rachel")
    p.add_argument("--model", default=DEFAULT_MODEL, help=f"model_id (default {DEFAULT_MODEL})")
    p.add_argument("--speed", type=float, default=1.0, help="0.7-1.2 (clamped); goes in voice_settings")
    p.add_argument("--format", dest="fmt", default=DEFAULT_FORMAT, help=f"output_format (default {DEFAULT_FORMAT})")
    p.add_argument("--api-key", default=None, help="key by value (visible in `ps`; prefer --api-key-file or $ELEVENLABS_API_KEY)")
    p.add_argument("--api-key-file", default=None, help="read the key from this file (not visible in `ps`)")
    return p.parse_args()


def main() -> None:
    a = parse_args()
    key = resolve_key(a.api_key, a.api_key_file, "ELEVENLABS_API_KEY")
    if not key:
        sys.exit("elevenlabs: no key (set $ELEVENLABS_API_KEY, or pass --api-key-file / --api-key; it is never baked)")

    if a.text_file:
        text = Path(a.text_file).read_text()
    elif a.text is not None:
        text = a.text
    else:
        text = sys.stdin.read()
    text = text.strip()
    if not text:
        sys.exit("elevenlabs: no text to speak (--text, --text-file, or stdin)")

    voice_id, note = pick_voice(a.voice)
    if note:
        print(f"elevenlabs: {note}", file=sys.stderr)

    payload = build_payload(text, a.model, a.speed)
    url = f"{API_BASE}/{voice_id}?output_format={a.fmt}"
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode("utf-8"), method="POST",
        headers={"xi-api-key": key, "Content-Type": "application/json", "Accept": "audio/mpeg"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            audio = r.read()
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:300]
        sys.exit(f"elevenlabs: API error {e.code} — {detail}")
    except urllib.error.URLError as e:
        sys.exit(f"elevenlabs: request failed — {e.reason}")

    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(audio)
    print(f"elevenlabs: {len(audio)} bytes ({a.model}/{voice_id}/{a.fmt}) -> {out}")


if __name__ == "__main__":
    main()
