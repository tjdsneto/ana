# Spec 09 — The craft lives in worker skills + tools, not engine code

**Status:** draft to build against. Realigns how the video craft (render, voice, site capture, review) is produced after spec 08's critiques found the shipped renders were storyboard scaffolding spoken over near-black cards. Supersedes the "render is a TS `RenderClient` adapter" approach for the craft path. The engine stays generic (spec 03); the craft moves into skills the `claude -p` workers run, backed by a few thin tools.

## The principle

The autonomy engine knows nothing about video. Everything video-specific — how to moodboard, storyboard, render, voice, capture a real product screen, and how to *review* each of those — is expressed as a **skill a worker agent follows**, not as TypeScript in the loop. Where a skill needs to do heavy or deterministic work (encode a video, synthesize speech, drive a browser), it calls a **thin tool** (a binary/script on the worker's PATH) — but the orchestration and judgment stay in the skill, run by the worker, not baked into engine code.

Engine code's only job for a leaf: dispatch a `claude -p` worker with the right skill available and the node's inputs, then record the artifact it produces. No `RenderClient`, no `VoiceClient`, no `contract.rendered` special case.

## What this changes in the current repo

Two gaps make today's output scaffolding, both fixed by this spec:

1. **The skill seam is nominal — the worker never loads a skill.** `loop.ts` passes `skill: contract.skill ?? node.type` into the runner, but `claude-runner.ts` builds its `claude -p` args from the prompt / model / resume / system-prompt only and **drops the skill**. So every producer and reviewer runs off a generic prompt with no craft guidance. Fix: actually materialize the skill into the worker — run it in a cwd whose `.claude/skills/` holds the craft skills (headless `claude -p` auto-discovers them) and instruct it to invoke the node's skill, or inject the skill body via `--append-system-prompt`. The `skill` label must map to a real loaded skill.

2. **Render is pure engine TS — the opposite of skill-based.** `loop.ts`'s `contract.rendered` branch calls `this.render.render()` (`LocalRenderClient`, ffmpeg drawtext cards) and feeds the reviewer a text summary of a file it never saw. Retire that branch and the `RenderClient` / `VoiceClient` ports as the craft path. The render leaf becomes an ordinary subagent leaf whose `render-video` skill authors the storyboard and calls the `video-gen` tool. (The `Exec` port stays — it is how a tool is run, not craft logic.)

## Skills (worker follows — markdown)

One per producing node type, plus a modality-correct reviewer per node. Live in the craft skills dir loaded into the worker cwd (the repo's `.claude/skills/`, mirroring the parent repo's `lisa-server/skills`).

| skill | node | what the worker does |
|---|---|---|
| `moodboard` | moodboard | produce a **visual** moodboard (HTML/CSS + captured imagery), not prose |
| `storyboard` | storyboard | author the scene list as `{label, caption, voiceover, image?}` beats + the storyboard HTML — the structured contract the render consumes verbatim (no markdown scraping) |
| `capture-site` | (input to moodboard/storyboard) | visit the real product with a browser tool, capture **real screens** + short flow clips |
| `render-video` | render | turn approved beats + storyboard HTML into an MP4 via the `video-gen` + `tts` tools; verify the output |
| `review:*` | every node | modality-correct review — see below |

### Reviewers must perceive the real artifact (the spec 08 lesson)

A reviewer skill reads/sees the artifact in its own medium — never a text proxy:

- text nodes (briefing, script): read the text (as today).
- visual nodes (moodboard, storyboard): the reviewer **sees** the rendered board / scene frames (the worker renders frames and looks at them).
- render node: the reviewer **runs `critique-video`** (watch + listen) as the approval gate — the skill already builds the watch package (frames + transcript + signals) and dispatches the `video-critic` agent, ending in `VERDICT: pass | revise`. "Approved" means a reviewer perceived pixels (and audio for the render), not a summary string.

`critique-video` already exists in `.claude/skills/`; wire it as the render node's reviewer.

## Tools (workers call — thin binaries, not engine logic)

Deterministic/heavy work only. Technique ported from PR `tn/enh/pr-video-aid` (awesomemotive/lindris-monorepo#544, author's own) and Kokoro — re-authored for this repo's naming rule; no monorepo-specific or brand code copied.

| tool | does | source technique |
|---|---|---|
| `video-gen` | HTML storyboard → MP4 (+GIF): headless Chrome captures a deterministic `?filmstrip=N` strip in one pass, ImageMagick slices, ffmpeg encodes — fully local, no host/credentials | #544 `pr-video-gen` |
| `tts` | text → WAV via Kokoro (local `kokoro-onnx`), `say` fallback | #544 `pr-tts-kokoro` (the "kokoro" voice asked for; replaces piper) |
| `site-capture` | drive a real product site with Playwright: screenshots + native `page.video` flow recordings, for the storyboard's `image` scenes | `.agents/skills/ui-test-pr` pattern (Playwright / chrome-devtools MCP: navigate → screenshot → snapshot → click → fill) |
| `signals` / `frame-extract` | sound+motion measurements + keyframes for the critique | already in `critique-video/scripts` |

## Why this clears the bar spec 08 failed

- VO is an **authored** `voiceover` beat spoken by Kokoro — not scraped markdown field names.
- On-screen text is an authored `label`/`caption` in a real HTML layout — not a metadata line on a near-black card; `{tokens}` are resolved by the worker before render.
- Visuals can be **real product screens** from `site-capture` — the rubric's "real screens / real UI" that slide-cards can never meet.
- The render only passes when a reviewer **watched and heard it** via `critique-video`.

## Open questions (resolve before build)

- ~~Exact skill-loading mechanism for headless `claude -p`~~ **RESOLVED (probed, CLI 2.1.312).** A worker run from a cwd holding `.claude/skills/<name>/SKILL.md` resolves that skill as `/<name>`. The engine directs it via `--append-system-prompt "…invoke the /<name> skill…"` and must run with `--permission-mode bypassPermissions` (not the old `--permission-prompts none`, which denied all tool use) so the skill can use the Skill tool + Bash/Read/Write. Verified end to end: a producer skill invoked a Bash tool and wrote an artifact file headlessly (exit 0, ~$0.21/call). Skill names map to slash commands with `:` → `-` (`review:craft` → `/review-craft`).
- Kokoro model is a large binary outside the repo (`KOKORO_HOME`); baking it into the engine image needs an arch/size pass like piper got (the reserved `voice-kokoro.ts` becomes the tool wrapper, not an engine adapter).
- Playwright in the worker image (browser download size) and how the worker reaches the target site from inside the container.
- Inline-player embedding is already handled by the web app (spec 06 / `/api/video`); unaffected.
