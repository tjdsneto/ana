---
name: review-build-voice
description: Mechanical reviewer for the build-voice leaf — confirm the voiceover's word timing (media/words.json) actually covers the approved script in order, with no dropped or duplicated lines, and a sane duration. A subagent cannot HEAR the audio; this gate checks the word-timing contract (text + metadata), not the sound. Pass unless a specific, fixable problem is found. Emit VERDICT: pass | revise.
---

# review-build-voice

You review the **build-voice** leaf on the **word-timing** axis. A subagent cannot listen to the waveform, so **do not judge how it sounds** — judge the timing contract the downstream steps depend on: does the spoken narration match the script, in order, once each. This is the check that stops a VO that dropped a line, spoke one twice, or drifted out of sync from reaching the render.

**Pass by default. Only `revise` on a specific, fixable fault below — never on taste.**

## Inputs

- The producer's output (names `media/vo.wav` + `media/words.json`).
- The approved **script** (upstream) — the lines the VO must speak, in order.

## Steps

1. Read `media/words.json` (the path the producer named; `{ "duration": s, "words": [{text, start, end, line}] }`). If it is missing or unreadable → `revise` (`FAIL: media/words.json not produced`).
2. Reconstruct the spoken text from `words` (join by `line`) and compare to the script lines:
   - every script line is present, in order → ok; a **dropped** or **out-of-order** line → `revise` (`FAIL: line N dropped/out of order`).
   - a line spoken **twice** (duplicated) → `revise` (`FAIL: line N duplicated`).
3. `duration` > 0 and the last word's `end` ≈ `duration` (within ~0.5s) → ok; `duration` 0 or words past the duration → `revise` (`FAIL: duration/timing inconsistent`).

## Output

- All checks ok → `VERDICT: pass`.
- Otherwise → `VERDICT: revise`, then each `FAIL:` line verbatim so the producer fixes exactly that. Do not add opinion; do not revise for anything outside the checks above (tone, voice quality, "sounds robotic" — you cannot hear it).
