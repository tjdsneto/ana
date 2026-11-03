---
name: render-film
description: Assemble the finished video from an approved storyboard (film.json) using the craft tools. Invoked for a render node — it does not author content, it builds what the storyboard specifies.
---

# render-film

You render the final video from the storyboard the upstream already produced. You do **not** invent content — you assemble exactly what `film.json` specifies.

## Hold to the craft bar

You assemble, you don't author — but the finished render is still held to `craft/video-production/.claude/references/CRAFT-BAR.md`. Read **§A (universal taste)** and the **§B profile** matching this production's type before you build. You don't re-storyboard, but the choices you *do* own land on the bar: the **sound** (§A5 — a music bed under the VO and deliberate SFX, never bare flat TTS with true silence in every gap), **captions** that stay legible (§A4), and **no dead tail** (§A4 — end on the last meaningful beat, not seconds of static hold). If what `film.json` specifies can't clear §A5 — e.g. no music bed resolves at all — flag it rather than quietly shipping a bare render.

## Inputs

The task prompt gives a **work dir** that already contains `film.json` (the approved storyboard: title, theme, voice, the `script` lines, the plates = the brand's provided site URLs, camera, chips, outro). You run from the repo root (the craft root).

## Steps

1. Write the spoken script to `<workDir>/script.txt` — one line per entry of film.json's `script` array:
   ```
   node -e "const f=require('<workDir>/film.json');require('fs').writeFileSync('<workDir>/script.txt',(f.script||[]).join('\n'))"
   ```
2. Assemble with the one-command driver (it captures the film.json's live plate URLs from the provided site, synthesizes the voiceover, builds the GSAP composition, mixes, and renders):
   ```
   craft/video-production/tools/make-film.sh <workDir> --out <workDir>/film.mp4
   ```
   - The **voice** step inside the chain is owned by the `voice-production` skill — pick the TTS engine per that skill and pass `--voice-engine <kokoro|piper>` (default `kokoro`). If `voice-production` already produced `<workDir>/media/vo.wav` + `media/words.json`, pass `--skip-voice` so the chain reuses them instead of re-synthesizing.
   - **External narration (not TTS).** If `film.json` sets `"audio"` (a path to a real voice clip — a human take, an avatar/cinematic render), the chain word-times that clip (`align.py`) and uses its audio as the narration instead of synthesizing. `--audio-clip <file>` overrides the field. The script.txt is used for verbatim word timing when present.
   - **Music** resolves automatically from `film.json`'s `music` field (`music.py` → library pick / BYO path / generated bed); an explicit `--music <file>` overrides it.
   - **Captions** burn onto the render automatically when `film.json` sets `"captions"` (`true` / `"karaoke"` / `"block"` / an object of overrides), writing an `.srt` sidecar beside the `.mp4`. Force on without the field with `--captions`; suppress with `--no-captions`; pick a look with `--caption-style karaoke|block`.
   - If the plates are already captured in `<workDir>/assets/shots/` (upstream provided them), add `--skip-capture`.
   - Plates may drive an app UI: a plate `step` can carry a `js` string (async OK) that runs in the page to click/expand before the shot (used for dashboard walkthroughs). `make-film` runs them as-is.
3. **Tail clip (explainer mode).** If `film.json` has a `tail_clip` (an absolute `.mp4` path to append — e.g. the very video this explainer describes), concatenate it after the render so the deliverable ends by playing it:
   ```
   craft/video-production/tools/append-clip.sh <workDir>/film.mp4 <tail_clip> <workDir>/film-final.mp4
   ```
   `film-final.mp4` is then THE deliverable (it is the newest .mp4 in the work dir, so the engine records it). If there is no `tail_clip`, skip this step — `film.mp4` is the deliverable.
4. Confirm the deliverable exists and is non-empty (`ls -la <workDir>/film-final.mp4` if you appended a tail, else `<workDir>/film.mp4`).

## Output

Reply with just the deliverable path — `<workDir>/film-final.mp4` if you appended a `tail_clip`, otherwise `<workDir>/film.mp4`. Nothing else. Do not read the .mp4 into your reply (it is binary).

## If a step fails

- `make-film` needs the Kokoro venv python + ffmpeg + Playwright on PATH (the worker host has them). If capture fails on a plate URL, check the URL/steps in film.json are valid for the provided site.
- Never install or host anything. If the provided site is unreachable, stop and report it — do not substitute a fake.
