#!/usr/bin/env python3
"""image — resolve an image request to one or more image files for the asset / moodboard lane.

A craft TOOL (not engine code). The asset-production skill calls it and chooses the provider; the
engine never calls it. It decides WHICH image(s) a request wants — a bring-your-own file, a pick from
the local library, or a freshly GENERATED still — and prints each resolved path to stdout (one per
line) so the caller can file it into an asset-set. Still images only; motion stays in motion-graphics.

Four request kinds, chosen by the request string (mirrors music.py's seam):
  - a PATH (".../logo.png", or any .png/.jpg/.webp/...) -> bring-your-own, returned as-is.
  - "library:<query>" -> pick from the local library (craft/video-production/assets/images/, a manifest.json of
    {file, tags, prompt, provider}). Offline; you/the brand seed it (this tool never auto-fetches).
  - "generate:<prompt>", OR a bare string -> generate via the chosen provider. A bare string is a
    PROMPT here (image gen's primary use), the one deliberate divergence from music.py where a bare
    word is a library mood; say "library:<q>" to pick instead.

The provider seam (configurable, so no generator is hard-coded):
  - "stub"   (default) -> a keyless, zero-cost SVG placeholder that names the prompt. Matches the
    RENDER_PROVIDER=stub / VOICE_PROVIDER=silent default: a dry run costs nothing and needs no key.
  - "openai" -> craft/video-production/tools/image/openai-image.py (gpt-image-1), keyed.
  - "gemini" -> craft/video-production/tools/image/gemini-image.py (gemini-2.5-flash-image / "nano banana"), keyed.
  - "custom" -> the $IMAGE_GEN_CMD shell template ({prompt} {out} {model} {size}); covers any other
    generator (local Stable Diffusion, Replicate, fal, ...) without a bespoke adapter.
  Pick with --provider or $IMAGE_PROVIDER; model with --model or $IMAGE_MODEL; size with --size or
  $IMAGE_SIZE (default 1024x1024). Keyed providers resolve the key BYO (never baked): the adapter
  takes --api-key-file / --api-key / its $*_API_KEY, same as the audio providers.

Each generated file gets a <file>.json provenance sidecar {provider, model, prompt, size, created}.
Empty / missing request -> prints nothing, exits 0.

  python3 craft/video-production/tools/image.py --request "generate:glossy 3D app icon on black" [--provider gemini] [--n 4] [--out DIR]
  python3 craft/video-production/tools/image.py --request "assets/logo.png"
  python3 craft/video-production/tools/image.py --request "library:icon-grid" --out media

Pure helpers (parse_request / resolve_provider / stub_svg / provenance) are I/O-free and unit-tested
in tests/test_image.py.
"""
import argparse
import datetime
import json
import os
import subprocess
import sys
import xml.sax.saxutils as saxutils
from pathlib import Path

IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tiff", ".svg"}

# Generate-lane provider adapter tools (the seam): name -> an adapter that writes ONE image to --out.
# image.py shells it per variation; the engine never calls it. New first-class providers land here;
# anything else goes through the "custom" provider + $IMAGE_GEN_CMD without a new file.
PROVIDER_TOOLS = {
    "openai": Path(__file__).resolve().parent / "image" / "openai-image.py",
    "gemini": Path(__file__).resolve().parent / "image" / "gemini-image.py",
}
# Default model per provider, used when neither --model nor $IMAGE_MODEL is set.
PROVIDER_DEFAULT_MODEL = {"openai": "gpt-image-1", "gemini": "gemini-2.5-flash-image"}

DEFAULT_PROVIDER = "stub"
DEFAULT_SIZE = "1024x1024"


def parse_request(spec: "str | None") -> "tuple[str, str]":
    """Request string -> (kind, value). kind in {none, file, library, generate}. A bare string is a
    generate PROMPT (not a library query) — the one divergence from music.py; use "library:" to pick."""
    if not spec or not spec.strip():
        return ("none", "")
    s = spec.strip()
    if s.startswith("generate:"):
        return ("generate", s[len("generate:"):].strip())
    if s.startswith("library:"):
        return ("library", s[len("library:"):].strip())
    if s.startswith("file:"):
        return ("file", s[len("file:"):].strip())
    if Path(s).suffix.lower() in IMAGE_EXT:
        return ("file", s)
    return ("generate", s)  # a bare string is a prompt


