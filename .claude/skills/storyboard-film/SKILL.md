---
name: storyboard-film
description: (Family B / generative branch) Turn the approved script + brief into a film.json — the word-anchored storyboard the render assembles. Family A (real-UI), grounded in the brand's provided site. Output ONLY the film.json.
---

# storyboard

Produce the **film.json** for this video: a word-anchored storyboard over the brand's **provided** site. The render consumes it verbatim, so it must be valid JSON, complete, and timed so the **product stays on screen for the bulk of the clip**. Output **only** the JSON (no prose, no code fence).

**Aim at the bar.** Read `craft/CRAFT-BAR.md` §2 (the frame) and §3 (no AI slop) and build to them: one dominant subject per beat filling ≥ ~50% of the frame (no big empty ring/band with the content tiny — the failure that gets boards rejected); every beat visually distinct (no near-duplicate held cards padding runtime, no sparse frozen close); motion that means something; one signature move. For composed cards, keep the §3 tell cluster to 0–1 (not gradients-everywhere + card-for-everything + one-accent + a default font like Inter/Outfit — that cluster reads as AI slop and is a revise). The quality reviewer renders your board and judges it against this bar at the ship test, with a high redo budget — so clear the bar here.

## 1. Discovery first (ground it — don't author blind)

Before writing the JSON, look at the real page so your camera stays on content:

```
node craft/tools/site-capture.mjs --spec /tmp/sb-probe.json --out /tmp/sb-probe
```
with `/tmp/sb-probe.json` = `{"capture":{"width":1440},"plates":{"site":{"url":"<provided URL>","steps":[{"wait":3000}]}},"marks":{}}`.
Read `/tmp/sb-probe/assets/shots/site.jpg` and note `_h` (page height) from `/tmp/sb-probe/src/shots.json`. Now you know the real page height and what's actually on it. Camera `y` values must stay **within `[0, _h]`** so the camera never pans onto empty background (the blank-frame failure).

## 2. The film.json shape (fill every field)

```json
{
  "title": "<short title>",
  "size": [1920, 1080],
  "url": "<the site URL, as it reads in the address bar>",
  "theme": { "bg": "#0A0A0C", "text": "#EFE9DD", "accent": "<brand accent hex>", "highlight": "<lighter accent hex>" },
  "voice": { "id": "af_heart", "speed": 0.98, "lead": 0.4, "gap": 0.3 },
  "tail": 1.2,
  "title_size": 104,
  "script": ["<line 1>", "<line 2>", "<line 3>", "<final/outro line>"],
  "capture": { "width": 1440, "remove": ["#cookie-notice", ".cookie", "[class*=cookie]", "[id*=cookie]"] },
  "plates": { "site": { "url": "<provided URL>", "steps": [{ "wait": 3000 }] } },
  "marks": {},
  "title_card": { "kicker": "", "text": "<short payoff hook, 2-4 words>" },
  "expand_at": "<first spoken word>+0.5",
  "camera": [
    { "at": "<word from line 1>", "plate": "site", "focus": [720, <~0.15*_h>], "zoom": 1.06 },
    { "at": "<word from line 2>", "plate": "site", "focus": [720, <~0.5*_h>], "zoom": 1.18, "glide": 0.6 },
    { "at": "<word from a pre-final line>", "plate": "site", "focus": [720, <~0.85*_h>], "zoom": 1.18, "glide": 0.6 }
  ],
  "chips": [ { "at": "<word>+0.1", "until": "<later word>-0.1", "text": "**<SHORT LABEL>**" } ],
  "outro": { "at": "line:<LAST>", "kicker": "<BRAND>", "text": "<tagline>", "sub": "<one line>", "cta": "<site domain>" }
}
```

## 3. Timing rules (this is what prevents blank frames)

