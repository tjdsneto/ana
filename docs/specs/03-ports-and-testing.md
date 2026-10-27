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
	// accounts + users (the tenant/identity seam — PoC resolves to one default each)
	defaultAccount(): Promise<Account>                            // seeds on first call; always returns the default in v0
	getAccount(id: string): Promise<Account | null>
	defaultUser(): Promise<User>                                  // seeds the default user under the default account
	getUser(id: string): Promise<User | null>

	// productions / nodes
	createProduction(input: NewProduction): Promise<Node>          // root under accountId + userId; input carries autonomyLever
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

	// assets
	addAsset(input: NewAsset): Promise<Asset>
	assetsFor(productionId: string): Promise<Asset[]>

	// chat I/O — split by direction (spec 01)
	emitOutput(input: NewChatOutput): Promise<ChatOutput>        // engine → chat (present | notify | question | options)
	pendingOutputs(productionId: string): Promise<ChatOutput[]>   // the client `inbox`: unresolved chat_output
	recordInput(input: NewChatInput): Promise<ChatInput>         // chat → engine (approve | feedback | answer)
	resolveOutput(id: string): Promise<void>                       // mark a chat_output resolved (an input answered it)

	// budget
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
production), plus a thin `accounts` table (the tenant seam — PoC seeds one default row). Lives in
`server/shared` as migrations.

```sql
CREATE TABLE accounts (
	id         TEXT PRIMARY KEY,
	name       TEXT NOT NULL,
	created_at TEXT NOT NULL
);

CREATE TABLE users (
	id         TEXT PRIMARY KEY,
	account_id TEXT NOT NULL REFERENCES accounts(id), -- account 1—* users
	name       TEXT NOT NULL,
	created_at TEXT NOT NULL
);
-- PoC seeds exactly one default account + one default user on init; every production points at them
-- via nodes.account_id / nodes.user_id.

CREATE TABLE nodes (
	id            TEXT PRIMARY KEY,
	account_id    TEXT REFERENCES accounts(id), -- root only: the owning account (tenant); NULL on children
	user_id       TEXT REFERENCES users(id),    -- root only: the user who requested it; NULL on children
	production_id TEXT NOT NULL,            -- groups one tree; equals the root node's id
	parent_id     TEXT,                     -- NULL = root = the production
	type          TEXT NOT NULL,            -- resolved against the type registry (files)
	name          TEXT NOT NULL,
	description   TEXT,
	status        TEXT NOT NULL,            -- pending | ready | in-progress | needs-presentation | presented | approved | ...
	deps          TEXT NOT NULL DEFAULT '[]', -- JSON array of node ids (sibling prerequisites)
	position      INTEGER NOT NULL DEFAULT 0,
	session_id    TEXT,                     -- root only: the owning client session (nudge target)
	autonomy_lever TEXT,                    -- root only: low | medium | high — how much the engine decides vs asks
	created_at    TEXT NOT NULL,
	updated_at    TEXT NOT NULL
);
CREATE INDEX idx_nodes_production ON nodes(production_id);
CREATE INDEX idx_nodes_parent     ON nodes(parent_id);
CREATE INDEX idx_nodes_account    ON nodes(account_id);

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

CREATE TABLE assets (
	id            TEXT PRIMARY KEY,
	production_id TEXT NOT NULL,
	node_id       TEXT REFERENCES nodes(id), -- the node that produced/gathered it (nullable)
	name          TEXT NOT NULL,
	description   TEXT,
	asset_type    TEXT NOT NULL,            -- ROLE: logo | screenshot | b-roll | music | vo | sfx | ...
	file_type     TEXT NOT NULL,            -- FORMAT: png | svg | mp4 | wav | mp3 | ...
	storage_path  TEXT NOT NULL,            -- file on the shared volume
	created_at    TEXT NOT NULL,
	updated_at    TEXT NOT NULL
);
CREATE INDEX idx_assets_production ON assets(production_id);

-- engine → chat: everything to SHOW the user
CREATE TABLE chat_output (
	id            TEXT PRIMARY KEY,
	account_id    TEXT,
	user_id       TEXT,                     -- the user this message is for
	production_id TEXT NOT NULL,
	node_id       TEXT,
	version_id    TEXT,
	type          TEXT NOT NULL,            -- present | notify | question | options   (confirm = options[Yes,No]); v0 emits present only
	status        TEXT NOT NULL,            -- pending | resolved
	prompt        TEXT,
	options       TEXT,                     -- JSON array (for options / confirm)
	created_at    TEXT NOT NULL,
	resolved_at   TEXT
);
CREATE INDEX idx_chat_output_pending ON chat_output(production_id, status);

-- user → engine: everything FROM the user (absorbs the old feedback table)
CREATE TABLE chat_input (
	id            TEXT PRIMARY KEY,
	account_id    TEXT,
	user_id       TEXT,                     -- the user this message came from
	production_id TEXT NOT NULL,
	node_id       TEXT,
	version_id    TEXT,
	responds_to   TEXT REFERENCES chat_output(id), -- the output it answers; NULL = unsolicited (e.g. ad-hoc feedback)
	kind          TEXT NOT NULL,            -- approve | feedback | answer
	body          TEXT,                     -- feedback text / chosen answer
	created_at    TEXT NOT NULL
);
CREATE INDEX idx_chat_input_production ON chat_input(production_id);

CREATE TABLE budget (
	production_id TEXT PRIMARY KEY,
	approved      INTEGER NOT NULL DEFAULT 0 -- the money-gate flag; promote to cost_events only if needed
);
```

Timestamps are ISO-8601 TEXT (SQLite has no native datetime); the `Clock` produces them.

## Test strategy

- **Core (loop + tool handlers):** unit tests against `FakeStore` + `FakeSubagentRunner` +
  `StubRenderClient` + fixed `Clock`/`IdGen`. No I/O. These are the tests that matter most — they pin
  the dispatch logic, the redo cap, the rollup, the `chat_output` emission.
- **Adapters:** thin focused tests. The SQLite `Store` against a temp DB file; the `claude -p` runner
  behind a flag (not in the default suite — it costs real calls); the render stub trivially.
- **Runner:** vitest (locked). Keep the suite fast and deterministic.

> Unit testing is a goal, **not a blocker** for the first spike — don't let scaffolding stall it.
