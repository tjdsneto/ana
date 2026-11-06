---
name: assemble-board
description: Assemble the final film.json from the approved cards — materialize each card's plate file + the one shared font into the board dir, compose the beats/camera/VO in playback order, referencing the plate files by absolute path. Does not generate or edit cards; stitches what exists. Produces the film.json the render consumes.
---

# assemble-board

> ## Hold to the craft bar
> Read `craft/video-production/.claude/references/CRAFT-BAR.md` (§A + the §B profile) and `craft/video-production/.claude/references/COMPOSED-CARDS.md`. Judged against both.

You assemble the finished board's `film.json` from the **approved cards** (one per beat, already reviewed) + the **script** + the **moodboard**. You do **not** create or edit cards — you stitch what the card nodes produced, in playback order.

> **Output contract:** the `film.json` keys, the time formats (seconds or VO-word anchors), and the `audio` / `camera` / `plates` / `theme` shapes are documented in `schema.json` beside this skill, with a valid board in `example.json` — conform your output to it.

## Inputs

- The approved **cards** (each a JSON object `{id, vo_line, camera, plate_html}`) — staged in playback order under `<workDir>/cards/` as `NN-<name>.<ext>` (`01-…`, `02-…`, …). Read them **in that order** — the `NN` prefix IS the beat order. One file per card; they are not inlined in the prompt.
- The **script** — the VO lines, in order.
- The **storyboard** (in upstream) — its **sound plan (§A5)**: the board's music-bed feel and each beat's `SOUND/SFX` cue. You compose these into the film.json `audio` block (step 2) — the storyboard plans the sound, you wire it.
- The **moodboard** — the voice (id/speed), the sourced font, the look.
- The **board directory** — given in the prompt under "Shared board dir" (`<…>/board`). Write the shared files AND your output `film.json` there.

## Steps

1. For each card, write its `plate_html` to `<boardDir>/plates/<id>.html`. If a card's `@font-face` points anywhere else, rewrite it to `<boardDir>/fonts/<name>.woff2`. Stage the one sourced font once at `<boardDir>/fonts/<name>.woff2`, resolving it in this order (issue 0017 / `docs/lisa/font-resolution.md`): **(a)** the moodboard's declared **primary** face when its file is present in the font store — `craft/video-production/assets/fonts/<Face>.woff2` (or `.ttf`) — copy it into `<boardDir>/fonts/`; **(b)** otherwise the moodboard's declared **substitute** (a free, sourced webfont), `@font-face`d by its real `src` URL and cached into `fonts/` when fetchable. Never fabricate a font and never fall back to a system face: a missing licensed primary degrades to the declared substitute (a provisioning gap, not a quality fail) and must not block the render.
2. Compose `film.json`:
   - `voice`: `{id, speed, lead, gap}` from the moodboard. If the moodboard named no voice, default `id: "rachel"` (the ElevenLabs default) — never leave it unset, or it falls back to a local-engine voice id.
   - `script`: the VO lines in order, **verbatim, each once**. Keep the close the storyboard planned for this video's §B type — a B-launch ends on its CTA line, a B-teaser on a deferred tease, a demo/explainer on its next-step/resolve. Do **not** force a CTA to the end if the plan doesn't end on one.
   - `plates`: `{ "<id>": { "file": "<ABSOLUTE path to <boardDir>/plates/<id>.html>", "steps":[{"wait":300}] } }` for every card.
   - `camera`: one beat per card, `{plate:"<id>", focus, zoom, at:"<word>"}`, from each card's `camera`, in playback order.
   - `music` (top-level field): the bed, from the board's music-feel — a `mood` word (`music.py` resolves it to a ducked bed file at render) or a provided `src` path. Setting this is what gives the render a bed at all; `mix.py` ducks it under the voice automatically.
   - `audio`: the `{sfx}` plan that wires §A5's per-beat hits into the render — **an absent `audio.sfx` makes `build.py` fall back to 3 generic default cues, so the storyboard's signature-beat sound never ships.** Build it from the storyboard's sound plan:
     - `sfx`: `[{cue, at, gain?}]` — one entry per beat the storyboard marked with a `SOUND/SFX` cue, `cue` from `click·tick·pop·hit·whoosh·swish`, `at` the cue's VO-word anchor (or timecode). `build.py` resolves each `at` to seconds into `src/audio-plan.json`; `mix.py` sums them. Carry every marked beat; leave quiet beats quiet.
     - (Add an `audio.music` track only when you already have a concrete bed FILE — `mix.py` drops a `music` entry with no `src`, so a mood goes in the top-level `music` field above, not here. Add an `audio.voice` entry only for an external narration clip; the normal VO comes from `script` + synthesis.)
   - `title_card` / `outro` / `tail` per the storyboard plan.
   - Use **absolute** plate paths so the render's site-capture resolves them from any work dir.
3. **Write** the composed `film.json` (valid JSON) to the FILE `<boardDir>/film.json`. That file IS your artifact — the engine captures it directly (not your chat reply), and the render consumes it. Write it to the file; do not only print it.

## Rules

- **Never inline** the font or the plate HTML into `film.json` — reference the files (keeps film.json small; avoids the spawn-arg blowup a megabyte-sized film.json caused before).
- Do not re-order or drop a card; do not rewrite a card's design (that is the card node's job + its reviewers'). If a card is wrong, that is a reopen of that card, not an edit here.
- Every script line appears once, in the storyboard's playback order. The final beat is whatever the §B profile/storyboard planned (CTA for B-launch, a deferred tease for B-teaser, a next-step/resolve for demo/explainer) — do not hardcode the CTA as the last beat.
- Carry the storyboard's planned sound into `audio` exactly: every marked SFX beat gets its cue, quiet beats stay quiet. Never invent a cue the board didn't plan, and never hand-fake an audio file — declare the music by `mood`/`src` and let the render resolve it. If a cue's anchor word isn't in the script, drop that cue and note it rather than guessing a timecode.
