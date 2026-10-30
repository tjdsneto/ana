# Spec 03 — Ports, adapters & testing (+ DB schema)

**Status:** draft to build against. Depends on specs 01–02. Defines the interfaces the core depends on,
the Postgres schema behind the `Store`, and the test strategy. The whole point: the loop and the tool
handlers unit-test against **fakes** — no DB, no network, no `claude -p`.

> Rule: core logic depends on the **interface**, never the concrete. Even if the language changes
> later, these seams survive because they are conceptual.

## The ports

All live in `shared` and are imported by both `server/mcp` and `engine`.

### Store — all DB access

One interface over every table in spec 01. Tool handlers and the loop call `Store`, never the DB directly.

```ts
export interface Store {
	// accounts + users (the tenant/identity seam — PoC resolves to one default each)
	defaultAccount(): Promise<Account>                            // seeds on first call; always returns the default in v0
	getAccount(id: string): Promise<Account | null>
	defaultUser(): Promise<User>                                  // seeds the default user under the default account
	getUser(id: string): Promise<User | null>

	// productions / nodes
	createProduction(input: NewProduction): Promise<Node>          // root under accountId + userId; input carries autonomyLever + actorKind
	getNode(id: string): Promise<Node | null>
	getProduction(id: string): Promise<Node | null>               // the root node
	listReadyNodes(productionId: string): Promise<Node[]>         // pending + deps approved + parent active
	updateNodeStatus(id: string, status: NodeStatus): Promise<void>
	createChildNodes(parentId: string, children: NewNode[]): Promise<Node[]>  // expand / plan

	// versions
	createVersion(input: NewVersion): Promise<Version>
	updateVersion(id: string, patch: VersionPatch): Promise<void>
	getVersion(id: string): Promise<Version | null>
	latestVersion(nodeId: string): Promise<Version | null>

	// reviews
	addReview(input: NewReview): Promise<Review>
	reviewsFor(versionId: string): Promise<Review[]>

	// assets
	addAsset(input: NewAsset): Promise<Asset>
	assetsFor(productionId: string): Promise<Asset[]>

	// chat I/O — split by direction (spec 01)
	emitOutput(input: NewChatOutput): Promise<ChatOutput>        // engine → chat (present | notify | question | options)
	getOutput(id: string): Promise<ChatOutput | null>            // resolve an output_id (approve / submit_feedback)
	pendingOutputs(productionId: string): Promise<ChatOutput[]>   // the client `inbox`: unresolved chat_output
	recordInput(input: NewChatInput): Promise<ChatInput>         // chat → engine (approve | feedback | answer)
	resolveOutput(id: string): Promise<void>                       // mark a chat_output resolved (an input answered it)

	// budget
	getBudget(productionId: string): Promise<Budget>
	approveBudget(productionId: string): Promise<void>
}
```

- Concurrency: the loop, the MCP server, and the dashboard API are **concurrent writers/readers**.
  Postgres MVCC handles that natively; each `Store` method is one transaction. See "Concurrency &
  wakeups" below for claiming (`SKIP LOCKED`) and push (`LISTEN/NOTIFY`).
- Partial updates matter — `updateVersion(id, patch)` must not rewrite the whole row.
- The adapter is **Drizzle + `pg`** (TS-native, SQL-first). The port keeps the DB swappable; only the
  adapter + DDL are Postgres-specific.

> **Render/voice are not ports.** An earlier draft had a `RenderClient` (and `VoiceClient` / `Exec`)
> port; those were removed. A rendered leaf runs its skill (spec 09), which drives the craft tools
> (ffmpeg, TTS) directly and writes the `.mp4`; the engine only records the file. There is no render
> engine behind an interface — the craft layer owns it.

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

## Postgres schema (behind the Store)

Falls out of spec 01. **Postgres** (a `db` service in Compose — see spec 07), not SQLite: it is the
v1 shape, removes the single-writer ceiling, and gives `LISTEN/NOTIFY` (push, not poll) + `jsonb` +
`SELECT … FOR UPDATE SKIP LOCKED` (clean job claiming). One `nodes` table (no separate productions/jobs
table — the root node *is* the production), plus a thin `accounts` table (the tenant seam — PoC seeds
one default row). Lives in `shared` as migrations (Drizzle).

Ids are app-generated strings (`IdGen`) → `text` PKs. Timestamps are `timestamptz`; the app supplies
them via `Clock` (the `DEFAULT now()` is a convenience, overridden in deterministic tests). Status
columns stay `text` in v0 (promote to enums/`CHECK` later).

