---
name: build-soundtrack
description: Produce the music track and declare the audio tracks (voice / music / sfx) the mix will sum for a video. Runs once per video, alongside the voice and asset builds. Owns music selection + the audio plan; it does not synthesize the voiceover (build-voice owns that) and does not render any scene.
---

# build-soundtrack

> ## Hold to the craft bar
> Read `craft/video-production/.claude/references/CRAFT-BAR.md` (§A universal taste — especially §A5 Sound — + the matching §B profile). The soundtrack is judged against it.

You produce the **music** and declare the **audio tracks** for the whole video. The mix step (`mix.py`) sums the separate voice / music / sfx tracks you declare; it does not choose music or decide levels — that is this step's job (the way `voice-production` owns TTS).

## The craft bar for sound (§A5)

Bare voiceover over silence is a fail. Sound is never zero — the floor:

- **A low music bed under the voice** — ducked so it supports and never competes. VO over true silence with flat dynamics is an immediate AI tell; a supporting bed is the minimum, not an option. This floor is universal — every production-quality video carries sound (at least a clean VO or a bed).
- **SFX scaled to the concept, not a fixed quota.** A sound-forward idea earns rich per-beat SFX (the cuts, reveals, the hero number landing, the CTA); a spare or kinetic piece may carry only a few deliberate hits on the beats that matter. Judge the weight against the concept — a flat VO + bed with no cue on *any* signature beat reads as under-produced, but a fixed SFX quota forced onto a quiet piece is wrong too. Never zero sound overall.
- **No dead tail.** The soundtrack ends on the last meaningful beat. Do not leave several seconds of bed (or silence) running under a frozen end card — trim the music stop to the last beat.

Wire these with the tools (do not hand-fake audio):

- **Music bed** → `music.py`. Its request field takes a `PATH` (bring-your-own file), `library:<mood>` (local library), `stock:<mood>` (a licence-clean fetch, CC0 via freesound), or `generate:<prompt>` (the `$MUSIC_GEN_CMD` seam). Declare it as the `music` track, ducked under the voice.
- **SFX** → the palette in `sfxgen.py`, surfaced standalone by `sfx.py`: **click · tick · pop · hit · whoosh · swish**. `mix.py` auto-derives some cues from the timeline; add explicit `sfx` entries for the key beats the timeline would miss so every signature beat is scored.

## Inputs

- The approved **storyboard** + **moodboard** — the tone, pacing, and any `audio` the storyboard already sketches.
- The **voiceover** timing (`words.json`) if available — to place music starts/stops against the narration.

## What to produce

- **Music.** Choose/produce a music bed that fits the tone (free/licence-clear sources; a produced or provided file). Write it into the work dir.
- **The audio plan.** Declare the separate tracks in the **film.json `audio` block** so `build.py` resolves them into `src/audio-plan.json` and `mix.py` sums them. (For the board/kinetic render, `assemble-board` composes that block from the storyboard's sound plan — your job here is the `music` track's file + levels; for a per-scene authored film, the per-scene `film.json`.) The tracks:
  - `voice` — the narration track(s) (from `build-voice`).
  - `music` — the bed(s): `src`, `at` (word or seconds), `gain` (dB), `duck` (under the voice), optional `start` offset. Stop it at the last beat — do not let it run under a dead end card.
  - `sfx` — explicit cue sounds on the key beats (from the `click · tick · pop · hit · whoosh · swish` palette), beyond the ones `build.py`/`mix.py` derive from the timeline. These are expected on the signature beats, not "if any".
- Keep levels sane: music sits under the voice (duck true); `mix.py` masters the whole mix to **−14 LUFS** (its `--lufs` default). No dead tail — the soundtrack ends on the last meaningful beat.

## Output

The music asset path(s) + the `audio` plan you declared. Do not synthesize the voiceover (that is `build-voice`) and do not render a scene.

> **Status.** Music selection + the audio plan work with free/local sources today; `mix.py` consumes the plan (separate tracks, ducked, summed). A paid music/generation backend is keyless until provisioned — specify it rather than fabricating a file.
