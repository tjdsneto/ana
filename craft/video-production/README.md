# Craft — the video specialization

The craft layer is the video-specific half of the repo: the skills, reviewer rubrics, and **tools** that actually produce a video. The generic autonomy loop in `engine/` knows nothing about video — it dispatches typed nodes and spawns `claude -p` subagents. Those subagents run **worker skills**, and the skills call the tools below. The engine never calls a craft tool directly; a skill always sits in between (see `../../CLAUDE.md` → "Testing seam": render/voice are worker skills, not engine ports).

Two standards govern the output, not the code, and the skills **cite them directly** — so they live in `.claude/references/` (next to the skills that depend on them, not in the human `docs/`): `.claude/references/CRAFT-BAR.md` (the quality bar every video is held to — §A universal taste + §B per-type structure profiles) and `.claude/references/COMPOSED-CARDS.md` (how to build a premium board on the composed path). `docs/` holds the human-facing video-production reference (glossary, launch-video anatomy, showing-a-web-app).

## How the tools run

There is no single runtime — the tools split by language and by where their dependencies live:

- **Host Python tools** (voice, music, SFX, captions, transcription) need local venvs (Kokoro, MusicGen, faster-whisper) plus `ffmpeg`. The `studio` launcher at the repo root (`../../studio`) is the one entrypoint for these — it resolves the right venv, loads BYO keys from `.engine_env`, and opens the result. Run `./studio` from the repo root with no args to see its verbs.
- **Node tools** (`*.mjs`) need Node + `ffmpeg`, both baked into the engine image (Python is **not** baked — that is why the footage-editing tools are `.mjs`). On a dev box run them through `../../x` (the Docker toolbox) or a host Node 24.
- **Provider adapters** (the `image/`, `tts/`, `music/`, `stock/` subdirs) are **BYO-key** and sit behind a seam — a routing tool (`image.py`, `vo.py`, `music.py`) picks and shells them per request. The key is resolved at call time (`--api-key-file` > `--api-key` > env var), never baked, never logged.

## Drivers — run a whole chain

| Tool | What it does |
|------|--------------|
| `make-film.sh` | The end-to-end driver: capture → vo → build → mix → render over one film dir, instead of the five tools by hand. Needs `film.json` + `script.txt` already in the dir. |
| `assemble.mjs` | The final render of the fan-out pipeline: concatenate the approved per-scene clips (`scenes/*.mp4`, or the order in `timeline.json`) into one master film and mux the master audio over the top. |
| `append-clip.sh` | Concatenate a tail clip onto a finished film seamlessly (both sides renormalized to 1920×1080 / fps / 48k so the join is clean) — e.g. an explainer that ends by playing the very video it described. |

## Storyboard & visual render (the composed/GSAP lane)

| Tool | What it does |
|------|--------------|
| `site-capture.mjs` | Capture each plate — a saved HTML file **or** a live URL — to a high-res JPG plus its mark rects (`shots.json`). The real-screens input for the board and the build. |
| `storyboard-board.py` | Turn `film.json` + `shots.json` + the plate JPGs into a **reviewable** shot-card board (`board.html` + per-beat crops + a montage sheet): each card is the exact region the render will frame, paired with its VO line — so a picture that doesn't match its line is caught before render. |
| `build.py` | Compile `film.json` + word timings + `shots.json` into `index.html`: a seekable, paused GSAP composition the renderer samples frame by frame. Also writes `sfx-cues.json` for the mix. |
| `render.mjs` | Seek the built composition frame by frame in headless Chrome, screenshot each, then `ffmpeg`-encode and mux the voiceover, mastered to −14 LUFS. Deterministic per frame. |
| `verify-render.py` | Deterministic post-render check an LLM reviewer can't do reliably: confirms the spoken VO matches the script, no line dropped or spoken twice, no dead air, and `mp4`/`vo` durations agree. Exit 0 `pass` / exit 1 `revise`. |

## Voice, captions & alignment

| Tool | What it does |
|------|--------------|
| `vo.py` | Voiceover **and** the word timing that anchors every cut, click and caption. Local engines `kokoro` (default) / `piper`, or an API engine via the seam. Owns laydown + timing regardless of engine. |
| `align.py` | Word-time an **externally** produced clip (an avatar/cinematic render, a screen recording, a selfie take) onto the same `words.json` schema `vo.py` emits — so a non-engine clip drops onto the same word-anchored timeline. |
| `transcribe.py` | Speech → a word-timed transcript (`faster-whisper`, local) for the edit-footage leaf: pick cut points by what is **said**, not just by time. |
| `captions.py` | Burn word-timed captions onto a video (karaoke or block) and write an `.srt` sidecar. Default-on because web/social autoplay muted. |

