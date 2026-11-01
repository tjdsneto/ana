# Composed cards — how to build a premium board without a real UI to capture

This is the **HOW** behind `craft/CRAFT-BAR.md` for the composed/generative path (keyless inline-HTML cards, no site to capture). It exists because "aim higher" is not enough — the producer needs concrete, premium, imitable patterns. Everything here is brand-free and sourced from teardowns of real, high-reach launch videos. Build to it; the storyboard quality reviewer judges the rendered board against it.

Hard mechanical fact that shapes everything: **the render screenshots each plate as a single still**, then moves a camera over it. So a composed card is one still frame. In-card CSS animation is NOT captured. **Motion comes from the camera and from SEQUENCING PLATES**, not from animating one card — see §3.

## 1. Source the look before you build a single card (no defaults)

Decide six fields, each traced to THIS brand's own material (its product, palette, era, audience, real content) — not "clean/modern." This is the moodboard's job; if it gave you a look, apply it; if a field is a default, fix it here.

- **Ground · Palette · Type · Layout primitive · Surface · Signature.**
- **Font is the most common tell.** If the typeface wasn't chosen *for this brand*, it's AI slop. Do NOT reach for Inter, Roboto, Open Sans, Helvetica, Montserrat, Poppins, system-ui, or the "distinctive" defaults that are now just as tired — Space Grotesk, Geist, DM Sans, Plus Jakarta, Manrope, **Outfit**, Syne, Instrument Sans/Serif, Fraunces, Playfair. Pick a face with a reason tied to the brand; name the reason.
- **Flat over gradient.** The premium move is a **flat, saturated colour field**, not radial/linear gradients. "Gradients everywhere" is the single biggest AI tell. A faint single vignette is the most you use.
- **Swap test:** put a different product's name on your look — if it still fits, it's generic; redo it.
- **Count tells (CRAFT-BAR §3):** gradients-everywhere + a rounded-card-for-everything + one-bright-accent-on-dark + a default font = a 4-tell cluster = slop. Keep to 0–1.

## 2. Compose each card so the subject OWNS the frame

The failure that gets boards rejected: a big empty ring/band/gradient with the real content tiny in a corner. Fix it structurally:

- **One idea per card.** One headline, or one chart, or one number — never a busy dashboard. Large, set left or centre.
- **The focal element fills ≥ ~50% of the frame.** If you draw a ring/shape, the content inside it IS the subject and is large; the ring is a thin accent, not a giant empty hoop. Size elements for how the camera frames them (a 1.0 zoom means the card as-drawn is the frame — so draw it full-bleed, not floating in margins).
- **Hierarchy:** one hero element; labels/annotations are small-caps, tracked, and clearly secondary. Exactly one accent per card at most.
- **Fill edge to edge.** No constant border of empty ground on all sides. Negative space is deliberate and asymmetric, never a letterbox of nothing.
- **Legible receipts.** A number that is the proof (a metric, a result) gets its **own full-frame card**, big — not a footnote on a busy frame.

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

- Render the board (`site-capture.mjs --spec film.json` then `storyboard-board.py`) and LOOK at every card. The subject dominates? Flat not gradient? 0–1 tells? Every beat distinct? A real CTA card? A signature move present? If not, fix the card HTML / camera and re-render — do not ship it to the reviewer to catch.
