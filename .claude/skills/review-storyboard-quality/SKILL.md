---
name: review-storyboard-quality
description: Quality-axis reviewer for a storyboard (film.json) — judge the board's craft on its own merits: hook, one idea, camera as a sensible tour, and especially framing/composition (does each beat fill the frame, or leave dead space with content too small to read). Emit VERDICT: pass | revise.
---

# review-storyboard-quality

You review a **storyboard** (the `film.json`) on the **quality** axis — is it a well-crafted board? You do **not** check that it covers the brief/script here (that is the conformance reviewer's axis), and you do **not** check it matches the moodboard (that is consistency). Judge the board's own craft, reading the `film.json` params.

Family A (real-UI): the board is a word-anchored Ken-Burns tour of a captured page. `camera` beats set `focus` ([x,y] in 1440-wide capture pixels) and `zoom`; `title_card`/`title_size` set the opening card; `chips` label what's on screen; `outro` closes.

## Rubric

- **Hook + ONE idea.** `title_card.text` is a short payoff (the outcome/value), not a logo or the brand. The board builds one idea; no beat serves a second.
- **Camera is a deliberate tour, not a drift.** 3–5 beats, each anchored to a spoken word, each `focus` landing on the element that word names. No beat pans to a region with nothing in it.

### Framing & composition — fill the frame (the load-bearing check)

The single most common failure is a beat that **leaves too much empty space**: the content sits small in the middle with large dead margins, and any text is too small to read. Catch it here.

- **Zoom fills the frame.** A beat whose `zoom` is near 1.0 shows the whole page wide, so the actual thing being discussed (a form, a button, a result) is tiny with big empty margins. Each content beat should zoom in enough that its subject dominates the frame — as a rule of thumb raise a weak beat toward `zoom` ~1.2–1.4 and set `focus` on the subject, not just the page centre. A beat that is mostly empty canvas = revise, with the specific beat and a higher zoom + tighter focus.
- **Focus on dense content.** `focus` should land where the UI actually is (use a `mark` or the element's pixel point), not a blank header/footer band. If a beat's `focus` sits in empty page chrome, call it.
- **Text is large enough to read.** `title_card.text` / `title_size` and `chips` must be short and big. Long chip/title text shrinks or wraps and reads small on a phone. Flag any card/chip that is too long or too small, and say to shorten it and/or raise `title_size`.
- **No persistent dead zone.** If the framing leaves a large constant empty region across beats, say what to do: zoom in, reposition `focus`, add a `chip`/label to occupy it, or crop tighter. Name concrete space-filling moves, not just "it feels empty".

- **Pacing.** Beats are spread sensibly across the script (no two cuts stacked on one word, no 6-second hold on a static frame). Short wins.
- **One clear close.** `outro` carries the brand + one CTA; it is not where the hook lives.

## Output

Exactly one line — `VERDICT: pass` or `VERDICT: revise` — then, if revise, the specific fixes: name the offending `camera` beat / `chip` / card, quote its current params (e.g. `zoom: 1.06, focus: [720, 400]`), and give the concrete change (e.g. "raise to `zoom: 1.3`, move `focus` to the form at `[720, 900]` so it fills the frame"). Judge only craft; an on-brief board that frames badly still fails here.
