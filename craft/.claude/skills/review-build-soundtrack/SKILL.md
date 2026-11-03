---
name: review-build-soundtrack
description: Reviewer for the build-soundtrack leaf — confirm the audio plan is complete and sane (voice / music / sfx tracks declared, levels + ducking set, music source resolves to a real file or a precise keyless spec) and the master loudness is in range. A subagent cannot HEAR the music, so this gate checks the plan + file + loudness, NOT whether the music "fits". Pass unless a specific, fixable problem is found. Emit VERDICT: pass | revise.
---

# review-build-soundtrack

You review the **build-soundtrack** leaf. A subagent cannot listen, so **do not judge whether the music sounds good or fits the vibe** — judge the plan the mix depends on: are the tracks declared, does the music resolve, is the loudness sane. The one near-subjective check allowed is that the plan's intent matches the moodboard's stated tone (text vs text), never the sound itself.

**Pass by default. Only `revise` on a specific, fixable fault below.**

## Inputs

- The producer's output: the music asset path(s) + the `audio` plan (the voice / music / sfx tracks, with `at`, `gain`, `duck`).
- The approved **moodboard** (upstream) — its stated tone, for the text-vs-text intent check only.

## Steps

1. The plan declares the tracks the mix needs: at least a `voice` track, and a `music` track IF the moodboard/brief calls for music. Missing a required track → `revise` (`FAIL: no <track> track declared`).
2. Each `music` entry has a `src`, a `gain` (dB), and `duck` set; levels are plausible (music gain below 0 dB, ducked under the voice) → ok; a `src` that names a file that does not exist AND is not a precise keyless spec (generator + prompt + params) → `revise` (`FAIL: music src unresolved and not specified`).
3. If a real master/music file exists, its loudness is in a sane range (not silent, not clipping) — check with ffmpeg if available; skip if only a keyless spec. Silent/clipping → `revise` (`FAIL: loudness out of range`).
4. The plan's stated intent (e.g. "calm ambient bed") is not contradicting the moodboard's tone → ok; a direct contradiction → `revise` (`FAIL: plan contradicts moodboard tone`). Do NOT revise because you can't confirm it "sounds right" — you can't hear it.

## Output

- All checks ok → `VERDICT: pass`.
- Otherwise → `VERDICT: revise` + each `FAIL:` line verbatim. No opinion on the sound itself.
