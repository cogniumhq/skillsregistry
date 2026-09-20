-- 0029_publisher_keys.sql
-- D2: Publisher PKI — Ed25519 keys with CA-style trust chain.
--
-- Background: `/v1/skills` currently accepts any POST (modulo the public-guard
-- allowlist). skillsregistry.md §11 step 3 ("Sign with publisher
-- certificate") + step 5 ("signature check") call for cryptographic proof
-- that the bytes in the publish payload came from the claimed author. This
-- migration creates the key registry that backs that proof.
--
-- Model: CA-style chain. Cognium operator holds an offline Ed25519 root
-- private key; only the public key is stored here. The root signs zero or more
-- intermediate keys; intermediates sign per-publisher keys. Verifiers walk
-- `signed_by_key_id` up to a row with `root = TRUE`, depth ≤ 5.
--
-- Key id format: `pk_<base32(random16)>` (client-supplied, opaque to the DB).
-- Self-signed root rows use their own id in `signed_by_key_id`.
--
-- Lifecycle:
--   - revoked_at NOT NULL  → key cannot sign new payloads; existing skills
--                            get `signature_failure_reason='key_revoked'`
--                            via the KEY_REVOCATION_QUEUE cascade
--   - expires_at past      → key cannot sign new payloads (verifier rejects)
--   - superseded_by_key_id → soft rotation; old key still verifies prior
--                            signatures, but new publishes should use the new
--
-- See:
--   - src/publish/signature-verifier.ts (chain walk)
--   - src/publish/revocation-job.ts     (revocation cascade)
--   - src/routes/publisher-keys.ts      (lifecycle endpoints)

CREATE TABLE IF NOT EXISTS publisher_keys (
  key_id                  TEXT PRIMARY KEY,
  author_id               UUID NOT NULL REFERENCES authors(id) ON DELETE RESTRICT,
  algorithm               TEXT NOT NULL DEFAULT 'ed25519'
    CHECK (algorithm IN ('ed25519')),
  public_key_b64url       TEXT NOT NULL,
  public_key_fingerprint  TEXT NOT NULL UNIQUE,    -- sha256(raw_pubkey_bytes), lowercase hex

  -- Chain
  signed_by_key_id        TEXT NOT NULL REFERENCES publisher_keys(key_id) ON DELETE RESTRICT,
  parent_signature_b64url TEXT NOT NULL,           -- Ed25519 sig by parent over canonical key record
  root                    BOOLEAN NOT NULL DEFAULT FALSE,

  -- Lifecycle
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at              TIMESTAMPTZ,             -- NULL = never expires
  revoked_at              TIMESTAMPTZ,
  revocation_reason       TEXT,
  superseded_by_key_id    TEXT REFERENCES publisher_keys(key_id) ON DELETE SET NULL,

  -- Root rows self-sign (signed_by_key_id = key_id). Non-root must reference
  -- a different key. Both must carry a parent signature.
  CONSTRAINT chk_publisher_keys_root_self_sign
    CHECK (
      (root = TRUE  AND signed_by_key_id = key_id) OR
      (root = FALSE AND signed_by_key_id <> key_id)
    ),
  CONSTRAINT chk_publisher_keys_revocation_reason
    CHECK ((revoked_at IS NULL) = (revocation_reason IS NULL))
);

-- Exactly one active root. Revoked root is permitted so a fresh root can
-- replace it without violating the partial unique index.
CREATE UNIQUE INDEX IF NOT EXISTS idx_publisher_keys_one_active_root
  ON publisher_keys(root) WHERE root = TRUE AND revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_publisher_keys_author     ON publisher_keys(author_id);
CREATE INDEX IF NOT EXISTS idx_publisher_keys_signed_by  ON publisher_keys(signed_by_key_id);
CREATE INDEX IF NOT EXISTS idx_publisher_keys_revoked_at ON publisher_keys(revoked_at)
  WHERE revoked_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_publisher_keys_expires_at ON publisher_keys(expires_at)
  WHERE expires_at IS NOT NULL;
