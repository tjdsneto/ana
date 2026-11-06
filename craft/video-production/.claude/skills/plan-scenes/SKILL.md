---
name: plan-scenes
description: Planner for the build step — read the approved storyboard and fan it out into one independent scene per storyboard beat, each with its realization method, as the {name, brief, method} list the engine expands. Output ONLY the JSON array.
---

# plan-scenes

> ## Hold to the craft bar
> Read `craft/video-production/.claude/references/CRAFT-BAR.md` (§A + the §B profile); for composed scenes also `COMPOSED-CARDS.md`; for the per-beat motion you assign, `MOTION-VOCAB.md`. Judged against all.

You plan the **build** step of a generative video. The storyboard upstream already defined the scenes; your job is to turn each one into a self-contained unit the engine will produce as its own node. You do **not** generate any clip here — you only emit the plan.

## What you get

- the **brief** (goal, audience, tone), and
- the approved **storyboard** (`film.json`), which lists the scenes in playback order.

## What to output

**Only** a fenced ```json block: an array of objects `{ "name": string, "brief": string, "method": string }`, one per storyboard scene, in playback order. Nothing else — no prose, no trailing text.

- `name` — a short scene label (e.g. `"Hook"`, `"Problem"`, `"Feature: forms"`, `"CTA"`).
- `brief` — the **self-contained spec** that scene's producer needs: what happens in the scene, the on-screen subject, the spoken line(s) for it, the visual direction (from the moodboard/storyboard), and the duration. It must stand alone — the scene producer sees this brief plus the shared storyboard, not the other scenes.
- `method` — the **realization method** for this scene (see below). Different scenes in the same video may use different methods; pick the one that fits the scene, not a single method for the whole film.

### Realization methods (the palette)

The method decides *how* the scene's clip is produced. The pipeline spine (brief → script → moodboard → storyboard) is fixed; the method is the open, per-scene choice.

- **`authored-composite`** — layered elements composited on the authored stage: a real-UI (or composed) plate with overlay elements (a character, a callout, a presenter/avatar **PiP**) via the storyboard's `layers`. Use when the scene mixes things — real-UI **and** a generated character, or a presenter over the product. Rendered per scene by the authored-render craft chain (the plate's render_kind is **real-UI-capture or generated-asset**).
- **`whole-clip-generative`** — the scene is generated as one whole clip (avatar talking-head, cinematic b-roll), not decomposed. Use for a presenter-only scene or a generated mood shot. Kept first-class.
- **`authored-continuous`** — one **real-UI-capture** plate under one continuous word-anchored camera move. Use for a straight product tour beat.
- **`edit-footage`** — the scene is cut from a **caller-provided** video asset (a screen recording, a take, stock) — a trimmed/cropped sub-clip, optionally with a ken-burns punch-in. Use when the brand supplied footage for this beat; the asset is staged into the scene work dir. (The `edit-footage` craft skill owns the EDL + `edl-apply`/`punch` tools.)
- **`motion-graphics`** — the scene is a programmatic animated clip (animated title/lower-third/caption/overlay) authored as an HTML/GSAP composition and rendered by the motion-graphics tool. Use for a designed-motion beat with no captured or generated footage.

When unsure, prefer `authored-composite` for mixed/overlay scenes, `authored-continuous` for a pure real-UI beat, `whole-clip-generative` only when the scene is inherently a generated clip (avatar/cinematic), `edit-footage` when the beat is cut from a provided video, and `motion-graphics` for a pure designed-motion/title beat.

### Motion is the point — do not plan a slideshow (§A1, MOTION-VOCAB)

A plate under a slow camera pan is **not** motion; a run of those is the slideshow §A1 fails. Plan motion into every beat:

- **Route text / caption / title / stat / chart beats to `motion-graphics`** (GSAP comps that reveal text word-by-word, count a number up, draw a chart) rather than a static plate with the text burned in.
- **An `authored-composite` beat must carry *animated* `layers`** — a cursor that glides and clicks the real UI, a callout that staggers in, a presenter that shrinks to a corner — not a static overlay. A real-UI beat where "it does X" is shown is the place for a **cursor** layer (MOTION-VOCAB → Cursors).
- **Every scene `brief` names a motion verb + a transition.** State how the focal element *arrives* (reveal / count-up / cursor-click / scale-in / draw-in) and the transition into the next beat (push / zoom-through / match-cut / a cut landed on a VO stress with a whoosh). A brief that says only "show the dashboard, slow push-in" is a slideshow beat — add the verb.
- **No two consecutive scenes are both static-plate-under-a-pan.** If the plan is drifting that way, convert one to `motion-graphics` or add animated layers.

Example:

```json
[
  { "name": "Hook", "method": "motion-graphics", "brief": "0:00–0:03. Kinetic title: the line reveals word-by-word, the hero word 'minutes' punches on its stress. VO: 'Ship your launch video in minutes.' Moodboard palette + sourced face. MOTION: word-by-word reveal + kinetic emphasis. TRANSITION out: zoom-through 'minutes' into the dashboard." },
  { "name": "Walkthrough", "method": "authored-composite", "brief": "0:03–0:10. Real dashboard plate; a CURSOR glides to the Generate button and clicks (click SFX), the result panel scales in. VO: '…and it does the work for you.' MOTION: cursor-click + scale-in. TRANSITION out: push left to the proof beat." },
  { "name": "Proof", "method": "motion-graphics", "brief": "0:10–0:12. The hero stat counts up 0→10,000 as a bar grows in. VO: 'Ten thousand creators already shipped.' MOTION: count-up + bar draw-in. TRANSITION out: match-cut the bar into the CTA pill." },
  { "name": "CTA", "method": "authored-composite", "brief": "0:12–0:15. End card, brand mark + a 'Start free' pill that pops in and holds readable; cursor rests on it. VO: 'Start free at <domain>.' MOTION: pill pop-in. Signature move carried here." }
]
```

## Rules

- **One entry per storyboard scene** — do not split or merge beyond what the storyboard defines, and keep them in order.
- **Assign a `method` per scene** from the palette above; mixed methods across one video are expected, not an error.
- Pull the spoken lines and visual direction straight from the storyboard/script; do not invent new messages.
- **Carry the whole-video craft anchors down to named scenes** (§A1/§B of the craft bar). The storyboard owns them whole-video; put each in the specific scene brief so the producer has its piece: assign the **§A1 signature move** to the one scene that carries it (not every scene), give the **single hero number/receipt** its own scene framed big (§A1/§A2) when the video has one, and put the **§B-profile close** (B-launch's required on-screen CTA; B-teaser's deferred ask; B-demo/-explainer's next step) in the final scene's brief. A scene brief that omits its assigned anchor leaves the producer to guess.
- Keep each `brief` tight and concrete — it becomes the scene producer's whole instruction.
