---
name: voice-production
description: Own the voiceover step — pick the best TTS engine (Kokoro / Piper / …) for the job and produce the word-timed narration (media/vo.wav + media/words.json) that the build, mix, and render steps consume. Invoked for the voice step; it does not write the script, it speaks it.
---

# voice-production

You own the **voice** step of the pipeline: turn the approved script into narration audio plus per-word timing. You do **not** author the script — you speak exactly the lines you are given, and you choose the right TTS tool for the job.

## The tools you own

Each engine is a local, keyless tool the worker can run. Know what each is for:

| Engine | Use it for | Notes |
|--------|-----------|-------|
| `kokoro` (default) | The final / hero render — highest naturalness and prosody. | Heavier; narrower voice + language set today. Needs the Kokoro model under `$KOKORO_HOME`. |
| `piper` | Drafts and previews, tight time/resource budgets, or a language/voice Kokoro does not cover. | Fast, lightweight, huge voice + language catalogue. Needs the `piper` binary + a `.onnx` voice (`$VOICE_MODEL`). |
| `elevenlabs` | (future, not wired) premium / branded voices. | Keyed/paid — add as a tool here when it lands; until then do not promise it. |

**Picking:** final or hero cut → `kokoro` **only if its model is present** at `$KOKORO_HOME`; otherwise `piper`. Draft/preview, a resource/time crunch, or a language/voice Kokoro lacks → `piper`. **Fall back to whichever engine is actually available** — if the Kokoro model is missing, use `piper` (NOT the other way round); only if neither a Kokoro model nor the `piper` binary + its `$VOICE_MODEL` voice exists do you stop and report — never fabricate audio. (A worker provisioned with only `piper` — e.g. the engine container — uses `piper`.)

## Inputs

A **work dir** that already holds `script.txt` (one VO line per line) and `film.json` (its `voice` block sets `id`, `speed`, `lead`, `gap`). Run under the Kokoro venv python (it carries `soundfile` + `numpy` + `whisper`, which the timing step needs for every engine; `piper` is a separate binary).

## Steps

1. Choose the engine per the table above for what this render needs.
2. Produce the narration + word timing:
   ```
   "$KOKORO_PY" craft/tools/vo.py --script <workDir>/script.txt --film <workDir>/film.json --out <workDir>/media --engine <kokoro|piper>
   ```
3. Confirm `<workDir>/media/vo.wav` and `<workDir>/media/words.json` exist and are non-empty.

## Output contract

`<workDir>/media/vo.wav` (48 kHz mono composition clock) and `<workDir>/media/words.json` (`{"duration": s, "words": [{text, start, end, line}]}`). The build / mix / render steps read these — the contract is identical whatever engine you picked.

## How the assembly reaches you

The render step (`render-film`) either runs the whole chain with your choice — `make-film.sh <workDir> --voice-engine <engine>` — or, when you produced the VO here first, runs `make-film.sh <workDir> --skip-voice` so the chain reuses your `media/vo.wav` + `media/words.json`.

## If a step fails

- Missing `kokoro` model (`$KOKORO_HOME`) or `piper` model (`$VOICE_MODEL`) → `vo.py` exits with that reason. Switch engine or report; do not substitute silent/fake audio.
- `whisper` / `ffmpeg` must be on PATH for timing + laydown (both engines).
