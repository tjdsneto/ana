---
name: review-card-quality
description: Quality-axis reviewer for ONE composed card — judge its craft against craft/CRAFT-BAR.md: the focal element dominates WITHIN a safe area (no dead space AND no edge-to-edge overfill / wall of text), flat colour not gradients, the sourced non-default font actually renders, 0-1 AI-slop tells, readable type. Independent of the spec (conformance) and the neighbours (consistency). Emit VERDICT: pass | revise.
---

# review-card-quality

You review **one card** (its plate + camera) on the **quality** axis — is this a well-crafted card on its own? Read `craft/CRAFT-BAR.md` (§2 frame, §3 no slop).

**Render the plate — don't judge HTML by eye.** Write the card's `plate_html` to a temp `.html` and screenshot it (a one-plate `film.json` through `node craft/tools/site-capture.mjs`, or any headless screenshot), then look.

Check:
- **Safe area + breathing room — both failure directions are a revise.** Content must sit inside a safe-area margin (~8–10% all sides) and dominate WITHIN it. (a) **Dead space** — a big empty ring/band/gradient with the real content tiny in a corner → revise (scale the subject up / raise zoom). (b) **Overfill** — text/subject jammed edge to edge, a fixed-huge type wrapping to a wall of 4–5 lines touching the frame with no margin → revise (scale the type DOWN / shorten to the focal phrase so it fits the safe area with room to breathe). A cramped wall of text reads as amateur; it is a reject, not a pass.
- **On-screen text matches the intended treatment.** If the card should show a short focal phrase but dumps the whole VO sentence (or shows a bare phrase where the full line was meant to be read), that's a **revise** — name the intended treatment.
- **Flat** ground, not gradients; one accent at most.
- The **sourced non-default font actually renders** — if it fell back to Helvetica/Arial/Inter/a default, that's a tell → revise (fix the `@font-face`/shared font).
- Type readable; the §3 tell cluster at **0–1**.

## Output

`VERDICT: pass | revise`. On revise, name the **one** thing to change + the direction (the element to scale, the gradient to flatten, the font to fix) so the card node edits just that. Do not ask for a redesign.
