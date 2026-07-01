-- 0009_leaderboards.sql
-- Dual-track leaderboards: human signals and agent signals kept separate.

-- Human leaderboard (materialized hourly)
CREATE MATERIALIZED VIEW IF NOT EXISTS leaderboard_human AS
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
  (s.human_star_count * 3 + s.human_fork_count * 5 + s.human_copy_count * 2 + s.human_use_count) AS human_score
FROM skills s
LEFT JOIN authors a ON a.id = s.author_id
WHERE s.status = 'published'
  AND s.author_type = 'human';  -- HUMAN ONLY: bots excluded from human leaderboard

CREATE UNIQUE INDEX IF NOT EXISTS idx_leaderboard_human_pk ON leaderboard_human(id);
CREATE INDEX IF NOT EXISTS idx_leaderboard_human_score ON leaderboard_human(human_score DESC);

-- Agent leaderboard (materialized hourly)
CREATE MATERIALIZED VIEW IF NOT EXISTS leaderboard_agent AS
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
   - COALESCE(s.error_rate, 0) * 1000) AS agent_score
FROM skills s
LEFT JOIN authors a ON a.id = s.author_id
WHERE s.status = 'published';

CREATE UNIQUE INDEX IF NOT EXISTS idx_leaderboard_agent_pk ON leaderboard_agent(id);
CREATE INDEX IF NOT EXISTS idx_leaderboard_agent_score ON leaderboard_agent(agent_score DESC);
CREATE INDEX IF NOT EXISTS idx_leaderboard_agent_weekly ON leaderboard_agent(weekly_agent_invocation_count DESC);
