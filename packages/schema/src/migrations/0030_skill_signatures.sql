-- 0030_skill_signatures.sql
-- D2: Six signature columns on the `skills` table.
--
-- Background: every published skill needs a verifiable trail back to a
-- publisher key. Per skillsregistry.md §11 step 5, the registry
-- must record:
--   - the raw signature bytes (publisher_signature)
--   - which key signed (publisher_key_id → publisher_keys.key_id)
--   - the hash of the canonical bytes that were signed
--   - the wall-clock at signing (replay window enforcement)
--   - the nonce (replay defense)
--   - when verification succeeded (NULL if it never did)
--   - the failure code if verification did not succeed
--
-- Phased rollout (gated by env var SIGNATURE_REQUIRED, not the schema):
--   Phase A "false" → signature columns may be NULL on `source='publish'`
--                     rows; signature_failure_reason='missing_signature' set
--                     when client didn't sign.
--   Phase B "warn"  → same write semantics as A, plus HTTP Sunset / Warning
--                     headers emitted by the handler.
--   Phase C "true"  → handler rejects unsigned publishes outright. The
--                     follow-up migration 0033_enforce_signing_cutoff.sql
--                     replaces the placeholder CHECK below with a real
--                     MANDATORY_SIGNING_CUTOFF timestamp gate.
--
-- Sync workers (`source != 'publish'`) are PERMANENTLY exempt; the CHECK
-- carve-out keeps them legal regardless of phase. They cap at
-- `trust_badge = 'upstream'` — never eligible for human-verified.
--
-- See:
--   - src/publish/handler.ts            (phased write paths)
--   - src/publish/signature-verifier.ts (sets these columns on success)
--   - src/sync/base-sync.ts             (sets signature_failure_reason='sync_exempt')

ALTER TABLE skills ADD COLUMN IF NOT EXISTS publisher_signature       TEXT;
ALTER TABLE skills ADD COLUMN IF NOT EXISTS publisher_key_id          TEXT;
ALTER TABLE skills ADD COLUMN IF NOT EXISTS signed_payload_hash       TEXT;
ALTER TABLE skills ADD COLUMN IF NOT EXISTS signed_at                 TIMESTAMPTZ;
ALTER TABLE skills ADD COLUMN IF NOT EXISTS signature_nonce           TEXT;
ALTER TABLE skills ADD COLUMN IF NOT EXISTS signature_verified_at     TIMESTAMPTZ;
ALTER TABLE skills ADD COLUMN IF NOT EXISTS signature_failure_reason  TEXT;

-- Foreign key is added separately so the migration is forward-safe if the
-- publisher_keys table is rebuilt mid-development.
DO $$ BEGIN
  ALTER TABLE skills ADD CONSTRAINT fk_skills_publisher_key
    FOREIGN KEY (publisher_key_id) REFERENCES publisher_keys(key_id)
    ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Nonce uniqueness across the skills surface. The audit table (0031) has
-- its own UNIQUE(nonce) for transient replay defense; this partial unique
-- index pins durable uniqueness for rows that actually landed.
CREATE UNIQUE INDEX IF NOT EXISTS idx_skills_signature_nonce
  ON skills(signature_nonce) WHERE signature_nonce IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_skills_publisher_key_id
  ON skills(publisher_key_id) WHERE publisher_key_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_skills_signature_failure_reason
  ON skills(signature_failure_reason) WHERE signature_failure_reason IS NOT NULL;

-- Bounded values for signature_failure_reason. Aligns with the verifier's
-- failure enum + the sync_exempt / missing_signature handler outcomes.
DO $$ BEGIN
  ALTER TABLE skills ADD CONSTRAINT chk_skills_signature_failure_reason
    CHECK (signature_failure_reason IS NULL OR signature_failure_reason IN (
      'missing_signature',
      'sync_exempt',
      'bad_sig',
      'key_revoked',
      'key_expired',
      'clock_skew',
      'nonce_reuse',
      'chain_broken',
      'unknown_key',
      'payload_mismatch',
      'content_hash_mismatch'
    ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Placeholder Phase A/B CHECK. Migration 0033 replaces this with a cutoff
-- timestamp once we are ready to enforce. Today it only enforces internal
-- consistency: if verification succeeded, all the supporting columns must
-- be present.
DO $$ BEGIN
  ALTER TABLE skills ADD CONSTRAINT chk_skills_signature_consistency
    CHECK (
      signature_verified_at IS NULL
      OR (
            publisher_signature  IS NOT NULL
        AND publisher_key_id     IS NOT NULL
        AND signed_payload_hash  IS NOT NULL
        AND signed_at            IS NOT NULL
        AND signature_nonce      IS NOT NULL
        AND signature_failure_reason IS NULL
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
