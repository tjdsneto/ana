# Overnight run — decision log

Started 2026-10-28 ~21:49 -03. Goal (Tiago, before bed): web app that shows a video production and
its nodes updating live — artifact production, reviewer back-and-forth, versions until approval, with
timestamps + session id + interaction duration + token usage. Use real `claude -p` for production.
Produce a few videos for Awesome Motive (explore their site, pick goals). Animatics via motion. By
morning: video examples + web-app page captures. Be resourceful, don't get stuck, simplify only after
trying hard, and never backtrack on prior decisions.

This log records the judgment calls made while Tiago is asleep.

## Framing decisions

- **D1 — "claude motion / animatics tool":** no Claude product does video/animatics, and no external
  video-gen keys are available (locked: render stays offline/stubbed until keys land). Resolution:
  treat "animatics" as **ffmpeg-driven motion** on the existing `LocalRenderClient` — Ken Burns
  zoompan, crossfade transitions, animated captions — so it stays keyless and respects every prior
  decision. If motion proves too fiddly in ffmpeg, fall back to the static-card render already proven.
- **D2 — brand names:** the repo naming rule (no brand/product names in `repo/`) stands. "Awesome
  Motive" is **production content**, not repo source — it lives only in runtime briefs + the produced
  artifacts under `server/data/artifacts/` (gitignored). No AM name lands in committed code/specs/docs.
  The committed sample storyboard stays generic.
- **D3 — GoFlow timer:** not started. CLAUDE.md requires explicit confirmation to start/stop a timer;
  Tiago didn't give it. Noting rather than assuming.
- **D4 — Watts / dev-env claim:** skipped. That coordination is for the resource-limited Lindris
  testing host and its clones; this is an isolated local Docker stack for am-videos, not that box.
- **D5 — real-claude cost control:** pick a modest model (sonnet, not opus) via SUBAGENT_MODEL, cap
  the run with SUBAGENT_MAX_CALLS (hard process ceiling), keep SUBAGENT_MAX_BUDGET_USD per call, and
  check usage periodically. Prefer 2–3 good videos over many. Subscription quota, not dollars, but the
  weekly window is finite.
- **D6 — autonomous gates:** Tiago is asleep, so a small **auto-pilot dev harness** drives the human
  gate (approve presentable + budget). The internal reviewer loop already produces the version
  back-and-forth on its own; the harness may inject one feedback round on a node to demonstrate the
  denied→revise→approve path in the UI.

## Running log

(appended as work proceeds)
