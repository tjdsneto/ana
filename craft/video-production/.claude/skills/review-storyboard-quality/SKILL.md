---
name: review-storyboard-quality
description: Quality-axis reviewer for a storyboard (film.json) — judge the board's craft on its own merits: hook, one idea, camera as a sensible tour, and especially framing/composition — does each beat scale its focal element to dominate the frame, or leave the subject small at native scale with dead space and unreadable text. Emit VERDICT: pass | revise.
---

# review-storyboard-quality

You review a **storyboard** (the `film.json`) on the **quality** axis — is it a well-crafted board? You do **not** check that it covers the brief/script here (that is the conformance reviewer's axis), and you do **not** check it matches the moodboard (that is consistency). Judge the board's own craft, reading the `film.json` params AND the rendered board (below).

## The bar — read `craft/video-production/docs/CRAFT-BAR.md` first (load-bearing)

Before judging, read **`craft/video-production/docs/CRAFT-BAR.md`** (from the repo root) — the premium standard distilled from real launch-video teardowns + the anti-AI-slop checklist. Judge this board against it at the **ship test**: *would the company whose product this is actually ship a video built from this board as their launch?* Not "is it acceptable." Your job is not only to grade — it is to **bump the board up**: for every miss, name the beat, say what's wrong, and give the concrete change that raises it, then send it back. With the redo budget set high, keep sending weak boards back until they clear the bar. Passing mediocrity is the exact failure this gate exists to prevent.

In particular, enforce from the bar: the hook is not a logo/title card (§1); an explicit on-screen CTA beat exists and is readable to the end (§1); each beat has one dominant subject filling the frame, no dead-space ring/band (§2); no near-duplicate slideshow beats, no sparse frozen close (§2); motion means something (§2); and **count the §3 AI-slop tell cluster explicitly** — gradients-everywhere + card-for-everything + one-bright-accent + an unspecified-default font (Inter/Outfit/Geist/… ) is already 4 tells = revise; name the specific sourced swaps. The checks below are the mechanics of this bar.

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

## Board medium — capture vs composed (decide FIRST)

Look at `plates` in the `film.json`. There are two media, and they are reviewed differently:

- **Capture (Family A):** a plate carries a `url` to a real site or our app dashboard. The board is a Ken-Burns tour of a captured page.
- **Composed / generative:** each plate's `url` is a self-contained inline `data:text/html;...` card (shapes/type/gradients). `site-capture.mjs` loads a data-URL in a browser exactly like any other URL and screenshots it, so **composed boards render too** — `storyboard-board.py` crops the shots into `board/sheet.jpg` the same way.

**Either way you MUST render and READ the pixel board (next section). Do not judge a composed board from the `film.json` alone — that is how dead-space, tiny-focal, and repetitive boards passed before. Look at the cards.**

## Visual review (required, BOTH media) — judge the board, not the JSON

You must review the **rendered board**, not only read params — for capture AND composed storyboards. Produce it yourself (independent of the producer) and look at every card. The storyboard artifact is the `film.json` (or a short report naming its path, often `tmp/film-*.json`); materialize that film.json into a scratch dir as `film.json`, then:

```
node craft/video-production/tools/site-capture.mjs --spec <workDir>/film.json --out <workDir>   # screenshots every plate (incl. inline data-URL composed cards)
python3 craft/video-production/tools/storyboard-board.py --root <workDir>
```

Open `<workDir>/board/sheet.jpg` — one card per beat: the **exact region the render will frame** beside that beat's VO line, chip and ring. **A verdict given without reading the rendered board is invalid**, composed or captured. Judge the actual pixels against the framing/scale/pacing checks above: dead space (a big empty ring/band with the real content tiny in a corner → revise), focal element too small, near-duplicate beats padding the runtime, text too small, a sparse frozen close. These are exactly the failures that slipped through when composed boards were judged from JSON.

### Grounding — the picture must depict what the line says (load-bearing)

For **every** beat, check the card's picture (capture) or its composed card spec (composed) against its VO line and chip:

- Does the framed content actually show what the VO is naming at that moment? A "seven steps" line over a crop of a briefing paragraph, a "runs on Sonnet" line over a model row reading something else, a "here's what it produced" line over a static poster — each is a **revise**. Name the beat, say what the VO claims vs. what the crop shows, and give the fix (point `focus` at the right `mark`, adjust `zoom`).
- Any specific claim the VO makes (a number, a name, a reason) that the card does not actually show on screen is a grounding gap — revise, and say which element to frame/ring so the claim is visible.

**No weak board passes.** If any beat fails grounding or the framing/scale checks above, the verdict is `revise` — do not wave a board through because the JSON looks plausible. The board is the gate; a board that misleads the viewer is a weak board however tidy its params.

## Output

Exactly one line — `VERDICT: pass` or `VERDICT: revise` — then, if revise, the specific fixes: name the offending `camera` beat / `chip` / card, quote its current params (e.g. `zoom: 1.06, focus: [720, 400]`), cite the board card (what the crop shows vs. what the VO says), and give the concrete change (e.g. "raise to `zoom: 1.3`, move `focus` to the mark `steplist` so the seven-step list fills the frame"). Judge only craft + grounding; an on-brief board that frames badly or misleads still fails here.
