# Spec 06 — Dashboard (dev/observability + v0 human gate)

**Status:** draft to build against. A **development/observability** web app — and, because the engine
is decoupled, the natural place to **drive the v0 human gate**. It is **not** the product client
(`client/agent` is the MCP thin client); it is a window into the shared DB for us, while we build.

> Purpose: a background system you otherwise can't see. Watch a production start, see nodes move
> through status, see versions produced + reviewed, and approve / give feedback — so we can tell the
> system is working. Low ceremony: a fake, functional dashboard, not a polished product surface.

## Why it earns its place

1. **Observability** — the engine runs unattended and spawns subagents; without a view, "is it
   working?" is guesswork over raw SQL.
2. **It solves the v0 human-gate question** (flows gap #1). The gate (approve / feedback) needs a
   driver. A dashboard with buttons is a far better driver than a CLI — and it is a real human in the
   loop, matching the architecture.
3. **It's just another DB reader** — reinforces the §18 principle (the data store is the integration
   layer). It reads the DB and writes `chat_input` (via the MCP tools); it never calls the engine or
   the MCP server's internals directly.

## Shape

```
dashboard/
  app/     React + Vite SPA — the UI
  api/     thin Node/TS service — read queries + a WebSocket; proxies gate actions to the MCP tools
```

- **`dashboard/api`** (Node/TS): read-only queries over the shared DB (productions, the node tree,
  versions, reviews, assets, the chat queues), plus a **WebSocket** that pushes live updates. It
  subscribes to Postgres **`LISTEN/NOTIFY`** (spec 03) and relays `new_job` / `presentable` / status
  changes to connected browsers — no browser polling. For **gate actions** it calls the MCP tools
  (`approve`, `submit_feedback`) rather than writing `chat_input` itself, so the one write path stays
  in the server. (Alternatively it may reuse the MCP HTTP server directly; keep the read API thin.)
- **`dashboard/app`** (React): renders the live tree and drives the gate.

## Views (v0)

- **Productions list** — each production (root node): name, status (`queued → producing → review →
  done`), autonomy lever, account/user, created.
- **Production detail — the live node tree.** The recursive nodes with per-node status + type, each
  leaf's versions (status, `n`, `prev_version_id` lineage), the reviews on a version (name, kind,
  verdict, body). Updates in real time as the worker writes.
- **Inbox (the gate).** Pending `chat_output` for the production, typed: a `present` renders the
  version's artifact (text/links in v0) with **Approve** / **Feedback** controls; a `notify` shows +
  **Ack**; `question` / `options` render their input (deferred in v0, but the UI is type-driven so
  they slot in). Submitting writes the matching `chat_input` through the MCP tool.
- **Assets** — the produced/gathered assets for a production (name, asset_type, file_type, link).

## Data flow

```
engine-worker ──writes rows + NOTIFY──►  Postgres  ──LISTEN/NOTIFY──►  dashboard/api ──WebSocket──►  React
                                            ▲                                                           │
                                            └──────── MCP tools (approve / submit_feedback) ◄───────────┘
```

The dashboard is a **client of the data**, exactly like `client/agent` — it reads status + the inbox
and writes the user's verdict. The difference: it is a *UI for us*, carries no craft, and is a dev
tool, not the shipped connector.

## Stack & scope

- React + Vite; thin Node/TS API (`pg` for reads, `ws` for the socket). vitest for any logic worth
  testing — but this is a fake viz, so **minimal tests**; don't gold-plate.
- **Read-only by default**, plus the two gate writes (approve / feedback) routed through MCP.
- **WordPress later (not now):** the real site/app will likely be a React app embedded in WordPress
  (AM is a WordPress shop). A standalone React SPA embeds cleanly later (enqueue the built bundle,
  mount on a `<div>`). Build standalone now; bake into WP at the product phase. No PoC impact.

## Build sequencing

The dashboard needs **live data to show**, so build it **right after** the `Store` adapter + a minimal
worker produce the first rows (build order step 5-ish), not before. Scaffold the dir + the Compose
service now; flesh out the UI once there is a production to render.
