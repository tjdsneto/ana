# 0002 — Fake subagent can't drive planner nodes (blocks the $0 full-loop smoke)

**Status:** open
**Severity:** low-medium (test infrastructure)
**Area:** engine — fake `SubagentRunner` / stub producers

## Summary

With `SUBAGENT_ENGINE=fake`, the subagent runner returns a flat canned string (e.g. `[stub brainstorm] draft`). That is fine for `leaf` / `expand` nodes, but `planner` nodes need their produce output parsed into a list of children to fan out (brainstorm → `idea` agents; `build` → cards/scenes). The stub output yields zero children, so `dispatchPlan` fails and — via issue 0001 — the production strands.

As a result, the fake/stub path can smoke the core loop (produce → present → `get_deliverable` → approve → unblock) for leaf/expand nodes, but **cannot complete a full `video-project`** end-to-end. The first planner node (`brainstorm`) kills it.

## Repro

`SUBAGENT_ENGINE=fake RENDER_PROVIDER=stub VOICE_PROVIDER=silent IMAGE_PROVIDER=stub`, then request a `video-project`. Briefing + research cycle fine; `brainstorm` strands.

## Impact

- No zero-cost, deterministic full-pipeline smoke. The only way to drive the whole `video-project` loop today is the real `claude` worker (real spend, slow).
- CI / regression coverage of the full loop is blocked until this is addressed.

## Suggested fix

- Teach the fake `SubagentRunner` (or the stub producers) to emit **planner-shaped** canned output for planner node types: a small fixed list of children (e.g. 3 concepts for `brainstorm`, N cards/scenes for `build`) so fan-out produces real child nodes deterministically.
- Keep it keyed off the node type / skill so leaf stubs stay flat and planner stubs return children.
- Pairs with issue 0001: even after this, a planner that genuinely fails should not strand the production.

## Found via

Full-loop smoke (`scripts/smoke/full-loop.mjs`), 2026-11-03.
