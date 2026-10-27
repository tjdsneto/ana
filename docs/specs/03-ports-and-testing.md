# Spec 03 — Ports, adapters & testing (+ DB schema)

**Status:** draft to build against. Depends on specs 01–02. Defines the interfaces the core depends on,
the SQLite schema behind the `Store`, and the test strategy. The whole point: the loop and the tool
handlers unit-test against **fakes** — no DB, no network, no `claude -p`.

> Rule: core logic depends on the **interface**, never the concrete. Even if the language changes
> later, these seams survive because they are conceptual.

## The ports

All live in `server/shared` and are imported by both `server/mcp` and `server/engine`.

### Store — all DB access

One interface over every table in spec 01. Tool handlers and the loop call `Store`, never SQLite.

```ts
export interface Store {
	// productions / nodes
	createProduction(input: NewProduction): Promise<Node>          // inserts the root node
	getNode(id: string): Promise<Node | null>
	getProduction(id: string): Promise<Node | null>               // the root node
	listReadyNodes(productionId: string): Promise<Node[]>         // pending + deps approved + parent active
	updateNodeStatus(id: string, status: NodeStatus): Promise<void>
	createChildNodes(parentId: string, children: NewNode[]): Promise<Node[]>  // expand / plan

	// versions
	createVersion(input: NewVersion): Promise<Version>
	updateVersion(id: string, patch: Partial<Version>): Promise<void>
	latestVersion(nodeId: string): Promise<Version | null>

	// reviews
	addReview(input: NewReview): Promise<Review>
	reviewsFor(versionId: string): Promise<Review[]>

	// interactions (the typed human queue)
	emitInteraction(input: NewInteraction): Promise<Interaction>
	pendingInteractions(productionId: string): Promise<Interaction[]>   // the client `inbox`
	resolveInteraction(id: string, response: string): Promise<void>

	// feedback / budget
	addFeedback(input: NewFeedback): Promise<void>
	getBudget(productionId: string): Promise<Budget>
	approveBudget(productionId: string): Promise<void>
}
```

- Concurrency: the loop and the MCP server are **two writers**. The SQLite adapter runs in WAL mode;
  each `Store` method is a single transaction. (v0 load is tiny; this is correctness, not throughput.)
- Partial updates matter — `updateVersion(id, patch)` must not rewrite the whole row.

### RenderClient — each render engine behind one interface

```ts
export interface RenderClient {
	render(input: RenderRequest): Promise<RenderResult>   // returns an artifact path + cost
}
```

**Stub implementation first** (`StubRenderClient`) — writes a text placeholder artifact and a zero
cost. Real adapters (HeyGen / Higgsfield / HyperFrames / local ffmpeg) land when keys arrive (pending
Angie). The loop never knows which is behind the port.

### SubagentRunner — spawns `claude -p`

```ts
export interface SubagentRunner {
	run(input: SubagentRequest): Promise<SubagentResult>  // prompt + type/skill → stdout (+ parsed VERDICT)
}
```

- Real adapter shells out to `claude -p` (headless), reading the producer/reviewer skill for the node
  type. This is design D8 option B — the loop drives the subagents itself.
- `FakeSubagentRunner` returns canned output keyed by node type, so the loop tests deterministically
  with no subprocess and no network.

### Clock / IdGen — determinism

```ts
export interface Clock { now(): Date }
export interface IdGen { next(): string }
```

Injected everywhere a timestamp or id is created, so tests are reproducible.

## SQLite schema (behind the Store)

Falls out of spec 01. One `nodes` table (no separate productions/jobs table — the root node *is* the
production). Lives in `server/shared` as migrations.

```sql
CREATE TABLE nodes (
	id            TEXT PRIMARY KEY,
	production_id TEXT NOT NULL,            -- groups one tree; equals the root node's id
	parent_id     TEXT,                     -- NULL = root = the production
	type          TEXT NOT NULL,            -- resolved against the type registry (files)
	name          TEXT NOT NULL,
	description   TEXT,
	status        TEXT NOT NULL,            -- pending | ready | in-progress | needs-presentation | presented | approved | ...
	deps          TEXT NOT NULL DEFAULT '[]', -- JSON array of node ids (sibling prerequisites)
	position      INTEGER NOT NULL DEFAULT 0,
	session_id    TEXT,                     -- root only: the owning client session (nudge target)
	created_at    TEXT NOT NULL,
	updated_at    TEXT NOT NULL
);
CREATE INDEX idx_nodes_production ON nodes(production_id);
CREATE INDEX idx_nodes_parent     ON nodes(parent_id);

CREATE TABLE versions (
	id              TEXT PRIMARY KEY,
	node_id         TEXT NOT NULL REFERENCES nodes(id),
	n               INTEGER NOT NULL,
	prev_version_id TEXT REFERENCES versions(id),
	status          TEXT NOT NULL,          -- producing | in-review | presentable | presented | approved | denied | needs-work | superseded
	artifact_path   TEXT,                   -- file on the shared volume (not in the DB)
	subagent        TEXT,                   -- attached subagent + state (idempotency)
	feedback        TEXT,
	created_at      TEXT NOT NULL,
	updated_at      TEXT NOT NULL
);
CREATE INDEX idx_versions_node ON versions(node_id);

CREATE TABLE reviews (
	id         TEXT PRIMARY KEY,
	node_id    TEXT NOT NULL REFERENCES nodes(id),
	version_id TEXT NOT NULL REFERENCES versions(id),
	name       TEXT NOT NULL,               -- rubric name (craft side; files)
	kind       TEXT NOT NULL,               -- craft | coverage | consistency
	verdict    TEXT NOT NULL,               -- pass | revise
	body       TEXT,
	created_at TEXT NOT NULL
);

CREATE TABLE interactions (
	id            TEXT PRIMARY KEY,
	production_id TEXT NOT NULL,
	node_id       TEXT,
	version_id    TEXT,
	type          TEXT NOT NULL,            -- present | ask | notify   (v0 emits present only)
	status        TEXT NOT NULL,            -- pending | resolved
	prompt        TEXT,
	options       TEXT,                     -- JSON (for ask)
	response      TEXT,
	created_at    TEXT NOT NULL,
	resolved_at   TEXT
);
CREATE INDEX idx_interactions_pending ON interactions(production_id, status);

CREATE TABLE feedback (
	id            TEXT PRIMARY KEY,
	production_id TEXT NOT NULL,
	target        TEXT,                     -- node/version the feedback is about
	body          TEXT NOT NULL,
	created_at    TEXT NOT NULL
);

CREATE TABLE budget (
	production_id TEXT PRIMARY KEY,
	approved      INTEGER NOT NULL DEFAULT 0 -- the money-gate flag; promote to cost_events only if needed
);
```

Timestamps are ISO-8601 TEXT (SQLite has no native datetime); the `Clock` produces them.

## Test strategy

- **Core (loop + tool handlers):** unit tests against `FakeStore` + `FakeSubagentRunner` +
  `StubRenderClient` + fixed `Clock`/`IdGen`. No I/O. These are the tests that matter most — they pin
  the dispatch logic, the redo cap, the rollup, the interaction emission.
- **Adapters:** thin focused tests. The SQLite `Store` against a temp DB file; the `claude -p` runner
  behind a flag (not in the default suite — it costs real calls); the render stub trivially.
- **Runner:** vitest (locked). Keep the suite fast and deterministic.

> Unit testing is a goal, **not a blocker** for the first spike — don't let scaffolding stall it.
