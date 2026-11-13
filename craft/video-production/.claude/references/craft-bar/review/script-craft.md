# Review rubric — script / craft (quality axis)

Loaded by the generic `review-craft` reviewer when judging a `script` deliverable. The generic reviewer owns the ship-test framing, the VERDICT mechanics, and the §A3 tell-cluster count; this file is ONLY the script-specific craft rubric.

You review a **script** on the **quality** axis — is it well-written craft? You do **not** check brief coverage here (that is the conformance reviewer's axis); judge the writing itself. (Axis note: the §A3 visual-slop cluster and `COMPOSED-CARDS.md` are **not** a script's axis — those belong to the board/card reviewers, not here. Judge the text-relevant parts: **§A4** — the hook earns the first 1–5s and is not a logo/brand line; one idea per beat; density ≤ ~2.5 wps — and the **§B profile** for this video's type, its arc + required close.)

The script arrives as a JSON object `{"script": ["line one", "line two", …]}` — one spoken line per entry. Judge the lines. Entries may carry inline audio tags (e.g. `[excited]`, `[warm]`) — TTS performance cues, not spoken words; ignore them when judging wording/pace (do not penalise a line for carrying a tag, and don't count the tag toward density).

The **arc and the close are type-dependent — judge them against the §B profile for this video's type**, not a fixed launch shape: a **B-launch** script with no explicit CTA line, or a **B-demo** with no next-step close, or a **B-teaser** that blurts a hard CTA it should defer, is a revise; so is a flat logo/brand open in any type. Name the weak line and give the rewrite — bump it up, don't just grade it.

## Rubric

- **Hook first.** The opening line earns attention in the first ~3 seconds; no throat-clearing, no "In this video…".
- **Speakable.** Reads naturally aloud — short clauses, plain words, no tongue-twisters or unpronounceable strings. A voice actor could say each line in one breath.
- **Tight.** No filler, no repetition, every line pulls weight. Cut-to-the-point density appropriate to a short video.
- **Length fit.** The line count / word count fits the target duration (roughly 2–3 spoken words per second). Too long to speak in the target = revise.
- **Payoff + close (per §B).** Builds to a point and ends on a close that is **strong for this video's type** (§B): B-launch an explicit CTA ask, B-demo a next-step line, B-teaser a deferred tease, B-explainer a learn-more handoff. A trailing fade, or a bare brand + tagline where the type needs an ask, is a revise. (Conformance checks whether the close matches the brief's asks; you judge whether it's a strong close for the type.)

## Explainer / case-study mode

If the brief marks the video an explainer, case-study, or walkthrough, relax two rules: (1) **Length** — judge against the brief's target (often 40-90s), not a short-spot duration; a longer script that stays tight is a pass, not a "too long" revise. (2) **Opener** — an establishing line that names the subject ("Here's how…", "In this example…") is allowed and often correct, since the process *is* the subject; do not flag it as throat-clearing. Still enforce speakable, tight, no filler, and a concrete close.

On revise, quote the weak line and say what to change. Judge only quality; a script that is well-written but off-brief still passes here.

Build on: `../a1-frame.md`, `../a3-slop.md`, and `../deliverable-script.md` if it exists (it exists for: script, moodboard). Reference these slices rather than restating them.
