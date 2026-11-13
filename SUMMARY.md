# SUMMARY — craft deterministic checks (0033 / 0049 / 0034)

Branch `tn/feat/0033-0049-0034-craft-checks`, off master `eafc8e8`. Three commits, one per issue. No merge, no push (repo has no remote). Engine stack never started — verification is `tsc -b` + `vitest run` (host Node 24.22.1) against synthetic fixtures; nothing live was rendered.

## Build / test status (whole repo, after all three commits)

- `npx tsc -b` -> exit 0 (clean).
- `npx vitest run` -> exit 0 — 20 files, 218 tests passed (baseline was 205; +13 new).
- `python3 craft/video-production/tools/craft-bar/split.py --check` -> OK, 13 slice-chunks in sync.

## 0033 — deterministic layout pre-check before the model reviewer — DONE (engine fully tested; renderer geometry emission live-deferred)

Generic dependency-free inspector over the renderer's own per-frame geometry at the holistic-review seam, BEFORE the Opus final-review. Any defect short-circuits into the existing REOPEN channel at zero model cost; clean/absent geometry falls through unchanged. Six checks: clipping, collision, never-settling, reveal-stops-short, low-contrast (WCAG AA), too-many-type-systems.

Files: engine/src/layout-inspect.ts (+ .test.ts), engine/src/typereg.ts (new precheck field), engine/src/loop.ts (dispatchHolisticReview + precheckGeometry), engine/src/loop.test.ts (short-circuit + fall-through tests), engine/types/final-review/type.json, craft/video-production/tools/render.mjs (--geometry-out), tools/make-film.sh (passthrough), docs/frame-geometry.md, skills/render-film/SKILL.md.

Not tested (needs live stack): render.mjs Playwright capture writing board/frames.json; hold/beat derivation on a real GSAP timeline.

## 0049 — mockup-fidelity (rendered UI vs supplied screenshot) — DONE (engine + scoring tested; PNG decode live-deferred)

Supplied UI screenshot is a LOCKED asset the build skills composite as-is; sibling deterministic check flags drift below 0.9.

Files: engine/src/image-similarity.ts (+ .test.ts), engine/src/layout-inspect.ts mockup-fidelity check (+ tests), craft/video-production/tools/mockup-diff.mjs, skills/build-card/SKILL.md, skills/build-scene/SKILL.md, docs/showing-a-web-app.md.

Not tested (needs imaging lib + real screenshots): mockup-diff.mjs PNG decode (exits cleanly when no lib present — live-deferred).

## 0034 — isolate Temporal + mechanical Craft as review axes — DONE (doc/rubric; no code)

final-review split: Structure & pacing -> Structure + Temporal; Visual craft -> Composition + mechanical Craft (8 dimensions). Temporal + mechanical Craft justified at timecodes; conformance cheap; mechanical cases deferred to 0033.

Files: skills/final-review/SKILL.md, references/CRAFT-BAR.md, references/craft-bar/* (regenerated via split.py; a1-a5 also absorb pre-existing canonical->slice drift predating this work), skills/review-craft/SKILL.md.

Validated vs research/consolidated/north-star.md: 8 dimensions map onto the 8-check rubric without conflict.

## What a human must still verify live (deferred)

1. 0033 geometry emission: real render with --geometry-out; confirm well-formed geometry, hold/beat on real beats, a clipped/low-contrast render reopens the right step.
2. 0033 reopenTarget hardcoded "scene" (matches scene lane + the issue's scene[n] example); board/card lane would want card/storyboard — per-lane target left for first live run. Wrong target degrades gracefully (wastes budget, then escalates).
3. 0033 maxTypeSystems default 2 (issue literal was ">1"); set to 2 to avoid false-positiving a display+body system — confirm/tune on real geometry.
4. 0049 fidelity decode + 0.9 threshold: wire mockup-diff.mjs with sharp/pngjs; confirm real fidelity values + threshold on real screenshots.
5. 0034 rubric behaviour: confirm reviewers justify Temporal + mechanical Craft harder on a live production.
