# Frame geometry — the renderer's own layout, for the deterministic pre-check

The engine runs a **deterministic layout pre-pass** over a render's own element geometry *before* it spends the model final-review (issue 0033). It catches the enumerable defect class a model judge grades worst and most expensively — text clipped at the frame edge, two text runs colliding, an element still animating at a beat's hold, a reveal that stops short, low-contrast text/CTA, and more than one type system in a frame — at roughly zero model cost, and reopens the owning step through the normal `REOPEN:` channel.

**The engine owns the checks; the renderer owns emitting the geometry.** The checks and their thresholds live in `engine/src/layout-inspect.ts` (generic, unit-tested). This file is the contract for the geometry that engine reads: what the renderer must write, and the `data-*` attributes a composition author (build-card / build-scene / motion-graphics) sets so the geometry carries the right beat and the locked-source marker.

## Where it comes from

`tools/render.mjs` already loads the composition in headless Chromium and seeks the paused GSAP timeline frame by frame. Pass **`--geometry-out <path>`** and, per sampled frame, it reads each element's own box (`getBoundingClientRect`), colour/font (`getComputedStyle`) and the authored `data-*` hints, then writes the geometry JSON. Without the flag, the render is byte-for-byte unchanged — the capture is purely additive.

The render-film / assemble skills pass `--geometry-out board/frames.json`, and the holistic-review node reads `board/frames.json` (its `precheck.geometry` in `engine/types/final-review/type.json`).

## The JSON shape (what engine reads)

```json
{
  "size": { "width": 1920, "height": 1080 },
  "frames": [
    {
      "t": 2.0,
      "beat": 3,
      "hold": true,
      "bounds": { "width": 1920, "height": 1080 },
      "elements": [
        {
          "id": "headline",
          "kind": "text",
          "text": "Your AI just learned WordPress",
          "box": { "x": 160, "y": 420, "w": 1600, "h": 180 },
          "opacity": 1,
          "color": [245, 245, 245],
          "bgColor": [11, 16, 32],
          "fontFamily": "\"Museo Sans\", sans-serif",
          "fontWeight": "700",
          "fontSizePx": 96,
          "revealProgress": 1,
          "motionDelta": 0.0,
          "lockedSourceId": null,
          "fidelity": null
        }
      ]
    }
  ]
}
```

- **`box`** — the element's rectangle in frame px. Clipping = a box crossing `bounds`.
- **`hold`** — true on a beat's *settle* frame (motion has stopped). The temporal checks (never-settling, reveal-stops-short) only fire on a hold; `render.mjs` derives it from motion settling (max per-element `motionDelta` ≤ 2px vs the previous sample).
- **`beat`** — a 1-based number lets the pre-check reopen *one* fanned-out unit (`REOPEN: scene[3]`). Authored via `data-beat` (below). A non-numeric or absent beat reopens every node of the target type.
- **`color` / `bgColor`** — sRGB; drive the WCAG contrast check (AA: 4.5:1 normal, 3.0:1 large text).
- **`fontFamily`** — the type-system check clusters text elements by their first family; 3+ distinct families in one frame is the tell (north-star #6).
- **`revealProgress`** (0–1), **`motionDelta`** (px) — temporal signals, checked on holds.
- **`lockedSourceId` / `fidelity`** — the mockup-fidelity check (issue 0049): a rendered region marked as compositing a supplied screenshot, and its 0–1 structural similarity to that source. `render.mjs` sets `lockedSourceId` from `data-locked-source`; `fidelity` is computed by `tools/mockup-diff.mjs` and merged in (see `showing-a-web-app.md`).

## What the composition author sets (`data-*`)

In the plate / scene HTML (build-card, build-scene, motion-graphics), annotate the elements that matter so the geometry is targeted and complete:

- **`data-geom="<id>"`** — a stable id for this element (else the renderer falls back to the element id or a tag-index). Use it so a reopen reason names a thing the author recognises.
- **`data-beat="<n>"`** — the 1-based beat/scene index this element belongs to, so a defect reopens just that unit.
- **`data-reveal`** — set to the reveal progress 0–1 if the element reveals progressively and GSAP doesn't already drive its width/opacity in a way the box reflects (optional; most reveals are visible in the box/opacity directly).
- **`data-locked-source="<assetId>"`** — mark a region that composites a *supplied* UI screenshot as-is (issue 0049), naming the source asset. The region must reproduce that screenshot, not a regenerated UI.

## Status / what a human must still verify

The capture path runs in the live render (Playwright + Chromium) and is **not exercisable without the live stack**, so it is unverified end to end here — the engine-side checks are unit-tested against synthetic geometry, but the real `board/frames.json` a render emits, and the `hold`/`beat` derivation against a real GSAP timeline, need a live render to confirm. Pixel-level fidelity (0049) also needs real screenshots. Treat this doc as the contract; validate the emitter on the first live render.
