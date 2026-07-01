-- 0007_compositions.sql
-- Named, versioned, forkable skill pipelines.
-- Compositions are also rows in skills (type = 'composition' | 'pipeline').
-- This table stores the ordered step graph.

CREATE TABLE IF NOT EXISTS composition_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  composition_id UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  step_order SMALLINT NOT NULL,
  skill_id UUID NOT NULL REFERENCES skills(id),

  -- Step-level overrides
  step_name TEXT,                           -- human label for this step
  input_mapping JSONB,                      -- how previous step output maps to this input
  condition JSONB,                          -- optional conditional execution
  on_error TEXT DEFAULT 'fail'              -- fail | skip | retry
    CHECK (on_error IN ('fail', 'skip', 'retry')),

  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(composition_id, step_order)
);

CREATE INDEX IF NOT EXISTS idx_composition_steps_composition ON composition_steps(composition_id);
CREATE INDEX IF NOT EXISTS idx_composition_steps_skill ON composition_steps(skill_id);
