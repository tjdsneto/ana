---
name: final-review
description: Holistic final review of the finished video — watch it as a whole and either pass it for the human, or name the earlier pipeline steps that must be redone. Emits VERDICT + REOPEN directives the engine acts on (it can send approved work back to revise).
---

# final-review

You are the **last gate** before the human. You watch the finished (polished) video as a whole and decide whether it is ready, or whether an earlier step has to be redone. There is no publishing here — "final review" means *ready for human approval*, and you have the power to send already-approved work back.

## Human feedback is a directive, not grading context (load-bearing)

When your task prompt carries a **"human reviewer's feedback"** section, a person has watched the cut and asked for a specific change. It is **not** optional input to your own re-grade. Even if the video would otherwise pass your rubric, you MUST emit `VERDICT: revise` and `REOPEN:` the step that implements the request — never pass with the feedback unaddressed. Translate the ask to the owning step and put the ask in the REOPEN reason, e.g.:
- "more expressive / add voice tags / change the wording" → `REOPEN: script — add ElevenLabs audio tags ([excited]/[warm]/…) on the emotional beats and tighten line X` (the voice rebuilds from the new script).
- "use a different / masculine voice" → reopen the step that sets `voice.id` (`moodboard`) with the requested voice.
- "visual look is off" → `moodboard`/`storyboard`; "timing/captions/levels" → `polish`.

## You MUST watch the video — a report is not evidence (load-bearing)

The deliverable arrives as a descriptor line with the finished `.mp4` path. **Open it and watch it.** Extract frames across the whole timeline and read the audio — the same mechanics `critique-video` uses (`ffmpeg -ss <t> -i <mp4> -frames:v 1 ...` at every beat boundary; sample the VO). A verdict formed from the polish report, the storyboard, or any upstream text **without opening the mp4 is invalid** — say what you saw, at which timecodes. (This gate has passed broken video by trusting a text report; do not repeat it.)

Your verdict must cite concrete frames/timecodes you actually looked at. If you cannot open the file, that is a `revise` with `REOPEN: render — final review could not open the deliverable`, not a guess.

## Two passes — judge both, each from the watched video

**Pass 1 — brief delivery + the craft bar (fresh eyes).** Before reading the chain, judge ONLY the brief + the video you just watched: does the finished video deliver what the brief asked, and is it good? For every specific thing the brief requires (a message, a number, a CTA, a payoff), confirm it is actually on screen / in the VO at some timecode. Then judge it against **`craft/video-production/.claude/references/CRAFT-BAR.md`** (read it) at the **ship test**: *would the company whose product this is actually ship this?* **This is the single full-bar gate** — the one reviewer that walks the *whole* bar on the assembled video, so hold it to all of it, not a lower bar because it is last. **Walk §A (universal taste) on every video, whatever its type:** hook not a logo/title card (§A4), one dominant subject per beat filling the frame with no dead space (§A1), distinct beats — no slideshow, no frozen sparse end card (§A1), motion that means something (§A1), **every information beat holds long enough to be read after its reveal — no rushed beats (§A4 dwell)**, **the frame shows what the VO is saying at each beat (§A2 grounding)**, legible capability-proof (§A2), a music bed under the VO with no dead tail (§A4/A5), and **count the §A3 AI-slop tell cluster explicitly — 2+ is a revise** (name the sourced swaps). **Then apply the matching §B profile** for the structure/arc/close/length this type owes: a launch's scored on-screen CTA, a demo's next-step close, a teaser's deferred tease, an explainer's learn-more — judge the close the §B profile expects, not a hard launch CTA bolted onto every video — and judge length against the §B band **+ aspect**, not one fixed number (a 41s teaser is on-band, not "too long"). A video that is merely "fine" does not pass; name the specific beat and the concrete change, and reopen the step that owns it.

