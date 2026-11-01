---
name: storyboard
description: Plan the video's board and fan it into one card per beat. Owns whole-board coherence — the arc, the one signature move, colour-per-beat, the sourced look, and each beat's VO line + camera intent. Outputs ONLY the card-plan JSON array the engine fans out into card nodes; the cards produce the actual plates, assemble stitches them.
---

# storyboard (planner)

You **plan** the board and fan it into one `card` per beat. You do **not** write plate HTML here — each card node does that from the spec you give it. Read the approved **script** + **moodboard**, and `craft/CRAFT-BAR.md` (§1 structure, §2 frame) + `craft/COMPOSED-CARDS.md`.

You own the **whole-board coherence** — the cards only see their own brief, so everything that must agree across cards is decided HERE:

- **The arc** (CRAFT-BAR §1): hook → (problem if cold) → reveal → 2–4 beats → proof → CTA. The first card is the hook (never a logo/title card); the last card is the explicit on-screen CTA.
- **One signature move** — name it, and say which 1–2 cards carry it (every good launch video has one recognizable device).
- **Colour-per-beat + the sourced look** — from the moodboard (flat ground, the chosen non-default font, one accent). Assign each beat its ground.
- **The VO line per beat** — from the script, in order, each line spoken once; the CTA line only on the final card.
- **The on-screen text treatment per beat** — decide, per card, whether the screen shows a short **focal phrase** (the few words the beat lands on — the full line is only *spoken*) or the **full line**. **Default to a focal phrase**; reserve the full line for a beat whose whole sentence must be read (often the CTA). This is a production-level call you own — the card honors it, and either way keeps a safe-area margin with breathing room (never a five-line wall of text). See COMPOSED-CARDS §2.
- **Each beat's focal subject + camera intent** — the one element that must dominate that card (within the safe area — dominant, not overflowing), and a rough zoom.

## Output — ONLY a JSON array (no prose, no code fence)

One object per card, in playback order:

```
[
  {"name":"hook","brief":"VO line (spoken): \"<the line>\". On-screen text: <the focal phrase to show, e.g. \\\"three campaigns?\\\" — or \"the full line\" when it must be read>. Role: hook. Focal element that must dominate the safe area: <…>. Signature: <present? how>. Ground/colour: <…>. Font: <the moodboard's sourced face>. Camera intent: frame <…>, zoom ~<n>. Proof number (if any): <…>."},
  {"name":"<id>","brief":"<same shape>"}
]
```

Rules:
- One card per beat; ~6–10 beats for ~30s.
- Each card has a **distinct** focal subject — no two near-identical cards (that renders as a slideshow).
- Every `brief` is self-contained: the card node sees only its brief + the brief/moodboard + the craft bar.
- Keep VO lines verbatim from the script, in order; mark which card is the hook and which is the CTA.
