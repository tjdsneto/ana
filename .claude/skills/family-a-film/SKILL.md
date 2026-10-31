---
name: family-a-film
description: Produce a Family-A product/feature demo video — a real UI under a word-timed Ken-Burns camera. Use when the brief classifies as Family A (a product demo showing real screens), not a generative brand film (Family B). Orchestrates the craft tools (vo, site-capture, build, mix, render) and self-checks against the good-video bar before handing off.
---

# family-a-film

Produce a short product/feature demo in the **Family-A** style (spec 09): the real product UI, captured as stills, shown under a cinematic Ken-Burns camera, with every cut / highlight / caption anchored to a spoken word. This is the style that cleared the good-video bar the slide-cards failed.

**You are the producer.** The tools do the deterministic work (speech, capture, render); the judgment — the hook, the one idea, the word anchors, the distilled copy — is yours. Produce, then **watch your own output** and fix it before handing off.

## When this applies

- The brief is a **product/feature demo**: show real screens, a real flow, a real result. (Generative brand films with no real UI are Family B — a different skill.)
- You have, or can author, the product screen(s) to capture.

## The pipeline (five tools)

All tools live at `craft/tools/`. Run Python tools under the Kokoro venv python (`"$KOKORO_HOME/venv/bin/python"`); the `.mjs` tools under node with `craft/tools` as cwd (Playwright is installed there). Work in one film directory `<F>`.

1. **Author `<F>/film.json` + `<F>/script.txt`** — the storyboard. This is the craft; see "Authoring" below.
2. **Capture the real UI** — `node craft/tools/site-capture.mjs --spec <F>/film.json --out <F>`. Writes `<F>/assets/shots/<plate>.jpg` + `<F>/src/shots.json`. A plate is a live `url` or a saved/authored HTML `file`.
3. **Voice + word timing** — `vo.py --script <F>/script.txt --out <F>/media`. Writes `<F>/media/vo.wav` + `<F>/media/words.json` (every word timed — the timeline spine).
4. **Build the composition** — `build.py --root <F>`. Resolves word anchors → `<F>/index.html` (a seekable GSAP timeline) + `<F>/src/sfx-cues.json`.
5. **Mix** — `mix.py --root <F> [--music track.mp3 --start 18]`. VO + synthesized SFX (+ optional ducked music) → `<F>/media/mix.wav`, mastered to −14 LUFS.
6. **Render** — `node craft/tools/render.mjs --html <F>/index.html --audio <F>/media/mix.wav --out <F>/film.mp4 --fps 30 --no-master` (`--no-master` because mix already mastered; if you skip mix, feed `media/vo.wav` without `--no-master`).

Steps 2 and 3 are independent — run them in parallel. 4 needs both.

Three optional craft tools the chain also drives from `film.json` (no extra steps to run by hand — `make-film.sh` invokes them): **`music.py`** resolves the `music` field to a bed for `mix.py`; **`align.py`** replaces the TTS voice step when `audio` names a real voice clip (word-times it to `media/words.json`); **`captions.py`** burns word-timed captions onto the render (+ `.srt`) when `captions` is set. See the optional-fields note under Authoring.

## Authoring film.json (the craft)

The storyboard is word-anchored: every `at`/`until` is a second, or a voiceover word — `"Save"` (first spoken), `"Save#2"` (2nd), `"Save+0.3"`/`"Save-0.2"` (offset), `"line:4"` (start of script line 4), `"end"`. Change the script, re-run `vo`, and every cut/ring/chip/click re-flows.

Keys: `title · size [1920,1080] · url (address-bar text) · theme {bg,text,accent,highlight} · voice {id,speed,lead,gap} · tail · capture {width,base,redact,remove,hide} · plates {name:{url|file, js?}} · marks {key:"#selector"} · title_card {kicker,text} · camera [{at,plate,focus(mark or [x,y]),zoom,glide}] · clicks [{at,target}] · rings [{at,until,target}] · chips [{at,until,text}] · outro {at,kicker,text,sub,cta}`.

Optional fields the chain acts on automatically (see the tools below): `music` (`"library:<mood>"` / a bed path / `"generate:<prompt>"` → `music.py`) · `audio` (a real voice clip path → narration via `align.py` instead of TTS) · `captions` (`true` / `"karaoke"` / `"block"` / an overrides object → word-timed caption burn + `.srt` via `captions.py`).

The rules that make it good, not just working (from the good-video bar, `.claude/skills/critique-video/references/good-video-criteria.md`):

- **Hook + ONE idea.** The first ~3s earn the next. Say the one thing the video is about in a sentence; cut everything that serves a second idea.
- **Real screens only.** Capture the actual product (`url`) or author a faithful screen. Redact real names/keys/domains via `capture.redact`. Never a generic mockup.
- **Narration is a written script, not field names.** `script.txt` is spoken, human copy — a hook, the steps, a payoff. Gloss any jargon at first use. (The spec-08 failure was reading storyboard metadata aloud — never do that.)
- **Anchor events to words.** A ring appears on the word that names it; a chip holds across the beat; the cursor clicks on the verb. Use the `marks` to focus the camera on the thing being said.
- **CTA + end card.** One ask. The `outro` carries the brand and the next step.
- **Keep it tight.** Shorter wins; every beat earns its seconds.

## Getting the real product UI — the provided site (never install)

The rubric demands real screens. They come from the **site the brief provides** — the brand's own running site/app — captured via the **`capture-site`** skill. Never install or host the product yourself. Point `site-capture` live mode at the brief's URL; if the brief gives credentials, log in with them (`fill`/`click` steps); navigate to the screen worth showing; capture plates (+ `src/shots.json` marks) and/or a `record: true` flow clip. Capture a plate per state (e.g. before/after an edit) so the render can cut between them and *demonstrate* the change. See `capture-site` for the rules (provided site only, creds are runtime secrets, redact PII).

## Self-check before handing off (non-negotiable)

Run the render through the **`/critique-video`** skill — it watches + listens and returns `VERDICT: pass | revise` with timecoded fixes. Do NOT hand off a `revise`. Fix the film.json/script, re-run the affected tools, re-render, re-critique. Iterate (3–5 passes is normal) until it passes. "Approved" means a reviewer perceived the pixels and audio — not that a file was produced.

## Common fixes

- Camera shows past the plate edge → the clamp needs a taller plate or lower zoom; recapture or reduce `zoom`.
- A mark not found → the selector changed; fix `marks`, rerun `site-capture`.
- Caption overflows → shorten the chip/outro text (no wrapping in the cards).
- Flat/quiet audio → that's what `mix` fixes; always render from `media/mix.wav`.
