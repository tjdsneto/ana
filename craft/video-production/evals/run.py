#!/usr/bin/env python3
"""run — the E1 golden-set eval runner. For each entry in golden-set.json: locate the video, grade it
against CRAFT-BAR + the north-star 8-check, compare the grader's verdict to the human `expect` label,
and report whether the grader discriminates (score.summarize).

This is the harness that turns "the reviews don't lift quality" from an argument into a number. Run it
whenever you change the bar or a reviewer — if the false-pass rate goes up, the change regressed the
grader (the calibration loop, E1 -> CI).

Usage:
  # structure/plumbing check — no videos or `claude` needed; simulates a PERFECT grader (verdict=expect):
  python3 craft/video-production/evals/run.py --fake
  # simulate a BROKEN grader to prove false-pass is counted (every verdict = "pass"):
  python3 craft/video-production/evals/run.py --fake --fake-verdict pass
  # real calibration (needs the videos staged + a `claude` binary + keys): grade each video for real:
  python3 craft/video-production/evals/run.py --videos-root /path/to/research --frames 12

The real grader path (ffmpeg frame extraction -> claude -p) is wired but NOT verified in this scaffold;
`--fake` is the proven path. Start real calibration once the golden set's `expect` labels are confirmed.
"""
import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
# research/ lives at the am-videos project root: evals -> video-production -> craft -> repo -> am-videos.
DEFAULT_VIDEOS_ROOT = HERE.parents[3].parent / "research"
CRAFT_BAR = HERE.parent / ".claude" / "references" / "CRAFT-BAR.md"


def load_manifest(path: Path) -> list[dict]:
    doc = json.loads(path.read_text())
    return doc.get("entries", [])


def grade_fake(entry: dict, forced: "str | None") -> dict:
    # A perfect grader returns the label; a forced verdict simulates a biased/broken grader so the
    # harness's false-pass/false-fail accounting can be exercised without videos or `claude`.
    verdict = forced or entry.get("fake_verdict") or entry["expect"]
    return {"id": entry["id"], "expect": entry["expect"], "verdict": verdict}


def extract_frames(video: Path, out_dir: Path, n: int) -> list[Path]:
    # Deterministically sample n frames across the whole clip, so the grader is HANDED the output to look
    # at rather than trusted to extract it itself (E2). Needs ffmpeg/ffprobe on PATH.
    dur = float(
        subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(video)],
            capture_output=True, text=True, check=True,
        ).stdout.strip()
    )
    frames = []
    for i in range(n):
        t = dur * (i + 0.5) / n
        f = out_dir / f"frame_{i:02d}.jpg"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{t:.3f}", "-i", str(video), "-frames:v", "1", str(f)], check=True)
        frames.append(f)
    return frames


def grade_real(entry: dict, video: Path, frames_n: int, model: "str | None") -> dict:
    # Best-effort real grader (UNVERIFIED in this scaffold): extract frames, then ask `claude -p` to judge
    # them against the bar and the north-star 8-check, returning VERDICT: pass | revise.
    with tempfile.TemporaryDirectory() as d:
        try:
            frames = extract_frames(video, Path(d), frames_n)
        except Exception as e:  # noqa: BLE001
            return {"id": entry["id"], "expect": entry["expect"], "verdict": "error", "note": f"frame extraction failed: {e}"}
        bar = CRAFT_BAR.read_text() if CRAFT_BAR.exists() else "(CRAFT-BAR.md not found)"
        prompt = (
            "You are the final whole-video grader. You have been given frames sampled across a finished "
            "video (read every one with the Read tool — a verdict without looking is invalid) and its brief.\n\n"
            f"## Brief\n{entry.get('brief', '')}\n\n## Frames\n" + "\n".join(str(f) for f in frames) + "\n\n"
            f"## The bar\n{bar}\n\n"
            "Judge against the bar + the 8-check north-star rubric. Output EXACTLY one line: `VERDICT: pass` "
            "or `VERDICT: revise`, then a one-line reason citing a frame."
        )
        args = ["claude", "-p", "--output-format", "json", "--permission-mode", "bypassPermissions"]
        if model:
            args += ["--model", model]
        try:
            res = subprocess.run(args, input=prompt, capture_output=True, text=True, timeout=600)
            out = json.loads(res.stdout).get("result", res.stdout)
        except Exception as e:  # noqa: BLE001
            return {"id": entry["id"], "expect": entry["expect"], "verdict": "error", "note": f"grader call failed: {e}"}
    low = out.lower()
    verdict = "pass" if "verdict: pass" in low else "revise" if "verdict: revise" in low else "error"
    return {"id": entry["id"], "expect": entry["expect"], "verdict": verdict, "note": out[:200]}


def main() -> int:
    ap = argparse.ArgumentParser(description="E1 golden-set eval runner")
    ap.add_argument("--manifest", default=str(HERE / "golden-set.json"))
    ap.add_argument("--videos-root", default=str(DEFAULT_VIDEOS_ROOT))
    ap.add_argument("--frames", type=int, default=12, help="frames sampled per video for the real grader")
    ap.add_argument("--model", default=None, help="grader model (e.g. claude-opus-5-5); default = claude cli default")
    ap.add_argument("--fake", action="store_true", help="simulate the grader (no videos / no claude) — structure check")
    ap.add_argument("--fake-verdict", default=None, choices=["pass", "revise"], help="force every fake verdict (simulate a broken grader)")
    ap.add_argument("--out", default=None, help="write the raw results json here")
    a = ap.parse_args()

    sys.path.insert(0, str(HERE))
    from score import format_report, summarize

    entries = load_manifest(Path(a.manifest))
    root = Path(a.videos_root)
    results = []
    for e in entries:
        if a.fake:
            results.append(grade_fake(e, a.fake_verdict))
            continue
        video = root / e["video"]
        if not video.exists():
            results.append({"id": e["id"], "expect": e["expect"], "verdict": "error", "note": f"not staged: {video}"})
            continue
        results.append(grade_real(e, video, a.frames, a.model))

    summary = summarize(results)
    print(format_report(summary))
    if a.out:
        Path(a.out).write_text(json.dumps({"results": results, "summary": summary}, indent=2))
    # Exit non-zero when a known-bad slipped through — so the eval can gate CI (the calibration loop).
    return 1 if summary["false_pass"] > 0 else 0


if __name__ == "__main__":
    raise SystemExit(main())
