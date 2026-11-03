---
name: review-scene-quality
description: Quality-axis reviewer for one generated scene — judge the clip's craft on its own merits: clear subject, fills the frame (no dead space, readable text), clean motion, right length. Independent of whether it matches the storyboard (conformance) or the sibling scenes (consistency). Emit VERDICT: pass | revise.
---

# review-scene-quality

You review **one scene** (its clip, or — while generation is keyless — its shot spec) on the **quality** axis: is this a well-crafted clip on its own? You do **not** check it against the storyboard spec (conformance) or the sibling scenes (consistency) here — judge this clip's craft.

Judge against `craft/video-production/docs/CRAFT-BAR.md` (§A universal taste + the §B profile for the video's type); for composed scenes also `craft/video-production/docs/COMPOSED-CARDS.md`. **Count the §A3 tell cluster — 2+ = revise.**

## Rubric

- **One clear subject.** The scene makes one point; the eye knows where to look within the first beat.
- **One dominant subject, filling ≥ ~50% of the frame (§A1).** The thing the VO names at that moment is the clear, readable anchor; everything else is subordinate and smaller — **clear focal hierarchy**, one hero element, the rest recede (a tiny caption is not enough to carry it). The most common failure is a subject marooned small with dead/empty margins around it — call it and say to scale the subject up / tighten the framing.
- **Readable text.** Any on-screen text or caption is large and short enough to read at a glance on a phone. Flag text that is too small or too long.
- **No AI slop — count the §A3 tell cluster (§A3).** Count the tells explicitly: gradients everywhere, a card/rounded-rect for everything, one bright accent on a dark/near-black ground, hairline rules, emoji as headings, an unspecified-default font (Inter/Roboto/Montserrat/Outfit/… — a tier-2 default is just as much a tell). **0–1 reads as deliberate; 2+ → revise**, naming the sourced swap (swapping one default for another does not fix it). Run the swap test — put a different product's name on the look; if it still fits, it's generic → revise. A clip can be technically clean and still be slop.
- **Clean motion.** Motion is purposeful and smooth — no jitter, warping, morphing artifacts, or aimless drift. For an avatar scene: natural delivery, lip-sync holds, no uncanny glitches.
- **Length.** The clip is as long as its beat needs and no longer.

## Output

Exactly one line — `VERDICT: pass` or `VERDICT: revise` — then, if revise, the specific fixes for THIS scene (what is weak, the concrete change: scale the subject, enlarge/shorten the text, re-prompt to remove the artifact). Judge only this clip's craft; matching the board or the siblings is other reviewers' axes.
