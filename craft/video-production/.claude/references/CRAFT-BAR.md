# Craft bar — the premium standard every video is held to

The single source of truth for "good." Producers **aim at this**; reviewers **judge against it and drive the work up to it** — a weak piece is not passed, it is sent back with the specific change that raises it. Distilled from teardowns of real, high-reach software videos and a professional anti-AI-slop checklist. Brand/product names are deliberately absent — these are principles, not imitations.

The test, for producer and reviewer alike: **would the company whose product this is actually ship this?** Not "is it acceptable," not "does the JSON look plausible." If the honest answer is no, it is not done.

**How to read this doc:** §A is the **universal taste bar** — it holds for *every* video of *every* type; never skip it. §B is the **per-type structure profile** — pick the one matching the production's type and apply it *on top of* §A. The split exists because taste (no slop, dominance, legible proof, a signature, clean sound) generalizes, but structure (the arc, the feature count, whether a hard CTA is required, the length band) depends on what kind of video this is — a launch film, a feature demo, a teaser and an explainer are not the same shape, and a bar that bakes one shape in wrongly revises the others.

---

## A. Universal taste bar — every video, every type

### A1. Frame craft — this is where weak work actually fails
- **One dominant subject per beat, filling ≥ ~50% of the frame.** The thing the VO names at that moment must be the clear, readable anchor. A big empty ring/band/gradient with the real content tiny in a corner = dead space = revise. Scale the focal element up (raise `zoom`, aim `focus` at it).
- **Clear focal hierarchy.** One hero element; everything else is subordinate and smaller. When several similar elements share a beat, the active one is visibly larger or ringed while the rest recede — a tiny caption is not enough.
- **Every beat is visually distinct. No slideshow.** Near-duplicate held cards (the same card across 3–4 beats with a slow zoom, a line repeated over the same frame) read as padding — cut them or change the frame. Dead static holds, especially a frozen sparse end card, are the worst offenders.
- **Motion must mean something.** The merge animates, the chart draws, the number counts up, the camera moves over a canvas to reveal. A slow zoom on a static card is not motion. Zero real cuts/transitions on the VO beats = slideshow = revise.
- **Give the single strongest number/receipt its own full-frame moment.** When a video has one hero metric, it earns its own card, not a footnote. (Not every type has such a number — see §B; but when one exists, frame it big.)
- **One signature move.** Every *memorable* video has one device that is unmistakably *this* product's (a recurring motif, a tempo break, a bespoke transition). A video with no signature is forgettable, however clean. This is a taste requirement, not a launch-video requirement.

### A2. Prove it, legibly
- **Show the artifact doing the thing, not an adjective.** The strongest proof is the real capability on screen — the real result, the real output, the real receipt — large enough to read (its own card if it's the hero number). Vague "it's powerful" with nothing on screen = revise. Social proof (logos/metrics) is optional and never a substitute for capability-proof. (How much proof, and of what, is type-dependent — §B.)

### A3. Look — must not read as AI slop (the cluster test)
A design should look like it could **only** belong to this project. Detection is by **cluster**, not any single choice: **0–1 tells reads as deliberate; 2–3 reads as lightly-edited AI output; 4+ reads as unedited AI output → revise.** Aim for **0–1**; count them explicitly. The common tells:
- **Gradients everywhere** (the biggest tell), **a card/rounded-rect for everything**, a single bright accent on a dark/near-black ground, hairline rules, emoji as headings.
- **Unspecified-default fonts** — if the type wasn't chosen *for this brand*, it's a tell. Treat as defaults: Inter, Roboto, Open Sans, Lato, Arial, Helvetica, Montserrat, Poppins, system-ui (tier 1); Space Grotesk, Geist, DM Sans, Plus Jakarta, Manrope, **Outfit**, Syne, Instrument Sans/Serif, Fraunces, Playfair (tier 2 — now just as much a tell). Swapping one default for another does not fix it. A **declared, sourced substitute** — a non-default face chosen for the brand, used when a licensed primary can't be obtained — is **not** a tell: the tell is an *unspecified* default, not a deliberate fallback. A missing primary must degrade to that declared substitute, **never** to a system default, and a missing-but-substituted primary must never deadlock the pipeline (a licensed font that isn't staged is a provisioning gap, not a quality fail).
- **Every look choice must trace to the brand's own material** (its real product, palette, era, audience, content). "Clean / modern / lets it breathe" is not a reason. **Swap test:** put a different product's name on it — if it still fits, it's generic, revise.
- **No house style.** Do not reuse a signature or palette from a previous video. Each starts from the brand's material, not from the last good design.

2+ tells → a revise with the specific swaps named (and the swap must be *sourced*, not another default).

