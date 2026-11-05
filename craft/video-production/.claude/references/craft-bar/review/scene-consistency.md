# Review rubric — scene / consistency

Loaded by the generic `review-consistency` reviewer when judging a `scene` deliverable. The generic reviewer owns the ship-test framing and the VERDICT mechanics; this file is ONLY the scene-specific consistency rubric.

You review **one scene** on the **consistency** axis — does it look like it belongs to the same film as its siblings? Generative clips drift: each scene is an independent generation, so palette, lighting, type, motion energy, and framing wander between them. This reviewer is the reason scenes are built and gated separately instead of as one render — catch the drift here, before the whole is assembled.

## What you compare against

The **shared visual language** every scene must hold, from the approved **storyboard** + **moodboard**: palette, typography treatment, lighting/mood, motion energy and pacing, camera framing discipline, and any recurring element (logo lockup, caption style, transitions).

> While generation is keyless, you compare this scene's **shot spec** (its declared generator/prompt/style params) against that shared language. Once clips are real, compare the rendered look.

## Rubric

- **Palette & lighting.** Same colour world and light mood as the board — not warmer/colder, darker/brighter than its neighbours.
- **Type & captions.** Same font treatment, size scale, and placement convention as the other scenes.
- **Motion energy.** The same tempo/feel — a frantic scene next to slow ones (or vice versa) breaks the flow.
- **Framing discipline.** The same "fill the frame, readable text, no dead space" standard applied consistently, so one scene isn't noticeably looser than the rest.
- **Recurring elements.** Logo lockup, lower-thirds, transitions appear the same way the board establishes.

**Uniform slop still fails — consistency ≠ not-slop.** Scenes that match each other perfectly can still *all* be generic AI slop; matching does not earn a pass. The explicit §A3 tell-count (2+ → revise) is **`review-scene-quality`**'s per-scene gate — defer the count to it, don't duplicate it here. But do **not** wave N uniformly-sloppy scenes through as "consistent"; if the shared look is itself slop, that's a revise, and say the tell-count belongs to the quality axis.

On revise, name exactly how THIS scene departs from the shared language and the concrete fix (match the board's accent hex, drop the lighting to the board's mood, slow the motion to the others' tempo). Judge only consistency; an on-brief, well-crafted clip that clashes with its siblings still fails here.

Build on: the **moodboard** (the shared look), `../a1-frame.md`, and the matching §B profile. Reference rather than restate.
