-- ════════════════════════════════════════════════════════════════════════════
-- §10 A7: text_norm_sha256 fingerprint cache — idempotent re-embed gate
-- ════════════════════════════════════════════════════════════════════════════
--
-- A2 stamped each embedding row with `embed_model` so re-deploys with a
-- different model id can find stale rows. A7 adds the orthogonal stamp:
-- a SHA-256 of the normalized source text. With both, the embed-consumer
-- can short-circuit:
--
--   skip iff stored embed_model = current embedder identity
--        AND stored text_norm_sha256 = sha256(normalize(skill.agent_summary))
--
-- This catches the common case where the publish/composition pipelines
-- enqueue the same skill twice in a row, or where a sync run re-publishes
-- a skill whose agent_summary hasn't changed. Without the gate we re-call
-- the upstream embeddings endpoint on every replay, wasting ~50 ms + token cost.
--
-- Normalization (kept in lockstep with `src/ingestion/text-fingerprint.ts`):
--   lowercase → trim → collapse runs of whitespace to a single space → SHA-256
-- Anything more aggressive (stemming, punctuation strip, NFC) belongs in a
-- v2 once we measure cache hit rates against current normalization.
--
-- The column is NULL-able. Existing rows stay NULL after this migration;
-- the next embed cycle stamps them. The gate treats NULL as "must re-embed"
-- so a degraded fingerprint never serves stale results.
--
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE skill_embeddings
  ADD COLUMN IF NOT EXISTS text_norm_sha256 text;

-- Lookup index for the future "find rows with stale fingerprint" admin sweep.
-- A btree on a 64-char hex string is small and cheap; we don't expect this
-- to participate in joins, only equality scans alongside skill_id.
CREATE INDEX IF NOT EXISTS idx_skill_embeddings_text_norm
  ON skill_embeddings (text_norm_sha256);

COMMIT;

-- ────────────────────────────────────────────────────────────────────────────
-- Post-migration verification (run from psql):
--
--   -- Confirm column exists and is NULL for legacy rows:
--   SELECT column_name, data_type, is_nullable
--     FROM information_schema.columns
--    WHERE table_name = 'skill_embeddings'
--      AND column_name = 'text_norm_sha256';
--
--   -- After one embed cycle, confirm new rows are stamped:
--   SELECT COUNT(*) FILTER (WHERE text_norm_sha256 IS NULL) AS unstamped,
--          COUNT(*) FILTER (WHERE text_norm_sha256 IS NOT NULL) AS stamped
--     FROM skill_embeddings;
-- ────────────────────────────────────────────────────────────────────────────
