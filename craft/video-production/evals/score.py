#!/usr/bin/env python3
"""score — the pure metrics of the E1 golden-set eval: given graded results, say whether the grader
actually tells good from bad. A review step emits a verdict; an EVAL measures the verdict against a
known label. This is that measurement.

A result: {"id": str, "expect": "pass"|"revise", "verdict": "pass"|"revise"|"error", "score"?: float}.
  - expect  = the human-authored ground-truth label (the golden set owns this; it is NOT the grader's).
  - verdict = what the grader returned this run.
  - score   = optional 0-10 composite, if the grader emits one (enables the separation metric).

The headline is false_pass_rate: known-bad videos the grader let through. A high false-pass rate IS the
"the reviews don't lift quality" symptom — bad output clears the gate.
"""


def summarize(results: list[dict]) -> dict:
    graded = [r for r in results if r.get("verdict") in ("pass", "revise")]
    errors = [r for r in results if r.get("verdict") not in ("pass", "revise")]

    known_good = [r for r in graded if r["expect"] == "pass"]
    known_bad = [r for r in graded if r["expect"] == "revise"]

    false_pass = [r for r in known_bad if r["verdict"] == "pass"]  # bad cleared the gate — THE key failure
    false_fail = [r for r in known_good if r["verdict"] == "revise"]  # good sent back — cost + friction
    correct = [r for r in graded if r["expect"] == r["verdict"]]

    def rate(num: list, den: list) -> "float | None":
        # None (not 0) when there are no examples of that class — the eval cannot measure it yet.
        return None if not den else round(len(num) / len(den), 3)

    out = {
        "n": len(results),
        "graded": len(graded),
        "errors": len(errors),
        "error_ids": [r["id"] for r in errors],
        "correct": len(correct),
        "accuracy": rate(correct, graded),
        "false_pass": len(false_pass),
        "false_pass_rate": rate(false_pass, known_bad),
        "false_pass_ids": [r["id"] for r in false_pass],
        "false_fail": len(false_fail),
        "false_fail_rate": rate(false_fail, known_good),
        "false_fail_ids": [r["id"] for r in false_fail],
    }

    # separation: mean(good score) - mean(bad score). Only when scores are present on both classes. A
    # small/negative separation means the rubric does not discriminate — the root problem, made numeric.
    gs = [r["score"] for r in known_good if r.get("score") is not None]
    bs = [r["score"] for r in known_bad if r.get("score") is not None]
    if gs and bs:
        out["separation"] = round(sum(gs) / len(gs) - sum(bs) / len(bs), 3)

    return out


def format_report(summary: dict) -> str:
    lines = ["# E1 golden-set eval — grader discrimination", ""]
    lines.append(f"graded {summary['graded']}/{summary['n']}  (errors: {summary['errors']})")
    if summary["error_ids"]:
        lines.append(f"  not graded: {', '.join(summary['error_ids'])}")
    acc = summary["accuracy"]
    lines.append(f"accuracy: {acc if acc is not None else 'n/a'}")
    fp, ff = summary["false_pass_rate"], summary["false_fail_rate"]
    lines.append(f"FALSE-PASS rate (known-bad passed): {fp if fp is not None else 'n/a — no known-bad in set'}  {summary['false_pass_ids'] or ''}")
    lines.append(f"false-fail rate (known-good failed): {ff if ff is not None else 'n/a — no known-good in set'}  {summary['false_fail_ids'] or ''}")
    if "separation" in summary:
        lines.append(f"separation (mean good score - mean bad score): {summary['separation']}")
    else:
        lines.append("separation: n/a (graders emit no numeric score yet — binary verdict only; see E3)")
    return "\n".join(lines)
