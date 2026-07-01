-- 0012_scan_coverage_v2.sql
-- Fix scan pipeline input coverage: add repository_url for cross-source GitHub links,
-- and reset metadata-only scans that produced false "verified" tier results.

-- Add repository_url column (GitHub repo discovered from upstream metadata)
ALTER TABLE skills ADD COLUMN IF NOT EXISTS repository_url TEXT;
CREATE INDEX IF NOT EXISTS idx_skills_repository_url ON skills (repository_url)
  WHERE repository_url IS NOT NULL;

-- Update scan_coverage CHECK constraint to include new coverage taxonomy
ALTER TABLE skills DROP CONSTRAINT IF EXISTS skills_scan_coverage_check;
ALTER TABLE skills ADD CONSTRAINT skills_scan_coverage_check
  CHECK (scan_coverage = ANY (ARRAY['full', 'partial', 'text-only', 'code-full', 'code-partial', 'instructions-only', 'metadata-only']));

-- Reset metadata-only scans so they re-enter the queue.
-- Preserve revoked/vulnerable skills (they had real findings).
UPDATE skills SET
  cognium_scanned = false,
  cognium_scanned_at = NULL,
  verification_tier = 'unverified',
  scan_coverage = NULL,
  cognium_findings = NULL,
  analyzer_summary = NULL,
  trust_score = CASE
    WHEN source = 'mcp-registry' THEN 0.70
    WHEN source = 'clawhub' THEN 0.60
    ELSE 0.50
  END
WHERE cognium_scanned = true
  AND source NOT IN ('github', 'manual', 'test')
  AND status NOT IN ('revoked', 'vulnerable')
  AND skill_md IS NULL
  AND schema_json IS NULL;
