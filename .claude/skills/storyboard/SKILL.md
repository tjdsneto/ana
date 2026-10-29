---
name: storyboard
description: Turn the approved script + brief into a film.json — the word-anchored storyboard the render assembles. Family A (real-UI). Output ONLY the film.json.
---

# storyboard

Produce the **film.json** for this video: a word-anchored storyboard over the brand's **provided** site. The render tool consumes it verbatim, so it must be valid JSON and complete. Output **only** the JSON (no prose, no code fence).

## What you get

- the **brief** (the goal + the provided site URL, and any discovery notes about what the site actually shows),
- the upstream **script** (the spoken lines).

Use the real site URL from the brief. Only feature what the brief/discovery confirmed is actually on that site — never invent UI.

## The film.json shape (fill every field)

```json
{
  "title": "<short title>",
  "size": [1920, 1080],
  "url": "<the site URL, as it should read in the address bar>",
  "theme": { "bg": "#0A0A0C", "text": "#EFE9DD", "accent": "<brand accent hex>", "highlight": "<lighter accent hex>" },
  "voice": { "id": "af_heart", "speed": 0.98, "lead": 0.4, "gap": 0.3 },
  "tail": 1.0,
  "title_size": 104,
  "script": ["<VO line 1>", "<VO line 2>", "<VO line 3>", "<final/outro VO line>"],
  "capture": { "width": 1440, "remove": ["#cookie-notice", ".cookie", "[class*=cookie]", "[id*=cookie]"] },
  "plates": { "site": { "url": "<provided site URL>", "steps": [{ "wait": 3000 }] } },
  "marks": {},
  "title_card": { "kicker": "", "text": "<short payoff hook, 2-4 words>" },
  "expand_at": "<first spoken word>+0.5",
  "camera": [
    { "at": "<word from line 1>", "plate": "site", "focus": [720, 400], "zoom": 1.06 },
    { "at": "<word from line 2>", "plate": "site", "focus": [720, 1200], "zoom": 1.2, "glide": 0.6 },
    { "at": "<word from line 3>", "plate": "site", "focus": [720, 2000], "zoom": 1.2, "glide": 0.6 }
  ],
  "chips": [
    { "at": "<word>+0.1", "until": "<later word>-0.1", "text": "**<SHORT LABEL>**" }
  ],
  "outro": { "at": "line:<N>", "kicker": "<BRAND>", "text": "<tagline>", "sub": "<one line>", "cta": "<site domain>" }
}
```

## Rules that make it good (the good-video bar)

- **`script`** = the spoken lines, verbatim from the upstream script. The last line is the outro line; `outro.at` is `line:<its number>`.
- **Hook first.** `title_card.text` is a short payoff (the outcome/value), not a logo. The brand goes in the `outro`, not the open.
- **Word anchors.** Every `at`/`until` is a spoken word from `script` (first occurrence), e.g. `"forms"`, or `"Save+0.3"`, `"line:4"`, `"end"`. Change a word that isn't spoken and the render fails — only use words that appear in `script`.
- **Camera = a top-to-bottom tour of the real page.** `focus` is an `[x, y]` point in capture pixels (width 1440); use `x: 720` (centre) and increasing `y` to pan down the page across the beats (the renderer clamps so it never shows past the edge). 3-5 beats, each on a spoken word.
- **Length** ~12-18s of script (short wins). **One idea.**
- **Chips** label what's on screen (1-2, short). **Outro** has one CTA (the site domain).

## Before you output

- Valid JSON, every `at`/`until` word is present in `script`, `outro.at` points at the last line, plates.site.url is the provided site. Output the JSON only.
