# Structure contract — moodboard (what must be present)

The moodboard's **structure contract**: the slots the output MUST fill, independent of how well they're filled. This is the non-negotiable layer — it stays even when the taste rubric (sourcing reasons, anti-slop, swap test — `deliverable-moodboard.md` + `a3-slop.md`) is relaxed. Taste decides whether the six fields are *good*; structure decides whether they are *there*. A moodboard missing any of the six is incomplete regardless of taste.

All six fields must appear, each stated explicitly:

1. **Ground** — a named background surface/colour, with a hex.
2. **Palette** — at least three named hexes (background / text / one accent / a semantic hue or two), with one marked dominant.
3. **Type** — a named typeface with its weights and the one display role, PLUS font provisioning so the render can't deadlock: name where the primary comes from (a webfont URL or a licensed source) AND a declared substitute (a free, sourced, non-default face in the same class — a real webfont, never a system fallback). The plates list the primary first, then the substitute's real webfont `src`; a licensed primary that isn't staged degrades to the substitute, it does not block the board.
4. **Layout** — one named dominant layout primitive.
5. **Surface** — the finish/texture rule (how elements sit).
6. **Signature** — one named memorable device unique to THIS video.

Plus the output shape:

- The mood in one line, then the six fields above each stated (hexes, type stack + weights, layout primitive, surface rule, signature), each buildable — the storyboard must be able to turn it into inline-HTML cards directly.
- Approximate hexes/fonts tagged as approximate (tune on render); nothing invented as fact.
- The **voice** (carries into `film.json` `voice.id`): a voice id (friendly name `rachel`/`adam`/`antoni`/`domi` or a raw voice_id; default `rachel`) and a `speed` (≈0.95–1.05), with a one-line reason tied to the brand/audience.
