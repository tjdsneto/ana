-- Per-run diagnostics for a subagent interaction: how many agent turns it took, and how much of its
-- wall time was spent in model API calls. The engine already stores the wall duration it measures
-- (duration_ms); wall − api_duration_ms is the time the run spent NOT calling the model — tool
-- execution and, notably, rate-limit backoff. That gap is what explained a single 31-minute run (two
-- ~15-minute 429 backoffs). Both nullable; old rows and engines without the data stay NULL.
ALTER TABLE interactions ADD COLUMN num_turns integer;
ALTER TABLE interactions ADD COLUMN api_duration_ms integer;
