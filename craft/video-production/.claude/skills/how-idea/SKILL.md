---
name: how-idea
description: Develop ONE production approach seeded by the brainstorm-how host into a concrete candidate — a {stages:[…]} DAG over the universal spine, with each stage's method/engine and heaviness bound from the capability registry — then peer-critique the sibling approaches and vote which is strongest. One of N parallel how-idea agents in the HOW brainstorm phase.
---

# how-idea

You develop **one** production approach (the seed in this unit's spec) into a concrete candidate: a DAG over the fixed universal spine, with every stage bound to a method/engine and a heaviness. You are one of N parallel how-idea agents; later you also judge your peers. Keep a production-engineering mindset anchored on the winning concept — your job is to make *that concept* as well as the capabilities allow, not to re-open what the video is.

## Hold to the craft bar

Before developing your approach, read `craft/video-production/.claude/references/CRAFT-BAR.md`: apply **§A (universal taste)** in full, plus the **§B profile** matching this video's type. Your approach is judged on whether the pipeline it defines can actually clear §A/§B.

## Know your capabilities

Your bindings must be real. The production-capability registry (served by `get_capabilities` — call it) is the inventory: each entry is a generic capability class with its hard constraints (`produces`, `inputs`, `aspect`, `length`, `tier`, `hosted`) and prose guidance. The classes: `screen-recording`, `generative-image`, `generative-video`, `html-composition-render`, `avatar-presenter`, `tts`, `music`, `editing`. Bind each stage only to a class the registry carries, and match it to the brief — an approach's `aspect`/`length`/`tier`/`placement` must fit the class's constraints (e.g. don't bind a 20s beat to an `avatar-presenter` class capped below it, don't bind a `paid`-tier class if the brief is free-tier).

## Read the concept's emphasis — it drives heaviness

The winning concept (upstream) carries an `EMPHASIS:` line naming where its creative weight lies. **Read it and bias your approach to it** — the emphasis is what makes "how heavy a stage runs" honest: heaviness follows the idea's own weight, not a guess.

- `sound` (dominant) → weight the audio heavy: several sound-design passes, layered `music` + `tts`, SFX work — carry it in the audio `binding` at `build`.
- `visual-fx` / `generative` → weight the generative / motion-graphics stages: lean on `generative-image` / `generative-video` / `html-composition-render`, run the storyboard/board heavier.
- `ugc-avatar` → reach for the `avatar-presenter` capability for the presenter beats (accept its tier cost if the brief allows).
- `data-reveal` → weight the hero-number / board craft: a fuller `moodboard` + `storyboard`/`assemble-board` so the number gets its own legible, framed card.

Honor **free-text** emphases too: if the concept leans somewhere not in that list, spend your heaviness toward whatever the phrase describes. The dominant weight gets the budget; a `(secondary)` weight gets some; everything else stays light. A dominant emphasis you leave light is a weak approach — the judge will mark it down.

## 1. Develop your approach into a candidate DAG

From your seed brief + the brief + the winning concept, decide, **for each stage of the universal spine** — `script → moodboard → storyboard → assemble-board → build → assemble → polish → final-review`:

- **The method/engine bound** — which capability class (if any) the stage uses, matched to the brief. The sharpest choices are at `build` (acquire real-UI capture via `screen-recording` vs generate via `generative-image`/`generative-video` vs an `avatar-presenter` walkthrough) and the audio inside it (`tts` + `music`, light vs layered).
- **How heavy it runs** — moodboard light vs full look-dev; one clean VO vs several sound-design passes; a single pass vs iterate. Carry this in the stage's `binding`.
- **How it expands** — roughly how many scenes / assets / passes the stage fans into (the real fan-out happens later; name the scale).

Never add or drop a spine stage. Keep it a candidate a judge can compare against the sibling approaches — the bindings and heaviness, not the finished film.

### Emit the candidate

Emit your approach as a fenced ```json block of the shape `{"stages": [{"id": string, "type": string, "deps": [string], "binding"?: object}]}`:

- Exactly the eight spine stages, in order; `type` is the spine stage's node type; `id` is a key the later stages name in `deps`.
- `deps` reference only **earlier** stage ids.
- `binding` carries this stage's chosen method/heaviness (e.g. `{"acquire": "screen-recording", "heaviness": "full"}`), so the materialized stage producer honors it.

```json
{"stages": [
  {"id": "script",       "type": "script",        "deps": []},
  {"id": "moodboard",    "type": "moodboard",     "deps": [],                        "binding": {"heaviness": "light"}},
  {"id": "storyboard",   "type": "storyboard",    "deps": ["script", "moodboard"]},
  {"id": "assemble-board","type": "assemble-board","deps": ["storyboard"]},
  {"id": "build",        "type": "build",         "deps": ["assemble-board"],        "binding": {"acquire": "screen-recording", "audio": "tts+music", "heaviness": "full"}},
  {"id": "assemble",     "type": "assemble",      "deps": ["build"]},
  {"id": "polish",       "type": "polish",        "deps": ["assemble"]},
  {"id": "final-review", "type": "final-review",  "deps": ["polish"]}
]}
```

Before the JSON, give a short prose rationale (2–4 sentences): the production strategy, where it spends its budget, and the trade-offs it accepts. The JSON is the candidate the judge compares.

## 2. Peer critique + vote

When you are given the sibling approaches (the other N−1 candidate DAGs), critique each briefly — its strongest and weakest point as a way to make *this concept* within the capabilities — then name which of **all N** (including your own, honestly) you judge strongest, and why in one line. Be a fair critic, not an advocate for your own: the phase works only if the vote is honest.

## Output

Your rationale + candidate DAG (section 1). When peer critique is requested, append:

```
PEER CRITIQUE
- <approach name>: <strength> / <weakness>
  ...
BEST: <approach name> — <one-line why>
```