def resolve_provider(arg: "str | None", env: "dict | None" = None) -> str:
    """Provider by precedence: --provider > $IMAGE_PROVIDER > stub."""
    env = env if env is not None else os.environ
    return (arg or env.get("IMAGE_PROVIDER") or DEFAULT_PROVIDER).strip().lower()


def resolve_model(arg: "str | None", provider: str, env: "dict | None" = None) -> "str | None":
    """Model by precedence: --model > $IMAGE_MODEL > the provider default (None for stub/custom)."""
    env = env if env is not None else os.environ
    return arg or env.get("IMAGE_MODEL") or PROVIDER_DEFAULT_MODEL.get(provider)


def pick_image(manifest: "list[dict]", query: str) -> "dict | None":
    """Choose the first library entry whose `tags` or `prompt` contains `query` (case-insensitive)."""
    q = query.lower()
    for m in manifest:
        hay = f"{m.get('tags', '')} {m.get('prompt', '')}".lower()
        if q in hay:
            return m
    return None


def stub_svg(prompt: str, size: str, inputs: "list[str] | None" = None) -> str:
    """A keyless, deterministic SVG placeholder that names the prompt. The zero-cost default: a dry run
    produces a real file the pipeline can carry, visibly a STUB so no one ships it by accident. With
    `inputs`, it is an EDIT stub and names the source image(s) so a dry-run makeup is still traceable."""
    w, h = (size.split("x") + ["1024"])[:2] if "x" in size else (size, size)
    try:
        w, h = int(w), int(h)
    except ValueError:
        w = h = 1024
    label = saxutils.escape(prompt[:120] + ("…" if len(prompt) > 120 else ""))
    heading = "IMAGE STUB (EDIT)" if inputs else "IMAGE STUB"
    edit_line = ""
    if inputs:
        names = saxutils.escape(", ".join(Path(p).name for p in inputs))
        edit_line = (f'<text x="{w // 2}" y="{h // 2 + 48}" fill="#9a9ab0" font-family="monospace" '
                     f'font-size="{max(10, w // 60)}" text-anchor="middle">edit of {names}</text>')
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">'
        f'<rect width="{w}" height="{h}" fill="#1a1a22"/>'
        f'<rect x="8" y="8" width="{w - 16}" height="{h - 16}" fill="none" stroke="#C04BFF" '
        f'stroke-width="3" stroke-dasharray="12 10"/>'
        f'<text x="{w // 2}" y="{h // 2 - 20}" fill="#C04BFF" font-family="monospace" '
        f'font-size="{max(14, w // 28)}" text-anchor="middle">{heading}</text>'
        f'<text x="{w // 2}" y="{h // 2 + 20}" fill="#cfcfe0" font-family="monospace" '
        f'font-size="{max(11, w // 48)}" text-anchor="middle">{label}</text>'
        f'{edit_line}'
        f'</svg>'
    )


def provenance(provider: str, model: "str | None", prompt: str, size: str, inputs: "list[str] | None" = None) -> dict:
    """The <file>.json sidecar recorded next to a generated image. `inputs` records the source image(s)
    when the image was an EDIT (makeup) of a real capture, not a from-scratch generation."""
    rec = {
        "provider": provider,
        "model": model,
        "prompt": prompt,
        "size": size,
        "created": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
    }
    if inputs:
        rec["inputs"] = list(inputs)
    return rec


# ---------- I/O ----------

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="resolve an image request to one or more files for the asset / moodboard lane",
        epilog="generate seam — provider is stub (default, keyless) | openai | gemini | custom. "
               "custom uses $IMAGE_GEN_CMD, a shell template with {prompt} {out} {model} {size}.")
    p.add_argument("--request", default=None, help="image request string (file path | library:<q> | generate:<prompt> | bare prompt)")
    p.add_argument("--provider", default=None, help="generate provider: stub|openai|gemini|custom (default: $IMAGE_PROVIDER or stub)")
    p.add_argument("--model", default=None, help="provider model (default: $IMAGE_MODEL or the provider default)")
    p.add_argument("--size", default=None, help=f"image size WxH (default: $IMAGE_SIZE or {DEFAULT_SIZE})")
    p.add_argument("--n", type=int, default=1, help="how many variations to generate (default 1)")
    p.add_argument("--out", default=None, help="dir to write generated image(s) into (default: cwd)")
    p.add_argument("--name", default="image", help="basename stem for generated files (default: image)")
    p.add_argument("--input", action="append", default=None, metavar="IMG",
                   help="input image(s) to EDIT instead of generating from scratch (repeatable) — forwarded to the "
                        "provider adapter and recorded in provenance. The custom template gets it as {input}.")
    p.add_argument("--library", default=None, help="image library dir (default: craft/video-production/assets/images next to this tool)")
    p.add_argument("--api-key-file", default=None,
                   help="for a keyed provider: a file holding its API key, forwarded to the adapter (BYO-key; a "
                        "file, not a value, so the key never shows in `ps`). Omit to use the provider's env var.")
    return p.parse_args()


