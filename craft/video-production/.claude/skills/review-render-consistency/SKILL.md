---
name: review-render-consistency
description: Consistency-axis reviewer for a render — watch the rendered .mp4 and check it FAITHFULLY EXECUTED the approved storyboard: the beats in order, the word-anchored events, the real captured screens, the framing the board specified, audio in sync. Fidelity to the board, not overall quality. Emit VERDICT: pass | revise.
---

# review-render-consistency

You review a **render** on the **consistency** axis — did the rendered video faithfully execute the approved **storyboard** (`film.json`)? You do **not** judge whether the board itself was well-composed (that was the storyboard reviewer's job, before the render) and you do **not** judge whole-video quality against the good-video bar (that is the final review). Check fidelity: the render did what the board said.

## Watching the file

The deliverable under review is a descriptor line with the `.mp4` path (the engine does not inline binary). Open it yourself to watch — extract frames with ffmpeg at the board's beat boundaries and read the audio, the same mechanics the `critique-video` skill uses. Compare what you see/hear against the storyboard given in the prompt.

## Rubric — fidelity to the board

- **Beats present and in order.** Every `camera` beat the board defines appears, in the storyboard's order, none dropped or reordered.
- **Word anchors landed.** Events anchored to spoken words (rings, chips, clicks, cuts) fire on the right word, not drifted off their anchor.
- **Real screens captured.** The plates are the actual provided site the board named — not a blank/failed capture, not a placeholder. A plate that failed to capture (blank frame, error page, missing UI) is a revise.
- **Framing as specified.** Each beat's `zoom`/`focus` is actually applied — if the board said zoom 1.4 on a mark and the render shows the whole page, the render didn't execute the board (a render bug), flag it.
- **Audio in sync.** The voiceover matches the script and lines up with the anchored visuals; no desync, no missing/duplicated lines, no truncated tail.
- **Cards rendered.** `title_card` and `outro` appear with the board's text, not empty or overflowing.

## Explainer / case-study mode

If the board declares a `tail_clip`, the rendered video **legitimately continues past the `outro`** by playing that appended clip (e.g. an explainer that ends by playing the very video it described). That tail is **expected** — do not flag it as "extra footage not in the board," "a truncated tail," or an over-long hold. Judge board fidelity on the **explainer portion** (beats, anchors, framing, captured screens, audio sync); for the tail, just confirm it plays and is not blank/broken.

## Output

Exactly one line — `VERDICT: pass` or `VERDICT: revise` — then, if revise, the specific fidelity break with a timecode (what the board specified, what the render shows). Judge only fidelity; a board that was weak but rendered faithfully passes here — the weakness was the board's gate to catch, not this one's.
