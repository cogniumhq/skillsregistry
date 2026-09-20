-- 0032_leaderboard_signatures.sql
--
-- K9 — surface D2 publisher-signature fields on `leaderboard_human` and
-- `leaderboard_agent` materialized views so admin dashboards and
-- the `/v1/leaderboards/*` API can render trust + verified-publisher
-- status without a join back to `skills` per leaderboard row.
--
-- Postgres has no ALTER MATERIALIZED VIEW ADD COLUMN — DROP+CREATE is the
-- only path. We rebuild both views with their existing column list
-- intact and append three new columns at the end:
--
--   - publisher_key_id          TEXT     (FK to publisher_keys.key_id)
--   - signature_verified_at     TIMESTAMPTZ
--   - signature_failure_reason  TEXT     (CHECK-bounded enum from 0030)
--
-- These match the *public* sig surface already exposed on
-- `GET /v1/skills/:slug`, `/versions`, `/pull`, search results, and MCP
-- `get_skill` (§17.3 G7). The *internal* sig columns
-- (`publisher_signature`, `signed_payload_hash`, `signed_at`,
-- `signature_nonce`) deliberately stay off — they're server-only.
--
-- Note: the legacy `s.type` column reference is preserved as-is to keep
-- this migration scoped to K9. The `type` → `skill_type` drift dates back
-- to 0010 and is a separate followup (mapper already reads `r.skill_type`,
-- silently undefined on current MVs — pre-existing).
--
-- After this migration ships, the existing periodic
-- `REFRESH MATERIALIZED VIEW CONCURRENTLY` jobs start populating the new
-- columns automatically. No code change needed there.

DROP MATERIALIZED VIEW IF EXISTS leaderboard_human;
DROP MATERIALIZED VIEW IF EXISTS leaderboard_agent;

-- Human leaderboard
CREATE MATERIALIZED VIEW leaderboard_human AS
SELECT
  s.id,
  s.slug,
  s.name,
  s.type,
  a.handle AS author_handle,
  a.author_type,
  s.human_star_count,
  s.human_fork_count,
  s.human_copy_count,
  s.human_use_count,
  s.fork_depth,
  s.origin_id,
  s.trust_score,
  s.verified_creator,
  s.featured,
  -- Weighted score for ranking
  (s.human_star_count * 3 + s.human_fork_count * 5 + s.human_copy_count * 2 + s.human_use_count) AS human_score,
  -- K9: D2 public sig fields
  s.publisher_key_id,
  s.signature_verified_at,
  s.signature_failure_reason
FROM skills s
LEFT JOIN authors a ON a.id = s.author_id
WHERE s.status = 'published'
  AND s.author_type = 'human';  -- HUMAN ONLY: bots excluded from human leaderboard

CREATE UNIQUE INDEX idx_leaderboard_human_pk ON leaderboard_human(id);
CREATE INDEX idx_leaderboard_human_score ON leaderboard_human(human_score DESC);

-- Agent leaderboard
CREATE MATERIALIZED VIEW leaderboard_agent AS
SELECT
  s.id,
  s.slug,
  s.name,
  s.type,
  a.handle AS author_handle,
  a.author_type,
  a.bot_model,
  s.agent_invocation_count,
  s.weekly_agent_invocation_count,
  s.composition_inclusion_count,
  s.dependent_count,
  s.agent_fork_count,
  s.avg_execution_time_ms,
  s.error_rate,
  s.trust_score,
  -- Weighted score for agent leaderboard
  (s.agent_invocation_count * 1
   + s.composition_inclusion_count * 10
   + s.dependent_count * 8
   - COALESCE(s.error_rate, 0) * 1000) AS agent_score,
  -- K9: D2 public sig fields
  s.publisher_key_id,
  s.signature_verified_at,
  s.signature_failure_reason
FROM skills s
LEFT JOIN authors a ON a.id = s.author_id
WHERE s.status = 'published';

CREATE UNIQUE INDEX idx_leaderboard_agent_pk ON leaderboard_agent(id);
CREATE INDEX idx_leaderboard_agent_score ON leaderboard_agent(agent_score DESC);
CREATE INDEX idx_leaderboard_agent_weekly ON leaderboard_agent(weekly_agent_invocation_count DESC);
