-- Track who approved a version and when. approved_by: "human" (gate approval) | "agent" (engine
-- auto-approve on high autonomy after reviewers passed) | "agent-escalated" (forced past the cap).
-- Both are null on versions approved before this was tracked.
ALTER TABLE versions ADD COLUMN approved_by text;
ALTER TABLE versions ADD COLUMN approved_at timestamptz;