- **`script`** = the spoken lines verbatim from the upstream script. The last entry is the outro line.
- **`outro.at` must be `line:<LAST>`** where `<LAST>` = the number of entries in `script`. The product window holds until the outro, so the outro (and the window blurring out) happens only in the final ~2-3s — never in the middle. Do NOT put the outro on an early word.
- **Every `camera` beat anchors to a word spoken BEFORE the final line** — so the camera is touring the real product through the body of the video. Use only words that appear in `script` (first occurrence); `line:N`, `word+0.3`, `word-0.2`, `end` also work.
- 3-5 camera beats, `y` within `[0, _h]`, `x: 720`. Short overall (~12-18s of script). One idea. Hook in `title_card.text` (a payoff, not the logo); brand only in the `outro`.
- `chips` (1-2) label what's on screen; `outro` has one CTA (the site domain).

## 3b. Explainer / case-study mode (app-dashboard walkthrough)

If the brief marks the video an **explainer / case-study / walkthrough**, the Family-A shape still applies but these rules change:

- **The "site" can be our own app dashboard.** `plates.*.url` may be a local app URL (e.g. `http://localhost:5199/`). It is a single-page app, so there is no deep link — drive it with the plate's `steps`. Each step may carry a `js` string that runs **in the page** and can be async (click a list item, expand cards, wait). Example to open a specific production and expand its stage cards:
  ```json
  "plates": { "dash": { "url": "http://localhost:5199/", "steps": [
    { "wait": 1200 },
    { "js": "const b=[...document.querySelectorAll('button.prod')].find(x=>/<NAME SUBSTR>/i.test(x.textContent)&&/approved/i.test(x.textContent)); if(b)b.click();" },
    { "wait": 1500 },
    { "js": "document.querySelectorAll('button.stage-head').forEach(h=>{if(!h.closest('.stage').classList.contains('open'))h.click()});" },
    { "wait": 1500 }
  ] } }
  ```
- **Length & beats.** The ~12-18s / one-idea limit does **not** apply. Target the brief's length (often 40-90s) and use **one camera beat per section/step** you narrate (hero, the stats strip, each pipeline stage, …) — more than 5 beats is fine. The page is tall; set each beat's `focus` `y` on the section that beat narrates (read the real page height from a probe capture first, as in step 1).
- **`tail_clip`.** Set `"tail_clip": "<absolute path to an .mp4>"` to append a produced clip after the explainer ("…and here's what it produced:"). The render skill concatenates it onto the end.
- **Payoff ordering (the reveal must be the clip, not a poster).** When the video's payoff is "here's what it produced" followed by the produced clip:
  - The payoff line is the **last narrated line before the tail**, and the tail must play **immediately** after it. Do **not** place a camera beat that frames a static video *poster/thumbnail* on the payoff line — a frozen thumbnail is not "watching what it produced"; the tail playing is.
  - Do **not** wedge a sign-off card between the payoff and the tail. A pre-tail `outro` card with a sign-off ("built by the very same engine") makes the viewer watch a static card instead of the clip, then the clip. If you want that sign-off, either speak it **over the tail's closing seconds**, or omit the pre-tail outro card and let the produced clip be the ending. Keep any pre-tail `outro` to a brief transition at most, never a multi-second static hold.
- The hook/payoff is the *idea of the process*, not a product; on-screen chips label the current step, and the dashboard UI itself carries the detail.

## 3c. Focus by MARK, not guessed pixels (grounds the camera)

A beat's `focus` decides what the viewer sees while a line is spoken. Guessing a raw pixel `y` into a tall page is how a beat ends up framing the wrong thing (VO says "seven steps" while the shot still shows the briefing paragraph). Prefer a **mark**:

- Add a CSS selector per focal element to `marks` (e.g. `"marks": { "steplist": ".stage-list", "f2": ".stage:nth-of-type(2) .rev.fail .feeds" }`). site-capture resolves each to a real rect; `focus: "steplist"` then frames that element exactly, whatever the layout.
- Use a raw `[x,y]` only when there is no stable element to name. If you do, you MUST verify it on the board (step 4) — the crop shows precisely what that pixel frames.

