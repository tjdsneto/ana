# Project understanding — autonomous video-production engine (PoC)

Read before working anywhere in this repo. This is a **self-contained git repo** nested under
`am-videos/` on purpose: the future product repo. Run git here, commit here.

## Naming rule — READ FIRST

**No brand or product names anywhere in this repo.** Use generic names only: `engine`, `mcp-server`,
`client`, `agent-autonomy`, `worker`, `production`. The product pitch is still under review; nothing
brand- or product-named lands here until that is approved. Video-craft terms (briefing, moodboard,
storyboard, render, audio, polish) are fine — those name the domain, not the product.

If you find a brand/product name in this repo, it is a mistake — remove it.

## What this is

A **PoC** for an autonomous video-production agent, built on a **generic autonomy engine**. A caller
sends a brief; the system produces a video through a recursive, self-reviewing loop and returns it
for approval. v0 proof-of-concept — internal only, not production-ready. Render stays **stubbed**
(text-level) until real engine keys arrive.

## Architecture — two processes, one shared store

```
client (Claude / ChatGPT, via MCP)
   │
   ▼
mcp-server (TS/Node) ──writes/reads──►  Postgres (db service) + artifacts/  ◄──reads/writes── engine-worker (TS/Node; the loop; spawns `claude -p`)
                                              ▲
                                     reads/subscribes (LISTEN/NOTIFY → WebSocket)
                                              │
                                     web app (React SPA + a thin Node/TS read API, server/api) — dev/observability + v0 human-gate UI
```

- **mcp-server** answers fast tool calls synchronously against the DB (`get_status`, `inbox`,
  `get_deliverable`, `approve`, `submit_feedback`, `approve_budget`). The slow one, `request_video`,
  only **inserts the root node and returns its production id** — it never runs the production inline.
- **engine-worker** is a separate long-running process that polls the DB for queued work, runs the
  recursive loop, spawns `claude -p` subagents (producers + specialist reviewers), and writes progress
  + artifacts back.
- **The DB is the only integration point.** The processes never call each other — they share data
  (the engine, the MCP server, and the web app are all just DB clients). This decoupling
  (conversation vs. production) is the core bet: the production survives the client disconnecting,
  resumes after a crash, and later scales to many workers.
- **Postgres from v0** (a `db` service in Compose). `LISTEN/NOTIFY` wakes the worker on new jobs and
  pushes web-app updates (no pure polling); `SKIP LOCKED` is the multi-worker claim seam. Adapter:
  Drizzle + `pg`, behind the `Store` port.

**PoC simplification:** one worker, no queue/broker yet (the `SKIP LOCKED` claim makes multi-worker a
later config change). Render stays stubbed. Don't over-build — no billing/tenancy/scale now.

## The domain model — the recursive typed-project loop

Everything is a **typed node**, recursively. A node has a `type`; the loop resolves the type against a
**type registry** and dispatches: `expand` (static children) · `plan` (dynamic children / fan-out) ·
`router` (emit a verdict that gates a sibling) · `leaf` (produce an artifact). A leaf produces
**versioned deliverables** reviewed by a **specialist reviewer set** until all pass (or `MAX_REDOS` →
escalate). Completion **rolls up via approval** from leaves to the root. The root node *is* the
production.

The design this derives from lives OUTSIDE this repo (do not copy its product name in):
`../docs/lisa/lisa-loop-design.md` (source of truth, §20–27 is the model) and `../docs/lisa/key-decisions.md`.

## Layering

```
engine        generic autonomy loop — knows nothing about video
  └── craft   the video specialization (types, skills, reviewer rubrics)
        └── product   go-to-market (later; not in this repo yet)
```

## Where things live

