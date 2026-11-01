---
name: assemble-scenes
description: Assemble a generative (Family B) video by concatenating the approved per-scene clips into one film, in storyboard order, with the shared audio bed. The counterpart to render-film (which assembles a real-UI film.json) — this one stitches generated scene clips. Produces the final .mp4.
---

# assemble-scenes

You assemble the finished video from the **approved scene clips** the upstream `build` step produced — one clip per scene, already reviewed for quality, conformance, and cross-scene consistency. You do **not** generate or re-cut scenes; you stitch what exists, in order.

The scenes may use **different realization methods** (authored-composite / authored-continuous rendered by the Family-A chain, or whole-clip-generative). You treat them uniformly — each scene is one `scene.mp4` and you concatenate them regardless of how each was produced. Mixed-method videos are normal.

## Inputs

- The approved **scene clips** (one `scene.mp4` per scene, in playback order) from the build fan-out — any realization method.
- The approved **storyboard** — the running order, the voiceover/audio plan, transitions.

## Steps (when scene generation is live)

1. Collect the scene clips in storyboard order.
2. Concatenate them into one timeline (ffmpeg concat), applying the storyboard's transitions between scenes.
3. Lay the shared audio bed (voiceover from `voice-production`, music, SFX) over the concatenated video and mix to the mastering target, the same way `render-film` mixes.
4. Render the final `<workDir>/film.mp4` and confirm it is non-empty.

## Output

The path to the assembled `<workDir>/film.mp4`. Do not read the binary into your reply.

> **Status — partial.** Authored scenes (`authored-composite` / `authored-continuous`) render to a real `scene.mp4` today via the Family-A chain, so a video whose scenes are all authored assembles fully now. `whole-clip-generative` scenes are still keyless (HeyGen/Higgsfield not provisioned) — those arrive as shot specs, not clips. For a video that contains a generative scene, report that those clips are not yet generated rather than fabricating one; the concat/mix/render here runs unchanged once they are real.
