---
name: studio
description: Produce audio or assemble a quick clip with the craft tools — synthesize a UI sound effect, generate a voiceover from text, generate or fetch music (local MusicGen / Freesound CC0 stock / local library / bring-your-own), or APPLY a sound/track to a video or turn an image/asset into a clip. Use when the user says things like "make a whoosh", "generate voice saying X", "produce a soundtrack", "find a calm ambient track", "put this music under that video", or "make a clip from this image + audio". Runs the ./studio launcher (host venvs + ffmpeg; keys from repo/.engine_env).
---

# studio

Ad-hoc audio + asset production with the craft tools, driven by the **`./studio`** launcher at the repo root. It resolves the right venv per tool, auto-loads API keys from `repo/.engine_env` (Freesound, OpenAI, ElevenLabs — never printed), and defaults the music `generate:` seam to local MusicGen. **Run every command from the repo root.** A command given no `--out` writes to `/tmp` and opens it; pass `--out` for a specific path.

This is standalone/ad-hoc use of the same tools the film pipeline uses — not a separate implementation. `./studio` is **not** `./x` (that's the Docker node/npm toolbox).

## Capabilities

| Ask | Command | Notes |
|-----|---------|-------|
| Synthesize a UI sound | `./studio sfx <name> [--out F]` | names: `click tick pop hit whoosh swish` (`./studio sfx-list`). Local, instant, free. |
| Voiceover from text | `./studio voice "<text>" [--engine kokoro\|openai-tts\|elevenlabs\|piper] [--voice V] [--out F]` | default `kokoro` (local, free). `openai-tts`/`elevenlabs` need their key in `repo/.engine_env`; set `--voice` to a voice that engine knows. |
| Generate original music | `./studio music-gen "<prompt>" [--duration D] [--provider musicgen\|stable-audio] [--out F]` | default `musicgen` (local, free, modest quality, ~tens of sec–2 min/clip, keep ≤ ~30s). `stable-audio` = Stability AI API, higher quality, needs `$STABILITY_API_KEY`. |
| Music by request | `./studio music "<request>" [--duration D] [--provider musicgen\|stable-audio]` | request = `stock:<mood>` (Freesound CC0 fetch) · `library:<mood>` (local seeded) · `generate:<prompt>` (the chosen provider) · a file path (BYO). Prints the resolved path. |
| Put audio under a video | `./studio under <video> <audio> [--out F] [--mode replace\|mix]` | `replace` swaps the video's audio; `mix` blends. Trimmed to the shorter (`--pad` to hold the video to the audio length). |
| Image/asset → clip | `./studio still <image> <audio> [--out F]` | loops the still for the audio's length into an H.264/AAC mp4. |
| Play a file | `./studio play <file>` | opens in the default player (macOS). |

## How to apply results to video / images / assets

The point of `under` and `still` is to land a produced/fetched sound onto visuals:

- **Soundtrack a silent render:** `./studio under render.mp4 bed.wav --out render+music.mp4` (replace). For a bed *plus* the render's own SFX/VO, use `--mode mix`.
- **Make a clip from an image + a voice/music:** `./studio still art.png vo.wav --out art.mp4` — good for a title card, an asset reveal, or a quick audition of a bed over a key visual.
- **Layer a one-off SFX onto a cut:** generate it (`sfx`) and `under ... --mode mix`.

Chain them: generate/fetch the audio, then `still`/`under` to see+hear it on the visual.

## When the user asks

1. Pick the capability from the table; run it via `./studio` from the repo root.
2. If they named a vibe/length for music, pass `--duration`; for >~30s, generate in ≤30s chunks and (if needed) assemble.
3. Report the output path and offer to `play` it, or to apply it to a video/image with `under`/`still`.
4. Honor the license trail: `stock:` writes the track's licence into the library manifest — keep that intact; default is CC0 (commercial-safe).

## Notes & limits

- **Keys** load from `repo/.engine_env` automatically (`FREESOUND_API_KEY`, `OPENAI_API_KEY`, `ELEVENLABS_API_KEY`). A missing key → the provider errors clearly; local tools (sfx, kokoro voice, MusicGen) need no key.
- **Venvs:** `sfx`/`voice` use the Kokoro venv; `music-gen` uses the MusicGen venv (`~/.local/share/musicgen/venv`); `music`/`under`/`still` use system `python3` + ffmpeg. The launcher picks these; override with `KOKORO_PY` / `MUSICGEN_PY`.
- **Generate providers:** `musicgen` (local, free, small-model — fine for a bed) is the default; `stable-audio` (`--provider stable-audio`, needs `$STABILITY_API_KEY`) is the higher-quality keyed path. Suno is partner-gated (not wired).
- Underlying tools: `craft/video-production/tools/{sfx.py, vo.py, music.py, music/musicgen.py, music/stable-audio.py, stock/freesound.py, compose.py}` and the `tts/` provider adapters — each runnable directly if needed.
