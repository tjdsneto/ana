# scripts/smoke

Integration smoke harnesses that drive the running stack through the real MCP surface.

## full-loop.mjs

Drives a production end to end over the client-facing MCP tools — `request_video` → poll `get_status` + `inbox` → `get_deliverable` + `approve` each present → until `done`. It is the automated counterpart to the thin client's `produce-video` skill: same tools, same HTTP transport the shipped `client/agent/.mcp.json` uses. It runs no craft of its own; the engine worker produces everything.

### Prereqs

- `mcp-server` up: `docker compose up -d mcp-server` (host port `MCP_HTTP_PORT`, default `8790`).
- A worker up:
  - **Real:** the default `engine-worker` — real `claude` producers + render/voice. Real spend (up to `SUBAGENT_MAX_BUDGET_USD`), slow.
  - **Fake/$0:** a worker with `SUBAGENT_ENGINE=fake RENDER_PROVIDER=stub VOICE_PROVIDER=silent IMAGE_PROVIDER=stub`. Deterministic and free, but can't complete a full `video-project` yet — it strands at the first planner node (`brainstorm`). See the project issue log (0001 + 0002), kept at the am-videos project root.

### Run

```sh
npm run smoke -- "A 15-second launch video announcing our new one-click deploy feature."
# options: --url --production <id> --lever low|medium|high --actor human|agent --poll-ms --max-ms
node scripts/smoke/full-loop.mjs "<brief>" --lever high --actor agent --max-ms 1800000 --poll-ms 5000
```

Exits `0` only when the production reaches `done`; `1` on a cap, strand, or failure. `--production <id>` resumes an existing production (approve-only, no new request).

### Fake/$0 worker, disposable

```sh
docker compose stop engine-worker
docker compose run --rm -d -e SUBAGENT_ENGINE=fake -e RENDER_PROVIDER=stub \
  -e VOICE_PROVIDER=silent -e IMAGE_PROVIDER=stub --name smoke-fake-worker engine-worker
# ... run the smoke ...
docker stop smoke-fake-worker && docker compose start engine-worker
```
