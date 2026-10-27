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
mcp-server (TS/Node) ──writes/reads──►  SQLite (app.db) + artifacts/  ◄──reads/writes── engine-worker (TS/Node; the loop; spawns `claude -p`)
```

- **mcp-server** answers fast tool calls synchronously against the DB (`get_status`, `list_artifacts`,
  `get_artifact`, `submit_feedback`, `approve_budget`). The slow one, `start_production`, only
  **inserts a job row and returns a job id** — it never runs the production inline.
- **engine-worker** is a separate long-running process that polls the DB for queued work, runs the
  recursive loop, spawns `claude -p` subagents (producers + specialist reviewers), and writes progress
  + artifacts back.
- **The DB is the only integration point.** The two processes never call each other — they share data.
  This decoupling (conversation vs. production) is the core bet: the production survives the client
  disconnecting, resumes after a crash, and later scales to many workers.

**PoC simplification:** the worker is a single polling process — no queue/broker yet (Phase 4).
SQLite is a file on the shared volume — no DB service (Phase 4). Don't over-build.

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
| `server/shared/` | DB schema + migrations, job/node contract types, port interfaces shared by mcp + engine |
| `server/mcp/` | TS/Node MCP server (tools + transport: HTTP, plus a thin stdio entrypoint) |
| `server/engine/` | the autonomy-engine worker (TS/Node; the loop; spawns `claude -p`) |
| `server/data/` | gitignored runtime state: `app.db` (SQLite) + `artifacts/` |
| `client/agent/` | thin client template a brand installs (MCP config only; no craft) |
| `.claude/skills/` | project skills (run/test the stack, add-a-tool, add-a-type) |

## Testing seam — ports and adapters (bake in from the start)

An interface (port) at every external edge; core logic depends on the interface, never the concrete:
**Store** (all DB access), **RenderClient** (each render engine; stub first), **SubagentRunner**
(spawns `claude -p`; fake returns canned output), **Clock / id generator** (deterministic tests).
Result: the loop and tool handlers unit-test against fakes — no DB, no network, no `claude -p`.

## Status

See `docs/specs/` for the current contract and `README.md` for locked decisions. Build order and
acceptance live in `README.md`.
