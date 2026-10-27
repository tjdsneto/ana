-- 0000_init — initial schema. Mirrors server/shared/src/schema.ts (the canonical Drizzle schema)
-- and spec 03. Hand-authored so the PoC bootstraps with a plain pg runner (src/migrate.ts) and no
-- drizzle-kit/network dependency. Status/kind/type columns stay `text` in v0.
--
-- parent_id and prev_version_id are intentionally NOT foreign keys (self-refs are omitted to keep
-- root/first-version inserts trivial), matching schema.ts. Keep the two files in lockstep.

CREATE TABLE accounts (
	id         text PRIMARY KEY,
	name       text NOT NULL,
	created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
	id         text PRIMARY KEY,
	account_id text NOT NULL REFERENCES accounts(id),
	name       text NOT NULL,
	created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE nodes (
	id             text PRIMARY KEY,
	account_id     text REFERENCES accounts(id),
	user_id        text REFERENCES users(id),
	production_id  text NOT NULL,
	parent_id      text,
	type           text NOT NULL,
	name           text NOT NULL,
	description    text,
	status         text NOT NULL,
	deps           jsonb NOT NULL DEFAULT '[]'::jsonb,
	position       integer NOT NULL DEFAULT 0,
	session_id     text,
	autonomy_lever text,
	actor_kind     text,
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
	prev_version_id text,
	status          text NOT NULL,
	artifact_path   text,
	subagent        jsonb,
	feedback        text,
	created_at      timestamptz NOT NULL DEFAULT now(),
	updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_versions_node ON versions(node_id);

CREATE TABLE reviews (
	id         text PRIMARY KEY,
	node_id    text NOT NULL REFERENCES nodes(id),
	version_id text NOT NULL REFERENCES versions(id),
	name       text NOT NULL,
	kind       text NOT NULL,
	verdict    text NOT NULL,
	body       text,
	created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE assets (
	id            text PRIMARY KEY,
	production_id text NOT NULL,
	node_id       text REFERENCES nodes(id),
	name          text NOT NULL,
	description   text,
	asset_type    text NOT NULL,
	file_type     text NOT NULL,
	storage_path  text NOT NULL,
	created_at    timestamptz NOT NULL DEFAULT now(),
	updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_assets_production ON assets(production_id);

CREATE TABLE chat_output (
	id            text PRIMARY KEY,
	account_id    text,
	user_id       text,
	production_id text NOT NULL,
	node_id       text,
	version_id    text,
	type          text NOT NULL,
	status        text NOT NULL,
	prompt        text,
	options       jsonb,
	created_at    timestamptz NOT NULL DEFAULT now(),
	resolved_at   timestamptz
);
CREATE INDEX idx_chat_output_pending ON chat_output(production_id, status);

CREATE TABLE chat_input (
	id            text PRIMARY KEY,
	account_id    text,
	user_id       text,
	production_id text NOT NULL,
	node_id       text,
	version_id    text,
	responds_to   text REFERENCES chat_output(id),
	kind          text NOT NULL,
	body          text,
	created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_chat_input_production ON chat_input(production_id);

CREATE TABLE budget (
	production_id text PRIMARY KEY,
	approved      boolean NOT NULL DEFAULT false
);
