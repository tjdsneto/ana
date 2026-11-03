---
name: assemble-board
description: Assemble the final film.json from the approved cards — materialize each card's plate file + the one shared font into the board dir, compose the beats/camera/VO in playback order, referencing the plate files by absolute path. Does not generate or edit cards; stitches what exists. Produces the film.json the render consumes.
---

# assemble-board

> ## Hold to the craft bar
> Read `craft/video-production/docs/CRAFT-BAR.md` (§A + the §B profile) and `craft/video-production/docs/COMPOSED-CARDS.md`. Judged against both.

You assemble the finished board's `film.json` from the **approved cards** (one per beat, already reviewed) + the **script** + the **moodboard**. You do **not** create or edit cards — you stitch what the card nodes produced, in playback order.

## Inputs

- The approved **cards** (each a JSON object `{id, vo_line, camera, plate_html}`) — staged in playback order under `<workDir>/cards/` as `NN-<name>.<ext>` (`01-…`, `02-…`, …). Read them **in that order** — the `NN` prefix IS the beat order. One file per card; they are not inlined in the prompt.
- The **script** — the VO lines, in order.
- The **moodboard** — the voice (id/speed), the sourced font, the look.
- The **board directory** — given in the prompt under "Shared board dir" (`<…>/board`). Write the shared files AND your output `film.json` there.

## Steps

1. For each card, write its `plate_html` to `<boardDir>/plates/<id>.html`. If a card's `@font-face` points anywhere else, rewrite it to `<boardDir>/fonts/<name>.woff2`. Place the sourced font file once at `<boardDir>/fonts/<name>.woff2` (if it is not available offline, note that and let the plates fall back to the moodboard's fallback face — do not fabricate a font).
2. Compose `film.json`:
   - `voice`: `{id, speed, lead, gap}` from the moodboard.
   - `script`: the VO lines in order, **verbatim, each once**. Keep the close the storyboard planned for this video's §B type — a B-launch ends on its CTA line, a B-teaser on a deferred tease, a demo/explainer on its next-step/resolve. Do **not** force a CTA to the end if the plan doesn't end on one.
   - `plates`: `{ "<id>": { "file": "<ABSOLUTE path to <boardDir>/plates/<id>.html>", "steps":[{"wait":300}] } }` for every card.
   - `camera`: one beat per card, `{plate:"<id>", focus, zoom, at:"<word>"}`, from each card's `camera`, in playback order.
   - `title_card` / `outro` / `tail` per the storyboard plan.
   - Use **absolute** plate paths so the render's site-capture resolves them from any work dir.
3. **Write** the composed `film.json` (valid JSON) to the FILE `<boardDir>/film.json`. That file IS your artifact — the engine captures it directly (not your chat reply), and the render consumes it. Write it to the file; do not only print it.

## Rules

- **Never inline** the font or the plate HTML into `film.json` — reference the files (keeps film.json small; avoids the spawn-arg blowup a megabyte-sized film.json caused before).
- Do not re-order or drop a card; do not rewrite a card's design (that is the card node's job + its reviewers'). If a card is wrong, that is a reopen of that card, not an edit here.
- Every script line appears once, in the storyboard's playback order. The final beat is whatever the §B profile/storyboard planned (CTA for B-launch, a deferred tease for B-teaser, a next-step/resolve for demo/explainer) — do not hardcode the CTA as the last beat.
