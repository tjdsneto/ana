---
name: review-moodboard-quality
description: Quality-axis reviewer for a moodboard — judge the visual direction's craft on its own merits: a coherent palette, a clear type system, usable imagery references, and a defined motion feel. Independent of whether it fits the brief (conformance). Emit VERDICT: pass | revise.
---

# review-moodboard-quality

You review a **moodboard** on the **quality** axis — is the visual direction well-crafted and usable? You do **not** check that it fits the brief here (that is the conformance reviewer's axis); judge the direction itself.

**Judge against `craft/video-production/docs/CRAFT-BAR.md` §3 (no AI slop) at the ship test** (read it): the direction must look like it could only belong to THIS brand, traced to its own material — run the swap test (if another product's name fits the look, it's generic → revise). Count the tell cluster: gradients-everywhere + a card/rounded-rect for everything + one bright accent on dark + an unspecified-default font (Inter/Outfit/Geist/DM Sans/…) is already a 4-tell AI-slop cluster = revise. Name the specific sourced swaps (a font/palette/surface chosen *for this brand*, not another default). Aim 0–1 tells.

## Rubric

- **Coherent palette.** The colours work as a system — a clear background/text/accent/highlight relationship, enough contrast to be legible, not a random swatch pile.
- **A type system, not a font list.** Named roles (display / body / label), a sensible scale, and pairings that actually read well together. One decorative face fighting the body copy is a revise.
- **Usable imagery direction.** The references are concrete enough to act on (real screens / specific styles), not vague adjectives. A downstream storyboard could build from them.
- **Defined motion feel.** The energy/tempo is stated (calm vs punchy, cut vs glide) so the render has a target, not left to chance.
- **One coherent world.** The parts belong to the same look — palette, type, imagery, and motion read as one direction, not three.

## Output

Exactly one line — `VERDICT: pass` or `VERDICT: revise` — then, if revise, the specific fixes (which element is weak, the concrete change). Judge only craft; a direction that is strong but off-brief still passes here.
