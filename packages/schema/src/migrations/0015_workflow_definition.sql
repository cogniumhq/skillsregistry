-- 0015_workflow_definition.sql
-- v5.4: Add workflow_definition JSONB column for DAG-based composite skills.
-- Update runtime_env CHECK constraint: remove 'device' (migrate to 'api').

-- ─── New column ──────────────────────────────────────────────────────────────

ALTER TABLE skills ADD COLUMN IF NOT EXISTS workflow_definition JSONB;

-- ─── Migrate 'device' values before tightening constraint ────────────────────

UPDATE skills SET runtime_env = 'api' WHERE runtime_env = 'device';

-- ─── Replace runtime_env CHECK constraint (remove 'device') ─────────────────

ALTER TABLE skills DROP CONSTRAINT IF EXISTS chk_runtime_env;

DO $$ BEGIN
  ALTER TABLE skills ADD CONSTRAINT chk_runtime_env
    CHECK (runtime_env IN ('llm', 'api', 'browser', 'vm', 'local'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── Safety: reset composite skills without workflow_definition ──────────────
-- Avoids constraint violation for any existing rows.

UPDATE skills SET execution_layer = 'worker'
  WHERE execution_layer = 'composite' AND workflow_definition IS NULL;

-- ─── Composite execution_layer requires workflow_definition NOT NULL ─────────

DO $$ BEGIN
  ALTER TABLE skills ADD CONSTRAINT chk_composite_requires_workflow
    CHECK (execution_layer <> 'composite' OR workflow_definition IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
