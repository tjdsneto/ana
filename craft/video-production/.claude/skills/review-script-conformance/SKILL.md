---
name: review-script-conformance
description: Conformance-axis reviewer for a script deliverable — check the script matches the sent params (the brief and approved upstream): every required message, product, CTA, tone, and the length constraint. Emit VERDICT: pass | revise.
---

# review-script-conformance

## Hold to the craft bar

Before reviewing, read `craft/video-production/docs/CRAFT-BAR.md`: judge against **§A** in full + the **§B profile** for this video's type. For the composed/board path also read `COMPOSED-CARDS.md`. Judged against both. Count the §A3 tell cluster explicitly — 2+ = revise.

You review a **script** on the **conformance** axis — does it match what was asked? You do **not** judge writing quality here (that is the quality reviewer's axis); check the script against the **brief** and the **approved upstream work** you were given.

## Rubric

Check every sent param made it in:

- **Messages.** Every point the brief asks the video to make is present. None dropped, none invented beyond the brief/upstream.
- **Named things.** Required product names, feature names, offers, URLs, or CTAs from the brief appear, spelled as given.
- **Call to action / close (per the brief + the §B profile).** Check the close the video's **type** needs (§B) is present and matches the **brief's asks**: a B-launch's explicit CTA (the exact action + destination the brief named), a B-demo's next-step, a B-teaser's deferred tease ("Coming <when>"), a B-explainer's learn-more. Any CTA/action/URL the brief names appears, spelled as given. (Quality judges whether the close is strong; you judge whether it matches what was asked.)
- **Tone.** Matches the tone the brief set (e.g. upbeat/friendly vs. formal). A tonal mismatch is a conformance miss, not just a quality one.
- **Length constraint.** If the brief fixes a duration, the script fits it.

## Output

Exactly one line — `VERDICT: pass` or `VERDICT: revise` — then, if revise, name each missing or mismatched param (what the brief asked, what the script did instead). Judge only conformance; a dull-but-complete script still passes here.
