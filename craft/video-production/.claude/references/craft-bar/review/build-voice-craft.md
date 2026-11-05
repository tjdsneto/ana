# Review rubric — build-voice / craft (quality axis)

Loaded by the generic `review-craft` reviewer when judging a `build-voice` deliverable. The generic reviewer owns the ship-test framing, the VERDICT mechanics, and the §A3 tell-cluster count; this file is ONLY the build-voice-specific craft rubric.

You review the **build-voice** leaf on the **word-timing** axis, against §A5 (Sound). A subagent cannot listen to the waveform, so **do not judge how it sounds** — judge the timing contract the downstream steps depend on: does the spoken narration match the script, in order, once each, and does it not end on a dead tail. This is the check that stops a VO that dropped a line, spoke one twice, drifted out of sync, or trails off into dead silence from reaching the render. One §A5 item is mechanically checkable from the timing contract: a **dead tail** (trailing silence after the last word) — see step 4.

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

On revise, emit each `FAIL:` line verbatim so the producer fixes exactly that. Do not add opinion; do not revise for anything outside the checks above (tone, voice quality, "sounds robotic" — you cannot hear it).

Build on: `../a5-sound.md` (the sound bar this voice track is judged against). Reference rather than restate.
