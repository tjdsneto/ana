# Review rubric — assemble / audio

Loaded by the generic `review-audio` reviewer when judging the rendered `assemble` deliverable's audio. The generic reviewer owns the VERDICT mechanics; this file is ONLY the audio-axis rubric.

You review the assembled render on the **audio/sync** axis — the check no LLM reviewer reliably performs by eye: whether the rendered voiceover actually matches the script and the cut is internally consistent. It exists because earlier runs shipped a render whose tagline was spoken twice, whose lines drifted seconds off their cards, and whose `media/` came from a different render pass — all of which passed the frame-reading reviewers. **Do not judge by watching — run the deterministic verifier; it is authoritative.** From the repo root, over the directory that holds the rendered `film.mp4` (strip the `/film.mp4` off the deliverable's `.mp4` path):

```
python3 craft/video-production/tools/verify-render.py --root <that directory>
```

It prints `WARN:`/`FAIL:` lines and a final verdict, and exits 0 (pass) or 1 (revise). If the verifier itself errors (missing files, crash), that is a revise — the render did not produce the expected artifacts (`film.json`, `media/words.json`, `media/vo.wav`, `film.mp4`). Pass only what the verifier passes.

Mechanical checks on the rendered audio:

- **VO matches the script line-for-line, in order** — every script line is spoken, once each, in order: no dropped, duplicated, or out-of-order line.
- **mp4 / vo durations stay in sync** — the cut is internally consistent, with no line drifting seconds off its card.
- **No dead air, and the open is not blank** — audio is present from the open, with no silent gap mid-cut.
- **No dead tail — no trailing silence after the last word.** Trailing silence is `duration − (last word's end)`; treat **> ~1.0s** as a dead tail (usually an un-trimmed voice `tail`, default **3.0s**), while a **~0.3–0.6s** tail is fine. Equivalently, the music/mix does not run on under a dead end card: the last `music` stop sits at/near the last beat and the master's duration is not materially longer than the VO's last word.
- **A ducked music bed is present** — music `gain` below **0 dB**, ducked under the voice; not a bare VO with true silence in the gaps.
- **Deliberate SFX on the key beats** — cuts, reveals, the hero number, the CTA — not a bare VO + music bed.
- **Master at −14 LUFS** — the mix target; not silent and not clipping.

Judge only the audio/sync axis. Do not judge whether the music "sounds good" or fits the vibe, SFX taste, or any look axis (the §A3 slop cluster, frame craft) — `final-review` owns the rest of §A5 and the full §A/§B bar by eye.

Build on: `../a5-sound.md`. Reference rather than restate.
