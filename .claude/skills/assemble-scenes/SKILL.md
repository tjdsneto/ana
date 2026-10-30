---
name: assemble-scenes
description: Assemble a generative (Family B) video by concatenating the approved per-scene clips into one film, in storyboard order, with the shared audio bed. The counterpart to render-film (which assembles a real-UI film.json) — this one stitches generated scene clips. Produces the final .mp4.
---

# assemble-scenes

You assemble the finished generative video from the **approved scene clips** the upstream `build` step produced — one clip per scene, already reviewed for quality, conformance, and cross-scene consistency. You do **not** generate or re-cut scenes; you stitch what exists, in order.

## Inputs

- The approved **scene clips** (one per scene, in playback order) from the build fan-out.
- The approved **storyboard** — the running order, the voiceover/audio plan, transitions.

## Steps (when scene generation is live)

1. Collect the scene clips in storyboard order.
2. Concatenate them into one timeline (ffmpeg concat), applying the storyboard's transitions between scenes.
3. Lay the shared audio bed (voiceover from `voice-production`, music, SFX) over the concatenated video and mix to the mastering target, the same way `render-film` mixes.
4. Render the final `<workDir>/film.mp4` and confirm it is non-empty.

## Output

The path to the assembled `<workDir>/film.mp4`. Do not read the binary into your reply.

> **Status — keyless.** Scene generation (HeyGen/Higgsfield) is not provisioned, so there are no real scene clips to concatenate yet; the scenes upstream are shot specs. Until the generators land and `scene` becomes a rendered leaf, this step cannot produce a real film — report that the scene clips are not yet generated rather than fabricating one. This skill exists so the generative graph is complete and correct: when clips are real, the concat/mix/render here runs unchanged.
