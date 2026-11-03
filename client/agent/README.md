# Client agent — the thin product client

What a brand installs to request videos from the production engine. **MCP config + one driving skill, nothing else.** It only calls the engine's MCP tools and talks to the user — no craft, no subagents, no business logic. All production happens server-side in the engine worker; this client just hands off a brief and shepherds it through the human gate (approve / feedback / budget).

See `docs/specs/04-mcp-tools.md` (the tool contract) and `docs/specs/05-flows-and-user-stories.md` (the flows this client drives).

## What's here

| File | What |
|------|------|
| `.mcp.json` | Registers the `production-engine` MCP server (project-scoped — Claude Code loads it automatically from the project root). |
| `.claude/skills/produce-video/SKILL.md` | The driving skill: discover → request → poll → present → approve/feedback → deliver. |

## Install

Copy this directory's `.mcp.json` and `.claude/` into the user's project root (where they run Claude Code / an MCP client). That's the whole install — no dependencies, no build.

## Connecting to the engine

`.mcp.json` ships the **HTTP** transport (the Compose / hosted target):

```json
{ "mcpServers": { "production-engine": { "type": "http", "url": "http://localhost:8790/mcp" } } }
```

Point `url` at wherever the engine's MCP server listens. In Compose the `mcp-server` service binds `8787` inside the container and publishes it on the host as `MCP_HTTP_PORT` (default `8790` — `8787` on the host is taken by chrome-bridge).

### Local, no Docker — stdio

To drive the tools from a local checkout with no server container, register the **stdio** entrypoint instead (same handlers, second transport). Build once (`./x npm run build`), then either register via CLI:

```sh
claude mcp add production-engine -- node /abs/path/to/repo/server/mcp/dist/stdio.js
```

or point `.mcp.json` at it:

```json
{ "mcpServers": { "production-engine": { "command": "node", "args": ["/abs/path/to/repo/server/mcp/dist/stdio.js"] } } }
```

Both transports need a Store. Default is Postgres via `DATABASE_URL`; set `MCP_FAKE_STORE=1` to smoke the transport with an in-memory fake (no Postgres — good for a day-one connection check). The engine **worker** runs separately (`docker compose up` or `node engine/dist/worker/index.js`) — without it, requests queue but never produce.

## Smoke test — connection only

Prove the client can reach the tools, headless, no DB and no worker — over the **stdio** entrypoint with the in-memory fake store. Put the server env in the config (a shell env can't reach a separate HTTP server), including the types dir `get_capabilities` reads:

```json
// stdio.mcp.json
{ "mcpServers": { "production-engine": {
  "command": "node",
  "args": ["/abs/path/to/repo/server/mcp/dist/stdio.js"],
  "env": { "MCP_FAKE_STORE": "1", "AUTONOMY_TYPES_DIR": "/abs/path/to/repo/engine/types" }
} } }
```

```sh
claude -p "Call get_capabilities and show the result." \
  --mcp-config stdio.mcp.json --strict-mcp-config \
  --allowedTools "mcp__production-engine__get_capabilities"
```

Verified 2026-11-03 (claude 2.1.317): returns 4 capabilities — `card, clip, scene, video-project`. That = transport + tool registration are wired. Without `AUTONOMY_TYPES_DIR` (or `AUTONOMY_ROOT`) the call still succeeds but returns `[]` — the connection is fine, the engine just has no types dir to read.
