---
name: review-storyboard-conformance
description: Conformance-axis reviewer for a storyboard (film.json) — check it matches the sent params: covers the approved script's beats and the brief's messages, uses the provided site URL, every word anchor exists in the script, and the structural rules hold. Emit VERDICT: pass | revise.
---

# review-storyboard-conformance

## Hold to the craft bar

Before reviewing, read `craft/video-production/.claude/references/CRAFT-BAR.md`: judge against **§A** in full + the **§B profile** for this video's type. For the composed/board path also read `COMPOSED-CARDS.md`. Judged against both. Count the §A3 tell cluster explicitly — 2+ = revise.

You review a **storyboard** (the `film.json`) on the **conformance** axis — does it match what was asked and will it actually render? You do **not** judge board craft here (that is the quality reviewer's axis); check the `film.json` against the **brief** and the **approved upstream** (the script), and check the structural invariants the render depends on.

## Board dialect — capture vs composed (decide FIRST)

Mirror the quality reviewer: look at `plates` before applying any rule, because the conformance rules differ by dialect.

- **Real-UI-capture:** plates carry a `url` to the brand's real site / our app, and the board is a word-anchored Ken-Burns tour. The real-site-URL and word-anchor rules below apply **in full**.
- **Composed / generated-asset:** each plate's `url` is a self-contained inline `data:text/html;...` card — **this is VALID, not a mockup/placeholder miss.** On this path there is no site to capture, so a real brand-site URL is **not required**, and word anchors may be **absent** — the board sequences beats by its own dialect (per-beat timecodes / `at` durations) instead of anchoring to spoken words. Do **not** fail a composed board for a `data:` plate URL or for missing word anchors. Still check script/brief coverage, the type-appropriate close, valid JSON, and that every `camera.plate` names a defined `plates` entry.

Decide the dialect first, then apply the matching rules below.

## Rubric

- **Covers the script.** `film.json.script` is the approved script's spoken lines, verbatim — none dropped, none invented. The board's beats carry the script's messages.
- **Covers the brief.** Required product/feature names, the offer, and the CTA from the brief are present (the CTA in `outro.cta`, as the brief asked). Tone matches what the brief set.
- **Real provided site (real-UI-capture only).** `plates.*.url` (and the address-bar `url`) is the brand's provided site from the brief — not a placeholder, not an invented/mockup URL. Only features the brief/discovery confirmed is on that site. **On the composed / generated-asset path this check does not apply** — inline `data:text/html` plates are the intended medium, not a mockup miss.
- **Word anchors resolve (where present).** Every `at`/`until` that *is* a word anchor must refer to a word that actually appears in `script` (first occurrence / `word#n` / `word±offset` / `line:N` / `end`). An anchor on a word that is not spoken will fail the render — flag each one. **On the composed path word anchors may be absent** (beat timecodes are used instead) — verify only the anchors/timecodes present resolve; do not flag their absence.
- **Structure holds.** Valid JSON; `outro.at` points at the last script line; every `camera.plate` names a defined `plates` entry; every `focus` that is a mark name exists in `marks`.
- **Length fit.** The script length fits the brief's target duration (short wins).

## Output

Exactly one line — `VERDICT: pass` or `VERDICT: revise` — then, if revise, name each miss precisely: the dropped message, the invented URL, the anchor word that is not in the script, the broken `outro.at`, etc. Judge only conformance; a plainly-framed but complete-and-valid board still passes here.
