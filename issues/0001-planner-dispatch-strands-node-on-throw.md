# 0001 — A planner dispatch that throws strands the node in-progress (production becomes unrecoverable)

**Status:** open
**Severity:** medium-high (robustness / reliability)
**Area:** engine loop — `claimReadyNode` / plan dispatch

## Summary

When a node's dispatch throws — in particular a `planner` node whose produce step fails to yield parseable children — the node is left with `status = "in-progress"` and is never reset. The worker's claim seam only ever picks `status = "pending"` nodes, so the stranded node is never re-dispatched. The whole production hangs forever with no error surfaced to the client.

## Repro

1. Run a `video-project` production whose first planner node (`brainstorm`) produces output that can't be parsed into children. (Observed with the fake/stub subagent — see issue 0002 — but any producer that throws mid-dispatch reproduces it.)
2. Worker logs once:
   `dispatchPlan: planner "brainstorm" returned no children — [stub brainstorm] draft`
   then goes silent.
3. `get_status` shows `brainstorm:in-progress` indefinitely. No further dispatches, no error on the production. The client polls forever.

## Root cause

- `PgStore.claimReadyNode()` selects only `where(status = "pending")` (shared/src/store/pg.ts). A node is marked `in-progress` at the moment it is claimed, before dispatch runs.
- If dispatch then throws, nothing resets the node back to `pending` (or to a failed/needs-work state). It stays `in-progress`, which `claimReadyNode` never re-selects.
- The error is logged as a `worker.drain_error` but is not persisted to the node or the production, so `get_status` / the client never learn the production is dead.

## Impact

- A single produce/plan failure kills the whole production silently. No retry, no escalation, no signal to the caller — the opposite of the "resume after a crash / durable state" promise (spec 05, F3/F9).
- Hits every planner node (`brainstorm`, and the `build` fan-out) and any leaf whose producer throws.

## Suggested fix

- On a dispatch error, don't leave the node `in-progress`. Either reset to `pending` with an attempt counter and retry up to a cap (mirroring `MAX_REDOS`), or mark it failed/escalated and emit a `chat_output` so the client sees it.
- Surface the terminal failure on the production root status so `get_status` reflects a dead/failed production instead of a permanent `in-progress`.
- Consider a lease/heartbeat on claimed nodes so a node claimed by a worker that died (vs. threw) is also recoverable.

## Found via

Full-loop smoke (`scripts/smoke/full-loop.mjs`), 2026-11-03. Stranded production `nd_4e33ef36a11a41d9a5504e1430fd1d13`.
