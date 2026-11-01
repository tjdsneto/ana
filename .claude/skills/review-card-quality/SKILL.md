---
name: review-card-quality
description: Quality-axis reviewer for ONE composed card — judge its craft against craft/CRAFT-BAR.md: the focal element dominates the frame (no dead space), flat colour not gradients, the sourced non-default font actually renders, 0-1 AI-slop tells, readable type. Independent of the spec (conformance) and the neighbours (consistency). Emit VERDICT: pass | revise.
---

# review-card-quality

You review **one card** (its plate + camera) on the **quality** axis — is this a well-crafted card on its own? Read `craft/CRAFT-BAR.md` (§2 frame, §3 no slop).

**Render the plate — don't judge HTML by eye.** Write the card's `plate_html` to a temp `.html` and screenshot it (a one-plate `film.json` through `node craft/tools/site-capture.mjs`, or any headless screenshot), then look.

Check:
- The **focal element fills ≥ ~50%** of the frame — a big empty ring/band/gradient with the real content tiny in a corner is a **revise** (name it, say to scale the subject up / raise zoom).
- **Flat** ground, not gradients; one accent at most.
- The **sourced non-default font actually renders** — if it fell back to Helvetica/Arial/Inter/a default, that's a tell → revise (fix the `@font-face`/shared font).
- Type readable; the §3 tell cluster at **0–1**.

## Output

`VERDICT: pass | revise`. On revise, name the **one** thing to change + the direction (the element to scale, the gradient to flatten, the font to fix) so the card node edits just that. Do not ask for a redesign.
