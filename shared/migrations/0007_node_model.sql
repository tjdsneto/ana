-- 0027: per-node subagent model override. A fanned-out child (e.g. an idea agent in the brainstorm)
-- can run a different model than its type's default, for model-diversity in the room. Null = use the
-- type contract's model, else SUBAGENT_MODEL (the unchanged default behaviour for every existing row).
ALTER TABLE nodes ADD COLUMN model text;
