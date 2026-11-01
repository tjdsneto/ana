---
name: plan-scenes
description: Planner for the generative (Family B) build step — read the approved storyboard (film.json) and fan it out into one independent scene per storyboard scene, as the generic {name, brief} list the engine expands. Output ONLY the JSON array.
---

# plan-scenes

You plan the **build** step of a generative video. The storyboard upstream already defined the scenes; your job is to turn each one into a self-contained unit the engine will produce as its own node. You do **not** generate any clip here — you only emit the plan.

## What you get

- the **brief** (goal, audience, tone), and
- the approved **storyboard** (`film.json`), which lists the scenes in playback order.

## What to output

**Only** a fenced ```json block: an array of objects `{ "name": string, "brief": string, "method": string }`, one per storyboard scene, in playback order. Nothing else — no prose, no trailing text.

- `name` — a short scene label (e.g. `"Hook"`, `"Problem"`, `"Feature: forms"`, `"CTA"`).
- `brief` — the **self-contained spec** that scene's producer needs: what happens in the scene, the on-screen subject, the spoken line(s) for it, the visual direction (from the moodboard/storyboard), and the duration. It must stand alone — the scene producer sees this brief plus the shared storyboard, not the other scenes.
- `method` — the **realization method** for this scene (see below). Different scenes in the same video may use different methods; pick the one that fits the scene, not a single method for the whole film.

### Realization methods (the palette)

The method decides *how* the scene's clip is produced. The pipeline spine (brief → script → moodboard → storyboard) is fixed; the method is the open, per-scene choice.

- **`authored-composite`** — layered elements composited on the authored stage: a real-UI (or composed) plate with overlay elements (a character, a callout, a presenter/avatar **PiP**) via the storyboard's `layers`. Use when the scene mixes things — real-UI **and** a generated character, or a presenter over the product. Rendered by the Family-A craft chain per scene.
- **`whole-clip-generative`** — the scene is generated as one whole clip (avatar talking-head, cinematic b-roll), not decomposed. Use for a presenter-only scene or a generated mood shot. Kept first-class.
- **`authored-continuous`** — one real-UI plate under one continuous word-anchored camera move (classic Family-A). Use for a straight product tour beat.

When unsure, prefer `authored-composite` for mixed/overlay scenes, `authored-continuous` for a pure real-UI beat, and `whole-clip-generative` only when the scene is inherently a generated clip (avatar/cinematic).

Example:

```json
[
  { "name": "Hook", "method": "authored-continuous", "brief": "0:00–0:03. Open on the product's result screen, slow push-in. VO: 'Ship your launch video in minutes.' Bright palette per the moodboard." },
  { "name": "Walkthrough", "method": "authored-composite", "brief": "0:03–0:10. Real dashboard plate; a presenter PiP shrinks to the top-right corner as the VO explains. VO: '…and it does the work for you.'" },
  { "name": "Vibe", "method": "whole-clip-generative", "brief": "0:10–0:12. Cinematic b-roll mood shot, no UI. VO: (music swell)." },
  { "name": "CTA", "method": "authored-composite", "brief": "0:12–0:15. End card with the brand mark + one CTA; a character layer waves. VO: 'Start free at <domain>.'" }
]
```

## Rules

- **One entry per storyboard scene** — do not split or merge beyond what the storyboard defines, and keep them in order.
- **Assign a `method` per scene** from the palette above; mixed methods across one video are expected, not an error.
- Pull the spoken lines and visual direction straight from the storyboard/script; do not invent new messages.
- Keep each `brief` tight and concrete — it becomes the scene producer's whole instruction.
