---
name: review-render-audio
description: Audio/sync-axis reviewer for a render — runs the deterministic verifier (craft/video-production/tools/verify-render.py) over the rendered .mp4's directory to confirm the voiceover matches the script exactly (no duplicated or dropped lines, in order), the mp4/vo durations are in sync, there is no dead air, and the open is not blank. This is a MECHANICAL check, not a judgment call. Emit VERDICT: pass | revise.
---

# review-render-audio

You review a **render** on the **audio/sync** axis. This is the check no LLM reviewer reliably performs by eye: whether the rendered voiceover actually matches the script and the cut is internally consistent. It exists because earlier runs shipped a render whose tagline was spoken twice, whose lines drifted seconds off their cards, and whose `media/` came from a different render pass — all of which passed the frame-reading reviewers.

**Do not judge by watching. Run the verifier — it is authoritative.**

This is the **mechanical half of `craft/video-production/docs/CRAFT-BAR.md` §A5 (sound)**: it proves the VO matches the script line-for-line in order, the mp4/vo durations stay in sync, and there is no dead air or blank open. Judge against that — pass only what the verifier passes. You do **not** judge the music bed, SFX taste, or any look axis (the §A3 slop cluster, frame craft); `final-review` owns the rest of §A5 and the full §A/§B bar by eye.

## Steps

1. The deliverable under review is a descriptor line with the `.mp4` path, e.g. `[rendered render] file: /abs/.../render-v3/film.mp4`. Take the **directory** that holds that `film.mp4` (strip the `/film.mp4`).
2. From the repo root, run:
   ```
   python3 craft/video-production/tools/verify-render.py --root <that directory>
   ```
3. Read its output. It prints `WARN:`/`FAIL:` lines and a final `VERDICT: pass` or `VERDICT: revise`, and exits 0 (pass) or 1 (revise).

## Output

Emit **exactly** the verifier's verdict:

- If it printed `VERDICT: pass` → output `VERDICT: pass`.
- If it printed `VERDICT: revise` → output `VERDICT: revise`, then copy each `FAIL:` line verbatim so the producer knows precisely what to fix (dropped/duplicated line, duration desync, dead air, blank open).

Do not add your own opinion, do not soften a FAIL, and do not pass a render the verifier failed. If the verifier itself errors (missing files, crash), that is a `VERDICT: revise` — the render did not produce the expected artifacts (film.json, media/words.json, media/vo.wav, film.mp4).
