-- 0033_mothership_publish.sql
-- Add columns for T-2.10 migration door (POST /v1/migrate/publish).
--
-- When the local node promotes a skill to the mothership, we persist the
-- returned identity + status so:
--   - operators can look up "which local skills have been published upstream"
--   - a re-publish is a no-op / status-refresh instead of a duplicate insert
--   - the mothership URL is discoverable from a local skill row
--
-- All columns are optional. Rows that were never promoted stay NULL; sync-
-- source rows (glama, smithery, mcp-registry, etc.) also stay NULL — only
-- skills the operator explicitly promotes via /v1/migrate/publish get
-- populated.

ALTER TABLE skills ADD COLUMN IF NOT EXISTS mothership_skill_id       TEXT;
ALTER TABLE skills ADD COLUMN IF NOT EXISTS mothership_publish_status TEXT;
ALTER TABLE skills ADD COLUMN IF NOT EXISTS mothership_published_at   TIMESTAMP;
ALTER TABLE skills ADD COLUMN IF NOT EXISTS mothership_url            TEXT;

-- Fast lookup for "was this local skill promoted, and to which upstream id?"
CREATE INDEX IF NOT EXISTS idx_skills_mothership_skill_id
  ON skills (mothership_skill_id)
  WHERE mothership_skill_id IS NOT NULL;
