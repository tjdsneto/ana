-- 0001_interactions — subagent interaction log. One row per SubagentRunner.run() (a producer draft
-- or one reviewer pass): which engine/model ran, the provider session id, token usage + cost, timing.
-- Mirrors the `interactions` table in shared/src/schema.ts — keep the two in lockstep.
--
-- Per-interaction usage = the row; whole-session usage = SUM(...) GROUP BY session_id. version_id is
-- nullable (a run may be recorded before/without a version) and, like the other self/soft refs, left
-- light on constraints to match the v0 style.

CREATE TABLE interactions (
	id                    text PRIMARY KEY,
	production_id         text NOT NULL,
	node_id               text NOT NULL REFERENCES nodes(id),
	version_id            text REFERENCES versions(id),
	role                  text NOT NULL,
	engine                text NOT NULL,
	model                 text,
	session_id            text,
	input_tokens          integer,
	output_tokens         integer,
	cache_read_tokens     integer,
	cache_creation_tokens integer,
	cost_usd              double precision,
	duration_ms           integer,
	status                text NOT NULL,
	created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_interactions_production ON interactions(production_id);
CREATE INDEX idx_interactions_session    ON interactions(session_id);
