# Music library

Local, license-safe music beds for `music.py` to pick from (see `craft/tools/music.py`). This library ships **empty on purpose** — the tooling never downloads audio; you or the brand add tracks you have the right to use (CC0 / royalty-free / licensed), so licensing stays explicit and auditable.

## Add a track

1. Drop the audio file in this directory (any format ffmpeg reads: `.mp3`, `.wav`, `.m4a`, …).
2. Add one entry to `manifest.json`:

```json
[
  { "file": "calm-aurora.mp3", "mood": "calm ambient", "duration": 92, "license": "CC0 — Pixabay, <url>" }
]
```

Fields: `file` (relative to this dir, or an absolute path), `mood` (free text; the picker matches a requested mood as a case-insensitive substring), `duration` (seconds — the picker prefers the shortest track that still covers the film), `license` (keep the source + licence link for the record).

## How a film asks for music

Set the `music` field in `film.json` (or pass `music.py --request`):

- `"library:energetic"` or just `"energetic"` — pick a library track whose `mood` contains that word.
- `"assets/beds/mytrack.mp3"` — bring your own file (any audio path); used as-is.
- `"stock:calm ambient"` — fetch a licence-clean track via a stock provider tool (default: `freesound`, CC0) into this library and record its licence in the manifest, then use it. Needs `$FREESOUND_API_KEY` (BYO-key). This is the only auto-fetch path, allowed because the source returns a known per-item licence (see `tmp/audio-provider-seam-design.md`).
- `"generate:warm uplifting corporate"` — generate a bed via the `$MUSIC_GEN_CMD` seam (local + free). A ready generator tool ships at `craft/tools/music/musicgen.py` (Meta MusicGen); see "Local generation" below.

## Local generation (MusicGen)

`craft/tools/music/musicgen.py` generates an original bed locally (no key, no account) with Meta MusicGen. It runs under its own venv (torch + transformers), separate from the Kokoro venv, at `~/.local/share/musicgen/venv`. First run downloads `facebook/musicgen-small` (~2GB), cached after. On a modest Mac expect CPU generation of roughly tens of seconds to a couple of minutes per short clip (a 5s clip took ~72s including the one-time model download; inference-only is faster).

Wire it into the `generate:` seam (one line; `{prompt}`/`{duration}`/`{out}` are music.py's placeholders — quote `{prompt}`/`{out}` for the shell):

```
export MUSIC_GEN_CMD="$HOME/.local/share/musicgen/venv/bin/python <repo>/craft/tools/music/musicgen.py --prompt \"{prompt}\" --duration {duration} --out \"{out}\""
```

Then `music.py --request "generate:<prompt>"` (or a film's `music: "generate:<prompt>"`) produces the bed. Run `musicgen.py` directly for a one-off clip; `--device mps` tries Apple-GPU (falls back to cpu if unsupported).

**Keyed alternative — Stable Audio.** `craft/tools/music/stable-audio.py` generates via the Stability AI API (higher quality than musicgen-small). Needs `$STABILITY_API_KEY` (the platform.stability.ai developer key). Point the seam at it the same way, or via the launcher: `./studio music-gen "<prompt>" --provider stable-audio` / `./studio music "generate:<prompt>" --provider stable-audio`. Default provider stays local MusicGen.

`mix.py` then fades the chosen track to the film length, ducks it under the voice, and masters to −14 LUFS. Free sources to seed from: Mixkit, Pixabay Music, the YouTube Audio Library.
