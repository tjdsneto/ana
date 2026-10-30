---
name: storyboard
description: Turn the approved script + brief into a film.json — the word-anchored storyboard the render assembles. Family A (real-UI), grounded in the brand's provided site. Output ONLY the film.json.
---

# storyboard

Produce the **film.json** for this video: a word-anchored storyboard over the brand's **provided** site. The render consumes it verbatim, so it must be valid JSON, complete, and timed so the **product stays on screen for the bulk of the clip**. Output **only** the JSON (no prose, no code fence).

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
- **`tail_clip`.** Set `"tail_clip": "<absolute path to an .mp4>"` to append a produced clip after the explainer ("…and here's what it produced:"). The render skill concatenates it onto the end. `outro.at` (if used) goes on the last narrated line **before** the tail; the tail plays after.
- The hook/payoff is the *idea of the process*, not a product; on-screen chips label the current step, and the dashboard UI itself carries the detail.

## 4. Before you output

Re-check: valid JSON · `outro.at` = `line:<LAST>` (the last line) · every camera/chip `at`/`until` word is in `script` · no camera beat on the final line · all `y` ≤ `_h`. Output the JSON only.
