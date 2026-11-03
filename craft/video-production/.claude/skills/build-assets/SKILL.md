---
name: build-assets
description: Produce the assets a video's scenes draw from — capture the real-UI plates and generate (or specify) the images, characters, and 3D assets the storyboard calls for. Runs once per video, before the scenes are built. Outputs the asset set, not any scene.
---

# build-assets

> ## Hold to the craft bar
> Read `craft/video-production/docs/CRAFT-BAR.md` (§A universal taste + the matching §B profile); for composed assets also `craft/video-production/docs/COMPOSED-CARDS.md`. The asset set is judged against both.

You produce the **assets** the scenes will compose from — not the scenes themselves. The engine runs this once for the video; the per-scene producers (`build-scene`) reference these assets by id.

## Inputs

- The approved **storyboard** (`film.json`) — its `assets` map names what each scene needs (plates, images, characters, 3D) and the capture config.
- The approved **moodboard** — the visual language generated assets must match.

## What to produce

For each asset the storyboard declares:

- **Plates (real UI).** Run `site-capture.mjs` against the provided site/app. One plate-capture run can yield **several** plate assets (different screens/states/regions) — capture them all here, once; the scenes crop/frame them, they are not re-captured downstream. A real screen is rarely shot-perfect: clean the ephemeral noise and apply **shot makeup** (declutter, pause motion, emphasize the subject, restyle — or a gen-AI pass only when the DOM can't reach it) so each plate focuses on its message while staying truthful to what the product does. Pick the method by the goal; full guidance in the `capture-site` skill's **Shot makeup** and **Camera check**.
- **Generated images.** Generate them to match the moodboard with the `image` craft tool. It owns provider choice, the variation loop and a provenance sidecar the same way `vo.py` owns TTS:

  ```
  python3 craft/video-production/tools/image.py --request "generate:<prompt, matching the moodboard>" --out <workDir>/assets --name <asset-id> [--n N] [--size WxH]
  ```

  The provider is `$IMAGE_PROVIDER` (`stub` default — a keyless, zero-cost SVG placeholder that names the prompt, so a dry run still produces a carryable file; `openai` / `gemini` when a key is provisioned; `custom` via `$IMAGE_GEN_CMD`). Even on `stub`, write the exact prompt/size/provider so the real still drops in unchanged when a key lands — the placeholder *is* the spec.

  **Hold every generated asset to §A3 (anti-slop).** The look must trace to *this* brand's own material — its real product, palette, era, audience, content. "Clean / modern / lets it breathe" is not a reason. Apply the **swap test**: put a different product's name on the asset; if it still fits, it is generic → rewrite the prompt with a sourced choice and regenerate. Any type rendered into an asset must be **non-default**: not Inter, Roboto, Open Sans, Lato, Arial, Helvetica, Montserrat, Poppins, system-ui (tier 1), **nor** Space Grotesk, Geist, DM Sans, Plus Jakarta, Manrope, Outfit, Syne, Instrument Sans/Serif, Fraunces, Playfair (tier 2 — now just as much a tell). Watch the whole cluster (gradients-everywhere, a rounded-card-for-everything, one bright accent on a dark ground, a default font) and keep it to **0–1 tells**; 2+ reads as AI output and will be sent back.
- **Prefer SVG for brand UI (fidelity).** Vector UI reads premium; a raster screenshot pasted into a composed card looks like slop. Where a brand UI element (a logo, an icon, a button, a chrome panel) is going into a composed/generated card, rebuild or source it as **SVG** rather than dropping in a raster screenshot, so it stays crisp at any scale. Genuine real-UI **plates captured from the live site** are the exception — those are real screens, not pasted chrome, and stay as captured.
- **Generated characters / 3D.** No generator yet — specify them precisely (the generator, the prompt, the reference, the dimensions) so they drop in unchanged when provisioned.
- **Stock**, if the storyboard calls for it.

Write each asset into the work dir where the scene producers expect it (the path the storyboard's `assets` entry names).

## Output

The produced/updated asset set (paths), or, for keyless generators, the asset specs. Keep it to the assets — do not build or render any scene.

> **Status.** Real-UI plate capture works today. Image generation is provisioned (`image.py`: `stub` default, `openai` / `gemini` keyed). Character / 3D / video backends are still keyless — specify them rather than fabricating a file.
>
> **Tool gap (FLAG for the main agent).** `image.py` generates **raster only** — there is no SVG generation or validation path. The "prefer SVG for brand UI" requirement above cannot be served by the generator today; until a vector path exists, hand-author or externally source the SVG and reference it as an asset.
