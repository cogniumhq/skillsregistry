-- ════════════════════════════════════════════════════════════════════════════
-- §10 A10: cutover — drop legacy bge column, promote halfvec(512) to canonical
-- ════════════════════════════════════════════════════════════════════════════
--
-- Migrations 0021 + 0022 stood up the shadow column (embedding_h512) +
-- identity stamp (embed_model_h512) alongside the legacy bge vector(384).
-- A8 ran dual-write. The §10 A6 backfill (scripts/h512-direct-backfill.ts)
-- populated embedding_h512 for every published agent_summary row against the
-- production runics DB on 2026-06-11 (63,296/63,296, zero errors).
--
-- A3 cut /v1/search over to the halfvec column via EMBEDDING_PROVIDER=litellm
-- and proved relevance on the 91-fixture eval (R@5=87.8%, MRR=0.749,
-- T1 accuracy 96.4%). A4 recalibrated the confidence tier thresholds.
--
-- This migration finalizes the cutover by:
--   1. Dropping the alt_query_* rows — retrieval-only architecture no longer
--      uses index-time LLM query expansion (§10 root-cause fix for the §12
--      cost incident). Only agent_summary rows are indexed going forward.
--   2. Dropping the legacy bge HNSW index.
--   3. Dropping the legacy `embedding` (vector(384)) column.
--   4. Dropping the legacy `embed_model` column.
--   5. Renaming `embedding_h512` → `embedding` and `embed_model_h512` →
--      `embed_model` so the canonical column name is back to `embedding` —
--      now typed halfvec(512) instead of vector(384).
--   6. Renaming `idx_skill_embeddings_h512_hnsw` → `idx_skill_embeddings_hnsw`.
--
-- ────────────────────────────────────────────────────────────────────────────
-- DESTRUCTIVE — ONE-WAY
-- ────────────────────────────────────────────────────────────────────────────
--
-- After this lands:
--   - workers-ai (bge-small-en-v1.5) can no longer write or read. The provider
--     branch on EMBEDDING_PROVIDER becomes dead code and is removed in the
--     same PR.
--   - Rollback requires restoring from a Neon branch backup and re-running
--     the workers-ai backfill. Take a Neon branch snapshot BEFORE applying.
--
-- Storage impact (production runics, post-backfill):
--   skill_embeddings rows: ~382K → ~64K (alt_query rows dropped)
--   embedding column:      99 MB (vector(384) fp32) → 63 MB (halfvec(512) fp16)
--
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- 1. Retire alt_query expansion rows. §10 architecture is retrieval-only:
--    a single agent_summary embedding per skill, optionally reranked at query
--    time. Index-time fan-out was the §12 cost driver and is gone.
DELETE FROM skill_embeddings
WHERE source LIKE 'alt_query_%';

-- 2. Drop the legacy HNSW index on the bge column. Must drop before the
--    column itself.
DROP INDEX IF EXISTS idx_skill_embeddings_hnsw;

-- 3. Drop the legacy bge column and its identity stamp.
ALTER TABLE skill_embeddings
  DROP COLUMN IF EXISTS embedding;

ALTER TABLE skill_embeddings
  DROP COLUMN IF EXISTS embed_model;

-- 4. Promote the halfvec column + identity stamp to the canonical names.
--    Code already references `embedding`/`embed_model` after the cutover PR.
ALTER TABLE skill_embeddings
  RENAME COLUMN embedding_h512 TO embedding;

ALTER TABLE skill_embeddings
  RENAME COLUMN embed_model_h512 TO embed_model;

-- 5. Re-establish the canonical index name on the (now-renamed) column.
ALTER INDEX idx_skill_embeddings_h512_hnsw RENAME TO idx_skill_embeddings_hnsw;

-- 6. Leave `embedding` NULL-able. The §10 A6 backfill covered every published
--    agent_summary row but not the long tail of unpublished skills (draft /
--    revoked / degraded statuses — never returned by search anyway). The
--    SearchProvider WHERE clause filters NULL embeddings explicitly (§10 A3)
--    so unembedded rows can't surface as top-K. A future backfill can flip
--    this to NOT NULL once every row has an embedding.

COMMIT;

-- ────────────────────────────────────────────────────────────────────────────
-- Post-migration verification (run from psql):
--
--   -- Confirm column type is halfvec(512):
--   SELECT column_name, data_type, udt_name
--     FROM information_schema.columns
--    WHERE table_name = 'skill_embeddings'
--      AND column_name IN ('embedding', 'embed_model');
--
--   -- Confirm only agent_summary rows remain:
--   SELECT source, COUNT(*) FROM skill_embeddings GROUP BY source;
--
--   -- Confirm HNSW index exists on the renamed column:
--   SELECT indexname, indexdef FROM pg_indexes
--    WHERE tablename = 'skill_embeddings';
-- ────────────────────────────────────────────────────────────────────────────
