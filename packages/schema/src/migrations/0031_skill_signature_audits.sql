-- 0031_skill_signature_audits.sql
-- D2: Append-only audit log for every signature verification attempt.
--
-- Two jobs:
--   1. Replay defense — UNIQUE(nonce) catches nonce reuse atomically via
--      INSERT … ON CONFLICT (nonce) DO NOTHING RETURNING id. If no row
--      comes back, the verifier returns `nonce_reuse`.
--   2. Observability + post-mortem — operators need a record of every
--      failed verification (bad sig, revoked key, clock skew, etc.) to
--      diagnose publisher migration friction and detect attack patterns.
--
-- Rows are written via c.executionCtx.waitUntil(...) — never inline-await.
-- Audit-write failures must NOT block the publish path.
--
-- Retention is bounded by SIGNATURE_AUDIT_RETENTION_DAYS (default 90).
-- A future prune job (out of scope for this migration) deletes rows where
-- `at < NOW() - INTERVAL '<retention> days'`. The UNIQUE(nonce) index
-- still provides full replay defense within the retention window.
--
-- skill_id / key_id are NULLABLE because some failures happen BEFORE we
-- can resolve them (e.g. `unknown_key` — we have a key_id string but no
-- DB row; `payload_mismatch` — we have headers but the body's key_id
-- disagrees).
--
-- See:
--   - src/publish/signature-verifier.ts (step 8: insert + nonce check)
--   - src/publish/handler.ts            (failure-path audit writes)

CREATE TABLE IF NOT EXISTS skill_signature_audits (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_id      UUID REFERENCES skills(id) ON DELETE SET NULL,
  key_id        TEXT REFERENCES publisher_keys(key_id) ON DELETE SET NULL,
  nonce         TEXT NOT NULL UNIQUE,
  verdict       TEXT NOT NULL
    CHECK (verdict IN (
      'ok',
      'bad_sig',
      'key_revoked',
      'key_expired',
      'clock_skew',
      'nonce_reuse',
      'chain_broken',
      'unknown_key',
      'payload_mismatch',
      'content_hash_mismatch',
      'missing_signature'
    )),
  reason_detail TEXT,
  client_ip     TEXT,
  at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_signature_audits_at      ON skill_signature_audits(at DESC);
CREATE INDEX IF NOT EXISTS idx_signature_audits_skill   ON skill_signature_audits(skill_id)
  WHERE skill_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_signature_audits_key     ON skill_signature_audits(key_id)
  WHERE key_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_signature_audits_verdict ON skill_signature_audits(verdict, at DESC);
