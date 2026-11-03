# Composed cards — how to build a premium board without a real UI to capture

This is the **HOW** behind `craft/video-production/.claude/references/CRAFT-BAR.md` for the composed/generative path (keyless inline-HTML cards, no site to capture). It exists because "aim higher" is not enough — the producer needs concrete, premium, imitable patterns. Everything here is brand-free and sourced from teardowns of real, high-reach launch videos. Build to it; the storyboard quality reviewer judges the rendered board against it.

Hard mechanical fact that shapes everything: **the render screenshots each plate as a single still**, then moves a camera over it. So a composed card is one still frame. In-card CSS animation is NOT captured. **Motion comes from the camera and from SEQUENCING PLATES**, not from animating one card — see §3.

## 1. Source the look before you build a single card (no defaults)

Decide six fields, each traced to THIS brand's own material (its product, palette, era, audience, real content) — not "clean/modern." This is the moodboard's job; if it gave you a look, apply it; if a field is a default, fix it here.

- **Ground · Palette · Type · Layout primitive · Surface · Signature.**
- **Font is the most common tell.** If the typeface wasn't chosen *for this brand*, it's AI slop. Do NOT reach for Inter, Roboto, Open Sans, Helvetica, Montserrat, Poppins, system-ui, or the "distinctive" defaults that are now just as tired — Space Grotesk, Geist, DM Sans, Plus Jakarta, Manrope, **Outfit**, Syne, Instrument Sans/Serif, Fraunces, Playfair. Pick a face with a reason tied to the brand; name the reason.
- **Flat over gradient.** The premium move is a **flat, saturated colour field**, not radial/linear gradients. "Gradients everywhere" is the single biggest AI tell. A faint single vignette is the most you use.
- **Swap test:** put a different product's name on your look — if it still fits, it's generic; redo it.
- **Count tells (CRAFT-BAR §3):** gradients-everywhere + a rounded-card-for-everything + one-bright-accent-on-dark + a default font = a 4-tell cluster = slop. Keep to 0–1.

## 2. Compose each card so the subject DOMINATES — inside a safe area, with room to breathe

Two failures get boards rejected, and they are opposites. Guard against BOTH:

1. **Dead space** — a big empty ring/band/gradient with the real content tiny in a corner.
2. **Overfill** — the content jammed edge to edge, type so big it fills all four edges with no margin (a wall of text, five lines touching the frame). This reads as amateur, and it is what a long line becomes when you refuse to scale the type.

The fix is the same discipline for both: a dominant subject **set inside a safe area**.

- **Ground full-bleed, content inside a safe area.** The flat colour ground covers the whole 1920×1080 frame (no letterbox of empty ground). But the *content* — text, subject, accent — lives inside a **safe area with a ≥ ~8–10% margin on all four sides** (≈150–190px). Nothing readable touches or bleeds past that safe edge. Full-bleed is the *background*, not the words.
- **Type scales to fit — never a fixed giant size.** Choose the type size so the on-screen text sits in the safe area on **~1–3 lines with clear breathing room** between it and the edges. A long line means **smaller type or fewer words**, never overflow. Do not set a fixed 80px+ headline and let a 17-word sentence wrap to five edge-to-edge lines.
- **On-screen text is usually a FOCAL PHRASE, not the whole VO line.** The full sentence is *spoken*; the card shows the few words the beat lands on (the hook, the pivot, the number). Whether a card shows a focal phrase or the full line is decided **at the production level** by the storyboard (per beat) — build the card to the treatment its spec names, and keep the safe area + breathing room either way.
- **One idea per card.** One headline, or one chart, or one number — never a busy dashboard. Large, set left or centre, within the safe area.
- **Dominance is bounded.** The focal element is clearly the largest, most important thing and reads instantly — but "dominant" means it commands the safe area, not that it overflows the frame. Dead-space-tiny = revise; edge-to-edge-crammed = revise.
- **Hierarchy:** one hero element; labels/annotations are small-caps, tracked, and clearly secondary. Exactly one accent per card at most.
- **Legible receipts.** A number that is the proof (a metric, a result) gets its **own card**, big and alone in the safe area — not a footnote on a busy frame, and not stretched wall-to-wall.

## 3. Motion = the camera + a SEQUENCE of plates (not one animated card)

Because each plate is a still, express every "animation" as successive plates the camera cuts/pushes between:

- **Reveal in steps.** A thing building up = plate A (empty) → plate B (half) → plate C (full), as separate beats. A line drawing on = three plates of it progressively drawn. Do NOT put the whole end-state on one plate and zoom around it — that spoils the payoff and reads static.
- **Morphing element.** The signature "pill that swaps its label/icon" = one plate per state (state 1 label, state 2 label), cut on the beat. Cheap, premium, recognizable.
- **Colour-per-beat is the transition.** Give each section its own flat ground colour; the change of colour between beats carries the motion and segments the story. This alone lifts a board out of slideshow.
- **Camera with intent.** A gentle push-in or a settle that lands the subject — tied to the VO word. Not a slow aimless drift over a static card.
- **No near-duplicate beats.** If two beats would look nearly identical (same card, slightly different zoom, a line repeated), cut one. Repetition to pad runtime is the slideshow tell.

## 4. Reusable premium card templates (pick + source to the brand)

Each is a concrete, imitable move from a real launch video. Choose a few; make one your **signature**.

- **Single-idea title/payoff card** — one sentence, heavy weight, tight tracking, on a flat ground. The hook or the close.
- **Morphing-pill "breadth" hook** — a chip that cycles real options inside your own sentence (sequence of plates). Shows range without a list.
- **In-product "one real action" hook** — a single plate of the product mid-action (the real question typed, the real thing triggered), cut just before the result. One plate, not a tour.
- **Metric-hero shot** — the single strongest number, full-frame, its own beat.
- **Receipt / proof card** — the artifact's actual output (a result, a list of sources, a diff), legible, as the capability-proof beat.
- **Colour-per-beat section grounds** — each beat a distinct flat saturated field; the colour IS the cut.
- **Monospace "NEW ___ / COMING ___" drumroll outro** — a fixed two-line card, hard-cut on the beat (for a teaser close).
- **Two-symmetric-panels + one-word pivot** — before/after or them/you, pivoting on a single word.
- **Explicit CTA card (REQUIRED close)** — a labelled action (a "Start free" pill, a concrete next step), held readable to the end. Never a bare URL or a soft tagline.

## 5. Before you output

- Render the board (`site-capture.mjs --spec film.json` then `storyboard-board.py`) and LOOK at every card. The subject dominates **inside a safe area with breathing room** (no text touching the edges, no five-line wall)? Flat not gradient? 0–1 tells? Every beat distinct? A real CTA card? A signature move present? If any card reads as a cramped wall of text, that is a reject — fix the card HTML / camera and re-render; do not ship it to the reviewer to catch.
