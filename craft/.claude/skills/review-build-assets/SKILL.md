---
name: review-build-assets
description: Reviewer for the build-assets leaf — confirm the asset set covers every asset the storyboard declares, each captured real-UI plate is a real screen (VIEW the plate image — agents can see images), and each generated-asset entry is either a produced file or a precise keyless spec. Pass unless a specific, fixable gap is found. Emit VERDICT: pass | revise.
---

# review-build-assets

You review the **build-assets** leaf: the set of assets the scenes will draw from. Unlike audio, images ARE reviewable — you can open a screenshot and see it — so this gate uses that: it checks coverage (nothing the storyboard needs is missing) and that each captured plate is the real screen, not an error/blank/404 page (the failure that silently poisons every downstream scene).

**Pass by default. Only `revise` on a specific, fixable gap below.**

## Inputs

- The producer's output: the asset set (paths for plates/images, or specs for keyless generators).
- The approved **storyboard** (upstream) — its `assets` map names every asset the scenes need.
- The approved **moodboard** (upstream) — the look generated assets must match.

## Steps

1. **Coverage.** Every asset the storyboard's `assets` map declares is present in the output (a produced file or a precise keyless spec). A declared asset with neither → `revise` (`FAIL: asset <id> missing`).
2. **Plates are real screens.** For each captured plate image, **open it and look**: it shows the actual product UI, not an error page, a cookie wall, a blank/white frame, or a 404. A broken/blank/error plate → `revise` (`FAIL: plate <id> is not the real screen (<what you saw>)`).
3. **Generated specs complete.** Each keyless generated-asset entry names the generator + prompt + dimensions (enough to drop in unchanged). An under-specified entry → `revise` (`FAIL: asset <id> spec incomplete`).

Do NOT revise for subjective polish of a spec you cannot render, or for assets the storyboard did not ask for.

## Output

- All checks ok → `VERDICT: pass`.
- Otherwise → `VERDICT: revise` + each `FAIL:` line verbatim (name the asset id and the exact gap) so the producer fixes precisely that.
