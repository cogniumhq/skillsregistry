-- ══════════════════════════════════════════════════════════════════════════════
-- 0000_skills_base.sql — bootstrap the `skills` base table.
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Historical context
-- ------------------
-- Migrations 0001–0033 were extracted from the proprietary mothership repo
-- (github.com/cogniumhq/skillsregistry), where the `skills` table was created
-- by an earlier Drizzle-managed bootstrap that never crossed into this open-
-- source SDK. Every ALTER, FK, and view in 0001+ assumes the table already
-- exists. A fresh `docker compose up` therefore fails at 0001 with
-- `relation "skills" does not exist`.
--
-- This migration seeds the minimum column set every downstream migration
-- expects at its own version. All richer columns (author_id, skill_type,
-- runtime_env, publisher_signature, mothership_*, etc.) are added by their
-- own ALTER migrations (0004–0033); we deliberately do not front-load them
-- here.
--
-- Design rules
-- ------------
--   1. Only columns referenced *before their owning ALTER migration runs*.
--      In practice the bootstrap only needs `id` (FK target for 0001's
--      skill_embeddings). We include the other minimally-required columns
--      (name, slug, version, source, execution_layer, status) so a fresh
--      install can survive `POST /v1/skills` between bootSchema() and the
--      first sync run.
--
--   2. Every column matches the eventual Drizzle type in
--      packages/schema/src/schema.ts to avoid `ALTER COLUMN TYPE` churn.
--
--   3. Constraints and indexes stay minimal — later migrations own their
--      own indexes. We add just the ones referenced by 0009's materialized
--      views (trust_score, source, execution_layer, status) so the views
--      have hot paths from day one.
--
--   4. Idempotent: `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT
--      EXISTS`. The runner records this migration in schema_migrations
--      once applied; re-runs skip. Existing production databases (with
--      the table already present from an old mothership bootstrap) also
--      no-op cleanly.
--
--   5. The `type` column is deliberately included (nullable, no default)
--      because 0010 runs `UPDATE ... FROM (VALUES ...) mapping WHERE
--      skills.type = mapping.old_type` to migrate legacy skill types to
--      the new `skill_type` column. On a fresh install `type` is empty,
--      the UPDATE is a no-op, and everything proceeds.
--
--   6. The status CHECK constraint uses the expanded value set from
--      migration 0010 (published/draft/deprecated/archived/vulnerable/
--      revoked/degraded/contains-vulnerable) rather than the narrower set
--      that would have shipped with a v3 bootstrap, so 0010's constraint
--      rewrite becomes a no-op.
--
-- ══════════════════════════════════════════════════════════════════════════════

-- Required for gen_random_uuid(). Idempotent — no-op if already installed.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Baseline (pre-0004) column set — matches the v3 mothership bootstrap that
-- 0005 relies on (see its `-- Metadata (tags already exists as text[], skip
-- it)` comment). Columns added by 0004+ live in their own migrations; this
-- table is intentionally the smaller pre-v4 shape.
CREATE TABLE IF NOT EXISTS skills (
  -- ─── identity ─────────────────────────────────────────────────────────────
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ─── core metadata ────────────────────────────────────────────────────────
  name                   TEXT NOT NULL,
  slug                   TEXT NOT NULL,
  version                TEXT NOT NULL DEFAULT '1.0.0',
  source                 TEXT NOT NULL,
  description            TEXT,

  -- ─── content + retrieval ──────────────────────────────────────────────────
  agent_summary          TEXT,
  alternate_queries      TEXT[],
  schema_json            JSONB,
  auth_requirements      JSONB,
  install_method         JSONB,
  capabilities_required  TEXT[],

  -- ─── quality + execution ──────────────────────────────────────────────────
  trust_score            NUMERIC(3,2) DEFAULT 0.5,
  execution_layer        TEXT NOT NULL,
  content_safety_passed  BOOLEAN DEFAULT true,

  -- ─── discovery ────────────────────────────────────────────────────────────
  tags                   TEXT[],
  category               TEXT,

  -- ─── legacy scan flag ─────────────────────────────────────────────────────
  -- `cognium_scanned` (BOOLEAN) is referenced by 0012 (`UPDATE skills SET
  -- cognium_scanned = false ... WHERE cognium_scanned = true`) but never
  -- added by a shipped migration. CLAUDE.md flags this as a known issue —
  -- production paths use `cognium_scanned_at IS NULL` instead. We seed the
  -- column here so 0012's UPDATE parses cleanly; on a fresh install the
  -- WHERE clause matches zero rows, so this is a documentation footnote,
  -- not a behavior change.
  cognium_scanned        BOOLEAN DEFAULT FALSE,

  -- ─── lifecycle ────────────────────────────────────────────────────────────
  -- `status` intentionally omitted here — 0005 adds it via ADD COLUMN IF NOT
  -- EXISTS with its own initial CHECK, then 0010 rewrites the constraint to
  -- the expanded value set. Adding it here would collide with 0005's CHECK.
  --
  -- `type` likewise added by 0005 (with CHECK IN skill/composition/pipeline)
  -- and migrated into `skill_type` by 0010.

  -- ─── timestamps ───────────────────────────────────────────────────────────
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- ─── constraints ──────────────────────────────────────────────────────────
  CONSTRAINT skills_slug_unique UNIQUE (slug)
);

-- ─── hot-path indexes referenced by 0009 leaderboards + sync queries ────────
-- Only the ones that touch pre-0004 columns. `status` / `type` / etc. get
-- their indexes from the migrations that add the columns.
CREATE INDEX IF NOT EXISTS idx_skills_trust_score      ON skills (trust_score);
CREATE INDEX IF NOT EXISTS idx_skills_source           ON skills (source);
CREATE INDEX IF NOT EXISTS idx_skills_execution_layer  ON skills (execution_layer);
