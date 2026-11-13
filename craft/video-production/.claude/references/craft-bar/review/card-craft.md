# Review rubric — card / craft (quality axis)

Loaded by the generic `review-craft` reviewer when judging a `card` deliverable. The generic reviewer owns the ship-test framing, the VERDICT mechanics, and the §A3 tell-cluster count; this file is ONLY the card-specific craft rubric.

You review **one card** (its plate + camera) on the **quality** axis — is this a well-crafted card on its own? Independent of the spec (conformance) and the neighbours (consistency).

**Render the plate — don't judge HTML by eye.** Write the card's `plate_html` to a temp `.html` and screenshot it (a one-plate `film.json` through `node craft/video-production/tools/site-capture.mjs`, or any headless screenshot), then look.

Check:
- **Safe area + breathing room — both failure directions are a revise.** Content must sit inside a safe-area margin (~8–10% all sides) and dominate WITHIN it. (a) **Dead space** — a big empty ring/band/gradient with the real content tiny in a corner → revise (scale the subject up / raise zoom). (b) **Overfill** — text/subject jammed edge to edge, a fixed-huge type wrapping to a wall of 4–5 lines touching the frame with no margin → revise (scale the type DOWN / shorten to the focal phrase so it fits the safe area with room to breathe). A cramped wall of text reads as amateur; it is a reject, not a pass.
- **On-screen text matches the intended treatment.** If the card should show a short focal phrase but dumps the whole VO sentence (or shows a bare phrase where the full line was meant to be read), that's a **revise** — name the intended treatment.
- **Flat** ground, not gradients; one accent at most.
- **The sourced non-default font actually renders AND is not itself a default.** Two failures, both a revise: (a) it fell back to a **system/unspecified default** — a tier-1 face (Helvetica / Arial / Inter) or any serif the browser substituted when no webfont loaded — fix the `@font-face`/shared font; (b) it renders cleanly but in an **unspecified default** — tier-1 (Inter, Roboto, Open Sans, Lato, Arial, Helvetica, Montserrat, Poppins, system-ui) **or, just as much a tell now, tier-2: Space Grotesk, Geist, DM Sans, Plus Jakarta, Manrope, Outfit, Syne, Instrument, Fraunces, Playfair** (CRAFT-BAR §A3). A card set in, e.g., **Outfit** that renders perfectly is **NOT** a pass — call it and name a face sourced to the brand. Do not wave a card through just because its type is legible. **Exception — the declared substitute is a PASS:** if the moodboard names a primary brand font plus a *declared sourced substitute* (a non-default face, e.g. Museo Sans → Nunito Sans) and the card renders in that substitute because the licensed primary isn't staged, that is a **pass on this axis** — the substitute is a deliberate brand-appropriate fallback, not a tell. Revise only when it fell to an *unspecified* default/system serif, or when neither the primary nor the declared substitute loads. A licensed primary not being staged is a provisioning gap, not grounds to grind the card to the redo cap.
- Type readable; the §A3 tell cluster at **0–1**.
- **Slop ledger.** Check `craft/video-production/.claude/references/SLOP-LEDGER.md` and flag any tell it already lists (e.g. subject adrift in dead space).

On revise, name the **one** thing to change + the direction (the element to scale, the gradient to flatten, the font to fix) so the card node edits just that. Do not ask for a redesign.

Build on: `../a1-frame.md`, `../a3-slop.md`, and `../deliverable-card.md` if it exists (it exists for: script, moodboard). Reference these slices rather than restating them.
