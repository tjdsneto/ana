#!/usr/bin/env python3
"""gemini-image — an image PROVIDER TOOL: generate ONE still via the Gemini image API.

A craft tool, not engine code. One adapter behind image.py's generate seam: `image.py --provider
gemini` shells this per variation; the engine never calls it. A prompt in, one image file out — the
same contract as the openai and stub providers, so image.py keeps owning routing, the variation loop
and provenance.

The model is gemini-2.5-flash-image (image generation via the generateContent endpoint — the model
sometimes called "nano banana"). BYO-key, resolved at call time, never baked: `--api-key-file` >
`--api-key` > $GEMINI_API_KEY (falls back to $GOOGLE_API_KEY). The key is sent as the x-goog-api-key
HEADER, not a URL query param, so it never lands in a logged URL.

  python3 craft/video-production/tools/image/gemini-image.py --prompt "glossy 3D app icon on black" --out icon.png \\
      [--model gemini-2.5-flash-image] [--api-key-file KEYFILE]

Stdlib only (urllib) so it runs under any python3 — no google SDK dependency. The image comes back as
base64 in candidates[0].content.parts[].inlineData.data. NOTE: Gemini image gen has no explicit size
param like OpenAI's; --size is accepted for interface parity (put aspect in the prompt). Pure helpers
(resolve_key / build_url / build_payload / image_bytes) are unit-tested in tests/test_gemini_image.py.
"""
import argparse
import base64
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

API_BASE = "https://generativelanguage.googleapis.com/v1beta/models"
DEFAULT_MODEL = "gemini-2.5-flash-image"


def resolve_key(value: "str | None", key_file: "str | None", env_names=("GEMINI_API_KEY", "GOOGLE_API_KEY")) -> "str | None":
    """Resolve an API key by precedence: --api-key-file > --api-key > first set of $env_names. None if none set."""
    if key_file:
        return Path(key_file).read_text().strip()
    if value:
        return value
    for name in env_names:
        if os.environ.get(name):
            return os.environ[name]
    return None


def build_url(model: str, base: str = API_BASE) -> str:
    """The generateContent endpoint for a model. The key goes in a header, not here."""
    return f"{base}/{model}:generateContent"


MIME = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif"}


def inline_part(path: str) -> dict:
    """An inlineData image part for a local file (base64 bytes, mime from the extension) — the input
    image(s) to EDIT. The only I/O helper; build_payload stays pure so it can take fakes in tests."""
    p = Path(path)
    return {"inlineData": {"mimeType": MIME.get(p.suffix.lower(), "image/png"),
                           "data": base64.b64encode(p.read_bytes()).decode("ascii")}}


def build_payload(prompt: str, image_parts: "list[dict] | None" = None) -> dict:
    """The JSON body for generateContent. Any input image parts come first, then the text — the
    edit shape the model expects ("here is the screen; do X to it"); with none, it generates from the
    prompt alone. responseModalities=[IMAGE] asks for an image back rather than text."""
    parts = list(image_parts or []) + [{"text": prompt}]
    return {
        "contents": [{"parts": parts}],
        "generationConfig": {"responseModalities": ["IMAGE"]},
    }


def image_bytes(resp: dict) -> bytes:
    """Decode the first inline image from a generateContent response. Raises ValueError if the model
    returned no image part (e.g. it answered with text, or the prompt was refused)."""
    for cand in resp.get("candidates") or []:
        for part in (cand.get("content") or {}).get("parts") or []:
            inline = part.get("inlineData") or part.get("inline_data")
            if inline and inline.get("data"):
                return base64.b64decode(inline["data"])
    raise ValueError("no image in response (no inlineData part — the model may have answered in text)")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="generate one image via the Gemini image API (a provider tool)")
    p.add_argument("--prompt", required=True, help="text description, or the edit instruction when --input is given")
    p.add_argument("--input", action="append", default=None, metavar="IMG",
                   help="input image to EDIT (repeatable); omit to generate from the prompt alone")
    p.add_argument("--out", required=True, help="image file to write")
    p.add_argument("--model", default=DEFAULT_MODEL, help=f"model (default {DEFAULT_MODEL})")
    p.add_argument("--size", default=None, help="accepted for parity; Gemini has no size param (put aspect in the prompt)")
    p.add_argument("--api-key", default=None, help="key by value (visible in `ps`; prefer --api-key-file or $GEMINI_API_KEY)")
    p.add_argument("--api-key-file", default=None, help="read the key from this file (not visible in `ps`)")
    return p.parse_args()


def main() -> None:
    a = parse_args()
    key = resolve_key(a.api_key, a.api_key_file)
    if not key:
        sys.exit("gemini-image: no key (set $GEMINI_API_KEY / $GOOGLE_API_KEY, or pass --api-key-file / --api-key; it is never baked)")

    for pth in a.input or []:
        if not Path(pth).exists():
            sys.exit(f"gemini-image: --input not found: {pth}")
    payload = build_payload(a.prompt, [inline_part(p) for p in (a.input or [])])
    req = urllib.request.Request(
        build_url(a.model), data=json.dumps(payload).encode("utf-8"), method="POST",
        headers={"x-goog-api-key": key, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            resp = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:400]
        sys.exit(f"gemini-image: API error {e.code} — {detail}")
    except urllib.error.URLError as e:
        sys.exit(f"gemini-image: request failed — {e.reason}")

    try:
        img = image_bytes(resp)
    except ValueError as e:
        sys.exit(f"gemini-image: {e}")

    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(img)
    mode = f"edit of {len(a.input)} input(s)" if a.input else "generate"
    print(f"gemini-image: {len(img)} bytes ({a.model}, {mode}) -> {out}")


if __name__ == "__main__":
    main()
