# Spec 07 — Docker Compose & runtime

**Status:** draft to build against. The topology that wires the processes + Postgres + the shared
artifacts volume. A **draft `docker-compose.yml`** exists at the repo root documenting the shape; its
service images fill in as the code lands (it will not `up` end-to-end until then).

## Services

| service | builds | role | ports |
|---------|--------|------|-------|
| `db` | postgres image | Postgres — the one integration point. Named volume for data. | 5432 |
| `mcp-server` | `server/mcp` | MCP over streamable HTTP; fast tool calls against the DB. | `MCP_HTTP_PORT` |
| `engine-worker` | `server/engine` | the loop: `LISTEN new_job` + poll fallback; spawns `claude -p`; writes back + `NOTIFY presentable`. | — |
| `dashboard-api` | `dashboard/api` | read queries + WebSocket; subscribes to `LISTEN/NOTIFY`, relays to the browser; proxies gate actions to the MCP tools. | `DASHBOARD_API_PORT` |
| `dashboard-app` | `dashboard/app` | React + Vite SPA. | `DASHBOARD_APP_PORT` |

- **No queue/broker service** — `LISTEN/NOTIFY` + `SKIP LOCKED` on `db` cover wakeups + claiming for
  v0 (spec 03). Phase 4 adds a real queue + multiple `engine-worker` replicas.
- **Shared state:**
  - Postgres data → a named Docker volume (not in the repo).
  - produced artifacts → a bind-mount of `server/data/artifacts` shared by `engine-worker`,
    `mcp-server`, and `dashboard-api` (all reference files by path; big I/O never hits the DB).
- **Secrets / render keys** come from `.env` (gitignored); render stays stubbed until keys land.
- **Startup ordering:** `mcp-server` / `engine-worker` / `dashboard-api` `depends_on` `db` with a
  healthcheck (`pg_isready`) + a wait-for-db so migrations/queries don't race the DB coming up.

## Migrations & seed

- On startup (or a one-shot `migrate` step) run the Drizzle migrations from `server/shared`.
- **Seed** the one default `account` + default `user` (spec 01) idempotently, so `request_video` can
  resolve them in v0.

## Local run without Docker (day-one / tests)

- **Tool smoke test with zero infra:** the MCP **stdio** entrypoint against the `FakeStore` (spec 03)
  — no Postgres, no containers.
- **Real local run:** `docker compose up db` (just Postgres), point `DATABASE_URL` at `localhost:5432`,
  run `server/mcp` + `server/engine` + `dashboard` with `tsx`/`node`. Faster iteration than rebuilding
  images each change.
- **Full stack:** `docker compose up` brings up all five services.

## Claude Code MCP registration (verify before relying on it)

> ⚠ First MCP server — **verify the exact Claude Code registration commands/flags against current
> docs** (the `claude-code-guide` agent; modelcontextprotocol.io; `@modelcontextprotocol/sdk`).

- **stdio:** register `server/mcp`'s stdio entrypoint as a command (project `.mcp.json` or
  `claude mcp add`); run the worker + db separately.
- **HTTP:** register `http://localhost:MCP_HTTP_PORT`; `docker compose up` for the rest.

## Acceptance (unchanged in substance)

`docker compose up` → `db` + `mcp-server` + `engine-worker` (+ dashboard) share the DB and the
artifacts volume. From a Claude Code session: `request_video` inserts a production; the worker picks it
up (woken by `NOTIFY`), advances status; `get_status` / the dashboard reflect progress; a presentable
version appears in `inbox` / the dashboard; `approve` drives the next pass; an artifact row + file
appears under `server/data/artifacts`. Render stubbed is fine.
