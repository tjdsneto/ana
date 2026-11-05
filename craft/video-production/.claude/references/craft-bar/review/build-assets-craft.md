# Review rubric — build-assets / craft (quality axis)

Loaded by the generic `review-craft` reviewer when judging a `build-assets` deliverable. The generic reviewer owns the ship-test framing, the VERDICT mechanics, and the §A3 tell-cluster count; this file is ONLY the build-assets-specific craft rubric.

You review the **build-assets** leaf: the set of assets the scenes will draw from. Unlike audio, images ARE reviewable — you can open a screenshot and see it — so this gate uses that: it checks coverage (nothing the storyboard needs is missing), that each captured plate is the real screen, not an error/blank/404 page (the failure that silently poisons every downstream scene), and that each asset you can see is not AI slop (§A3). For composed assets also judge against `craft/video-production/.claude/references/COMPOSED-CARDS.md`. You can open and VIEW the asset images — so on any asset you can actually see, apply the §A3 anti-slop clause (step 4). Only a genuinely un-viewable keyless spec escapes a pixel-level judgment.

**Pass by default. Only `revise` on a specific, fixable gap below.**

## Inputs

- The producer's output: the asset set (paths for plates/images, or specs for keyless generators).
- The approved **storyboard** (upstream) — its `assets` map names every asset the scenes need.
- The approved **moodboard** (upstream) — the look generated assets must match.

## Steps

1. **Coverage.** Every asset the storyboard's `assets` map declares is present in the output (a produced file or a precise keyless spec). A declared asset with neither → `revise` (`FAIL: asset <id> missing`).
2. **Plates are real screens.** For each captured plate image, **open it and look**: it shows the actual product UI, not an error page, a cookie wall, a blank/white frame, or a 404. A broken/blank/error plate → `revise` (`FAIL: plate <id> is not the real screen (<what you saw>)`).
3. **Generated specs complete.** Each keyless generated-asset entry names the generator + prompt + dimensions (enough to drop in unchanged). An under-specified entry → `revise` (`FAIL: asset <id> spec incomplete`).
4. **Anti-slop on assets you CAN see (§A3).** For each generated/composed asset you can open and look at (not the captured plates — step 2 judges those, and not un-viewable specs), apply the §A3 **tell cluster** (gradients-everywhere, a rounded-card-for-everything, one bright accent on a dark ground, hairline rules, emoji headings), the **swap test** (put another product's name on it — if it still fits, it is generic), and the **font-tell** (a tier-1 *or* tier-2 default face is a tell). Count the tells: **2+ → `revise`** naming the specific sourced swap (`FAIL: asset <id> reads as AI slop (<the tells you counted>); <the sourced change that fixes it>`). A single default font is itself the font-tell; swapping one default for another does not fix it.

Do NOT revise for polish you genuinely **cannot** see — an un-viewable keyless spec is judged on completeness (step 3), not taste — or for assets the storyboard did not ask for. But the "don't revise for un-renderable polish" waiver covers **only** the un-viewable: if you can open the asset, you MUST run the §A3 check in step 4 on it.

On revise, emit each `FAIL:` line verbatim (name the asset id and the exact gap) so the producer fixes precisely that.

Build on: `../a1-frame.md`, `../a3-slop.md`, and `../deliverable-build-assets.md` if it exists (it exists for: script, moodboard). Reference these slices rather than restating them.