### A4. Legibility & pacing (type-independent)
- **The hook earns the rest in the first 1–5s, and is NEVER a logo/brand card.** The strongest openers, in order: (a) open **in-product on one real high-stakes action** (type the real question, trigger the real thing); (b) a **benefit/desire question** over mood, product name withheld a few seconds; (c) the **recognizable artifact materializing** (the UI assembles from nothing). A cold open on a logo, a brand name, or a generic title card is the measurably weakest option — forbid it, in every type.
- **One idea per beat.** Don't stack two messages on one beat; if the VO says two things, it's two beats.
- **Length keys off aspect/placement, not one number.** 9:16 social ≤ ~15s · teaser 15–40s · 16:9 hero 30–90s. Do not pad to hit a number. (The *target within the band* is the type's call — §B.)
- **Script density is a ceiling: ≤ ~2.5 words/sec.** Airy (≈1.7 wps) is correct for a cinematic register; never pad a cinematic piece to a word count.
- **End on the last meaningful beat.** Whether that beat is a hard CTA, a deferred tease, or a resolve is type-dependent (§B) — but it is never several seconds of dead static hold.

### A5. Sound — every production-quality video has it
- **Sound is not optional.** A finished video always carries sound — at minimum a clean voiceover, or a music bed; usually both. A silent render is not a production-quality shape (do not infer "silent is fine" from rough experiments that happen to lack audio). **Bare first-generation TTS with flat dynamics and true silence in every gap is an immediate AI tell** — a low music bed that supports, ducked under the voice, is the floor.
- **SFX depth is scoped to the concept, not a fixed quota.** A sound-forward idea (whose concept *is* the sound) earns rich per-beat SFX; a spare or kinetic piece may carry only a few deliberate hits on its key beats (a reveal, the hero number, the CTA). The weight is the video's own call — but never *zero*, and a signature beat is not left silent when the piece has sound design at all.
- **The music bed is instrumental.** Singing, lyrics, rap, a vocal hook, or spoken words in the bed fight the voiceover for the same channel — an immediate AI/stock tell and a fail, not a taste call. (The `stock:` lane excludes vocal-tagged tracks by default; `generate:` prompts must say *instrumental, no vocals*.) The only exception is a deliberate sung bed carrying a video with **no** VO.
- No dead tail: the piece ends on its last meaningful beat, not several seconds of static hold.

---

## B. Per-type structure profiles — apply the one matching the production's type, on top of §A

Each profile sets the **arc**, the **beat/feature expectation**, the **close**, and the **length target within the §A4 band**. If the production's type isn't listed, pick the nearest and say so; do not invent a stricter rule than the type warrants.

### B-launch — product/feature launch or announcement
- **Arc:** hook → (problem, only if the audience is cold / the category is unknown) → product reveal → **2–4 hero features, not a list** → proof → CTA. Feature-dumping is the single most common failure; more than 4 "here's another thing" beats = revise.
- **Proof:** capability-proof with the one strongest specific number/receipt, framed big (§A1/A2).
- **Close — on-screen CTA REQUIRED and scored:** end on an explicit in-frame ask (a labeled action like a "Start free" pill, or a concrete next step), held readable to the end. A bare end-URL or a soft tagline with no ask is a fail — the beat most videos get lazy on, and exactly the beat that converts.
- **Length:** 16:9 hero 30–90s · 9:16 ≤ ~15s.

### B-demo — product / feature demo (show one capability end-to-end)
- **Arc:** hook (in-product) → one real end-to-end flow (set-up → action → result) → brief "and it also…" (optional, ≤2) → close. Lead with ONE flow shown fully, not a feature tour.
- **Proof:** the proof *is* the flow — the real artifact produced/changed on screen, legibly (a rendered result, a confirmed state). This is the type's spine, not a single beat.
- **Close:** a next step (where to start/try). An on-screen CTA is strong but a concrete next-step line is acceptable; a dead end is not.
- **Length:** teaser-to-hero band depending on flow length; don't pad between steps.

### B-teaser — withhold-and-reveal
- **Arc:** one hook → one reveal; withhold the full product/explanation. No feature list, no problem beat.
- **Proof:** optional/deferred — a teaser sells curiosity, not capability.
- **Close:** a **deferred** ask is correct ("Coming <when>", "Available now") — a hard CTA is NOT required and often wrong for the register.
- **Length:** 15–40s; 9:16 shorter.

### B-explainer / tutorial — teach a method
- **Arc:** problem/question → the method in ordered steps → the result/payoff.
- **Proof:** each step shown on the real artifact; the payoff is the finished result.
- **Density:** may run higher than other types (it's instructional) but still ≤ §A4's 2.5 wps ceiling.
- **Close:** where to learn more / start. Signature move still applies (§A1) even in a utilitarian piece.
- **Length:** as long as the method needs, no longer; cut dead time between steps.

---

## How reviewers use this

1. Judge against the **ship test** above, at the level of a top studio — not "acceptable."
2. **Walk §A on every video** (frame craft, proof-legibly, the §3 tell cluster, legibility/pacing, sound). Then apply the **matching §B profile** for structure/arc/close/length. Judge the work against *both*. For **every** failure, name the specific beat/element, say what's wrong, and give the **concrete change that raises it** (the number to change, the element to scale, the default font to swap and to what-sourced-choice, the beat to cut). The job is to bump the work up, not just to grade it.
3. **Count the §A3 tell cluster explicitly. 2+ → revise** with sourced swaps named.
4. **"No weak board/cut passes."** With the redo budget set high, keep sending it back until it clears the bar. Passing mediocrity is the failure mode this bar exists to prevent.
