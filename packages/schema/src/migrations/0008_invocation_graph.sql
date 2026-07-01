-- 0008_invocation_graph.sql
-- Live dependency graph from actual agent invocations.
-- Powers: composition fitness score, co-occurrence map, trending.

CREATE TABLE IF NOT EXISTS skill_invocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_id UUID NOT NULL REFERENCES skills(id),
  composition_id UUID REFERENCES skills(id), -- NULL if standalone invocation
  tenant_id TEXT NOT NULL,
  caller_type TEXT NOT NULL DEFAULT 'agent'  -- agent | human
    CHECK (caller_type IN ('agent', 'human')),
  duration_ms INTEGER,
  succeeded BOOLEAN NOT NULL,
  invoked_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invocations_skill ON skill_invocations(skill_id, invoked_at DESC);
CREATE INDEX IF NOT EXISTS idx_invocations_composition ON skill_invocations(composition_id);
CREATE INDEX IF NOT EXISTS idx_invocations_tenant ON skill_invocations(tenant_id, invoked_at DESC);

-- Co-occurrence pairs: which skills appear together in compositions
CREATE MATERIALIZED VIEW IF NOT EXISTS skill_cooccurrence AS
SELECT
  cs1.skill_id AS skill_a,
  cs2.skill_id AS skill_b,
  COUNT(DISTINCT cs1.composition_id) AS composition_count,
  COALESCE(SUM(si.agent_invocation_count), 0) AS total_paired_invocations
FROM composition_steps cs1
JOIN composition_steps cs2
  ON cs1.composition_id = cs2.composition_id
  AND cs1.skill_id < cs2.skill_id    -- avoid duplicates
JOIN skills si ON si.id = cs1.composition_id
GROUP BY cs1.skill_id, cs2.skill_id
HAVING COUNT(DISTINCT cs1.composition_id) >= 2;

CREATE UNIQUE INDEX IF NOT EXISTS idx_cooccurrence_pk ON skill_cooccurrence(skill_a, skill_b);
CREATE INDEX IF NOT EXISTS idx_cooccurrence_skill_a ON skill_cooccurrence(skill_a, total_paired_invocations DESC);
