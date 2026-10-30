-- Revalidation support: record what each version was produced from, so a reopened
-- upstream can be detected as a real change (hash differs) vs a no-op. Nullable; old
-- rows stay NULL (treated as "unknown" — revalidated conservatively).
ALTER TABLE versions ADD COLUMN built_from jsonb;
