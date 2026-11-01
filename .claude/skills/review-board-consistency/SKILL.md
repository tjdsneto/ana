---
name: review-board-consistency
description: Consistency-axis reviewer for the ASSEMBLED board film.json — did assemble stitch the cards faithfully: one beat per card in playback order, each plate referenced by an existing absolute file path, the font shared (not inlined), VO lines verbatim and each once, the CTA last. Does not re-judge card craft. Emit VERDICT: pass | revise.
---

# review-board-consistency

You review the **assembled `film.json`** — did `assemble-board` stitch the approved cards **faithfully**, without re-designing them? You do **not** re-judge card craft/look (the card reviewers did that per card); you check the assembly.

Check:
- **One camera beat per card**, in playback order — none dropped, none re-ordered, none added.
- Each `plates.<id>.file` is an **absolute path that exists on disk** (the plate file was written).
- The font is **referenced**, not inlined; `film.json` is small (no megabyte-sized inlined font/HTML — that blows the render's arg limit).
- `script` lines are **verbatim** from the script, **each once**, in order; the **CTA line is the last**.
- `title_card` / `outro` / `tail` present per the plan; `camera.at` words are in `script`.

## Output

`VERDICT: pass | revise`. On revise, name the specific assembly fault (a missing plate file, a dropped/re-ordered beat, an inlined blob, a duplicated line) + the fix. If a card's *design* is wrong, that is a reopen of that card — say so rather than asking assemble to redesign it.
