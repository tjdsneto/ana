---
name: moodboard
description: Produce the visual direction for the video — a brand-sourced look (ground, palette, type, layout primitive, surface, signature) that the storyboard's cards apply. The anti-AI-slop gate: every choice traced to the brand's own material, a non-default typeface, flat over gradient, 0-1 tells.
---

# moodboard

> ## Hold to the craft bar
> Read `craft/video-production/.claude/references/CRAFT-BAR.md` (§A + the §B profile) and `craft/video-production/.claude/references/COMPOSED-CARDS.md`. Judged against both.

Define the **look** the whole video is built in. This is the brand/look gate — do it well and the composed cards inherit a premium, specific direction; do it lazily and every card reads as AI slop. Read `craft/video-production/.claude/references/CRAFT-BAR.md` §A3 (the tell cluster) and `craft/video-production/.claude/references/COMPOSED-CARDS.md` §1 first.

## The method — source every choice, no defaults

Decide six fields; each MUST trace to THIS brand's own material (its real product, palette, era, audience, content from the briefing/research), with the reason stated. "Clean / modern / readable / lets it breathe" is not a reason.

1. **Ground** — the dominant background. Prefer a **flat, saturated colour field** (or a considered near-black / off-white chosen for the brand), NOT gradients. Gradients-everywhere is the biggest AI tell.
2. **Palette** — background / text / one accent / a semantic hue or two. Name the hexes; keep one dominant hue per beat (colour-per-beat is a strong device).
3. **Type** — a typeface chosen FOR this brand, with the reason. Do **not** use unspecified defaults: Inter, Roboto, Open Sans, Lato, Arial, Helvetica, Montserrat, Poppins, system-ui (tier 1); Space Grotesk, Geist, DM Sans, Plus Jakarta, Manrope, Outfit, Syne, Instrument Sans/Serif, Fraunces, Playfair (tier 2 — now just as tired). State the weights and the one display role. Note the offline fallback and design for it.
4. **Layout primitive** — the one structural idea (full-bleed type, a split, a single framed artifact). Not "a card for everything."
5. **Surface** — how elements sit (flat, a single hairline, one soft vignette). Restraint; no gradient stacks, no rounded-card-on-everything.
6. **Signature** — one memorable device unique to THIS video (a recurring motif, a motion idea, a transition). Every good launch video has one. Never reuse a signature from a past video.

## Tests before you output

- **Swap test:** put a different product's name on this look — if it still fits, it's generic. Redo it.
- **Tell count (CRAFT-BAR §A3):** gradients-everywhere + card-for-everything + one-bright-accent + a default font = a 4-tell slop cluster. Keep to **0–1 tells**. If you're over, name the specific sourced swap.
- **No house style:** do not repeat a palette/type/signature from an earlier video for this brand.

## Output

A concise moodboard: the mood in one line, then the six fields with hexes, type stack + weights, the layout primitive, the surface rules, and the signature — each with its brand-sourced reason. Keep it buildable: the storyboard must be able to turn it into inline-HTML cards directly. Honesty: approximate hexes/fonts are tagged as approximate (tune on render); nothing invented as fact.
