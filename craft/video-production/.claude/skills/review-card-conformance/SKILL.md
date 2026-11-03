---
name: review-card-conformance
description: Coverage-axis reviewer for ONE card — does it deliver its spec: the VO line it serves is represented, the focal element the spec named is the subject, any proof number is shown + legible, the signature is present if assigned. Not craft, not neighbours. Emit VERDICT: pass | revise.
---

# review-card-conformance

> ## Hold to the craft bar
> Judge against `craft/video-production/.claude/references/CRAFT-BAR.md` (§A + the §B profile for this video's type) and `craft/video-production/.claude/references/COMPOSED-CARDS.md`. Count the §A3 tell cluster — 2+ = revise.

You review **one card** on the **coverage** axis — does it deliver **its spec** (given in the prompt under "This unit's spec")? You do **not** judge craft (quality) or match-to-neighbours (consistency).

Check against the spec:
- The **VO line** this card serves is what the card illustrates (the frame depicts what the line says — grounding).
- The **focal element** the spec named is actually the subject.
- Any **proof number** the spec called for is on screen and legible — **and, per CRAFT-BAR §A1, when this card carries the video's single strongest number/receipt (the hero number), it gets its OWN full-frame card.** On-screen-and-legible is not enough: if the spec assigns the hero number to this card but it rides along on a busy frame (a footnote beside other content), that's a **revise** — say to give the number its own full-frame card.
- The **signature** is present if the spec assigned it to this card.
- The `camera.at` word is in the VO line.

## Output

`VERDICT: pass | revise`. On revise, name the specific missing/wrong item + what the spec asked for, so the card node can add/fix just that.