| Path | What |
|------|------|
| `docs/specs/` | the specs — **start here**; domain model first |
| `docs/code-standards.md` | TS/testing conventions, the port/adapter rule, the naming rule |
| `shared/` | `@core/shared` — the contract: DB schema + migrations (Drizzle), node/contract types, port interfaces + adapters (PgStore), test fakes. Imported by every package |
| `core/services/` | `@core/services` — the **application service layer**: business logic of each client-facing operation (requestVideo, getStatus, inbox, getDeliverable, approve, submitFeedback, approveBudget) as pure functions over the `Store` port. Transport-agnostic; consumed by **both** `server/mcp` and `server/api`, neither holds a second copy |
| `engine/` | `@engine/worker` — the autonomy-engine loop + worker + type registry (TS/Node; spawns `claude -p`). Not a client-facing server |
| `server/mcp/` | `@server/mcp` — the MCP server, **pure transport** over `@core/services` (zod schemas + `registerTool` wiring: HTTP, plus a thin stdio entrypoint). No business logic |
| `server/api/` | `@server/api` — the web app's read API: read DTOs over the `Store` + a WebSocket relaying `LISTEN/NOTIFY`, plus the gate writes routed through `@core/services`. Thin transport, no business logic |
| `server/data/` | gitignored runtime state: produced `artifacts/` (the Postgres data lives in the `db` container volume) |
| `client/agent/` | thin client template a brand installs (MCP config only; no craft) — the product client |
| `app/` | `@app/web` — the React + Vite SPA: dev/observability UI + the v0 human gate (approve/feedback). Reads `server/api`, renders productions/nodes live. **Not** the product client |
| `craft/.claude/skills/` | the craft production + review skills a `claude -p` worker runs (storyboard, build-card, render-film, review-*…). They live under `craft/` because they are the video specialization, not engine code; the worker cwd stays `/repo`, so Compose mounts them to the project path it resolves (`/repo/.claude/skills`). Tool refs inside them are `/repo`-relative (`craft/tools/…`). |

## Running commands — use `./x` (host-free toolbox)

The pinned toolchain (Node 24 LTS + npm 12) lives in the Docker image, **not on the machine** — do not
assume a usable host `node`/`npm`. Run every Node/npm command through the **`./x`** wrapper, which
executes it inside the `toolbox` Compose service (same pinned image, in the `tools` profile). The repo
is bind-mounted live, so your edits are seen at once; each `node_modules` is a named volume, so the
container's Linux-arch install never clobbers the host's (and vice versa).

| Need | Command |
|------|---------|
| Install from the lockfile | `./x npm ci` |
| Add a dep / regenerate the lockfile | `./x npm install <pkg>` |
| Build the workspace (`tsc -b`) | `./x npm run build` |
| Run tests (vitest) | `./x npm test` |
| Typecheck | `./x npm run typecheck` |
| Interactive shell in the toolbox | `./x sh` |

First `./x` run builds the image (one-time). db-touching scripts need the `db` service up first:
`docker compose up -d db && ./x npm run db:migrate`. Running Node directly on the host (`nvm use` →
Node 24, then `npm ci`) still works but is the fallback; the only thing `./x` can't drive is the IDE's
in-editor test runner / debugger. Full rationale + wrapper source: README "Local development" and the
`toolbox` service in `docker-compose.yml`.

Note: npm 12 blocks dependency install scripts by default — if an install warns `install scripts
blocked ... not covered by allowScripts` and something then fails for a missing native binary, run
`./x npm install-scripts ls` to see what's blocked and whitelist it.

## Testing seam — ports and adapters (bake in from the start)

An interface (port) at every external edge; core logic depends on the interface, never the concrete:
**Store** (all DB access), **SubagentRunner** (spawns `claude -p`; fake returns canned output),
**Clock / id generator** (deterministic tests). Render/voice are **worker skills, not ports** (spec
09): a rendered leaf runs its skill, which drives the craft tools directly.
Result: the loop and tool handlers unit-test against fakes — no DB, no network, no `claude -p`.

## Status

See `docs/specs/` for the current contract and `README.md` for locked decisions. Build order and
acceptance live in `README.md`.
