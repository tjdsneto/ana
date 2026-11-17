---
name: full-loop-smoke
description: Run the full-loop integration smoke — drive a production end to end through the client-facing MCP tools (request_video → poll status/inbox → get_deliverable → approve → until done) against the running stack, to prove the engine loop works. Use when verifying the engine after changes to the loop, the MCP server, the worker, the type registry, or the craft skills; when checking the client's tool surface end to end; or when a production hangs and you need to see where. This is a dev/ops skill (it runs no craft itself) and is NOT a worker craft skill.
---

# full-loop-smoke

Drive a production from a brief all the way to `done` over the **client-facing MCP tools**, exactly as the thin client would, and read where it gets. It proves the loop end to end: `request_video` → poll `get_status` + `inbox` → `get_deliverable` + `approve` each present → rollup → `done`. The harness runs **no craft**; the engine worker produces everything.

Harness: `scripts/smoke/full-loop.mjs` (run via `npm run smoke`). It's the automated counterpart to the client's `produce-video` skill — same 8 tools, same MCP HTTP transport the shipped `client/agent/.mcp.json` uses.

## When to use

- After touching the loop, the MCP server, the worker, the type registry, or craft skills — confirm a production still advances.
- When a production hangs — the per-node status progression shows the exact node it died on.
- To exercise the client tool surface (request/status/inbox/deliverable/approve/budget) against a real server.

## Prereqs — the stack must be up

1. **mcp-server** on host port `MCP_HTTP_PORT` (default **8790** — host `8787` is taken by chrome-bridge locally; the container still binds 8787 internally):
   `docker compose up -d mcp-server`
2. **A worker.** Two modes:
   - **Real** (`engine-worker`): real `claude` producers + reviewers, real local render + piper voice. Slow (minutes–tens), real spend up to `SUBAGENT_MAX_BUDGET_USD`. The only mode that completes a full `video-project` today.
   - **Fake/$0**: `SUBAGENT_ENGINE=fake` + `RENDER_PROVIDER=stub VOICE_PROVIDER=silent IMAGE_PROVIDER=stub`. Deterministic, free — but **cannot complete a `video-project`**: it strands at the first planner node (`brainstorm`) because the stub returns no fan-out children (see the project issue log, 0002 + 0001). Good only for leaf/expand paths.

### Gotcha — recreate the worker after any craft-path change

A worker container created before a craft move serves an **empty** `/repo/.claude/skills` (a `docker compose start` reuses the stale mount), so skill-required nodes fail with `Unknown skill: …` and the production strands. After changing craft skills' location, **recreate, don't start**:
`docker compose up -d --force-recreate engine-worker`
Verify: `docker exec <worker> ls /repo/.claude/skills` is non-empty and contains the expected skills. (Project issue log 0008.)

## Run

```sh
npm run smoke -- "A 15-second launch video announcing our new one-click deploy feature."
# or directly, with options:
node scripts/smoke/full-loop.mjs "<brief>" --lever high --actor agent --max-ms 1800000 --poll-ms 5000
```

Options: `--url` (default `http://localhost:8790/mcp`), `--production <id>` (resume, approve-only, no new request), `--lever low|medium|high`, `--actor human|agent`, `--session`, `--poll-ms`, `--max-ms`. The harness pre-approves the render budget so the money gate never blocks it, and approves every presented version to unblock the next pass.

Real runs are long — launch in the background and read the output file; don't block on it. Use `--actor agent --lever high` to minimize gates.

**The driver must outlive the production.** If `--max-ms` fires while the worker is still producing, versions that present afterward land in the inbox with no client to approve them — the production then parks at the human gate ("awaiting feedback") and never advances, even though nothing is wrong with it. For a real run, set `--max-ms` generously (hours), or re-run with `--production <id>` to drain the pending presents and carry on. A single real `video-project` has been observed at ~2h33m / ~$9.79 (project issue log 0009).

## Read the result

- **Exit 0** = reached `status: done`. **Exit 1** = anything else: the `--max-ms` cap fired, or the production stranded/failed.
- The log prints a per-node status line each time it changes — `type:status` for every node. A healthy run walks: `briefing → research → brainstorm (+ idea fan-out) → brainstorm-select → script → moodboard → storyboard → build (+ card fan-out) → assemble → polish → final-review`, each node producing, presenting, getting approved, unblocking the next.
- **Distinguish a cap from a strand:** if the last status line was still advancing right up to the cut, it's the cap — raise `--max-ms`. If status sat unchanged for a long stretch then hit the cap, it stranded — check the worker log for the failing node:
  `docker logs <worker> --since 10m | grep -iE "drain_error|dispatch|error"`

## Teardown (fake/$0 mode)

```sh
docker compose stop engine-worker
docker compose run --rm -d -e SUBAGENT_ENGINE=fake -e RENDER_PROVIDER=stub \
  -e VOICE_PROVIDER=silent -e IMAGE_PROVIDER=stub --name smoke-fake-worker engine-worker
# ... run the smoke ...
docker stop smoke-fake-worker && docker compose start engine-worker
```

A stranded production stays in the DB `in-progress` forever (the worker only re-claims `pending` nodes — project issue log 0001). It's harmless (never re-claimed), but it won't resume; start a fresh one rather than `--production`-resuming a stranded id.

## Known walls

- **0001** — a dispatch that throws strands the node `in-progress`, no error surfaced; the whole production hangs.
- **0002** — the fake subagent can't drive planner fan-out, so the $0 path can't finish a `video-project`.
- **0008** — a not-recreated worker serves empty skills → `Unknown skill` → strand (the recreate gotcha above).
