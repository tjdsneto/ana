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
- `"generate:warm uplifting corporate"` — generate a bed via the `$MUSIC_GEN_CMD` seam (intended generator: ACE-Step, free + local). Not wired by default.

`mix.py` then fades the chosen track to the film length, ducks it under the voice, and masters to −14 LUFS. Free sources to seed from: Mixkit, Pixabay Music, the YouTube Audio Library.