## 4. Visual board (REQUIRED, both media) — see what each beat frames, before you output

You MUST render and look at the board before output — for composed boards too. Composed plates are inline `data:text/html` URLs (below), and `site-capture.mjs` screenshots a data-URL exactly like a site URL, so the board renders either way. Do NOT output on composed-card reasoning alone — the reviewer will render the pixel board and reject dead space, tiny focal elements, repetitive beats and sparse closes, so catch them here first.

### Composed cards — follow the playbook

For composed/generative videos, build the cards to **`craft/COMPOSED-CARDS.md`** (read it): source the look (no default fonts, flat over gradient), make the focal element own the frame (the dead-space-ring failure is what gets boards rejected), express motion as a SEQUENCE of plates (one plate per reveal state — the camera cuts/pushes between them; do not put the end-state on one plate and zoom around it), use the premium templates, and carry one signature move + an explicit CTA card. Keep the AI-slop tell cluster to 0–1.

### Composed plates MUST be inline data-URLs (critical — the render screenshots them)

The render builds every beat from a **screenshot** of its plate (`site-capture.mjs` loads the plate's `url` in a browser → `assets/shots/<id>.jpg` → `build.py` composes it). So a composed card has to be a thing a browser can open **with no external file**. Emit each composed plate as a self-contained inline **data-URL**, exactly this shape:

```
"plates": {
  "f1": { "url": "data:text/html;charset=utf-8,<URL-ENCODED self-contained HTML doc>", "steps": [{ "wait": 300 }] },
  "f2": { "url": "data:text/html;charset=utf-8,...", "steps": [{ "wait": 300 }] }
}
```

The HTML is a complete document (`<!doctype html><meta charset=utf-8><style>…</style>…`) sized to the film `size` (e.g. 1920×1080), drawing the card with inline CSS — shapes, gradients, swatches, type. One plate per distinct card/background a beat frames; a `camera` beat's `plate` names which one. **Never** use a `file` reference (`"file": "plate.html"`) or any path — that file does not exist in the render's work dir and the render will fail with "no .mp4 / plate.html exists nowhere". Inline only.

The storyboard is reviewed as **pixels**, not JSON. After writing `film.json` into the work dir, render the plates (captured pages AND inline composed cards both screenshot here) and build the board, then look at it:

```
node craft/tools/site-capture.mjs --spec <workDir>/film.json --out <workDir>
python3 craft/tools/storyboard-board.py --root <workDir>
```

Open `<workDir>/board/sheet.jpg`. It is one card per camera beat: the **exact region the render will frame** (same camera math as build.py) next to that beat's VO line, chip and ring. For **every** card, confirm the picture depicts what the VO line says. If a card's picture does not match its line — wrong section, briefing text under a "steps" line, a model row that contradicts the narration — fix that beat's `focus` (point it at a `mark`, §3c) and/or `zoom`, rerun the board, and look again. A mockup frame may stand in for a beat that has no real capture: set `"mock": "<path under workDir>"` on that camera beat.

Do not output `film.json` until every board card is honest. This is the gate that stops a weak board reaching render.

## 5. Before you output

Re-check: valid JSON · `outro.at` = `line:<LAST>` (the last line) · every camera/chip `at`/`until` word is in `script` · no camera beat on the final line · all `y` ≤ `_h` · the board (`board/sheet.jpg`) was rendered and every card's picture matches its VO line. Output the JSON only.

**Save the board for the dashboard.** If the prompt included a "Save your board for the dashboard" path, copy your rendered `<workDir>/board/sheet.jpg` to that exact path before you output (`cp <workDir>/board/sheet.jpg "<that path>"`, creating the parent dir if needed). The dashboard shows this image on the storyboard version row, so a missing or stale board means the reviewer and Tiago can't see what you built.
