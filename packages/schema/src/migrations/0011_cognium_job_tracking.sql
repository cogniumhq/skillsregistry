-- 0011_cognium_job_tracking.sql
-- Two-phase cron scanning: submit in one cycle, poll in the next.
-- Tracks pending Circle-IR job IDs so the cron can pick up where it left off.

ALTER TABLE skills ADD COLUMN IF NOT EXISTS cognium_job_id TEXT;
ALTER TABLE skills ADD COLUMN IF NOT EXISTS cognium_job_submitted_at TIMESTAMPTZ;

-- Index for quickly finding skills with pending jobs
CREATE INDEX IF NOT EXISTS idx_skills_cognium_job_id ON skills (cognium_job_id)
  WHERE cognium_job_id IS NOT NULL;
