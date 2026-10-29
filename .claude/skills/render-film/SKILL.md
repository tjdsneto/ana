---
name: render-film
description: Assemble the finished video from an approved storyboard (film.json) using the craft tools. Invoked for a render node — it does not author content, it builds what the storyboard specifies.
---

# render-film

You render the final video from the storyboard the upstream already produced. You do **not** invent content — you assemble exactly what `film.json` specifies.

## Inputs

The task prompt gives a **work dir** that already contains `film.json` (the approved storyboard: title, theme, voice, the `script` lines, the plates = the brand's provided site URLs, camera, chips, outro). You run from the repo root (the craft root).

## Steps

1. Write the spoken script to `<workDir>/script.txt` — one line per entry of film.json's `script` array:
   ```
   node -e "const f=require('<workDir>/film.json');require('fs').writeFileSync('<workDir>/script.txt',(f.script||[]).join('\n'))"
   ```
2. Assemble with the one-command driver (it captures the film.json's live plate URLs from the provided site, synthesizes the voiceover, builds the GSAP composition, mixes, and renders):
   ```
   craft/tools/make-film.sh <workDir> --out <workDir>/film.mp4
   ```
   If the plates are already captured in `<workDir>/assets/shots/` (upstream provided them), add `--skip-capture`.
3. Confirm `<workDir>/film.mp4` exists and is non-empty (`ls -la <workDir>/film.mp4`).

## Output

Reply with just the path `<workDir>/film.mp4`. Nothing else. Do not read the .mp4 into your reply (it is binary).

## If a step fails

- `make-film` needs the Kokoro venv python + ffmpeg + Playwright on PATH (the worker host has them). If capture fails on a plate URL, check the URL/steps in film.json are valid for the provided site.
- Never install or host anything. If the provided site is unreachable, stop and report it — do not substitute a fake.
