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

**Picking:** final or hero cut → `kokoro`. Draft/preview, or a resource/time crunch, or a language/voice Kokoro lacks → `piper`. If the chosen engine is unavailable (model/binary missing), fall back to `kokoro`; if that is also unavailable, stop and report — never fabricate audio.

## When the narration is a real clip, not TTS (align.py)

Sometimes the voice is **not** synthesized — a human recorded the take, or it rides an avatar / cinematic render (HeyGen / Higgsfield), a screen recording, or a selfie clip. Then you don't synthesize; you **word-time the existing clip** onto the same timeline so build / mix / render / captions read it unchanged:

```
"$KOKORO_PY" craft/tools/align.py --in <clip.mp4|audio.wav> --script <workDir>/script.txt --out <workDir>/media
```

`align.py` writes `media/words.json` (the same `{duration, words:[{text,start,end,line}]}` contract) by running whisper over the clip and — with `--script` — forcing the timing onto the verbatim script words (keeps proper nouns). It does **not** write `vo.wav`: the clip owns its audio. In the full chain, `make-film.sh` takes this path automatically when `film.json` sets `"audio": "<clip>"` (it also extracts the clip's audio to `media/vo.wav` so mix/render work unchanged); drive it by hand with `make-film.sh <workDir> --audio-clip <clip>`.

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
