-- 0018: Add scan_retry_count for bounded scan retries
-- markScanFailed() increments this; cron excludes skills where count >= max.
-- Admin endpoint /v1/admin/retry-failed resets it to allow manual re-scan.

ALTER TABLE skills ADD COLUMN IF NOT EXISTS scan_retry_count INTEGER NOT NULL DEFAULT 0;
