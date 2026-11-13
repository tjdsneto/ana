# Review rubric — polish / craft (quality axis)

Loaded by the generic `review-craft` reviewer when judging a `polish` deliverable. The generic reviewer owns the ship-test framing, the VERDICT mechanics, and the §A3 tell-cluster count; this file is ONLY the polish-specific craft rubric.

You review the **polish** pass on the **quality** axis — did the final tightening make the render better and break nothing? Polish operates on an approved render; judge the refinement itself.

You are a **narrow delta reviewer**: your axes are the ones polish touches — timing, caption legibility, and audio. Judge them against **§A4 (legibility & pacing — the dwell rule, captions readable, end on the last meaningful beat, no dead tail)** and **§A5 (sound — a bed under the VO, no dead gaps between lines, no silent tail)**. You do **not** re-judge the design's look: the **§A3 AI-slop tell cluster and the full §A + §B bar are `final-review`'s to walk** on the assembled video, not yours. Stay in your lane — flag a polish regression, not a storyboard or look decision that was already approved upstream.

## Rubric

- **Timing — dwell first, then trim.** Pacing is *read-time*, not clock-time. Every information beat must HOLD its fully-composed frame long enough to be read after its reveal completes — ≥1.5–2.0s on a single line/number, 2.5–3s on a multi-row/number beat (§A4 dwell). A beat that lands and immediately cuts is a rush = revise; **lengthen it, don't pass it.** Only trim *genuine dead air* (flat holds at joins where nothing new is being read) — never shorten a hold below read-time to hit a runtime. If the cut is tight, the fix is a longer total or a dropped beat, not faster beats. Nothing important clipped off.
- **Captions readable.** On-screen text is legible — size, contrast, placement — and no caption overflows, wraps badly, or overlaps the subject.
- **Audio right.** Levels land on target loudness, voiceover sits clearly over music/SFX, no clipping and no dead gaps between lines, no abrupt silent tail.
- **Rough edges gone.** The specific defects the render had are fixed, and the fix introduced no new artifact (a cut that now jumps, a level that now pumps).

On revise, name the specific defect and the concrete fix (timecode where useful). Judge the polish's craft; a polished cut that still drags or clips fails here.

Build on: `../a4-pacing.md` and `../a5-sound.md` (polish judges only the §A4 timing + §A5 audio delta; it defers §A3 and the full §A/§B to final-review). Reference rather than restate.