```sql
CREATE TABLE accounts (
	id         text PRIMARY KEY,
	name       text NOT NULL,
	created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
	id         text PRIMARY KEY,
	account_id text NOT NULL REFERENCES accounts(id), -- account 1—* users
	name       text NOT NULL,
	created_at timestamptz NOT NULL DEFAULT now()
);
-- PoC seeds exactly one default account + one default user on init; every production points at them
-- via nodes.account_id / nodes.user_id.

CREATE TABLE nodes (
	id             text PRIMARY KEY,
	account_id     text REFERENCES accounts(id), -- root only: the owning account (tenant); NULL on children
	user_id        text REFERENCES users(id),    -- root only: the user who requested it; NULL on children
	production_id  text NOT NULL,            -- groups one tree; equals the root node's id
	parent_id      text REFERENCES nodes(id),-- NULL = root = the production
	type           text NOT NULL,            -- resolved against the type registry (files)
	name           text NOT NULL,
	description    text,
	status         text NOT NULL,            -- pending | ready | in-progress | needs-presentation | presented | approved | ...
	deps           jsonb NOT NULL DEFAULT '[]'::jsonb, -- array of node ids (sibling prerequisites)
	position       integer NOT NULL DEFAULT 0,
	session_id     text,                     -- root only: the owning client session (nudge target)
	autonomy_lever text,                     -- root only: low | medium | high — how much the engine decides vs asks
	actor_kind     text,                     -- root only: human | agent — who answers the chat; sets the agreement cap
	created_at     timestamptz NOT NULL DEFAULT now(),
	updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_nodes_production ON nodes(production_id);
CREATE INDEX idx_nodes_parent     ON nodes(parent_id);
CREATE INDEX idx_nodes_account    ON nodes(account_id);

CREATE TABLE versions (
	id              text PRIMARY KEY,
	node_id         text NOT NULL REFERENCES nodes(id),
	n               integer NOT NULL,
	prev_version_id text REFERENCES versions(id),
	status          text NOT NULL,          -- producing | in-review | presentable | presented | approved | denied | needs-work | superseded
	artifact_path   text,                   -- file on the shared volume (not in the DB)
	subagent        jsonb,                  -- attached subagent + state (idempotency)
	feedback        text,
	created_at      timestamptz NOT NULL DEFAULT now(),
	updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_versions_node ON versions(node_id);

CREATE TABLE reviews (
	id         text PRIMARY KEY,
	node_id    text NOT NULL REFERENCES nodes(id),
	version_id text NOT NULL REFERENCES versions(id),
	name       text NOT NULL,               -- rubric name (craft side; files)
	kind       text NOT NULL,               -- craft | coverage | consistency
	verdict    text NOT NULL,               -- pass | revise
	body       text,
	created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE assets (
	id            text PRIMARY KEY,
	production_id text NOT NULL,
	node_id       text REFERENCES nodes(id), -- the node that produced/gathered it (nullable)
	name          text NOT NULL,
	description   text,
	asset_type    text NOT NULL,            -- ROLE: logo | screenshot | b-roll | music | vo | sfx | ...
	file_type     text NOT NULL,            -- FORMAT: png | svg | mp4 | wav | mp3 | ...
	storage_path  text NOT NULL,            -- file on the shared volume
	created_at    timestamptz NOT NULL DEFAULT now(),
	updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_assets_production ON assets(production_id);

-- engine → chat: everything to SHOW the user
CREATE TABLE chat_output (
	id            text PRIMARY KEY,
	account_id    text,
	user_id       text,                     -- the user this message is for
	production_id text NOT NULL,
	node_id       text,
	version_id    text,
	type          text NOT NULL,            -- present | notify | question | options   (confirm = options[Yes,No]); v0 emits present only
	status        text NOT NULL,            -- pending | resolved
	prompt        text,
	options       jsonb,                    -- array (for options / confirm)
	created_at    timestamptz NOT NULL DEFAULT now(),
	resolved_at   timestamptz
);
CREATE INDEX idx_chat_output_pending ON chat_output(production_id, status);

-- user → engine: everything FROM the user (absorbs the old feedback table)
CREATE TABLE chat_input (
	id            text PRIMARY KEY,
	account_id    text,
	user_id       text,                     -- the user this message came from
	production_id text NOT NULL,
	node_id       text,
	version_id    text,
	responds_to   text REFERENCES chat_output(id), -- the output it answers; NULL = unsolicited (e.g. ad-hoc feedback)
	kind          text NOT NULL,            -- approve | feedback | answer
	body          text,                     -- feedback text / chosen answer
	created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_chat_input_production ON chat_input(production_id);

CREATE TABLE budget (
	production_id text PRIMARY KEY,
	approved      boolean NOT NULL DEFAULT false -- the money-gate flag; promote to cost_events only if needed
);
```

## Concurrency & wakeups (Postgres)

- **Multiple writers, native.** Postgres MVCC lets the MCP server, the worker, and the dashboard API
  all read/write concurrently — no single-writer ceiling. Each `Store` method is one transaction.
- **Job claiming (multi-worker seam):** `SELECT … FROM nodes WHERE status='pending' … FOR UPDATE SKIP
  LOCKED LIMIT 1` lets N workers each grab a different ready node with no double-dispatch. v0 runs one
  worker; this is the seam that makes adding workers a config change, not a redesign.
- **Wakeups via `LISTEN/NOTIFY` (push, not poll):** on insert of a queued production the writer fires
  `NOTIFY new_job`; the worker `LISTEN new_job` wakes immediately (the `POLL_INTERVAL_MS` loop stays as
  a cheap fallback). On a version turning presentable the worker fires `NOTIFY presentable`; the
  dashboard API (spec 06) relays it over WebSocket to the browser. NOTIFY is app-level (the Store emits
  it after the write) — no triggers needed in v0.
- **Artifacts bypass the DB entirely** — big files (renders, audio) are written to `server/data/artifacts`
  on the shared volume and only *referenced* by `artifact_path` / `storage_path`, so heavy I/O never
  touches a row lock.
```

Timestamps are `timestamptz`; the `Clock` supplies them from the app (the DDL `DEFAULT now()` is a
convenience), so tests stay deterministic.

## Test strategy

- **Core (loop + tool handlers):** unit tests against `FakeStore` + `FakeSubagentRunner` + fixed
  `Clock`/`IdGen`. No I/O. These are the tests that matter most — they pin the dispatch logic, the
  redo cap, the rollup, the reopen/revalidation cascade (spec 10), the `chat_output` emission.
- **Adapters:** thin focused tests. The Postgres `Store` against a throwaway test database (a
  disposable container / Testcontainers, or a scratch schema); the `claude -p` runner
  behind a flag (not in the default suite — it costs real calls).
- **Runner:** vitest (locked). Keep the suite fast and deterministic.

> Unit testing is a goal, **not a blocker** for the first spike — don't let scaffolding stall it.
