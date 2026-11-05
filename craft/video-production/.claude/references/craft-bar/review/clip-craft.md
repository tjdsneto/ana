# Review rubric — clip / craft (quality axis)

Loaded by the generic `review-craft` reviewer when judging a `clip` deliverable. The generic reviewer owns the ship-test framing, the VERDICT mechanics, and the §A3 tell-cluster count; this file is ONLY the clip-specific craft rubric.

You review the **derived clip** the `edit-footage` leaf produced from a caller-provided asset. Judge the **edit**, not the source footage's own production value — did the cut select and assemble the right piece, cleanly? Perceive the real artifact: watch frames + listen, never a text proxy.

## What you're handed

The derived clip (`.mp4` / `.wav`), the EDL that produced it (the cut plan), and the brief. Build a watch package if needed (frame grabs + the audio) the same way the render reviewers do.

## Rubric

- **Right content.** The kept range(s) are the piece the brief asked for — nothing essential dropped, nothing unwanted left in.
- **Clean cuts.** Joins land on sensible boundaries: no clipped half-word, no black/garbage frame at a concat seam, no audio click. Total duration matches the sum of the intended ranges.
- **Framing (video).** A crop keeps the subject in frame and at a usable scale — not a sliver, not dead space.
- **Audio.** Intact and at a sane level (the selected span, channels/gain as the brief intends); no dropouts at the seams.

On revise, name the exact fix in EDL terms — which segment `in`/`out` to adjust, the crop to change, the audio tweak — so the producer can edit the EDL and re-apply without guessing. Timecode every problem.

Build on: `../a1-frame.md`, `../a3-slop.md`, and `../deliverable-clip.md` if it exists (it exists for: script, moodboard). Reference these slices rather than restating them.
