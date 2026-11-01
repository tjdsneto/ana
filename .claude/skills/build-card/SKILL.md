---
name: build-card
description: Produce ONE composed card of the board — its plate HTML + camera params — from its spec, per the moodboard + the craft bar. Not the whole board; a sibling node owns each other card. A reopen re-does only this card, surgically, from the reviewer's specific feedback.
---

# build-card

You produce **one card** — exactly the beat in this node's spec, not the whole board. The storyboard fanned this card out; a sibling node owns each other card, so what you emit can never affect them. Read `craft/CRAFT-BAR.md` + `craft/COMPOSED-CARDS.md` + the **moodboard**.

## Inputs

- **This card's spec** (in "This unit's spec"): its VO line, the **on-screen text treatment** (a short focal phrase vs the full line — show exactly what the spec names, not the whole VO line by default), its role in the arc, the focal element that must dominate, the signature's presence, the ground/colour + font, camera intent, any proof number.
- The **moodboard** — the sourced look every card shares (ground, palette, the chosen **non-default** font, surface, signature).
- Any reviewer **feedback** from a prior pass — address **that specific point**; do not redesign the card from scratch (surgical edit, below).

## Produce the card

1. **Plate HTML** — a self-contained card sized to the film (1920×1080), per COMPOSED-CARDS §2:
   - **ground full-bleed, content inside a safe area** — the flat colour ground covers the whole 1920×1080 frame, but the text/subject/accent sit inside a **≥ ~8–10% margin on all four sides** (≈150–190px). Nothing readable touches or bleeds past that safe edge;
   - **show the spec's on-screen text, scaled to fit** — render the focal phrase (or full line) the spec names, at a type size that fits the safe area on **~1–3 lines with clear breathing room**. A longer text means smaller type or fewer words — **never** a fixed giant size that wraps to a wall of edge-to-edge lines;
   - the focal element **dominates the safe area** — clearly the largest thing, read instantly — but dominant, not overflowing (no big empty ring/band with content tiny; and no crammed, edge-touching block either);
   - **flat** colour ground (not gradients), one accent, readable type;
   - the sourced font via a shared `@font-face` that references `fonts/<name>.woff2` — **do NOT embed the font base64**; reference the shared file (assemble places it). This keeps the card small + editable;
   - keep the §3 AI-slop tell cluster at 0–1.
2. **Camera** — `{focus:[x,y], zoom, at:"<the word in the VO line this card lands on>"}`.

## Output — one JSON object, no prose

```
{"id":"<this card id>","vo_line":"<the VO line>","camera":{"focus":[x,y],"zoom":<n>,"at":"<word>"},"plate_html":"<the full self-contained HTML string, font REFERENCED not embedded>"}
```

## Surgical edit on reopen

On a reopen you are given your prior card + the reviewer's specific finding (what's wrong + the direction). Change **only** what the finding names — the one element, colour, scale, or word — and keep the rest of the card as it was. You are editing one card, not regenerating it; a byte you don't need to change, don't.
