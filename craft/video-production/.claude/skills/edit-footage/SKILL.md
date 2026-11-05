---
name: edit-footage
description: Produce a derived clip from a caller-provided asset — select and assemble the piece the brief calls for by writing an EDL (in/out ranges, optional crop, audio channels/gain) and applying it with the edl-apply tool. You cut/crop what's provided; you do NOT generate new footage.
---

# edit-footage

You own the **clip** leaf: take an asset the caller provided (a video or audio file) and produce the **piece** the brief needs — a trimmed/assembled sub-clip, a cropped region, a selected audio span. The judgment (which ranges, what crop) is yours; the deterministic cut is done by the `edl-apply` tool. You never fabricate footage — you only use what the provided asset actually contains.

## Inputs

A **work dir** holding the caller's **provided asset** (the video/audio to edit) and the **brief** (what piece is wanted). Run from the craft root (where `craft/video-production/tools/` lives).

> Engine integration note: the provided asset must be present in the work dir as a real file. The current rendered-leaf staging stages text upstream only (skips binary) and expects an `.mp4` output — so a caller-provided binary asset and non-mp4 (audio) output need the engine's staging/record path generalized before this leaf runs end to end in the loop. Until then this skill is runnable by hand against a work dir you populate.

## Steps

1. **Inspect** the provided asset — duration and streams:
   ```
   ffprobe -v error -show_entries format=duration -show_entries stream=codec_type,width,height,channels -of default=noprint_wrappers=1 <asset>
   ```
2. **Decide the cut** from the brief: the ordered keep-range(s) `in`/`out` in seconds (drop what the brief doesn't want), an optional `crop` {x,y,w,h} for video, optional `audio` {channels, gainDb}. If the brief names content by what's *said*, transcribe first (see `transcribe` tool, Phase 2) to find the timecodes — otherwise work by time.
3. **Write the EDL** JSON (the cut plan — the editor-mode analogue of the storyboard):
   ```json
   { "source": "<asset path>", "segments": [ {"in": 2.0, "out": 6.5} ], "crop": {"x":0,"y":0,"w":1280,"h":720}, "audio": {"channels":2,"gainDb":0} }
   ```
   Omit `segments` (or `[]`) to keep the whole asset; omit `crop`/`audio` when not needed.
4. **Apply it:**
   ```
   node craft/video-production/tools/edl-apply.mjs --edl <workDir>/edl.json --out <workDir>/clip.<mp4|wav|mp3>
   ```
   Video source → write `.mp4`; audio source → write the matching audio extension.
5. **Confirm** the output exists and its duration matches the sum of your kept ranges (`ffprobe`).

## Optional emphasis — punch-in

To draw the eye to a moment, add a ken-burns zoom after the cut:
```
node craft/video-production/tools/punch.mjs --in <clip>.mp4 --out <clip>-punch.mp4 --zoom 1.3 --to 0.5,0.5
```
`--zoom` is the end magnification; `--to x,y` is the point to zoom toward (frame fractions). Audio passes through. Use it sparingly — one deliberate punch beats constant motion.

## Output

The derived asset path (the `.mp4`/`.wav` the tool wrote). Nothing else — do not read the media into your reply.

## Hold to the bar

The derived clip is reviewed against `craft/video-production/.claude/references/CRAFT-BAR.md` by the generic `review-craft` reviewer (clip craft rubric). Keep the cut clean: ranges land on sensible boundaries (no half-words, no black frames at a join), the crop keeps the subject framed, audio stays intact and level. Iterate on a `revise` — adjust the EDL, re-apply, re-check.

## If a step fails

- `edl-apply` errors on an out-of-range segment (beyond the asset's duration) or a bad crop — fix the EDL to the asset's real duration/size (from step 1) and re-run.
- The provided asset is missing/unreadable → stop and report; never substitute other footage.
