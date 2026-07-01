-- 0016_analysis_columns.sql
-- Add columns for Circle-IR extended analysis endpoints:
-- quality scoring, dedicated trust scoring, semantic understanding, spec-gap analysis.

-- ─── Quality Score (POST /api/quality — 5 passes) ───────────────────────────

ALTER TABLE skills ADD COLUMN IF NOT EXISTS quality_score REAL;
ALTER TABLE skills ADD COLUMN IF NOT EXISTS quality_tier TEXT;
ALTER TABLE skills ADD COLUMN IF NOT EXISTS quality_results JSONB;
ALTER TABLE skills ADD COLUMN IF NOT EXISTS quality_analyzed_at TIMESTAMP;

-- ─── Trust Score V2 (POST /api/trust — 27 passes) ──────────────────────────

ALTER TABLE skills ADD COLUMN IF NOT EXISTS trust_score_v2 REAL;
ALTER TABLE skills ADD COLUMN IF NOT EXISTS trust_tier TEXT;
ALTER TABLE skills ADD COLUMN IF NOT EXISTS trust_results JSONB;
ALTER TABLE skills ADD COLUMN IF NOT EXISTS trust_analyzed_at TIMESTAMP;

-- ─── Semantic Understanding (POST /api/understand) ──────────────────────────

ALTER TABLE skills ADD COLUMN IF NOT EXISTS understand_results JSONB;
ALTER TABLE skills ADD COLUMN IF NOT EXISTS understand_analyzed_at TIMESTAMP;

-- ─── Spec-Gap Analysis (POST /api/spec-diff) ────────────────────────────────

ALTER TABLE skills ADD COLUMN IF NOT EXISTS spec_alignment_score REAL;
ALTER TABLE skills ADD COLUMN IF NOT EXISTS spec_gaps JSONB;
ALTER TABLE skills ADD COLUMN IF NOT EXISTS spec_analyzed_at TIMESTAMP;
