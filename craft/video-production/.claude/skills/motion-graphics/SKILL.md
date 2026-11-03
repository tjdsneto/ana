---
name: motion-graphics
description: Produce programmatic motion graphics as a clip — an animated title card, lower-third, animated captions, or an overlay — by authoring an HTML composition and rendering it with the swappable backend (HyperFrames by default, Remotion reserved). Use when a beat needs designed motion/text on top of or between shots, not a captured or generated-video scene.
---

# motion-graphics

> ## Hold to the craft bar
> Read `craft/video-production/.claude/references/CRAFT-BAR.md` (§A universal taste + the matching §B profile). The clip is judged against it like any render.

You produce a **motion-graphics clip** (animated title/lower-third/caption/overlay) by authoring an **HTML composition** and rendering it with the `motion-graphics` tool. The backend is swappable — `HyperFrames` (default, local OSS) or `Remotion` (reserved) — chosen by `$MOTION_GFX_BACKEND`; your composition and the command are the same either way. This is a craft tool driving a skill, no engine port (spec-09 Decision #5).

## Author the composition (HTML)

Write a self-contained `.html` in the HyperFrames shape — a `#stage` root carrying the size, timed clips, and a **paused GSAP timeline** registered on `window.__timelines[<composition-id>]`:

```html
<div id="stage" data-composition-id="demo" data-start="0" data-width="1280" data-height="720">
  <h1 id="title" class="clip" data-start="0" data-duration="2" data-track-index="0">Your line</h1>
  <!-- clips: data-start / data-duration / data-track-index (seconds). media via <video>/<audio src=…>. -->
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script>
  <script>
    const tl = gsap.timeline({ paused: true });
    tl.from("#title", { opacity: 0, y: 40, duration: 0.8 }, 0);   // animate on the timeline
    window.__timelines = (window.__timelines || {}); window.__timelines.demo = tl;
  </script>
</div>
```

Composition length = the latest clip end. Keep the look on-brand (reuse the moodboard's palette/type); this clip composites onto the storyboard timeline like any other bit.

**Font-tell on text-heavy clips (§A3).** A title/caption/lower-third clip is almost all type, so the typeface *is* the look — a default face is the loudest AI tell here. Do not reach for Inter, Roboto, Open Sans, Lato, Arial, Helvetica, Montserrat, Poppins, system-ui (tier 1) **nor** Space Grotesk, Geist, DM Sans, Plus Jakarta, Manrope, Outfit, Syne, Instrument Sans/Serif, Fraunces, Playfair (tier 2 — now just as much a tell). Use the moodboard's brand-sourced face, loaded as a local font; swapping one default for another does not fix it.

**Local assets just work by relative path.** Reference images, video, fonts, etc. with a relative or absolute local path (`<img src="assets/icon.png">`, `url(fonts/brand.woff2)`); the render tool inlines them to data URIs before handing the HTML to the backend, so they load regardless of where the backend serves the file. Do NOT hand-inline them yourself. Remote URLs (CDN `<script>`, `https://…`) are left untouched.

## Render

```
node craft/video-production/tools/motion-graphics/index.mjs --html <comp>.html --out <clip>.mp4
```

- Default backend is `hyperframes`; set `MOTION_GFX_BACKEND=remotion` to switch — both render the same HTML composition (Remotion embeds it in an iframe and seeks the GSAP timeline per frame; it installs its bundled template on first use).
- Needs **Node ≥22 + ffmpeg**; the backend fetches/uses **headless Chromium** (baked into the engine image's `engine-tools` stage — the container bake is the one deploy step still pending).

## Output & bar

The rendered `.mp4` (or an overlay clip to composite). Nothing else. Watch it before handing off — it's held to `craft/video-production/.claude/references/CRAFT-BAR.md` like any render: readable text, on-brand look, clean motion, right duration. Fix the HTML and re-render on a problem.

## Notes

- Backends are both **local** (HyperFrames is Apache-2.0 OSS; Remotion is source-available) — no API key for either.
- Underlying tool: `craft/video-production/tools/motion-graphics/{index.mjs (dispatcher), hyperframes.mjs, remotion.mjs}`.
