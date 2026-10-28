# Spec 07 — Docker Compose & runtime

**Status:** draft to build against. The topology that wires the processes + Postgres + the shared
artifacts volume. A **draft `docker-compose.yml`** exists at the repo root documenting the shape; its
service images fill in as the code lands (it will not `up` end-to-end until then).

## Services

| service | builds | role | ports |
|---------|--------|------|-------|
| `db` | postgres image | Postgres — the one integration point. Named volume for data. | 5432 |
| `mcp-server` | `server/mcp` | MCP over streamable HTTP; fast tool calls against the DB. | `MCP_HTTP_PORT` |
| `engine-worker` | `engine` stage (bundles the Claude Code CLI) | the loop: `LISTEN new_job` + poll fallback; spawns the subagent engine (`SUBAGENT_ENGINE`: `claude` real / `fake`); writes back + `NOTIFY presentable`. | — |
| `web-api` | `server/api` | read queries + WebSocket; subscribes to `LISTEN/NOTIFY`, relays to the browser; gate writes via `@core/services`. | `WEB_API_PORT` |
| `web` | `web` stage (nginx + `vite build` of `app`) | serves the built SPA, reverse-proxies `/api` + `/ws` to `web-api` (one origin). Vite dev server is `web-dev`, `dev` profile. | `WEB_PORT` |

- **No queue/broker service** — `LISTEN/NOTIFY` + `SKIP LOCKED` on `db` cover wakeups + claiming for
  v0 (spec 03). Phase 4 adds a real queue + multiple `engine-worker` replicas.
- **Shared state:**
  - Postgres data → a named Docker volume (not in the repo).
  - produced artifacts → a bind-mount of `server/data/artifacts` shared by `engine-worker`,
    `mcp-server`, and `web-api` (all reference files by path; big I/O never hits the DB).
  - engine's Claude Code state (`~/.claude`: session transcripts + cached creds) → a bind-mount of
    `engine/data/claude` (engine-owned; survives recreation; keeps `--resume` working across restarts).
- **Secrets / render keys** come from `.env` (gitignored); render stays stubbed until keys land. The
  real `claude` engine authenticates with the subscription via `CLAUDE_CODE_OAUTH_TOKEN` (never
  `ANTHROPIC_API_KEY` — it outranks the token and bills the API). Default `SUBAGENT_ENGINE=fake` = no
  calls, no spend. `SUBAGENT_MAX_CALLS` caps **real** subagent calls per worker process: once hit the
  worker parks idle (in-flight leaf finishes) until restart, so a retained `pgdata` volume full of
  stale queued nodes can't drain into a large unintended spend. Set it low for a real-`claude` smoke
  run; empty = uncapped; `fake` calls never count.
- **Startup ordering:** `mcp-server` / `engine-worker` / `web-api` `depends_on` `db` with a
  healthcheck (`pg_isready`) + a wait-for-db so migrations/queries don't race the DB coming up.

## Migrations & seed

- On startup (or a one-shot `migrate` step) run the Drizzle migrations from `shared`.
- **Seed** the one default `account` + default `user` (spec 01) idempotently, so `request_video` can
  resolve them in v0.

## Local run without Docker (day-one / tests)

- **Tool smoke test with zero infra:** the MCP **stdio** entrypoint against the `FakeStore` (spec 03)
  — no Postgres, no containers.
- **Real local run:** `docker compose up db` (just Postgres), point `DATABASE_URL` at `localhost:5432`,
  run `server/mcp` + `engine` + `server/api` + `app` with `tsx`/`node`/`vite`. Faster iteration than
  rebuilding images each change.
- **Full stack:** `docker compose up` brings up all five services.

## Claude Code MCP registration (verify before relying on it)

> ⚠ First MCP server — **verify the exact Claude Code registration commands/flags against current
> docs** (the `claude-code-guide` agent; modelcontextprotocol.io; `@modelcontextprotocol/sdk`).

- **stdio:** register `server/mcp`'s stdio entrypoint as a command (project `.mcp.json` or
  `claude mcp add`); run the worker + db separately.
- **HTTP:** register `http://localhost:MCP_HTTP_PORT`; `docker compose up` for the rest.

## Acceptance (unchanged in substance)

`docker compose up` → `db` + `mcp-server` + `engine-worker` (+ `web-api` + `web`) share the DB and the
artifacts volume. From a Claude Code session: `request_video` inserts a production; the worker picks it
up (woken by `NOTIFY`), advances status; `get_status` / the web app reflect progress; a presentable
version appears in `inbox` / the web app; `approve` drives the next pass; an artifact row + file
appears under `server/data/artifacts`. Render stubbed is fine.
