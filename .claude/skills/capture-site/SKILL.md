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

`node craft/tools/site-capture.mjs --spec <film.json> --out <workdir>` (run from `craft/tools`). Each plate is a live `url`; `steps` drive the browser before capture:

- `{ "waitFor": "<selector>" }` — wait for the screen to be ready.
- `{ "fill": ["<selector>", "<value>"] }` + `{ "click": "<selector>" }` — **log in** (fill user/pass, submit), or set a field.
- `{ "click": "<selector>" }`, `{ "wait": <ms> }` — navigate / open a panel / dismiss onboarding.
- `{ "remove": ["<selector>"] }` + `capture.remove` — strip cookie bars, chat widgets, promos.
- A plate with `"record": true` records the whole session to `assets/clips/<name>.mp4` — use it for a **flow clip** ("play around": click through a real task on camera).

Outputs: `assets/shots/<plate>.jpg` + `src/shots.json` (mark rects for the Ken-Burns camera) for stills; `assets/clips/<plate>.mp4` for a recorded flow. Both feed the storyboard/render.

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
- Marks found (the tool prints which), so the camera has targets.
- No leaked PII/keys on screen (redacted).
- For a flow clip: the task actually completes on camera.
