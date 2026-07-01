-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 0002: search_logs
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Every search event logged. Drives quality learning and cost tracking.
-- Non-blocking writes via executionCtx.waitUntil()
--
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS search_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp TIMESTAMPTZ DEFAULT NOW(),

  -- Query
  query TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  appetite TEXT,                           -- risk appetite used

  -- Routing
  tier SMALLINT NOT NULL CHECK (tier IN (1, 2, 3)),
  cache_hit BOOLEAN DEFAULT FALSE,

  -- Results
  top_score REAL,
  gap_to_second REAL,
  cluster_density SMALLINT,
  keyword_hits SMALLINT,
  result_count SMALLINT,
  match_source TEXT,
  result_skill_ids TEXT[],

  -- Performance
  total_latency_ms REAL,
  vector_search_ms REAL,
  full_text_search_ms REAL,
  fusion_strategy TEXT,

  -- LLM usage
  llm_invoked BOOLEAN DEFAULT FALSE,
  llm_latency_ms REAL,
  llm_model TEXT,
  llm_tokens_used INTEGER,

  -- Cost tracking (USD estimates)
  embedding_cost REAL DEFAULT 0,
  llm_cost REAL DEFAULT 0,

  -- Deep search trace (Tier 3 only)
  alternate_queries_used TEXT[],
  composition_detected BOOLEAN DEFAULT FALSE,
  generation_hint_returned BOOLEAN DEFAULT FALSE
);

-- Query logs by time (for analytics and cleanup)
CREATE INDEX idx_search_logs_timestamp ON search_logs (timestamp DESC);

-- Query logs by tenant + time
CREATE INDEX idx_search_logs_tenant ON search_logs (tenant_id, timestamp DESC);

-- Tier distribution analysis
CREATE INDEX idx_search_logs_tier ON search_logs (tier);

-- Match source effectiveness analysis
CREATE INDEX idx_search_logs_match_source ON search_logs (match_source);
