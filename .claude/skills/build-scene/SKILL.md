---
name: build-scene
description: Produce one scene of a generative (Family B) video from its spec, consistent with the storyboard's visual direction. Owns the scene-generation tool choice (HeyGen / Higgsfield / video-gen) the way voice-production owns TTS. Builds exactly one scene, never the whole video.
---

# build-scene

You produce **one scene** of a generative video — the clip for exactly the scene in this node's spec, not the whole film. The engine fanned this scene out from the storyboard; a sibling node owns each other scene.

## Inputs

- **This unit's spec** (in the task prompt under "This unit's spec") — the one scene to build: its subject, spoken line(s), visual direction, and duration.
- The shared **storyboard** + **moodboard** (approved upstream) — the visual language every scene must share (palette, type, motion feel, pacing).
- Any reviewer **feedback** from a prior pass — address it; do not start over.

## Route by the scene's `method`

The scene spec carries a **`method`** (assigned by `plan-scenes`). It decides how you realize this one scene. All methods produce one `scene.mp4` (or its spec, while keyless) in the scene work dir; `assemble-scenes` concatenates them.

- **`authored-composite`** — build this scene as a small **Family-A film** of its own: write a per-scene `film.json` (same shape the storyboard uses) into the scene work dir, with a `layers` array for the overlay elements the brief calls for (a character, a callout, or a **presenter/avatar PiP** that `move`-shrinks to a corner), over a real-UI (or composed) plate. Render it with the Family-A chain (`render-film`'s tools — `site-capture` → `build.py` → `render.mjs` → `mix`), scoped to this scene's duration, → `scene.mp4`. This is the method that mixes real-UI with generated assets in one frame.
- **`authored-continuous`** — the same Family-A chain, but a single plate under one continuous word-anchored camera move and no `layers` (a straight product-tour beat).
- **`whole-clip-generative`** — generate the scene as one whole clip via the generator below; do not decompose it.

Pick the branch from `method`; do not generate a clip for the authored methods, and do not hand-author a composite for the generative one.

## The scene-generation tool — the `whole-clip-generative` branch (swappable, like voice-production owns TTS)

For `whole-clip-generative` scenes, this skill owns which generator builds the clip, the same way `voice-production` owns the TTS engine:

- **HeyGen** — avatar / talking-head scenes.
- **Higgsfield** — generative motion / cinematic b-roll scenes.
- **video-gen** (future) — other text-to-video backends.

Pick the generator that fits the scene's spec, call it with the scene's prompt + the shared style, and write the clip to the work dir.

> **Status — keyless.** The HeyGen / Higgsfield API keys are not provisioned yet. Until they land, this skill cannot generate a real clip. Produce the scene's **shot spec** instead — the exact generator, prompt, duration, and style parameters you *would* send — so the scene is fully specified and reviewable, and the clip drops in unchanged once the keys arrive. Do not fake a rendered file or substitute stock footage. When the keys are provisioned, switch this type to a rendered leaf (file output) and shell the generator here, mirroring `render-film`.

## Consistency is the point

Generative clips drift in style between scenes — that is the whole reason scenes are reviewed against each other. Match the storyboard's established look exactly: same palette, type treatment, motion energy, and framing discipline (fill the frame; no dead space; readable text) as the sibling scenes. The `review-scene-consistency` reviewer will reopen this scene if it clashes.

## Output

Keep it to this one scene:
- **`authored-composite` / `authored-continuous`** — the rendered `scene.mp4` path. If the render deps are unavailable in this environment, output the per-scene `film.json` you authored (fully specified, so the clip drops in unchanged).
- **`whole-clip-generative`** — the clip path once generation is live; until then, the scene's shot spec (generator + prompt + params + duration).
