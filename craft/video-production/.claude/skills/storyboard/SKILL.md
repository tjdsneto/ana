---
name: storyboard
description: Plan the video's board and fan it into one card per beat. Owns whole-board coherence — the arc, the one signature move, colour-per-beat, the sourced look, and each beat's VO line + camera intent. Outputs ONLY the card-plan JSON array the engine fans out into card nodes; the cards produce the actual plates, assemble stitches them.
---

# storyboard (planner)

## Hold to the craft bar

Before producing, read `craft/video-production/.claude/references/CRAFT-BAR.md`: apply **§A** in full + the **§B profile** for this video's type. For the composed/board path also read `COMPOSED-CARDS.md`; for the motion you plan per beat, `MOTION-VOCAB.md`. Judged against all.

You **plan** the board and fan it into one `card` per beat. You do **not** write plate HTML here — each card node does that from the spec you give it. Read the approved **script** + **moodboard**, and `craft/video-production/.claude/references/CRAFT-BAR.md` (§A frame craft + the §B profile for this type) + `craft/video-production/.claude/references/COMPOSED-CARDS.md`.

You own the **whole-board coherence** — the cards only see their own brief, so everything that must agree across cards is decided HERE:

- **The arc — follow the §B profile for this video's type**, not a baked-in launch shape. The first card is always the hook (never a logo/title card, §A4); the last card is the close the §B profile requires — **B-launch** an explicit on-screen CTA card, **B-demo** a next-step card, **B-teaser** a deferred-tease card, **B-explainer** a where-to-learn-more card. Lay the beats out in that arc's order.
- **One signature move (§A1)** — name the board's single signature device and **assign it to the specific 1–2 cards that carry it** (every memorable video has one; a board with none is a revise at review). Mark `Signature move` on those cards and `—` on the rest.
- **The hero number / receipt owns its own card (§A1/§A2)** — if the video has one strongest number or a proof receipt, **give it a dedicated full-frame beat and name which card that is**; it is never a footnote on a busy card. Not every type has one — follow the §B profile (a teaser usually has none).
- **Sound plan (§A5)** — state the music-bed feel for the board as a whole (a mood word the render resolves to a bed), and mark the few beats that take a deliberate SFX hit, so audio is designed from the board, not bolted on at render. Carry it per beat in each card's `SOUND/SFX` field as a **structured cue** so `assemble-board` can map it straight into the film.json `audio` block — free text there never reaches the render, which then falls back to generic default cues. A cue is `<sound>@<anchor>`: the sound from the **click · tick · pop · hit · whoosh · swish** palette, the anchor the VO word it lands on (or a timecode). Mark only the beats that genuinely take a hit — the signature beats (a reveal, the hero number, the CTA); a quiet beat carries none.
- **Colour-per-beat + the sourced look** — from the moodboard (flat ground, the chosen non-default font, one accent). Assign each beat its ground.
- **The VO line per beat** — from the script, in order, each line spoken once; the CTA line only on the final card. The script arrives as a JSON object `{"script": ["line one", …]}` — one entry per spoken line; use the entries **verbatim** (inline audio tags like `[excited]` stay in the line). Do not rewrite or re-author the words; the script step owns them.
- **The on-screen text treatment per beat** — decide, per card, whether the screen shows a short **focal phrase** (the few words the beat lands on — the full line is only *spoken*) or the **full line**. **Default to a focal phrase**; reserve the full line for a beat whose whole sentence must be read (often the CTA). This is a production-level call you own — the card honors it, and either way keeps a safe-area margin with breathing room (never a five-line wall of text). See COMPOSED-CARDS §2.
- **Each beat's focal subject + camera intent** — the one element that must dominate that card (within the safe area — dominant, not overflowing), and a rough zoom.

## Output — ONLY a JSON array (no prose, no code fence)

The schema + a valid example live beside this skill — `schema.json` + `example.json` — as the source of truth your output must conform to (a downstream convert step validates against them).

One object per card, in playback order:

```
[
  {"name":"hook","brief":"VO line (spoken): \"<the line>\". On-screen text: <the focal phrase to show, e.g. \\\"three campaigns?\\\" — or \"the full line\" when it must be read>. SOUND/SFX: <the music-bed feel for this beat; and, if this beat takes a deliberate hit, the SFX as a structured cue \\\"<sound>@<anchor>\\\" — sound from click·tick·pop·hit·whoosh·swish, anchor = the VO word it lands on or a timecode, e.g. whoosh@\\\"Monster\\\"; else — for a quiet beat>. Timecode: <start–end, ~<n>s for this beat>. Role: hook. Focal element that must dominate the safe area: <…>. Signature move: <does THIS card carry the board's one signature device? if so, how; else —>. Hero-number/receipt card: <if THIS beat owns the single strongest number or the proof receipt full-frame (§A1/§A2), the number/receipt; else —>. Ground/colour: <…>. Font: <the moodboard's sourced face>. Camera intent: frame <…>, zoom ~<n>. Motion: <how the focal element ARRIVES — a MOTION-VOCAB verb: word-by-word reveal / count-up / cursor-click / scale-in / draw-in / kinetic emphasis — NOT just a camera zoom>. Transition to next beat: <push / zoom-through / match-cut / cut-on-stress + SFX>."},
  {"name":"<id>","brief":"<same shape>"}
]
```

Rules:
- One card per beat. **Beat count keys off the §B length band, not a fixed number:** a 9:16 ≤~15s social cut ~4–6 beats; a 15–40s teaser ~5–8; a 30–90s 16:9 hero ~6–12. Pick what fits this video's target within its band — don't pad to a number.
- Each card has a **distinct** focal subject — no two near-identical cards (that renders as a slideshow).
- **Every card names a `Motion` verb + a `Transition` (§A1, MOTION-VOCAB).** The focal element arrives with real motion (text reveals, a number counts up, a cursor clicks, a chart draws) and the beat connects to the next with a deliberate transition — a camera zoom on a static plate is NOT motion. No two consecutive cards are both static-plate-under-a-pan.
- Every `brief` is self-contained: the card node sees only its brief + the brief/moodboard + the craft bar.
- Keep VO lines verbatim from the script, in order; mark which card is the hook and which is the close (the close's form follows the §B profile — a CTA for a launch, a deferred tease for a teaser, a next step for a demo).
