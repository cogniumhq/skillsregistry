-- ════════════════════════════════════════════════════════════════════════════
-- §10 scope A: halfvec(512) + embed_model stamping
-- ════════════════════════════════════════════════════════════════════════════
--
-- Shadow-traffic window: this migration adds a second embedding column
-- (embedding_h512) alongside the existing fp32 vector(384). New ingests
-- under EMBEDDING_PROVIDER=litellm write only to the halfvec column +
-- stamp embed_model; new ingests under workers-ai (default) continue
-- writing only to the legacy column. /v1/search keeps reading the legacy
-- column until cutover migration 0022 drops it and renames.
--
-- Rollback semantics: if Qwen3 regresses on real traffic, flip
-- EMBEDDING_PROVIDER back to workers-ai. Rows ingested during the shadow
-- window will have NULL in the legacy column (HNSW skips them) and re-
-- enter the index via the existing embed-queue-backfill admin endpoint.
--
-- Storage math (validated in bake-off):
--   vector(384)   fp32:   64,427 × 384 × 4 B  = ~99 MB   (current)
--   halfvec(512)  fp16:   64,427 × 512 × 2 B  = ~63 MB   (target, 1.57× smaller)
--
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- 1. New halfvec column for Qwen3-Embedding-0.6B @ 512-dim Matryoshka.
--    Nullable because workers-ai ingests leave it NULL.
ALTER TABLE skill_embeddings
  ADD COLUMN IF NOT EXISTS embedding_h512 halfvec(512);

-- 2. Embed identity stamp: model × native_dim × stored_dim × instruction_version.
--    Re-embed gate: rows whose embed_model differs from current Embedder.identity
--    are enqueued for re-embedding by /v1/admin/embed-rebackfill.
ALTER TABLE skill_embeddings
  ADD COLUMN IF NOT EXISTS embed_model text;

-- 3. Make the legacy fp32 column nullable so litellm ingests can omit it
--    during the shadow window. pgvector HNSW already skips NULL rows.
ALTER TABLE skill_embeddings
  ALTER COLUMN embedding DROP NOT NULL;

-- 4. HNSW on the new column; keep the old one until cutover validated.
--    m=16, ef_construction=64 matches the bake-off settings (lower than
--    the legacy 128 because halfvec(512) builds faster and recall is
--    unchanged at this corpus size).
CREATE INDEX IF NOT EXISTS idx_skill_embeddings_h512_hnsw
  ON skill_embeddings
  USING hnsw (embedding_h512 halfvec_cosine_ops)
  WITH (m = 16, ef_construction = 64);

COMMIT;

-- ────────────────────────────────────────────────────────────────────────────
-- Cutover migration (separate file, applied after shadow-traffic validation):
--   0022_drop_legacy_bge_column.sql
--     - DROP INDEX idx_skill_embeddings_hnsw (the old vector(384) one)
--     - ALTER TABLE skill_embeddings DROP COLUMN embedding
--     - rename embedding_h512 → embedding
-- ────────────────────────────────────────────────────────────────────────────
