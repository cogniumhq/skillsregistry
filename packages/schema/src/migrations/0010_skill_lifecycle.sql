-- 0010_skill_lifecycle.sql
-- v5.0: Status lifecycle, Cognium attestation, skill type, version lineage,
-- trust provenance, and usage signals.
--
-- Handles column renames from v4 (type→skill_type, fork_of→forked_from)
-- and expands the status CHECK constraint.

-- ─── Skill type (replaces v4 'type' column) ─────────────────────────────────
ALTER TABLE skills ADD COLUMN IF NOT EXISTS skill_type TEXT NOT NULL DEFAULT 'atomic'
  CHECK (skill_type IN ('atomic', 'auto-composite', 'human-composite', 'forked'));

-- Migrate existing v4 'type' values → skill_type
UPDATE skills SET skill_type = CASE
  WHEN type = 'composition' THEN 'auto-composite'
  WHEN type = 'pipeline' THEN 'auto-composite'
  ELSE 'atomic'
END WHERE skill_type = 'atomic' AND type IS NOT NULL AND type != 'skill';

-- ─── Version lineage (replaces v4 fork_of/origin_id/fork_depth) ─────────────
ALTER TABLE skills ADD COLUMN IF NOT EXISTS forked_from TEXT;      -- 'slug@version'
ALTER TABLE skills ADD COLUMN IF NOT EXISTS forked_by TEXT;
ALTER TABLE skills ADD COLUMN IF NOT EXISTS fork_changes JSONB;
ALTER TABLE skills ADD COLUMN IF NOT EXISTS root_source TEXT;      -- original registry source for trust floor

-- Migrate existing fork_of UUIDs where possible (set forked_from to NULL, root_source from source)
UPDATE skills SET root_source = source WHERE fork_of IS NOT NULL AND root_source IS NULL;

-- ─── Composition support ─────────────────────────────────────────────────────
ALTER TABLE skills ADD COLUMN IF NOT EXISTS composition_skill_ids UUID[];

-- Backfill composition_skill_ids from composition_steps for existing compositions
UPDATE skills SET composition_skill_ids = (
  SELECT ARRAY_AGG(skill_id ORDER BY step_order)
  FROM composition_steps WHERE composition_id = skills.id
) WHERE skill_type IN ('auto-composite', 'human-composite')
  AND composition_skill_ids IS NULL;

-- ─── Status lifecycle expansion ──────────────────────────────────────────────
-- Drop old CHECK constraint and add expanded one
ALTER TABLE skills DROP CONSTRAINT IF EXISTS skills_status_check;
ALTER TABLE skills ADD CONSTRAINT skills_status_check
  CHECK (status IN ('draft', 'published', 'deprecated', 'archived',
                    'vulnerable', 'revoked', 'degraded', 'contains-vulnerable'));

-- Revocation/deprecation tracking
ALTER TABLE skills ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;
ALTER TABLE skills ADD COLUMN IF NOT EXISTS revoked_reason TEXT;
ALTER TABLE skills ADD COLUMN IF NOT EXISTS deprecated_at TIMESTAMPTZ;
ALTER TABLE skills ADD COLUMN IF NOT EXISTS deprecated_reason TEXT;
ALTER TABLE skills ADD COLUMN IF NOT EXISTS remediation_message TEXT;
ALTER TABLE skills ADD COLUMN IF NOT EXISTS remediation_url TEXT;

-- ─── Cognium attestation fields ──────────────────────────────────────────────
ALTER TABLE skills ADD COLUMN IF NOT EXISTS verification_tier TEXT DEFAULT 'unverified'
  CHECK (verification_tier IN ('unverified', 'scanned', 'verified', 'certified'));
ALTER TABLE skills ADD COLUMN IF NOT EXISTS scan_coverage TEXT
  CHECK (scan_coverage IN ('full', 'partial', 'text-only'));
ALTER TABLE skills ADD COLUMN IF NOT EXISTS cognium_findings JSONB;
ALTER TABLE skills ADD COLUMN IF NOT EXISTS analyzer_summary JSONB;

-- ─── Trust provenance ────────────────────────────────────────────────────────
ALTER TABLE skills ADD COLUMN IF NOT EXISTS trust_badge TEXT
  CHECK (trust_badge IN ('human-verified', 'auto-distilled', 'upstream'));
ALTER TABLE skills ADD COLUMN IF NOT EXISTS human_distilled_by TEXT;
ALTER TABLE skills ADD COLUMN IF NOT EXISTS human_distilled_at TIMESTAMPTZ;

-- ─── Usage signals (version ranking) ────────────────────────────────────────
ALTER TABLE skills ADD COLUMN IF NOT EXISTS run_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE skills ADD COLUMN IF NOT EXISTS last_run_at TIMESTAMPTZ;

-- ─── Indexes ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_skills_skill_type ON skills (skill_type);
CREATE INDEX IF NOT EXISTS idx_skills_status ON skills (status);
CREATE INDEX IF NOT EXISTS idx_skills_slug_version ON skills (slug, version);
CREATE INDEX IF NOT EXISTS idx_skills_composition ON skills USING GIN (composition_skill_ids);
CREATE INDEX IF NOT EXISTS idx_skills_verification_tier ON skills (verification_tier);
CREATE INDEX IF NOT EXISTS idx_skills_run_count ON skills (run_count DESC);
