---
name: review-storyboard-quality
description: Quality-axis reviewer for a storyboard (film.json) — judge the board's craft on its own merits: hook, one idea, camera as a sensible tour, and especially framing/composition — does each beat scale its focal element to dominate the frame, or leave the subject small at native scale with dead space and unreadable text. Emit VERDICT: pass | revise.
---

# review-storyboard-quality

You review a **storyboard** (the `film.json`) on the **quality** axis — is it a well-crafted board? You do **not** check that it covers the brief/script here (that is the conformance reviewer's axis), and you do **not** check it matches the moodboard (that is consistency). Judge the board's own craft, reading the `film.json` params.

Family A (real-UI): the board is a word-anchored Ken-Burns tour of a captured page. `camera` beats set `focus` ([x,y] in 1440-wide capture pixels) and `zoom`; `title_card`/`title_size` set the opening card; `chips` label what's on screen; `outro` closes.

## Rubric

- **Hook + ONE idea.** `title_card.text` is a short payoff (the outcome/value), not a logo or the brand. The board builds one idea; no beat serves a second.
- **Camera is a deliberate tour, not a drift.** 3–5 beats, each anchored to a spoken word, each `focus` landing on the element that word names. No beat pans to a region with nothing in it.

### Framing & composition — the focal element must dominate the frame (the load-bearing check)

The costliest failure is subtler than raw empty margins: the beat shows its subject **at native/small scale** — one product card the same size as the eight around it, a form shown at page width — so the thing the VO is naming never becomes the dominant, readable anchor. "Reduce dead space" is downstream of this. Lead with the scale check.

1. **Scale the focal element to dominate.** For each content beat, identify the one element the VO names at that moment, and check the `camera` beat zooms/focuses so that element fills roughly half the frame or more — not the whole page at native size. A beat that frames nine equal tiles when one is being named = revise: raise `zoom` (rule of thumb ~1.3–1.6 for a single UI element, higher than a page-level tour) and set `focus` on that element's `mark`, so it reads as the subject, not one tile among many.
2. **Focal hierarchy — one clear anchor.** When a beat shows several similar elements (a grid, a list), the active one must be visibly separated: larger, or emphasized with a `ring`/`chip` on it, while the rest recede. A thin outline alone is not enough — if the only cue to "which one" is a tiny caption, call it, and say to enlarge/ring the active element and let the others fall away via the zoom.
3. **Fill the frame edge to edge.** A plate that floats with a constant border on all sides (a letterbox of page chrome/background) wastes the frame. Say to scale the capture/zoom so the UI reaches the edges, cropping the dead border.
4. **No empty band on entry.** A beat that lands on a near-empty header/hero band before the real content scrolls in reads as dead air. Anchor the beat (via `focus`/the plate's scroll `steps`) so the content is already filling the viewport when the beat starts.
5. **Text large enough to read.** `title_card.text` / `title_size` and `chips` must be short and big — readable on a phone. Long chip/title text shrinks or wraps. Flag any card/chip too long or too small; shorten it and/or raise `title_size`.
6. **The end card is not a sparse frozen hold.** An `outro` whose brand mark sits tiny in a vast near-black field, held for seconds, is dead space at the worst moment. The brand mark should occupy a real share of the frame, the entrance should move, and the hold should be tight (`tail` short) — call an outro that is small, static, and long.

- **Pacing.** Beats are spread sensibly across the script (no two cuts stacked on one word, no 6-second hold on a static frame). Short wins.
- **One clear close.** `outro` carries the brand + one CTA; it is not where the hook lives.

## Explainer / case-study mode

If the brief marks the video an explainer / case-study / walkthrough, relax the structure rules: a **sequential walkthrough** (one beat per section/step — hero, stats, each pipeline stage) is the intended shape, not a single payoff idea; **more than 5 beats is fine** and expected; the plate may be our own app dashboard. Do **not** revise for "serves a second idea" or "too many beats." Keep enforcing the load-bearing checks: framing/scale (the section a beat narrates must dominate the frame, not sit tiny in a tall page), focal hierarchy, edge-to-edge fill, no empty band on entry, and readable text. A `tail_clip` field (an appended produced clip) is allowed.

## Output

Exactly one line — `VERDICT: pass` or `VERDICT: revise` — then, if revise, the specific fixes: name the offending `camera` beat / `chip` / card, quote its current params (e.g. `zoom: 1.06, focus: [720, 400]`), and give the concrete change (e.g. "raise to `zoom: 1.3`, move `focus` to the form at `[720, 900]` so it fills the frame"). Judge only craft; an on-brief board that frames badly still fails here.
