# Spec 04 — MCP tool contract (last)

**Status:** draft to build against. Depends on specs 01–03. Specified **last** on purpose: the tools
are a thin projection over the domain and the `Store` — once the entities exist, the tools are a small
surface on top. This is the client-facing door.

> The tools expose **no** produce / review / craft. They are the client-safe surface over the data:
> request, read status, read the inbox, read a deliverable, approve, submit feedback. The craft stays
> server-side behind the engine worker. (Design §18 `client_api` → each maps 1:1 to an MCP tool.)

## Direct vs. hand-off — the one rule

- **Hand off (fast insert, the worker does the work):** if a call kicks off minutes of production, it
  only **inserts a row and returns immediately**.
- **Direct (synchronous, server reads/writes the DB):** if a call answers from the DB in milliseconds,
  the server does it inline.

## The tools

### `request_video` — HAND OFF

Insert the root node (`status = queued`) from a brief; return the `production_id` immediately. Does
**not** run the production — the engine worker picks it up (spec 02).

- in: `{ brief: string, session_id: string, options?: {...} }` — no `account_id` in v0; the server
  resolves `Store.defaultAccount()` and stamps the root. (v1: auth maps the caller to its account.)
- out: `{ production_id: string, status: "queued" }`
- Store: `defaultAccount()` then `createProduction({ accountId, ... })`.

### `get_status` — DIRECT

Read production + node/version progress.

- in: `{ production_id: string }`
- out: `{ status, nodes: [{ id, type, name, status }], presentable: [...] }`
- Store: `getProduction`, node reads.

### `inbox` — DIRECT

The pending **`human_output`** queue for this production (spec 01) — everything the engine needs the
user to see, typed. This is how the client learns there is something to `present` (MCP can't push —
spec 02 "the nudge").

- in: `{ production_id: string }`
- out: `{ outputs: [{ id, type, node_id, version_id, prompt, options }] }`
- Store: `pendingOutputs(...)`.

### `get_deliverable` — DIRECT

Read a produced version's artifact (the drafts/renders the loop wrote).

- in: `{ version_id: string }` (or `{ node_id }` for the latest)
- out: `{ version: {...}, artifact_path, content? }`
- Store: `latestVersion` / version read; artifact read from the shared volume.

### `approve` — DIRECT

Record an `approve` `human_input` against a `present` output → version + node `approved`; the output
resolves; the worker rolls up on its next pass.

- in: `{ output_id: string }` (or `{ version_id }`)
- out: `{ ok: true }`
- Store: `recordInput({ kind: "approve", responds_to })` + `resolveOutput` + `updateVersion`/`updateNodeStatus`.

### `submit_feedback` — DIRECT

Record a `feedback` `human_input` → version `denied`, the feedback event stored (→ a learned rule,
persisted separately per spec 01), node back to `pending`; the worker redoes on its next pass, fed the
feedback (spec 02).

- in: `{ output_id: string, body: string }` (or `{ production_id, target, body }` for unsolicited feedback — `responds_to` null)
- out: `{ ok: true }`
- Store: `recordInput({ kind: "feedback", responds_to?, body })` + `resolveOutput` (when answering an output) + status updates.

### `approve_budget` — DIRECT

Flip the money-gate flag so the worker may proceed past a render-spend gate.

- in: `{ production_id: string }`
- out: `{ ok: true }`
- Store: `approveBudget(...)`.

> **v0 human-contact scope:** the worker emits `present` `human_output` only (+ the matching
> `approve`/`feedback` `human_input`); `ask` / `notify` / `answer` are schema-supported but unused.
> `inbox` already returns outputs typed, so adding `ask`/`notify` later needs no tool change — only
> client handling.

## Transport

- **Streamable HTTP** on `MCP_HTTP_PORT` — matches Docker + the v1 hosting direction. The Compose
  target.
- **Thin stdio entrypoint** — a second entrypoint over the same tool handlers, so a local Claude Code
  session can call the tools on day one without Docker. Same handlers, two transports; no logic
  duplicated.

Both transports wrap the **same** tool handlers, which depend only on `Store` (spec 03) — so the tool
layer unit-tests against `FakeStore` with no transport at all.

## Local registration (verify before relying on it)

> ⚠ First MCP server for this project — **verify the exact Claude Code registration commands/flags
> against current docs before relying on them.** Sources: the `claude-code-guide` agent, the MCP docs
> (modelcontextprotocol.io), the TS SDK (`@modelcontextprotocol/sdk`).

- **stdio:** register the server as a command Claude Code launches (project-scoped `.mcp.json` or
  `claude mcp add`). The engine worker runs separately (node / docker).
- **HTTP:** register the `localhost:PORT` URL. Compose brings up server + worker + the shared volume.

## Acceptance tie-in (spec-level)

`request_video` inserts a node; the worker advances it; `get_status` reflects progress; a presentable
version shows up in `inbox`; `get_deliverable` returns the artifact; `approve` / `submit_feedback`
drive the next loop pass. Render stubbed is fine.
