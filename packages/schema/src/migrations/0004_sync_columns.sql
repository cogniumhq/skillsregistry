-- ============================================================================
-- Migration 0004: Add sync pipeline columns to skills table
-- ============================================================================
-- Adds columns needed for sync workers (change detection, upstream identity)
-- and the publish API (R2 bundles, Cognium scanning, tenant isolation).
-- ============================================================================

-- Sync identity & change detection
ALTER TABLE skills ADD COLUMN IF NOT EXISTS source_url TEXT;
ALTER TABLE skills ADD COLUMN IF NOT EXISTS source_hash TEXT;

-- Additional skill metadata from upstream sources
ALTER TABLE skills ADD COLUMN IF NOT EXISTS mcp_url TEXT;
ALTER TABLE skills ADD COLUMN IF NOT EXISTS skill_md TEXT;
ALTER TABLE skills ADD COLUMN IF NOT EXISTS r2_bundle_key TEXT;

-- Tenant isolation for published skills
ALTER TABLE skills ADD COLUMN IF NOT EXISTS tenant_id TEXT;

-- Cognium scanning timestamp
ALTER TABLE skills ADD COLUMN IF NOT EXISTS cognium_scanned_at TIMESTAMPTZ;

-- Unique constraint for sync upsert: ON CONFLICT (source, source_url)
-- Partial index: only applies when source_url is not null (manually published skills have no source_url)
CREATE UNIQUE INDEX IF NOT EXISTS idx_skills_source_source_url
  ON skills(source, source_url)
  WHERE source_url IS NOT NULL;

-- Index for change detection lookups
CREATE INDEX IF NOT EXISTS idx_skills_source_hash ON skills(source_hash);

-- Index for tenant filtering
CREATE INDEX IF NOT EXISTS idx_skills_tenant_id ON skills(tenant_id);
