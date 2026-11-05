# Brand font store

Drop licensed / brand font files here so the engine worker can use them in a render. This directory is baked into the engine image **and** bind-mounted live into `engine-worker` (see `docker-compose.yml`), so a font dropped here is readable by the worker **without an image rebuild**. Policy + rationale: `docs/lisa/font-resolution.md` (issue 0017).

## How to provide a font

- Drop the file as `<Face>.woff2` (preferred — smallest) or `<Face>.ttf`, named by the face the moodboard declares as its **primary** (e.g. `MuseoSans.woff2`).
- The moodboard always names the primary face **and** a declared **substitute**: a *free, sourced, non-default* face in the same class (a real webfont, e.g. Google Fonts / OFL) — never a system font. Canonical example: Museo Sans → Nunito Sans.
- At assemble time, `assemble-board` stages the font into the board's `fonts/` dir, resolving in order: (1) the declared **primary** from THIS dir if its file is present; (2) otherwise the declared **substitute's** free webfont. A missing licensed primary degrades to the substitute — **never to a system serif/Arial** — and never blocks the render (a provisioning gap, not a quality fail).

## What NOT to do

- Do **not** put fonts in `tmp/` — it is `.dockerignore`d and not mounted, so the worker cannot see it (this was the original deadlock).
- Do **not** rely on a system font as the fallback; the substitute must be a declared sourced webfont.

## Licensing

Only drop fonts you are licensed to embed. The free substitute (a CC/OFL webfont) is the commercial-safe default whenever a licensed primary is not available here.
