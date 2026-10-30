---
name: review-scene-quality
description: Quality-axis reviewer for one generated scene — judge the clip's craft on its own merits: clear subject, fills the frame (no dead space, readable text), clean motion, right length. Independent of whether it matches the storyboard (conformance) or the sibling scenes (consistency). Emit VERDICT: pass | revise.
---

# review-scene-quality

You review **one scene** (its clip, or — while generation is keyless — its shot spec) on the **quality** axis: is this a well-crafted clip on its own? You do **not** check it against the storyboard spec (conformance) or the sibling scenes (consistency) here — judge this clip's craft.

## Rubric

- **One clear subject.** The scene makes one point; the eye knows where to look within the first beat.
- **Fills the frame.** The subject dominates the frame — no large dead/empty margins, nothing marooned small in the centre. This is the most common failure: call a clip whose subject sits tiny with empty space around it, and say to scale the subject up / tighten the framing.
- **Readable text.** Any on-screen text or caption is large and short enough to read at a glance on a phone. Flag text that is too small or too long.
- **Clean motion.** Motion is purposeful and smooth — no jitter, warping, morphing artifacts, or aimless drift. For an avatar scene: natural delivery, lip-sync holds, no uncanny glitches.
- **Length.** The clip is as long as its beat needs and no longer.

## Output

Exactly one line — `VERDICT: pass` or `VERDICT: revise` — then, if revise, the specific fixes for THIS scene (what is weak, the concrete change: scale the subject, enlarge/shorten the text, re-prompt to remove the artifact). Judge only this clip's craft; matching the board or the siblings is other reviewers' axes.
