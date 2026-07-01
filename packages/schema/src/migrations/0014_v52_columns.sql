-- 0014_v52_columns.sql
-- v5.2: Add runtime_env, visibility, and environment_variables columns.
-- Also adds missing indexes from spec.
--
-- NOTE: Legacy columns (type, fork_of, fork_depth, origin_id, cognium_scanned,
--       cognium_report, source_execution_id, reuse_count) are NOT dropped.
--       They are removed from the Drizzle schema only. Materialized views and
--       existing data remain intact. Column drops are a separate deliberate step.

-- ─── New columns ────────────────────────────────────────────────────────────

ALTER TABLE skills ADD COLUMN IF NOT EXISTS runtime_env TEXT NOT NULL DEFAULT 'api';
ALTER TABLE skills ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'public';
ALTER TABLE skills ADD COLUMN IF NOT EXISTS environment_variables TEXT[];

-- ─── CHECK constraints ──────────────────────────────────────────────────────

DO $$ BEGIN
  ALTER TABLE skills ADD CONSTRAINT chk_runtime_env
    CHECK (runtime_env IN ('llm', 'api', 'browser', 'vm', 'local', 'device'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE skills ADD CONSTRAINT chk_visibility
    CHECK (visibility IN ('public', 'private', 'unlisted'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── New indexes ─────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_skills_runtime_env ON skills(runtime_env);
CREATE INDEX IF NOT EXISTS idx_skills_visibility ON skills(visibility);
CREATE INDEX IF NOT EXISTS idx_skills_slug_version ON skills(slug, version);
CREATE INDEX IF NOT EXISTS idx_skills_tags ON skills USING gin(tags);
CREATE INDEX IF NOT EXISTS idx_skills_categories ON skills USING gin(categories);
CREATE INDEX IF NOT EXISTS idx_skills_composition_ids ON skills USING gin(composition_skill_ids);
CREATE INDEX IF NOT EXISTS idx_skills_weekly_agent ON skills(weekly_agent_invocation_count DESC);
CREATE INDEX IF NOT EXISTS idx_skills_human_stars ON skills(human_star_count DESC);
