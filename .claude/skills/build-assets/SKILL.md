---
name: build-assets
description: Produce the assets a video's scenes draw from — capture the real-UI plates and generate (or specify) the images, characters, and 3D assets the storyboard calls for. Runs once per video, before the scenes are built. Outputs the asset set, not any scene.
---

# build-assets

You produce the **assets** the scenes will compose from — not the scenes themselves. The engine runs this once for the video; the per-scene producers (`build-scene`) reference these assets by id.

## Inputs

- The approved **storyboard** (`film.json`) — its `assets` map names what each scene needs (plates, images, characters, 3D) and the capture config.
- The approved **moodboard** — the visual language generated assets must match.

## What to produce

For each asset the storyboard declares:

- **Plates (real UI).** Run `site-capture.mjs` against the provided site/app. One plate-capture run can yield **several** plate assets (different screens/states/regions) — capture them all here, once; the scenes crop/frame them, they are not re-captured downstream.
- **Generated assets** (images / characters / 3D). Generate them to match the moodboard, or — while a generator is keyless — specify them precisely (the generator, the prompt, the reference, the dimensions) so they drop in unchanged when keys land.
- **Stock**, if the storyboard calls for it.

Write each asset into the work dir where the scene producers expect it (the path the storyboard's `assets` entry names).

## Output

The produced/updated asset set (paths), or, for keyless generators, the asset specs. Keep it to the assets — do not build or render any scene.

> **Status.** Real-UI plate capture works today. Generated-asset backends (image / character / 3D / video) are keyless until provisioned — specify them rather than fabricating a file.
