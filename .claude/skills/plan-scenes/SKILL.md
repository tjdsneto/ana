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

**Only** a fenced ```json block: an array of objects `{ "name": string, "brief": string }`, one per storyboard scene, in playback order. Nothing else — no prose, no trailing text.

- `name` — a short scene label (e.g. `"Hook"`, `"Problem"`, `"Feature: forms"`, `"CTA"`).
- `brief` — the **self-contained spec** that scene's producer needs: what happens in the scene, the on-screen subject, the spoken line(s) for it, the visual direction (from the moodboard/storyboard), and the duration. It must stand alone — the scene producer sees this brief plus the shared storyboard, not the other scenes.

Example:

```json
[
  { "name": "Hook", "brief": "0:00–0:03. Open on the product's result screen. VO: 'Ship your launch video in minutes.' Upbeat, bright palette per the moodboard." },
  { "name": "CTA", "brief": "0:12–0:15. End card with the brand mark and one CTA to the site. VO: 'Start free at <domain>.'" }
]
```

## Rules

- **One entry per storyboard scene** — do not split or merge beyond what the storyboard defines, and keep them in order.
- Pull the spoken lines and visual direction straight from the storyboard/script; do not invent new messages.
- Keep each `brief` tight and concrete — it becomes the scene producer's whole instruction.
