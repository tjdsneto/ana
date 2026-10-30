-- Persist the full prompt sent to each subagent, so the observability UI can show
-- exactly what the producer/reviewer was asked (not just its output + telemetry).
-- Nullable; old rows stay NULL (rendered as "not recorded").
ALTER TABLE interactions ADD COLUMN prompt text;
