# Autonomous video-production engine — PoC

A caller sends a brief; a generic autonomy engine produces a video through a recursive,
self-reviewing loop and returns it for approval. Two processes (an MCP server + an engine worker)
share one Postgres DB and an artifacts directory. v0 proof-of-concept, internal only.

> **Naming rule:** no brand or product names in this repo — generic only (`engine`, `mcp-server`,
> `client`, `worker`, `production`). See `CLAUDE.md`.

## Locked decisions

1. **TypeScript / Node** for both the MCP server and the engine worker — one language, one toolchain,
   shared contract types in `server/shared`. (PoC-scoping only; the product keeps v1 language open.)
2. **Transport — streamable HTTP** for the Compose target, plus a **thin stdio entrypoint** for the
   first local Claude Code check.
3. **Postgres from v0** — a `db` service in Compose (switched off the handoff's SQLite: it is the v1
   shape, removes the single-writer ceiling, and gives `LISTEN/NOTIFY` push + `jsonb` + `SKIP LOCKED`
   claiming, so no Phase-4 migration). Adapter: Drizzle + `pg`, behind the `Store` port. v0 still runs
   **one worker**; multi-worker is a later config change (the `SKIP LOCKED` seam), not a redesign.
4. **Ports and adapters** at every external edge (Store / RenderClient / SubagentRunner / Clock+IdGen)
   so the core unit-tests against fakes. See `docs/code-standards.md`.
5. **Render stubbed** (text-level) until engine keys arrive (pending Angie).
6. **Test runner: vitest** (default; confirm on scaffolding).
7. **Dashboard from v0** — a dev/observability web app (`dashboard/`, React + Vite + a thin Node/TS
   read API) that renders productions/nodes live (via `LISTEN/NOTIFY` → WebSocket) and drives the v0
   **human gate** (approve/feedback). Not the product client. See `docs/specs/06-dashboard.md`.

Design source of truth (outside this repo — don't copy its product name in):
`../docs/lisa/lisa-loop-design.md` (§20–27 = the recursive typed-project model) and
`../docs/lisa/key-decisions.md` (D1–D9).

## Build order

1. Repo + `git init` + `.gitignore` + skeleton `CLAUDE.md` / `docs/code-standards.md`. ✅
2. Specs in `docs/specs/`, **domain model first**, then lifecycle/loop, ports + schema, tools, flows,
   dashboard, compose. ✅ (01–07)
3. Shared contract: types + port interfaces + Drizzle schema/migrations in `server/shared`; seed the
   default account + user. ✅ (`@app/shared` — schema + `0000_init.sql` + `migrate`/`seed`; smoked
   against a throwaway Postgres: 9 tables created, defaults seeded, both scripts idempotent)
4. MCP server: the direct tools + `request_video` (stdio entrypoint first), against a `Store` fake,
   then the Postgres (Drizzle + `pg`) adapter. ✅ (`@app/mcp` — 7 tools, stdio + stateless-HTTP
   entrypoints; `PgStore` + `FakeStore` in `@app/shared`; smoked over the real MCP protocol on both
   FakeStore and Postgres)
5. Engine worker: the poll/`LISTEN` loop against fakes (fake subagent runner + stubbed render), then
   the `claude -p` runner. ✅ (`@app/engine` — generic loop + on-disk type registry (7-step pipeline),
   redo cap + F5 agreement cap, `LISTEN/NOTIFY` wake-ups; smoked end-to-end on Postgres: queued →
   7 children produced/reviewed/approved → root done in 8 ticks)
6. Dashboard: `dashboard/api` (reads + WebSocket over `LISTEN/NOTIFY`) + `dashboard/app` (React),
   once there is live data to render. ✅ (`@app/dashboard-api` — read DTOs over the `Store`, gate
   writes calling the shared `@app/services` layer, `LISTEN new_job`/`presentable` relayed to browsers
   over a WebSocket; `@app/dashboard-app` — React + Vite SPA: productions list, live node tree +
   versions + reviews, type-driven inbox gate (approve/feedback/ack + budget). Smoked on Postgres:
   reads + both NOTIFYs over the socket + an approve round-trip; `vite build` clean.)
7. Docker Compose (`db` + `mcp-server` + `engine-worker` + dashboard) on the shared volume.
8. End-to-end check per acceptance below.

## Acceptance (PoC spike)

- `docker compose up` brings up `db` + `mcp-server` + `engine-worker` (+ dashboard) sharing the DB and
  the artifacts volume.
- From a Claude Code session: `request_video` inserts a production; `engine-worker` is woken by
  `NOTIFY` and advances status; `get_status` / the dashboard reflect progress; a presentable version
  shows in `inbox` / the dashboard; `approve` drives the next pass; an artifact row + file appears
  under `server/data/artifacts`.
- Render stubbed (text-level) is fine. Core loop + tool handlers have unit tests against fakes. No
  brand/product naming anywhere.

## Not in scope

Real render wiring (needs keys), hosting, accounts/billing, multi-worker scale, the production
website (WordPress) — all later phases.
