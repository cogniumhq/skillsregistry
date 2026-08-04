-- 0036_slug_version_unique.sql
-- Allow multiple version rows per slug (local-node parity with mothership
-- migration 0041 / specifika V6.1). Fixes #42.
--
-- The base schema (0000_skills_base.sql) shipped
-- `CONSTRAINT skills_slug_unique UNIQUE (slug)`, but the surrounding code is
-- written for a multi-row-per-slug world (versions listing, get-by-slug
-- `ORDER BY created_at DESC LIMIT 1`, the `idx_skills_slug_version` composite).
-- Under the bare slug-unique constraint there is NO supported path to publish a
-- new version of an existing skill: `POST /v1/skills` collides on the slug and
-- returns 400 unique_violation. The mothership fixed this in 0041 (validated in
-- prod); local was left behind, breaking multi-version workflows and
-- migrate-door parity.
--
-- Published rows stay immutable — a new version is a NEW row, which is what the
-- code already assumes. Safety: every FK targets `skills(id)`, not
-- `skills(slug)`. The one INSERT that used `ON CONFLICT (slug)` (the upstream
-- write-through cache in apps/local/src/skills/skills-client.ts) moves to
-- `ON CONFLICT (slug, version)` in the same change. Existing data cannot violate
-- the replacement — under a unique slug, (slug, version) was already unique by
-- construction.
--
-- The replacement UNIQUE (slug, version) creates its own backing index on the
-- same columns in the same order, so the now-redundant `idx_skills_slug_version`
-- (from 0010 / 0014) is dropped rather than maintained twice on every write.

ALTER TABLE skills DROP CONSTRAINT IF EXISTS skills_slug_unique;

ALTER TABLE skills ADD CONSTRAINT skills_slug_version_key UNIQUE (slug, version);

DROP INDEX IF EXISTS idx_skills_slug_version;
