#!/usr/bin/env python3
"""Tests for score.summarize — the pure confusion-matrix + discrimination metrics of the E1 golden-set
eval. Run: python3 craft/video-production/evals/test_score.py (exit 0 pass / 1 fail), or under pytest."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from score import summarize  # noqa: E402


def test_counts_false_pass_and_false_fail():
    results = [
        {"id": "good-1", "expect": "pass", "verdict": "pass"},  # correct
        {"id": "good-2", "expect": "pass", "verdict": "revise"},  # FALSE FAIL (good graded bad)
        {"id": "bad-1", "expect": "revise", "verdict": "revise"},  # correct
        {"id": "bad-2", "expect": "revise", "verdict": "pass"},  # FALSE PASS (bad cleared the gate)
        {"id": "x", "expect": "pass", "verdict": "error"},  # not graded
    ]
    s = summarize(results)
    assert s["n"] == 5
    assert s["graded"] == 4
    assert s["errors"] == 1
    assert s["false_pass"] == 1 and s["false_pass_ids"] == ["bad-2"]
    assert s["false_fail"] == 1 and s["false_fail_ids"] == ["good-2"]
    # false_pass_rate is over the KNOWN-BAD only (1 of the 2 revise-expected); same for false_fail over good
    assert s["false_pass_rate"] == 0.5
    assert s["false_fail_rate"] == 0.5
    assert s["accuracy"] == 0.5  # 2 of 4 graded correct


def test_separation_when_scores_present():
    results = [
        {"id": "g1", "expect": "pass", "verdict": "pass", "score": 9.0},
        {"id": "g2", "expect": "pass", "verdict": "pass", "score": 8.0},
        {"id": "b1", "expect": "revise", "verdict": "revise", "score": 4.0},
        {"id": "b2", "expect": "revise", "verdict": "revise", "score": 2.0},
    ]
    s = summarize(results)
    assert s["separation"] == 5.5  # mean good 8.5 - mean bad 3.0
    assert s["false_pass"] == 0 and s["false_fail"] == 0


def test_rates_none_when_no_examples_of_that_class():
    # a manifest with only PASS exemplars can't compute a false-pass rate (no known-bad) — must be None,
    # not 0, so the harness reports "you have no known-bad; the eval cannot measure false-pass yet".
    results = [{"id": "g1", "expect": "pass", "verdict": "pass"}]
    s = summarize(results)
    assert s["false_pass_rate"] is None
    assert s["false_fail_rate"] == 0.0


if __name__ == "__main__":
    import traceback

    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    failed = 0
    for t in tests:
        try:
            t()
            print(f"  ok  {t.__name__}")
        except Exception:
            failed += 1
            print(f"  FAIL {t.__name__}")
            traceback.print_exc()
    print(f"SCORE {'OK' if not failed else 'FAIL'} ({len(tests) - failed}/{len(tests)})")
    sys.exit(1 if failed else 0)
