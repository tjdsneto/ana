---
name: voice-production
description: Own the voiceover step — pick the best TTS engine (Kokoro / Piper / …) for the job and produce the word-timed narration (media/vo.wav + media/words.json) that the build, mix, and render steps consume. Invoked for the voice step; it does not write the script, it speaks it.
---

# voice-production

> ## Hold to the craft bar
> Read `craft/video-production/.claude/references/CRAFT-BAR.md` §A5 (Sound). The voice track is judged against it.

You own the **voice** step of the pipeline: turn the approved script into narration audio plus per-word timing. You do **not** author the script — you speak exactly the lines you are given, and you choose the right TTS tool for the job.

## Avoid the AI-voice tell (§A5)

**Flat, first-generation TTS with true silence in every gap is an immediate AI tell.** Steer away from it:

- **Engine choice is the first lever.** Prefer **`kokoro`** for any final/hero cut — its prosody is the point; a flat robotic read is exactly the tell. `piper` is for drafts and for voices/languages Kokoro lacks (see the table below).
- **Lead / gap / tail (`film.json` `voice{lead,gap}` + `tail`).** Keep the inter-line `gap` natural, not a dead beat. Above all, **trim the `tail`** — its default is **3.0s** of trailing room after the last line, which lands as a dead tail (the §A5 fail and the thing `review-build-voice` checks). Set it to ~0.3–0.6s unless a beat genuinely needs the room; the piece ends on its last meaningful word.
- **The gaps get filled downstream.** True silence under the VO is what reads as AI; the ducked **music bed** (built in `build-soundtrack`) is what fills it. Produce a clean VO; don't try to fake liveliness with padding.
- **Spell product / brand names phonetically** in the script lines you synthesize so the engine pronounces them right (e.g. a respelling the TTS will say correctly) — a mangled product name is its own tell. Do not change the words themselves, only the pronunciation hint.

## The tools you own

Each engine is a local, keyless tool the worker can run. Know what each is for:

| Engine | Use it for | Notes |
|--------|-----------|-------|
| `kokoro` (default) | The final / hero render — highest naturalness and prosody. | Local, keyless. Heavier; narrower voice + language set today. Needs the Kokoro model under `$KOKORO_HOME`. |
| `piper` | Drafts and previews, tight time/resource budgets, or a language/voice Kokoro does not cover. | Local, keyless. Fast, lightweight, huge voice + language catalogue. Needs the `piper` binary + a `.onnx` voice (`$VOICE_MODEL`). |
| `openai-tts` | A brand that prefers / already pays for OpenAI voices (BYO-key). | API provider tool (`craft/video-production/tools/tts/openai-tts.py`). Needs `$OPENAI_API_KEY` at runtime (never baked). The film's `voice.id` must be an **OpenAI** voice (alloy, nova, …); a Kokoro id falls back to `alloy`. |
| `elevenlabs` | (future, not wired) premium / branded voices. | Keyed/paid — add as a provider tool here when it lands; until then do not promise it. |

**Picking:** final or hero cut → `kokoro` **only if its model is present** at `$KOKORO_HOME`; otherwise `piper`. Draft/preview, a resource/time crunch, or a language/voice Kokoro lacks → `piper`. A brand that wants a specific keyed service (and supplies the key) → that provider tool (e.g. `openai-tts`). **Fall back to whichever engine is actually available** — if the Kokoro model is missing, use `piper` (NOT the other way round); only if neither a Kokoro model nor the `piper` binary + its `$VOICE_MODEL` voice exists do you stop and report — never fabricate audio. (A worker provisioned with only `piper` — e.g. the engine container — uses `piper`.) Provider tools (`openai-tts`, …) are the voice seam: adding one is a tool + a registry entry in `vo.py`, never engine code.

## When the narration is a real clip, not TTS (align.py)

Sometimes the voice is **not** synthesized — a human recorded the take, or it rides an avatar / cinematic render (HeyGen / Higgsfield), a screen recording, or a selfie clip. Then you don't synthesize; you **word-time the existing clip** onto the same timeline so build / mix / render / captions read it unchanged:

```
"$KOKORO_PY" craft/video-production/tools/align.py --in <clip.mp4|audio.wav> --script <workDir>/script.txt --out <workDir>/media
```

`align.py` writes `media/words.json` (the same `{duration, words:[{text,start,end,line}]}` contract) by running whisper over the clip and — with `--script` — forcing the timing onto the verbatim script words (keeps proper nouns). It does **not** write `vo.wav`: the clip owns its audio. In the full chain, `make-film.sh` takes this path automatically when `film.json` sets `"audio": "<clip>"` (it also extracts the clip's audio to `media/vo.wav` so mix/render work unchanged); drive it by hand with `make-film.sh <workDir> --audio-clip <clip>`.

## Inputs

A **work dir** that already holds `script.txt` (one VO line per line) and `film.json` (its `voice` block sets `id`, `speed`, `lead`, `gap`). Run under the Kokoro venv python (it carries `soundfile` + `numpy` + `whisper`, which the timing step needs for every engine; `piper` is a separate binary).

## Steps

1. Choose the engine per the table above for what this render needs.
2. Produce the narration + word timing:
   ```
   "$KOKORO_PY" craft/video-production/tools/vo.py --script <workDir>/script.txt --film <workDir>/film.json --out <workDir>/media --engine <kokoro|piper>
   ```
3. Confirm `<workDir>/media/vo.wav` and `<workDir>/media/words.json` exist and are non-empty.

## Output contract

`<workDir>/media/vo.wav` (48 kHz mono composition clock) and `<workDir>/media/words.json` (`{"duration": s, "words": [{text, start, end, line}]}`). The build / mix / render steps read these — the contract is identical whatever engine you picked.

## How the assembly reaches you

The render step (`render-film`) either runs the whole chain with your choice — `make-film.sh <workDir> --voice-engine <engine>` — or, when you produced the VO here first, runs `make-film.sh <workDir> --skip-voice` so the chain reuses your `media/vo.wav` + `media/words.json`.

## If a step fails

- Missing `kokoro` model (`$KOKORO_HOME`) or `piper` model (`$VOICE_MODEL`) → `vo.py` exits with that reason. Switch engine or report; do not substitute silent/fake audio.
- `whisper` / `ffmpeg` must be on PATH for timing + laydown (both engines).
