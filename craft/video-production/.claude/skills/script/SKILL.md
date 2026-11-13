---
name: script
description: Write the spoken voiceover for the video — short, payoff-first, grounded in the brief. Output ONLY the lines, one per line.
---

# script

## Hold to the craft bar

Before producing, read `craft/video-production/.claude/references/CRAFT-BAR.md`: apply **§A** in full + the **§B profile** for this video's type. For the composed/board path also read `COMPOSED-CARDS.md`. Judged against both.

**Aim at the bar.** Apply §A as you write: the hook earns the first 1–5s and is never a logo/brand line (§A4); one idea per beat; density ≤ ~2.5 words/sec (§A4); and when the video has one hero number, the proof line lands it specifically (§A2). The **arc and the close are type-dependent — follow the §B profile for this video's type**, not a baked-in launch shape (a teaser withholds; a demo shows one flow; a launch runs hook → reveal → 2–4 heroes → proof → CTA). The reviewer judges your script against §A + the §B profile at the ship test.

Write the narration. Rules:

- **Short:** 3-5 lines, ~12-18s spoken total. One idea the whole video serves.
- **Payoff-first:** line 1 is a benefit/outcome hook, not the brand name.
- **Grounded:** claim only what the brief says the product/site actually does — no invented features.
- **Close — defer to the §B profile; do not hardcode a tagline sign-off.** A last line that is just "brand + tagline" can satisfy "has a last line" while failing the close. Write the close the video's type needs: **B-launch** — an explicit CTA ask (a concrete labeled action: "Start free today", "Get it now"), not a soft tagline; **B-demo** — a next-step line (where to start/try); **B-teaser** — a deferred tease ("Coming <when>", "Available now"), a hard CTA is usually wrong here; **B-explainer** — where to learn more. A tagline may ride *with* the type's close, but never replaces it.
- **Spoken English only:** what the narrator says. No stage directions, no shot notes, no "Scene 1", no metadata, no numbers read as tables. (This is the spec-08 failure — never narrate production notes.)
- **Emotion via audio tags (the one allowed bracket):** the voice is ElevenLabs v4, which reads inline bracketed performance cues — `[excited]`, `[curious]`, `[warm]`, `[reassuring]`, `[whispers]`, `[laughs]` — as delivery direction. Use them to make the read dynamic and alive, but as **seasoning**: tag only the beats that genuinely turn (the hook, the reveal, the close), a few across the whole script, from that small palette — never one on every line, never a tag that fights the line. Place the tag inline right before the words it colours (`[excited] There's your popup.` or `Say it [warm] in plain English.`). These are the ONLY brackets allowed, and they are **not** the forbidden stage directions above: they are stripped before word-timing, so they are never spoken and never become on-screen text. On a redo asking for a more expressive / emotional voice, this is the lever — add or adjust tags, don't rewrite the lines.
- **Explainer / case-study mode.** If the brief marks the video an explainer, case-study, or walkthrough, the 3-5 line / 12-18s limit does **not** apply: write to the brief's target length (often 40-90s), as a clear sequence of short spoken beats — one per step being shown. An establishing opener is allowed here ("Here's how this video was built…", "In this example…") — when the subject *is* the process, that is not throat-clearing. Stay speakable, tight, grounded; the close can hand off to what plays next ("…and here's the result:").

## Output

Output **only** a JSON object — the film.json `script` slice — nothing else:

```json
{"script": ["[curious] Ask your AI for a popup.", "Not a Model Context Protocol. The Monster Context Protocol.", "…"]}
```

One spoken line per array entry, in order, each line once (inline audio tags allowed as above — they stay in the string, verbatim). No prose around the JSON. The engine writes this slice straight into the shared `board/film.json` (`script` key) and it is the authoritative source of the spoken words for the whole pipeline — the voice reads it, the storyboard beats it, no one re-copies it.
