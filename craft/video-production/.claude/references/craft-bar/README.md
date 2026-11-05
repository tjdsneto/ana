# craft-bar/ — the quality bar, sliced for linking

`CRAFT-BAR.md` (one level up) stays the **canonical, hand-edited source of truth** — the full premium standard, read whole by the producers and the whole-video final review. This directory holds it cut into **addressable chunks** so a step can link *only* the part it needs instead of the whole 84-line doc.

Two kinds of chunk live here:

- **Slice-chunks** (`00-preamble.md`, `a1-frame.md` … `a5-sound.md`, `b-launch.md` … `b-explainer.md`, `how-reviewers-use.md`) are **generated** from `CRAFT-BAR.md` by `tools/craft-bar/split.py` — each is a byte-exact contiguous slice, so concatenating them in order reproduces the source. **Never hand-edit a slice-chunk**; edit `CRAFT-BAR.md` and re-run `python3 tools/craft-bar/split.py`. `split.py --check` asserts the chunks are in sync and is a cheap pre-commit / CI gate against drift.
- **Per-deliverable rubrics** (`deliverable-*.md`) are **hand-authored addenda**, not slices of `CRAFT-BAR.md`. Each names the grading criteria that deliverable owns — a moodboard's ground·palette·type·layout·surface·signature + swap test, a script's hook·density·close — so the criteria aren't buried in one long doc. They link the §A/§B slices they build on rather than duplicating them. `split.py` leaves them untouched.

## Who links what

- **Producers** keep reading `CRAFT-BAR.md` whole (§A + their §B profile) for now. The produce-time strip — a producer linking only the guardrail slice (`a2-proof.md` grounding + `a3-slop.md`) and dropping the taste-rubric — is **per-step and gated behind round-2** (issue 0018): moodboard needs the anti-slop guardrail at produce, script does not, so it is not applied blind here.
- **Axis reviewers** link their axis slice + the matching `deliverable-*.md`, branching on the deliverable type. The reviewer-collapse (21 near-duplicate review skills → 4 generic axis reviewers) consumes these chunks.
- **Each production** links the one `b-*.md` profile matching its video type, on top of §A.

## Map

| Chunk | What |
|------|------|
| `00-preamble.md` | the ship test + how to read §A vs §B |
| `a1-frame.md` … `a5-sound.md` | the five universal-taste axes (frame · proof · anti-slop · pacing · sound) |
| `b-launch.md` · `b-demo.md` · `b-teaser.md` · `b-explainer.md` | the per-type structure profiles (arc · beats · close · length) |
| `how-reviewers-use.md` | the reviewer procedure (ship test, walk §A, count the §A3 cluster) |
| `deliverable-script.md` · `-moodboard.md` · `-storyboard.md` · `-plan-scenes.md` · `-brainstorm.md` | per-deliverable grading criteria (hand-authored) |
