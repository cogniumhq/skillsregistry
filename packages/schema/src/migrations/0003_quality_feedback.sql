-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 0003: quality_feedback
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Closes the quality learning loop.
-- Records user feedback (clicks, usage, dismissals) to measure search quality.
--
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS quality_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  search_event_id UUID REFERENCES search_logs(id),
  skill_id UUID NOT NULL,
  feedback_type TEXT NOT NULL CHECK (
    feedback_type IN ('click', 'use', 'dismiss', 'explicit_good', 'explicit_bad')
  ),
  position SMALLINT NOT NULL,
  timestamp TIMESTAMPTZ DEFAULT NOW()
);

-- Join back to search events
CREATE INDEX idx_feedback_event ON quality_feedback (search_event_id);

-- Skill-level quality metrics
CREATE INDEX idx_feedback_skill ON quality_feedback (skill_id);

-- Feedback type analysis by time
CREATE INDEX idx_feedback_type ON quality_feedback (feedback_type, timestamp DESC);

-- ──────────────────────────────────────────────────────────────────────────────
-- Materialized View: Hourly Quality Metrics
-- ──────────────────────────────────────────────────────────────────────────────
--
-- Refresh via cron trigger (not implemented in Phase 1)
--
-- ──────────────────────────────────────────────────────────────────────────────

CREATE MATERIALIZED VIEW search_quality_summary AS
SELECT
  date_trunc('hour', sl.timestamp) AS hour,
  sl.tier,
  sl.match_source,
  sl.fusion_strategy,
  COUNT(*) AS query_count,
  AVG(sl.top_score) AS avg_top_score,
  AVG(sl.total_latency_ms) AS avg_latency_ms,
  AVG(sl.llm_latency_ms) FILTER (WHERE sl.llm_invoked) AS avg_llm_latency_ms,
  SUM(sl.embedding_cost + sl.llm_cost) AS total_cost,
  COUNT(qf.id) FILTER (WHERE qf.feedback_type = 'use') AS use_count,
  COUNT(qf.id) FILTER (WHERE qf.feedback_type = 'explicit_bad') AS bad_count,
  AVG(qf.position) FILTER (WHERE qf.feedback_type IN ('click', 'use')) AS avg_click_position
FROM search_logs sl
LEFT JOIN quality_feedback qf ON qf.search_event_id = sl.id
GROUP BY 1, 2, 3, 4;

-- Primary key for efficient refresh
CREATE UNIQUE INDEX idx_quality_summary_pk
  ON search_quality_summary (hour, tier, match_source, fusion_strategy);
