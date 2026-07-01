-- 0020_v53_portable_and_source.sql
-- v5.3: Add portable derived column and invocation source field
--
-- portable: Generated column derived from runtime_env + mcp_url.
-- Design principle #13: "portable is derived, never set manually."
-- - llm/local: always portable (runs in agent's own context)
-- - api: portable if mcp_url is a public URL (not localhost/127.x)
-- - browser/vm: not portable (require cloud infrastructure)
--
-- invocation source: Distinguishes Cortex-originated vs local agent invocations.
-- Both contribute to version ranking but are tracked separately for analytics.

-- 1. portable: generated column
ALTER TABLE skills ADD COLUMN portable BOOLEAN
  GENERATED ALWAYS AS (
    CASE
      WHEN runtime_env IN ('llm', 'local') THEN true
      WHEN runtime_env = 'api' AND mcp_url IS NOT NULL
           AND mcp_url NOT LIKE 'http://localhost%'
           AND mcp_url NOT LIKE 'http://127.%' THEN true
      ELSE false
    END
  ) STORED;

-- 2. invocation source: cortex vs local
ALTER TABLE skill_invocations ADD COLUMN source TEXT NOT NULL DEFAULT 'cortex'
  CHECK (source IN ('cortex', 'local'));

-- 3. Partial index for portable filter (only index portable=true rows)
CREATE INDEX idx_skills_portable ON skills (portable) WHERE portable = true;