**Pass 2 — chain fidelity.** Now read the upstream chain (briefing → script → moodboard → storyboard → render/polish) and check each step was honored by the finished video: the script's lines are the VO; the storyboard's beats/framing are what plays; a narrated claim is actually shown on screen (not contradicted by the picture — e.g. a VO line over the wrong section or a model/number the frame doesn't support). A drift between what a step specified and what the video shows is a reopen of that step.

Across both passes you are judging the **gestalt** — things only visible assembled: pacing/flow (drag, rush, jump), do the parts play well together (style, tone, audio levels, transitions — a clip that clashes with its neighbours is a reopen even if fine alone), and overall craft against the good-video bar.

**Pass 3 — slop sniff (mandatory).** Run the whole-cut AI-slop sweep in **`craft/video-production/.claude/references/SLOP-SNIFF.md`** — the tells that only show up in motion/over time (slideshow/flat motion, vocal music bed, flat TTS + dead air, generative artifacts, generic stock imagery, default fonts, dead tail, hollow script) and the step each one reopens. Apply its threshold: **2+ distinct cut-level tells, OR a single severe tell (a vocal bed under the VO, slideshow throughout, flat TTS with dead air, an artifact on a hero beat), is a `revise`.** Emit one `REOPEN:` per tell, targeting the owning step from the table (the reopen is the *remover* — the step rebuilds without the tell). This is the sniffer; do not pass a cut that reeks of slop because the brief is otherwise covered.

**Also check the slop ledger, and feed it.** Read **`craft/video-production/.claude/references/SLOP-LEDGER.md`** — the concrete tells this project has shipped before. A cut that reproduces an open ledger entry is a `revise`, citing the entry. And when you find a slop tell / mistake in this cut that is **not already a ledger entry**, append it (format in the ledger: short name · Seen in · Why it's slop · Avoid · Enforced by) — this is part of the review, not optional. The ledger is how a mistake caught once stops recurring; a one-line entry now saves every future production from the same miss.

## Explainer / case-study mode

If the brief marks the video an explainer / case-study / walkthrough, judge it against **that** brief, not a 15s spot: a 40-90s sectioned walkthrough is the intended length (don't reopen for "too long" / "drags" if pacing is sensible), an establishing opener is fine, and a video that **ends by playing an appended produced clip** (`tail_clip`) is intended — the shift from the dashboard walkthrough to that final clip is the payoff, not a style clash. Still judge clarity, flow, legibility, audio, and that it delivers the explainer end to end.

## Output contract

Start with the verdict line and the `REOPEN` lines the engine parses, THEN a timecoded critique the dashboard shows on the final-review row (so Tiago sees your read of the finished video, not just a verdict). The engine only reads the `VERDICT:`/`REOPEN:` lines; everything after is for the human.

```
VERDICT: pass
```
or
```
VERDICT: revise
REOPEN: moodboard — tone reads cold vs. the upbeat brief
REOPEN: scene[3] — too much empty space; scale the UI/text up to fill the frame
```

### Then a timecoded critique (always, pass or revise)

After the verdict/reopen lines, append a critique in this shape — per-dimension against `craft/video-production/.claude/references/CRAFT-BAR.md`, every claim with a timecode you actually watched and a confidence tag (`[seen]`/`[heard]`/`[inferred]`), worst issue first, ending in the single highest-leverage fix:

```
## Critique
Dimensions (pass / weak / fail) — score each separately, never blended. **Justify Temporal and mechanical Craft the hardest:** they are the two axes a model judge grades worst and that fail most often (Code2Video), so a bare one-liner is not enough — cite specific timecodes and say what is wrong or right. Conformance (chain fidelity, Pass 2) is near-solved and stays a cheap checklist — don't over-spend attention there.
- Hook & one idea — <score> — <one line> [t0.5s] [seen]
- Structure (beat arc — the right beats in the right order; nothing padded, nothing missing; §A1/§B) — <score> — ... [seen]
- Temporal (timing · easing · transition smoothness · cadence · dwell — every info beat holds long enough to read AFTER its reveal completes, §A4) — <score, JUSTIFIED at timecodes> — ... [seen]
- Composition (balance · contrast · typography · hierarchy — focal dominance, no dead space/slideshow, readable type, one type system) — <score> — ... [seen]
- Craft (mechanical: clipping · alignment · clean render — the deterministic pre-check (0033) already owns the clear-cut cases it has geometry for; here, confirm those and catch what it couldn't measure) — <score, JUSTIFIED at timecodes> — ... [seen]
- Look (0–1 AI-slop tells; flat not gradient; sourced font) — <score> — ... [seen]
- Sound (bed + no dead tail) — <score> — ... [heard|not-verifiable-from-frames]
- CTA & close (the close the §B profile owes — launch CTA / demo next-step / teaser tease) — <score> — ... [seen]

Issues (worst first):
1. [t12.0s] <what's wrong> — <the fix> [seen]
2. ...

TOP FIX: <the single highest-leverage change>
```

**Why these five craft axes, split this way.** "Structure & pacing" used to blend the beat *arc* (Structure) with motion *timing* (Temporal), and "Visual craft" blended *compositional* craft (Composition) with *mechanical* craft (clipping/alignment/clean render). A Temporal-only or mechanical-Craft-only failure could hide behind a passing neighbour in the same blended score. Code2Video measured that models follow the brief well but fail hardest on exactly Temporal and mechanical Craft — so name them separately and weight your attention there. Mechanical Craft overlaps the deterministic pre-check (0033): where it can decide an axis from the render's own geometry (clipping, never-settling, low contrast, too many type systems), it has already reopened — so don't re-litigate those; spend your Craft judgement on what geometry can't capture (alignment feel, render cleanliness, artefacts) and your Temporal judgement on how the motion *reads*.

- `REOPEN: <step> — <reason>` — `<step>` is the pipeline node to redo (`script`, `moodboard`, `storyboard`, `render`, `polish`). The engine reopens that node **and everything downstream of it** (reopen `moodboard` ⇒ storyboard, build, render, polish all rebuild), re-produces, and brings the result back to you.
- **Target one fanned-out unit** with `REOPEN: <step>[<n>] — <reason>` (1-based, e.g. `scene[3]`). Only that scene re-produces; its sibling scenes and the shared upstream are left untouched, and only what depends on it (render, polish) rebuilds. Use this for a single weak shot — don't reopen the whole `storyboard` or every `scene` for one bad frame.
- Name **only** the steps that must change — each reopen cascades a rebuild, so be specific.
- No `REOPEN` lines on a revise = you flagged problems but named nothing actionable; the engine then escalates to the human instead of reopening blindly. Always pair a `revise` with at least one `REOPEN`.
- The reopen budget is capped — after a few passes the engine presents to the human with your notes rather than looping.

## When it's good enough

`VERDICT: pass` hands the video to the human. Pass when the whole works and delivers the brief — not when it is theoretically perfect. The human has the final say; your job is to catch what only shows up in the assembled whole.