def _generate_one(provider: str, model: "str | None", prompt: str, size: str, out: Path,
                  api_key_file: "str | None", inputs: "list[str] | None" = None) -> None:
    """Produce ONE image at `out` with the chosen provider. With `inputs`, EDIT those image(s) rather
    than generating from scratch (makeup). Raises SystemExit on failure."""
    out.parent.mkdir(parents=True, exist_ok=True)

    if provider == "stub":
        out.write_text(stub_svg(prompt, size, inputs))
    elif provider == "custom":
        tmpl = os.environ.get("IMAGE_GEN_CMD")
        if not tmpl:
            sys.exit("image: provider 'custom' but no generator wired — set $IMAGE_GEN_CMD "
                     "(template with {prompt} {out} {model} {size} {input})")
        cmd = tmpl.format(prompt=prompt, out=str(out), model=model or "", size=size,
                          input=(inputs[0] if inputs else ""))
        r = subprocess.run(cmd, shell=True, capture_output=True, text=True)
        if r.returncode != 0 or not out.exists():
            sys.exit(f"image: custom generator failed — {r.stderr.strip()[:300]}")
    else:
        tool = PROVIDER_TOOLS.get(provider)
        if not tool:
            sys.exit(f"image: unknown provider {provider!r} (have: stub, custom, {', '.join(PROVIDER_TOOLS)})")
        if not tool.exists():
            sys.exit(f"image: provider adapter missing: {tool}")
        cmd = [sys.executable, str(tool), "--prompt", prompt, "--out", str(out), "--size", size]
        if model:
            cmd += ["--model", model]
        for ip in inputs or []:  # edit mode: the adapter sends these as input image(s)
            cmd += ["--input", str(ip)]
        if api_key_file:  # forward a BYO-key path; the adapter reads it (never the value on the command line)
            cmd += ["--api-key-file", str(api_key_file)]
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode != 0 or not out.exists():
            sys.exit(f"image: {provider} generate failed — {r.stderr.strip()[:300]}")

    sidecar = out.with_suffix(out.suffix + ".json")
    sidecar.write_text(json.dumps(provenance(provider, model, prompt, size, inputs), indent=2))


def main() -> None:
    a = parse_args()
    kind, value = parse_request(a.request)

    if kind == "none":
        return  # no image; print nothing

    if kind == "file":
        p = Path(value)
        if not p.exists():
            sys.exit(f"image: file not found: {value}")
        print(str(p.resolve()))
        return

    lib = Path(a.library) if a.library else Path(__file__).resolve().parent.parent / "assets" / "images"

    if kind == "library":
        manifest_path = lib / "manifest.json"
        if not manifest_path.exists():
            sys.exit(f"image: no library manifest at {manifest_path} (seed craft/video-production/assets/images/)")
        pick = pick_image(json.loads(manifest_path.read_text()), value)
        if not pick:
            sys.exit(f"image: no library image matches query {value!r}")
        img = (lib / pick["file"]) if not Path(pick["file"]).is_absolute() else Path(pick["file"])
        if not img.exists():
            sys.exit(f"image: manifest points to a missing file: {img}")
        print(str(img.resolve()))
        return

    # kind == "generate"
    provider = resolve_provider(a.provider)
    model = resolve_model(a.model, provider)
    size = a.size or os.environ.get("IMAGE_SIZE") or DEFAULT_SIZE
    out_dir = Path(a.out) if a.out else Path.cwd()
    ext = ".svg" if provider == "stub" else ".png"
    n = max(1, a.n)
    for i in range(n):
        stem = a.name if n == 1 else f"{a.name}-{i + 1}"
        out = out_dir / f"{stem}{ext}"
        _generate_one(provider, model, value, size, out, a.api_key_file, a.input)
        print(str(out.resolve()))


if __name__ == "__main__":
    main()
