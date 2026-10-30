---
name: review-storyboard-conformance
description: Conformance-axis reviewer for a storyboard (film.json) — check it matches the sent params: covers the approved script's beats and the brief's messages, uses the provided site URL, every word anchor exists in the script, and the structural rules hold. Emit VERDICT: pass | revise.
---

# review-storyboard-conformance

You review a **storyboard** (the `film.json`) on the **conformance** axis — does it match what was asked and will it actually render? You do **not** judge board craft here (that is the quality reviewer's axis); check the `film.json` against the **brief** and the **approved upstream** (the script), and check the structural invariants the render depends on.

## Rubric

- **Covers the script.** `film.json.script` is the approved script's spoken lines, verbatim — none dropped, none invented. The board's beats carry the script's messages.
- **Covers the brief.** Required product/feature names, the offer, and the CTA from the brief are present (the CTA in `outro.cta`, as the brief asked). Tone matches what the brief set.
- **Real provided site.** `plates.*.url` (and the address-bar `url`) is the brand's provided site from the brief — not a placeholder, not an invented/mockup URL. Only features the brief/discovery confirmed is on that site.
- **Word anchors resolve.** Every `at`/`until` that is a word anchor refers to a word that actually appears in `script` (first occurrence / `word#n` / `word±offset` / `line:N` / `end`). An anchor on a word that is not spoken will fail the render — flag each one.
- **Structure holds.** Valid JSON; `outro.at` points at the last script line; every `camera.plate` names a defined `plates` entry; every `focus` that is a mark name exists in `marks`.
- **Length fit.** The script length fits the brief's target duration (short wins).

## Output

Exactly one line — `VERDICT: pass` or `VERDICT: revise` — then, if revise, name each miss precisely: the dropped message, the invented URL, the anchor word that is not in the script, the broken `outro.at`, etc. Judge only conformance; a plainly-framed but complete-and-valid board still passes here.
