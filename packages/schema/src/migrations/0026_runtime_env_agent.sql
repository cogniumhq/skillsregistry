-- 0026_runtime_env_agent.sql
-- v6.2: Add 'agent' to runtime_env CHECK constraint.
--
-- Per skillsregistry.md v6.2 §4 + skill-convention.md v1.1 §1, the canonical
-- runtime classes are now: api, vm, llm, agent (long-running streaming codegen
-- in extended Daytona sandbox). Previous constraint (migration 0015) omitted
-- `agent`, so inserts for the first @cognium/* agentic dogfood skill
-- (e.g. @cognium/claude-code) would have been rejected at the DB boundary.
--
-- Keeps `browser` and `local` from migration 0015 in place — those are
-- deferred runtime classes in skill-convention v1.1 §13 (browser deferred to
-- v1.0, local deferred to v1.5) and pre-existing rows may carry those values.

ALTER TABLE skills DROP CONSTRAINT IF EXISTS chk_runtime_env;

DO $$ BEGIN
  ALTER TABLE skills ADD CONSTRAINT chk_runtime_env
    CHECK (runtime_env IN ('llm', 'api', 'browser', 'vm', 'local', 'agent'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
