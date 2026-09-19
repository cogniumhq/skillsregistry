-- ════════════════════════════════════════════════════════════════════════════
-- §J8: mcp_invocations — per-tool-call observability for the MCP surface
-- ════════════════════════════════════════════════════════════════════════════
--
-- Every JSON-RPC `tools/call` against /mcp writes one row here via
-- `c.executionCtx.waitUntil()`. The aggregator path for skill-resolving tools
-- (`get_skill`, `get_trust_breakdown`, `resolve_composition`) also bumps
-- `skills.agent_invocation_count` + `weekly_agent_invocation_count` so the
-- agent leaderboard reflects MCP-sourced traffic without a parallel pipeline.
--
-- Tools that don't resolve a single skill (`search_skills`, `list_leaderboard`)
-- record the invocation here but skip the per-skill bump — otherwise every
-- discovery query would inflate the rankings.
--
-- Design constraints carried in:
--   - `Logging is non-blocking`: writes are
--     waitUntil()-wrapped, never on the request path.
--   - `No magic numbers`: error_code is the raw JSON-RPC code; success is a
--     boolean derived from {response had `error` field, yes/no}.
--   - Args column is JSONB but capped client-side to MCP_INVOCATION_ARGS_MAX
--     chars before serialize to keep row size predictable.
--
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS mcp_invocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Which tool was called.
  tool_name TEXT NOT NULL,

  -- Tenant scope (advisory in v1 — read from X-Tenant-Id header).
  tenant_id TEXT NOT NULL,

  -- Skill resolution (NULL for search_skills / list_leaderboard).
  skill_id UUID REFERENCES skills(id) ON DELETE SET NULL,

  -- Outcome.
  succeeded BOOLEAN NOT NULL,
  duration_ms INTEGER,

  -- JSON-RPC error code when succeeded = FALSE (NULL otherwise).
  -- -32700 parse, -32600 invalid req, -32601 method not found,
  -- -32602 invalid params, -32603 internal.
  error_code INTEGER,

  -- Truncated args for forensics. JSONB so we can index expression-wise later
  -- without a schema change (e.g. on `args->>'kind'` for leaderboard slices).
  args JSONB
);

-- Hot path: per-tool time series for the analytics dashboard.
CREATE INDEX IF NOT EXISTS idx_mcp_invocations_tool_time
  ON mcp_invocations (tool_name, timestamp DESC);

-- Per-tenant traffic + abuse triage.
CREATE INDEX IF NOT EXISTS idx_mcp_invocations_tenant_time
  ON mcp_invocations (tenant_id, timestamp DESC);

-- Per-skill rollup (for "which skills get hit through MCP vs REST").
-- Partial index keeps it cheap since most rows on search/leaderboard tools
-- carry skill_id IS NULL.
CREATE INDEX IF NOT EXISTS idx_mcp_invocations_skill_time
  ON mcp_invocations (skill_id, timestamp DESC)
  WHERE skill_id IS NOT NULL;

COMMIT;

-- ────────────────────────────────────────────────────────────────────────────
-- Post-migration verification (run from psql):
--
--   -- Confirm table + indexes exist:
--   SELECT tablename, indexname FROM pg_indexes
--    WHERE tablename = 'mcp_invocations' ORDER BY indexname;
--
--   -- After traffic, confirm aggregator wiring (counts > 0 for skill-resolving tools):
--   SELECT tool_name, COUNT(*), COUNT(*) FILTER (WHERE skill_id IS NOT NULL) AS with_skill
--     FROM mcp_invocations
--    WHERE timestamp > NOW() - INTERVAL '1 hour'
--    GROUP BY tool_name;
-- ────────────────────────────────────────────────────────────────────────────
