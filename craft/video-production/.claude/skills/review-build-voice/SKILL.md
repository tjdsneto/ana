---
name: review-build-voice
description: Mechanical reviewer for the build-voice leaf — confirm the voiceover's word timing (media/words.json) actually covers the approved script in order, with no dropped or duplicated lines, and a sane duration. A subagent cannot HEAR the audio; this gate checks the word-timing contract (text + metadata), not the sound. Pass unless a specific, fixable problem is found. Emit VERDICT: pass | revise.
---

# review-build-voice

> ## Judge against the craft bar
> Judge against `craft/video-production/docs/CRAFT-BAR.md` §A5 (Sound). You cannot HEAR the audio, but one §A5 item is mechanically checkable from the timing contract: a **dead tail** (trailing silence after the last word) — see step 4.

You review the **build-voice** leaf on the **word-timing** axis. A subagent cannot listen to the waveform, so **do not judge how it sounds** — judge the timing contract the downstream steps depend on: does the spoken narration match the script, in order, once each, and does it not end on a dead tail. This is the check that stops a VO that dropped a line, spoke one twice, drifted out of sync, or trails off into dead silence from reaching the render.

**Pass by default. Only `revise` on a specific, fixable fault below — never on taste.**

## Inputs

- The producer's output (names `media/vo.wav` + `media/words.json`).
- The approved **script** (upstream) — the lines the VO must speak, in order.

## Steps

1. Read `media/words.json` (the path the producer named; `{ "duration": s, "words": [{text, start, end, line}] }`). If it is missing or unreadable → `revise` (`FAIL: media/words.json not produced`).
2. Reconstruct the spoken text from `words` (join by `line`) and compare to the script lines:
   - every script line is present, in order → ok; a **dropped** or **out-of-order** line → `revise` (`FAIL: line N dropped/out of order`).
   - a line spoken **twice** (duplicated) → `revise` (`FAIL: line N duplicated`).
3. `duration` > 0 and no word runs past `duration` → ok; `duration` 0 or words past the duration → `revise` (`FAIL: duration/timing inconsistent`).
4. **No dead tail (§A5, mechanically checkable).** Compute the trailing silence: `duration − (last word's end)`. A large trailing gap is the VO ending in dead silence (usually an un-trimmed `tail`, default 3.0s) → `revise` (`FAIL: dead tail — Ns of silence after the last word (trim voice tail)`). Treat **> ~1.0s** as a dead tail; a ~0.3–0.6s tail is fine.

## Output

- All checks ok → `VERDICT: pass`.
- Otherwise → `VERDICT: revise`, then each `FAIL:` line verbatim so the producer fixes exactly that. Do not add opinion; do not revise for anything outside the checks above (tone, voice quality, "sounds robotic" — you cannot hear it).
