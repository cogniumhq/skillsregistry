-- 0027_agent_profile.sql
-- v6.2: Agentic-runtime registration storage.
--
-- Per skill-convention.md v1.1 §14.2, `runtime_env = 'agent'` skills declare a
-- sandbox profile (memory, CPU, wall-clock, budget caps, egress list) that
-- Cortex consumes when provisioning the extended Daytona sandbox. We store
-- this as a JSONB blob (not first-class columns) for two reasons:
--   1. The v1.1 convention is still evolving; first-classing fields now would
--      churn the schema every minor rev.
--   2. Cortex is the consumer; the registry just persists what the publisher
--      declared. No queries filter on these fields today.
--
-- Schema (informal, validated at publish time by Zod):
--   {
--     "memoryMb":         number,  // 512..8192
--     "cpu":              number,  // 1..8
--     "timeoutSeconds":   number,  // 60..28800 (8h max)
--     "budgetCaps": {
--       "maxTokensUsd":           number,
--       "maxInternalToolCalls":   number
--     },
--     "egress":           string[] // additional allow-list beyond defaults
--   }
--
-- Reserved for skills with `runtime_env = 'agent'`. A CHECK constraint
-- enforces that non-agent skills cannot carry a profile (avoids drift).

ALTER TABLE skills ADD COLUMN IF NOT EXISTS agent_profile JSONB;

DO $$ BEGIN
  ALTER TABLE skills ADD CONSTRAINT chk_agent_profile_runtime
    CHECK (agent_profile IS NULL OR runtime_env = 'agent');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
