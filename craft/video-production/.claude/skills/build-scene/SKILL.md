---
name: build-scene
description: Produce one scene from its spec, realized by the scene's method (authored-composite / authored-continuous / whole-clip-generative / edit-footage / motion-graphics), consistent with the storyboard's visual direction. Owns the per-method realization — the generator choice for generative scenes (HeyGen / Higgsfield), the EDL for edit-footage, the composition for motion-graphics — the way voice-production owns TTS. Builds exactly one scene, never the whole video.
---

# build-scene

> ## Hold to the craft bar
> Read `craft/video-production/.claude/references/CRAFT-BAR.md` (§A + the §B profile); for composed scenes also `COMPOSED-CARDS.md`; for the scene's motion, `MOTION-VOCAB.md`. Judged against all.

You produce **one scene** of the video — the clip for exactly the scene in this node's spec, not the whole film, realized by the spec's `method`. The engine fanned this scene out from the storyboard; a sibling node owns each other scene.

## Inputs

- **This unit's spec** (in the task prompt under "This unit's spec") — the one scene to build: its subject, spoken line(s), visual direction, and duration.
- The shared **storyboard** + **moodboard** (approved upstream) — the visual language every scene must share (palette, type, motion feel, pacing).
- Any reviewer **feedback** from a prior pass — address it; do not start over.

## Route by the scene's `method`

The scene spec carries a **`method`** (assigned by `plan-scenes`). It decides how you realize this one scene. All methods produce one `scene.mp4` (or its spec, while keyless) in the scene work dir; `assemble-scenes` concatenates them.

