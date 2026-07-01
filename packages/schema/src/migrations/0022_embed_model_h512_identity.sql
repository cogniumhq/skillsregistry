-- ════════════════════════════════════════════════════════════════════════════
-- A2: shadow identity stamp for the halfvec(512) column
-- ════════════════════════════════════════════════════════════════════════════
--
-- Migration 0021 added the new column (embedding_h512) and a single embed_model
-- identity column. That's enough for a flag-flip rollout — one column at a
-- time. A2 upgrades the rollout to true simultaneous dual-write: every
-- ingest produces BOTH a workers-ai vector AND a litellm vector, and both
-- live in their respective columns side-by-side. That gives us a real A/B
-- to measure parity (cosine, rank, top-K overlap) before the read-path flip.
--
-- For the re-embed gate to work across both columns independently, we need
-- a second identity stamp so each column can be invalidated on its own:
--
--   embed_model       — identity of whatever populated `embedding`
--   embed_model_h512  — identity of whatever populated `embedding_h512`
--
-- Both columns nullable: a row written by the workers-ai-only path stays NULL
-- for embed_model_h512 (and embedding_h512); a row written by the litellm-
-- only path stays NULL for embed_model (and embedding). A dual-write row
-- has both columns populated.
--
-- This migration does NOT cut over. The cutover (drop legacy column +
-- rename) is still a separate downstream migration (originally planned
-- as 0022; now renumbered to 0023 below) and lands only after parity is
-- measured on real traffic via /v1/admin/shadow-read.
--
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- 1. Second identity stamp, scoped to the halfvec column.
ALTER TABLE skill_embeddings
  ADD COLUMN IF NOT EXISTS embed_model_h512 text;

COMMIT;

-- ────────────────────────────────────────────────────────────────────────────
-- Cutover migration (separate file, applied after shadow-read parity is
-- verified on production-shape traffic):
--   0023_drop_legacy_bge_column.sql
--     - DROP INDEX idx_skill_embeddings_hnsw  (the old vector(384) one)
--     - ALTER TABLE skill_embeddings DROP COLUMN embedding
--     - ALTER TABLE skill_embeddings DROP COLUMN embed_model
--     - rename embedding_h512      → embedding
--     - rename embed_model_h512    → embed_model
--     - rename idx_skill_embeddings_h512_hnsw → idx_skill_embeddings_hnsw
-- ────────────────────────────────────────────────────────────────────────────
