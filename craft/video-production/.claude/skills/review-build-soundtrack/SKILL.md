---
name: review-build-soundtrack
description: Reviewer for the build-soundtrack leaf — confirm the audio plan is complete and sane (voice / music / sfx tracks declared, levels + ducking set, music source resolves to a real file or a precise keyless spec) and the master loudness is in range. A subagent cannot HEAR the music, so this gate checks the plan + file + loudness, NOT whether the music "fits". Pass unless a specific, fixable problem is found. Emit VERDICT: pass | revise.
---

# review-build-soundtrack

> ## Judge against the craft bar
> Judge against `craft/video-production/docs/CRAFT-BAR.md` §A5 (Sound). You cannot HEAR the mix, but the plan + files let you check mechanically that §A5's structure is met: a ducked music bed present, deliberate SFX on the key beats (not bare VO + bed), no dead tail, and the master at −14 LUFS.

You review the **build-soundtrack** leaf. A subagent cannot listen, so **do not judge whether the music sounds good or fits the vibe** — judge the plan the mix depends on: are the tracks declared, does the music resolve, are there SFX on the key beats, is there no dead tail, is the loudness at target. The one near-subjective check allowed is that the plan's intent matches the moodboard's stated tone (text vs text), never the sound itself.

**Pass by default. Only `revise` on a specific, fixable fault below.**

## Inputs

- The producer's output: the music asset path(s) + the `audio` plan (the voice / music / sfx tracks, with `at`, `gain`, `duck`).
- The approved **moodboard** (upstream) — its stated tone, for the text-vs-text intent check only.

## Steps

1. The plan declares the tracks the mix needs: at least a `voice` track, and a `music` track IF the moodboard/brief calls for music. Missing a required track → `revise` (`FAIL: no <track> track declared`).
2. Each `music` entry has a `src`, a `gain` (dB), and `duck` set; levels are plausible (music gain below 0 dB, ducked under the voice) → ok; a `src` that names a file that does not exist AND is not a precise keyless spec (generator + prompt + params) → `revise` (`FAIL: music src unresolved and not specified`).
3. **SFX on the key beats (§A5).** The plan carries deliberate SFX (from `mix.py`'s timeline-derived cues and/or explicit `sfx` entries) on the signature beats — cuts, reveals, the hero number, the CTA. A soundtrack that is **bare VO + music bed with no SFX** on those beats → `revise` (`FAIL: no SFX on key beats (bare VO + bed)`).
4. **No dead tail (§A5).** The music/mix does not run on under a dead end card: the last `music` stop (its `start` + duration, or an explicit stop/`clear`) is at/near the last beat, and any master file's duration is not materially longer than the VO's last word. A long trailing bed/silence → `revise` (`FAIL: dead tail (music/mix runs Ns past the last beat)`).
5. **Master loudness at target.** If a real master/music file exists, its loudness is at the mix target of **−14 LUFS** (`mix.py`'s default), not silent and not clipping — check with ffmpeg if available (`loudnorm=print_format=json`); skip if only a keyless spec. Silent, clipping, or well off −14 LUFS → `revise` (`FAIL: loudness off target (−14 LUFS)`).
6. The plan's stated intent (e.g. "calm ambient bed") is not contradicting the moodboard's tone → ok; a direct contradiction → `revise` (`FAIL: plan contradicts moodboard tone`). Do NOT revise because you can't confirm it "sounds right" — you can't hear it.

## Output

- All checks ok → `VERDICT: pass`.
- Otherwise → `VERDICT: revise` + each `FAIL:` line verbatim. No opinion on the sound itself.