- **`authored-composite`** — build this scene as a small **authored film** of its own: write a per-scene `film.json` (the contract documented in `assemble-board/schema.json` + `example.json`) into the scene work dir, with a `layers` array for the overlay elements the brief calls for (a character, a callout, or a **presenter/avatar PiP** that `move`-shrinks to a corner), over a plate whose render_kind is **real-UI-capture or generated-asset (composed)**. Render it with the authored-render chain (`render-film`'s tools — `site-capture` → `build.py` → `render.mjs` → `mix`), scoped to this scene's duration, → `scene.mp4`. This is the method that mixes a real-UI-capture (or composed) plate with generated assets in one frame.
- **`authored-continuous`** — the same authored-render chain, but a single plate under one continuous word-anchored camera move and no `layers` (a straight product-tour beat).
- **`whole-clip-generative`** — generate the scene as one whole clip via the generator below; do not decompose it.
- **`edit-footage`** — the scene is cut from a **caller-provided** video asset staged in the scene work dir (a screen recording, a take, stock). Follow the `edit-footage` craft skill: inspect the asset, write an EDL (in/out, crop, audio), apply it with `edl-apply.mjs`, optionally a ken-burns `punch.mjs` → `scene.mp4`. You cut/crop what's provided; never fabricate footage.
- **`motion-graphics`** — the scene is a programmatic animated clip (animated title / lower-third / caption / stat / chart / overlay). Follow the `motion-graphics` craft skill: author a self-contained HTML/GSAP composition and render it with the motion-graphics tool (HyperFrames default) → `scene.mp4`. Build the motion from `MOTION-VOCAB.md` — word-by-word text reveals, a number that counts up, a bar/line that draws in, kinetic emphasis on the hero word. Use for a designed-motion / text / data beat with no captured or generated footage.

## Motion is required — the scene's `brief` names its verb (§A1, MOTION-VOCAB)

The scene brief carries a MOTION verb + a TRANSITION (assigned by `plan-scenes`). Realize them — do not ship a static plate under a slow pan (that is the slideshow §A1 fails):

- **`authored-composite`:** the focal element must *arrive* with motion — animate `layers` (`move`/entrance), not a static overlay. For a real-UI "it does X" beat, drive a **cursor** layer that glides to and clicks the element, synced to the VO, with a click/tick SFX:
  ```json
  { "kind": "image", "src": "assets/overlays/cursor.png", "at": "<word before the action>", "until": "<end>", "x": 300, "y": 600, "z": 20,
    "move": { "to": { "x": 1180, "y": 430 }, "at": "<word>", "dur": 0.7, "ease": "power2.inOut" } }
  ```
  (land a `click@"<word>"` SFX in the audio plan on the click). Callouts stagger in; a result panel scales in; the presenter PiP shrinks to a corner. One clear move per beat — kinetic, not busy (§A4).
- **`authored-continuous`:** a camera pan is the *bed*, not the motion. If the beat has nothing animating over it, it is a slideshow candidate — prefer `motion-graphics` or add an animated layer unless the pan itself reveals something (a canvas tour).
- **Transition out:** realize the brief's transition into the next beat (push / zoom-through / match-cut / a cut on a VO stress with a whoosh) at the scene's tail where the method allows; at minimum do not end on a frozen hold.
- **Dwell (§A4):** hold the scene's information long enough to read after the motion completes; don't cut the instant the reveal lands.

Pick the branch from `method`; do not generate a clip for the authored methods, do not hand-author a composite for the generative one, and do not re-capture or re-generate footage for `edit-footage` (use only what the staged asset contains).

## Layers — composite elements on the stage (the `authored-composite` method)

For `authored-composite`, the per-scene `film.json` can carry a top-level `"layers"` array — extra elements composited over the plate: a mascot/character, an overlay image, a text callout, or a **video PiP** (a presenter, an avatar, a screen recording). Use layers when the scene must show more than one thing at once: a real-UI plate **with** a character beside it, or a presenter that shrinks into a corner over the product (when that corner-shrink is the video's **§A1 signature move**). A plain real-UI tour needs none — do not add them for their own sake.

```json
"layers": [
  { "kind": "image", "src": "assets/overlays/mascot.png", "at": "<word>", "until": "<word>", "x": 1360, "y": 72, "w": 460, "z": 15 },
  { "kind": "text",  "text": "**Set up in 5 steps**", "at": "<word>", "until": "<word>", "x": 120, "y": 900, "z": 18 },
  { "kind": "video", "src": "assets/overlays/presenter.mp4", "at": "<word>", "until": "<word>", "x": 1360, "y": 72, "w": 460, "z": 16,
    "move": { "to": { "scale": 0.34 }, "at": "<word>", "dur": 0.6, "ease": "expo.out" } }
]
```

- **`kind`** — `image` · `text` (themed; `**bold**` supported) · `video` (a clip played in sync with the timeline).
- **`at` / `until`** — word anchors (same grammar as `camera`); the layer fades in at `at`, out at `until`.
- **`x` / `y` / `w` / `h` / `z`** — position + size in **film pixels** (the `size` space), and stacking order (plate ≈ 0–5, chip 7, cursor 20; layers default 15).
- **`move`** (optional) — an authored transform to `to` over `dur` starting at `move.at`; the canonical use is a presenter that starts full-frame then **shrinks to a corner** (PiP). `to` takes GSAP props (`scale`, `x`, `y`, `opacity`).
- **Asset source is per layer** — a presenter can be a real recording or a generated avatar; swap `src`, nothing else changes.

Layers composite over the plate camera, which still runs underneath. Hold the bar: the frame must still read as **one idea** — a layer must not clutter the beat.

## The scene-generation tool — the `whole-clip-generative` branch (swappable, like voice-production owns TTS)

For `whole-clip-generative` scenes, this skill owns which generator builds the clip, the same way `voice-production` owns the TTS engine:

- **HeyGen** — avatar / talking-head scenes.
- **Higgsfield** — generative motion / cinematic b-roll scenes.
- **video-gen** (future) — other text-to-video backends.

Pick the generator that fits the scene's spec, call it with the scene's prompt + the shared style, and write the clip to the work dir.

> **Status — keyless.** The HeyGen / Higgsfield API keys are not provisioned yet. Until they land, this skill cannot generate a real clip. Produce the scene's **shot spec** instead — the exact generator, prompt, duration, and style parameters you *would* send — so the scene is fully specified and reviewable, and the clip drops in unchanged once the keys arrive. Do not fake a rendered file or substitute stock footage. When the keys are provisioned, switch this type to a rendered leaf (file output) and shell the generator here, mirroring `render-film`.

## Consistency is the point

Generative clips drift in style between scenes — that is the whole reason scenes are reviewed against each other. Match the storyboard's established look exactly: same palette, type treatment, motion energy, and framing discipline (fill the frame; no dead space; readable text) as the sibling scenes. The generic `review-consistency` reviewer will reopen this scene if it clashes.

## Output

Keep it to this one scene:
- **`authored-composite` / `authored-continuous`** — the rendered `scene.mp4` path. If the render deps are unavailable in this environment, output the per-scene `film.json` you authored (fully specified, so the clip drops in unchanged).
- **`whole-clip-generative`** — the clip path once generation is live; until then, the scene's shot spec (generator + prompt + params + duration).
