# Video-quality evals (E1 — golden-set calibration)

The review steps baked into the engine (the `review-*` skills + `final-review`) are **review steps, not evals**: an LLM says pass/revise, but nothing measures whether that verdict tracks real quality. This directory is the first **eval** — the harness that holds a graded reference corpus and measures whether the graders actually tell good from bad.

Why this exists: the baked-in reviews have not lifted output quality. E1 is step one — build it before tightening anything, because a stricter but un-calibrated grader just fails good work too.

## What's here

| File | What |
|---|---|
| `golden-set.json` | the reference corpus: videos + their **human** `expect` label (pass / revise) + the bar clause the label turns on. The labels are the ground truth — a human who watched the video sets them, never the grader. |
| `run.py` | runs a grader over the corpus, compares each verdict to `expect`, reports the discrimination metrics. Exits non-zero if any known-bad passed (so it can gate CI). |
| `score.py` | the pure metrics: false-pass rate, false-fail rate, accuracy, separation. `test_score.py` covers it. |
| `test_score.py` | `python3 test_score.py` (or pytest). |

## Run it

```bash
# structure check — no videos, no `claude` needed (simulates a perfect grader):
python3 craft/video-production/evals/run.py --fake
# prove the harness catches a bad grader (force every verdict to pass → the known-bad becomes a false-pass):
python3 craft/video-production/evals/run.py --fake --fake-verdict pass
# real calibration (needs the videos staged under --videos-root + a `claude` binary):
python3 craft/video-production/evals/run.py --videos-root /path/to/research --model claude-opus-5-5
```

## The headline metric: false-pass rate

**False-pass = a known-bad video the grader let through.** A high false-pass rate IS the "reviews don't lift quality" symptom — bad output clears the gate. Drive it to zero first. `false_fail` (good work sent back) costs money and friction but doesn't ship slop. `separation` (mean good-score − mean bad-score) needs scored graders (E3); until then the graders are binary and separation is n/a.

## The labels are the work

`expect` is human ground truth. The two PASS entries are the north-stars blessed in `research/consolidated/north-star.md`. The REVISE entries are **candidates** — confirm each by watching before you trust the false-pass number. Grow the set over time; it is a test suite, and every bar/skill change should re-run it (the calibration loop — wire into CI). If the eval can't yet reliably fail a known-bad and pass a known-good, no loop built on these graders will raise quality.

## Next (from the design doc, not built here)

- **E2** — make `final-review` verifiably watch the output (harness-extracted frames handed in + required citations; wire the `video-critic` grader in as the gate).
- **E3** — scored graders (per-axis 0–4 + composite + ship threshold) instead of binary pass/revise; mechanical clauses (slop-cluster count, length band) stay hard gates.
- **E4** — brief-delivery eval: auto-check each required brief item (one-message, CTA, proof) is actually on screen/in the VO.
- **E5** — independent/adversarial grader (fresh eyes, ideally a different model than the producer).
