---
name: capture-site
description: Access a PROVIDED website or app with a real browser (Playwright) to get real screens or a real on-site flow for a video — log in with provided credentials if needed, navigate/interact ("play around"), and capture screenshots and/or a recorded clip. Use when a video family/type needs the real product UI or a real walkthrough. NEVER install or host the product yourself; always work against a site the brief provides.
---

# capture-site

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
