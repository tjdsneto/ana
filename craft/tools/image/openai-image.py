#!/usr/bin/env python3
"""openai-image — an image PROVIDER TOOL: generate ONE still via the OpenAI Images API.

A craft tool, not engine code. One adapter behind image.py's generate seam: `image.py --provider
openai` shells this per variation; the engine never calls it. It does exactly one thing — a prompt in,
one image file out — so image.py keeps owning the request routing, the variation loop and provenance,
the same as it does for the gemini and stub providers.

BYO-key: the key is resolved at call time, never baked. Precedence `--api-key-file` > `--api-key` >
$OPENAI_API_KEY. Prefer `--api-key-file` or the env var over a raw `--api-key` (a value on the command
line is visible in the process list). No key -> a clear error (never a silent fallback).

  python3 craft/tools/image/openai-image.py --prompt "glossy 3D app icon on black" --out icon.png \\
      [--model gpt-image-1] [--size 1024x1024] [--api-key-file KEYFILE]

Stdlib only (urllib) so it runs under any python3 — no openai SDK dependency. gpt-image-1 returns the
image base64-encoded in data[0].b64_json. Pure helpers (resolve_key / build_payload / image_bytes)
are I/O-free and unit-tested in tests/test_openai_image.py.
"""
import argparse
import base64
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

API_URL = "https://api.openai.com/v1/images/generations"
DEFAULT_MODEL = "gpt-image-1"
DEFAULT_SIZE = "1024x1024"  # gpt-image-1: 1024x1024 | 1536x1024 | 1024x1536 | auto


def resolve_key(value: "str | None", key_file: "str | None", env_name: str) -> "str | None":
    """Resolve an API key by precedence: --api-key-file > --api-key > $ENV. None if none set.
    A key file lets a caller (or a future BYOK store) hand the key over without it showing in `ps`."""
    if key_file:
        return Path(key_file).read_text().strip()
    if value:
        return value
    return os.environ.get(env_name)


def build_payload(prompt: str, model: str, size: str, n: int = 1) -> dict:
    """The JSON body for POST /v1/images/generations. gpt-image-1 always returns b64_json, so no
    response_format is sent (it rejects the param that dall-e models require)."""
    return {"model": model, "prompt": prompt, "size": size, "n": n}


def image_bytes(resp: dict) -> bytes:
    """Decode the first image from an Images API response (data[0].b64_json -> raw bytes)."""
    data = resp.get("data") or []
    if not data or not data[0].get("b64_json"):
        raise ValueError("no image in response (expected data[0].b64_json)")
    return base64.b64decode(data[0]["b64_json"])


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="generate one image via the OpenAI Images API (a provider tool)")
    p.add_argument("--prompt", required=True, help="text description of the image")
    p.add_argument("--out", required=True, help="image file to write")
    p.add_argument("--model", default=DEFAULT_MODEL, help=f"model (default {DEFAULT_MODEL})")
    p.add_argument("--size", default=DEFAULT_SIZE, help=f"size WxH (default {DEFAULT_SIZE})")
    p.add_argument("--api-key", default=None, help="key by value (visible in `ps`; prefer --api-key-file or $OPENAI_API_KEY)")
    p.add_argument("--api-key-file", default=None, help="read the key from this file (not visible in `ps`)")
    return p.parse_args()


def main() -> None:
    a = parse_args()
    key = resolve_key(a.api_key, a.api_key_file, "OPENAI_API_KEY")
    if not key:
        sys.exit("openai-image: no key (set $OPENAI_API_KEY, or pass --api-key-file / --api-key; it is never baked)")

    payload = build_payload(a.prompt, a.model, a.size)
    req = urllib.request.Request(
        API_URL, data=json.dumps(payload).encode("utf-8"), method="POST",
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            resp = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:400]
        sys.exit(f"openai-image: API error {e.code} — {detail}")
    except urllib.error.URLError as e:
        sys.exit(f"openai-image: request failed — {e.reason}")

    try:
        img = image_bytes(resp)
    except ValueError as e:
        sys.exit(f"openai-image: {e}")

    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(img)
    print(f"openai-image: {len(img)} bytes ({a.model}/{a.size}) -> {out}")


if __name__ == "__main__":
    main()
