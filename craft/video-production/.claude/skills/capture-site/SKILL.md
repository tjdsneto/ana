---
name: capture-site
description: Access a PROVIDED website or app with a real browser (Playwright) to get real screens or a real on-site flow for a video — log in with provided credentials if needed, navigate/interact ("play around"), and capture screenshots and/or a recorded clip. Use when a video family/type needs the real product UI or a real walkthrough. NEVER install or host the product yourself; always work against a site the brief provides.
---

# capture-site

> ## Hold to the craft bar
> Read `craft/video-production/.claude/references/CRAFT-BAR.md` (§A — the Camera check below is the §A1 frame-craft bar applied at capture time). Plates are judged against it.

Get the **real** screens for a video from the site the brief gives you — the brand's own running site/app. The worker drives a real browser (Playwright, via the `site-capture` tool), logs in if the brief provides credentials, navigates to the state worth showing, and captures it. This is how "real screens / real UI" (the good-video bar) is met.

## Hard rules

- **Provided site only.** Capture the URL(s) the brief names (the brand's site/app). If the brief names none, ask for one — do not invent a target.
- **Never install or host the product.** No spinning up WordPress, no plugin installs, no throwaway environments. The brand already runs the product; you capture *their* site.
- **Credentials come from the brief, at runtime.** Use them only to log into the provided site. Treat them as secrets: never echo them into output, never write them to a committed file, never put them in the film.json/script. Redact any real names / emails / keys that show on screen before the capture ships (`capture.redact`).
- **Read-only intent.** Navigate and screenshot/record. Don't submit destructive actions on a real site unless the brief explicitly asks and authorizes it.

## The tool

`node craft/video-production/tools/site-capture.mjs --spec <film.json> --out <workdir>` (run from `craft/video-production/tools`). Each plate is a live `url`; `steps` drive the browser before capture:

- `{ "waitFor": "<selector>" }` — wait for the screen to be ready.
- `{ "fill": ["<selector>", "<value>"] }` + `{ "click": "<selector>" }` — **log in** (fill user/pass, submit), or set a field.
- `{ "click": "<selector>" }`, `{ "wait": <ms> }` — navigate / open a panel / dismiss onboarding.
- `{ "remove": ["<selector>"] }` + `capture.remove` — strip cookie bars, chat widgets, promos.
- A plate with `"record": true` records the whole session to `assets/clips/<name>.mp4` — use it for a **flow clip** ("play around": click through a real task on camera).
- **`capture.mobile: true`** captures in a real phone context (mobile UA + touch + a tall portrait viewport) so the site serves its **mobile layout**, and the plate comes out tall. Use it for a `frame:"phone"` film: a tall plate lets the phone frame fit it to width without slicing it sideways. Set `capture.width` to the device's CSS width (e.g. `390`).

Outputs: `assets/shots/<plate>.jpg` + `src/shots.json` (mark rects for the Ken-Burns camera) for stills; `assets/clips/<plate>.mp4` for a recorded flow. Both feed the storyboard/render.

## Clean the frame — show only what we want

A raw capture of a live site carries **ephemeral noise** that never belongs in a product video: a popup/modal (exit-intent, newsletter, promo), a chat or mascot launcher pinned in a corner, a cookie/consent bar, a sticky promo/notification strip, a floating "back to top" button. The frame must communicate the one thing the beat is about — noise reads as unpolished and off-message.

`site-capture` **auto-cleans live captures by default**: before the screenshot it removes only **fixed/sticky, overlay-shaped** nodes (a centered modal, a corner widget, an edge bar), and it **never removes an ancestor of the hero** (so the real content survives). It is deliberately conservative — it strips chrome, not content.

Controls (all under `capture`):

- **`clean`** (default `true`) — the auto-clean pass. Set `false` only when the overlay *is* the subject (e.g. you are demoing the popup itself).
- **`hero`** — a CSS selector for the element that must survive the clean (what the beat is about). Set it when the page has no clear `<h1>`/`<main>`, so the guard protects the right thing. If a clean pass hides the hero, the tool logs `WARNING … hero not visible` and you must fix it, not ship a blank plate.
- **`keep`** — selectors the clean pass must never remove (a deliberately-fixed hero element, a product nav you want shown).
- **`remove` / `hide`** + a `steps` `{click}` on the overlay's own close button — the **escape hatch** for site-specific cruft the heuristic misses (dismissing via the real close button is the most faithful; removing is the fallback).

The clean pass is a **gate, not a nicety**: after capture, LOOK at the plate. It must show the intended content, with no floating widget, no half-popup, no cookie bar — and it must not be blank. If it is noisy, add a `remove`/`keep`/`hero`; if it is blank, set `capture.hero` (or `clean: false`) and re-capture.

## Shot makeup — change the UI to focus the message

A capture is raw material, not a constraint. You may deliberately alter the shot to sharpen what the beat is about — that is craft, not cheating. The clean pass is only the automatic floor of this. Makeup runs a spectrum, all legitimate:

- **Declutter** — remove/hide anything off-message (a link-heavy nav, a second CTA, a busy sidebar) so the one thing the beat shows dominates.
- **Calm it** — pause carousels/animations/spinners so you don't catch a mid-transition; force the brand font to load; fix a broken-image slot.
- **Emphasize** — enlarge the feature in focus, dim or blur the rest, set a clean scroll position, open the panel the beat is about.
- **Restyle / swap content** — recolor toward the brand ground, replace lorem/placeholder or a messy real row with clean representative content, simplify a dense dashboard to the subset you are narrating.
- **Gen-AI edit** — regenerate a cleaner version of the screen, de-noise, upscale, or compose a simplified UI when CSS/DOM can't get there.

### Pick the method by the goal — gen-AI is one option, not the default

Decide by *what the change is*, and reach for the lightest, most repeatable method that achieves it:

- **Already a state the product can reach** → drive the real app there with `steps` (click / scroll / fill). Most faithful; no edit at all.
- **A DOM-expressible change** (hide or remove an element, restyle, recolor, set a font, pause an animation, swap text or placeholder, reposition, set the scroll) → **CSS/DOM** via `capture.hide` + a per-plate **`js`** string, run in the page before the screenshot (the same place the clean pass lives). Deterministic, exact, cheap, re-runs identically — prefer it whenever the change lives in the DOM.
- **Something the DOM can't reach** (a messy embedded image or illustration, a texture, an artifact, or a cleaner composed screen that would be fiddly to hand-build) → a **gen-AI post-capture pass** on the saved plate (`craft/video-production/tools/image/gemini-image.py`). Powerful, but non-deterministic — drift, AI-slop risk, varies per run — so use it when CSS/DOM would be harder or can't express the goal, never by default.

Often the CSS tweak is the easy win; sometimes the gen-AI pass is the straightforward one. Let the goal pick the method, not habit.

**The limit — be truthful to the product, not to the pixels.** Makeup must sharpen the real message, never fake the claim:

- Show only what the product **actually does** — don't add a feature, button, or flow it doesn't have.
- A **real result / number / receipt stays real** — never edit a metric into a better one; representative or placeholder data must be plausible and not a specific false claim.
- Stay **on-brand and consistent** with the other shots — a gen-AI edit that drifts into generic AI-slop, or clashes with sibling scenes, is a revise.
- Keep it **believable** — seamless enough not to read as a botched fake; if a shot is openly simplified, let it read as **clearly stylized** (the craft-bar rule), not a counterfeit of the literal product.

Rule of thumb: **you can make the true thing clearer; you can't make a false thing look true.**

## Camera check — VIEW every plate and judge it for the frame

Cleaning is mechanical; **camera-readiness is a judgment call, and it is yours to make.** You can see images — so after each capture, **open the plate (and the mobile plate especially) and look at it as it will appear on camera.** The auto-clean removing noise is necessary, not sufficient; a clean capture can still be wrong for the frame. Walk this rubric, and if any point fails, **remedy and re-view** — do not hand a weak plate upstream and hope the reviewer catches it.

- **Right screen + state.** It shows the thing this beat is about (the feature open, the result on screen, the hero), not a generic landing or a half-loaded view.
- **Loaded.** No lazy-load placeholders, spinners, broken images, or fallback fonts.
- **One idea, framed.** A coherent section fills the frame. Reject a capture that is a **big dead band** (an empty nav bar / hero whitespace with the real content tiny), or that **slices content mid-element** at the edge (half a row of cards, a sentence cut in two), or that is a **busy wall** of everything at once.
- **Legible at its on-screen size.** A phone sits *small* in the frame — a dense desktop-style grid shrinks to unreadable. Favor **one clear thing**: the headline, or a single feature, not the whole page squeezed.

**Mobile is where this bites** (worked example: a marketing home page captured tall gives a dead navy nav band up top, big whitespace, then a feature grid sliced mid-row at the bottom — three failures at once). Remedy: frame to a single coherent section — trim the dead chrome band, stop the frame in whitespace (not through a card row), and show one idea the viewer can read at phone scale.

Remedies, in order: drive to the right state with `steps`; re-capture at a different scroll position or a specific element/section rather than the whole page; adjust the viewport; pick a cleaner page. Loop capture → view → judge → remedy until the plate is camera-ready. This is the producer's job, upstream of any reviewer.

## When in the loop — two phases

- **Discovery (briefing / script).** Before the brief or script is settled, use `capture-site` to explore the real product — log in if it's inside the app, click around, see what features and screens actually exist and are demonstrable. Feed that back: the script may only feature what discovery **confirmed is real** ("we have that → put it in"). This is what keeps the video grounded in the product instead of scripting fiction.
- **Footage (render).** When the script calls for a real walkthrough — a user browsing/using the app — record that flow (`record: true`) as the clip the render cuts in.

Same skill both times. Always a target the brief provides that is **already set up, running, and reachable from the worker** — never something you stand up yourself.

## Two capture shapes

- **Stills (plates)** — the common case: screenshot the real screen(s), measure `marks` (selectors the camera focuses on). The render pans a Ken-Burns camera over them. Give a plate per state you want to show (e.g. before/after an edit) so the render can cut between them and *demonstrate* a change, not just pan.
- **Flow clip (`record: true`)** — when the family/type is a real walkthrough: log in, perform the task on the real app, and keep the recording as footage the render cuts in.

## Credentials — how to pass them safely

The brief carries them (e.g. a login URL + user + a secret). Inject at call time; never commit. Example login steps (values come from the brief at runtime, not hard-coded here):

```
"steps": [
  { "waitFor": "#user_login" },
  { "fill": ["#user_login", "<BRIEF_USER>"] },
  { "fill": ["#user_pass", "<BRIEF_PASS>"] },
  { "click": "#wp-submit" },
  { "waitFor": "#wpadminbar" }
]
```

## Checks before handing the capture upstream

- Right screen, fully loaded (not a spinner / login wall / cookie bar).
- **Frame is clean** — no popup, chat/mascot launcher, cookie bar, or sticky promo left in shot; and the auto-clean did not blank the hero (no `WARNING … hero not visible`). Fix with `capture.remove`/`keep`/`hero` and re-capture.
- **Camera-ready** — you VIEWED the plate (see "Camera check") and it frames one readable idea: no dead band, no content sliced at the edge, legible at its on-screen size. Reframe and re-view if not.
- Marks found (the tool prints which), so the camera has targets.
- No leaked PII/keys on screen (redacted).
- For a flow clip: the task actually completes on camera.
