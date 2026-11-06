# MOTION-VOCAB — the motion & transition vocabulary

The craft bar already forbids the slideshow (CRAFT-BAR §A1: *"Motion must mean something… a slow zoom on a static card is not motion. Zero real cuts/transitions on the VO beats = slideshow = revise."*). This reference is the **how**: the concrete, renderable motion the storyboard/scene skills must reach for so every beat earns that bar instead of a held plate under a pan.

The vocabulary mirrors the HyperFrames catalog (the OSS library our `motion-graphics` backend already renders — `https://hyperframes.heygen.com/catalog`, 448 templates across Text & captions · Cursors · Transitions · Data & charts · Motion & effects · 3D · Carousels). We borrow the **motion**, not the flashy 3D chrome — match it to the brand (a clean SaaS brand gets kinetic, legible motion, not glass-shard turntables).

## What this engine can actually render today (no generative keys)

Three mechanisms, all local, all keyless. Every motion below is built from these:

1. **GSAP motion-graphics comp** — the `motion-graphics` method / tool. A self-contained HTML + paused GSAP timeline, rendered frame-accurate. The richest lever: full control of text, charts, transitions, effects. Use for any designed-motion or text/data beat.
2. **Authored `layers` with `move`** (`authored-composite`) — elements composited over a real-UI/asset plate, each fading/scaling/sliding/shrinking via GSAP props (`scale`, `x`, `y`, `opacity`) over `dur` at a word anchor. Use to animate things **onto** a real product frame (callouts, a cursor, a presenter PiP, a mascot).
3. **Word-anchored camera move** over the plate — the base tour. On its own it is NOT motion (a pan on a static plate is the slideshow). It is the bed the other two animate over.

## The verbs — pick one per beat for how the focal element ARRIVES

**Text & captions (74 in catalog).** Text never just appears or sits.
- *word-by-word reveal / stagger-in* — lines build word-by-word (per-word layer `at` anchors, or GSAP stagger). The default for any spoken on-screen line.
- *mask / clip wipe* — text wipes in behind a moving mask (GSAP `clip-path`).
- *highlight sweep* — a key phrase gets a sweeping highlight/underline on the beat it lands.
- *kinetic emphasis* — the one hero word scales/punches on its stressed syllable.
- *counter / count-up* — a number ticks from 0 to its value (see Data).

**Cursors (14).** The highest-leverage way to make a product beat feel *used*, not screenshotted. A pointer that **glides to**, **clicks**, **drags**, or **selects** a real UI element, synced to the VO, with a click/tick SFX on the action. Render as a cursor layer (image, z≈20) with a `move` path. Reach for this on every "it does X" UI beat.

**Transitions between beats (31).** The thing the slideshow lacks: beats must *connect*, not hard-sit.
- *push / slide* — the outgoing beat pushes off as the next slides in.
- *zoom-through / match-cut* — zoom into an element that becomes the next beat's frame.
- *wipe / light-leak / glitch* — a short transition comp bridging two scenes.
- At minimum: a deliberate cut landed on a VO stress with a `whoosh`/`hit` SFX — never a silent dissolve between near-identical frames.

**Data & charts (18).** Numbers and proof animate their value in: bars grow, a line draws, a progress ring fills, the hero number counts up. A static stat card is a slideshow beat — animate the data (GSAP comp).

**Motion & effects / Surfaces / Blocks (97/26/47).** Parallax depth, scale-in cards, a browser/device frame that assembles around the plate, layered reveals. Use to give the composition depth instead of one flat held image.

## The rule the reviewers enforce

- **Every beat declares a motion verb** (how its focal element arrives) **and a transition** to the next beat. A beat whose only motion is a camera zoom on a static plate fails §A1.
- **No two consecutive beats** are both static-plate-under-a-pan. If a stretch is turning into a slideshow, convert a beat to a `motion-graphics` comp or add animated `layers`.
- **The one signature move (§A1)** is usually a motion device — a recurring bespoke transition or a kinetic motif. Name it; carry it on 1–2 beats.
- **Restraint:** motion serves the idea and stays legible (§A4). Kinetic ≠ busy. Don't animate six things at once; one clear move per beat.
