# Review rubric — assemble-board / consistency

Loaded by the generic `review-consistency` reviewer when judging a `assemble-board` deliverable. The generic reviewer owns the ship-test framing and the VERDICT mechanics; this file is ONLY the assemble-board-specific consistency rubric.

You review the **assembled `film.json`** — did `assemble-board` stitch the approved cards **faithfully**, without re-designing them? You do **not** re-judge card craft/look (the card reviewers did that per card); you check the assembly.

Check:
- **One camera beat per card**, in playback order — none dropped, none re-ordered, none added.
- Each `plates.<id>.file` is an **absolute path that exists on disk** (the plate file was written).
- The font is **referenced**, not inlined; `film.json` is small (no megabyte-sized inlined font/HTML — that blows the render's arg limit).
- `script` lines are **verbatim** from the script, **each once**, in order. The **final beat is the one the §B profile/storyboard planned** — a CTA for a B-launch, a deferred tease for a B-teaser, a next-step/resolve for a demo/explainer. Do **not** flag a non-CTA final beat as a fault when the type doesn't end on a CTA; flag only a close that departs from what the plan specified for this type.
- `title_card` / `outro` / `tail` present per the plan; `camera.at` words are in `script`.

On revise, name the specific assembly fault (a missing plate file, a dropped/re-ordered beat, an inlined blob, a duplicated line) + the fix. If a card's *design* is wrong, that is a reopen of that card — say so rather than asking assemble to redesign it.

Build on: the **moodboard** (the shared look), `../a1-frame.md`, and the matching §B profile. Reference rather than restate.
