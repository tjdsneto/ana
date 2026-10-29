# Spec 09 — The craft lives in worker skills + tools, not engine code

**Status:** draft to build against. Realigns how the video craft is produced after spec 08's critiques found the shipped renders were storyboard scaffolding spoken over near-black cards. Two shifts: (1) the craft moves out of engine TypeScript into **skills the `claude -p` workers run**, backed by thin **tools**; (2) "render" is not one engine — it is a **storyboard-first timeline assembled from per-scene bits**, and a production **step chooses the family** that decides how those bits are made. Grounded in the reverse-engineering research under the parent's `research/` (recipe-convergence, the real-ui-launch-film pipeline, the WPVibe generative teardown).

## Principle 1 — the craft is skills + tools, the engine stays generic

The autonomy engine knows nothing about video. Everything video-specific — brief, moodboard, storyboard, capture, render, voice, mix, and the review of each — is a **skill a worker agent follows**, not TypeScript in the loop. Where a skill needs heavy or deterministic work (encode video, synthesize speech, drive a browser, force-align words), it calls a **thin tool** (a binary/script on the worker's PATH), but the orchestration and judgment stay in the skill, run by the worker.

The engine's only job for a leaf: dispatch a `claude -p` worker with the node's skill available (cwd = craft root with `.claude/skills/`, spec step below) and the node's inputs, then record the artifact. No `RenderClient`, no `VoiceClient`, no `contract.rendered` special case.

## Principle 2 — one storyboard, many bits, one assembler

There is no master render engine. The research finding is blunt: *"the render engine is nearly invisible"* — swappable. What is constant is a **storyboard-first artifact** with **word-level timing**, and **ffmpeg** as the one thing that assembles the final cut. Generative/avatar engines (HeyGen, Higgsfield, Claude Motion, Gemini) **produce bits** — per-shot clips, character stills, generated screens — that get placed on the storyboard timeline and muxed. Even the fully-generative WPVibe pipeline assembled its Higgsfield/Seedance clips with a Python EDL + ffmpeg. So:

- the **storyboard** (timeline: scene → visual source + on-screen text + VO line + sound) is the master spine;
- each scene's **visual source** is produced by whatever engine fits (real-UI capture, HTML/GSAP, generative clip, image);
- **assemble** = ffmpeg: concat/overlay/crossfade the bits, lay the VO + ducked music to −14 LUFS, burn captions, transcode.

### The two families (and the step that chooses)

The craft splits into two render families sharing the storyboard-first root. **A production step — the brief/script — must classify the video into a family (or mixed)**, because the family decides the storyboard dialect, the capture needs, and the per-scene producers:

- **Family A — real-UI product/feature demo.** Capture the product's **real** screens (Playwright / DevTools) as stills ("plates"), animate with an HTML/GSAP Ken-Burns camera, anchor every cut/click/title to a **VO word**. Reference pipeline on disk (below). For demos.
- **Family B — generative brand/launch film.** No real plates; assets/motion generated (Gemini / GPT-Image → Claude Motion / Higgsfield Seedance), from a moodboard + 3-bucket reference folder. For brand films.

The storyboard artifact carries **two row dialects** under one schema: Family A rows anchor events to VO words (→ a `film.json`-shaped brief); Family B rows carry a *description · VO · SOUND* cell per beat (→ a generation/motion brief). Both are storyboard-first and human-approved before render; only the render target differs. **Classifying the family is an explicit node output**, not an implicit default.

## What this changes in the current repo

Spec 08's renders were scaffolding for two reasons, both being fixed:

1. **The skill seam was nominal** — the worker never loaded a skill. **FIXED (commit 745f9cd):** the node's skill now loads into the worker — see "Skill-loading, resolved" below.
2. **Render was pure engine TS** — `loop.ts`'s `contract.rendered` branch called `LocalRenderClient` (ffmpeg drawtext cards) and fed the reviewer a text summary of a file it never saw. **Retire** that branch and the `RenderClient` / `VoiceClient` ports + the `render-*` / `voice-*` / `storyboard-parse` adapters as the craft path. Render becomes an ordinary subagent leaf whose skill assembles the storyboard via tools. The `Exec` port stays — it is how a tool is run, not craft logic.

## Skills (worker follows — markdown)

One per producing node, plus a modality-correct reviewer per node, in the craft skills dir loaded into the worker cwd.

| skill | node | what the worker does |
|---|---|---|
| `brief` | brief | write the brief AND **classify the family** (A / B / mixed) — the choice gates everything downstream |
| `moodboard` | moodboard | produce a **visual** moodboard (HTML/CSS + captured/generated imagery), not prose; a reviewer sees it |
| `capture-site` | input to A | visit the real product with the browser tool, capture **real screens** + short flow clips |
| `storyboard` | storyboard | author the timeline in the family's dialect (A: word-anchored `film.json`; B: description·VO·SOUND beats) |
| `voice` | voice | synthesize VO with the `tts` tool and **force-align words** → `words.json` (the timeline spine) |
| `render` | render | assemble: produce each scene's bits (per family) and mux with ffmpeg to a word-timed, −14 LUFS cut |
| `review:*` | every node | modality-correct review + the watch-and-fix loop — below |

### Reviewers perceive the real artifact + watch-and-fix (the spec 08 lesson)

A reviewer reads/sees/hears the artifact in its own medium — never a text proxy. Text nodes: read the text. Visual nodes (moodboard, storyboard frames): the worker renders and **looks**. Render node: the reviewer **runs `critique-video`** (watch + listen) as the approval gate — it builds the watch package (frames + transcript + signals) and dispatches the `video-critic` agent, ending in `VERDICT: pass | revise`. This mirrors how the real pipelines worked: *"Claude watched each cut as frame-grabs checked against the timings… each set of notes became a fix pass"* (6 rounds on WPVibe). "Approved" means a reviewer perceived pixels (and audio for the render), then the producer iterated — not a summary string passed once.

## Tools (workers call — thin binaries, not engine logic)

Deterministic/heavy work only. Techniques lifted from the on-disk reference pipeline `temp/reference-skills/real-ui-launch-film/` and PR `tn/enh/pr-video-aid` (awesomemotive/lindris-monorepo#544, author's own) — re-authored for this repo's naming rule; no monorepo/brand code copied.

| tool | does | source technique |
|---|---|---|
| `site-capture` | drive the real product (Playwright): screenshots + `page.video` flow clips, with redaction | `ui-test-pr` pattern; `save-page.js`/`plates.mjs` |
| `tts` | text → WAV, local **Kokoro** (`say` fallback) | `vo.py` / #544 `pr-tts-kokoro` |
| `word-align` | VO audio → per-word timings (`words.json`) via a forced aligner | `vo.py` (MMS/Whisper aligner) |
| `html-render` | HTML/GSAP storyboard → frames → MP4 (headless Chrome), the Family-A camera-over-stills render | #544 `pr-video-gen`; HyperFrames (HeyGen's OSS HTML→video layer) |
| `gen-shot` | (Family B, **reserved** — hosted/paid) generate a shot/character still/clip | Higgsfield/Gemini/Claude Motion — bit producers, not final render |
| `mix` | VO + ducked music + SFX → mastered −14 LUFS track | `mix.py` |
| `assemble` | place bits on the word-resolved timeline, mux audio, transcode (the one final render) | `build.py` resolver + ffmpeg mux |

The decoupling to copy (not the specific engine): a **resolver stage** (word → absolute seconds, from `words.json`) + a **presentation stage** (stills/GSAP or generated clips) + an **ffmpeg mux**, joined by JSON (`words.json` · `shots.json` · `sfx-cues.json`).

## Why this clears the bar spec 08 failed

- VO is an **authored** line spoken by Kokoro and **word-aligned** — not scraped markdown field names, and cuts land on words.
- On-screen text is authored copy in a real HTML layout (or a generated frame) — not a metadata line on a near-black card; tokens resolved before render.
- Visuals are **real product screens** (A) or deliberately-generated assets (B) — the rubric's "real screens / real UI", which slide-cards can never meet.
- Sound is mastered (−14 LUFS, ducked music) — not raw first-gen TTS.
- The render only passes when a reviewer **watched and heard it** via `critique-video`, and the producer iterated on the notes.

## Skill-loading, resolved (probed, CLI 2.1.312)

A worker run from a cwd holding `.claude/skills/<name>/SKILL.md` resolves that skill as `/<name>`. The engine directs it via `--append-system-prompt "…invoke the /<name> skill…"` and runs with `--permission-mode bypassPermissions` (not the old `--permission-prompts none`, which denied all tool use) so the skill can use the Skill tool + Bash/Read/Write. Verified end to end: a producer skill invoked a Bash tool and wrote an artifact file headlessly (exit 0, ~$0.21/call). Skill names map `:` → `-` (`review:craft` → `/review-craft`).

## Open questions (resolve before/while building)

- **Headless Chrome + the HTML/GSAP renderer in the worker container** — the heavy image bake (Chrome + ImageMagick). Prove `html-render` on host first (deps present), then bake.
- **Forced-alignment model size** (~1.2 GB for MMS; Whisper/Parakeet alternatives) — pick one small enough to bake.
- **Family B tools are hosted/paid** (Higgsfield/Gemini/Claude Motion) — stay **reserved** behind the `gen-shot` seam, same no-key posture as today; Family A is the fully-local path we build first.
- **Two engines exist**: the parent's Python `autonomy-engine/` vs this repo's TS engine. This repo (TS) is the one we develop; reconcile/retire the Python one as a separate pass (parent is not git — archive, don't hard-delete).
