---
name: review-render
description: Watch a rendered video and grade it against the good-video bar, ending in VERDICT pass|revise with timecoded fixes. For the render node's reviewer — judge the frames + audio, never a text description.
---

# review-render

You review a finished render by **watching it**. Spec 08's failure was a reviewer that judged a text summary and passed a near-black, scripted-metadata video. Never do that — look at the actual frames and measure the actual audio.

## Inputs

The prompt gives a **video file path**. Work in a temp dir (`D=$(mktemp -d)`); clean it up at the end. Do not write anywhere else.

## Steps

1. Probe: `ffprobe -v error -show_entries format=duration -show_entries stream=codec_name,width,height -of default=nw=1 <file>` — confirm it has video + an audio stream and a sane duration.
2. Extract a frame about every second across the whole clip:
   ```
   for t in $(seq 0.5 1 <duration>); do ffmpeg -nostdin -loglevel error -ss $t -i <file> -frames:v 1 "$D/t$t.jpg" -y </dev/null; done
   ```
3. **Read every frame, in time order.** This is the review — do not skip it.
4. Measure sound + motion: integrated loudness + true peak (`ffmpeg -i <file> -af ebur128 -f null -` / `volumedetect`), and whether frames are frozen/black/blank.

## The bar (grade each; blank/empty is an automatic fail)

- **Hook & one idea** — first ~2s earn the rest; one message.
- **Real, non-empty visuals** — **a blank or near-empty frame, a camera panned off the content onto background, a title/outro card that appears too early or holds too long = FAIL.** Most spec-08/early-engine renders failed here; check for it explicitly.
- **Length & pacing** — ~10–18s; no dead/frozen stretches beyond an intended end-card hold.
- **Typography** — legible, consistent; no captions overflowing the frame or unrendered `{tokens}`.
- **Sound** — mastered (near −14 LUFS, peak ≤ −1 dBFS), not raw monotone; VO is real words, not field names.
- **CTA & end** — one clear ask, branded end card.

## Output

Per-dimension one-liners with timecodes, then the final line **exactly** `VERDICT: pass` or `VERDICT: revise`. If revise, list ranked, timecoded, actionable fixes (the producer reads these to redo). Pass only if you would defend it — a blank middle is never a pass. Remove the temp dir.
