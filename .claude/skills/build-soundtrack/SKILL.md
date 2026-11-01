---
name: build-soundtrack
description: Produce the music track and declare the audio tracks (voice / music / sfx) the mix will sum for a video. Runs once per video, alongside the voice and asset builds. Owns music selection + the audio plan; it does not synthesize the voiceover (build-voice owns that) and does not render any scene.
---

# build-soundtrack

You produce the **music** and declare the **audio tracks** for the whole video. The mix step (`mix.py`) sums the separate voice / music / sfx tracks you declare; it does not choose music or decide levels — that is this step's job (the way `voice-production` owns TTS).

## Inputs

- The approved **storyboard** + **moodboard** — the tone, pacing, and any `audio` the storyboard already sketches.
- The **voiceover** timing (`words.json`) if available — to place music starts/stops against the narration.

## What to produce

- **Music.** Choose/produce a music bed that fits the tone (free/licence-clear sources; a produced or provided file). Write it into the work dir.
- **The audio plan.** Declare the separate tracks in the storyboard's `audio` block so `build.py` resolves them into `src/audio-plan.json` and `mix.py` sums them:
  - `voice` — the narration track(s) (from `build-voice`).
  - `music` — the bed(s): `src`, `at` (word or seconds), `gain` (dB), `duck` (under the voice), optional `start` offset.
  - `sfx` — explicit cue sounds beyond the ones `build.py` derives from the timeline, if any.
- Keep levels sane: music sits under the voice (duck true), the mix masters to the target loudness in `mix.py`.

## Output

The music asset path(s) + the `audio` plan you declared. Do not synthesize the voiceover (that is `build-voice`) and do not render a scene.

> **Status.** Music selection + the audio plan work with free/local sources today; `mix.py` consumes the plan (separate tracks, ducked, summed). A paid music/generation backend is keyless until provisioned — specify it rather than fabricating a file.
