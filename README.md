# Autonomous video-production engine — PoC

A caller sends a brief; a generic autonomy engine produces a video through a recursive,
self-reviewing loop and returns it for approval. Two processes (an MCP server + an engine worker)
share one SQLite DB and an artifacts directory. v0 proof-of-concept, internal only.

> **Naming rule:** no brand or product names in this repo — generic only (`engine`, `mcp-server`,
> `client`, `worker`, `production`). See `CLAUDE.md`.

## Locked decisions

1. **TypeScript / Node** for both the MCP server and the engine worker — one language, one toolchain,
   shared contract types in `server/shared`. (PoC-scoping only; the product keeps v1 language open.)
2. **Transport — streamable HTTP** for the Compose target, plus a **thin stdio entrypoint** for the
   first local Claude Code check.
3. **SQLite for the PoC** — a file on the shared volume, no DB service. Phase 4 replaces it with a
   networked DB + a real queue + multiple workers. Note it; don't build it.
4. **Ports and adapters** at every external edge (Store / RenderClient / SubagentRunner / Clock+IdGen)
   so the core unit-tests against fakes. See `docs/code-standards.md`.
5. **Render stubbed** (text-level) until engine keys arrive (pending Angie).
6. **Test runner: vitest** (default; confirm on scaffolding).

Design source of truth (outside this repo — don't copy its product name in):
`../docs/lisa/lisa-loop-design.md` (§20–27 = the recursive typed-project model) and
`../docs/lisa/key-decisions.md` (D1–D9).

## Build order

1. Repo + `git init` + `.gitignore` + skeleton `CLAUDE.md` / `docs/code-standards.md`. ✅
2. Specs in `docs/specs/`, **domain model first** (entities + which become DB tables), then lifecycle,
   engine loop, DB schema, testing seams, and the MCP tool contract **last**.
3. Shared contract: types + port interfaces + DB schema in `server/shared`.
4. MCP server: the direct tools + `start_production` (stdio entrypoint first), against a `Store` fake,
   then the SQLite adapter.
5. Engine worker: the poll loop against fakes (fake subagent runner + stubbed render), then the
   `claude -p` runner.
6. Docker Compose (HTTP) wiring both to the shared volume.
7. End-to-end check per acceptance below.

## Acceptance (PoC spike)

- `docker compose up` brings up `mcp-server` + `engine-worker` sharing one volume.
- From a Claude Code session: `start_production` inserts a job; `engine-worker` picks it up and
  advances its status; `get_status` reflects progress; an artifact row + file appears under
  `server/data/artifacts`.
- Render stubbed (text-level) is fine. Core loop + tool handlers have unit tests against fakes. No
  brand/product naming anywhere. First commits land here.

## Not in scope

Real render wiring (needs keys), hosting, accounts/billing, multi-worker scale, the app/website — all
later phases.
