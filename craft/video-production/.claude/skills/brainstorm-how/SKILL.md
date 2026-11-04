---
name: brainstorm-how
description: Creative-divergence phase for HOW to produce the winning concept. A host plans N independent production approaches (fanned out as `how-idea` children), each developed into a candidate DAG and peer-critiqued, then a fresh judge picks the approach that becomes the frozen production spine. The creativity lever sets N. Output ONLY the fan-out plan (the approach seeds).
---

# brainstorm-how

You are the **host** of the HOW brainstorm. The WHAT brainstorm already picked the winning *concept* (what the video should be); your job is to seed **N independent production approaches** — genuinely different ways to *make* that concept — to be explored in parallel. You do not pick the winner — a fresh judge (`brainstorm-how-select`) does, after the approaches are developed and peer-critiqued.

This is the same brainstorm primitive as the WHAT phase, pointed at production rather than concept. You read the brief, the winning concept (with its `EMPHASIS:` line), and the capability registry, and you diverge on *how* to build — never on *what* to build (that is settled) and never on *which stages exist* (the spine is fixed; see below).

## Hold to the craft bar

Before seeding approaches, read `craft/video-production/.claude/references/CRAFT-BAR.md`: apply **§A (universal taste)** in full, plus the **§B profile** matching this video's type. Every approach you seed is judged against both — an approach that cannot clear §A/§B is not worth seeding.

## N — the creativity lever

The node's creativity lever sets how many approaches to seed (default **3**). Honor it: more agents = wider divergence over the production space (and more cost — that is the lever's job to decide). Seed exactly N distinct approaches.

## Capabilities — know what you can bind

An approach is a set of bindings over the universal spine, so you must know what the engine can actually do. The production-capability registry (served by `get_capabilities` — call it) is the inventory: each entry is a generic capability class with its hard constraints (`produces`, `inputs`, `aspect`, `length`, `tier`, `hosted`) and prose guidance on when it shines. The classes available are:

- `screen-recording` — the real product UI, captured.
- `generative-image` — a generated still / plate / character.
- `generative-video` — a generated moving clip.
- `html-composition-render` — programmatic motion graphics (title cards, lower-thirds, animated captions, composed cards).
- `avatar-presenter` — a talking-head presenter from a script (a human / UGC feel; costs a tier).
- `tts` — word-timed voiceover.
- `music` — the soundtrack.
- `editing` — a derived cut from provided footage.

Diverge on **which classes bind to which stages** (acquire real-UI capture vs generative vs an avatar), **how heavy a stage runs** (one clean VO vs several sound-design passes; a light moodboard vs full look-dev), and **how a stage expands** (how many scenes / assets / passes). Never seed an approach that leans on a class the registry does not carry.

## The universal spine — fixed membership, varied binding

Every approach is built over the same fixed spine — **script → moodboard → storyboard → assemble-board → build → assemble → polish → final-review**. An approach never adds or drops a spine stage; it varies only the method/engine bound to a stage, how heavy the stage runs, and how it expands. That constraint is what makes N approaches comparable: they differ in production strategy, not in which steps exist.

## Read the concept's emphasis

The winning concept carries an `EMPHASIS:` line naming where its creative weight lies (e.g. `sound`, `visual-fx`, `generative`, `ugc-avatar`, `data-reveal`, or free text). Seed approaches that spend their budget where the concept leans — a sound-led concept wants approaches that run the audio heavy; a data-reveal concept wants approaches that invest in the hero-number/board craft. (The developed candidate honors the emphasis in detail; your seeds just point each approach at it.)

## Output contract (planner)

Output ONLY a fenced ```json block: an array of exactly N objects `{"name": string, "brief": string}`, one per approach, in no particular order. `name` is a short approach label; `brief` is the self-contained spec the how-idea agent needs — the production strategy (which capability classes bind to which spine stages, where it spends heaviness, how stages expand), how it honors the concept's emphasis, and any tier/cost trade-off it accepts. No prose outside the JSON.

```json
[
  {"name": "Capture-led, light audio", "brief": "Strategy: bind acquire to screen-recording for every real-UI beat; moodboard light; one clean tts VO pass; music a single bed. Spends heaviness on frame craft, not sound. Honors a visual-fx emphasis via html-composition-render overlays on the captures. Free-tier only."},
  {"name": "...", "brief": "..."}
]
```

## The rest of the phase (for the engine / downstream — not your output)

Each seed becomes a `how-idea` child (developed into a candidate `{stages:[…]}` DAG + self/peer-critiqued; see the `how-idea` skill). Then a fresh judge (`brainstorm-how-select`) reads all N candidate DAGs + their peer critiques and picks the single winner, whose DAG the engine materializes + freezes as the production's sibling spine. You, the host, do not judge — keep the pick independent of the agent that spawned the approaches.
