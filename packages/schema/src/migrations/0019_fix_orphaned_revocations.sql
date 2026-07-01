-- 0019_fix_orphaned_revocations.sql
-- Fix data inconsistencies from the Llama Guard false-positive bug (migration 0017)
-- and the restore-revoked endpoint not clearing revoked_at.
--
-- Two issues:
-- 1. ~121 skills have revoked_at set but status='published' — orphaned timestamps
--    from the restore-revoked endpoint not clearing revoked_at.
-- 2. ~38 published skills have CRITICAL findings in cognium_findings — these should
--    be revoked but their status was overwritten. Reset their scan state so the
--    cron re-scans them and applies the correct status.

-- Issue 1: Clear orphaned revoked_at for published/deprecated skills
UPDATE skills SET
  revoked_at = NULL,
  revoked_reason = NULL,
  updated_at = NOW()
WHERE revoked_at IS NOT NULL
  AND status NOT IN ('revoked', 'degraded');

-- Issue 2: Reset scan state for published skills with CRITICAL findings
-- so the cron will re-scan them and apply the correct revoked/vulnerable status.
-- The scan-report-handler will derive the correct status from the new findings.
UPDATE skills SET
  cognium_scanned_at = NULL,
  cognium_job_id = NULL,
  verification_tier = 'unverified',
  scan_retry_count = 0,
  scan_failure_reason = NULL,
  updated_at = NOW()
WHERE status = 'published'
  AND cognium_findings IS NOT NULL
  AND cognium_findings::text LIKE '%CRITICAL%';
