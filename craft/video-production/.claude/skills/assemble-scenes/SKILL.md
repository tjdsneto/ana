---
name: assemble-scenes
description: Assemble the master video from the approved per-scene clips — concatenate them in storyboard order onto one master timeline and mux the master audio (the multi-track mix). The final render of the unified pipeline; scenes may be produced by any realization method. Produces the final .mp4 via craft/video-production/tools/assemble.mjs.
---

# assemble-scenes

> ## Hold to the craft bar
> Read `craft/video-production/.claude/references/CRAFT-BAR.md` (§A + the §B profile); for composed scenes also `COMPOSED-CARDS.md`. Judged against both.

You assemble the finished video from the **approved scene clips** the upstream `build` step produced — one clip per scene, already reviewed for quality, conformance, and cross-scene consistency. You do **not** generate or re-cut scenes; you stitch what exists, in order.

The scenes may use **different realization methods** (authored-composite / authored-continuous rendered by the authored-render chain, or whole-clip-generative). You treat them uniformly — each scene is one `scene.mp4` and you concatenate them regardless of how each was produced. Mixed-method videos are normal.

> **Cross-scene craft is not yours to gate.** You stitch; you do not re-judge scenes. One whole-video property — §A1's *no slideshow across scenes* (near-duplicate beats, every beat visually distinct, one signature move across the whole) — only becomes visible once the scenes play as a whole, so per-scene reviewers and this step cannot fully gate it; it is **`final-review`**'s call. If while collecting the clips you can already see the assembled whole will read as a slideshow (several near-identical beats, no signature), flag it for `final-review` rather than passing it silently.

## Inputs

- The approved **scene clips** (one `scene.mp4` per scene, in playback order) from the build fan-out — any realization method.
- The approved **storyboard** — the running order, the voiceover/audio plan, transitions.

## Steps

1. **Collect** the approved scene clips into `<workDir>/scenes/` as `NN-<id>.mp4` numbered in playback order (so they sort correctly).
2. **Write the master-timeline document** `<workDir>/timeline.json` — the NLE artifact a later visual editor renders:
   ```json
   { "scenes": ["scenes/01-hook.mp4", "scenes/02-feature.mp4", "scenes/03-cta.mp4"],
     "audio": "media/mix.wav", "fps": 30, "size": [1920, 1080] }
   ```
3. **Produce the master audio.** Run `mix.py` — it reads `src/audio-plan.json` (the separate voice / music / sfx tracks, summed and ducked) when the storyboard declared `audio`, else its single-bed path — writing `<workDir>/media/mix.wav`.
4. **Render the master.** Run the assemble tool — it scales each scene to the master size/fps, concatenates them (hard cuts for now; transitions are a later refinement), and muxes the master audio:
   ```
   node craft/video-production/tools/assemble.mjs --root <workDir> --out <workDir>/film.mp4
   ```
5. Confirm `<workDir>/film.mp4` exists and is non-empty.

## Output

The path to the assembled `<workDir>/film.mp4`. Do not read the binary into your reply.

> **Status — partial.** Authored scenes (`authored-composite` / `authored-continuous`) render to a real `scene.mp4` today via the authored-render chain, so a video whose scenes are all authored assembles fully now. `whole-clip-generative` scenes are still keyless (HeyGen/Higgsfield not provisioned) — those arrive as shot specs, not clips. For a video that contains a generative scene, report that those clips are not yet generated rather than fabricating one; the concat/mix/render here runs unchanged once they are real.
