-- Root-as-capability: a production's root node carries the intake params it was requested with
-- (resolved against the root type's `inputs` schema). Root only; children stay NULL.
ALTER TABLE nodes ADD COLUMN params jsonb;