## Audio — music, SFX, mixing

| Tool | What it does |
|------|--------------|
| `music.py` | Resolve a film's `music` request to **one** audio file for the mix. Four sources by request string: a path (BYO), `library:<mood>`, `stock:<mood>` (the only auto-fetch path, licence recorded), `generate:<prompt>`. |
| `mix.py` | The final soundtrack: voiceover + synthesized UI SFX (+ optional music, ducked under the voice), mastered to −14 LUFS. Reads the VO, the SFX cues, and the word durations. |
| `sfx.py` | Produce one UI sound as a wav standalone (`click · tick · pop · hit · whoosh · swish`). Local, keyless, no samples/licences. |
| `sfxgen.py` | Not a CLI — the single source of the SFX palette (formulas), shared by `mix.py` (in-film cues) and `sfx.py` (standalone) so both make the identical sound. |
| `compose.py` | Glue (`ffmpeg` only): put audio **under** a video (replace or mix), or loop a **still** image for an audio's length into an mp4. |

## Footage editing (the clip leaf)

| Tool | What it does |
|------|--------------|
| `edl-apply.mjs` | Apply an Edit Decision List — the cut plan Claude writes after inspecting a provided asset — to that asset with `ffmpeg`: ordered keep-ranges, optional crop. The editor-mode analogue of the storyboard. |
| `punch.mjs` | A ken-burns punch-in (animated zoom toward a point) on a clip, via `ffmpeg` zoompan — to emphasize a moment after the cut. |

## Images

| Tool | What it does |
|------|--------------|
| `image.py` | Resolve an image request to one or more still files for the asset / moodboard lane: a path (BYO), `library:<query>`, or `generate:<prompt>` (a bare string is a prompt here). Owns the variation loop + provenance; picks the provider. |
| `image/openai-image.py` | Provider adapter behind `image.py --provider openai` — one prompt in, one image out (OpenAI Images, `gpt-image-1`). BYO-key, stdlib only. |
| `image/gemini-image.py` | Provider adapter behind `image.py --provider gemini` — same contract (`gemini-2.5-flash-image`). BYO-key, stdlib only. |

## Motion graphics

| Tool | What it does |
|------|--------------|
| `motion-graphics/index.mjs` | A swappable HTML → video backend for programmatic motion graphics / animated captions / overlays. An HTML composition in, an `.mp4` out; backend chosen by `$MOTION_GFX_BACKEND` (default `hyperframes`). |
| `motion-graphics/hyperframes.mjs` | The default backend: render the composition via `npx hyperframes render` (HeyGen HyperFrames, OSS, HTML-native + GSAP). |
| `motion-graphics/remotion.mjs` | The alternative backend: render the **same** HTML composition inside a bundled Remotion project (per-frame GSAP seek). |

## Provider adapters (BYO-key, behind a seam)

These are never called directly by a producer — a routing tool shells them per request. All resolve the key at call time and error clearly when it's missing.

| Tool | Seam | What it does |
|------|------|--------------|
| `tts/openai-tts.py` | `vo.py --engine openai-tts` | Synthesize one narration clip via the OpenAI TTS API. |
| `tts/elevenlabs.py` | `vo.py --engine elevenlabs` | Synthesize one narration clip via the ElevenLabs TTS API. |
| `music/musicgen.py` | `music.py` `generate:` | Generate a bed **locally** (Meta MusicGen, no key) under its own venv. |
| `music/stable-audio.py` | `music.py` `generate:` | Generate a bed via the Stability AI API (keyed, higher quality) — the alternative to local MusicGen. |
| `stock/freesound.py` | `music.py` `stock:` | Fetch one licence-clean track from Freesound (CC0 by default) and record its licence — the only auto-fetch lane. |

## Assets

`assets/` holds the local, license-safe material the tools pick from — currently `assets/music/` (seeded by you or the brand; ships empty, never auto-downloaded). See `assets/music/README.md` for the manifest shape and how a film asks for music.
